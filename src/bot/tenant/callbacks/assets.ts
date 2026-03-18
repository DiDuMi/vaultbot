import type { Bot, Context } from "grammy";
import { editHtml, escapeHtml, replyHtml, sanitizeTelegramHtml, stripHtmlTags, toMetaKey, upsertHtml } from "../ui-utils";
import { buildHelpKeyboard, buildManageRecycleConfirmKeyboard, buildRecycleBinKeyboard } from "../keyboards";
import type { TenantCallbackDeps } from "./types";

export const registerAssetManageCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { renderManagePanel } = deps.renderers;
  bot.callbackQuery(/^asset:manage:([^:]+)$/, async (ctx) => {
    const assetId = ctx.match?.[1];
    if (!assetId) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    await renderManagePanel(ctx, assetId);
  });
};

export const registerUploadCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { batchActions } = deps.services;
  const { setSessionMode } = deps.session;
  const { startMeta } = deps.renderers;

  bot.callbackQuery("upload:commit", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    const result = await batchActions.commit(ctx.from.id, chatId);
    setSessionMode(toMetaKey(ctx.from.id, chatId), "idle");
    const message = `${result.message}\n\n点击下方 <b>分享</b> 开始接收文件。`;
    await editHtml(ctx, message).catch(async () => {
      await replyHtml(ctx, message);
    });
    if (result.ok && result.assetId) {
      await startMeta(ctx, result.assetId, "create");
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("upload:cancel", async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      await ctx.answerCallbackQuery();
      return;
    }
    const result = await batchActions.cancel(ctx.from.id, chatId);
    setSessionMode(toMetaKey(ctx.from.id, chatId), "idle");
    const message = `${result.message}\n\n点击下方 <b>分享</b> 重新开始。`;
    await editHtml(ctx, message).catch(async () => {
      await replyHtml(ctx, message);
    });
    await ctx.answerCallbackQuery();
  });
};

