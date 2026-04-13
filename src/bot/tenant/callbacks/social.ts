import type { Bot } from "grammy";
import { replyHtml, toMetaKey, upsertHtml } from "../ui-utils";
import { buildFollowInputKeyboard, buildHelpKeyboard, buildHistoryFilterKeyboard } from "../keyboards";
import { logErrorThrottled } from "../../../infra/logging";
import type { TenantCallbackDeps } from "./types";

export const commentListCallbackRe = /^comment:list:([^:]+):(\d+)(?::(\d+))?$/;
export const historySetFilterCollectionCallbackRe = /^history:setfilter:collection:([^:]+)$/;
export const historyScopeCallbackRe = /^history:scope:(community|mine)$/;
export const historyMoreCallbackRe = /^history:(more|less):(\d+)$/;
export const footMoreCallbackRe = /^foot:(more|less):(open|like|comment|reply):(\d+):(7d|30d|all)$/;
export const tagOpenCallbackRe = /^tag:open:([^:]+):(\d+)$/;
export const tagPageCallbackRe = /^tag:page:([^:]+):(\d+)$/;
export const tagRefreshCallbackRe = /^tag:refresh:([^:]+):(\d+)$/;

export const registerCommentCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { setSessionMode } = deps.session;
  const { commentInputStates } = deps.states;
  const { openAsset, renderComments } = deps.renderers;

  bot.callbackQuery(commentListCallbackRe, async (ctx) => {
    const assetId = ctx.match?.[1];
    const page = Number(ctx.match?.[2] ?? "1");
    const returnToAssetPage = Number(ctx.match?.[3] ?? "NaN");
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!assetId) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    const key = toMetaKey(ctx.from.id, chatId);
    setSessionMode(key, "commentInput");
    const existing = commentInputStates.get(key);
    const nextReturnTo =
      Number.isFinite(returnToAssetPage) && returnToAssetPage >= 1
        ? returnToAssetPage
        : existing?.assetId === assetId
          ? existing.returnToAssetPage
          : 1;
    if (!existing || existing.assetId !== assetId) {
      commentInputStates.set(key, { assetId, replyToCommentId: null, replyToLabel: null, returnToAssetPage: nextReturnTo });
    } else if (existing.returnToAssetPage !== nextReturnTo) {
      commentInputStates.set(key, { ...existing, returnToAssetPage: nextReturnTo });
    }
    await ctx.answerCallbackQuery();
    await renderComments(ctx, assetId, Number.isFinite(page) ? page : 1, "edit");
  });

  bot.callbackQuery(/^comment:back:([^:]+)(?::(\d+))?$/, async (ctx) => {
    const assetId = ctx.match?.[1];
    const returnToAssetPage = Number(ctx.match?.[2] ?? "NaN");
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!assetId || !ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    const key = toMetaKey(ctx.from.id, chatId);
    const state = commentInputStates.get(key);
    const page =
      Number.isFinite(returnToAssetPage) && returnToAssetPage >= 1
        ? returnToAssetPage
        : state?.assetId === assetId
          ? state.returnToAssetPage ?? 1
          : 1;
    setSessionMode(key, "idle");
    await openAsset(ctx, assetId, page);
  });

  bot.callbackQuery(/^comment:reply:([^:]+):(\d+)$/, async (ctx) => {
    const commentId = ctx.match?.[1];
    const order = Number(ctx.match?.[2] ?? "0");
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!commentId || !ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    const key = toMetaKey(ctx.from.id, chatId);
    const state = commentInputStates.get(key);
    if (!state) {
      await ctx.answerCallbackQuery({ text: "评论已过期，请重新点“💬 评论”", show_alert: true });
      return;
    }
    setSessionMode(key, "commentInput");
    commentInputStates.set(key, {
      assetId: state.assetId,
      replyToCommentId: commentId,
      replyToLabel: order > 0 ? `#${order}` : "该评论",
      returnToAssetPage: state.returnToAssetPage
    });
    await ctx.answerCallbackQuery();
    await renderComments(ctx, state.assetId, 1, "edit");
  });

  bot.callbackQuery(/^comment:reply_cancel:(\d+)$/, async (ctx) => {
    const page = Number(ctx.match?.[1] ?? "1");
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    const key = toMetaKey(ctx.from.id, chatId);
    const state = commentInputStates.get(key);
    if (!state) {
      await ctx.answerCallbackQuery();
      return;
    }
    setSessionMode(key, "commentInput");
    commentInputStates.set(key, {
      assetId: state.assetId,
      replyToCommentId: null,
      replyToLabel: null,
      returnToAssetPage: state.returnToAssetPage
    });
    await ctx.answerCallbackQuery();
    await renderComments(ctx, state.assetId, Number.isFinite(page) ? page : 1, "edit");
  });

  bot.callbackQuery("comment:noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });
};

