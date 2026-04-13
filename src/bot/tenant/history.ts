import type { Context } from "grammy";
import { logErrorThrottled } from "../../infra/logging";
import type { DeliveryService } from "../../services/use-cases";
import { buildHistoryKeyboard } from "./keyboards";
import type { KeyValueStore } from "./ui-utils";
import { buildDbDisabledHint, buildPublisherLine, escapeHtml, replyHtml, sanitizeTelegramHtml, stripHtmlTags, toMetaKey, truncatePlainText, upsertHtml } from "./ui-utils";

type HistoryScope = "community" | "mine";

export const createHistoryRenderer = (deps: {
  deliveryService: DeliveryService | null;
  mainKeyboard: NonNullable<Parameters<Context["reply"]>[1]>["reply_markup"];
  syncSessionForView: (ctx: Context) => void;
  hydrateUserPreferences: (ctx: Context) => Promise<void>;
  historyPageSize: number;
  historyFilterStates: KeyValueStore<string | null | undefined>;
  historyDateStates: KeyValueStore<Date>;
  historyScopeStates: KeyValueStore<HistoryScope>;
  buildAssetActionLine: (options: { username?: string; shareCode?: string | null; assetId: string; canManage: boolean }) => string;
}) => {
  const startOfLocalDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const pad2 = (value: number) => String(value).padStart(2, "0");
  const formatLocalDate = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

  return async (ctx: Context, page: number, scope?: HistoryScope, showMoreActions = false) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      return;
    }
    deps.syncSessionForView(ctx);
    if (!deps.deliveryService) {
      await replyHtml(ctx, buildDbDisabledHint("查看历史"), { reply_markup: deps.mainKeyboard });
      return;
    }
    await deps.hydrateUserPreferences(ctx);
    const filterKey = toMetaKey(ctx.from.id, chatId);
    const filter = deps.historyFilterStates.get(filterKey);
    const selectedScope = scope ?? deps.historyScopeStates.get(filterKey) ?? "community";
    deps.historyScopeStates.set(filterKey, selectedScope);
    const selectedDate = deps.historyDateStates.get(filterKey) ?? startOfLocalDay(new Date());
    if (!deps.historyDateStates.has(filterKey)) {
      deps.historyDateStates.set(filterKey, selectedDate);
    }

    const historyUserId = String(ctx.from.id);
    await deps.deliveryService.setUserHistoryListDate(historyUserId, selectedDate).catch((error) =>
      logErrorThrottled(
        { component: "tenant", op: "set_user_history_list_date", scope: "render_history", userId: historyUserId },
        error,
        { intervalMs: 30_000 }
      )
    );

    let data =
      selectedScope === "mine"
        ? await deps.deliveryService.listUserBatches(historyUserId, page, deps.historyPageSize, { collectionId: filter, date: selectedDate })
        : await deps.deliveryService.listTenantBatches(historyUserId, page, deps.historyPageSize, { collectionId: filter, date: selectedDate });

    const totalPages = Math.max(1, Math.ceil(data.total / deps.historyPageSize));
    const currentPage = Math.min(Math.max(page, 1), totalPages);
    if (data.total > 0 && data.items.length === 0 && currentPage !== page) {
      data =
        selectedScope === "mine"
          ? await deps.deliveryService.listUserBatches(historyUserId, currentPage, deps.historyPageSize, { collectionId: filter, date: selectedDate })
          : await deps.deliveryService.listTenantBatches(historyUserId, currentPage, deps.historyPageSize, { collectionId: filter, date: selectedDate });
    }

    const username = ctx.me?.username;
    let filterLabel = "全部";
    if (filter === null) {
      filterLabel = "未分类";
    } else if (typeof filter === "string") {
      const collections = await deps.deliveryService.listCollections();
      const found = collections.find((collection) => collection.id === filter);
      filterLabel = found ? truncatePlainText(stripHtmlTags(found.title), 10) : "未分类";
    }

    const viewerUserId = String(ctx.from.id);
    const hidePublisherEnabled = await deps.deliveryService.getTenantHidePublisherEnabled().catch(() => false);
    const isTenantViewer = await deps.deliveryService.isTenantUser(viewerUserId).catch(() => false);
    const canManageViewer = isTenantViewer ? await deps.deliveryService.canManageAdmins(viewerUserId).catch(() => false) : false;

    const content = (
      await Promise.all(
        data.items.map(async (item, index) => {
          const order = (currentPage - 1) * deps.historyPageSize + index + 1;
          const desc = item.description ? sanitizeTelegramHtml(item.description) : "";
          const publisherLine =
            !item.publisherUserId
              ? ""
              : !hidePublisherEnabled || item.publisherUserId === viewerUserId || isTenantViewer
                ? await buildPublisherLine(ctx, item.publisherUserId, deps.deliveryService)
                : "";
          return [
            `<b>${order}. ${escapeHtml(stripHtmlTags(item.title))}</b>`,
            publisherLine,
            deps.buildAssetActionLine({
              username,
              shareCode: item.shareCode,
              assetId: item.assetId,
              canManage: canManageViewer
            }),
            `条数：<b>${item.count}</b>`,
            desc ? `<blockquote expandable>${desc}</blockquote>` : ""
          ]
            .filter(Boolean)
            .join("\n");
        })
      )
    ).join("\n\n");

    const scopeLabel = selectedScope === "mine" ? "我的发布" : "社区发布";
    const title = `📚 列表（${escapeHtml(formatLocalDate(selectedDate))}｜${scopeLabel}，每页 10 条）`;
    const message = data.total === 0 ? `${title}\n\n📭 当天暂无发布。` : `${title}\n\n${content}`;
    await upsertHtml(
      ctx,
      message,
      buildHistoryKeyboard(currentPage, totalPages, filterLabel, selectedDate, selectedScope, showMoreActions)
    );
  };
};
