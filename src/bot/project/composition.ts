import type { Bot, Context } from "grammy";
import { logError, logErrorThrottled } from "../../infra/logging";
import { resolveLocaleFromTelegramLanguageCode } from "../../i18n";
import { createUploadBatchStore, type DeliveryService, type UploadService } from "../../services/use-cases";
import { createBatchActions } from "./batch-actions";
import { buildAssetActionLine as buildAssetActionLineModule, buildPreviewLinkLine as buildPreviewLinkLineModule } from "./builders";
import { createFootprintRenderer } from "./footprint";
import { createHistoryRenderer } from "./history";
import { createProjectAdminInput } from "./admin-input";
import { registerProjectCallbackRoutes } from "./callbacks";
import { getMemberScopeLabel } from "./labels";
import { createOpenHandler } from "./open";
import { registerProjectCommands } from "./commands";
import { registerProjectMessageHandlers } from "./messages";
import { createSearchRenderer } from "./search";
import { createProjectSession, type MetaState } from "./session";
import { createProjectSocial } from "./social";
import { createProjectTagRenderers } from "./tags";
import { registerProjectMiddlewares } from "./middlewares";
import { createProjectRenderers } from "./renderers";
import { buildDbDisabledHint, buildGuideHint, buildStartLink, buildSuccessHint, escapeHtml, normalizeButtonText, replyHtml, sanitizeTelegramHtml, stripHtmlTags, toMetaKey, truncatePlainText, upsertHtml } from "./ui-utils";
import { actionKeyboard, buildCollectionsKeyboard, buildHelpKeyboard, buildMainKeyboard, buildManageKeyboard, buildMetaInputKeyboard, buildUserKeyboard } from "./keyboards";