export const registerFootprintCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { renderFootprint } = deps.renderers;

  bot.callbackQuery("user:history", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderFootprint(ctx, "open", "30d", 1, "edit");
  });

  bot.callbackQuery(/^foot:tab:(open|like|comment|reply)$/, async (ctx) => {
    const tab = (ctx.match?.[1] ?? "open") as "open" | "like" | "comment" | "reply";
    await ctx.answerCallbackQuery();
    await renderFootprint(ctx, tab, "30d", 1, "edit");
  });

  bot.callbackQuery(/^foot:page:(open|like|comment|reply):(\d+):(7d|30d|all)$/, async (ctx) => {
    const tab = (ctx.match?.[1] ?? "open") as "open" | "like" | "comment" | "reply";
    const page = Number(ctx.match?.[2] ?? "1");
    await ctx.answerCallbackQuery();
    const range = (ctx.match?.[3] ?? "30d") as "7d" | "30d" | "all";
    await renderFootprint(ctx, tab, range, Number.isFinite(page) ? page : 1, "edit");
  });

  bot.callbackQuery(/^foot:refresh:(open|like|comment|reply):(\d+):(7d|30d|all)$/, async (ctx) => {
    const tab = (ctx.match?.[1] ?? "open") as "open" | "like" | "comment" | "reply";
    const page = Number(ctx.match?.[2] ?? "1");
    await ctx.answerCallbackQuery();
    const range = (ctx.match?.[3] ?? "30d") as "7d" | "30d" | "all";
    await renderFootprint(ctx, tab, range, Number.isFinite(page) ? page : 1, "edit");
  });

  bot.callbackQuery(/^foot:page:(open|like|comment|reply):(\d+)$/, async (ctx) => {
    const tab = (ctx.match?.[1] ?? "open") as "open" | "like" | "comment" | "reply";
    const page = Number(ctx.match?.[2] ?? "1");
    await ctx.answerCallbackQuery();
    await renderFootprint(ctx, tab, "30d", Number.isFinite(page) ? page : 1, "edit");
  });

  bot.callbackQuery(/^foot:refresh:(open|like|comment|reply):(\d+)$/, async (ctx) => {
    const tab = (ctx.match?.[1] ?? "open") as "open" | "like" | "comment" | "reply";
    const page = Number(ctx.match?.[2] ?? "1");
    await ctx.answerCallbackQuery();
    await renderFootprint(ctx, tab, "30d", Number.isFinite(page) ? page : 1, "edit");
  });

  bot.callbackQuery(/^foot:range:(open|like|comment|reply):(7d|30d|all)$/, async (ctx) => {
    const tab = (ctx.match?.[1] ?? "open") as "open" | "like" | "comment" | "reply";
    const current = (ctx.match?.[2] ?? "30d") as "7d" | "30d" | "all";
    const next = current === "7d" ? "30d" : current === "30d" ? "all" : "7d";
    await ctx.answerCallbackQuery();
    await renderFootprint(ctx, tab, next, 1, "edit", true);
  });

  bot.callbackQuery(footMoreCallbackRe, async (ctx) => {
    const action = ctx.match?.[1] ?? "more";
    const tab = (ctx.match?.[2] ?? "open") as "open" | "like" | "comment" | "reply";
    const page = Number(ctx.match?.[3] ?? "1");
    const range = (ctx.match?.[4] ?? "30d") as "7d" | "30d" | "all";
    await ctx.answerCallbackQuery();
    const showMoreActions = action === "more";
    await renderFootprint(ctx, tab, range, Number.isFinite(page) ? page : 1, "edit", showMoreActions);
  });

  bot.callbackQuery(/^uh:page:(\d+)$/, async (ctx) => {
    const page = Number(ctx.match?.[1] ?? "1");
    await ctx.answerCallbackQuery();
    await renderFootprint(ctx, "open", "30d", Number.isFinite(page) ? page : 1, "edit");
  });

  bot.callbackQuery(/^uh:refresh(?::(\d+))?$/, async (ctx) => {
    const page = Number(ctx.match?.[1] ?? "1");
    await ctx.answerCallbackQuery();
    await renderFootprint(ctx, "open", "30d", Number.isFinite(page) ? page : 1, "edit");
  });

  bot.callbackQuery("uh:noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("foot:noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });
};

