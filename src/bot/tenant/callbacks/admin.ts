import { InlineKeyboard } from "grammy";
import type { Bot, Context } from "grammy";
import { buildBlockingHint, buildSuccessHint, escapeHtml, replyHtml, sanitizeTelegramHtml, stripHtmlTags, toMetaKey, upsertHtml } from "../ui-utils";
import {
  buildAdminInputKeyboard,
  buildAdminManageKeyboard,
  buildAdminRemoveConfirmKeyboard,
  buildBroadcastPreviewKeyboard,
  buildCollectionDeleteConfirmKeyboard,
  buildCollectionInputKeyboard,
  buildHelpKeyboard,
  buildSettingsInputKeyboard
} from "../keyboards";
import type { TenantCallbackDeps } from "./types";

export const registerSettingsCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { deliveryService } = deps.services;
  const { mainKeyboard, setSessionMode } = deps.session;
  const { collectionPickerStates, settingsInputStates } = deps.states;
  const {
    renderAdSettings,
    renderCollections,
    renderProtectSettings,
    renderHidePublisherSettings,
    renderAutoCategorizeSettings,
    renderRankPublicSettings,
    renderSearchModeSettings,
    renderVaultSettings,
    renderSettings,
    renderWelcomeSettings
  } = deps.renderers;

  bot.callbackQuery("help:settings", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderSettings(ctx);
  });

  bot.callbackQuery("settings:more", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderSettings(ctx, true);
  });

  bot.callbackQuery("settings:less", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderSettings(ctx, false);
  });

  bot.callbackQuery("settings:collections", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (ctx.from && chatId) {
      const key = toMetaKey(ctx.from.id, chatId);
      collectionPickerStates.set(key, { returnTo: "settings", page: 1 });
      setSessionMode(key, "collectionPicker");
    }
    await ctx.answerCallbackQuery();
    await renderCollections(ctx, { returnTo: "settings", page: 1 });
  });

  bot.callbackQuery("settings:welcome", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderWelcomeSettings(ctx);
  });

  bot.callbackQuery("welcome:edit", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    if (!deliveryService) {
      await upsertHtml(ctx, "⚠️ 当前未启用数据库，无法修改欢迎词。", buildHelpKeyboard());
      return;
    }
    const actorUserId = String(ctx.from.id);
    if (!(await deliveryService.canManageAdmins(actorUserId))) {
      await upsertHtml(ctx, "🔒 无权限：仅管理员可修改欢迎词。", buildHelpKeyboard());
      return;
    }
    const key = toMetaKey(ctx.from.id, chatId);
    settingsInputStates.set(key, { mode: "welcome" });
    setSessionMode(key, "settingsInput");
    await upsertHtml(ctx, ["<b>✏️ 修改欢迎词</b>", "", "请发送新的欢迎词内容："].join("\n"), buildSettingsInputKeyboard());
  });

  bot.callbackQuery("welcome:reset", async (ctx) => {
    if (!deliveryService || !ctx.from) {
      await ctx.answerCallbackQuery();
      await renderWelcomeSettings(ctx);
      return;
    }
    const result = await deliveryService.setTenantStartWelcomeHtml(String(ctx.from.id), null);
    await ctx.answerCallbackQuery({ text: result.message }).catch(() => ctx.answerCallbackQuery());
    await renderWelcomeSettings(ctx);
  });

  bot.callbackQuery("settings:ads", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderAdSettings(ctx);
  });

  bot.callbackQuery("settings:protect", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderProtectSettings(ctx);
  });

  bot.callbackQuery("settings:hide_publisher", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderHidePublisherSettings(ctx);
  });

  bot.callbackQuery(/^protect:set:(0|1)$/, async (ctx) => {
    if (!deliveryService || !ctx.from) {
      await ctx.answerCallbackQuery();
      await renderProtectSettings(ctx);
      return;
    }
    const enabled = (ctx.match?.[1] ?? "0") === "1";
    const result = await deliveryService.setTenantProtectContentEnabled(String(ctx.from.id), enabled);
    await ctx.answerCallbackQuery({ text: result.message }).catch(() => ctx.answerCallbackQuery());
    await renderProtectSettings(ctx);
  });

  bot.callbackQuery("protect:noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^hide_publisher:set:(0|1)$/, async (ctx) => {
    if (!deliveryService || !ctx.from) {
      await ctx.answerCallbackQuery();
      await renderHidePublisherSettings(ctx);
      return;
    }
    const enabled = (ctx.match?.[1] ?? "0") === "1";
    const result = await deliveryService.setTenantHidePublisherEnabled(String(ctx.from.id), enabled);
    await ctx.answerCallbackQuery({ text: result.message }).catch(() => ctx.answerCallbackQuery());
    await renderHidePublisherSettings(ctx);
  });

  bot.callbackQuery("hide_publisher:noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("settings:auto_categorize", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderAutoCategorizeSettings(ctx);
  });

  bot.callbackQuery(/^auto_categorize:set:(0|1)$/, async (ctx) => {
    if (!deliveryService || !ctx.from) {
      await ctx.answerCallbackQuery();
      await renderAutoCategorizeSettings(ctx);
      return;
    }
    const enabled = (ctx.match?.[1] ?? "0") === "1";
    const result = await deliveryService.setTenantAutoCategorizeEnabled(String(ctx.from.id), enabled);
    await ctx.answerCallbackQuery({ text: result.message }).catch(() => ctx.answerCallbackQuery());
    await renderAutoCategorizeSettings(ctx);
  });

  bot.callbackQuery("auto_categorize:noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("auto_categorize:rules:edit", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    if (!deliveryService) {
      await upsertHtml(ctx, "⚠️ 当前未启用数据库，无法修改自动归类规则。", buildHelpKeyboard());
      return;
    }
    const actorUserId = String(ctx.from.id);
    if (!(await deliveryService.canManageAdmins(actorUserId))) {
      await upsertHtml(ctx, "🔒 无权限：仅管理员可修改自动归类规则。", buildHelpKeyboard());
      return;
    }
    const collections = await deliveryService.listCollections().catch(() => []);
    const list =
      collections.length === 0
        ? "（暂无分类，请先创建分类）"
        : collections.map((c, i) => `${i + 1}. <b>${escapeHtml(stripHtmlTags(c.title))}</b>`).join("\n");
    const key = toMetaKey(ctx.from.id, chatId);
    settingsInputStates.set(key, { mode: "autoCategorizeRules" });
    setSessionMode(key, "settingsInput");
    const text = [
      "<b>✏️ 设置自动归类关键词</b>",
      "",
      "格式：一行一个分类：",
      "<code>分类名: 关键词1 关键词2</code>",
      "",
      "分隔符支持：空格 / 逗号 / 分号 / |",
      "",
      "<b>当前分类</b>",
      list
    ].join("\n");
    await upsertHtml(ctx, text, buildSettingsInputKeyboard());
  });

  bot.callbackQuery("auto_categorize:rules:clear", async (ctx) => {
    if (!deliveryService || !ctx.from) {
      await ctx.answerCallbackQuery();
      await renderAutoCategorizeSettings(ctx);
      return;
    }
    const result = await deliveryService.setTenantAutoCategorizeRules(String(ctx.from.id), []);
    await ctx.answerCallbackQuery({ text: result.message }).catch(() => ctx.answerCallbackQuery());
    await renderAutoCategorizeSettings(ctx);
  });

  bot.callbackQuery("settings:rank_public", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderRankPublicSettings(ctx);
  });

  bot.callbackQuery(/^rank_public:set:(0|1)$/, async (ctx) => {
    if (!deliveryService || !ctx.from) {
      await ctx.answerCallbackQuery();
      await renderRankPublicSettings(ctx);
      return;
    }
    const enabled = (ctx.match?.[1] ?? "0") === "1";
    const result = await deliveryService.setTenantPublicRankingEnabled(String(ctx.from.id), enabled);
    await ctx.answerCallbackQuery({ text: result.message }).catch(() => ctx.answerCallbackQuery());
    await renderRankPublicSettings(ctx);
  });

  bot.callbackQuery("rank_public:noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("settings:search_mode", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderSearchModeSettings(ctx);
  });

  bot.callbackQuery("settings:vault", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderVaultSettings(ctx);
  });

  bot.callbackQuery(/^search_mode:set:(OFF|ENTITLED_ONLY|PUBLIC)$/, async (ctx) => {
    if (!deliveryService || !ctx.from) {
      await ctx.answerCallbackQuery();
      await renderSearchModeSettings(ctx);
      return;
    }
    const mode = (ctx.match?.[1] ?? "ENTITLED_ONLY") as "OFF" | "ENTITLED_ONLY" | "PUBLIC";
    const result = await deliveryService.setTenantSearchMode(String(ctx.from.id), mode);
    await ctx.answerCallbackQuery({ text: result.message }).catch(() => ctx.answerCallbackQuery());
    await renderSearchModeSettings(ctx);
  });

  bot.callbackQuery("search_mode:noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("vault:noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("vault:add_backup", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    if (!deliveryService) {
      await upsertHtml(ctx, "⚠️ 当前未启用数据库，无法配置存储群。", new InlineKeyboard().text("⬅️ 返回存储群", "settings:vault"));
      return;
    }
    const actorUserId = String(ctx.from.id);
    if (!(await deliveryService.canManageAdmins(actorUserId))) {
      await upsertHtml(ctx, "🔒 无权限：仅管理员可添加备份存储群。", new InlineKeyboard().text("⬅️ 返回存储群", "settings:vault"));
      return;
    }
    const key = toMetaKey(ctx.from.id, chatId);
    settingsInputStates.set(key, { mode: "vaultAddBackup" });
    setSessionMode(key, "settingsInput");
    await upsertHtml(
      ctx,
      ["<b>➕ 添加备份存储群</b>", "", "请发送群/频道的数字 ID：", "例如：<code>-100123456</code>。"].join("\n"),
      buildSettingsInputKeyboard()
    );
  });

  bot.callbackQuery(/^vault:remove_backup:([^:]+)$/, async (ctx) => {
    const vaultGroupId = ctx.match?.[1];
    if (!vaultGroupId) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    if (!deliveryService || !ctx.from) {
      await upsertHtml(ctx, "⚠️ 当前未启用数据库，无法配置存储群。", new InlineKeyboard().text("⬅️ 返回存储群", "settings:vault"));
      return;
    }
    const actorUserId = String(ctx.from.id);
    const result = await deliveryService.removeBackupVaultGroup(actorUserId, vaultGroupId);
    await upsertHtml(ctx, result.message, new InlineKeyboard().text("⬅️ 返回存储群", "settings:vault"));
  });

  bot.callbackQuery(/^vault:set_primary:([^:]+)$/, async (ctx) => {
    const vaultGroupId = ctx.match?.[1];
    if (!vaultGroupId) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    if (!deliveryService || !ctx.from) {
      await upsertHtml(ctx, "⚠️ 当前未启用数据库，无法配置存储群。", new InlineKeyboard().text("⬅️ 返回存储群", "settings:vault"));
      return;
    }
    const actorUserId = String(ctx.from.id);
    const result = await deliveryService.setPrimaryVaultGroup(actorUserId, vaultGroupId);
    await upsertHtml(ctx, result.message, new InlineKeyboard().text("⬅️ 返回存储群", "settings:vault"));
  });

  bot.callbackQuery(/^vault:set_status:([^:]+):(ACTIVE|DEGRADED|BANNED)$/, async (ctx) => {
    const vaultGroupId = ctx.match?.[1];
    const status = (ctx.match?.[2] ?? "") as "ACTIVE" | "DEGRADED" | "BANNED";
    if (!vaultGroupId || (status !== "ACTIVE" && status !== "DEGRADED" && status !== "BANNED")) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    if (!deliveryService || !ctx.from) {
      await upsertHtml(ctx, "⚠️ 当前未启用数据库，无法配置存储群。", new InlineKeyboard().text("⬅️ 返回存储群", "settings:vault"));
      return;
    }
    const actorUserId = String(ctx.from.id);
    const result = await deliveryService.setVaultGroupStatus(actorUserId, vaultGroupId, status);
    await upsertHtml(ctx, result.message, new InlineKeyboard().text("⬅️ 返回存储群", "settings:vault"));
  });

  bot.callbackQuery(/^vault:minreplicas:set:(1|2|3)$/, async (ctx) => {
    const value = Number(ctx.match?.[1] ?? "1");
    await ctx.answerCallbackQuery();
    if (!deliveryService || !ctx.from) {
      await upsertHtml(ctx, "⚠️ 当前未启用数据库，无法配置存储群。", new InlineKeyboard().text("⬅️ 返回存储群", "settings:vault"));
      return;
    }
    const actorUserId = String(ctx.from.id);
    const result = await deliveryService.setTenantMinReplicas(actorUserId, value);
    await upsertHtml(ctx, result.message, new InlineKeyboard().text("⬅️ 返回存储群", "settings:vault"));
  });
};

