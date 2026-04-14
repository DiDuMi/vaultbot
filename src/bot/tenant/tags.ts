import { InlineKeyboard } from "grammy";
import type { Keyboard, Context } from "grammy";
import type { DeliveryService } from "../../services/use-cases";
import { buildHelpKeyboard } from "./keyboards";
import { buildAssetActionLine } from "./builders";
import { buildDbDisabledHint, editHtml, escapeHtml, replyHtml, safeCallbackData, sanitizeTelegramHtml } from "./ui-utils";

const TAG_INDEX_PAGE_SIZE = 20;
const TAG_ASSET_PAGE_SIZE = 10;

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
    keyboard.row().text("🏷 标签", "tags:show").text("📎 列表", "help:list").text("🏠 首页", "home:back");
    return keyboard;
  };

  const buildTagIndexKeyboard = (
    items: { tagId: string; name: string }[],
    currentPage: number,
    totalPages: number
  ) => {
    const keyboard = new InlineKeyboard();
    for (const item of items) {
      keyboard.row().text(`#${item.name}`, safeCallbackData(`tag:open:${item.tagId}:1`, "asset:noop"));
    }
    if (totalPages > 1) {
      if (currentPage > 1) {
        keyboard.text("⬅️ 上一页", `tags:page:${currentPage - 1}`);
      }
      if (currentPage < totalPages) {
        keyboard.text("下一页 ➡️", `tags:page:${currentPage + 1}`);
      }
      keyboard.row();
    }
    keyboard.row().text("🔄 刷新", `tags:refresh:${currentPage}`).text("📎 列表", "help:list").text("🏠 首页", "home:back");
    return keyboard;
  };

  const renderTagIndex = async (ctx: Context, mode: "reply" | "edit", page = 1) => {
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

    const safePage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;
    let data = await deps.deliveryService
      .listTopTags(safePage, TAG_INDEX_PAGE_SIZE, { viewerUserId: userId })
      .catch(() => ({ total: 0, items: [] }));
    const totalPages = Math.max(1, Math.ceil(data.total / TAG_INDEX_PAGE_SIZE));
    const currentPage = Math.min(safePage, totalPages);
    if (currentPage !== safePage) {
      data = await deps.deliveryService
        .listTopTags(currentPage, TAG_INDEX_PAGE_SIZE, { viewerUserId: userId })
        .catch(() => ({ total: 0, items: [] }));
    }

    const content =
      data.items.length === 0
        ? "暂无标签。\n发布内容时在标题或描述里写 <code>#标签</code>，保存后会自动归档。"
        : data.items
            .map((t, i) => `${(currentPage - 1) * TAG_INDEX_PAGE_SIZE + i + 1}. <b>#${escapeHtml(t.name)}</b>（${t.count}）`)
            .join("\n");
    const text = [
      "<b>🏷 热门标签</b>",
      "",
      "发送 <code>/tag</code> 查看热门标签，发送 <code>#标签</code> 可直接检索相关分享。",
      `第 ${currentPage}/${totalPages} 页，共 ${data.total} 个标签`,
      "",
      content
    ].join("\n");
    const keyboard = buildTagIndexKeyboard(data.items, currentPage, totalPages);

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

    const safePage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;
    const data = await deps.deliveryService.listAssetsByTagId(userId, tagId, safePage, TAG_ASSET_PAGE_SIZE).catch(() => null);
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

    const totalPages = Math.max(1, Math.ceil(data.total / TAG_ASSET_PAGE_SIZE));
    const currentPage = Math.min(safePage, totalPages);
    const currentData =
      currentPage === safePage
        ? data
        : await deps.deliveryService.listAssetsByTagId(userId, tagId, currentPage, TAG_ASSET_PAGE_SIZE).catch(() => data);

    const username = ctx.me?.username;
    const content = currentData.items
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
    const text = `🏷 标签：<code>#${escapeHtml(tag.name)}</code>\n（第 ${currentPage}/${totalPages} 页，共 ${currentData.total} 条）\n\n${content}`;
    const keyboard = buildTagAssetsKeyboard(tagId, currentPage, totalPages);

    if (mode === "edit") {
      await editHtml(ctx, text, { reply_markup: keyboard });
    } else {
      await replyHtml(ctx, text, { reply_markup: keyboard });
    }
  };

  return { renderTagIndex, renderTagAssets };
};
