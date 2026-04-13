import { InlineKeyboard } from "grammy";
import type { Keyboard } from "grammy";
import type { Context } from "grammy";
import type { DeliveryService } from "../../services/use-cases";
import { buildHelpKeyboard } from "./keyboards";
import { buildAssetActionLine } from "./builders";
import { buildDbDisabledHint, editHtml, escapeHtml, replyHtml, safeCallbackData, sanitizeTelegramHtml } from "./ui-utils";

export const createTagRenderers = (deps: {
  deliveryService: DeliveryService | null;
  mainKeyboard: InlineKeyboard | Keyboard;
}) => {
  const buildTagAssetsKeyboard = (tagId: string, currentPage: number, totalPages: number) => {
    const keyboard = new InlineKeyboard();
    if (totalPages > 1) {
      if (currentPage > 1) {
        keyboard.text("⬅️ 上一页", safeCallbackData(`tag:page:${tagId}:${currentPage - 1}`, "asset:noop"));
      }
      if (currentPage < totalPages) {
        keyboard.text("下一页 ➡️", safeCallbackData(`tag:page:${tagId}:${currentPage + 1}`, "asset:noop"));
      }
      keyboard.row().text("🔄 刷新", safeCallbackData(`tag:refresh:${tagId}:${currentPage}`, "asset:noop"));
    } else {
      keyboard.row().text("🔄 刷新", safeCallbackData(`tag:refresh:${tagId}:1`, "asset:noop"));
    }
    keyboard.row().text("🏷 标签", "tags:show").text("📎 列表", "help:list").text("🏔 首页", "home:back");
    return keyboard;
  };

  const buildTagIndexKeyboard = (items: { tagId: string; name: string }[]) => {
    const keyboard = new InlineKeyboard();
    for (const item of items.slice(0, 20)) {
      keyboard.row().text(`#${item.name}`, safeCallbackData(`tag:open:${item.tagId}:1`, "asset:noop"));
    }
    keyboard.row().text("🔄 刷新", "tags:refresh").text("📎 列表", "help:list").text("🏔 首页", "home:back");
    return keyboard;
  };

  const renderTagIndex = async (ctx: Context, mode: "reply" | "edit") => {
    if (!deps.deliveryService) {
      await replyHtml(ctx, buildDbDisabledHint("查看标签"), { reply_markup: deps.mainKeyboard });
      return;
    }
    if (!ctx.from) {
      await replyHtml(ctx, "无法识别当前用户。", { reply_markup: deps.mainKeyboard });
      return;
    }
    const userId = String(ctx.from.id);
    const searchMode = await deps.deliveryService.getTenantSearchMode().catch(() => "ENTITLED_ONLY" as const);
    if (searchMode === "OFF") {
      await replyHtml(ctx, "租户已关闭搜索。", { reply_markup: buildHelpKeyboard() });
      return;
    }
    const isTenant = await deps.deliveryService.isTenantUser(userId).catch(() => false);
    if (!isTenant && searchMode !== "PUBLIC") {
      await replyHtml(ctx, "租户未开放搜索。", { reply_markup: buildHelpKeyboard() });
      return;
    }
    const items = await deps.deliveryService.listTopTags(50).catch(() => []);
    const content =
      items.length === 0
        ? "暂无标签。\n发布内容时在标题/描述里写 <code>#标签</code>，保存后会自动归档。"
        : items
            .slice(0, 20)
            .map((t, i) => `${i + 1}. <b>#${escapeHtml(t.name)}</b>（${t.count}）`)
            .join("\n");
    const text = ["<b>🏷 标签</b>", "", "发送 <code>#标签</code> 可查看合集。", "", content].join("\n");
    const keyboard = buildTagIndexKeyboard(items);
    if (mode === "edit") {
      await editHtml(ctx, text, { reply_markup: keyboard });
    } else {
      await replyHtml(ctx, text, { reply_markup: keyboard });
    }
  };

  const renderTagAssets = async (ctx: Context, tagId: string, page: number, mode: "reply" | "edit") => {
    if (!deps.deliveryService) {
      await replyHtml(ctx, buildDbDisabledHint("查看标签"), { reply_markup: deps.mainKeyboard });
      return;
    }
    if (!ctx.from) {
      await replyHtml(ctx, "无法识别当前用户。", { reply_markup: deps.mainKeyboard });
      return;
    }
    const userId = String(ctx.from.id);
    const searchMode = await deps.deliveryService.getTenantSearchMode().catch(() => "ENTITLED_ONLY" as const);
    if (searchMode === "OFF") {
      await replyHtml(ctx, "租户已关闭搜索。", { reply_markup: buildHelpKeyboard() });
      return;
    }
    const isTenant = await deps.deliveryService.isTenantUser(userId).catch(() => false);
    const canManageViewer = isTenant ? await deps.deliveryService.canManageAdmins(userId).catch(() => false) : false;
    if (!isTenant && searchMode !== "PUBLIC") {
      await replyHtml(ctx, "租户未开放搜索。", { reply_markup: buildHelpKeyboard() });
      return;
    }
    const tag = await deps.deliveryService.getTagById(tagId).catch(() => null);
    if (!tag) {
      const text = "标签不存在或已删除。";
      const keyboard = new InlineKeyboard().text("🏷 标签", "tags:show");
      if (mode === "edit") {
        await editHtml(ctx, text, { reply_markup: keyboard });
      } else {
        await replyHtml(ctx, text, { reply_markup: keyboard });
      }
      return;
    }
    const safePage = Number.isFinite(page) ? page : 1;
    const pageSize = 10;
    const data = await deps.deliveryService.listAssetsByTagId(userId, tagId, safePage, pageSize).catch(() => null);
    if (!data || data.total === 0) {
      const text = `未找到内容：<code>#${escapeHtml(tag.name)}</code>`;
      const keyboard = buildTagAssetsKeyboard(tagId, 1, 1);
      if (mode === "edit") {
        await editHtml(ctx, text, { reply_markup: keyboard });
      } else {
        await replyHtml(ctx, text, { reply_markup: keyboard });
      }
      return;
    }
    const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
    const currentPage = Math.min(Math.max(safePage, 1), totalPages);
    const username = ctx.me?.username;
    const content = data.items
      .map((item) => {
        const safeTitle = sanitizeTelegramHtml(item.title);
        const titleLine = safeTitle ? `<b>${safeTitle}</b>` : "";
        const actionLine = buildAssetActionLine({
          username,
          shareCode: item.shareCode,
          assetId: item.assetId,
          canManage: canManageViewer
        });
        return [titleLine, actionLine].filter(Boolean).join("\n");
      })
      .filter(Boolean)
      .join("\n\n");
    const text = `🏷 标签：<code>#${escapeHtml(tag.name)}</code>\n（第 ${currentPage}/${totalPages} 页，共 ${data.total} 条）\n\n${content}`;
    const keyboard = buildTagAssetsKeyboard(tagId, currentPage, totalPages);
    if (mode === "edit") {
      await editHtml(ctx, text, { reply_markup: keyboard });
    } else {
      await replyHtml(ctx, text, { reply_markup: keyboard });
    }
  };

  return { renderTagIndex, renderTagAssets };
};