export const registerBroadcastCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { deliveryService } = deps.services;
  const { mainKeyboard, setSessionMode, formatLocalDateTime } = deps.session;
  const { broadcastInputStates } = deps.states;
  const { renderBroadcast, renderBroadcastButtons } = deps.renderers;

  bot.callbackQuery("settings:broadcast", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderBroadcast(ctx);
  });

  bot.callbackQuery("broadcast:create", async (ctx) => {
    if (!deliveryService || !ctx.from) {
      await ctx.answerCallbackQuery();
      await renderBroadcast(ctx);
      return;
    }
    const actorUserId = String(ctx.from.id);
    const actorChatId = String(ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id ?? "");
    const result = await deliveryService.createBroadcastDraft(actorUserId, actorChatId);
    await ctx.answerCallbackQuery({ text: result.message }).catch(() => ctx.answerCallbackQuery());
    await renderBroadcast(ctx);
  });

  bot.callbackQuery("broadcast:edit:content", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    if (!deliveryService) {
      await upsertHtml(ctx, "⚠️ 当前未启用数据库，无法编辑推送。", new InlineKeyboard().text("⬅️ 返回推送", "settings:broadcast"));
      return;
    }
    const actorUserId = String(ctx.from.id);
    if (!(await deliveryService.canManageAdmins(actorUserId))) {
      await upsertHtml(ctx, "🔒 无权限：仅管理员可编辑推送。", new InlineKeyboard().text("⬅️ 返回推送", "settings:broadcast"));
      return;
    }
    const draft = await deliveryService.getMyBroadcastDraft(actorUserId).catch(() => null);
    if (!draft || draft.status !== "DRAFT") {
      await upsertHtml(ctx, "⚠️ 未找到可编辑的推送草稿。", new InlineKeyboard().text("⬅️ 返回推送", "settings:broadcast"));
      return;
    }
    const key = toMetaKey(ctx.from.id, chatId);
    broadcastInputStates.set(key, { mode: "broadcastContent", draftId: draft.id });
    setSessionMode(key, "broadcastInput");
    await upsertHtml(
      ctx,
      [
        "<b>✏️ 编辑推送内容</b>",
        "",
        "请发送一条消息作为推送内容：",
        "- 文案支持 Telegram HTML",
        "- 允许附带 1 个媒体（照片/视频/文件）",
        "- 仅使用你发送的这条消息的文案与媒体"
      ].join("\n"),
      buildSettingsInputKeyboard()
    );
  });

  bot.callbackQuery("broadcast:edit:buttons", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderBroadcastButtons(ctx);
  });

  bot.callbackQuery("broadcast:buttons:add", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    if (!deliveryService) {
      await upsertHtml(ctx, "⚠️ 当前未启用数据库，无法配置推送按钮。", new InlineKeyboard().text("⬅️ 返回推送", "settings:broadcast"));
      return;
    }
    const actorUserId = String(ctx.from.id);
    if (!(await deliveryService.canManageAdmins(actorUserId))) {
      await upsertHtml(ctx, "🔒 无权限：仅管理员可配置推送按钮。", new InlineKeyboard().text("⬅️ 返回推送", "settings:broadcast"));
      return;
    }
    const draft = await deliveryService.getMyBroadcastDraft(actorUserId).catch(() => null);
    if (!draft || draft.status !== "DRAFT") {
      await upsertHtml(ctx, "⚠️ 未找到可编辑的推送草稿。", new InlineKeyboard().text("⬅️ 返回推送", "settings:broadcast"));
      return;
    }
    const key = toMetaKey(ctx.from.id, chatId);
    broadcastInputStates.set(key, { mode: "broadcastButtonText", draftId: draft.id });
    setSessionMode(key, "broadcastInput");
    await upsertHtml(ctx, ["<b>➕ 添加按钮</b>", "", "请发送按钮文案："].join("\n"), buildSettingsInputKeyboard());
  });

  bot.callbackQuery(/^broadcast:buttons:remove:(\d+)$/, async (ctx) => {
    if (!deliveryService || !ctx.from) {
      await ctx.answerCallbackQuery();
      await renderBroadcastButtons(ctx);
      return;
    }
    const index = Number(ctx.match?.[1] ?? "-1");
    if (!Number.isFinite(index) || index < 0) {
      await ctx.answerCallbackQuery();
      await renderBroadcastButtons(ctx);
      return;
    }
    const actorUserId = String(ctx.from.id);
    const draft = await deliveryService.getMyBroadcastDraft(actorUserId).catch(() => null);
    if (!draft || draft.status !== "DRAFT") {
      await ctx.answerCallbackQuery();
      await upsertHtml(ctx, "⚠️ 未找到可编辑的推送草稿。", new InlineKeyboard().text("⬅️ 返回推送", "settings:broadcast"));
      return;
    }
    const next = draft.buttons.filter((_, i) => i !== index);
    const result = await deliveryService.updateBroadcastDraftButtons(actorUserId, draft.id, next);
    await ctx.answerCallbackQuery({ text: result.message }).catch(() => ctx.answerCallbackQuery());
    await renderBroadcastButtons(ctx);
  });

  bot.callbackQuery("broadcast:preview", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!deliveryService || !ctx.from) {
      await renderBroadcast(ctx);
      return;
    }
    const actorUserId = String(ctx.from.id);
    const draft = await deliveryService.getMyBroadcastDraft(actorUserId).catch(() => null);
    if (!draft) {
      await upsertHtml(ctx, "⚠️ 暂无推送草稿。", new InlineKeyboard().text("⬅️ 返回推送", "settings:broadcast"));
      return;
    }
    const keyboard = buildBroadcastPreviewKeyboard({ buttons: draft.buttons });
    if (!draft.mediaFileId && !draft.contentHtml.trim()) {
      await upsertHtml(ctx, "⚠️ 预览为空：请先编辑文案或发送一个媒体。", keyboard);
      return;
    }
    if (draft.mediaFileId && draft.mediaKind) {
      if (draft.mediaKind === "photo") {
        await ctx.replyWithPhoto(draft.mediaFileId, {
          caption: sanitizeTelegramHtml(draft.contentHtml || ""),
          parse_mode: "HTML",
          reply_markup: keyboard
        });
        return;
      }
      if (draft.mediaKind === "video") {
        await ctx.replyWithVideo(draft.mediaFileId, {
          caption: sanitizeTelegramHtml(draft.contentHtml || ""),
          parse_mode: "HTML",
          reply_markup: keyboard
        });
        return;
      }
      await ctx.replyWithDocument(draft.mediaFileId, {
        caption: sanitizeTelegramHtml(draft.contentHtml || ""),
        parse_mode: "HTML",
        reply_markup: keyboard
      });
      return;
    }
    await ctx.reply(sanitizeTelegramHtml(draft.contentHtml || ""), { parse_mode: "HTML", reply_markup: keyboard });
  });

  bot.callbackQuery("broadcast:send:now", async (ctx) => {
    if (!deliveryService || !ctx.from) {
      await ctx.answerCallbackQuery();
      await renderBroadcast(ctx);
      return;
    }
    const actorUserId = String(ctx.from.id);
    const draft = await deliveryService.getMyBroadcastDraft(actorUserId).catch(() => null);
    if (!draft || draft.status !== "DRAFT") {
      await ctx.answerCallbackQuery();
      await upsertHtml(ctx, "⚠️ 未找到可发送的推送草稿。", new InlineKeyboard().text("⬅️ 返回推送", "settings:broadcast"));
      return;
    }
    const result = await deliveryService.scheduleBroadcast(actorUserId, draft.id, { nextRunAt: new Date() });
    await ctx.answerCallbackQuery({ text: result.message }).catch(() => ctx.answerCallbackQuery());
    await renderBroadcast(ctx);
  });

  bot.callbackQuery("broadcast:send:schedule", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    if (!deliveryService) {
      await upsertHtml(ctx, "⚠️ 当前未启用数据库，无法定时推送。", new InlineKeyboard().text("⬅️ 返回推送", "settings:broadcast"));
      return;
    }
    const actorUserId = String(ctx.from.id);
    if (!(await deliveryService.canManageAdmins(actorUserId))) {
      await upsertHtml(ctx, "🔒 无权限：仅管理员可发起推送。", new InlineKeyboard().text("⬅️ 返回推送", "settings:broadcast"));
      return;
    }
    const draft = await deliveryService.getMyBroadcastDraft(actorUserId).catch(() => null);
    if (!draft || draft.status !== "DRAFT") {
      await upsertHtml(ctx, "⚠️ 未找到可发送的推送草稿。", new InlineKeyboard().text("⬅️ 返回推送", "settings:broadcast"));
      return;
    }
    const key = toMetaKey(ctx.from.id, chatId);
    broadcastInputStates.set(key, { mode: "broadcastScheduleAt", draftId: draft.id });
    setSessionMode(key, "broadcastInput");
    await upsertHtml(
      ctx,
      ["<b>⏰ 定时推送</b>", "", "请发送推送时间（本地时区）：", "<code>YYYY-MM-DD HH:mm</code>", "例如：<code>2026-03-02 21:30</code>"].join("\n"),
      buildSettingsInputKeyboard()
    );
  });

  bot.callbackQuery("broadcast:send:repeat", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    if (!deliveryService) {
      await upsertHtml(ctx, "⚠️ 当前未启用数据库，无法循环推送。", new InlineKeyboard().text("⬅️ 返回推送", "settings:broadcast"));
      return;
    }
    const actorUserId = String(ctx.from.id);
    if (!(await deliveryService.canManageAdmins(actorUserId))) {
      await upsertHtml(ctx, "🔒 无权限：仅管理员可发起推送。", new InlineKeyboard().text("⬅️ 返回推送", "settings:broadcast"));
      return;
    }
    const draft = await deliveryService.getMyBroadcastDraft(actorUserId).catch(() => null);
    if (!draft || draft.status !== "DRAFT") {
      await upsertHtml(ctx, "⚠️ 未找到可发送的推送草稿。", new InlineKeyboard().text("⬅️ 返回推送", "settings:broadcast"));
      return;
    }
    const key = toMetaKey(ctx.from.id, chatId);
    broadcastInputStates.set(key, { mode: "broadcastRepeatEvery", draftId: draft.id });
    setSessionMode(key, "broadcastInput");
    await upsertHtml(ctx, ["<b>🔁 循环推送</b>", "", "请发送循环间隔（分钟），最小 5：", "例如：<code>60</code>"].join("\n"), buildSettingsInputKeyboard());
  });

  bot.callbackQuery("broadcast:cancel", async (ctx) => {
    if (!deliveryService || !ctx.from) {
      await ctx.answerCallbackQuery();
      await renderBroadcast(ctx);
      return;
    }
    const actorUserId = String(ctx.from.id);
    const current = await deliveryService.getMyBroadcastDraft(actorUserId).catch(() => null);
    if (!current || (current.status !== "SCHEDULED" && current.status !== "RUNNING")) {
      await ctx.answerCallbackQuery();
      await upsertHtml(ctx, "⚠️ 当前没有可取消的推送。", new InlineKeyboard().text("⬅️ 返回推送", "settings:broadcast"));
      return;
    }
    const result = await deliveryService.cancelBroadcast(actorUserId, current.id);
    await ctx.answerCallbackQuery({ text: result.message }).catch(() => ctx.answerCallbackQuery());
    await renderBroadcast(ctx);
  });

  bot.callbackQuery("broadcast:delete", async (ctx) => {
    if (!deliveryService || !ctx.from) {
      await ctx.answerCallbackQuery();
      await renderBroadcast(ctx);
      return;
    }
    const actorUserId = String(ctx.from.id);
    const current = await deliveryService.getMyBroadcastDraft(actorUserId).catch(() => null);
    if (!current || current.status !== "DRAFT") {
      await ctx.answerCallbackQuery();
      await upsertHtml(ctx, "⚠️ 仅可删除草稿状态的推送。", new InlineKeyboard().text("⬅️ 返回推送", "settings:broadcast"));
      return;
    }
    const result = await deliveryService.deleteBroadcastDraft(actorUserId, current.id);
    await ctx.answerCallbackQuery({ text: result.message }).catch(() => ctx.answerCallbackQuery());
    await renderBroadcast(ctx);
  });

  bot.callbackQuery("broadcast:runs", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!deliveryService || !ctx.from) {
      await renderBroadcast(ctx);
      return;
    }
    const actorUserId = String(ctx.from.id);
    const current = await deliveryService.getMyBroadcastDraft(actorUserId).catch(() => null);
    if (!current) {
      await upsertHtml(ctx, "⚠️ 暂无推送。", new InlineKeyboard().text("⬅️ 返回推送", "settings:broadcast"));
      return;
    }
    const runs = await deliveryService.listBroadcastRuns(actorUserId, current.id, 10);
    const text = [
      "<b>📊 推送报告（最近 10 次）</b>",
      "",
      runs.length === 0
        ? "暂无报告。"
        : runs
            .map((r, idx) => {
              const line1 = `${idx + 1}. <code>${escapeHtml(r.id)}</code>`;
              const line2 = `目标：<b>${r.targetCount}</b> 成功：<b>${r.successCount}</b> 失败：<b>${r.failedCount}</b> 拉黑：<b>${r.blockedCount}</b>`;
              const time =
                r.finishedAt === null
                  ? `开始：<b>${escapeHtml(formatLocalDateTime(new Date(r.startedAt)))}</b>`
                  : `开始：<b>${escapeHtml(formatLocalDateTime(new Date(r.startedAt)))}</b>\n结束：<b>${escapeHtml(formatLocalDateTime(new Date(r.finishedAt)))}</b>`;
              return [line1, line2, time].join("\n");
            })
            .join("\n\n")
    ].join("\n");
    const keyboard = new InlineKeyboard().text("⬅️ 返回推送", "settings:broadcast");
    await upsertHtml(ctx, text, keyboard);
  });
};