export const registerHistoryCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { deliveryService } = deps.services;
  const { hydrateUserPreferences, syncSessionForView } = deps.session;
  const { historyDateStates, historyFilterStates, historyScopeStates } = deps.states;
  const { renderHistory } = deps.renderers;

  const startOfLocalDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayMs = 24 * 60 * 60 * 1000;

  bot.callbackQuery(/^history:page:(\d+)$/, async (ctx) => {
    const page = Number(ctx.match?.[1] ?? "1");
    if (!deliveryService) {
      await ctx.answerCallbackQuery({ text: "当前未启用数据库", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await renderHistory(ctx, Number.isFinite(page) ? page : 1);
  });

  bot.callbackQuery(/^history:refresh:(\d+)$/, async (ctx) => {
    const page = Number(ctx.match?.[1] ?? "1");
    if (!deliveryService) {
      await ctx.answerCallbackQuery({ text: "当前未启用数据库", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await renderHistory(ctx, Number.isFinite(page) ? page : 1);
  });

  bot.callbackQuery(historyMoreCallbackRe, async (ctx) => {
    const action = ctx.match?.[1] ?? "more";
    const page = Number(ctx.match?.[2] ?? "1");
    if (!deliveryService) {
      await ctx.answerCallbackQuery({ text: "当前未启用数据库", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    const showMoreActions = action === "more";
    await renderHistory(ctx, Number.isFinite(page) ? page : 1, undefined, showMoreActions);
  });

  bot.callbackQuery("history:day:prev", async (ctx) => {
    if (!deliveryService) {
      await ctx.answerCallbackQuery({ text: "当前未启用数据库", show_alert: true });
      return;
    }
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    const key = toMetaKey(ctx.from.id, chatId);
    const current =
      historyDateStates.get(key) ??
      (await deliveryService.getUserHistoryListDate(String(ctx.from.id)).catch((error) => {
        logErrorThrottled(
          { component: "tenant_social_callbacks", op: "get_user_history_list_date", scope: "day_prev", userId: String(ctx.from.id) },
          error,
          { intervalMs: 30_000 }
        );
        return undefined;
      })) ??
      startOfLocalDay(new Date());
    const selectedDate = new Date(startOfLocalDay(current).getTime() - dayMs);
    historyDateStates.set(key, selectedDate);
    await deliveryService.setUserHistoryListDate(String(ctx.from.id), selectedDate).catch((error) =>
      logErrorThrottled(
        { component: "tenant_social_callbacks", op: "set_user_history_list_date", scope: "day_prev", userId: String(ctx.from.id) },
        error,
        { intervalMs: 30_000 }
      )
    );
    await ctx.answerCallbackQuery();
    await renderHistory(ctx, 1);
  });

  bot.callbackQuery("history:day:next", async (ctx) => {
    if (!deliveryService) {
      await ctx.answerCallbackQuery({ text: "当前未启用数据库", show_alert: true });
      return;
    }
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    const key = toMetaKey(ctx.from.id, chatId);
    const todayStart = startOfLocalDay(new Date());
    const current =
      historyDateStates.get(key) ??
      (await deliveryService.getUserHistoryListDate(String(ctx.from.id)).catch((error) => {
        logErrorThrottled(
          { component: "tenant_social_callbacks", op: "get_user_history_list_date", scope: "day_next", userId: String(ctx.from.id) },
          error,
          { intervalMs: 30_000 }
        );
        return undefined;
      })) ??
      todayStart;
    const next = new Date(startOfLocalDay(current).getTime() + dayMs);
    const selectedDate = next.getTime() > todayStart.getTime() ? todayStart : next;
    historyDateStates.set(key, selectedDate);
    await deliveryService.setUserHistoryListDate(String(ctx.from.id), selectedDate).catch((error) =>
      logErrorThrottled(
        { component: "tenant_social_callbacks", op: "set_user_history_list_date", scope: "day_next", userId: String(ctx.from.id) },
        error,
        { intervalMs: 30_000 }
      )
    );
    await ctx.answerCallbackQuery();
    await renderHistory(ctx, 1);
  });

  bot.callbackQuery("history:day:today", async (ctx) => {
    if (!deliveryService) {
      await ctx.answerCallbackQuery({ text: "当前未启用数据库", show_alert: true });
      return;
    }
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    const key = toMetaKey(ctx.from.id, chatId);
    const todayStart = startOfLocalDay(new Date());
    historyDateStates.set(key, todayStart);
    await deliveryService.setUserHistoryListDate(String(ctx.from.id), todayStart).catch((error) =>
      logErrorThrottled(
        { component: "tenant_social_callbacks", op: "set_user_history_list_date", scope: "day_today", userId: String(ctx.from.id) },
        error,
        { intervalMs: 30_000 }
      )
    );
    await ctx.answerCallbackQuery();
    await renderHistory(ctx, 1);
  });

  bot.callbackQuery("history:noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(historyScopeCallbackRe, async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    const scope = (ctx.match?.[1] ?? "community") as "community" | "mine";
    if (ctx.from && chatId) {
      historyScopeStates.set(toMetaKey(ctx.from.id, chatId), scope);
    }
    await ctx.answerCallbackQuery();
    await renderHistory(ctx, 1, scope);
  });

  bot.callbackQuery("history:filter", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!deliveryService) {
      await ctx.answerCallbackQuery({ text: "当前未启用数据库", show_alert: true });
      return;
    }
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    syncSessionForView(ctx);
    await hydrateUserPreferences(ctx);
    const key = toMetaKey(ctx.from.id, chatId);
    const filter = historyFilterStates.get(key);
    const current = filter === undefined ? "all" : filter === null ? "none" : `c:${filter}`;
    const collections = await deliveryService.listCollections();
    await ctx.answerCallbackQuery();
    await upsertHtml(ctx, ["<b>📁 列表筛选</b>", "", "请选择要查看的分类："].join("\n"), buildHistoryFilterKeyboard(collections, current));
  });

  bot.callbackQuery("history:back", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderHistory(ctx, 1);
  });

  bot.callbackQuery("history:setfilter:all", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (ctx.from && chatId) {
      historyFilterStates.delete(toMetaKey(ctx.from.id, chatId));
      if (deliveryService) {
        await deliveryService.setUserHistoryCollectionFilter(String(ctx.from.id), undefined).catch((error) =>
          logErrorThrottled(
            { component: "tenant_social_callbacks", op: "set_user_history_collection_filter", scope: "filter_all", userId: String(ctx.from.id) },
            error,
            { intervalMs: 30_000 }
          )
        );
      }
    }
    await ctx.answerCallbackQuery();
    await renderHistory(ctx, 1);
  });

  bot.callbackQuery("history:setfilter:none", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (ctx.from && chatId) {
      historyFilterStates.set(toMetaKey(ctx.from.id, chatId), null);
      if (deliveryService) {
        await deliveryService.setUserHistoryCollectionFilter(String(ctx.from.id), null).catch((error) =>
          logErrorThrottled(
            { component: "tenant_social_callbacks", op: "set_user_history_collection_filter", scope: "filter_none", userId: String(ctx.from.id) },
            error,
            { intervalMs: 30_000 }
          )
        );
      }
    }
    await ctx.answerCallbackQuery();
    await renderHistory(ctx, 1);
  });

  bot.callbackQuery(historySetFilterCollectionCallbackRe, async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    const collectionId = ctx.match?.[1] ?? "";
    if (ctx.from && chatId) {
      historyFilterStates.set(toMetaKey(ctx.from.id, chatId), collectionId);
      if (deliveryService) {
        await deliveryService.setUserHistoryCollectionFilter(String(ctx.from.id), collectionId).catch((error) =>
          logErrorThrottled(
            { component: "tenant_social_callbacks", op: "set_user_history_collection_filter", scope: "filter_collection", userId: String(ctx.from.id), collectionId },
            error,
            { intervalMs: 30_000 }
          )
        );
      }
    }
    await ctx.answerCallbackQuery();
    await renderHistory(ctx, 1);
  });
};

export const registerFollowCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { deliveryService } = deps.services;
  const { setSessionMode } = deps.session;
  const { renderFollow, renderMy } = deps.renderers;

  bot.callbackQuery("my:show", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderMy(ctx);
  });

  bot.callbackQuery("follow:show", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderFollow(ctx);
  });

  bot.callbackQuery("follow:add", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    setSessionMode(toMetaKey(ctx.from.id, chatId), "followInput");
    await ctx.answerCallbackQuery();
    await upsertHtml(ctx, ["<b>➕ 添加关键词</b>", "", "发送关键词（可用逗号/换行分隔），最多 5 个。"].join("\n"), buildFollowInputKeyboard());
  });

  bot.callbackQuery("follow:cancel", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    setSessionMode(toMetaKey(ctx.from.id, chatId), "idle");
    await ctx.answerCallbackQuery();
    await renderFollow(ctx);
  });

  bot.callbackQuery("follow:clear", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!deliveryService) {
      await ctx.answerCallbackQuery({ text: "当前未启用数据库", show_alert: true });
      return;
    }
    setSessionMode(toMetaKey(ctx.from.id, chatId), "idle");
    const result = await deliveryService.setUserFollowKeywords(String(ctx.from.id), []);
    await ctx.answerCallbackQuery({ text: result.message });
    await renderFollow(ctx);
  });

  bot.callbackQuery(/^follow:remove:(\d+)$/, async (ctx) => {
    const index = Number(ctx.match?.[1] ?? "-1");
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!deliveryService) {
      await ctx.answerCallbackQuery({ text: "当前未启用数据库", show_alert: true });
      return;
    }
    const userId = String(ctx.from.id);
    const keywords = await deliveryService.getUserFollowKeywords(userId).catch(() => []);
    if (!Number.isFinite(index) || index < 0 || index >= keywords.length) {
      await ctx.answerCallbackQuery({ text: "关键词不存在" });
      return;
    }
    const next = keywords.filter((_, i) => i !== index);
    const result = await deliveryService.setUserFollowKeywords(userId, next);
    setSessionMode(toMetaKey(ctx.from.id, chatId), "idle");
    await ctx.answerCallbackQuery({ text: result.message });
    await renderFollow(ctx);
  });

  bot.callbackQuery("follow:noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });
};

