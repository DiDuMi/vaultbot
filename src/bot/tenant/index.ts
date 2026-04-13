import { InlineKeyboard } from "grammy";
import type { Bot, Context } from "grammy";
import type { Message } from "grammy/types";
import { logError, logErrorThrottled } from "../../infra/logging";
import { withTelegramRetry } from "../../infra/telegram";
import type { DeliveryService, UploadMessage, UploadService } from "../../services/use-cases";
import { createUploadBatchStore } from "../../services/use-cases";
import {
  buildPublisherLine,
  buildDbDisabledHint,
  buildGuideHint,
  buildSuccessHint,
  buildStartLink,
  buildInputExitHint,
  editHtml,
  escapeHtml,
  extractStartPayloadFromText,
  formatApproxCount,
  normalizeButtonText,
  replyHtml,
  safeCallbackData,
  sanitizeInlineKeyboard,
  sanitizeTelegramHtml,
  stripHtmlTags,
  toMetaKey,
  truncatePlainText,
  upsertHtml,
  utf8ByteLength
} from "./ui-utils";
import {
  buildAssetActionLine as buildAssetActionLineModule,
  buildPreviewCopyLines,
  buildPreviewLinkLine as buildPreviewLinkLineModule
} from "./builders";
import { createTenantRenderers } from "./renderers";
import { registerTenantCallbackRoutes } from "./callbacks";
import { createBatchActions } from "./batch-actions";
import { createFootprintRenderer } from "./footprint";
import { createHistoryRenderer } from "./history";
import { registerMediaHandlers as registerMediaHandlersModule } from "./media-handlers";
import { createOpenHandler } from "./open";
import { createSearchRenderer } from "./search";
import { createTenantSession, type MetaState } from "./session";
import { createTenantSocial } from "./social";
import { createTagRenderers } from "./tags";
import { createTenantAdminInput } from "./admin-input";
import { registerTenantCommands } from "./register-commands";
import { registerTenantMessageHandlers } from "./register-messages";
import { registerTenantMiddlewares } from "./register-middlewares";
import {
  actionKeyboard,
  buildAdKeyboard,
  buildAdminInputKeyboard,
  buildBroadcastButtonsKeyboard,
  buildBroadcastKeyboard,
  buildBroadcastPreviewKeyboard,
  buildCollectionInputKeyboard,
  buildCollectionDeleteConfirmKeyboard,
  buildCollectionsKeyboard,
  buildFootprintKeyboard,
  buildFollowInputKeyboard,
  buildHelpKeyboard,
  buildHistoryKeyboard,
  buildHistoryFilterKeyboard,
  buildHomeDetailKeyboard,
  buildHomeKeyboard,
  buildMainKeyboard,
  buildManageKeyboard,
  buildMetaInputKeyboard,
  buildOpenKeyboard,
  buildProtectKeyboard,
  buildRankPublicKeyboard,
  buildRankingKeyboard,
  buildSettingsInputKeyboard,
  buildSettingsKeyboard,
  buildStartShortcutKeyboard,
  buildUserKeyboard,
  buildUserHistoryKeyboard,
  buildWelcomeKeyboard
} from "./keyboards";

export { buildAssetActionLineModule as buildAssetActionLine, buildPreviewLinkLineModule as buildPreviewLinkLine };

type UploadBatchStore = ReturnType<typeof createUploadBatchStore>;
type ReplyMarkup = NonNullable<Parameters<Context["reply"]>[1]>["reply_markup"];
const formatReceivedHint = (count: number) => {
  if (count < 10) {
    return String(count);
  }
  const base = Math.floor(count / 10) * 10;
  return `${base}+`;
};
const ASSET_ACTION_LABEL = "操作";
const ASSET_ACTION_SEPARATOR = " ｜ ";

type StartPayloadEntry = "command" | "text_link";
type StartPayloadStatus = "received" | "routed_social" | "opened" | "failed";

const detectStartPayloadKind = (payload: string) => {
  const normalized = payload.trim();
  if (!normalized) {
    return "empty";
  }
  if (normalized.startsWith("p_")) {
    return "p";
  }
  if (normalized.startsWith("m_")) {
    return "m";
  }
  if (normalized.startsWith("ct_")) {
    return "ct";
  }
  if (normalized.startsWith("cv_")) {
    return "cv";
  }
  if (normalized.startsWith("cl_")) {
    return "cl";
  }
  if (normalized.startsWith("cr_")) {
    return "cr";
  }
  if (normalized.startsWith("ca_")) {
    return "ca";
  }
  return "raw_share_code";
};

const legacyBuildPreviewLinkLine = (openLink?: string) => {
  return openLink ? `打开链接：<a href="${escapeHtml(openLink)}">点击预览</a>` : "";
};

const legacyBuildPreviewCopyLines = (openLink?: string, title?: string) => {
  if (!openLink) {
    return [];
  }
  const safeOpenLink = escapeHtml(openLink);
  const plainTitle = stripHtmlTags(title ?? "").trim() || "未命名";
  const safeTitle = escapeHtml(plainTitle);
  return [
    "📎 <b>预览链接（可复制）</b>",
    `<code>预览 - ${safeOpenLink}</code>`,
    "🧾 <b>分享文案（可复制）</b>",
    `<code>${safeTitle}\n\n预览 - ${safeOpenLink}</code>`
  ];
};