export const formatProjectLocalDateTime = (date: Date) => {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${y}-${m}-${d} ${hh}:${mm}`;
};

export const createProjectBotFrame = (deliveryService: DeliveryService | null) => {
  const mainKeyboard = buildMainKeyboard();
  const userKeyboard = buildUserKeyboard();
  const isCancelText = (value: string) => {
    const normalized = normalizeButtonText(value).toLowerCase();
    return normalized === "取消" || normalized === "退出" || normalized === "cancel" || normalized === "/cancel";
  };
  const getDefaultKeyboard = async (ctx: Context) => {
    const locale = resolveLocaleFromTelegramLanguageCode(ctx.from?.language_code);
    if (!deliveryService || !ctx.from) {
      return buildMainKeyboard(locale);
    }
    const isProjectMember = await deliveryService.isProjectMember(String(ctx.from.id)).catch(() => true);
    return isProjectMember ? buildMainKeyboard(locale) : buildUserKeyboard(locale);
  };

  return {
    mainKeyboard,
    userKeyboard,
    isCancelText,
    getDefaultKeyboard
  };
};

type UploadBatchStore = ReturnType<typeof createUploadBatchStore>;

export const createProjectBotScaffold = (
  store: UploadBatchStore,
  service: UploadService,
  deliveryService: DeliveryService | null
) => {
  const session = createProjectSession();
  const { commit, cancel } = createBatchActions(store, service);
  const open = createOpenHandler(deliveryService);

  return {
    ...session,
    commit,
    cancel,
    ...open,
    historyPageSize: 10,
    maxMetaBytes: 1500,
    maxTitleBytes: 200,
    maxDescriptionBytes: 1200
  };
};

type ProjectInteractionHandlerDeps = {
  getDefaultKeyboard: (ctx: Context) => Promise<unknown>;
  ensureSessionMode: ReturnType<typeof createProjectSession>["ensureSessionMode"];
  getSessionLabel: ReturnType<typeof createProjectSession>["getSessionLabel"];
  setSessionMode: ReturnType<typeof createProjectSession>["setSessionMode"];
  setActive: ReturnType<typeof createProjectSession>["setActive"];
  cancel: (userId: number, chatId: number) => Promise<{ ok: boolean; message: string }>;
};

export const createProjectInteractionStateHandlers = (deps: ProjectInteractionHandlerDeps) => {
  const resetSessionForCommand = async (ctx: Context) => {
    if (!ctx.from || !ctx.chat) {
      return;
    }
    const key = toMetaKey(ctx.from.id, ctx.chat.id);
    const mode = deps.ensureSessionMode(key);
    if (mode === "upload") {
      await deps.cancel(ctx.from.id, ctx.chat.id);
      deps.setActive(ctx.from.id, ctx.chat.id, false);
    }
    deps.setSessionMode(key, "idle");
  };

  const exitCurrentInputState = async (ctx: Context) => {
    if (!ctx.from || !ctx.chat) {
      return false;
    }
    const key = toMetaKey(ctx.from.id, ctx.chat.id);
    const mode = deps.ensureSessionMode(key);
    if (mode === "idle") {
      const keyboard = await deps.getDefaultKeyboard(ctx);
      await replyHtml(ctx, buildGuideHint("当前没有进行中的输入状态。"), { reply_markup: keyboard as never });
      return true;
    }
    if (mode === "upload") {
      const result = await deps.cancel(ctx.from.id, ctx.chat.id);
      deps.setActive(ctx.from.id, ctx.chat.id, false);
      const keyboard = await deps.getDefaultKeyboard(ctx);
      await replyHtml(ctx, buildSuccessHint(result.message, "已退出当前输入状态。"), { reply_markup: keyboard as never });
      return true;
    }
    deps.setSessionMode(key, "idle");
    const keyboard = await deps.getDefaultKeyboard(ctx);
    await replyHtml(ctx, buildSuccessHint(`已退出${deps.getSessionLabel(mode)}。`), { reply_markup: keyboard as never });
    return true;
  };

  return { resetSessionForCommand, exitCurrentInputState };
};

export const createProjectBotViews = (
  bot: Bot,
  deps: {
    deliveryService: DeliveryService | null;
    mainKeyboard: ReturnType<typeof buildMainKeyboard>;
    syncSessionForView: ReturnType<typeof createProjectSession>["syncSessionForView"];
    ensureSessionMode: ReturnType<typeof createProjectSession>["ensureSessionMode"];
    setSessionMode: ReturnType<typeof createProjectSession>["setSessionMode"];
    collectionStates: ReturnType<typeof createProjectSession>["collectionStates"];
    historyFilterStates: ReturnType<typeof createProjectSession>["historyFilterStates"];
    historyDateStates: ReturnType<typeof createProjectSession>["historyDateStates"];
    historyScopeStates: ReturnType<typeof createProjectSession>["historyScopeStates"];
    broadcastDraftStates: ReturnType<typeof createProjectSession>["broadcastDraftStates"];
    commentInputStates: ReturnType<typeof createProjectSession>["commentInputStates"];
    rankingViewStates: ReturnType<typeof createProjectSession>["rankingViewStates"];
    formatLocalDateTime: (date: Date) => string;
  }
) => {
  const { hydrateUserPreferences } = registerProjectMiddlewares(bot, {
    deliveryService: deps.deliveryService,
    collectionStates: deps.collectionStates,
    historyFilterStates: deps.historyFilterStates,
    historyDateStates: deps.historyDateStates
  });

  const renderers = createProjectRenderers({
    deliveryService: deps.deliveryService,
    mainKeyboard: deps.mainKeyboard,
    syncSessionForView: deps.syncSessionForView,
    broadcastDraftStates: deps.broadcastDraftStates,
    rankingViewStates: deps.rankingViewStates,
    formatLocalDateTime: deps.formatLocalDateTime
  });

  const social = createProjectSocial({
    deliveryService: deps.deliveryService,
    mainKeyboard: deps.mainKeyboard,
    ensureSessionMode: deps.ensureSessionMode,
    setSessionMode: deps.setSessionMode,
    commentInputStates: deps.commentInputStates,
    formatLocalDateTime: deps.formatLocalDateTime
  });

  const renderFootprint = createFootprintRenderer({
    deliveryService: deps.deliveryService,
    mainKeyboard: deps.mainKeyboard,
    syncSessionForView: deps.syncSessionForView,
    formatLocalDateTime: deps.formatLocalDateTime,
    buildStartLink
  });

  const renderHistory = createHistoryRenderer({
    deliveryService: deps.deliveryService,
    mainKeyboard: deps.mainKeyboard,
    syncSessionForView: deps.syncSessionForView,
    hydrateUserPreferences,
    historyPageSize: 10,
    historyFilterStates: deps.historyFilterStates,
    historyDateStates: deps.historyDateStates,
    historyScopeStates: deps.historyScopeStates,
    buildAssetActionLine: buildAssetActionLineModule
  });

  const renderSearch = createSearchRenderer({
    deliveryService: deps.deliveryService,
    mainKeyboard: deps.mainKeyboard,
    buildAssetActionLine: buildAssetActionLineModule
  });

  const tags = createProjectTagRenderers({
    deliveryService: deps.deliveryService,
    mainKeyboard: deps.mainKeyboard
  });

  return {
    hydrateUserPreferences,
    ...renderers,
    ...social,
    renderFootprint,
    renderHistory,
    renderSearch,
    ...tags
  };
};

export const parseProjectLocalDateTime = (value: string) => {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }
  return date;
};

type ProjectAdminInputDeps = Parameters<typeof createProjectAdminInput>[0];

export const createProjectAdminInputHandlers = (
  deps: Omit<ProjectAdminInputDeps, "parseLocalDateTime"> & { parseLocalDateTime?: ProjectAdminInputDeps["parseLocalDateTime"] }
): ReturnType<typeof createProjectAdminInput> =>
  createProjectAdminInput({
    ...deps,
    parseLocalDateTime: deps.parseLocalDateTime ?? parseProjectLocalDateTime
  });

export const registerProjectBotFlows = (
  bot: Bot,
  deps: {
    commands: Parameters<typeof registerProjectCommands>[1];
    callbacks: Parameters<typeof registerProjectCallbackRoutes>[1];
    messages: Parameters<typeof registerProjectMessageHandlers>[1];
  }
) => {
  registerProjectCommands(bot, deps.commands);
  registerProjectCallbackRoutes(bot, deps.callbacks);
  registerProjectMessageHandlers(bot, deps.messages);
};

export const getProjectCollectionTitle = (collections: { id: string; title: string }[], id: string | null) => {
  if (id === null) {
    return "未分类";
  }
  const found = collections.find((collection) => collection.id === id);
  return found ? stripHtmlTags(found.title) : "未分类";
};

export const createProjectMetaFlowHelpers = (deps: {
  metaStates: ReturnType<typeof createProjectSession>["metaStates"];
  setSessionMode: ReturnType<typeof createProjectSession>["setSessionMode"];
  maxMetaBytes: number;
  maxTitleBytes: number;
  maxDescriptionBytes: number;
}) => {
  const renderUploadStatus = async (ctx: Context) => {
    if (!ctx.from) {
      return;
    }
    await replyHtml(
      ctx,
      [
        "已开始接收媒体。",
        "请直接发送：照片 / 视频 / 文件 / 音频（支持相册、多条连续发送）。",
        "发送完毕后点击 <b>✅ 完成</b> 保存；如需退出可发送 <code>/cancel</code> 或点 <b>❌ 取消</b>。",
        "",
        "合规提示：禁止发送违法违规内容（含未成年人性相关内容、兽交等）。违规将封禁使用权限。"
      ].join("\n"),
      { reply_markup: actionKeyboard }
    );
  };

  const startMeta = async (ctx: Context, assetId: string, mode: MetaState["mode"]) => {
    if (!ctx.from || !ctx.chat) {
      return;
    }
    const key = toMetaKey(ctx.from.id, ctx.chat.id);
    deps.metaStates.set(key, { assetId, mode });
    deps.setSessionMode(key, "meta");
    await replyHtml(
      ctx,
      `📝 请发送文字（支持 Telegram HTML）。\n第一行会作为标题并在展示时加粗，其余为描述。\n限制：标题 ≤ <code>${deps.maxTitleBytes}</code>B，描述 ≤ <code>${deps.maxDescriptionBytes}</code>B，总计 ≤ <code>${deps.maxMetaBytes}</code>B。`,
      { reply_markup: buildMetaInputKeyboard() }
    );
  };

  return {
    renderUploadStatus,
    startMeta
  };
};

export const createProjectCollectionHelpers = (deps: {
  deliveryService: DeliveryService | null;
  mainKeyboard: ReturnType<typeof buildMainKeyboard>;
  hydrateUserPreferences: (ctx: Context) => Promise<void>;
  collectionStates: ReturnType<typeof createProjectSession>["collectionStates"];
  collectionPickerStates: ReturnType<typeof createProjectSession>["collectionPickerStates"];
}) => {
  const renderCollections = async (ctx: Context, options: { returnTo: "settings" | "upload"; page?: number }) => {
    if (!deps.deliveryService) {
      await replyHtml(ctx, buildDbDisabledHint("管理分类"), { reply_markup: deps.mainKeyboard });
      return;
    }
    await deps.hydrateUserPreferences(ctx);
    if (!ctx.from) {
      await replyHtml(ctx, "⚠️ 无法识别当前用户。", { reply_markup: deps.mainKeyboard });
      return;
    }
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!chatId) {
      await replyHtml(ctx, "⚠️ 无法识别当前会话。", { reply_markup: deps.mainKeyboard });
      return;
    }
    const userId = String(ctx.from.id);
    if (!(await deps.deliveryService.isProjectMember(userId))) {
      await replyHtml(ctx, `🔒 仅${getMemberScopeLabel()}可使用分类。`, { reply_markup: buildHelpKeyboard() });
      return;
    }
    const key = toMetaKey(ctx.from.id, chatId);
    const selectedId = deps.collectionStates.get(key) ?? null;
    const currentPage = options.page ?? deps.collectionPickerStates.get(key)?.page ?? 1;
    const canManage = await deps.deliveryService.canManageProjectCollections(userId);
    const collections = await deps.deliveryService.listCollections();
    const selectedTitle = getProjectCollectionTitle(collections, selectedId);
    const text =
      options.returnTo === "upload"
        ? ["<b>📁 选择分类</b>", "", `当前：<b>${escapeHtml(selectedTitle)}</b>`, "选择后将应用到本次储存。"].join("\n")
        : ["<b>📁 分类</b>", "", `当前：<b>${escapeHtml(selectedTitle)}</b>`].join("\n");
    await upsertHtml(ctx, text, buildCollectionsKeyboard({ canManage, selectedId, collections, page: currentPage }));
  };

  return { renderCollections };
};

export const createProjectManagePanelHelpers = (deps: {
  deliveryService: DeliveryService | null;
  mainKeyboard: ReturnType<typeof buildMainKeyboard>;
  syncSessionForView: (ctx: Context) => void;
}) => {
  const renderManagePanel = async (ctx: Context, assetId: string) => {
    deps.syncSessionForView(ctx);
    if (!deps.deliveryService) {
      await replyHtml(ctx, buildDbDisabledHint("进入管理"), { reply_markup: deps.mainKeyboard });
      return;
    }
    if (!ctx.from) {
      await replyHtml(ctx, "⚠️ 无法识别当前用户。", { reply_markup: deps.mainKeyboard });
      return;
    }
    const meta = await deps.deliveryService.getUserAssetMeta(String(ctx.from.id), assetId);
    if (!meta) {
      await replyHtml(ctx, "🔒 无权限或内容不存在。", { reply_markup: buildHelpKeyboard() });
      return;
    }
    const collections = await deps.deliveryService.listCollections().catch(() => []);
    const collectionTitle =
      meta.collectionId === null
        ? "未分类"
        : stripHtmlTags(collections.find((c) => c.id === meta.collectionId)?.title ?? "未分类");
    const username = ctx.me?.username;
    const manageCode = `m_${meta.assetId}`;
    const manageLink = username ? buildStartLink(username, manageCode) : undefined;
    const safeTitle = sanitizeTelegramHtml(meta.title);
    const safeDesc = meta.description ? sanitizeTelegramHtml(meta.description) : "";
    const openLink = meta.shareCode ? (username ? buildStartLink(username, `p_${meta.shareCode}`) : undefined) : undefined;
    const isRecycled = !meta.searchable && meta.visibility === "RESTRICTED";
    const statusText = isRecycled ? "已回收" : meta.searchable ? "显示中" : "已隐藏";
    const lines = [
      `<b>管理模式</b>`,
      `分类：<b>${escapeHtml(collectionTitle)}</b>`,
      `状态：<b>${statusText}</b>`,
      safeTitle ? `<b>${safeTitle}</b>` : "",
      safeDesc ? `<blockquote expandable>${safeDesc}</blockquote>` : "",
      manageLink ? `管理：<a href="${escapeHtml(manageLink)}">管理</a>` : "",
      meta.shareCode ? `打开哈希：<code>${escapeHtml(meta.shareCode)}</code>` : "",
      buildPreviewLinkLineModule(openLink ?? undefined)
    ]
      .filter(Boolean)
      .join("\n");
    await upsertHtml(ctx, lines, buildManageKeyboard(meta.assetId, { searchable: meta.searchable, recycled: isRecycled }));
  };

  return { renderManagePanel };
};

type StartPayloadEntry = "command" | "text_link";
type StartPayloadStatus = "received" | "routed_social" | "opened" | "failed";

const detectStartPayloadKind = (payload: string) => {
  const normalized = payload.trim();
  if (!normalized) {
    return "empty";
  }
  if (normalized.startsWith("p_")) return "p";
  if (normalized.startsWith("m_")) return "m";
  if (normalized.startsWith("ct_")) return "ct";
  if (normalized.startsWith("cv_")) return "cv";
  if (normalized.startsWith("cl_")) return "cl";
  if (normalized.startsWith("cr_")) return "cr";
  if (normalized.startsWith("ca_")) return "ca";
  if (normalized.startsWith("tg_")) return "tg";
  return "raw_share_code";
};

export const createProjectStartPayloadHelpers = (deps: {
  deliveryService: DeliveryService | null;
  handleStartPayload: (ctx: Context, payload: string) => Promise<boolean>;
  openShareCode: (ctx: Context, payload: string, page?: number) => Promise<unknown>;
  renderTagAssets: (ctx: Context, tagId: string, page: number, mode: "reply" | "edit") => Promise<void>;
  renderManagePanel: (ctx: Context, assetId: string) => Promise<void>;
}) => {
  const trackStartPayloadVisit = async (
    ctx: Context,
    payload: string,
    entry: StartPayloadEntry,
    status: StartPayloadStatus,
    reason?: string
  ) => {
    if (!deps.deliveryService || !ctx.from) {
      return;
    }
    await deps.deliveryService
      .trackVisit(String(ctx.from.id), "start_payload", {
        entry,
        payloadKind: detectStartPayloadKind(payload),
        status,
        reason: reason ?? null
      })
      .catch((error) =>
        logErrorThrottled(
          { component: "project_bot", op: "track_visit", scope: "start_payload" },
          error,
          { intervalMs: 30_000 }
        )
      );
  };

  const handleStartPayloadEntry = async (ctx: Context, payload: string, entry: StartPayloadEntry) => {
    if (await deps.handleStartPayload(ctx, payload)) {
      await trackStartPayloadVisit(ctx, payload, entry, "routed_social");
      return true;
    }
    if (payload.startsWith("p_")) {
      const raw = payload.slice(2);
      const lastUnderscore = raw.lastIndexOf("_");
      const parsedPage = lastUnderscore > 0 ? Number(raw.slice(lastUnderscore + 1)) : Number.NaN;
      const hasPage = Number.isFinite(parsedPage) && parsedPage >= 1;
      const page = hasPage ? parsedPage : 1;
      const shareCode = lastUnderscore > 0 && hasPage ? raw.slice(0, lastUnderscore) : raw;
      if (!shareCode.trim()) {
        await replyHtml(ctx, "⚠️ 链接参数无效，请重新获取预览链接。");
        await trackStartPayloadVisit(ctx, payload, entry, "failed", "empty_share_code");
        return true;
      }
      const openResult = await deps.openShareCode(ctx, shareCode, page);
      await trackStartPayloadVisit(ctx, payload, entry, openResult === "opened" ? "opened" : "failed", openResult === "opened" ? undefined : String(openResult));
      return true;
    }
    if (payload.startsWith("m_")) {
      const assetId = payload.slice(2);
      if (!ctx.from) {
        await trackStartPayloadVisit(ctx, payload, entry, "failed", "missing_user");
        return true;
      }
      if (!deps.deliveryService) {
        await replyHtml(ctx, buildDbDisabledHint("进入管理"));
        await trackStartPayloadVisit(ctx, payload, entry, "failed", "db_disabled");
        return true;
      }
      const meta = await deps.deliveryService.getUserAssetMeta(String(ctx.from.id), assetId);
      if (!meta) {
        await replyHtml(ctx, "🔒 无权限或内容不存在。");
        await trackStartPayloadVisit(ctx, payload, entry, "failed", "forbidden_or_missing");
        return true;
      }
      await deps.renderManagePanel(ctx, assetId);
      await trackStartPayloadVisit(ctx, payload, entry, "opened");
      return true;
    }
    if (payload.startsWith("tg_")) {
      const tagId = payload.slice(3).trim();
      if (!tagId) {
        await replyHtml(ctx, "⚠️ 标签链接无效，请重新打开标签列表。");
        await trackStartPayloadVisit(ctx, payload, entry, "failed", "empty_tag_id");
        return true;
      }
      await deps.renderTagAssets(ctx, tagId, 1, "reply");
      await trackStartPayloadVisit(ctx, payload, entry, "opened");
      return true;
    }
    const openResult = await deps.openShareCode(ctx, payload, 1);
    await trackStartPayloadVisit(ctx, payload, entry, openResult === "opened" ? "opened" : "failed", openResult === "opened" ? undefined : String(openResult));
    return true;
  };

  return { trackStartPayloadVisit, handleStartPayloadEntry };
};