export const registerAdsCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { deliveryService } = deps.services;
  const { mainKeyboard, setSessionMode } = deps.session;
  const { settingsInputStates } = deps.states;
  const { renderAdSettings } = deps.renderers;

  bot.callbackQuery(/^ads:edit:(prev|next|btn_text|btn_url)$/, async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    const kind = ctx.match?.[1] ?? "";
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    if (!deliveryService) {
      await upsertHtml(ctx, "⚠️ 当前未启用数据库，无法配置广告。", new InlineKeyboard().text("⬅️ 返回广告配置", "settings:ads"));
      return;
    }
    const actorUserId = String(ctx.from.id);
    if (!(await deliveryService.canManageAdmins(actorUserId))) {
      await upsertHtml(ctx, "🔒 无权限：仅管理员可配置广告。", new InlineKeyboard().text("⬅️ 返回广告配置", "settings:ads"));
      return;
    }
    const key = toMetaKey(ctx.from.id, chatId);
    if (kind === "prev") {
      settingsInputStates.set(key, { mode: "adPrev" });
      setSessionMode(key, "settingsInput");
      await upsertHtml(ctx, ["<b>✏️ 修改上一页文案</b>", "", "请发送新的按钮文案："].join("\n"), buildSettingsInputKeyboard());
      return;
    }
    if (kind === "next") {
      settingsInputStates.set(key, { mode: "adNext" });
      setSessionMode(key, "settingsInput");
      await upsertHtml(ctx, ["<b>✏️ 修改下一页文案</b>", "", "请发送新的按钮文案："].join("\n"), buildSettingsInputKeyboard());
      return;
    }
    if (kind === "btn_text") {
      settingsInputStates.set(key, { mode: "adButtonText" });
      setSessionMode(key, "settingsInput");
      await upsertHtml(ctx, ["<b>✏️ 修改广告按钮文案</b>", "", "请发送按钮文案（发送“清除”可禁用）："].join("\n"), buildSettingsInputKeyboard());
      return;
    }
    settingsInputStates.set(key, { mode: "adButtonUrl" });
    setSessionMode(key, "settingsInput");
    await upsertHtml(ctx, ["<b>✏️ 修改广告按钮链接</b>", "", "请发送 http/https 链接（发送“清除”可禁用）："].join("\n"), buildSettingsInputKeyboard());
  });

  bot.callbackQuery("ads:clear_button", async (ctx) => {
    if (!deliveryService || !ctx.from) {
      await ctx.answerCallbackQuery();
      await renderAdSettings(ctx);
      return;
    }
    const actorUserId = String(ctx.from.id);
    const current = await deliveryService.getTenantDeliveryAdConfig().catch(() => ({
      prevText: "⬅️ 上一页",
      nextText: "下一页 ➡️",
      adButtonText: null,
      adButtonUrl: null
    }));
    const result = await deliveryService.setTenantDeliveryAdConfig(actorUserId, { ...current, adButtonText: null, adButtonUrl: null });
    await ctx.answerCallbackQuery({ text: result.message }).catch(() => ctx.answerCallbackQuery());
    await renderAdSettings(ctx);
  });

  bot.callbackQuery("ads:reset", async (ctx) => {
    if (!deliveryService || !ctx.from) {
      await ctx.answerCallbackQuery();
      await renderAdSettings(ctx);
      return;
    }
    const actorUserId = String(ctx.from.id);
    const result = await deliveryService.setTenantDeliveryAdConfig(actorUserId, {
      prevText: "⬅️ 上一页",
      nextText: "下一页 ➡️",
      adButtonText: null,
      adButtonUrl: null
    });
    await ctx.answerCallbackQuery({ text: result.message }).catch(() => ctx.answerCallbackQuery());
    await renderAdSettings(ctx);
  });
};

