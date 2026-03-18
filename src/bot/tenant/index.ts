import { InlineKeyboard } from "grammy";
import type { Bot, Context } from "grammy";
import type { Message } from "grammy/types";
import { withTelegramRetry } from "../../infra/telegram";
import type { DeliveryService, UploadMessage, UploadService } from "../../services/use-cases";
import { createUploadBatchStore } from "../../services/use-cases";
import {
  buildPublisherLine,
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
import { createTenantRenderers } from "./renderers";
import { registerTenantCallbackRoutes } from "./callbacks";
import { createBatchActions } from "./batch-actions";
import { createOpenHandler } from "./open";
import { createTenantSession, type MetaState } from "./session";
import { createTenantSocial } from "./social";
import { createTenantAdminInput } from "./admin-input";
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

type UploadBatchStore = ReturnType<typeof createUploadBatchStore>;

const formatReceivedHint = (count: number) => {
  if (count < 10) {
    return String(count);
  }
  const base = Math.floor(count / 10) * 10;
  return `${base}+`;
};

const ASSET_ACTION_LABEL = "操作";
const ASSET_ACTION_SEPARATOR = " ｜ ";

export const buildAssetActionLine = (options: {
  username?: string;
  shareCode?: string | null;
  assetId: string;
  canManage: boolean;
}) => {
  const manageCode = `m_${options.assetId}`;
  const manageLink = options.canManage && options.username ? `https://t.me/${options.username}?start=${manageCode}` : undefined;
  const openLink =
    options.shareCode && options.username ? `https://t.me/${options.username}?start=${encodeURIComponent(options.shareCode)}` : undefined;
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

const registerMediaHandlers = (
  bot: Bot,
  store: UploadBatchStore,
  isActive: (userId: number, chatId: number) => boolean,
  options?: {
    shouldSkipInactiveHint?: (userId: number, chatId: number, kind: UploadMessage["kind"]) => boolean;
    getInactiveHint?: (userId: number, chatId: number, kind: UploadMessage["kind"]) => string | null;
    getInactiveReplyKeyboard?: (ctx: Context) => Promise<unknown> | unknown;
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
          reply_markup: replyKeyboard as never
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

  bot.use(async (ctx, next) => {
    if (deliveryService && ctx.from) {
      await deliveryService
        .upsertTenantUserFromTelegram({
          id: ctx.from.id,
          is_bot: ctx.from.is_bot,
          first_name: ctx.from.first_name,
          last_name: ctx.from.last_name,
          username: ctx.from.username,
          language_code: ctx.from.language_code
        })
        .catch(() => undefined);
    }
    await next();
  });

  const hydrateUserPreferences = async (ctx: Context) => {
    if (!deliveryService || !ctx.from) {
      return;
    }
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!chatId) {
      return;
    }
    const key = toMetaKey(ctx.from.id, chatId);
    const userId = String(ctx.from.id);
    const tasks: Promise<void>[] = [];
    if (!collectionStates.has(key)) {
      tasks.push(
        deliveryService
          .getUserDefaultCollectionId(userId)
          .then((value) => {
            collectionStates.set(key, value);
          })
          .catch(() => undefined)
      );
    }
    if (!historyFilterStates.has(key)) {
      tasks.push(
        deliveryService
          .getUserHistoryCollectionFilter(userId)
          .then((value) => {
            historyFilterStates.set(key, value);
          })
          .catch(() => undefined)
      );
    }
    if (!historyDateStates.has(key)) {
      tasks.push(
        deliveryService
          .getUserHistoryListDate(userId)
          .then((value) => {
            if (value) {
              historyDateStates.set(key, value);
            }
          })
          .catch(() => undefined)
      );
    }
    if (tasks.length > 0) {
      await Promise.all(tasks);
    }
  };

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
      await replyHtml(ctx, "⚠️ 当前未启用数据库，无法管理分类。", { reply_markup: mainKeyboard });
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
      await deliveryService.setCollectionTopicThreadId(collectionId, threadId).catch(() => undefined);
      topic = await deliveryService.getCollectionTopic(collectionId).catch(() => null);
    }
    if (!threadId) {
      return;
    }
    await ctx.api.editForumTopic(vaultChatId, threadId, { name: normalizedTitle }).catch(() => undefined);

    const botUsername = ctx.me?.username ?? null;
    const items = await deliveryService.listRecentAssetsInCollection(collectionId, 20).catch(() => []);
    const listLines = items.map((item, index) => {
      const plainTitle = truncatePlainText(stripHtmlTags(item.title).trim() || "未命名", 40);
      const plainDesc = truncatePlainText(stripHtmlTags(item.description ?? "").trim().replace(/\s+/g, " "), 60);
      const openLink = item.shareCode && botUsername ? `https://t.me/${botUsername}?start=${encodeURIComponent(item.shareCode)}` : null;
      const manageLink = botUsername ? `https://t.me/${botUsername}?start=m_${encodeURIComponent(item.assetId)}` : null;
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
          await deliveryService.setCollectionTopicIndexMessageId(collectionId, null).catch(() => undefined);
        });
      await ctx.api.pinChatMessage(vaultChatId, currentIndexMessageId, { disable_notification: true }).catch(() => undefined);
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
    await ctx.api.pinChatMessage(vaultChatId, sent.message_id, { disable_notification: true }).catch(() => undefined);
    await deliveryService.setCollectionTopicIndexMessageId(collectionId, sent.message_id).catch(() => undefined);
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
    try {
      const safeTitle = sanitizeTelegramHtml(title);
      const safeDescription = sanitizeTelegramHtml(description);
      const actorUserId = String(ctx.from.id);
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
          void updateVaultTopicIndexByCollection(ctx, prevMeta.collectionId, titleOf(prevMeta.collectionId)).catch(() => undefined);
          void updateVaultTopicIndexByCollection(ctx, nextMeta.collectionId, titleOf(nextMeta.collectionId)).catch(() => undefined);
        } else {
          void updateVaultTopicIndexByAssetId(ctx, state.assetId).catch(() => undefined);
        }
      }
      const username = ctx.me?.username;
      const openCode = result.shareCode;
      const openLink = username ? `https://t.me/${username}?start=${openCode}` : undefined;
      const manageCode = `m_${state.assetId}`;
      const manageLink = username ? `https://t.me/${username}?start=${manageCode}` : undefined;
      const message =
        state.mode === "edit"
          ? [
              "✅ 已更新",
              "",
              "打开哈希：",
              `<code>${escapeHtml(openCode)}</code>`,
              openLink ? "打开链接：" : "",
              openLink ? `<code>预览 - ${escapeHtml(openLink)}</code>` : "",
              "",
              manageLink ? `管理：<a href="${escapeHtml(manageLink)}">管理</a>` : ""
            ]
              .filter(Boolean)
              .join("\n")
          : [
              "✅ 已保存",
              "",
              "打开哈希：",
              `<code>${escapeHtml(openCode)}</code>`,
              openLink ? "打开链接：" : "",
              openLink ? `<code>预览 - ${escapeHtml(openLink)}</code>` : "",
              "",
              manageLink ? `管理：<a href="${escapeHtml(manageLink)}">管理</a>` : "",
              "",
              "提示：管理用于后续修改。"
            ]
              .filter(Boolean)
              .join("\n");
      await replyHtml(ctx, message, { reply_markup: buildManageKeyboard(state.assetId, { searchable: true, recycled: false }) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown error");
      console.error("[meta:save]", message);
      await replyHtml(ctx, "❌ 保存标题/描述失败，请稍后重试。");
    } finally {
      setSessionMode(key, "idle");
    }
    return true;
  };

  const handleStartPayloadEntry = async (ctx: Context, payload: string) => {
    if (await handleStartPayload(ctx, payload)) {
      return true;
    }
    if (payload.startsWith("p_")) {
      const raw = payload.slice(2);
      const lastUnderscore = raw.lastIndexOf("_");
      const parsedPage = lastUnderscore > 0 ? Number(raw.slice(lastUnderscore + 1)) : NaN;
      const hasPage = Number.isFinite(parsedPage) && parsedPage >= 1;
      const page = hasPage ? parsedPage : 1;
      const shareCode = lastUnderscore > 0 && hasPage ? raw.slice(0, lastUnderscore) : raw;
      await openShareCode(ctx, shareCode, page);
      return true;
    }
    if (payload.startsWith("m_")) {
      const assetId = payload.slice(2);
      if (!ctx.from) {
        return true;
      }
      if (!deliveryService) {
        await replyHtml(ctx, "⚠️ 当前未启用数据库，无法进入管理。");
        return true;
      }
      const meta = await deliveryService.getUserAssetMeta(String(ctx.from.id), assetId);
      if (!meta) {
        await replyHtml(ctx, "🔒 无权限或内容不存在。");
        return true;
      }
      const collections = await deliveryService.listCollections().catch(() => []);
      const collectionTitle =
        meta.collectionId === null ? "未分类" : stripHtmlTags(collections.find((c) => c.id === meta.collectionId)?.title ?? "未分类");
      const username = ctx.me?.username;
      const manageCode = `m_${meta.assetId}`;
      const manageLink = username ? `https://t.me/${username}?start=${manageCode}` : undefined;
      const safeTitle = sanitizeTelegramHtml(meta.title);
      const safeDesc = meta.description ? sanitizeTelegramHtml(meta.description) : "";
      const openLink = meta.shareCode ? (username ? `https://t.me/${username}?start=${meta.shareCode}` : undefined) : undefined;
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
        openLink ? `打开链接：<code>预览 - ${escapeHtml(openLink)}</code>` : ""
      ]
        .filter(Boolean)
        .join("\n");
      await replyHtml(ctx, lines, { reply_markup: buildManageKeyboard(meta.assetId, { searchable: meta.searchable, recycled: isRecycled }) });
      return true;
    }
    await openShareCode(ctx, payload, 1);
    return true;
  };

  bot.command("start", async (ctx) => {
    const payload = ctx.match?.trim();
    if (deliveryService && ctx.from) {
      await deliveryService.trackVisit(String(ctx.from.id), payload ? "start_payload" : "start").catch(() => undefined);
    }
    if (payload) {
      await handleStartPayloadEntry(ctx, payload);
      return;
    }
    await renderStartHome(ctx);
  });

  bot.command("help", async (ctx) => {
    if (deliveryService && ctx.from) {
      await deliveryService.trackVisit(String(ctx.from.id), "help").catch(() => undefined);
    }
    await renderHelp(ctx);
  });

  bot.command("cancel", async (ctx) => {
    await exitCurrentInputState(ctx);
  });

  registerMediaHandlers(bot, store, isActive, {
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
      await replyHtml(ctx, "⚠️ 当前未启用数据库，无法进入管理。", { reply_markup: mainKeyboard });
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
    const manageLink = username ? `https://t.me/${username}?start=${manageCode}` : undefined;
    const safeTitle = sanitizeTelegramHtml(meta.title);
    const safeDesc = meta.description ? sanitizeTelegramHtml(meta.description) : "";
    const openLink = meta.shareCode ? (username ? `https://t.me/${username}?start=${meta.shareCode}` : undefined) : undefined;
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
      openLink ? `打开链接：<code>预览 - ${escapeHtml(openLink)}</code>` : ""
    ]
      .filter(Boolean)
      .join("\n");
    await upsertHtml(ctx, lines, buildManageKeyboard(meta.assetId, { searchable: meta.searchable, recycled: isRecycled }));
  };

  const renderFootprint = async (
    ctx: Context,
    tab: "open" | "like" | "comment" | "reply",
    range: "7d" | "30d" | "all",
    page: number,
    mode: "reply" | "edit",
    showMoreActions = false
  ) => {
    if (!ctx.from) {
      return;
    }
    syncSessionForView(ctx);
    if (!deliveryService) {
      const message = "⚠️ 当前未启用数据库，无法查看足迹。";
      if (mode === "edit") {
        await editHtml(ctx, message).catch(async () => replyHtml(ctx, message));
      } else {
        await replyHtml(ctx, message, { reply_markup: mainKeyboard });
      }
      return;
    }
    const pageSize = 10;
    const userId = String(ctx.from.id);
    const username = ctx.me?.username;
    const since =
      range === "7d"
        ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        : range === "30d"
          ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          : undefined;
    let data = await (async () => {
      if (tab === "open") {
        const result = await deliveryService.listUserOpenHistory(userId, page, pageSize, { since });
        return { total: result.total, items: result.items.map((i) => ({ ...i, at: i.openedAt })) };
      }
      if (tab === "like") {
        const result = await deliveryService.listUserLikedAssets(userId, page, pageSize, { since });
        return { total: result.total, items: result.items.map((i) => ({ ...i, at: i.likedAt })) };
      }
      const kind = tab === "reply" ? "reply" : "comment";
      const result = await deliveryService.listUserComments(userId, kind, page, pageSize, { since });
      return { total: result.total, items: result.items.map((i) => ({ ...i, at: i.createdAt })) };
    })();
    const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
    const currentPage = Math.min(Math.max(page, 1), totalPages);
    if (data.total > 0 && data.items.length === 0 && currentPage !== page) {
      data = await (async () => {
        if (tab === "open") {
          const result = await deliveryService.listUserOpenHistory(userId, currentPage, pageSize, { since });
          return { total: result.total, items: result.items.map((i) => ({ ...i, at: i.openedAt })) };
        }
        if (tab === "like") {
          const result = await deliveryService.listUserLikedAssets(userId, currentPage, pageSize, { since });
          return { total: result.total, items: result.items.map((i) => ({ ...i, at: i.likedAt })) };
        }
        const kind = tab === "reply" ? "reply" : "comment";
        const result = await deliveryService.listUserComments(userId, kind, currentPage, pageSize, { since });
        return { total: result.total, items: result.items.map((i) => ({ ...i, at: i.createdAt })) };
      })();
    }
    const tabTitle = tab === "open" ? "最近浏览" : tab === "like" ? "点赞" : tab === "comment" ? "评论" : "回复";
    const rangeTitle = range === "7d" ? "近7天" : range === "30d" ? "近30天" : "全部";
    if (data.total === 0) {
      const message =
        tab === "open"
          ? "📭 暂无最近浏览。"
          : tab === "like"
            ? "📭 暂无点赞。"
            : tab === "comment"
              ? "📭 暂无评论。"
              : "📭 暂无回复。";
      await upsertHtml(
        ctx,
        `<b>👣 足迹｜${tabTitle}（${rangeTitle}）</b>\n\n${message}`,
        buildFootprintKeyboard({ tab, range, page: 1, totalPages: 1 }, showMoreActions)
      );
      return;
    }
    const slice = data.items.slice(0, pageSize);
    const content = (
      await Promise.all(
        slice.map(async (item, index) => {
          const order = (currentPage - 1) * pageSize + index + 1;
          const titleText = escapeHtml(stripHtmlTags((item as { title: string }).title));
          const shareCode = (item as { shareCode: string | null }).shareCode;
          const openLink =
            shareCode && username ? `https://t.me/${username}?start=${encodeURIComponent(shareCode)}` : undefined;
          const titleLine = `<b>${order}. ${titleText}</b>`;
          const openLine = openLink ? `打开：<a href="${escapeHtml(openLink)}">点击查看</a>` : "";
          const at = (item as { at: Date }).at;
          const timeLabel = tab === "open" ? "浏览" : tab === "like" ? "点赞" : tab === "comment" ? "评论" : "回复";
          const timeLine = `${timeLabel}：<b>${escapeHtml(formatLocalDateTime(at))}</b>`;
          return [
            titleLine,
            openLine,
            timeLine,
          ]
            .filter(Boolean)
            .join("\n");
        })
      )
    ).join("\n\n");
    await upsertHtml(
      ctx,
      [`<b>👣 足迹｜${tabTitle}（${rangeTitle}，每页 10 条）</b>`, "", content].join("\n"),
      buildFootprintKeyboard({ tab, range, page: currentPage, totalPages }, showMoreActions)
    );
  };

  bot.command("history", async (ctx) => {
    await renderFootprint(ctx, "open", "30d", 1, "reply");
  });

  const renderHistory = async (ctx: Context, page: number, scope?: "community" | "mine", showMoreActions = false) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      return;
    }
    syncSessionForView(ctx);
    if (!deliveryService) {
      await replyHtml(ctx, "⚠️ 当前未启用数据库，无法查看历史。", { reply_markup: mainKeyboard });
      return;
    }
    await hydrateUserPreferences(ctx);
    const filterKey = toMetaKey(ctx.from.id, chatId);
    const filter = historyFilterStates.get(filterKey);
    const startOfLocalDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const pad2 = (value: number) => String(value).padStart(2, "0");
    const formatLocalDate = (date: Date) =>
      `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    const selectedScope = scope ?? historyScopeStates.get(filterKey) ?? "community";
    historyScopeStates.set(filterKey, selectedScope);
    const selectedDate = historyDateStates.get(filterKey) ?? startOfLocalDay(new Date());
    if (!historyDateStates.has(filterKey)) {
      historyDateStates.set(filterKey, selectedDate);
    }
    await deliveryService.setUserHistoryListDate(String(ctx.from.id), selectedDate).catch(() => undefined);
    let data =
      selectedScope === "mine"
        ? await deliveryService.listUserBatches(String(ctx.from.id), page, historyPageSize, {
            collectionId: filter,
            date: selectedDate
          })
        : await deliveryService.listTenantBatches(String(ctx.from.id), page, historyPageSize, {
            collectionId: filter,
            date: selectedDate
          });
    const totalPages = Math.max(1, Math.ceil(data.total / historyPageSize));
    const currentPage = Math.min(Math.max(page, 1), totalPages);
    if (data.total > 0 && data.items.length === 0 && currentPage !== page) {
      data =
        selectedScope === "mine"
          ? await deliveryService.listUserBatches(String(ctx.from.id), currentPage, historyPageSize, {
              collectionId: filter,
              date: selectedDate
            })
          : await deliveryService.listTenantBatches(String(ctx.from.id), currentPage, historyPageSize, {
              collectionId: filter,
              date: selectedDate
            });
    }
    const username = ctx.me?.username;
    let filterLabel = "全部";
    if (filter === null) {
      filterLabel = "未分类";
    } else if (typeof filter === "string") {
      const collections = await deliveryService.listCollections();
      const found = collections.find((c) => c.id === filter);
      filterLabel = found ? truncatePlainText(stripHtmlTags(found.title), 10) : "未分类";
    }
    const viewerUserId = ctx.from ? String(ctx.from.id) : null;
    const hidePublisherEnabled = await deliveryService.getTenantHidePublisherEnabled().catch(() => false);
    const isTenantViewer = viewerUserId ? await deliveryService.isTenantUser(viewerUserId).catch(() => false) : false;
    const canManageViewer = isTenantViewer && viewerUserId ? await deliveryService.canManageAdmins(viewerUserId).catch(() => false) : false;
    const content = (
      await Promise.all(
        data.items.map(async (item, index) => {
        const order = (currentPage - 1) * historyPageSize + index + 1;
        const titleText = escapeHtml(stripHtmlTags(item.title));
        const titleLine = `<b>${order}. ${titleText}</b>`;
        const desc = item.description ? sanitizeTelegramHtml(item.description) : "";
        const descLine = desc ? `<blockquote expandable>${desc}</blockquote>` : "";
        const actionLine = buildAssetActionLine({
          username,
          shareCode: item.shareCode,
          assetId: item.assetId,
          canManage: canManageViewer
        });
        const publisherLine =
          !item.publisherUserId
            ? ""
            : !hidePublisherEnabled || item.publisherUserId === viewerUserId || isTenantViewer
              ? await buildPublisherLine(ctx, item.publisherUserId, deliveryService)
              : "";
        return [
          titleLine,
          publisherLine,
          actionLine,
          `条数：<b>${item.count}</b>`,
          descLine
        ]
          .filter(Boolean)
          .join("\n");
        })
      )
    ).join("\n\n");
    const scopeLabel = selectedScope === "mine" ? "我的发布" : "社区发布";
    const title = `📚 列表（${escapeHtml(formatLocalDate(selectedDate))}｜${scopeLabel}，每页 10 条）`;
    const message = data.total === 0 ? `${title}\n\n📭 当天暂无发布。` : `${title}\n\n${content}`;
    await upsertHtml(ctx, message, buildHistoryKeyboard(currentPage, totalPages, filterLabel, selectedDate, selectedScope, showMoreActions));
  };

  const buildSearchKeyboard = (currentPage: number, totalPages: number) => {
    const keyboard = new InlineKeyboard();
    if (totalPages > 1) {
      if (currentPage > 1) {
        keyboard.text("⬅️ 上一页", `search:page:${currentPage - 1}`);
      }
      if (currentPage < totalPages) {
        keyboard.text("下一页 ➡️", `search:page:${currentPage + 1}`);
      }
      keyboard.row().text("🔄 刷新", "search:refresh");
    }
    keyboard.row().text("📚 列表", "help:list").text("🏠 首页", "home:back");
    return keyboard;
  };

  const renderSearch = async (ctx: Context, query: string, page: number, mode: "reply" | "edit") => {
    if (!deliveryService) {
      await replyHtml(ctx, "⚠️ 当前未启用数据库，无法搜索。", { reply_markup: mainKeyboard });
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
    const safeQuery = query.trim();
    if (safeQuery.length < 2) {
      await replyHtml(ctx, "请输入更长的关键词，例如：<code>搜索 教程</code>。", { reply_markup: mainKeyboard });
      return;
    }
    const pageSize = 10;
    let data = await deliveryService.searchAssets(userId, safeQuery, page, pageSize).catch(() => null);
    if (!data || data.total === 0) {
      const text = `🔍 未找到相关内容：<code>${escapeHtml(safeQuery)}</code>`;
      if (mode === "edit") {
        await editHtml(ctx, text, { reply_markup: buildSearchKeyboard(1, 1) });
      } else {
        await replyHtml(ctx, text, { reply_markup: buildSearchKeyboard(1, 1) });
      }
      return;
    }
    const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
    const currentPage = Math.min(Math.max(page, 1), totalPages);
    if (data.items.length === 0 && currentPage !== page) {
      data = await deliveryService.searchAssets(userId, safeQuery, currentPage, pageSize).catch(() => null);
      if (!data || data.total === 0) {
        const text = `🔍 未找到相关内容：<code>${escapeHtml(safeQuery)}</code>`;
        if (mode === "edit") {
          await editHtml(ctx, text, { reply_markup: buildSearchKeyboard(1, 1) });
        } else {
          await replyHtml(ctx, text, { reply_markup: buildSearchKeyboard(1, 1) });
        }
        return;
      }
    }
    const username = ctx.me?.username;
    const content = data.items
      .map((item, index) => {
        const order = (currentPage - 1) * pageSize + index + 1;
        const safeTitle = sanitizeTelegramHtml(item.title);
        const titleLine = safeTitle ? `<b>${order}. ${safeTitle}</b>` : `<b>${order}.</b>`;
        const actionLine = buildAssetActionLine({
          username,
          shareCode: item.shareCode,
          assetId: item.assetId,
          canManage: canManageViewer
        });
        return [titleLine, actionLine].filter(Boolean).join("\n");
      })
      .filter(Boolean)
      .join("\n\n");
    const text = `🔎 搜索结果：<code>${escapeHtml(safeQuery)}</code>\n（第 ${currentPage}/${totalPages} 页，共 ${data.total} 条）\n\n${content}`;
    const keyboard = buildSearchKeyboard(currentPage, totalPages);
    if (mode === "edit") {
      await editHtml(ctx, text, { reply_markup: keyboard });
    } else {
      await replyHtml(ctx, text, { reply_markup: keyboard });
    }
  };

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
      await replyHtml(ctx, "⚠️ 当前未启用数据库，无法查看标签。", { reply_markup: mainKeyboard });
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
        ? "（暂无标签。发布内容时在标题/描述里写 #标签，保存后会自动归档。）"
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
      await replyHtml(ctx, "⚠️ 当前未启用数据库，无法查看标签。", { reply_markup: mainKeyboard });
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
        const actionLine = buildAssetActionLine({
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
      renderTagIndex,
      renderTagAssets,
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

  bot.on("message:photo", async (ctx) => {
    await handleBroadcastPhoto(ctx);
  });

  bot.on("message:video", async (ctx) => {
    await handleBroadcastVideo(ctx);
  });

  bot.on("message:document", async (ctx) => {
    await handleBroadcastDocument(ctx);
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (isCancelText(text)) {
      await exitCurrentInputState(ctx);
      return;
    }
    if (await handleMetaInput(ctx, text)) {
      return;
    }
    if (ctx.from && ctx.chat && ctx.message.reply_to_message) {
      const replied: any = ctx.message.reply_to_message as any;
      const replyFromBot =
        Boolean(replied?.from?.is_bot) && (ctx.me?.username ? replied?.from?.username === ctx.me.username : true);
      if (replyFromBot) {
        const entities: any[] = Array.isArray(replied?.entities) ? replied.entities : [];
        const urls: string[] = [];
        for (const entity of entities) {
          if (entity?.type === "text_link" && typeof entity.url === "string") {
            urls.push(entity.url);
          }
          if (entity?.type === "url" && typeof replied?.text === "string") {
            const raw = replied.text.slice(entity.offset ?? 0, (entity.offset ?? 0) + (entity.length ?? 0));
            if (raw) {
              urls.push(raw);
            }
          }
        }
        const commentId = (() => {
          for (const url of urls) {
            try {
              const parsed = new URL(url);
              const start = parsed.searchParams.get("start") ?? "";
              if (start.startsWith("cv_") || start.startsWith("cr_") || start.startsWith("ct_")) {
                const id = start.slice(3).trim();
                if (id) {
                  return id;
                }
              }
            } catch {
              continue;
            }
          }
          return null;
        })();
        if (commentId) {
          if (!deliveryService) {
            await replyHtml(ctx, "⚠️ 当前未启用数据库，无法回复。", { reply_markup: mainKeyboard as never });
            return;
          }
          const userId = String(ctx.from.id);
          const context = await deliveryService.getAssetCommentContext(userId, commentId);
          if (!context) {
            await replyHtml(ctx, "⚠️ 评论不存在或无权限。", { reply_markup: mainKeyboard as never });
            return;
          }
          const key = toMetaKey(ctx.from.id, ctx.chat.id);
          setSessionMode(key, "commentInput");
          commentInputStates.set(key, { assetId: context.assetId, replyToCommentId: commentId, replyToLabel: "该评论" });
          const authorName = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name?.trim() || null;
          const result = await deliveryService.addAssetComment(userId, context.assetId, {
            authorName,
            content: text,
            replyToCommentId: commentId
          });
          if (result.ok && result.notify && result.commentId) {
            await notifyCommentTargets(ctx, { content: text, commentId: result.commentId, notify: result.notify }).catch(() => undefined);
          }
          await replyHtml(ctx, result.message, { reply_markup: mainKeyboard as never });
          const located = await deliveryService.locateAssetComment(userId, commentId, 8).catch(() => null);
          await renderComments(ctx, context.assetId, located?.page ?? 1, "reply");
          return;
        }
      }
    }
    if (await handleCommentInputText(ctx, text)) {
      return;
    }
    if (ctx.from && ctx.chat) {
      const key = toMetaKey(ctx.from.id, ctx.chat.id);
      const mode = getSessionMode(key);
      if (mode === "followInput") {
        const command = normalizeButtonText(text);
        if (
          command === "分享" ||
          command === "储存" ||
          command === "完成" ||
          command === "列表" ||
          command === "搜索" ||
          command === "足迹" ||
          command === "我的" ||
          command === "设置"
        ) {
          await replyHtml(ctx, buildInputExitHint("添加关注关键词"), { reply_markup: buildFollowInputKeyboard() });
          return;
        }
        if (!deliveryService) {
          setSessionMode(key, "idle");
          await replyHtml(ctx, "⚠️ 当前未启用数据库，无法保存关注关键词。", { reply_markup: mainKeyboard });
          return;
        }
        const userId = String(ctx.from.id);
        const isClear = text.trim() === "清空" || text.trim() === "清除";
        const current = await deliveryService.getUserFollowKeywords(userId).catch(() => []);
        const added = isClear
          ? []
          : text
              .split(/[,\n，；;]+/g)
              .map((s) => s.trim())
              .filter(Boolean);
        const next = isClear ? [] : [...current, ...added];
        const result = await deliveryService.setUserFollowKeywords(userId, next);
        setSessionMode(key, "idle");
        await replyHtml(ctx, result.message, { reply_markup: mainKeyboard });
        await renderFollow(ctx);
        return;
      }
    }
    if (await handleBroadcastText(ctx, text)) {
      return;
    }
    if (await handleSettingsText(ctx, text)) {
      return;
    }
    if (ctx.from && ctx.chat) {
      const key = toMetaKey(ctx.from.id, ctx.chat.id);
      const mode = getSessionMode(key);
      const inputState = mode === "collectionInput" ? collectionInputStates.get(key) : undefined;
      if (mode === "collectionInput" && (inputState?.mode === "createCollection" || inputState?.mode === "renameCollection")) {
        const command = normalizeButtonText(text);
        if (
          command === "分享" ||
          command === "储存" ||
          command === "完成" ||
          command === "列表" ||
          command === "搜索" ||
          command === "足迹" ||
          command === "我的" ||
          command === "关注" ||
          command === "设置"
        ) {
          await replyHtml(ctx, buildInputExitHint("编辑分类"), { reply_markup: buildCollectionInputKeyboard() });
          return;
        }
        if (!deliveryService) {
          setSessionMode(key, "idle");
          await replyHtml(ctx, `⚠️ 当前未启用数据库，无法${inputState.mode === "renameCollection" ? "重命名" : "创建"}分类。`, {
            reply_markup: mainKeyboard
          });
          return;
        }
        if (inputState.mode === "renameCollection") {
          const result = await deliveryService.updateCollection(String(ctx.from.id), inputState.collectionId, text);
          if (result.ok) {
            const normalizedTitle = text.trim().replace(/\s+/g, " ") || "未分类";
            void updateVaultTopicIndexByCollection(ctx, inputState.collectionId, normalizedTitle).catch(() => undefined);
            setSessionMode(key, "idle");
            await replyHtml(ctx, result.message, { reply_markup: mainKeyboard });
            await renderCollections(ctx, { returnTo: "settings" });
            return;
          }
          await replyHtml(ctx, result.message, { reply_markup: buildCollectionInputKeyboard() });
          return;
        }
        const result = await deliveryService.createCollection(String(ctx.from.id), text);
        if (result.ok) {
          if (result.id) {
            const normalizedTitle = text.trim().replace(/\s+/g, " ") || "未分类";
            void updateVaultTopicIndexByCollection(ctx, result.id, normalizedTitle).catch(() => undefined);
          }
          setSessionMode(key, "idle");
          await replyHtml(ctx, result.message, { reply_markup: mainKeyboard });
          await renderCollections(ctx, { returnTo: "settings" });
          return;
        }
        await replyHtml(ctx, result.message, { reply_markup: buildCollectionInputKeyboard() });
        return;
      }
    }
    if (ctx.from && ctx.chat) {
      const key = toMetaKey(ctx.from.id, ctx.chat.id);
      const mode = getSessionMode(key);
      const adminState = mode === "adminInput" ? adminInputStates.get(key) : undefined;
      if (mode === "adminInput" && adminState?.mode === "addAdmin") {
        const command = normalizeButtonText(text);
        if (
          command === "分享" ||
          command === "储存" ||
          command === "完成" ||
          command === "列表" ||
          command === "搜索" ||
          command === "足迹" ||
          command === "我的" ||
          command === "关注" ||
          command === "设置"
        ) {
          await replyHtml(ctx, buildInputExitHint("添加管理员"), { reply_markup: buildAdminInputKeyboard() });
          return;
        }
        if (!deliveryService) {
          setSessionMode(key, "idle");
          await replyHtml(ctx, "⚠️ 当前未启用数据库，无法添加管理员。", { reply_markup: mainKeyboard });
          return;
        }
        const actorUserId = String(ctx.from.id);
        const canManageAdmins = await deliveryService.canManageAdmins(actorUserId);
        if (!canManageAdmins) {
          setSessionMode(key, "idle");
          await replyHtml(ctx, "🔒 无权限：仅管理员可添加管理员。", { reply_markup: buildHelpKeyboard() });
          return;
        }
        const id = text.replace(/\s+/g, "");
        if (!/^\d{5,20}$/.test(id)) {
          await replyHtml(ctx, "⚠️ ID 格式错误：请发送 Telegram 数字 ID，例如 <code>123456</code>。", {
            reply_markup: buildAdminInputKeyboard()
          });
          return;
        }
        const result = await deliveryService.addTenantAdmin(actorUserId, id);
        setSessionMode(key, "idle");
        await replyHtml(ctx, result.message, { reply_markup: mainKeyboard });
        await renderSettings(ctx);
        return;
      }
    }
    const normalizedCommand = normalizeButtonText(text);
    const command = normalizedCommand === "关注" ? "我的" : normalizedCommand;
    const isTopLevelCommand =
      command === "分享" ||
      command === "储存" ||
      command === "完成" ||
      command === "列表" ||
      command === "搜索" ||
      command === "足迹" ||
      command === "我的" ||
      command === "设置" ||
      command === "标签";
    if (ctx.from && ctx.chat) {
      const key = toMetaKey(ctx.from.id, ctx.chat.id);
      const mode = ensureSessionMode(key);
      if (mode === "searchInput" && isTopLevelCommand && command !== "搜索") {
        setSessionMode(key, "idle");
      }
      if (mode === "searchInput" && !isTopLevelCommand && !text.startsWith("/") && text.trim().length >= 1) {
        const query = text.trim();
        searchStates.set(key, { query });
        if (query.length >= 2) {
          setSessionMode(key, "idle");
        }
        await renderSearch(ctx, query, 1, "reply");
        return;
      }
    }
    if (command === "分享" || command === "储存") {
      if (!ctx.from || !ctx.chat) {
        return;
      }
      setActive(ctx.from.id, ctx.chat.id, true);
      await renderUploadStatus(ctx);
      return;
    }
    if (command === "完成") {
      await replyHtml(ctx, "请点击消息里的 <b>✅ 完成</b> 保存。", { reply_markup: actionKeyboard });
      return;
    }
    if (command === "列表") {
      if (ctx.from && ctx.chat) {
        const key = toMetaKey(ctx.from.id, ctx.chat.id);
        historyScopeStates.set(key, "community");
        if (deliveryService && !historyDateStates.has(key)) {
          const now = new Date();
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          historyDateStates.set(key, today);
          await deliveryService.setUserHistoryListDate(String(ctx.from.id), today).catch(() => undefined);
        }
      }
      await renderHistory(ctx, 1, "community");
      return;
    }
    if (command === "搜索") {
      if (ctx.from && ctx.chat) {
        const key = toMetaKey(ctx.from.id, ctx.chat.id);
        setSessionMode(key, "searchInput");
      }
      const keyboard = await getDefaultKeyboard(ctx);
      await replyHtml(ctx, ["<b>🔎 搜索</b>", "", "请直接发送关键词开始搜索。", "也可以发送：<code>搜索 关键词</code>。", "例如：<code>搜索 教程</code>。"].join("\n"), {
        reply_markup: keyboard
      });
      return;
    }
    if (command === "足迹") {
      await renderFootprint(ctx, "open", "30d", 1, "reply");
      return;
    }
    if (command === "我的") {
      await renderMy(ctx);
      return;
    }
    if (command === "设置") {
      await renderSettings(ctx);
      return;
    }
    const searchMatch = text.match(/^搜索\s+(.+)$/);
    if (searchMatch) {
      const query = searchMatch[1].trim();
      if (ctx.from && ctx.chat) {
        const key = toMetaKey(ctx.from.id, ctx.chat.id);
        searchStates.set(key, { query });
        setSessionMode(key, query.length >= 2 ? "idle" : "searchInput");
      }
      await renderSearch(ctx, query, 1, "reply");
      return;
    }
    if (text === "标签") {
      await renderTagIndex(ctx, "reply");
      return;
    }
    const tagMatch = text.match(/^#([\p{L}\p{N}_-]{1,32})$/u);
    if (tagMatch) {
      if (!deliveryService) {
        await replyHtml(ctx, "⚠️ 当前未启用数据库，无法查看标签。", { reply_markup: mainKeyboard });
        return;
      }
      const tagName = tagMatch[1] ?? "";
      const found = await deliveryService.getTagByName(tagName).catch(() => null);
      if (!found) {
        await replyHtml(ctx, `🔎 未找到标签：<code>#${escapeHtml(tagName)}</code>\n发送 <code>标签</code> 查看热门标签。`, {
          reply_markup: mainKeyboard
        });
        return;
      }
      await renderTagAssets(ctx, found.tagId, 1, "reply");
      return;
    }
    const match = text.match(/^打开(?:内容)?\s+(.+)$/);
    if (match) {
      await openShareCode(ctx, match[1].trim());
      return;
    }
    const payloadFromLink = extractStartPayloadFromText(text);
    if (payloadFromLink) {
      if (deliveryService && ctx.from) {
        await deliveryService.trackVisit(String(ctx.from.id), "start_payload").catch(() => undefined);
      }
      await handleStartPayloadEntry(ctx, payloadFromLink);
      return;
    }
    if (/^[a-zA-Z0-9_-]{6,16}$/.test(text)) {
      await openShareCode(ctx, text);
      return;
    }
    const keyboard = await getDefaultKeyboard(ctx);
    await replyHtml(ctx, buildGuideHint("请使用底部按钮操作。", "搜索请发送：<code>搜索 关键词</code>；我的页可查看足迹/关注/通知。"), {
      reply_markup: keyboard
    });
  });
};
