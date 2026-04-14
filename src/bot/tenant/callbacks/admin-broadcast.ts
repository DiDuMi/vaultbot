import { InlineKeyboard } from "grammy";
import type { Bot } from "grammy";
import { escapeHtml, sanitizeTelegramHtml, toMetaKey, upsertHtml } from "../ui-utils";
import { buildBroadcastPreviewKeyboard, buildSettingsInputKeyboard } from "../keyboards";
import type { TenantCallbackDeps } from "./types";

export const registerBroadcastCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { deliveryService } = deps.services;
  const { setSessionMode, formatLocalDateTime } = deps.session;
  const { broadcastInputStates } = deps.states;
  const { broadcastDraftStates } = deps.states;
  const { renderBroadcast, renderBroadcastButtons } = deps.renderers;

  const getSelectionKey = (ctx: any) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    return ctx.from && chatId ? toMetaKey(ctx.from.id, chatId) : null;
  };

  const getSelectedBroadcast = async (ctx: any) => {
    if (!deliveryService || !ctx.from) {
      return null;
    }
    const key = getSelectionKey(ctx);
    const selectedId = key ? broadcastDraftStates.get(key)?.draftId : undefined;
    const selected = selectedId ? await deliveryService.getBroadcastById(String(ctx.from.id), selectedId).catch(() => null) : null;
    if (selected) {
      return selected;
    }
    const fallback = await deliveryService.getMyBroadcastDraft(String(ctx.from.id)).catch(() => null);
    if (fallback && key) {
      broadcastDraftStates.set(key, { draftId: fallback.id });
    }
    return fallback;
  };

  const renderBroadcastList = async (ctx: any) => {
    if (!deliveryService || !ctx.from) {
      await renderBroadcast(ctx);
      return;
    }
    const key = getSelectionKey(ctx);
    const selectedId = key ? broadcastDraftStates.get(key)?.draftId : undefined;
    const rows = await deliveryService.listMyBroadcasts(String(ctx.from.id), 10).catch(() => []);
    const text = [
      "<b>🗂 推送列表</b>",
      "",
      rows.length === 0
        ? "暂无推送。"
        : rows
            .map((row, index) => {
              const marker = row.id === selectedId ? "👉 " : "";
              const status =
                row.status === "DRAFT"
                  ? "草稿"
                  : row.status === "SCHEDULED"
                    ? "定时中"
                    : row.status === "RUNNING"
                      ? "发送中"
                      : row.status === "COMPLETED"
                        ? "已完成"
                        : row.status === "FAILED"
                          ? "失败"
                          : "已取消";
              const nextRun = row.nextRunAt ? ` · ${escapeHtml(formatLocalDateTime(new Date(row.nextRunAt)))}` : "";
              return `${marker}${index + 1}. <code>${escapeHtml(row.id)}</code>\n${status}${nextRun}`;
            })
            .join("\n\n")
    ].join("\n");
    const keyboard = new InlineKeyboard().text("⬅️ 返回推送", "settings:broadcast");
    for (const row of rows) {
      const label = `${row.status === "DRAFT" ? "📝" : row.status === "SCHEDULED" ? "⏰" : row.status === "RUNNING" ? "🚚" : "📄"} ${row.id.slice(0, 8)}`;
      keyboard.row().text(label, `broadcast:pick:${row.id}`);
    }
    keyboard.row().text("➕ 新建草稿", "broadcast:create").text("🔄 刷新", "broadcast:list");
    await upsertHtml(ctx, text, keyboard);
  };

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
    const key = getSelectionKey(ctx);
    if (result.ok && result.id && key) {
      broadcastDraftStates.set(key, { draftId: result.id });
    }
    await ctx.answerCallbackQuery({ text: result.message }).catch(() => ctx.answerCallbackQuery());
    await renderBroadcast(ctx);
  });

  bot.callbackQuery("broadcast:list", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderBroadcastList(ctx);
  });

  bot.callbackQuery(/^broadcast:pick:(.+)$/, async (ctx) => {
    const selectedId = String(ctx.match?.[1] ?? "");
    const key = getSelectionKey(ctx);
    if (!selectedId || !key) {
      await ctx.answerCallbackQuery();
      return;
    }
    broadcastDraftStates.set(key, { draftId: selectedId });
    await ctx.answerCallbackQuery({ text: "已切换推送" }).catch(() => ctx.answerCallbackQuery());
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
    const draft = await getSelectedBroadcast(ctx);
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
    const draft = await getSelectedBroadcast(ctx);
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
    const draft = await getSelectedBroadcast(ctx);
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
    const draft = await getSelectedBroadcast(ctx);
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
    const draft = await getSelectedBroadcast(ctx);
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
    const draft = await getSelectedBroadcast(ctx);
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
    const draft = await getSelectedBroadcast(ctx);
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
    const current = await getSelectedBroadcast(ctx);
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
    const current = await getSelectedBroadcast(ctx);
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
    const current = await getSelectedBroadcast(ctx);
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