export const registerAdminAndInputCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { deliveryService } = deps.services;
  const { mainKeyboard, getSessionMode, setSessionMode } = deps.session;
  const { adminInputStates, broadcastInputStates, settingsInputStates } = deps.states;
  const { renderAdSettings, renderBroadcast, renderSettings, renderWelcomeSettings } = deps.renderers;
  const renderAdminManage = async (ctx: Context, page = 1) => {
    if (!deliveryService || !ctx.from) {
      await upsertHtml(ctx, buildBlockingHint("当前未启用数据库，无法管理管理员。"), new InlineKeyboard().text("⬅️ 返回设置", "help:settings"));
      return;
    }
    const actorUserId = String(ctx.from.id);
    const canManageAdmins = await deliveryService.canManageAdmins(actorUserId);
    if (!canManageAdmins) {
      await upsertHtml(ctx, buildBlockingHint("无权限：仅管理员可管理管理员。"), new InlineKeyboard().text("⬅️ 返回设置", "help:settings"));
      return;
    }
    const admins = await deliveryService.listTenantAdmins().catch(() => []);
    const adminIds = admins.filter((m) => m.role !== "OWNER").map((m) => m.tgUserId);
    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(adminIds.length / pageSize));
    const current = Math.min(Math.max(page, 1), totalPages);
    const sortedAdminIds = [...adminIds].sort((a, b) => {
      try {
        const left = BigInt(a);
        const right = BigInt(b);
        if (left === right) {
          return 0;
        }
        return left < right ? 1 : -1;
      } catch {
        return b.localeCompare(a);
      }
    });
    const offset = (current - 1) * pageSize;
    const visible = sortedAdminIds.slice(offset, offset + pageSize);
    const lines = [
      "<b>👥 管理员管理</b>",
      "",
      `管理员总数：<b>${adminIds.length}</b>（不含 OWNER）`,
      adminIds.length === 0 ? "当前暂无可移除管理员。" : "",
      adminIds.length > 0 ? `当前页：<b>${current}/${totalPages}</b>` : "",
      adminIds.length > 0 ? "" : "",
      ...visible.map((id, index) => `${offset + index + 1}. <code>${escapeHtml(id)}</code>`)
    ]
      .filter(Boolean)
      .join("\n");
    await upsertHtml(ctx, lines, buildAdminManageKeyboard({ adminIds, page: current }));
  };

  bot.callbackQuery("settings:admin:list", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderAdminManage(ctx, 1);
  });

  bot.callbackQuery(/^settings:admin:list:(\d+)$/, async (ctx) => {
    const page = Number(ctx.match?.[1] ?? "1");
    await ctx.answerCallbackQuery();
    await renderAdminManage(ctx, Number.isFinite(page) ? page : 1);
  });

  bot.callbackQuery("settings:admin:noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("settings:admin:add", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    if (!deliveryService) {
      await upsertHtml(ctx, buildBlockingHint("当前未启用数据库，无法添加管理员。"), new InlineKeyboard().text("⬅️ 返回设置", "help:settings"));
      return;
    }
    const actorUserId = String(ctx.from.id);
    const canManageAdmins = await deliveryService.canManageAdmins(actorUserId);
    if (!canManageAdmins) {
      await upsertHtml(ctx, buildBlockingHint("无权限：仅管理员可添加管理员。"), new InlineKeyboard().text("⬅️ 返回设置", "help:settings"));
      return;
    }
    const key = toMetaKey(ctx.from.id, chatId);
    adminInputStates.set(key, { mode: "addAdmin" });
    setSessionMode(key, "adminInput");
    await upsertHtml(
      ctx,
      ["<b>➕ 添加管理员</b>", "", "请发送管理员的 Telegram 数字 ID：", "例如：<code>123456</code>"].join("\n"),
      buildAdminInputKeyboard()
    );
  });

  bot.callbackQuery("settings:admin:cancel", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (ctx.from && chatId) {
      const key = toMetaKey(ctx.from.id, chatId);
      setSessionMode(key, "idle");
    }
    await ctx.answerCallbackQuery();
    await renderSettings(ctx);
  });

  bot.callbackQuery("settings:input:cancel", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    const key = toMetaKey(ctx.from.id, chatId);
    const mode = getSessionMode(key);
    const broadcastState = mode === "broadcastInput" ? broadcastInputStates.get(key) : undefined;
    if (broadcastState) {
      setSessionMode(key, "idle");
      await ctx.answerCallbackQuery();
      await renderBroadcast(ctx);
      return;
    }
    const state = mode === "settingsInput" ? settingsInputStates.get(key) : undefined;
    setSessionMode(key, "idle");
    await ctx.answerCallbackQuery();
    if (state?.mode === "welcome") {
      await renderWelcomeSettings(ctx);
      return;
    }
    if (state) {
      await renderAdSettings(ctx);
      return;
    }
    await renderSettings(ctx);
  });

  bot.callbackQuery("meta:cancel", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (ctx.from && chatId) {
      const key = toMetaKey(ctx.from.id, chatId);
      setSessionMode(key, "idle");
    }
    await ctx.answerCallbackQuery({ text: "已取消编辑" }).catch(() => ctx.answerCallbackQuery());
    await upsertHtml(ctx, buildSuccessHint("已取消编辑。"), buildHelpKeyboard());
  });

  bot.callbackQuery(/^settings:admin:remove:(\d{5,20}):(\d+)$/, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!deliveryService) {
      await ctx.answerCallbackQuery();
      await upsertHtml(ctx, buildBlockingHint("当前未启用数据库，无法移除管理员。"), new InlineKeyboard().text("⬅️ 返回设置", "help:settings"));
      return;
    }
    const actorUserId = String(ctx.from.id);
    const canManageAdmins = await deliveryService.canManageAdmins(actorUserId);
    if (!canManageAdmins) {
      await ctx.answerCallbackQuery();
      await upsertHtml(ctx, buildBlockingHint("无权限：仅管理员可移除管理员。"), new InlineKeyboard().text("⬅️ 返回设置", "help:settings"));
      return;
    }
    const targetId = ctx.match?.[1] ?? "";
    const page = Number(ctx.match?.[2] ?? "1");
    await ctx.answerCallbackQuery();
    await upsertHtml(
      ctx,
      ["<b>⚠️ 确认移除管理员</b>", "", `将移除：<code>${escapeHtml(targetId)}</code>`, "该操作立即生效。"].join("\n"),
      buildAdminRemoveConfirmKeyboard(targetId, Number.isFinite(page) ? page : 1)
    );
  });

  bot.callbackQuery(/^settings:admin:confirmremove:(\d{5,20}):(\d+)$/, async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!deliveryService) {
      await ctx.answerCallbackQuery();
      await upsertHtml(ctx, buildBlockingHint("当前未启用数据库，无法移除管理员。"), new InlineKeyboard().text("⬅️ 返回设置", "help:settings"));
      return;
    }
    const actorUserId = String(ctx.from.id);
    const canManageAdmins = await deliveryService.canManageAdmins(actorUserId);
    if (!canManageAdmins) {
      await ctx.answerCallbackQuery();
      await upsertHtml(ctx, buildBlockingHint("无权限：仅管理员可移除管理员。"), new InlineKeyboard().text("⬅️ 返回设置", "help:settings"));
      return;
    }
    const targetId = ctx.match?.[1] ?? "";
    const page = Number(ctx.match?.[2] ?? "1");
    const result = await deliveryService.removeTenantAdmin(actorUserId, targetId);
    await ctx.answerCallbackQuery({ text: result.message }).catch(() => ctx.answerCallbackQuery());
    await renderAdminManage(ctx, Number.isFinite(page) ? page : 1);
  });

  bot.callbackQuery(/^settings:admin:cancelremove:(\d+)$/, async (ctx) => {
    const page = Number(ctx.match?.[1] ?? "1");
    await ctx.answerCallbackQuery();
    await renderAdminManage(ctx, Number.isFinite(page) ? page : 1);
  });
};

