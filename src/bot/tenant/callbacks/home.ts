import type { Bot } from "grammy";
import { toMetaKey } from "../ui-utils";
import type { TenantCallbackDeps } from "./types";

export const rankMoreCallbackRe = /^rank:(more|less):(today|week|month):(open|visit|like|comment)$/;

export const registerHomeCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { renderStartHome, renderStats, renderRanking } = deps.renderers;

  bot.callbackQuery("home:back", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderStartHome(ctx);
  });

  bot.callbackQuery("home:stats", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderStats(ctx);
  });

  bot.callbackQuery("home:rank", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderRanking(ctx, "month", "open");
  });
};

export const registerRankingCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { rankingViewStates } = deps.states;
  const { renderRanking } = deps.renderers;

  bot.callbackQuery(/^rank:range:(today|week|month)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const range = (ctx.match?.[1] ?? "month") as "today" | "week" | "month";
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    const metric = chatId && ctx.from ? rankingViewStates.get(toMetaKey(ctx.from.id, chatId))?.metric ?? "open" : "open";
    await renderRanking(ctx, range, metric);
  });

  bot.callbackQuery(/^rank:metric:(open|visit|like|comment)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const metric = (ctx.match?.[1] ?? "open") as "open" | "visit" | "like" | "comment";
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    const range = chatId && ctx.from ? rankingViewStates.get(toMetaKey(ctx.from.id, chatId))?.range ?? "month" : "month";
    await renderRanking(ctx, range, metric);
  });

  bot.callbackQuery(rankMoreCallbackRe, async (ctx) => {
    await ctx.answerCallbackQuery();
    const action = ctx.match?.[1] ?? "more";
    const range = (ctx.match?.[2] ?? "month") as "today" | "week" | "month";
    const metric = (ctx.match?.[3] ?? "open") as "open" | "visit" | "like" | "comment";
    await renderRanking(ctx, range, metric, action === "more");
  });
};