export const registerNotifyCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { deliveryService } = deps.services;
  const { renderNotifySettings } = deps.renderers;

  bot.callbackQuery("notify:show", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderNotifySettings(ctx);
  });

  bot.callbackQuery(/^notify:toggle:(follow|comment):(0|1)$/, async (ctx) => {
    if (!deliveryService || !ctx.from) {
      await ctx.answerCallbackQuery({ text: "当前未启用数据库", show_alert: true });
      return;
    }
    const kind = (ctx.match?.[1] ?? "") as "follow" | "comment";
    const enabled = ctx.match?.[2] === "1";
    const userId = String(ctx.from.id);
    const result =
      kind === "follow"
        ? await deliveryService.setUserNotifySettings(userId, { followEnabled: enabled })
        : await deliveryService.setUserNotifySettings(userId, { commentEnabled: enabled });
    await ctx.answerCallbackQuery({ text: result.message }).catch(() => ctx.answerCallbackQuery());
    await renderNotifySettings(ctx);
  });

  bot.callbackQuery("notify:noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });
};

export const registerHelpCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { deliveryService } = deps.services;
  const { renderHelp, renderHistory } = deps.renderers;
  const { historyDateStates, historyScopeStates } = deps.states;

  bot.callbackQuery("help:show", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderHelp(ctx);
  });

  bot.callbackQuery("help:list", async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (ctx.from && chatId && deliveryService) {
      const key = toMetaKey(ctx.from.id, chatId);
      historyScopeStates.set(key, "community");
      if (!historyDateStates.has(key)) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        historyDateStates.set(key, today);
        await deliveryService.setUserHistoryListDate(String(ctx.from.id), today).catch((error) =>
          logErrorThrottled(
            { component: "tenant_social_callbacks", op: "set_user_history_list_date", scope: "help_list", userId: String(ctx.from.id) },
            error,
            { intervalMs: 30_000 }
          )
        );
      }
    }
    await renderHistory(ctx, 1, "community");
  });
};

