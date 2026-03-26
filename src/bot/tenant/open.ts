import { InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import { withTelegramRetry } from "../../infra/telegram";
import type { DeliveryMessage, DeliveryService, UploadMessage } from "../../services/use-cases";
import {
  buildPublisherLine,
  escapeHtml,
  formatApproxCount,
  replyHtml,
  safeCallbackData,
  sanitizeInlineKeyboard,
  sanitizeTelegramHtml,
  shouldShowPublisherLine,
  toMetaKey
} from "./ui-utils";
import { buildAssetPageKeyboard } from "./keyboards";

const buildDeliverySummary = (messages: { kind: UploadMessage["kind"] }[]) => {
  const counts = {
    photo: 0,
    video: 0,
    animation: 0,
    file: 0
  };
  for (const message of messages) {
    if (message.kind === "photo") {
      counts.photo += 1;
    } else if (message.kind === "video") {
      counts.video += 1;
    } else if (message.kind === "animation") {
      counts.animation += 1;
    } else {
      counts.file += 1;
    }
  }
  const total = messages.length;
  return `已发送完毕，共 ${total} 条\n图片 ${counts.photo} · 视频 ${counts.video} · GIF ${counts.animation} · 文件 ${counts.file}`;
};

const countMediaKinds = (messages: { kind: UploadMessage["kind"] }[]) => {
  const counts = {
    photo: 0,
    video: 0,
    animation: 0,
    file: 0
  };
  for (const message of messages) {
    if (message.kind === "photo") {
      counts.photo += 1;
    } else if (message.kind === "video") {
      counts.video += 1;
    } else if (message.kind === "animation") {
      counts.animation += 1;
    } else {
      counts.file += 1;
    }
  }
  return counts;
};

const buildRemainingSummary = (messages: { kind: UploadMessage["kind"] }[]) => {
  const counts = countMediaKinds(messages);
  if (counts.photo === 0 && counts.video === 0 && counts.animation === 0 && counts.file === 0) {
    return "";
  }
  return `剩余 图片 ${counts.photo} · 视频 ${counts.video} · GIF ${counts.animation} · 文件 ${counts.file}`;
};

const parseNumberWithBounds = (raw: string | undefined, fallback: number, min: number, max: number) => {
  const value = Number(raw ?? "");
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
};

export const createOpenHandler = (deliveryService: DeliveryService | null) => {
  const pageSize = 20;
  const albumChunkSize = 10;
  const metricsLogIntervalMs = parseNumberWithBounds(process.env.OPEN_METRICS_LOG_INTERVAL_MS, 60_000, 5_000, 3_600_000);
  const maxOpenGuards = parseNumberWithBounds(process.env.OPEN_MAX_GUARDS, 5000, 100, 100_000);
  const maxAssetViewStates = parseNumberWithBounds(process.env.OPEN_MAX_VIEW_STATES, 5000, 100, 100_000);
  const openGuardTtlMs = parseNumberWithBounds(process.env.OPEN_GUARD_TTL_MS, 5 * 60 * 1000, 10_000, 12 * 60 * 60 * 1000);
  const assetViewStateTtlMs = parseNumberWithBounds(
    process.env.OPEN_VIEW_STATE_TTL_MS,
    30 * 60 * 1000,
    60_000,
    24 * 60 * 60 * 1000
  );
  const openGuards = new Map<string, { lastAt: number; busy: boolean }>();
  const assetViewStates = new Map<
    string,
    {
      assetId: string;
      page: number;
      totalPages: number;
      isTenant: boolean;
      adConfig: { prevText: string; nextText: string; adButtonText: string | null; adButtonUrl: string | null } | null;
      touchedAt: number;
    }
  >();
  const minIntervalMs = 1200;
  let openGuardsTtlEvictions = 0;
  let openGuardsCapEvictions = 0;
  let assetViewStatesTtlEvictions = 0;
  let assetViewStatesCapEvictions = 0;
  let lastMetricsLogAt = Date.now();
  const flushOpenMetrics = (now: number) => {
    if (now - lastMetricsLogAt < metricsLogIntervalMs) {
      return;
    }
    const hasChanges =
      openGuardsTtlEvictions > 0 ||
      openGuardsCapEvictions > 0 ||
      assetViewStatesTtlEvictions > 0 ||
      assetViewStatesCapEvictions > 0;
    if (hasChanges) {
      console.info(
        JSON.stringify({
          level: "info",
          at: new Date(now).toISOString(),
          component: "open_handler",
          op: "state_cleanup",
          openGuardsSize: openGuards.size,
          assetViewStatesSize: assetViewStates.size,
          openGuardsTtlEvictions,
          openGuardsCapEvictions,
          assetViewStatesTtlEvictions,
          assetViewStatesCapEvictions
        })
      );
      openGuardsTtlEvictions = 0;
      openGuardsCapEvictions = 0;
      assetViewStatesTtlEvictions = 0;
      assetViewStatesCapEvictions = 0;
    }
    lastMetricsLogAt = now;
  };
  const cleanupOpenState = (now: number) => {
    for (const [key, state] of openGuards) {
      if (!state.busy && now - state.lastAt > openGuardTtlMs) {
        openGuards.delete(key);
        openGuardsTtlEvictions += 1;
      }
    }
    while (openGuards.size > maxOpenGuards) {
      const oldest = openGuards.keys().next();
      if (oldest.done) {
        break;
      }
      openGuards.delete(oldest.value);
      openGuardsCapEvictions += 1;
    }
    for (const [key, state] of assetViewStates) {
      if (now - state.touchedAt > assetViewStateTtlMs) {
        assetViewStates.delete(key);
        assetViewStatesTtlEvictions += 1;
      }
    }
    while (assetViewStates.size > maxAssetViewStates) {
      const oldest = assetViewStates.keys().next();
      if (oldest.done) {
        break;
      }
      assetViewStates.delete(oldest.value);
      assetViewStatesCapEvictions += 1;
    }
    flushOpenMetrics(now);
  };

  const openAsset = async (ctx: Context, assetId: string, page = 1) => {
    cleanupOpenState(Date.now());
    if (!ctx.chat || !ctx.from) {
      return "not_ready" as const;
    }
    const guardKey = `${ctx.from.id}:${assetId}`;
    const now = Date.now();
    const existing = openGuards.get(guardKey);
    if (existing?.busy) {
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({ text: "正在发送中，请稍等…", show_alert: false });
      } else {
        await replyHtml(ctx, "⏳ 正在发送中，请稍等…");
      }
      return "busy" as const;
    }
    if (existing && now - existing.lastAt < minIntervalMs) {
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({ text: "操作太快啦，稍等一下再点。", show_alert: false });
      } else {
        await replyHtml(ctx, "⚠️ 操作太快啦，稍等一下再试。");
      }
      return "throttled" as const;
    }
    openGuards.set(guardKey, { lastAt: now, busy: true });
    if (!deliveryService) {
      openGuards.set(guardKey, { lastAt: now, busy: false });
      await replyHtml(ctx, "⚠️ 当前未启用数据库，无法交付内容。");
      return "db_disabled" as const;
    }
    try {
      const protectContent = await deliveryService.getTenantProtectContentEnabled().catch(() => false);
      const selection = await deliveryService.selectReplicas(String(ctx.from.id), assetId);
      if (selection.status !== "ready") {
        await replyHtml(ctx, escapeHtml(selection.message));
        return "not_ready" as const;
      }
      const messages = selection.messages;
      const isAlbumItem = (message: DeliveryMessage) => {
        return (
          Boolean(message.mediaGroupId) &&
          (message.kind === "photo" || message.kind === "video") &&
          Boolean(message.fileId)
        );
      };

      type Unit = { type: "album" | "single"; items: DeliveryMessage[] };
      const units: Unit[] = [];
      let unitIndex = 0;
      while (unitIndex < messages.length) {
        const current = messages[unitIndex];
        if (isAlbumItem(current)) {
          const groupId = current.mediaGroupId as string;
          const albumItems: DeliveryMessage[] = [];
          while (
            unitIndex < messages.length &&
            isAlbumItem(messages[unitIndex]) &&
            messages[unitIndex].mediaGroupId === groupId
          ) {
            albumItems.push(messages[unitIndex]);
            unitIndex += 1;
          }
          let chunkStart = 0;
          while (chunkStart < albumItems.length) {
            units.push({
              type: "album",
              items: albumItems.slice(chunkStart, chunkStart + albumChunkSize)
            });
            chunkStart += albumChunkSize;
          }
          continue;
        }
        units.push({ type: "single", items: [current] });
        unitIndex += 1;
      }

      const pages: Unit[][] = [];
      let currentUnits: Unit[] = [];
      let currentCount = 0;
      for (const unit of units) {
        const unitCount = unit.items.length;
        if (currentUnits.length > 0 && currentCount + unitCount > pageSize) {
          pages.push(currentUnits);
          currentUnits = [];
          currentCount = 0;
        }
        currentUnits.push(unit);
        currentCount += unitCount;
      }
      if (currentUnits.length > 0) {
        pages.push(currentUnits);
      }

      const totalPages = Math.max(1, pages.length);
      const currentPage = Math.min(Math.max(page, 1), totalPages);
      const pageIndex = currentPage - 1;
      const pageUnits = pages[pageIndex] ?? [];
      const chatId = ctx.chat.id;
      for (const unit of pageUnits) {
        if (unit.type === "album") {
          const album = unit.items.map((item) => ({
            type: item.kind === "photo" ? ("photo" as const) : ("video" as const),
            media: item.fileId as string
          }));
          if (album.length > 0) {
            await withTelegramRetry(() => ctx.api.sendMediaGroup(chatId, album, { protect_content: protectContent }));
            continue;
          }
        }
        for (const item of unit.items) {
          const sendByFileId = async () => {
            const fileId = item.fileId;
            if (!fileId) {
              return false;
            }
            if (item.kind === "photo") {
              await ctx.api.sendPhoto(chatId, fileId, { protect_content: protectContent });
              return true;
            }
            if (item.kind === "video") {
              await ctx.api.sendVideo(chatId, fileId, { protect_content: protectContent });
              return true;
            }
            if (item.kind === "animation") {
              await ctx.api.sendAnimation(chatId, fileId, { protect_content: protectContent });
              return true;
            }
            if (item.kind === "audio") {
              await ctx.api.sendAudio(chatId, fileId, { protect_content: protectContent });
              return true;
            }
            if (item.kind === "voice") {
              await ctx.api.sendVoice(chatId, fileId, { protect_content: protectContent });
              return true;
            }
            await ctx.api.sendDocument(chatId, fileId, { protect_content: protectContent });
            return true;
          };
          const sent = await withTelegramRetry(async () => await sendByFileId().catch(() => false));
          if (!sent) {
            const getTelegramErrorCode = (error: unknown) => {
              const response = (error as { response?: { error_code?: number } })?.response;
              return typeof response?.error_code === "number" ? response.error_code : null;
            };
            try {
              await withTelegramRetry(() =>
                ctx.api.copyMessage(chatId, item.fromChatId, item.messageId, { protect_content: protectContent })
              );
            } catch (error) {
              const code = getTelegramErrorCode(error);
              if (code === 400 || code === 403) {
                await deliveryService.markReplicaBad(assetId, item.fromChatId, item.messageId).catch(() => undefined);
              }
              throw error;
            }
          }
        }
      }
      const safeTitle = selection.title ? sanitizeTelegramHtml(selection.title) : "";
      const safeDescription = selection.description ? sanitizeTelegramHtml(selection.description) : "";
      const titleLine = safeTitle ? `<b>${safeTitle}</b>` : "";
      const descriptionLine = safeDescription ? `<blockquote expandable>${safeDescription}</blockquote>` : "";
      const publisherLine = (await shouldShowPublisherLine({
        deliveryService,
        viewerUserId: ctx.from ? String(ctx.from.id) : null,
        publisherUserId: selection.publisherUserId
      }))
        ? await buildPublisherLine(ctx, selection.publisherUserId, deliveryService)
        : "";
      const remaining = pages
        .slice(pageIndex + 1)
        .flatMap((pageItems) => pageItems)
        .flatMap((unit) => unit.items);
      const remain = buildRemainingSummary(remaining);
      const summary = currentPage >= totalPages ? buildDeliverySummary(messages) : "";
      const text = [
        titleLine,
        descriptionLine,
        publisherLine,
        totalPages === 1 ? "<b>文件列表</b>" : "〰️〰️〰️〰️〰️〰️〰️〰️",
        remain ? escapeHtml(remain) : "",
        summary ? escapeHtml(summary) : ""
      ]
        .filter(Boolean)
        .join("\n");
      const adConfig =
        totalPages > 1
          ? await deliveryService.getTenantDeliveryAdConfig().catch(() => ({
              prevText: "⬅️ 上一页",
              nextText: "下一页 ➡️",
              adButtonText: null,
              adButtonUrl: null
            }))
          : null;
      const keyboard =
        totalPages > 1 ? buildAssetPageKeyboard(assetId, currentPage, totalPages, adConfig ?? undefined) : new InlineKeyboard();
      const commentCount = await deliveryService.getAssetCommentCount(String(ctx.from.id), assetId).catch(() => 0);
      const commentHint = formatApproxCount(commentCount);
      const likeCount = await deliveryService.getAssetLikeCount(String(ctx.from.id), assetId).catch(() => 0);
      const likeHint = formatApproxCount(likeCount);
      const liked = await deliveryService.hasAssetLiked(String(ctx.from.id), assetId).catch(() => false);
      const likeAction = safeCallbackData(`asset:like:${assetId}`, "asset:noop");
      keyboard
        .row()
        .text(`${liked ? "⭐️ 已收藏" : "⭐️ 收藏"} ${likeHint}`, likeAction)
        .text(`💬 评论 ${commentHint}`, `comment:list:${assetId}:1:${currentPage}`);
      const isTenant = await deliveryService.isTenantUser(String(ctx.from.id)).catch(() => false);
      assetViewStates.set(toMetaKey(ctx.from.id, chatId), {
        assetId,
        page: currentPage,
        totalPages,
        isTenant,
        adConfig,
        touchedAt: Date.now()
      });
      const finalKeyboard = (() => {
        if (isTenant) {
          return keyboard;
        }
        keyboard.row().text("👣 足迹", "user:history");
        return keyboard;
      })();
      await replyHtml(
        ctx,
        text,
        finalKeyboard ? { reply_markup: finalKeyboard, protect_content: protectContent } : { protect_content: protectContent }
      );
      if (currentPage === 1) {
        await deliveryService.trackOpen(selection.tenantId, String(ctx.from.id), assetId);
      }
      return "opened" as const;
    } finally {
      openGuards.set(guardKey, { lastAt: Date.now(), busy: false });
    }
  };

  const refreshAssetActions = async (ctx: Context, assetId: string) => {
    cleanupOpenState(Date.now());
    if (!deliveryService || !ctx.from || !ctx.chat) {
      return;
    }
    const key = toMetaKey(ctx.from.id, ctx.chat.id);
    const view = assetViewStates.get(key);
    if (view) {
      assetViewStates.set(key, { ...view, touchedAt: Date.now() });
    }
    const page = view?.assetId === assetId ? view.page : 1;
    const totalPages = view?.assetId === assetId ? view.totalPages : 1;
    const isTenant =
      view?.assetId === assetId ? view.isTenant : await deliveryService.isTenantUser(String(ctx.from.id)).catch(() => false);
    const adConfig = view?.assetId === assetId ? view.adConfig : null;
    const keyboard = totalPages > 1 ? buildAssetPageKeyboard(assetId, page, totalPages, adConfig ?? undefined) : new InlineKeyboard();
    const commentCount = await deliveryService.getAssetCommentCount(String(ctx.from.id), assetId).catch(() => 0);
    const likeCount = await deliveryService.getAssetLikeCount(String(ctx.from.id), assetId).catch(() => 0);
    const commentHint = formatApproxCount(commentCount);
    const likeHint = formatApproxCount(likeCount);
    const liked = await deliveryService.hasAssetLiked(String(ctx.from.id), assetId).catch(() => false);
    const likeAction = safeCallbackData(`asset:like:${assetId}`, "asset:noop");
    keyboard
      .row()
      .text(`${liked ? "⭐️ 已收藏" : "⭐️ 收藏"} ${likeHint}`, likeAction)
      .text(`💬 评论 ${commentHint}`, `comment:list:${assetId}:1:${page}`);
    if (!isTenant) {
      keyboard.row().text("👣 足迹", "user:history");
    }
    await ctx.editMessageReplyMarkup({ reply_markup: sanitizeInlineKeyboard(keyboard) }).catch(() => undefined);
  };

  const openShareCode = async (ctx: Context, shareCode: string, page = 1) => {
    if (!deliveryService) {
      await replyHtml(ctx, "⚠️ 当前未启用数据库，无法交付内容。");
      return "db_disabled" as const;
    }
    const assetId = await deliveryService.resolveShareCode(shareCode);
    if (!assetId) {
      await replyHtml(ctx, "🔍 未找到该哈希，请确认后重试。");
      return "not_found" as const;
    }
    const result = await openAsset(ctx, assetId, Number.isFinite(page) && page >= 1 ? page : 1);
    return result === "opened" ? "opened" : "not_ready";
  };

  return { openAsset, openShareCode, refreshAssetActions };
};
