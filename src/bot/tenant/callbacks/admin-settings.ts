import { InlineKeyboard } from "grammy";
import type { Bot } from "grammy";
import { escapeHtml, stripHtmlTags, toMetaKey, upsertHtml } from "../ui-utils";
import {
  buildHelpKeyboard,
  buildSettingsInputKeyboard
} from "../keyboards";
import type { TenantCallbackDeps } from "./types";

export const registerSettingsCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { deliveryService } = deps.services;
  const { setSessionMode } = deps.session;
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
  const isSingleOwnerModeEnabled = () => {
    const raw = (process.env.SINGLE_OWNER_MODE || "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
  };

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
    if (isSingleOwnerModeEnabled()) {
      await upsertHtml(ctx, "当前为单人项目模式，已关闭多存储群管理。", new InlineKeyboard().text("⬅️ 返回存储群", "settings:vault"));
      return;
    }
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
    if (isSingleOwnerModeEnabled()) {
      await upsertHtml(ctx, "当前为单人项目模式，已关闭多存储群管理。", new InlineKeyboard().text("⬅️ 返回存储群", "settings:vault"));
      return;
    }
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
    if (isSingleOwnerModeEnabled()) {
      await upsertHtml(ctx, "当前为单人项目模式，已关闭多存储群管理。", new InlineKeyboard().text("⬅️ 返回存储群", "settings:vault"));
      return;
    }
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
    if (isSingleOwnerModeEnabled()) {
      await upsertHtml(ctx, "当前为单人项目模式，已关闭多存储群管理。", new InlineKeyboard().text("⬅️ 返回存储群", "settings:vault"));
      return;
    }
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
