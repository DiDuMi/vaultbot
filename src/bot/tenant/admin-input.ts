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
  mainKeyboard: NonNullable<Parameters<Context["reply"]>[1]>["reply_markup"];
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
      await replyHtml(ctx, "\u5f53\u524d\u672a\u542f\u7528\u6570\u636e\u5e93\uff0c\u65e0\u6cd5\u7f16\u8f91\u63a8\u9001\u3002", { reply_markup: mainKeyboard });
      return true;
    }
    const actorUserId = String(ctx.from.id);
    if (!(await deliveryService.canManageProject(actorUserId))) {
      if (state?.mode === "broadcastContent") {
        setSessionMode(key, "idle");
      }
      await replyHtml(ctx, "\u65e0\u6743\u9650\uff1a\u4ec5\u7ba1\u7406\u5458\u53ef\u7f16\u8f91\u63a8\u9001\u3002", { reply_markup: buildHelpKeyboard() });
      return true;
    }
    if (ctx.message.media_group_id) {
      if (state?.mode === "broadcastContent") {
        setSessionMode(key, "idle");
      }
      await replyHtml(ctx, "\u63a8\u9001\u4ec5\u652f\u6301\u5355\u5a92\u4f53\uff0c\u8bf7\u53d1\u9001\u5355\u5f20\u56fe\u7247\u3001\u5355\u4e2a\u89c6\u9891\u6216\u5355\u4e2a\u6587\u4ef6\u3002", { reply_markup: mainKeyboard });
      await renderBroadcast(ctx);
      return true;
    }
    const fileId = ctx.message.photo?.[ctx.message.photo.length - 1]?.file_id;
    if (!fileId) {
      await replyHtml(ctx, "\u672a\u8bc6\u522b\u5230\u56fe\u7247\uff0c\u8bf7\u91cd\u8bd5\u3002", { reply_markup: buildSettingsInputKeyboard() });
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
    await replyHtml(ctx, result.message, { reply_markup: mainKeyboard });
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
      await replyHtml(ctx, "\u5f53\u524d\u672a\u542f\u7528\u6570\u636e\u5e93\uff0c\u65e0\u6cd5\u7f16\u8f91\u63a8\u9001\u3002", { reply_markup: mainKeyboard });
      return true;
    }
    const actorUserId = String(ctx.from.id);
    if (!(await deliveryService.canManageProject(actorUserId))) {
      if (state?.mode === "broadcastContent") {
        setSessionMode(key, "idle");
      }
      await replyHtml(ctx, "\u65e0\u6743\u9650\uff1a\u4ec5\u7ba1\u7406\u5458\u53ef\u7f16\u8f91\u63a8\u9001\u3002", { reply_markup: buildHelpKeyboard() });
      return true;
    }
    if (ctx.message.media_group_id) {
      if (state?.mode === "broadcastContent") {
        setSessionMode(key, "idle");
      }
      await replyHtml(ctx, "\u63a8\u9001\u4ec5\u652f\u6301\u5355\u5a92\u4f53\uff0c\u8bf7\u53d1\u9001\u5355\u5f20\u56fe\u7247\u3001\u5355\u4e2a\u89c6\u9891\u6216\u5355\u4e2a\u6587\u4ef6\u3002", { reply_markup: mainKeyboard });
      await renderBroadcast(ctx);
      return true;
    }
    const fileId = ctx.message.video?.file_id;
    if (!fileId) {
      await replyHtml(ctx, "\u672a\u8bc6\u522b\u5230\u89c6\u9891\uff0c\u8bf7\u91cd\u8bd5\u3002", { reply_markup: buildSettingsInputKeyboard() });
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
    await replyHtml(ctx, result.message, { reply_markup: mainKeyboard });
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
      await replyHtml(ctx, "\u5f53\u524d\u672a\u542f\u7528\u6570\u636e\u5e93\uff0c\u65e0\u6cd5\u7f16\u8f91\u63a8\u9001\u3002", { reply_markup: mainKeyboard });
      return true;
    }
    const actorUserId = String(ctx.from.id);
    if (!(await deliveryService.canManageProject(actorUserId))) {
      if (state?.mode === "broadcastContent") {
        setSessionMode(key, "idle");
      }
      await replyHtml(ctx, "\u65e0\u6743\u9650\uff1a\u4ec5\u7ba1\u7406\u5458\u53ef\u7f16\u8f91\u63a8\u9001\u3002", { reply_markup: buildHelpKeyboard() });
      return true;
    }
    if (ctx.message.media_group_id) {
      if (state?.mode === "broadcastContent") {
        setSessionMode(key, "idle");
      }
      await replyHtml(ctx, "\u63a8\u9001\u4ec5\u652f\u6301\u5355\u5a92\u4f53\uff0c\u8bf7\u53d1\u9001\u5355\u5f20\u56fe\u7247\u3001\u5355\u4e2a\u89c6\u9891\u6216\u5355\u4e2a\u6587\u4ef6\u3002", { reply_markup: mainKeyboard });
      await renderBroadcast(ctx);
      return true;
    }
    const fileId = ctx.message.document?.file_id;
    if (!fileId) {
      await replyHtml(ctx, "\u672a\u8bc6\u522b\u5230\u6587\u4ef6\uff0c\u8bf7\u91cd\u8bd5\u3002", { reply_markup: buildSettingsInputKeyboard() });
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
    await replyHtml(ctx, result.message, { reply_markup: mainKeyboard });
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
      command === "\u5206\u4eab" ||
      command === "\u50a8\u5b58" ||
      command === "\u5b8c\u6210" ||
      command === "\u5217\u8868" ||
      command === "\u641c\u7d22" ||
      command === "\u8db3\u8ff9" ||
      command === "\u5173\u6ce8" ||
      command === "\u8bbe\u7f6e"
    ) {
      await replyHtml(ctx, buildInputExitHint("\u914d\u7f6e\u63a8\u9001"), { reply_markup: buildSettingsInputKeyboard() });
      return true;
    }
    if (!deliveryService) {
      setSessionMode(key, "idle");
      await replyHtml(ctx, "\u5f53\u524d\u672a\u542f\u7528\u6570\u636e\u5e93\uff0c\u65e0\u6cd5\u7f16\u8f91\u63a8\u9001\u3002", { reply_markup: mainKeyboard });
      return true;
    }
    const actorUserId = String(ctx.from.id);
    const canManage = await deliveryService.canManageProject(actorUserId);
    if (!canManage) {
      setSessionMode(key, "idle");
      await replyHtml(ctx, "\u65e0\u6743\u9650\uff1a\u4ec5\u7ba1\u7406\u5458\u53ef\u7f16\u8f91\u63a8\u9001\u3002", { reply_markup: buildHelpKeyboard() });
      return true;
    }
    if (inputState.mode === "broadcastContent") {
      const draft = await deliveryService.getMyBroadcastDraft(actorUserId).catch(() => null);
      if (!draft || draft.status !== "DRAFT") {
        setSessionMode(key, "idle");
        await replyHtml(ctx, "\u672a\u627e\u5230\u53ef\u7f16\u8f91\u7684\u63a8\u9001\u8349\u7a3f\u3002", { reply_markup: buildHelpKeyboard() });
        return true;
      }
      if (text.trim() === "\u6e05\u9664\u5a92\u4f53") {
        const result = await deliveryService.updateBroadcastDraftContent(actorUserId, inputState.draftId, {
          contentHtml: draft.contentHtml,
          mediaKind: null,
          mediaFileId: null
        });
        setSessionMode(key, "idle");
        await replyHtml(ctx, result.message, { reply_markup: mainKeyboard });
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
      await replyHtml(ctx, result.message, { reply_markup: mainKeyboard });
      await renderBroadcast(ctx);
      return true;
    }
    if (inputState.mode === "broadcastButtonText") {
      const btnText = text.trim();
      if (!btnText) {
        await replyHtml(ctx, "\u6309\u94ae\u6587\u6848\u4e0d\u80fd\u4e3a\u7a7a\u3002", { reply_markup: buildSettingsInputKeyboard() });
        return true;
      }
      if (utf8ByteLength(btnText) > 60) {
        await replyHtml(ctx, "\u6309\u94ae\u6587\u6848\u8fc7\u957f\uff0c\u8bf7\u63a7\u5236\u5728 60 \u5b57\u8282\u4ee5\u5185\u3002", { reply_markup: buildSettingsInputKeyboard() });
        return true;
      }
      broadcastInputStates.set(key, { mode: "broadcastButtonUrl", draftId: inputState.draftId, text: btnText });
      await upsertHtml(
        ctx,
        ["<b>\u6dfb\u52a0\u6309\u94ae</b>", "", `\u6309\u94ae\u6587\u6848\uff1a<b>${escapeHtml(btnText)}</b>`, "\u8bf7\u53d1\u9001 http/https \u94fe\u63a5\uff1a"].join("\n"),
        buildSettingsInputKeyboard()
      );
      return true;
    }
    if (inputState.mode === "broadcastButtonUrl") {
      const url = text.trim();
      if (!/^https?:\/\//i.test(url)) {
        await replyHtml(ctx, "\u94fe\u63a5\u683c\u5f0f\u9519\u8bef\uff1a\u4ec5\u652f\u6301 http/https\u3002", { reply_markup: buildSettingsInputKeyboard() });
        return true;
      }
      const draft = await deliveryService.getMyBroadcastDraft(actorUserId).catch(() => null);
      if (!draft || draft.status !== "DRAFT") {
        setSessionMode(key, "idle");
        await replyHtml(ctx, "\u672a\u627e\u5230\u53ef\u7f16\u8f91\u7684\u63a8\u9001\u8349\u7a3f\u3002", { reply_markup: buildHelpKeyboard() });
        return true;
      }
      const nextButtons = [...draft.buttons, { text: inputState.text, url }];
      const result = await deliveryService.updateBroadcastDraftButtons(actorUserId, inputState.draftId, nextButtons);
      setSessionMode(key, "idle");
      await replyHtml(ctx, result.message, { reply_markup: mainKeyboard });
      await renderBroadcastButtons(ctx);
      return true;
    }
    if (inputState.mode === "broadcastScheduleAt") {
      const date = parseLocalDateTime(text);
      if (!date) {
        await replyHtml(ctx, "\u65f6\u95f4\u683c\u5f0f\u9519\u8bef\uff0c\u8bf7\u4f7f\u7528 <code>YYYY-MM-DD HH:mm</code>\u3002", { reply_markup: buildSettingsInputKeyboard() });
        return true;
      }
      if (date.getTime() < Date.now()) {
        await replyHtml(ctx, "\u5b9a\u65f6\u65f6\u95f4\u4e0d\u80fd\u65e9\u4e8e\u5f53\u524d\u65f6\u95f4\uff0c\u8bf7\u91cd\u65b0\u8f93\u5165\u672a\u6765\u65f6\u95f4\u3002", {
          reply_markup: buildSettingsInputKeyboard()
        });
        return true;
      }
      const nextRunAt = date;
      const result = await deliveryService.scheduleBroadcast(actorUserId, inputState.draftId, { nextRunAt });
      setSessionMode(key, "idle");
      await replyHtml(ctx, result.message, { reply_markup: mainKeyboard });
      await renderBroadcast(ctx);
      return true;
    }
    const minutes = Number(text.trim());
    if (!Number.isFinite(minutes) || minutes < 5) {
      await replyHtml(ctx, "\u95f4\u9694\u4e0d\u5408\u6cd5\uff1a\u8bf7\u53d1\u9001\u5206\u949f\u6570\uff08\u6700\u5c11 5\uff09\u3002", { reply_markup: buildSettingsInputKeyboard() });
      return true;
    }
    const repeatEveryMs = Math.round(minutes * 60 * 1000);
    const result = await deliveryService.scheduleBroadcast(actorUserId, inputState.draftId, { nextRunAt: new Date(), repeatEveryMs });
    setSessionMode(key, "idle");
    await replyHtml(ctx, result.message, { reply_markup: mainKeyboard });
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
      command === "\u5206\u4eab" ||
      command === "\u50a8\u5b58" ||
      command === "\u5b8c\u6210" ||
      command === "\u5217\u8868" ||
      command === "\u641c\u7d22" ||
      command === "\u8db3\u8ff9" ||
      command === "\u5173\u6ce8" ||
      command === "\u8bbe\u7f6e"
    ) {
      await replyHtml(ctx, buildInputExitHint("\u914d\u7f6e\u8bbe\u7f6e"), { reply_markup: buildSettingsInputKeyboard() });
      return true;
    }
    if (!deliveryService) {
      setSessionMode(key, "idle");
      await replyHtml(ctx, "\u5f53\u524d\u672a\u542f\u7528\u6570\u636e\u5e93\uff0c\u65e0\u6cd5\u4fdd\u5b58\u8bbe\u7f6e\u3002", { reply_markup: mainKeyboard });
      return true;
    }
    const actorUserId = String(ctx.from.id);
    const canManage = await deliveryService.canManageProject(actorUserId);
    if (!canManage) {
      setSessionMode(key, "idle");
      await replyHtml(ctx, "\u65e0\u6743\u9650\uff1a\u4ec5\u7ba1\u7406\u5458\u53ef\u4fee\u6539\u8bbe\u7f6e\u3002", { reply_markup: buildHelpKeyboard() });
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
      const result = await deliveryService.setProjectAutoCategorizeRules(actorUserId, rules);
      setSessionMode(key, "idle");
      const extra = unknown.length ? `\n\n\u672a\u627e\u5230\u8fd9\u4e9b\u5206\u7c7b\u540d\uff1a${unknown.map((t) => `<code>${escapeHtml(t)}</code>`).join(" ")}` : "";
      await replyHtml(ctx, `${result.message}${extra}`, { reply_markup: mainKeyboard });
      await renderAutoCategorizeSettings(ctx);
      return true;
    }
    if (state.mode === "vaultAddBackup") {
      const normalized = text.trim();
      const result = await deliveryService.addBackupVaultGroup(actorUserId, normalized);
      setSessionMode(key, "idle");
      await replyHtml(ctx, result.message, { reply_markup: mainKeyboard });
      await renderVaultSettings(ctx);
      return true;
    }
    if (state.mode === "welcome") {
      const normalized = text.trim();
      const result =
        normalized === "\u6e05\u9664"
          ? await deliveryService.setProjectStartWelcomeHtml(actorUserId, null)
          : await deliveryService.setProjectStartWelcomeHtml(actorUserId, normalized);
      setSessionMode(key, "idle");
      await replyHtml(ctx, result.message, { reply_markup: mainKeyboard });
      await renderWelcomeSettings(ctx);
      return true;
    }
    const current = await deliveryService.getProjectDeliveryAdConfig().catch(() => ({
      prevText: "\u2b05\ufe0f \u4e0a\u4e00\u9875",
      nextText: "\u4e0b\u4e00\u9875 \u27a1\ufe0f",
      adButtonText: null,
      adButtonUrl: null
    }));
    let nextConfig = { ...current };
    if (state.mode === "adPrev") {
      nextConfig.prevText = text.trim();
    } else if (state.mode === "adNext") {
      nextConfig.nextText = text.trim();
    } else if (state.mode === "adButtonText") {
      nextConfig.adButtonText = text.trim() === "\u6e05\u9664" ? null : text.trim();
    } else if (state.mode === "adButtonUrl") {
      nextConfig.adButtonUrl = text.trim() === "\u6e05\u9664" ? null : text.trim();
    }
    const result = await deliveryService.setProjectDeliveryAdConfig(actorUserId, nextConfig);
    setSessionMode(key, "idle");
    await replyHtml(ctx, result.message, { reply_markup: mainKeyboard });
    await renderAdSettings(ctx);
    return true;
  };

  return { handleBroadcastPhoto, handleBroadcastVideo, handleBroadcastDocument, handleBroadcastText, handleSettingsText };
};
