import { InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import type { DeliveryService } from "../../services/use-cases";
import { buildHelpKeyboard } from "./keyboards";
import { buildDbDisabledHint, editHtml, escapeHtml, replyHtml, sanitizeTelegramHtml } from "./ui-utils";

export const createSearchRenderer = (deps: {
  deliveryService: DeliveryService | null;
  mainKeyboard: NonNullable<Parameters<Context["reply"]>[1]>["reply_markup"];
  buildAssetActionLine: (options: { username?: string; shareCode?: string | null; assetId: string; canManage: boolean }) => string;
}) => {
  const buildSearchKeyboard = (currentPage: number, totalPages: number) => {
    const keyboard = new InlineKeyboard();
    if (totalPages > 1) {
      if (currentPage > 1) {
        keyboard.text("⬅️ 上一页", `search:page:${currentPage - 1}`);
      }
      if (currentPage < totalPages) {
        keyboard.text("下一页 ➡️", `search:page:${currentPage + 1}`);
      }
      keyboard.row().text("🔄 刷新", "search:refresh");
    }
    keyboard.row().text("📚 列表", "help:list").text("🏠 首页", "home:back");
    return keyboard;
  };

  return async (ctx: Context, query: string, page: number, mode: "reply" | "edit") => {
    if (!deps.deliveryService) {
      await replyHtml(ctx, buildDbDisabledHint("搜索"), { reply_markup: deps.mainKeyboard });
      return;
    }
    if (!ctx.from) {
      await replyHtml(ctx, "⚠️ 无法识别当前用户。", { reply_markup: deps.mainKeyboard });
      return;
    }
    const userId = String(ctx.from.id);
    const searchMode = await deps.deliveryService.getTenantSearchMode().catch(() => "ENTITLED_ONLY" as const);
    if (searchMode === "OFF") {
      await replyHtml(ctx, "🔒 租户已关闭搜索。", { reply_markup: buildHelpKeyboard() });
      return;
    }
    const isTenant = await deps.deliveryService.isTenantUser(userId).catch(() => false);
    const canManageViewer = isTenant ? await deps.deliveryService.canManageAdmins(userId).catch(() => false) : false;
    if (!isTenant && searchMode !== "PUBLIC") {
      await replyHtml(ctx, "🔒 租户未开放搜索。", { reply_markup: buildHelpKeyboard() });
      return;
    }
    const safeQuery = query.trim();
    if (safeQuery.length < 2) {
      await replyHtml(ctx, "请输入更长的关键词，例如：<code>搜索 教程</code>。", { reply_markup: deps.mainKeyboard });
      return;
    }

    const pageSize = 10;
    let data = await deps.deliveryService.searchAssets(userId, safeQuery, page, pageSize).catch(() => null);
    if (!data || data.total === 0) {
      const text = [`🔍 未找到相关内容：<code>${escapeHtml(safeQuery)}</code>`, "", "你可以尝试：", "1) 更换关键词", "2) 发送 <code>标签</code> 浏览热门标签", "3) 点底部 <b>📚 列表</b> 查看全部"].join("\n");
      if (mode === "edit") {
        await editHtml(ctx, text, { reply_markup: buildSearchKeyboard(1, 1) });
      } else {
        await replyHtml(ctx, text, { reply_markup: buildSearchKeyboard(1, 1) });
      }
      return;
    }

    const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
    const currentPage = Math.min(Math.max(page, 1), totalPages);
    if (data.items.length === 0 && currentPage !== page) {
      data = await deps.deliveryService.searchAssets(userId, safeQuery, currentPage, pageSize).catch(() => null);
      if (!data || data.total === 0) {
        const text = [`🔍 未找到相关内容：<code>${escapeHtml(safeQuery)}</code>`, "", "你可以尝试：", "1) 更换关键词", "2) 发送 <code>标签</code> 浏览热门标签", "3) 点底部 <b>📚 列表</b> 查看全部"].join("\n");
        if (mode === "edit") {
          await editHtml(ctx, text, { reply_markup: buildSearchKeyboard(1, 1) });
        } else {
          await replyHtml(ctx, text, { reply_markup: buildSearchKeyboard(1, 1) });
        }
        return;
      }
    }

    const username = ctx.me?.username;
    const content = data.items
      .map((item, index) => {
        const order = (currentPage - 1) * pageSize + index + 1;
        const safeTitle = sanitizeTelegramHtml(item.title);
        return [
          safeTitle ? `<b>${order}. ${safeTitle}</b>` : `<b>${order}.</b>`,
          deps.buildAssetActionLine({
            username,
            shareCode: item.shareCode,
            assetId: item.assetId,
            canManage: canManageViewer
          })
        ]
          .filter(Boolean)
          .join("\n");
      })
      .filter(Boolean)
      .join("\n\n");

    const text = `<b>🔎 搜索结果</b>：<code>${escapeHtml(safeQuery)}</code>\n（第 ${currentPage}/${totalPages} 页，共 ${data.total} 条）\n\n${content}`;
    const keyboard = buildSearchKeyboard(currentPage, totalPages);
    if (mode === "edit") {
      await editHtml(ctx, text, { reply_markup: keyboard });
    } else {
      await replyHtml(ctx, text, { reply_markup: keyboard });
    }
  };
};
