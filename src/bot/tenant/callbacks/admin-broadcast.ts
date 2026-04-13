import { InlineKeyboard } from "grammy";
import type { Bot } from "grammy";
import { escapeHtml, sanitizeTelegramHtml, toMetaKey, upsertHtml } from "../ui-utils";
import { buildBroadcastPreviewKeyboard, buildSettingsInputKeyboard } from "../keyboards";
import type { TenantCallbackDeps } from "./types";

export const registerBroadcastCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { deliveryService } = deps.services;
  const { setSessionMode, formatLocalDateTime } = deps.session;
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
      ["<b>⏰ 定时推送</b>", "", "请发送推送时间（本地时区）：", "<code>YYYY-MM-DD HH:mm</code>", "例如：<code>2026-03-02 21:30</code>"].join(
        "\n"
      ),
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
