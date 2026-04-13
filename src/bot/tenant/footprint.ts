import type { Context } from "grammy";
import type { DeliveryService } from "../../services/use-cases";
import { buildFootprintKeyboard } from "./keyboards";
import { buildDbDisabledHint, editHtml, escapeHtml, replyHtml, stripHtmlTags, upsertHtml } from "./ui-utils";

type FootprintTab = "open" | "like" | "comment" | "reply";
type FootprintRange = "7d" | "30d" | "all";
type RenderMode = "reply" | "edit";

type FootprintItem = {
  title: string;
  shareCode: string | null;
  at: Date;
};

export const createFootprintRenderer = (deps: {
  deliveryService: DeliveryService | null;
  mainKeyboard: NonNullable<Parameters<Context["reply"]>[1]>["reply_markup"];
  syncSessionForView: (ctx: Context) => void;
  formatLocalDateTime: (date: Date) => string;
  buildStartLink: (username: string, payload: string) => string;
}) => {
  const pageSize = 10;

  const loadData = async (userId: string, tab: FootprintTab, page: number, since?: Date) => {
    if (!deps.deliveryService) {
      return { total: 0, items: [] as FootprintItem[] };
    }
    if (tab === "open") {
      const result = await deps.deliveryService.listUserOpenHistory(userId, page, pageSize, { since });
      return { total: result.total, items: result.items.map((item) => ({ ...item, at: item.openedAt })) };
    }
    if (tab === "like") {
      const result = await deps.deliveryService.listUserLikedAssets(userId, page, pageSize, { since });
      return { total: result.total, items: result.items.map((item) => ({ ...item, at: item.likedAt })) };
    }
    const kind = tab === "reply" ? "reply" : "comment";
    const result = await deps.deliveryService.listUserComments(userId, kind, page, pageSize, { since });
    return { total: result.total, items: result.items.map((item) => ({ ...item, at: item.createdAt })) };
  };

  return async (
    ctx: Context,
    tab: FootprintTab,
    range: FootprintRange,
    page: number,
    mode: RenderMode,
    showMoreActions = false
  ) => {
    if (!ctx.from) {
      return;
    }
    deps.syncSessionForView(ctx);
    if (!deps.deliveryService) {
      const message = buildDbDisabledHint("查看足迹");
      if (mode === "edit") {
        await editHtml(ctx, message).catch(async () => replyHtml(ctx, message));
      } else {
        await replyHtml(ctx, message, { reply_markup: deps.mainKeyboard });
      }
      return;
    }

    const userId = String(ctx.from.id);
    const username = ctx.me?.username;
    const since =
      range === "7d"
        ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        : range === "30d"
          ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          : undefined;

    let data = await loadData(userId, tab, page, since);
    const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
    const currentPage = Math.min(Math.max(page, 1), totalPages);
    if (data.total > 0 && data.items.length === 0 && currentPage !== page) {
      data = await loadData(userId, tab, currentPage, since);
    }

    const tabTitle = tab === "open" ? "最近浏览" : tab === "like" ? "收藏" : tab === "comment" ? "评论" : "回复";
    const rangeTitle = range === "7d" ? "近7天" : range === "30d" ? "近30天" : "全部";
    if (data.total === 0) {
      const message =
        tab === "open"
          ? "📭 暂无最近浏览。\n可先去 <b>📚 列表</b> 或 <b>🔎 搜索</b> 看看。"
          : tab === "like"
            ? "📭 暂无收藏。\n看到喜欢的内容后可点 ⭐️ 收藏。"
            : tab === "comment"
              ? "📭 暂无评论。\n打开内容后即可参与评论。"
              : "📭 暂无回复。\n有评论互动后会显示在这里。";
      await upsertHtml(
        ctx,
        `<b>👣 足迹｜${tabTitle}（${rangeTitle}）</b>\n\n${message}`,
        buildFootprintKeyboard({ tab, range, page: 1, totalPages: 1 }, showMoreActions)
      );
      return;
    }

    const content = data.items
      .slice(0, pageSize)
      .map((item, index) => {
        const order = (currentPage - 1) * pageSize + index + 1;
        const titleText = escapeHtml(stripHtmlTags(item.title));
        const openLink = item.shareCode && username ? deps.buildStartLink(username, `p_${item.shareCode}`) : undefined;
        const timeLabel = tab === "open" ? "浏览" : tab === "like" ? "收藏" : tab === "comment" ? "评论" : "回复";
        return [
          `<b>${order}. ${titleText}</b>`,
          openLink ? `<a href="${escapeHtml(openLink)}">点击查看</a>` : "",
          `${timeLabel}：<b>${escapeHtml(deps.formatLocalDateTime(item.at))}</b>`
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");

    await upsertHtml(
      ctx,
      [`<b>👣 足迹｜${tabTitle}（${rangeTitle}，每页 10 条）</b>`, "", content].join("\n"),
      buildFootprintKeyboard({ tab, range, page: currentPage, totalPages }, showMoreActions)
    );
  };
};
