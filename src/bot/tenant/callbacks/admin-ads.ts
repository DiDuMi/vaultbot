import { InlineKeyboard } from "grammy";
import type { Bot } from "grammy";
import { toMetaKey, upsertHtml } from "../ui-utils";
import { buildSettingsInputKeyboard } from "../keyboards";
import type { TenantCallbackDeps } from "./types";

export const registerAdsCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { deliveryService } = deps.services;
  const { setSessionMode } = deps.session;
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
      await ctx.answerCallbackQuery({ text: "已移除上一页按钮，无需配置。", show_alert: true }).catch(() => ctx.answerCallbackQuery());
      await renderAdSettings(ctx);
      return;
    }
    if (kind === "next") {
      settingsInputStates.set(key, { mode: "adNext" });
      setSessionMode(key, "settingsInput");
      await upsertHtml(ctx, ["<b>✏️ 修改下一组文案</b>", "", "请发送新的按钮文案："].join("\n"), buildSettingsInputKeyboard());
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
      nextText: "下一组 ➡️",
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
      nextText: "下一组 ➡️",
      adButtonText: null,
      adButtonUrl: null
    });
    await ctx.answerCallbackQuery({ text: result.message }).catch(() => ctx.answerCallbackQuery());
    await renderAdSettings(ctx);
  });
};