const legacyBuildAssetActionLine = (options: {
  username?: string;
  shareCode?: string | null;
  assetId: string;
  canManage: boolean;
}) => {
  const manageCode = `m_${options.assetId}`;
  const manageLink = options.canManage && options.username ? buildStartLink(options.username, manageCode) : undefined;
  const openLink =
    options.shareCode && options.username ? buildStartLink(options.username, `p_${options.shareCode}`) : undefined;
  const line = [
    manageLink ? `<a href="${escapeHtml(manageLink)}">管理</a>` : "",
    openLink ? `<a href="${escapeHtml(openLink)}">点击查看</a>` : ""
  ]
    .filter(Boolean)
    .join(ASSET_ACTION_SEPARATOR);
  return line ? `${ASSET_ACTION_LABEL}：${line}` : "";
};

const toUploadMessage = (message: Message, kind: UploadMessage["kind"]): UploadMessage => {
  const fileId =
    kind === "photo"
      ? message.photo?.[message.photo.length - 1]?.file_id
      : kind === "video"
        ? message.video?.file_id
        : kind === "document"
          ? message.document?.file_id
          : kind === "audio"
            ? message.audio?.file_id
            : kind === "voice"
              ? message.voice?.file_id
              : message.animation?.file_id;
  return {
    messageId: message.message_id,
    chatId: message.chat.id,
    kind,
    mediaGroupId: message.media_group_id ?? undefined,
    fileId: fileId ?? undefined
  };
};

const legacyRegisterMediaHandlers = (
  bot: Bot,
  store: UploadBatchStore,
  isActive: (userId: number, chatId: number) => boolean,
  options?: {
    shouldSkipInactiveHint?: (userId: number, chatId: number, kind: UploadMessage["kind"]) => boolean;
    getInactiveHint?: (userId: number, chatId: number, kind: UploadMessage["kind"]) => string | null;
    getInactiveReplyKeyboard?: (ctx: Context) => Promise<ReplyMarkup | undefined> | ReplyMarkup | undefined;
  }
) => {
  const handle =
    (kind: UploadMessage["kind"]) =>
    async (ctx: Context, next: () => Promise<void>) => {
      if (!ctx.message || !ctx.from || !ctx.chat) {
        return;
      }
      if (!isActive(ctx.from.id, ctx.chat.id)) {
        if (options?.shouldSkipInactiveHint?.(ctx.from.id, ctx.chat.id, kind)) {
          await next();
          return;
        }
        const hint = options?.getInactiveHint?.(ctx.from.id, ctx.chat.id, kind) ?? "请点击 <b>分享</b> 开始接收媒体。";
        const replyKeyboard = options?.getInactiveReplyKeyboard ? await options.getInactiveReplyKeyboard(ctx) : buildMainKeyboard();
        await replyHtml(ctx, hint, {
          reply_markup: replyKeyboard ?? buildMainKeyboard()
        });
        return;
      }
      const batch = store.addMessage(ctx.from.id, ctx.chat.id, toUploadMessage(ctx.message, kind));
      if (batch.messages.length === 1) {
        await replyHtml(ctx, "已接收第 <b>1</b> 个文件。继续发送（可多条/相册），发送完点击 <b>✅ 完成</b> 保存。", {
          reply_markup: actionKeyboard
        });
        return;
      }
      if (batch.messages.length % 10 === 0) {
        const hint = formatReceivedHint(batch.messages.length);
        await replyHtml(ctx, `已接收 <b>${hint}</b> 个文件。继续发送，发送完点击 <b>✅ 完成</b> 保存。`, {
          reply_markup: actionKeyboard
        });
      }
    };

  bot.on("message:photo", handle("photo"));
  bot.on("message:video", handle("video"));
  bot.on("message:document", handle("document"));
  bot.on("message:audio", handle("audio"));
  bot.on("message:voice", handle("voice"));
  bot.on("message:animation", handle("animation"));
};

