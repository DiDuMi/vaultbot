import type { Context } from "grammy";
import type { DeliveryService } from "../../services/use-cases";
import { buildHelpKeyboard, buildSettingsInputKeyboard } from "./keyboards";
import type { SessionMode } from "./session";
import {
  buildInputExitHint,
  escapeHtml,
  normalizeButtonText,
  replyHtml,
  sanitizeTelegramHtml,
  stripHtmlTags,
  toMetaKey,
  upsertHtml,
  utf8ByteLength,
  type KeyValueStore
} from "./ui-utils";

type BroadcastInputState =
  | { mode: "broadcastContent"; draftId: string }
  | { mode: "broadcastButtonText"; draftId: string }
  | { mode: "broadcastButtonUrl"; draftId: string; text: string }
  | { mode: "broadcastScheduleAt"; draftId: string }
  | { mode: "broadcastRepeatEvery"; draftId: string };

type SettingsInputState =
  | { mode: "welcome" }
  | { mode: "adPrev" }
  | { mode: "adNext" }
  | { mode: "adButtonText" }
  | { mode: "adButtonUrl" }
  | { mode: "autoCategorizeRules" }
  | { mode: "vaultAddBackup" };

export const createTenantAdminInput = (deps: {
  deliveryService: DeliveryService | null;
  mainKeyboard: unknown;
  isActive: (userId: number, chatId: number) => boolean;
  getSessionMode: (key: string) => SessionMode;
  setSessionMode: (key: string, mode: SessionMode) => void;
  broadcastInputStates: KeyValueStore<BroadcastInputState>;
  settingsInputStates: KeyValueStore<SettingsInputState>;
  parseLocalDateTime: (value: string) => Date | null;
  renderBroadcast: (ctx: Context) => Promise<void>;
  renderBroadcastButtons: (ctx: Context) => Promise<void>;
  renderWelcomeSettings: (ctx: Context) => Promise<void>;
  renderAdSettings: (ctx: Context) => Promise<void>;
  renderAutoCategorizeSettings: (ctx: Context) => Promise<void>;
  renderVaultSettings: (ctx: Context) => Promise<void>;
}) => {
  const {
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
  } = deps;

  const handleBroadcastPhoto = async (ctx: Context) => {
    if (!ctx.message || !ctx.from || !ctx.chat) {
      return false;
    }
    if (isActive(ctx.from.id, ctx.chat.id)) {
      return false;
    }
    const key = toMetaKey(ctx.from.id, ctx.chat.id);
    const state = broadcastInputStates.get(key);
    const draftId = state?.mode === "broadcastContent" ? state.draftId : undefined;
    if (!draftId) {
      return false;
    }
    if (!deliveryService) {
      if (state?.mode === "broadcastContent") {
        setSessionMode(key, "idle");
      }
      await replyHtml(ctx, "⚠️ 当前未启用数据库，无法编辑推送。", { reply_markup: mainKeyboard as never });
      return true;
    }
    const actorUserId = String(ctx.from.id);
    if (!(await deliveryService.canManageAdmins(actorUserId))) {
      if (state?.mode === "broadcastContent") {
        setSessionMode(key, "idle");
      }
      await replyHtml(ctx, "🔒 无权限：仅管理员可编辑推送。", { reply_markup: buildHelpKeyboard() });
      return true;
    }
    if (ctx.message.media_group_id) {
      if (state?.mode === "broadcastContent") {
        setSessionMode(key, "idle");
      }
      await replyHtml(ctx, "⚠️ 推送仅支持单媒体，请发送单张照片/单个视频/单个文件。", { reply_markup: mainKeyboard as never });
      await renderBroadcast(ctx);
      return true;
    }
    const fileId = ctx.message.photo?.[ctx.message.photo.length - 1]?.file_id;
    if (!fileId) {
      await replyHtml(ctx, "⚠️ 未识别到照片，请重试。", { reply_markup: buildSettingsInputKeyboard() });
      return true;
    }
    const caption = (ctx.message.caption ?? "").trim();
    const contentHtml = caption ? sanitizeTelegramHtml(caption) : "";
    const result = await deliveryService.updateBroadcastDraftContent(actorUserId, draftId, {
      contentHtml,
      mediaKind: "photo",
      mediaFileId: fileId
    });
    if (state?.mode === "broadcastContent") {
      setSessionMode(key, "idle");
    }
    await replyHtml(ctx, result.message, { reply_markup: mainKeyboard as never });
    await renderBroadcast(ctx);
    return true;
  };

  const handleBroadcastVideo = async (ctx: Context) => {
    if (!ctx.message || !ctx.from || !ctx.chat) {
      return false;
    }
    if (isActive(ctx.from.id, ctx.chat.id)) {
      return false;
    }
    const key = toMetaKey(ctx.from.id, ctx.chat.id);
    const state = broadcastInputStates.get(key);
    const draftId = state?.mode === "broadcastContent" ? state.draftId : undefined;
    if (!draftId) {
      return false;
    }
    if (!deliveryService) {
      if (state?.mode === "broadcastContent") {
        setSessionMode(key, "idle");
      }
      await replyHtml(ctx, "⚠️ 当前未启用数据库，无法编辑推送。", { reply_markup: mainKeyboard as never });
      return true;
    }
    const actorUserId = String(ctx.from.id);
    if (!(await deliveryService.canManageAdmins(actorUserId))) {
      if (state?.mode === "broadcastContent") {
        setSessionMode(key, "idle");
      }
      await replyHtml(ctx, "🔒 无权限：仅管理员可编辑推送。", { reply_markup: buildHelpKeyboard() });
      return true;
    }
    if (ctx.message.media_group_id) {
      if (state?.mode === "broadcastContent") {
        setSessionMode(key, "idle");
      }
      await replyHtml(ctx, "⚠️ 推送仅支持单媒体，请发送单张照片/单个视频/单个文件。", { reply_markup: mainKeyboard as never });
      await renderBroadcast(ctx);
      return true;
    }
    const fileId = ctx.message.video?.file_id;
    if (!fileId) {
      await replyHtml(ctx, "⚠️ 未识别到视频，请重试。", { reply_markup: buildSettingsInputKeyboard() });
      return true;
    }
    const caption = (ctx.message.caption ?? "").trim();
    const contentHtml = caption ? sanitizeTelegramHtml(caption) : "";
    const result = await deliveryService.updateBroadcastDraftContent(actorUserId, draftId, {
      contentHtml,
      mediaKind: "video",
      mediaFileId: fileId
    });
    if (state?.mode === "broadcastContent") {
      setSessionMode(key, "idle");
    }
    await replyHtml(ctx, result.message, { reply_markup: mainKeyboard as never });
    await renderBroadcast(ctx);
    return true;
  };

  const handleBroadcastDocument = async (ctx: Context) => {
    if (!ctx.message || !ctx.from || !ctx.chat) {
      return false;
    }
    if (isActive(ctx.from.id, ctx.chat.id)) {
      return false;
    }
    const key = toMetaKey(ctx.from.id, ctx.chat.id);
    const state = broadcastInputStates.get(key);
    const draftId = state?.mode === "broadcastContent" ? state.draftId : undefined;
    if (!draftId) {
      return false;
    }
    if (!deliveryService) {
      if (state?.mode === "broadcastContent") {
        setSessionMode(key, "idle");
      }
      await replyHtml(ctx, "⚠️ 当前未启用数据库，无法编辑推送。", { reply_markup: mainKeyboard as never });
      return true;
    }
    const actorUserId = String(ctx.from.id);
    if (!(await deliveryService.canManageAdmins(actorUserId))) {
      if (state?.mode === "broadcastContent") {
        setSessionMode(key, "idle");
      }
      await replyHtml(ctx, "🔒 无权限：仅管理员可编辑推送。", { reply_markup: buildHelpKeyboard() });
      return true;
    }
    if (ctx.message.media_group_id) {
      if (state?.mode === "broadcastContent") {
        setSessionMode(key, "idle");
      }
      await replyHtml(ctx, "⚠️ 推送仅支持单媒体，请发送单张照片/单个视频/单个文件。", { reply_markup: mainKeyboard as never });
      await renderBroadcast(ctx);
      return true;
    }
    const fileId = ctx.message.document?.file_id;
    if (!fileId) {
      await replyHtml(ctx, "⚠️ 未识别到文件，请重试。", { reply_markup: buildSettingsInputKeyboard() });
      return true;
    }
    const caption = (ctx.message.caption ?? "").trim();
    const contentHtml = caption ? sanitizeTelegramHtml(caption) : "";
    const result = await deliveryService.updateBroadcastDraftContent(actorUserId, draftId, {
      contentHtml,
      mediaKind: "document",
      mediaFileId: fileId
    });
    if (state?.mode === "broadcastContent") {
      setSessionMode(key, "idle");
    }
    await replyHtml(ctx, result.message, { reply_markup: mainKeyboard as never });
    await renderBroadcast(ctx);
    return true;
  };

  const handleBroadcastText = async (ctx: Context, text: string) => {
    if (!ctx.from || !ctx.chat) {
      return false;
    }
    const key = toMetaKey(ctx.from.id, ctx.chat.id);
    const mode = getSessionMode(key);
    const inputState = mode === "broadcastInput" ? broadcastInputStates.get(key) : undefined;
    if (mode !== "broadcastInput") {
      return false;
    }
    if (!inputState) {
      setSessionMode(key, "idle");
      return true;
    }
    const command = normalizeButtonText(text);
    if (
      command === "分享" ||
      command === "储存" ||
      command === "完成" ||
      command === "列表" ||
      command === "搜索" ||
      command === "足迹" ||
      command === "关注" ||
      command === "设置"
    ) {
      await replyHtml(ctx, buildInputExitHint("配置推送"), { reply_markup: buildSettingsInputKeyboard() });
      return true;
    }
    if (!deliveryService) {
      setSessionMode(key, "idle");
      await replyHtml(ctx, "⚠️ 当前未启用数据库，无法编辑推送。", { reply_markup: mainKeyboard as never });
      return true;
    }
    const actorUserId = String(ctx.from.id);
    const canManage = await deliveryService.canManageAdmins(actorUserId);
    if (!canManage) {
      setSessionMode(key, "idle");
      await replyHtml(ctx, "🔒 无权限：仅管理员可编辑推送。", { reply_markup: buildHelpKeyboard() });
      return true;
    }
    if (inputState.mode === "broadcastContent") {
      const draft = await deliveryService.getMyBroadcastDraft(actorUserId).catch(() => null);
      if (!draft || draft.status !== "DRAFT") {
        setSessionMode(key, "idle");
        await replyHtml(ctx, "⚠️ 未找到可编辑的推送草稿。", { reply_markup: buildHelpKeyboard() });
        return true;
      }
      if (text.trim() === "清除媒体") {
        const result = await deliveryService.updateBroadcastDraftContent(actorUserId, inputState.draftId, {
          contentHtml: draft.contentHtml,
          mediaKind: null,
          mediaFileId: null
        });
        setSessionMode(key, "idle");
        await replyHtml(ctx, result.message, { reply_markup: mainKeyboard as never });
        await renderBroadcast(ctx);
        return true;
      }
      const contentHtml = sanitizeTelegramHtml(text);
      const result = await deliveryService.updateBroadcastDraftContent(actorUserId, inputState.draftId, {
        contentHtml,
        mediaKind: null,
        mediaFileId: null
      });
      setSessionMode(key, "idle");
      await replyHtml(ctx, result.message, { reply_markup: mainKeyboard as never });
      await renderBroadcast(ctx);
      return true;
    }
    if (inputState.mode === "broadcastButtonText") {
      const btnText = text.trim();
      if (!btnText) {
        await replyHtml(ctx, "⚠️ 按钮文案不能为空。", { reply_markup: buildSettingsInputKeyboard() });
        return true;
      }
      if (utf8ByteLength(btnText) > 60) {
        await replyHtml(ctx, "⚠️ 按钮文案过长，请控制在 60 字节以内。", { reply_markup: buildSettingsInputKeyboard() });
        return true;
      }
      broadcastInputStates.set(key, { mode: "broadcastButtonUrl", draftId: inputState.draftId, text: btnText });
      await upsertHtml(
        ctx,
        ["<b>🔗 添加按钮</b>", "", `按钮文案：<b>${escapeHtml(btnText)}</b>`, "请发送 http/https 链接："].join("\n"),
        buildSettingsInputKeyboard()
      );
      return true;
    }
    if (inputState.mode === "broadcastButtonUrl") {
      const url = text.trim();
      if (!/^https?:\/\//i.test(url)) {
        await replyHtml(ctx, "⚠️ 链接格式错误：仅支持 http/https。", { reply_markup: buildSettingsInputKeyboard() });
        return true;
      }
      const draft = await deliveryService.getMyBroadcastDraft(actorUserId).catch(() => null);
      if (!draft || draft.status !== "DRAFT") {
        setSessionMode(key, "idle");
        await replyHtml(ctx, "⚠️ 未找到可编辑的推送草稿。", { reply_markup: buildHelpKeyboard() });
        return true;
      }
      const nextButtons = [...draft.buttons, { text: inputState.text, url }];
      const result = await deliveryService.updateBroadcastDraftButtons(actorUserId, inputState.draftId, nextButtons);
      setSessionMode(key, "idle");
      await replyHtml(ctx, result.message, { reply_markup: mainKeyboard as never });
      await renderBroadcastButtons(ctx);
      return true;
    }
    if (inputState.mode === "broadcastScheduleAt") {
      const date = parseLocalDateTime(text);
      if (!date) {
        await replyHtml(ctx, "⚠️ 时间格式错误，请使用 <code>YYYY-MM-DD HH:mm</code>。", { reply_markup: buildSettingsInputKeyboard() });
        return true;
      }
      const nextRunAt = date.getTime() < Date.now() ? new Date() : date;
      const result = await deliveryService.scheduleBroadcast(actorUserId, inputState.draftId, { nextRunAt });
      setSessionMode(key, "idle");
      await replyHtml(ctx, result.message, { reply_markup: mainKeyboard as never });
      await renderBroadcast(ctx);
      return true;
    }
    const minutes = Number(text.trim());
    if (!Number.isFinite(minutes) || minutes < 5) {
      await replyHtml(ctx, "⚠️ 间隔不合法：请发送分钟数（最小 5）。", { reply_markup: buildSettingsInputKeyboard() });
      return true;
    }
    const repeatEveryMs = Math.round(minutes * 60 * 1000);
    const result = await deliveryService.scheduleBroadcast(actorUserId, inputState.draftId, { nextRunAt: new Date(), repeatEveryMs });
    setSessionMode(key, "idle");
    await replyHtml(ctx, result.message, { reply_markup: mainKeyboard as never });
    await renderBroadcast(ctx);
    return true;
  };

  const handleSettingsText = async (ctx: Context, text: string) => {
    if (!ctx.from || !ctx.chat) {
      return false;
    }
    const key = toMetaKey(ctx.from.id, ctx.chat.id);
    const mode = getSessionMode(key);
    const state = mode === "settingsInput" ? settingsInputStates.get(key) : undefined;
    if (mode !== "settingsInput") {
      return false;
    }
    if (!state) {
      setSessionMode(key, "idle");
      return true;
    }
    const command = normalizeButtonText(text);
    if (
      command === "分享" ||
      command === "储存" ||
      command === "完成" ||
      command === "列表" ||
      command === "搜索" ||
      command === "足迹" ||
      command === "关注" ||
      command === "设置"
    ) {
      await replyHtml(ctx, buildInputExitHint("配置设置"), { reply_markup: buildSettingsInputKeyboard() });
      return true;
    }
    if (!deliveryService) {
      setSessionMode(key, "idle");
      await replyHtml(ctx, "⚠️ 当前未启用数据库，无法保存设置。", { reply_markup: mainKeyboard as never });
      return true;
    }
    const actorUserId = String(ctx.from.id);
    const canManage = await deliveryService.canManageAdmins(actorUserId);
    if (!canManage) {
      setSessionMode(key, "idle");
      await replyHtml(ctx, "🔒 无权限：仅管理员可修改设置。", { reply_markup: buildHelpKeyboard() });
      return true;
    }
    if (state.mode === "autoCategorizeRules") {
      const collections = await deliveryService.listCollections().catch(() => []);
      const titleToId = new Map(collections.map((c) => [stripHtmlTags(c.title).trim(), c.id]));
      const lines = text
        .split(/\r?\n/g)
        .map((l) => l.trim())
        .filter(Boolean);
      const unknown: string[] = [];
      const rules: { collectionId: string; keywords: string[] }[] = [];
      for (const line of lines) {
        const parts = line.split(/[:：]/);
        if (parts.length < 2) {
          continue;
        }
        const left = parts[0]?.trim() ?? "";
        const right = parts.slice(1).join(":").trim();
        if (!left || !right) {
          continue;
        }
        const collectionId = titleToId.get(left);
        if (!collectionId) {
          unknown.push(left);
          continue;
        }
        const keywords = right
          .split(/[,\s，；;|]+/g)
          .map((k) => k.trim())
          .filter(Boolean)
          .slice(0, 20);
        if (keywords.length === 0) {
          continue;
        }
        rules.push({ collectionId, keywords });
      }
      const result = await deliveryService.setTenantAutoCategorizeRules(actorUserId, rules);
      setSessionMode(key, "idle");
      const extra = unknown.length ? `\n\n⚠️ 未找到这些分类名：${unknown.map((t) => `<code>${escapeHtml(t)}</code>`).join(" ")}` : "";
      await replyHtml(ctx, `${result.message}${extra}`, { reply_markup: mainKeyboard as never });
      await renderAutoCategorizeSettings(ctx);
      return true;
    }
    if (state.mode === "vaultAddBackup") {
      const normalized = text.trim();
      const result = await deliveryService.addBackupVaultGroup(actorUserId, normalized);
      setSessionMode(key, "idle");
      await replyHtml(ctx, result.message, { reply_markup: mainKeyboard as never });
      await renderVaultSettings(ctx);
      return true;
    }
    if (state.mode === "welcome") {
      const normalized = text.trim();
      const result =
        normalized === "清除"
          ? await deliveryService.setTenantStartWelcomeHtml(actorUserId, null)
          : await deliveryService.setTenantStartWelcomeHtml(actorUserId, normalized);
      setSessionMode(key, "idle");
      await replyHtml(ctx, result.message, { reply_markup: mainKeyboard as never });
      await renderWelcomeSettings(ctx);
      return true;
    }
    const current = await deliveryService.getTenantDeliveryAdConfig().catch(() => ({
      prevText: "⬅️ 上一页",
      nextText: "下一页 ➡️",
      adButtonText: null,
      adButtonUrl: null
    }));
    let nextConfig = { ...current };
    if (state.mode === "adPrev") {
      nextConfig.prevText = text.trim();
    } else if (state.mode === "adNext") {
      nextConfig.nextText = text.trim();
    } else if (state.mode === "adButtonText") {
      nextConfig.adButtonText = text.trim() === "清除" ? null : text.trim();
    } else if (state.mode === "adButtonUrl") {
      nextConfig.adButtonUrl = text.trim() === "清除" ? null : text.trim();
    }
    const result = await deliveryService.setTenantDeliveryAdConfig(actorUserId, nextConfig);
    setSessionMode(key, "idle");
    await replyHtml(ctx, result.message, { reply_markup: mainKeyboard as never });
    await renderAdSettings(ctx);
    return true;
  };

  return { handleBroadcastPhoto, handleBroadcastVideo, handleBroadcastDocument, handleBroadcastText, handleSettingsText };
};
