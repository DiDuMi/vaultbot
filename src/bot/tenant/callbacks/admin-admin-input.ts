import { InlineKeyboard } from "grammy";
import type { Bot, Context } from "grammy";
import { isSingleOwnerModeEnabled } from "../../../infra/runtime-mode";
import { buildBlockingHint, buildSuccessHint, escapeHtml, toMetaKey, upsertHtml } from "../ui-utils";
import { buildAdminInputKeyboard, buildAdminManageKeyboard, buildAdminRemoveConfirmKeyboard, buildHelpKeyboard } from "../keyboards";
import type { TenantCallbackDeps } from "./types";

export const registerAdminAndInputCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { deliveryService } = deps.services;
  const { getSessionMode, setSessionMode } = deps.session;
  const { adminInputStates, broadcastInputStates, settingsInputStates } = deps.states;
  const { renderAdSettings, renderBroadcast, renderSettings, renderWelcomeSettings } = deps.renderers;
  const renderAdminManage = async (ctx: Context, page = 1) => {
    if (isSingleOwnerModeEnabled()) {
      await upsertHtml(
        ctx,
        buildBlockingHint("当前为单人项目模式，已关闭多人管理员管理。"),
        new InlineKeyboard().text("⬅️ 返回设置", "help:settings")
      );
      return;
    }
    if (!deliveryService || !ctx.from) {
      await upsertHtml(ctx, buildBlockingHint("当前未启用数据库，无法管理管理员。"), new InlineKeyboard().text("⬅️ 返回设置", "help:settings"));
      return;
    }
    const actorUserId = String(ctx.from.id);
    const canManageProjectAdmins = await deliveryService.canManageProjectAdmins(actorUserId);
    if (!canManageProjectAdmins) {
      await upsertHtml(ctx, buildBlockingHint("无权限：仅管理员可管理管理员。"), new InlineKeyboard().text("⬅️ 返回设置", "help:settings"));
      return;
    }
    const admins = await deliveryService.listProjectManagers().catch(() => []);
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
    if (isSingleOwnerModeEnabled()) {
      await upsertHtml(
        ctx,
        buildBlockingHint("当前为单人项目模式，已关闭多人管理员管理。"),
        new InlineKeyboard().text("⬅️ 返回设置", "help:settings")
      );
      return;
    }
    if (!deliveryService) {
      await upsertHtml(ctx, buildBlockingHint("当前未启用数据库，无法添加管理员。"), new InlineKeyboard().text("⬅️ 返回设置", "help:settings"));
      return;
    }
    const actorUserId = String(ctx.from.id);
    const canManageProjectAdmins = await deliveryService.canManageProjectAdmins(actorUserId);
    if (!canManageProjectAdmins) {
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
    if (isSingleOwnerModeEnabled()) {
      await ctx.answerCallbackQuery();
      await upsertHtml(
        ctx,
        buildBlockingHint("当前为单人项目模式，已关闭多人管理员管理。"),
        new InlineKeyboard().text("⬅️ 返回设置", "help:settings")
      );
      return;
    }
    if (!deliveryService) {
      await ctx.answerCallbackQuery();
      await upsertHtml(ctx, buildBlockingHint("当前未启用数据库，无法移除管理员。"), new InlineKeyboard().text("⬅️ 返回设置", "help:settings"));
      return;
    }
    const actorUserId = String(ctx.from.id);
    const canManageProjectAdmins = await deliveryService.canManageProjectAdmins(actorUserId);
    if (!canManageProjectAdmins) {
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
    if (isSingleOwnerModeEnabled()) {
      await ctx.answerCallbackQuery();
      await upsertHtml(
        ctx,
        buildBlockingHint("当前为单人项目模式，已关闭多人管理员管理。"),
        new InlineKeyboard().text("⬅️ 返回设置", "help:settings")
      );
      return;
    }
    if (!deliveryService) {
      await ctx.answerCallbackQuery();
      await upsertHtml(ctx, buildBlockingHint("当前未启用数据库，无法移除管理员。"), new InlineKeyboard().text("⬅️ 返回设置", "help:settings"));
      return;
    }
    const actorUserId = String(ctx.from.id);
    const canManageProjectAdmins = await deliveryService.canManageProjectAdmins(actorUserId);
    if (!canManageProjectAdmins) {
      await ctx.answerCallbackQuery();
      await upsertHtml(ctx, buildBlockingHint("无权限：仅管理员可移除管理员。"), new InlineKeyboard().text("⬅️ 返回设置", "help:settings"));
      return;
    }
    const targetId = ctx.match?.[1] ?? "";
    const page = Number(ctx.match?.[2] ?? "1");
    const result = await deliveryService.removeProjectManager(actorUserId, targetId);
    await ctx.answerCallbackQuery({ text: result.message }).catch(() => ctx.answerCallbackQuery());
    await renderAdminManage(ctx, Number.isFinite(page) ? page : 1);
  });

  bot.callbackQuery(/^settings:admin:cancelremove:(\d+)$/, async (ctx) => {
    const page = Number(ctx.match?.[1] ?? "1");
    await ctx.answerCallbackQuery();
    await renderAdminManage(ctx, Number.isFinite(page) ? page : 1);
  });
};