export const registerAssetCallbacks = (bot: Bot, deps: TenantCallbackDeps) => {
  const { deliveryService } = deps.services;
  const { openAsset, refreshAssetActions, renderManagePanel, startMeta } = deps.renderers;
  const renderRecycleBin = async (ctx: Context, page = 1) => {
    if (!deliveryService || !ctx.from) {
      await upsertHtml(ctx, "⚠️ 当前未启用数据库，无法查看回收站。", buildHelpKeyboard());
      return;
    }
    const data = await deliveryService.listUserRecycledAssets(String(ctx.from.id), page, 10);
    const totalPages = Math.max(1, Math.ceil(data.total / 10));
    const currentPage = Math.min(Math.max(page, 1), totalPages);
    if (data.total === 0) {
      await upsertHtml(ctx, "<b>🗂 回收站</b>\n\n📭 暂无回收内容。", buildRecycleBinKeyboard([], 1, 1));
      return;
    }
    const content = data.items
      .map((item, index) => {
        const order = (currentPage - 1) * 10 + index + 1;
        const title = escapeHtml(stripHtmlTags(item.title));
        const desc = item.description ? sanitizeTelegramHtml(item.description) : "";
        return [
          `${order}. <b>${title}</b>`,
          item.shareCode ? `打开哈希：<code>${escapeHtml(item.shareCode)}</code>` : "",
          desc ? `<blockquote expandable>${desc}</blockquote>` : ""
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
    await upsertHtml(
      ctx,
      ["<b>🗂 回收站</b>", "", `共 <b>${data.total}</b> 条（每页 10 条）`, "", content].join("\n"),
      buildRecycleBinKeyboard(data.items.map((item) => ({ assetId: item.assetId, title: item.title })), currentPage, totalPages)
    );
  };

  bot.callbackQuery(/^asset:open:([^:]+)$/, async (ctx) => {
    const assetId = ctx.match?.[1];
    if (assetId) {
      await openAsset(ctx, assetId, 1);
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^asset:like:([^:]+)$/, async (ctx) => {
    const assetId = ctx.match?.[1];
    if (!assetId || !ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!deliveryService) {
      await ctx.answerCallbackQuery({ text: "当前未启用数据库", show_alert: true });
      return;
    }
    const result = await deliveryService.toggleAssetLike(String(ctx.from.id), assetId);
    await ctx.answerCallbackQuery({ text: result.message, show_alert: false }).catch(() => undefined);
    await refreshAssetActions(ctx, assetId);
  });

  bot.callbackQuery(/^asset:page:([^:]+):(\d+)$/, async (ctx) => {
    const assetId = ctx.match?.[1];
    const page = Number(ctx.match?.[2] ?? "1");
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
    if (assetId) {
      await openAsset(ctx, assetId, page);
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("asset:noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^asset:meta:([^:]+)$/, async (ctx) => {
    const assetId = ctx.match?.[1];
    if (!assetId || !ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!deliveryService) {
      await ctx.answerCallbackQuery({ text: "当前未启用数据库", show_alert: true });
      return;
    }
    const meta = await deliveryService.getUserAssetMeta(String(ctx.from.id), assetId);
    if (!meta) {
      await ctx.answerCallbackQuery({ text: "无权限或内容不存在", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await startMeta(ctx, assetId, "edit");
  });

  bot.callbackQuery(/^asset:searchable:([^:]+):([01])$/, async (ctx) => {
    const assetId = ctx.match?.[1];
    const value = ctx.match?.[2];
    if (!assetId || !ctx.from || !value) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!deliveryService) {
      await ctx.answerCallbackQuery({ text: "当前未启用数据库", show_alert: true });
      return;
    }
    const result = await deliveryService.setUserAssetSearchable(String(ctx.from.id), assetId, value === "1");
    await ctx.answerCallbackQuery({ text: result.message, show_alert: !result.ok }).catch(() => undefined);
    await renderManagePanel(ctx, assetId);
  });

  bot.callbackQuery(/^asset:recycle:([^:]+)$/, async (ctx) => {
    const assetId = ctx.match?.[1];
    if (!assetId || !ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!deliveryService) {
      await ctx.answerCallbackQuery({ text: "当前未启用数据库", show_alert: true });
      return;
    }
    const meta = await deliveryService.getUserAssetMeta(String(ctx.from.id), assetId);
    if (!meta) {
      await ctx.answerCallbackQuery({ text: "无权限或内容不存在", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await upsertHtml(
      ctx,
      ["<b>⚠️ 回收内容</b>", "", `将回收：<b>${meta.title}</b>`, "回收后对用户不可见，可在管理模式恢复。"].join("\n"),
      buildManageRecycleConfirmKeyboard(assetId)
    );
  });

  bot.callbackQuery(/^asset:recycle:confirm:([^:]+)$/, async (ctx) => {
    const assetId = ctx.match?.[1];
    if (!assetId || !ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!deliveryService) {
      await ctx.answerCallbackQuery({ text: "当前未启用数据库", show_alert: true });
      return;
    }
    const result = await deliveryService.recycleUserAsset(String(ctx.from.id), assetId);
    await ctx.answerCallbackQuery({ text: result.message, show_alert: !result.ok }).catch(() => undefined);
    if (result.ok) {
      await renderManagePanel(ctx, assetId);
      return;
    }
    await renderManagePanel(ctx, assetId);
  });

  bot.callbackQuery(/^asset:recycle:restore:([^:]+)$/, async (ctx) => {
    const assetId = ctx.match?.[1];
    if (!assetId || !ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!deliveryService) {
      await ctx.answerCallbackQuery({ text: "当前未启用数据库", show_alert: true });
      return;
    }
    const result = await deliveryService.restoreUserAsset(String(ctx.from.id), assetId);
    await ctx.answerCallbackQuery({ text: result.message, show_alert: !result.ok }).catch(() => undefined);
    if (result.ok) {
      await renderManagePanel(ctx, assetId);
      return;
    }
    await upsertHtml(ctx, result.message, buildHelpKeyboard());
  });

  bot.callbackQuery(/^asset:recycle:list:(\d+)$/, async (ctx) => {
    const page = Number(ctx.match?.[1] ?? "1");
    await ctx.answerCallbackQuery();
    await renderRecycleBin(ctx, Number.isFinite(page) ? page : 1);
  });

  bot.callbackQuery(/^asset:recycle:restore_page:(\d+)$/, async (ctx) => {
    const page = Number(ctx.match?.[1] ?? "1");
    if (!deliveryService || !ctx.from) {
      await ctx.answerCallbackQuery({ text: "当前未启用数据库", show_alert: true });
      return;
    }
    const data = await deliveryService.listUserRecycledAssets(String(ctx.from.id), Number.isFinite(page) ? page : 1, 10);
    const ids = data.items.map((item) => item.assetId);
    const result = await deliveryService.restoreUserAssets(String(ctx.from.id), ids);
    await ctx.answerCallbackQuery({ text: result.message, show_alert: !result.ok }).catch(() => undefined);
    await renderRecycleBin(ctx, Number.isFinite(page) ? page : 1);
  });
};