export const registerTenantBot = (
  bot: Bot,
  store: UploadBatchStore,
  service: UploadService,
  deliveryService: DeliveryService | null
) => {
  const mainKeyboard = buildMainKeyboard();
  const userKeyboard = buildUserKeyboard();
  const isCancelText = (value: string) => {
    const normalized = normalizeButtonText(value).toLowerCase();
    return normalized === "取消" || normalized === "退出" || normalized === "cancel" || normalized === "/cancel";
  };
  const getDefaultKeyboard = async (ctx: Context) => {
    if (!deliveryService || !ctx.from) {
      return mainKeyboard;
    }
    const isTenant = await deliveryService.isTenantUser(String(ctx.from.id)).catch(() => true);
    return isTenant ? mainKeyboard : userKeyboard;
  };
  const resetSessionForCommand = async (ctx: Context) => {
    if (!ctx.from || !ctx.chat) {
      return;
    }
    const key = toMetaKey(ctx.from.id, ctx.chat.id);
    const mode = ensureSessionMode(key);
    if (mode === "upload") {
      await cancel(ctx.from.id, ctx.chat.id);
      setActive(ctx.from.id, ctx.chat.id, false);
    }
    setSessionMode(key, "idle");
  };
  const exitCurrentInputState = async (ctx: Context) => {
    if (!ctx.from || !ctx.chat) {
      return false;
    }
    const key = toMetaKey(ctx.from.id, ctx.chat.id);
    const mode = ensureSessionMode(key);
    if (mode === "idle") {
      const keyboard = await getDefaultKeyboard(ctx);
      await replyHtml(ctx, buildGuideHint("当前没有进行中的输入状态。"), { reply_markup: keyboard });
      return true;
    }
    if (mode === "upload") {
      const result = await cancel(ctx.from.id, ctx.chat.id);
      setActive(ctx.from.id, ctx.chat.id, false);
      const keyboard = await getDefaultKeyboard(ctx);
      await replyHtml(ctx, buildSuccessHint(result.message, "已退出当前输入状态。"), { reply_markup: keyboard });
      return true;
    }
    setSessionMode(key, "idle");
    const keyboard = await getDefaultKeyboard(ctx);
    await replyHtml(ctx, buildSuccessHint(`已退出${getSessionLabel(mode)}。`), { reply_markup: keyboard });
    return true;
  };
  const {
    metaStates,
    adminInputStates,
    settingsInputStates,
    broadcastDraftStates,
    broadcastInputStates,
    collectionStates,
    historyFilterStates,
    historyDateStates,
    historyScopeStates,
    collectionInputStates,
    collectionPickerStates,
    searchStates,
    commentInputStates,
    rankingViewStates,
    getSessionMode,
    getSessionLabel,
    setSessionMode,
    ensureSessionMode,
    syncSessionForView,
    setActive,
    isActive
  } = createTenantSession();
  const { commit, cancel } = createBatchActions(store, service);
  const { openAsset, openShareCode, refreshAssetActions } = createOpenHandler(deliveryService);
  const historyPageSize = 10;
  const maxMetaBytes = 1500;
  const maxTitleBytes = 200;
  const maxDescriptionBytes = 1200;
  const { hydrateUserPreferences } = registerTenantMiddlewares(bot, {
    deliveryService,
    collectionStates,
    historyFilterStates,
    historyDateStates
  });

  const {
    renderStats,
    renderRanking,
    renderHelp,
    renderMy,
    renderFollow,
    renderNotifySettings,
    renderSettings,
    renderVaultSettings,
    renderWelcomeSettings,
    renderAdSettings,
    renderProtectSettings,
    renderHidePublisherSettings,
    renderAutoCategorizeSettings,
    renderRankPublicSettings,
    renderSearchModeSettings,
    renderBroadcast,
    renderBroadcastButtons,
    renderStartHome
  } = createTenantRenderers({
    deliveryService,
    mainKeyboard,
    syncSessionForView,
    broadcastDraftStates,
    rankingViewStates,
    formatLocalDateTime
  });

  function formatLocalDateTime(date: Date) {
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    return `${y}-${m}-${d} ${hh}:${mm}`;
  }

  const { renderComments, handleStartPayload, handleCommentInputText, notifyCommentTargets } = createTenantSocial({
    deliveryService,
    mainKeyboard,
    ensureSessionMode,
    setSessionMode,
    commentInputStates,
    formatLocalDateTime
  });

  const renderFootprint = createFootprintRenderer({
    deliveryService,
    mainKeyboard,
    syncSessionForView,
    formatLocalDateTime,
    buildStartLink
  });

  const renderHistory = createHistoryRenderer({
    deliveryService,
    mainKeyboard,
    syncSessionForView,
    hydrateUserPreferences,
    historyPageSize,
    historyFilterStates,
    historyDateStates,
    historyScopeStates,
    buildAssetActionLine: buildAssetActionLineModule
  });

  const renderSearch = createSearchRenderer({
    deliveryService,
    mainKeyboard,
    buildAssetActionLine: buildAssetActionLineModule
  });

  const { renderTagIndex: renderTagIndexModule, renderTagAssets: renderTagAssetsModule } = createTagRenderers({
    deliveryService,
    mainKeyboard
  });

  const parseLocalDateTime = (value: string) => {
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

  const { handleBroadcastPhoto, handleBroadcastVideo, handleBroadcastDocument, handleBroadcastText, handleSettingsText } =
    createTenantAdminInput({
      deliveryService,
      mainKeyboard,
      isActive,
      getSessionMode,
      setSessionMode,
      broadcastInputStates,
      settingsInputStates,
      parseLocalDateTime,
      renderBroadcast,
      renderBroadcastButtons,
      renderWelcomeSettings,
      renderAdSettings,
      renderAutoCategorizeSettings,
      renderVaultSettings
    });

  const getCollectionTitle = (collections: { id: string; title: string }[], id: string | null) => {
    if (id === null) {
      return "未分类";
    }
    const found = collections.find((c) => c.id === id);
    return found ? stripHtmlTags(found.title) : "未分类";
  };

  const renderCollections = async (ctx: Context, options: { returnTo: "settings" | "upload"; page?: number }) => {
    if (!deliveryService) {
      await replyHtml(ctx, buildDbDisabledHint("管理分类"), { reply_markup: mainKeyboard });
      return;
    }
    await hydrateUserPreferences(ctx);
    if (!ctx.from) {
      await replyHtml(ctx, "⚠️ 无法识别当前用户。", { reply_markup: mainKeyboard });
      return;
    }
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!chatId) {
      await replyHtml(ctx, "⚠️ 无法识别当前会话。", { reply_markup: mainKeyboard });
      return;
    }
    const userId = String(ctx.from.id);
    if (!(await deliveryService.isTenantUser(userId))) {
      await replyHtml(ctx, "🔒 仅租户可使用分类。", { reply_markup: buildHelpKeyboard() });
      return;
    }
    const key = toMetaKey(ctx.from.id, chatId);
    const selectedId = collectionStates.get(key) ?? null;
    const currentPage = options.page ?? collectionPickerStates.get(key)?.page ?? 1;
    const canManage = await deliveryService.canManageCollections(userId);
    const collections = await deliveryService.listCollections();
    const selectedTitle = getCollectionTitle(collections, selectedId);
    const text =
      options.returnTo === "upload"
        ? [
            "<b>📁 选择分类</b>",
            "",
            `当前：<b>${escapeHtml(selectedTitle)}</b>`,
            "选择后将应用到本次储存。"
          ].join("\n")
        : ["<b>📁 分类</b>", "", `当前：<b>${escapeHtml(selectedTitle)}</b>`].join("\n");
    await upsertHtml(ctx, text, buildCollectionsKeyboard({ canManage, selectedId, collections, page: currentPage }));
  };

  const renderUploadStatus = async (ctx: Context) => {
    if (!ctx.from) {
      return;
    }
    await upsertHtml(
      ctx,
      [
        "已开始接收媒体。",
        "请直接发送：照片 / 视频 / 文件 / 音频（支持相册、多条连续发送）。",
        "发送完毕后点击 <b>✅ 完成</b> 保存；如需退出可发送 <code>/cancel</code> 或点 <b>❌ 取消</b>。",
        "",
        "合规提示：禁止发送违法违规内容（含未成年人性相关内容、兽交等）。违规将封禁使用权限。"
      ].join("\n"),
      actionKeyboard
    );
  };

  const startMeta = async (ctx: Context, assetId: string, mode: MetaState["mode"]) => {
    if (!ctx.from || !ctx.chat) {
      return;
    }
    const key = toMetaKey(ctx.from.id, ctx.chat.id);
    metaStates.set(key, { assetId, mode });
    setSessionMode(key, "meta");
    await replyHtml(
      ctx,
      `📝 请发送文字（支持 Telegram HTML）。\n第一行会作为标题并在展示时加粗，其余为描述。\n限制：标题 ≤ <code>${maxTitleBytes}</code>B，描述 ≤ <code>${maxDescriptionBytes}</code>B，总计 ≤ <code>${maxMetaBytes}</code>B。`,
      { reply_markup: buildMetaInputKeyboard() }
    );
  };

  const updateVaultTopicIndexByCollection = async (ctx: Context, collectionId: string | null, collectionTitle: string) => {
    if (!deliveryService) {
      return;
    }
    const vaultChatId = await deliveryService.getPrimaryVaultChatId().catch(() => null);
    if (!vaultChatId) {
      return;
    }
    const chat = await ctx.api.getChat(vaultChatId).catch(() => null);
    const isForum = (chat as { is_forum?: boolean } | null)?.is_forum;
    if (!isForum) {
      return;
    }

    const normalizedTitle = truncatePlainText(stripHtmlTags(collectionTitle).trim() || "未分类", 64);
    let topic = await deliveryService.getCollectionTopic(collectionId).catch(() => null);
    let threadId = topic?.threadId ?? null;
    if (!threadId) {
      const created = await withTelegramRetry(() => ctx.api.createForumTopic(vaultChatId, normalizedTitle));
      threadId = created.message_thread_id;
      await deliveryService
        .setCollectionTopicThreadId(collectionId, threadId)
        .catch((error) => logError({ component: "tenant", op: "set_collection_topic_thread_id", collectionId }, error));
      topic = await deliveryService.getCollectionTopic(collectionId).catch(() => null);
    }
    if (!threadId) {
      return;
    }
    await ctx.api
      .editForumTopic(vaultChatId, threadId, { name: normalizedTitle })
      .catch((error) => logError({ component: "tenant", op: "edit_forum_topic", collectionId, vaultChatId, threadId }, error));

    const botUsername = ctx.me?.username ?? null;
    const items = await deliveryService.listRecentAssetsInCollection(collectionId, 20).catch(() => []);
    const listLines = items.map((item, index) => {
      const plainTitle = truncatePlainText(stripHtmlTags(item.title).trim() || "未命名", 40);
      const plainDesc = truncatePlainText(stripHtmlTags(item.description ?? "").trim().replace(/\s+/g, " "), 60);
      const openLink = item.shareCode && botUsername ? buildStartLink(botUsername, `p_${item.shareCode}`) : null;
      const manageLink = botUsername ? buildStartLink(botUsername, `m_${item.assetId}`) : null;
      const titlePart = openLink ? `<a href="${escapeHtml(openLink)}">${escapeHtml(plainTitle)}</a>` : escapeHtml(plainTitle);
      const linkParts = [
        openLink ? `<a href="${escapeHtml(openLink)}">打开链接</a>` : "",
        item.shareCode ? `哈希：<code>${escapeHtml(item.shareCode)}</code>` : "",
        manageLink ? `<a href="${escapeHtml(manageLink)}">管理</a>` : ""
      ].filter(Boolean);
      const timePart = `<code>${escapeHtml(formatLocalDateTime(item.updatedAt))}</code>`;
      return [
        `${index + 1}. ${titlePart}`,
        plainDesc ? `<blockquote expandable>${escapeHtml(plainDesc)}</blockquote>` : "",
        linkParts.length ? linkParts.join(" · ") : "",
        timePart
      ]
        .filter(Boolean)
        .join("\n");
    });

    const header = `<b>📌 ${escapeHtml(normalizedTitle)} · 索引</b>`;
    const hint = botUsername ? `提示：点击标题可打开；或在机器人里用“列表/搜索”。` : `提示：在机器人里用“列表/搜索”。`;
    const html = [header, "", hint, "", ...listLines].filter(Boolean).join("\n");

    const currentIndexMessageId = topic?.indexMessageId ?? null;
    if (currentIndexMessageId) {
      await ctx.api
        .editMessageText(vaultChatId, currentIndexMessageId, html, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true }
        })
        .catch(async () => {
          await deliveryService
            .setCollectionTopicIndexMessageId(collectionId, null)
            .catch((error) =>
              logError({ component: "tenant", op: "set_collection_topic_index_message_id", collectionId, indexMessageId: null }, error)
            );
        });
      await ctx.api
        .pinChatMessage(vaultChatId, currentIndexMessageId, { disable_notification: true })
        .catch((error) =>
          logError({ component: "tenant", op: "pin_chat_message", collectionId, vaultChatId, messageId: currentIndexMessageId }, error)
        );
      return;
    }

    const sent = await withTelegramRetry(() =>
      ctx.api.sendMessage(vaultChatId, html, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        message_thread_id: threadId
      })
    ).catch(() => null);
    if (!sent) {
      return;
    }
    await ctx.api
      .pinChatMessage(vaultChatId, sent.message_id, { disable_notification: true })
      .catch((error) =>
        logError({ component: "tenant", op: "pin_chat_message", collectionId, vaultChatId, messageId: sent.message_id }, error)
      );
    await deliveryService
      .setCollectionTopicIndexMessageId(collectionId, sent.message_id)
      .catch((error) =>
        logError(
          { component: "tenant", op: "set_collection_topic_index_message_id", collectionId, indexMessageId: sent.message_id },
          error
        )
      );
  };

  const updateVaultTopicIndexByAssetId = async (ctx: Context, assetId: string) => {
    if (!ctx.from || !deliveryService) {
      return;
    }
    const userId = String(ctx.from.id);
    const meta = await deliveryService.getUserAssetMeta(userId, assetId).catch(() => null);
    if (!meta) {
      return;
    }
    const collections = await deliveryService.listCollections().catch(() => []);
    const collectionTitle =
      meta.collectionId === null
        ? "未分类"
        : stripHtmlTags(collections.find((c) => c.id === meta.collectionId)?.title ?? "未分类");
    await updateVaultTopicIndexByCollection(ctx, meta.collectionId, collectionTitle);
  };

  const handleMetaInput = async (ctx: Context, text: string) => {
    if (!ctx.from || !ctx.chat) {
      return false;
    }
    const key = toMetaKey(ctx.from.id, ctx.chat.id);
    const mode = ensureSessionMode(key);
    if (mode !== "meta") {
      return false;
    }
    const state = metaStates.get(key);
    if (!state) {
      return false;
    }
    const normalizedCommand = normalizeButtonText(text);
    const command = normalizedCommand === "关注" ? "我的" : normalizedCommand;
    if (command === "分享" || command === "储存" || command === "完成" || command === "列表") {
      await replyHtml(ctx, buildInputExitHint("编辑标题/描述", { afterExitHtml: "继续编辑标题/描述。"}), { reply_markup: buildMetaInputKeyboard() });
      return true;
    }
    if (!text.trim()) {
      await replyHtml(ctx, "📝 请输入标题与描述（第一行标题，其余为描述，支持 Telegram HTML）。");
      return true;
    }
    const lines = text.split(/\r?\n/);
    const title = lines[0]?.trim() || "未命名";
    const description = lines.slice(1).join("\n").trim();
    const totalBytes = utf8ByteLength(text);
    const titleBytes = utf8ByteLength(title);
    const descriptionBytes = utf8ByteLength(description);
    if (titleBytes > maxTitleBytes || descriptionBytes > maxDescriptionBytes || totalBytes > maxMetaBytes) {
      await replyHtml(
        ctx,
        `⚠️ 内容太长，请精简后再发送。\n标题 <code>${titleBytes}</code>/${maxTitleBytes}B，描述 <code>${descriptionBytes}</code>/${maxDescriptionBytes}B，总计 <code>${totalBytes}</code>/${maxMetaBytes}B。`
      );
      return true;
    }
    const actorUserId = String(ctx.from.id);
    try {
      const safeTitle = sanitizeTelegramHtml(title);
      const safeDescription = sanitizeTelegramHtml(description);
      const prevMeta = deliveryService ? await deliveryService.getUserAssetMeta(actorUserId, state.assetId).catch(() => null) : null;
      const result = await service.updateAssetMeta(state.assetId, {
        title: safeTitle,
        description: safeDescription
      });
      if (deliveryService) {
        const nextMeta = await deliveryService.getUserAssetMeta(actorUserId, state.assetId).catch(() => null);
        if (prevMeta && nextMeta && prevMeta.collectionId !== nextMeta.collectionId) {
          const collections = await deliveryService.listCollections().catch(() => []);
          const titleOf = (id: string | null) => {
            if (id === null) {
              return "未分类";
            }
            return stripHtmlTags(collections.find((c) => c.id === id)?.title ?? "未分类");
          };
          void updateVaultTopicIndexByCollection(ctx, prevMeta.collectionId, titleOf(prevMeta.collectionId)).catch((error) =>
            logError({ component: "tenant", op: "update_vault_topic_index", scope: "prev_collection", assetId: state.assetId }, error)
          );
          void updateVaultTopicIndexByCollection(ctx, nextMeta.collectionId, titleOf(nextMeta.collectionId)).catch((error) =>
            logError({ component: "tenant", op: "update_vault_topic_index", scope: "next_collection", assetId: state.assetId }, error)
          );
        } else {
          void updateVaultTopicIndexByAssetId(ctx, state.assetId).catch((error) =>
            logError({ component: "tenant", op: "update_vault_topic_index", scope: "asset", assetId: state.assetId }, error)
          );
        }
      }
      const username = ctx.me?.username;
      const openCode = result.shareCode;
      const openLink = username ? buildStartLink(username, `p_${openCode}`) : undefined;
      const manageCode = `m_${state.assetId}`;
      const manageLink = username ? buildStartLink(username, manageCode) : undefined;
      const message =
        state.mode === "edit"
          ? [
              "✅ <b>已更新</b>",
              "",
              `🔑 打开哈希：<code>${escapeHtml(openCode)}</code>`,
              ...buildPreviewCopyLines(openLink, title),
              "",
              manageLink ? `🛠 管理：<a href="${escapeHtml(manageLink)}">点击进入管理</a>` : ""
            ]
              .filter(Boolean)
              .join("\n")
          : [
              "✅ <b>已保存</b>",
              "",
              `🔑 打开哈希：<code>${escapeHtml(openCode)}</code>`,
              ...buildPreviewCopyLines(openLink, title),
              "",
              manageLink ? `🛠 管理：<a href="${escapeHtml(manageLink)}">点击进入管理</a>` : "",
              "",
              "<i>提示：管理入口用于后续修改标题、描述与状态。</i>"
            ]
              .filter(Boolean)
              .join("\n");
      await replyHtml(ctx, message, { reply_markup: buildManageKeyboard(state.assetId, { searchable: true, recycled: false }) });
    } catch (error) {
      logError({ component: "bot", op: "meta_save", assetId: state.assetId, userId: actorUserId }, error);
      await replyHtml(ctx, "❌ 保存标题/描述失败，请稍后重试。");
    } finally {
      setSessionMode(key, "idle");
    }
    return true;
  };

  const trackStartPayloadVisit = async (
    ctx: Context,
    payload: string,
    entry: StartPayloadEntry,
    status: StartPayloadStatus,
    reason?: string
  ) => {
    if (!deliveryService || !ctx.from) {
      return;
    }
    await deliveryService
      .trackVisit(String(ctx.from.id), "start_payload", {
        entry,
        payloadKind: detectStartPayloadKind(payload),
        status,
        reason: reason ?? null
      })
      .catch((error) =>
        logErrorThrottled(
          { component: "tenant", op: "track_visit", scope: "start_payload" },
          error,
          { intervalMs: 30_000 }
        )
      );
  };

  const handleStartPayloadEntry = async (ctx: Context, payload: string, entry: StartPayloadEntry) => {
    if (await handleStartPayload(ctx, payload)) {
      await trackStartPayloadVisit(ctx, payload, entry, "routed_social");
      return true;
    }
    if (payload.startsWith("p_")) {
      const raw = payload.slice(2);
      const lastUnderscore = raw.lastIndexOf("_");
      const parsedPage = lastUnderscore > 0 ? Number(raw.slice(lastUnderscore + 1)) : NaN;
      const hasPage = Number.isFinite(parsedPage) && parsedPage >= 1;
      const page = hasPage ? parsedPage : 1;
      const shareCode = lastUnderscore > 0 && hasPage ? raw.slice(0, lastUnderscore) : raw;
      if (!shareCode.trim()) {
        await replyHtml(ctx, "⚠️ 链接参数无效，请重新获取预览链接。");
        await trackStartPayloadVisit(ctx, payload, entry, "failed", "empty_share_code");
        return true;
      }
      const openResult = await openShareCode(ctx, shareCode, page);
      if (openResult === "opened") {
        await trackStartPayloadVisit(ctx, payload, entry, "opened");
      } else {
        await trackStartPayloadVisit(ctx, payload, entry, "failed", openResult);
      }
      return true;
    }
    if (payload.startsWith("m_")) {
      const assetId = payload.slice(2);
      if (!ctx.from) {
        await trackStartPayloadVisit(ctx, payload, entry, "failed", "missing_user");
        return true;
      }
      if (!deliveryService) {
        await replyHtml(ctx, buildDbDisabledHint("进入管理"));
        await trackStartPayloadVisit(ctx, payload, entry, "failed", "db_disabled");
        return true;
      }
      const meta = await deliveryService.getUserAssetMeta(String(ctx.from.id), assetId);
      if (!meta) {
        await replyHtml(ctx, "🔒 无权限或内容不存在。");
        await trackStartPayloadVisit(ctx, payload, entry, "failed", "forbidden_or_missing");
        return true;
      }
      const collections = await deliveryService.listCollections().catch(() => []);
      const collectionTitle =
        meta.collectionId === null ? "未分类" : stripHtmlTags(collections.find((c) => c.id === meta.collectionId)?.title ?? "未分类");
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
      await replyHtml(ctx, lines, { reply_markup: buildManageKeyboard(meta.assetId, { searchable: meta.searchable, recycled: isRecycled }) });
      await trackStartPayloadVisit(ctx, payload, entry, "opened");
      return true;
    }
    const openResult = await openShareCode(ctx, payload, 1);
    if (openResult === "opened") {
      await trackStartPayloadVisit(ctx, payload, entry, "opened");
    } else {
      await trackStartPayloadVisit(ctx, payload, entry, "failed", openResult);
    }
    return true;
  };

  registerMediaHandlersModule(bot, store, isActive, {
    shouldSkipInactiveHint: (userId, chatId, kind) => {
      const key = toMetaKey(userId, chatId);
      const mode = ensureSessionMode(key);
      if (mode !== "broadcastInput") {
        return false;
      }
      return kind === "photo" || kind === "video" || kind === "document";
    },
    getInactiveHint: (userId, chatId, kind) => {
      const key = toMetaKey(userId, chatId);
      const mode = ensureSessionMode(key);
      if (mode === "broadcastInput") {
        if (kind === "photo" || kind === "video" || kind === "document") {
          return null;
        }
        return "⚠️ 推送仅支持 <b>照片/视频/文件</b>。请发送其中一种；如需退出请发送 <code>/cancel</code> 或点击 <b>❌ 取消</b>。";
      }
      if (mode !== "idle" && mode !== "upload") {
        return buildInputExitHint(getSessionLabel(mode), { afterExitHtml: "再发送媒体或点击 <b>分享</b>。" });
      }
      return null;
    },
    getInactiveReplyKeyboard: async (ctx) => {
      return getDefaultKeyboard(ctx);
    }
  });

  const renderManagePanel = async (ctx: Context, assetId: string) => {
    syncSessionForView(ctx);
    if (!deliveryService) {
      await replyHtml(ctx, buildDbDisabledHint("进入管理"), { reply_markup: mainKeyboard });
      return;
    }
    if (!ctx.from) {
      await replyHtml(ctx, "⚠️ 无法识别当前用户。", { reply_markup: mainKeyboard });
      return;
    }
    const meta = await deliveryService.getUserAssetMeta(String(ctx.from.id), assetId);
    if (!meta) {
      await replyHtml(ctx, "🔒 无权限或内容不存在。", { reply_markup: buildHelpKeyboard() });
      return;
    }
    const collections = await deliveryService.listCollections().catch(() => []);
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

  registerTenantCommands(bot, {
    deliveryService,
    resetSessionForCommand,
    trackStartPayloadVisit,
    handleStartPayloadEntry,
    renderStartHome,
    renderHelp,
    exitCurrentInputState,
    renderFootprint
  });

  const buildTagAssetsKeyboard = (tagId: string, currentPage: number, totalPages: number) => {
    const keyboard = new InlineKeyboard();
    if (totalPages > 1) {
      if (currentPage > 1) {
        keyboard.text("⬅️ 上一页", safeCallbackData(`tag:page:${tagId}:${currentPage - 1}`, "asset:noop"));
      }
      if (currentPage < totalPages) {
        keyboard.text("下一页 ➡️", safeCallbackData(`tag:page:${tagId}:${currentPage + 1}`, "asset:noop"));
      }
      keyboard.row().text("🔄 刷新", safeCallbackData(`tag:refresh:${tagId}:${currentPage}`, "asset:noop"));
    } else {
      keyboard.row().text("🔄 刷新", safeCallbackData(`tag:refresh:${tagId}:1`, "asset:noop"));
    }
    keyboard.row().text("🏷 标签", "tags:show").text("📚 列表", "help:list").text("🏠 首页", "home:back");
    return keyboard;
  };

  const buildTagIndexKeyboard = (items: { tagId: string; name: string }[]) => {
    const keyboard = new InlineKeyboard();
    for (const item of items.slice(0, 20)) {
      keyboard.row().text(`#${item.name}`, safeCallbackData(`tag:open:${item.tagId}:1`, "asset:noop"));
    }
    keyboard.row().text("🔄 刷新", "tags:refresh").text("📚 列表", "help:list").text("🏠 首页", "home:back");
    return keyboard;
  };

  const renderTagIndex = async (ctx: Context, mode: "reply" | "edit") => {
    if (!deliveryService) {
      await replyHtml(ctx, buildDbDisabledHint("查看标签"), { reply_markup: mainKeyboard });
      return;
    }
    if (!ctx.from) {
      await replyHtml(ctx, "⚠️ 无法识别当前用户。", { reply_markup: mainKeyboard });
      return;
    }
    const userId = String(ctx.from.id);
    const searchMode = await deliveryService.getTenantSearchMode().catch(() => "ENTITLED_ONLY" as const);
    if (searchMode === "OFF") {
      await replyHtml(ctx, "🔒 租户已关闭搜索。", { reply_markup: buildHelpKeyboard() });
      return;
    }
    const isTenant = await deliveryService.isTenantUser(userId).catch(() => false);
    const canManageViewer = isTenant ? await deliveryService.canManageAdmins(userId).catch(() => false) : false;
    if (!isTenant) {
      if (searchMode !== "PUBLIC") {
        await replyHtml(ctx, "🔒 租户未开放搜索。", { reply_markup: buildHelpKeyboard() });
        return;
      }
    }
    const items = await deliveryService.listTopTags(50).catch(() => []);
    const content =
      items.length === 0
        ? "📭 暂无标签。\n发布内容时在标题/描述里写 <code>#标签</code>，保存后会自动归档。"
        : items
            .slice(0, 20)
            .map((t, i) => `${i + 1}. <b>#${escapeHtml(t.name)}</b>（${t.count}）`)
            .join("\n");
    const text = ["<b>🏷 标签</b>", "", "发送 <code>#标签</code> 可查看合集。", "", content].join("\n");
    const keyboard = buildTagIndexKeyboard(items);
    if (mode === "edit") {
      await editHtml(ctx, text, { reply_markup: keyboard });
    } else {
      await replyHtml(ctx, text, { reply_markup: keyboard });
    }
  };

  const renderTagAssets = async (ctx: Context, tagId: string, page: number, mode: "reply" | "edit") => {
    if (!deliveryService) {
      await replyHtml(ctx, buildDbDisabledHint("查看标签"), { reply_markup: mainKeyboard });
      return;
    }
    if (!ctx.from) {
      await replyHtml(ctx, "⚠️ 无法识别当前用户。", { reply_markup: mainKeyboard });
      return;
    }
    const userId = String(ctx.from.id);
    const searchMode = await deliveryService.getTenantSearchMode().catch(() => "ENTITLED_ONLY" as const);
    if (searchMode === "OFF") {
      await replyHtml(ctx, "🔒 租户已关闭搜索。", { reply_markup: buildHelpKeyboard() });
      return;
    }
    const isTenant = await deliveryService.isTenantUser(userId).catch(() => false);
    const canManageViewer = isTenant ? await deliveryService.canManageAdmins(userId).catch(() => false) : false;
    if (!isTenant) {
      if (searchMode !== "PUBLIC") {
        await replyHtml(ctx, "🔒 租户未开放搜索。", { reply_markup: buildHelpKeyboard() });
        return;
      }
    }
    const tag = await deliveryService.getTagById(tagId).catch(() => null);
    if (!tag) {
      const text = "⚠️ 标签不存在或已删除。";
      if (mode === "edit") {
        await editHtml(ctx, text, { reply_markup: new InlineKeyboard().text("🏷 标签", "tags:show") });
      } else {
        await replyHtml(ctx, text, { reply_markup: new InlineKeyboard().text("🏷 标签", "tags:show") });
      }
      return;
    }
    const safePage = Number.isFinite(page) ? page : 1;
    const pageSize = 10;
    const data = await deliveryService.listAssetsByTagId(userId, tagId, safePage, pageSize).catch(() => null);
    if (!data || data.total === 0) {
      const text = `🔎 未找到内容：<code>#${escapeHtml(tag.name)}</code>`;
      const keyboard = buildTagAssetsKeyboard(tagId, 1, 1);
      if (mode === "edit") {
        await editHtml(ctx, text, { reply_markup: keyboard });
      } else {
        await replyHtml(ctx, text, { reply_markup: keyboard });
      }
      return;
    }
    const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
    const currentPage = Math.min(Math.max(safePage, 1), totalPages);
    const username = ctx.me?.username;
    const content = data.items
      .map((item) => {
        const safeTitle = sanitizeTelegramHtml(item.title);
        const titleLine = safeTitle ? `<b>${safeTitle}</b>` : "";
        const actionLine = buildAssetActionLineModule({
          username,
          shareCode: item.shareCode,
          assetId: item.assetId,
          canManage: canManageViewer
        });
        return [titleLine, actionLine].filter(Boolean).join("\n");
      })
      .filter(Boolean)
      .join("\n\n");
    const text = `🏷 标签：<code>#${escapeHtml(tag.name)}</code>\n（第 ${currentPage}/${totalPages} 页，共 ${data.total} 条）\n\n${content}`;
    const keyboard = buildTagAssetsKeyboard(tagId, currentPage, totalPages);
    if (mode === "edit") {
      await editHtml(ctx, text, { reply_markup: keyboard });
    } else {
      await replyHtml(ctx, text, { reply_markup: keyboard });
    }
  };

  registerTenantCallbackRoutes(bot, {
    services: {
      deliveryService,
      uploadService: service,
      batchActions: { commit, cancel }
    },
    session: {
      mainKeyboard,
      historyPageSize,
      getSessionMode,
      setSessionMode,
      isActive,
      syncSessionForView,
      hydrateUserPreferences,
      formatLocalDateTime
    },
    states: {
      settingsInputStates,
      adminInputStates,
      broadcastInputStates,
      broadcastDraftStates,
      collectionStates,
      historyFilterStates,
      historyDateStates,
      historyScopeStates,
      collectionInputStates,
      collectionPickerStates,
      searchStates,
      commentInputStates,
      rankingViewStates
    },
    renderers: {
      renderUploadStatus,
      renderManagePanel,
      startMeta,
      renderComments,
      openAsset,
      refreshAssetActions,
      renderFootprint,
      renderHistory,
      renderSearch,
       renderTagIndex: renderTagIndexModule,
       renderTagAssets: renderTagAssetsModule,
      renderCollections,
      renderHelp,
      renderMy,
      renderFollow,
      renderNotifySettings,
      renderSettings,
      renderWelcomeSettings,
      renderAdSettings,
      renderProtectSettings,
      renderHidePublisherSettings,
      renderAutoCategorizeSettings,
      renderRankPublicSettings,
      renderSearchModeSettings,
      renderVaultSettings,
      renderBroadcast,
      renderBroadcastButtons,
      renderStartHome,
      renderStats,
      renderRanking
    }
  });

  registerTenantMessageHandlers(bot, {
    deliveryService,
    mainKeyboard,
    getDefaultKeyboard,
    isCancelText,
    exitCurrentInputState,
    handleMetaInput,
    handleBroadcastPhoto,
    handleBroadcastVideo,
    handleBroadcastDocument,
    handleBroadcastText,
    handleSettingsText,
    handleCommentInputText,
    notifyCommentTargets,
    renderComments,
    renderFollow,
    renderHistory,
    renderSearch,
    renderFootprint,
    renderMy,
    renderSettings,
    renderTagIndex,
    renderTagAssets,
    renderUploadStatus,
    renderCollections,
    openShareCode,
    trackStartPayloadVisit,
    handleStartPayloadEntry,
    getSessionMode,
    ensureSessionMode,
    setSessionMode,
    setActive,
    historyScopeStates,
    historyDateStates,
    searchStates,
    collectionInputStates,
    adminInputStates,
    commentInputStates,
    updateVaultTopicIndexByCollection
  });
};