export const registerSearchCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { mainKeyboard } = deps.session;
  const { searchStates } = deps.states;
  const { renderSearch } = deps.renderers;

  bot.callbackQuery(/^search:page:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from || !ctx.chat) {
      return;
    }
    const key = toMetaKey(ctx.from.id, ctx.chat.id);
    const state = searchStates.get(key);
    if (!state) {
      await upsertHtml(ctx, "⚠️ 搜索已过期，请重新发送：<code>搜索 关键词</code>。", buildHelpKeyboard());
      return;
    }
    const page = Number(ctx.match?.[1] ?? "1");
    await renderSearch(ctx, state.query, Number.isFinite(page) ? page : 1, "edit");
  });

  bot.callbackQuery("search:refresh", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from || !ctx.chat) {
      return;
    }
    const key = toMetaKey(ctx.from.id, ctx.chat.id);
    const state = searchStates.get(key);
    if (!state) {
      await upsertHtml(ctx, "⚠️ 搜索已过期，请重新发送：<code>搜索 关键词</code>。", buildHelpKeyboard());
      return;
    }
    await renderSearch(ctx, state.query, 1, "edit");
  });
};

export const registerTagCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { renderTagIndex, renderTagAssets } = deps.renderers;

  bot.callbackQuery("tags:show", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderTagIndex(ctx, "edit");
  });

  bot.callbackQuery("tags:refresh", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderTagIndex(ctx, "edit");
  });

  bot.callbackQuery(tagOpenCallbackRe, async (ctx) => {
    await ctx.answerCallbackQuery();
    const tagId = ctx.match?.[1] ?? "";
    const page = Number(ctx.match?.[2] ?? "1");
    if (!tagId) {
      return;
    }
    await renderTagAssets(ctx, tagId, Number.isFinite(page) ? page : 1, "edit");
  });

  bot.callbackQuery(tagPageCallbackRe, async (ctx) => {
    await ctx.answerCallbackQuery();
    const tagId = ctx.match?.[1] ?? "";
    const page = Number(ctx.match?.[2] ?? "1");
    if (!tagId) {
      return;
    }
    await renderTagAssets(ctx, tagId, Number.isFinite(page) ? page : 1, "edit");
  });

  bot.callbackQuery(tagRefreshCallbackRe, async (ctx) => {
    await ctx.answerCallbackQuery();
    const tagId = ctx.match?.[1] ?? "";
    const page = Number(ctx.match?.[2] ?? "1");
    if (!tagId) {
      return;
    }
    await renderTagAssets(ctx, tagId, Number.isFinite(page) ? page : 1, "edit");
  });
};