export const registerCollectionsCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { deliveryService } = deps.services;
  const { mainKeyboard, isActive, setSessionMode } = deps.session;
  const { collectionStates, historyFilterStates, collectionInputStates, collectionPickerStates } = deps.states;
  const { renderCollections, renderUploadStatus } = deps.renderers;

  bot.callbackQuery("collections:create", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    const key = toMetaKey(ctx.from.id, chatId);
    collectionInputStates.set(key, { mode: "createCollection" });
    setSessionMode(key, "collectionInput");
    await upsertHtml(ctx, ["<b>➕ 新建分类</b>", "", "请发送分类名称（建议 2-10 个字）。"].join("\n"), buildCollectionInputKeyboard());
  });

  bot.callbackQuery(/^collections:page:(\d+)$/, async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    const page = Number(ctx.match?.[1] ?? "1");
    if (ctx.from && chatId) {
      const key = toMetaKey(ctx.from.id, chatId);
      const returnTo = collectionPickerStates.get(key)?.returnTo ?? "settings";
      collectionPickerStates.set(key, { returnTo, page: Number.isFinite(page) ? page : 1 });
      setSessionMode(key, "collectionPicker");
      await ctx.answerCallbackQuery();
      await renderCollections(ctx, { returnTo, page: Number.isFinite(page) ? page : 1 });
      return;
    }
    await ctx.answerCallbackQuery();
    await renderCollections(ctx, { returnTo: "settings", page: Number.isFinite(page) ? page : 1 });
  });

  bot.callbackQuery("collections:noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("collections:cancel", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (ctx.from && chatId) {
      const key = toMetaKey(ctx.from.id, chatId);
      setSessionMode(key, "idle");
    }
    await ctx.answerCallbackQuery();
    await renderCollections(ctx, { returnTo: "settings" });
  });

  bot.callbackQuery("collections:select:none", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    const key = toMetaKey(ctx.from.id, chatId);
    collectionStates.set(key, null);
    if (deliveryService) {
      await deliveryService.setUserDefaultCollectionId(String(ctx.from.id), null).catch(() => undefined);
    }
    const returnTo = collectionPickerStates.get(key)?.returnTo ?? "settings";
    collectionPickerStates.delete(key);
    setSessionMode(key, returnTo === "upload" && isActive(ctx.from.id, chatId) ? "upload" : "idle");
    await ctx.answerCallbackQuery({ text: "已选择：未分类" });
    if (returnTo === "upload") {
      await renderUploadStatus(ctx);
      return;
    }
    await renderCollections(ctx, { returnTo: "settings" });
  });

  bot.callbackQuery(/^collections:select:([^:]+)$/, async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    const collectionId = ctx.match?.[1] ?? "";
    if (!ctx.from || !chatId || !collectionId) {
      await ctx.answerCallbackQuery();
      return;
    }
    const key = toMetaKey(ctx.from.id, chatId);
    collectionStates.set(key, collectionId);
    if (deliveryService) {
      await deliveryService.setUserDefaultCollectionId(String(ctx.from.id), collectionId).catch(() => undefined);
    }
    const returnTo = collectionPickerStates.get(key)?.returnTo ?? "settings";
    collectionPickerStates.delete(key);
    setSessionMode(key, returnTo === "upload" && isActive(ctx.from.id, chatId) ? "upload" : "idle");
    await ctx.answerCallbackQuery({ text: "已更新分类" });
    if (returnTo === "upload") {
      await renderUploadStatus(ctx);
      return;
    }
    await renderCollections(ctx, { returnTo: "settings" });
  });

  bot.callbackQuery(/^collections:rename:([^:]+)$/, async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    const collectionId = ctx.match?.[1] ?? "";
    if (!ctx.from || !chatId || !collectionId) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    if (!deliveryService) {
      await upsertHtml(ctx, "⚠️ 当前未启用数据库，无法重命名分类。", new InlineKeyboard().text("⬅️ 返回分类", "settings:collections"));
      return;
    }
    const canManage = await deliveryService.canManageCollections(String(ctx.from.id));
    if (!canManage) {
      await upsertHtml(ctx, "🔒 无权限：仅管理员可重命名分类。", new InlineKeyboard().text("⬅️ 返回分类", "settings:collections"));
      return;
    }
    const collections = await deliveryService.listCollections();
    const found = collections.find((c) => c.id === collectionId);
    const currentTitle = found ? stripHtmlTags(found.title) : "";
    const key = toMetaKey(ctx.from.id, chatId);
    collectionInputStates.set(key, { mode: "renameCollection", collectionId });
    setSessionMode(key, "collectionInput");
    await upsertHtml(
      ctx,
      ["<b>✏️ 重命名分类</b>", "", currentTitle ? `当前：<b>${escapeHtml(currentTitle)}</b>` : "", "请发送新的分类名称："].filter(Boolean).join("\n"),
      buildCollectionInputKeyboard()
    );
  });

  bot.callbackQuery(/^collections:confirmdelete:([^:]+)$/, async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    const collectionId = ctx.match?.[1] ?? "";
    if (!ctx.from || !chatId || !collectionId) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    if (!deliveryService) {
      await upsertHtml(ctx, "⚠️ 当前未启用数据库，无法删除分类。", new InlineKeyboard().text("⬅️ 返回分类", "settings:collections"));
      return;
    }
    const canManage = await deliveryService.canManageCollections(String(ctx.from.id));
    if (!canManage) {
      await upsertHtml(ctx, "🔒 无权限：仅管理员可删除分类。", new InlineKeyboard().text("⬅️ 返回分类", "settings:collections"));
      return;
    }
    const collections = await deliveryService.listCollections();
    const found = collections.find((c) => c.id === collectionId);
    const title = found ? stripHtmlTags(found.title) : "该分类";
    const impact = await deliveryService.getCollectionImpactCounts(String(ctx.from.id), collectionId).catch(() => ({
      assets: 0,
      files: 0
    }));
    await upsertHtml(
      ctx,
      [
        "<b>🗑 删除分类</b>",
        "",
        `即将删除：<b>${escapeHtml(title)}</b>`,
        `受影响文件组：<b>${impact.assets}</b>`,
        `受影响文件条目：<b>${impact.files}</b>`,
        "删除后，该分类下内容将变为“未分类”。"
      ].join("\n"),
      buildCollectionDeleteConfirmKeyboard(collectionId)
    );
  });

  bot.callbackQuery(/^collections:delete:([^:]+)$/, async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    const collectionId = ctx.match?.[1] ?? "";
    if (!ctx.from || !chatId || !collectionId) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!deliveryService) {
      await ctx.answerCallbackQuery();
      await upsertHtml(ctx, "⚠️ 当前未启用数据库，无法删除分类。", new InlineKeyboard().text("⬅️ 返回分类", "settings:collections"));
      return;
    }
    const result = await deliveryService.deleteCollection(String(ctx.from.id), collectionId);
    const key = toMetaKey(ctx.from.id, chatId);
    if (collectionStates.get(key) === collectionId) {
      collectionStates.set(key, null);
      await deliveryService.setUserDefaultCollectionId(String(ctx.from.id), null).catch(() => undefined);
    }
    if (historyFilterStates.get(key) === collectionId) {
      historyFilterStates.delete(key);
      await deliveryService.setUserHistoryCollectionFilter(String(ctx.from.id), undefined).catch(() => undefined);
    }
    await ctx.answerCallbackQuery({ text: result.message }).catch(() => ctx.answerCallbackQuery());
    await renderCollections(ctx, { returnTo: "settings" });
  });
};
