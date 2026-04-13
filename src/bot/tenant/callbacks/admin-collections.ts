import { InlineKeyboard } from "grammy";
import type { Bot } from "grammy";
import { escapeHtml, stripHtmlTags, toMetaKey, upsertHtml } from "../ui-utils";
import { logErrorThrottled } from "../../../infra/logging";
import { buildCollectionDeleteConfirmKeyboard, buildCollectionInputKeyboard } from "../keyboards";
import type { TenantCallbackDeps } from "./types";

export const registerCollectionsCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { deliveryService } = deps.services;
  const { isActive, setSessionMode } = deps.session;
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
      await deliveryService.setUserDefaultCollectionId(String(ctx.from.id), null).catch((error) =>
        logErrorThrottled(
          { component: "tenant_admin", op: "set_user_default_collection_id", scope: "select_none", userId: String(ctx.from.id) },
          error,
          { intervalMs: 30_000 }
        )
      );
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
      await deliveryService.setUserDefaultCollectionId(String(ctx.from.id), collectionId).catch((error) =>
        logErrorThrottled(
          { component: "tenant_admin", op: "set_user_default_collection_id", scope: "select_collection", userId: String(ctx.from.id), collectionId },
          error,
          { intervalMs: 30_000 }
        )
      );
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
      await deliveryService.setUserDefaultCollectionId(String(ctx.from.id), null).catch((error) =>
        logErrorThrottled(
          { component: "tenant_admin", op: "set_user_default_collection_id", scope: "delete_collection_cleanup", userId: String(ctx.from.id) },
          error,
          { intervalMs: 30_000 }
        )
      );
    }
    if (historyFilterStates.get(key) === collectionId) {
      historyFilterStates.delete(key);
      await deliveryService.setUserHistoryCollectionFilter(String(ctx.from.id), undefined).catch((error) =>
        logErrorThrottled(
          { component: "tenant_admin", op: "set_user_history_collection_filter", scope: "delete_collection_cleanup", userId: String(ctx.from.id) },
          error,
          { intervalMs: 30_000 }
        )
      );
    }
    await ctx.answerCallbackQuery({ text: result.message }).catch(() => ctx.answerCallbackQuery());
    await renderCollections(ctx, { returnTo: "settings" });
  });
};
