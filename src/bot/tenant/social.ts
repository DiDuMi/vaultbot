import { InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import { buildCommentKeyboard } from "./keyboards";
import { buildDbDisabledHint, buildInputExitHint, buildStartLink, buildSuccessHint, editHtml, escapeHtml, normalizeButtonText, replyHtml, toMetaKey } from "./ui-utils";
import { withTelegramRetry } from "../../infra/telegram";
import { logErrorThrottled } from "../../infra/logging";
import type { DeliveryService } from "../../services/use-cases";
import type { SessionMode } from "./session";
import type { KeyValueStore } from "./ui-utils";

type CommentInputState = {
  assetId: string;
  replyToCommentId: string | null;
  replyToLabel: string | null;
  returnToAssetPage?: number;
};

export const createTenantSocial = (deps: {
  deliveryService: DeliveryService | null;
  mainKeyboard: NonNullable<Parameters<Context["reply"]>[1]>["reply_markup"];
  ensureSessionMode: (key: string) => SessionMode;
  setSessionMode: (key: string, mode: SessionMode) => void;
  commentInputStates: KeyValueStore<CommentInputState>;
  formatLocalDateTime: (date: Date) => string;
}) => {
  const {
    deliveryService,
    mainKeyboard,
    ensureSessionMode,
    setSessionMode,
    commentInputStates,
    formatLocalDateTime
  } = deps;

  const renderComments = async (ctx: Context, assetId: string, page: number, mode: "reply" | "edit") => {
    if (!deliveryService) {
      const message = buildDbDisabledHint("查看评论");
      if (mode === "edit") {
        await editHtml(ctx, message).catch(async () => replyHtml(ctx, message));
      } else {
        await replyHtml(ctx, message, { reply_markup: mainKeyboard });
      }
      return;
    }
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      const message = "⚠️ 无法识别当前用户。";
      if (mode === "edit") {
        await editHtml(ctx, message).catch(async () => replyHtml(ctx, message));
      } else {
        await replyHtml(ctx, message, { reply_markup: mainKeyboard });
      }
      return;
    }
    const pageSize = 8;
    const userId = String(ctx.from.id);
    const key = toMetaKey(ctx.from.id, chatId);
    const sessionMode = ensureSessionMode(key);
    const inputState = sessionMode === "commentInput" ? commentInputStates.get(key) : undefined;
    const returnToAssetPage = inputState?.assetId === assetId ? inputState.returnToAssetPage ?? 1 : 1;
    const data = await deliveryService.listAssetComments(userId, assetId, page, pageSize);
    const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
    const currentPage = Math.min(Math.max(page, 1), totalPages);
    const items = data.items;
    const username = ctx.me?.username;
    const content =
      items.length === 0
        ? "暂无评论，来写第一条吧。"
        : items
            .map((c, idx) => {
              const order = (currentPage - 1) * pageSize + idx + 1;
              const author = c.authorUserId
                ? `<a href="tg://user?id=${escapeHtml(c.authorUserId)}">${escapeHtml(c.authorName ?? "用户")}</a>`
                : escapeHtml(c.authorName ?? "用户");
              const replyToLine = c.replyTo
                ? `↩︎ 回复 <a href="tg://user?id=${escapeHtml(c.replyTo.authorUserId)}">${escapeHtml(c.replyTo.authorName ?? "用户")}</a>`
                : "";
              const body = escapeHtml(c.content);
              const time = escapeHtml(formatLocalDateTime(c.createdAt));
              const actionLine = (() => {
                if (!username) {
                  return `时间：<b>${time}</b> · 收藏 · 回复 · 对话`;
                }
                const likeLink = buildStartLink(username, `cl_${c.id}`);
                const replyLink = buildStartLink(username, `cr_${c.id}`);
                const threadLink = buildStartLink(username, `ct_${c.id}_${returnToAssetPage}`);
                return `时间：<b>${time}</b> · <a href="${escapeHtml(likeLink)}">收藏</a> · <a href="${escapeHtml(replyLink)}">回复</a> · <a href="${escapeHtml(threadLink)}">对话</a>`;
              })();
              return [
                `<b>#${order}</b> ${author}`,
                replyToLine,
                `<blockquote expandable>${body}</blockquote>`,
                actionLine
              ]
                .filter(Boolean)
                .join("\n");
            })
            .join("\n\n");
    const inputHint = (() => {
      if (!inputState) {
        return "直接发送消息即可发表评论。";
      }
      if (inputState.replyToCommentId) {
        return `当前：回复 <b>${escapeHtml(inputState.replyToLabel ?? "")}</b>（直接发送消息即可回复）。`;
      }
      return "当前：发表评论（直接发送消息即可评论）。";
    })();
    const text = [`<b>💬 评论</b>`, "", content, "", inputHint].join("\n");
    const keyboard = (() => {
      const k = buildCommentKeyboard(assetId, currentPage, totalPages);
      if (inputState?.replyToCommentId) {
        k.row();
        k.text("取消回复", `comment:reply_cancel:${currentPage}`);
      }
      return k;
    })();
    if (mode === "edit") {
      await editHtml(ctx, text, { reply_markup: keyboard }).catch(async () => replyHtml(ctx, text, { reply_markup: keyboard }));
    } else {
      await replyHtml(ctx, text, { reply_markup: keyboard });
    }
  };

  const handleStartPayload = async (ctx: Context, payload: string) => {
    if (payload.startsWith("ct_")) {
      const raw = payload.slice(3);
      const lastUnderscore = raw.lastIndexOf("_");
      const returnToAssetPage = (() => {
        if (lastUnderscore <= 0) {
          return 1;
        }
        const maybe = Number(raw.slice(lastUnderscore + 1));
        return Number.isFinite(maybe) && maybe >= 1 ? maybe : 1;
      })();
      const rootCommentId =
        lastUnderscore > 0 && Number.isFinite(Number(raw.slice(lastUnderscore + 1))) ? raw.slice(0, lastUnderscore) : raw;
      if (!deliveryService || !ctx.from) {
        await replyHtml(ctx, buildDbDisabledHint("查看对话"));
        return true;
      }
      const thread = await deliveryService.getCommentThread(String(ctx.from.id), rootCommentId);
      if (!thread) {
        await replyHtml(ctx, "⚠️ 对话不存在或无权限。");
        return true;
      }
      const username = ctx.me?.username;
      const openLink =
        username && thread.shareCode ? buildStartLink(username, `p_${thread.shareCode}_${returnToAssetPage}`) : "";
      const listLink = username ? buildStartLink(username, `ca_${thread.assetId}`) : "";
      const replyLink = username ? buildStartLink(username, `cr_${thread.root.id}`) : "";
      const threadLink = username ? buildStartLink(username, `ct_${thread.root.id}_${returnToAssetPage}`) : "";

      const formatAuthor = (userId: string | null, name: string | null) => {
        const safeName = escapeHtml(name ?? "用户");
        if (!userId) {
          return safeName;
        }
        return `<a href="tg://user?id=${escapeHtml(userId)}">${safeName}</a>`;
      };

      const rootBlock = [
        "<b>主评论</b>",
        `${formatAuthor(thread.root.authorUserId, thread.root.authorName)} · <b>${escapeHtml(formatLocalDateTime(thread.root.createdAt))}</b>`,
        `<blockquote expandable>${escapeHtml(thread.root.content)}</blockquote>`,
        username
          ? `动作：<a href="${escapeHtml(replyLink)}">回复</a> · <a href="${escapeHtml(threadLink)}">对话</a>`
          : "动作：回复 · 对话"
      ].join("\n");

      const repliesBlock =
        thread.replies.length === 0
          ? "暂无回复。"
          : thread.replies
              .map((r, idx) => {
                const order = idx + 1;
                const replyItemLink = username ? buildStartLink(username, `cr_${r.id}`) : "";
                const threadItemLink = username ? buildStartLink(username, `ct_${r.id}_${returnToAssetPage}`) : "";
                return [
                  `<b>↩︎ #${order}</b> ${formatAuthor(r.authorUserId, r.authorName)} · <b>${escapeHtml(formatLocalDateTime(r.createdAt))}</b>`,
                  `<blockquote expandable>${escapeHtml(r.content)}</blockquote>`,
                  username
                    ? `动作：<a href="${escapeHtml(replyItemLink)}">回复</a> · <a href="${escapeHtml(threadItemLink)}">对话</a>`
                    : "动作：回复 · 对话"
                ].join("\n");
              })
              .join("\n\n");

      const text = [
        "<b>💬 对话</b>",
        "",
        `<b>${escapeHtml(thread.assetTitle || "未命名")}</b>`,
        "",
        rootBlock,
        "",
        repliesBlock,
        "",
        openLink ? `<a href="${escapeHtml(openLink)}">🔓 打开内容</a>` : "",
        listLink ? `<a href="${escapeHtml(listLink)}">📄 查看评论列表</a>` : "",
        replyLink ? `<a href="${escapeHtml(replyLink)}">↩️ 回复主评论</a>` : ""
      ]
        .filter(Boolean)
        .join("\n");

      const keyboard = (() => {
        if (!username) {
          return undefined;
        }
        const k = new InlineKeyboard();
        if (replyLink) {
          k.url("↩️ 回复", replyLink);
        }
        if (listLink) {
          k.url("📄 列表", listLink);
        }
        if (openLink) {
          k.row().url("🔓 打开内容", openLink);
        }
        k.row().text("⬅️ 返回内容", `comment:back:${thread.assetId}:${returnToAssetPage}`).text("🏠 首页", "home:back");
        return k;
      })();

      await replyHtml(ctx, text, { reply_markup: keyboard, link_preview_options: { is_disabled: true } });
      return true;
    }
    if (payload.startsWith("cv_")) {
      const commentId = payload.slice(3);
      if (!deliveryService || !ctx.from) {
        await replyHtml(ctx, buildDbDisabledHint("查看评论"));
        return true;
      }
      const chatId = ctx.chat?.id;
      if (!chatId) {
        await replyHtml(ctx, "⚠️ 无法识别当前会话。");
        return true;
      }
      const located = await deliveryService.locateAssetComment(String(ctx.from.id), commentId, 8);
      if (!located) {
        await replyHtml(ctx, "⚠️ 评论不存在或无权限。");
        return true;
      }
      const key = toMetaKey(ctx.from.id, chatId);
      setSessionMode(key, "commentInput");
      commentInputStates.set(key, { assetId: located.assetId, replyToCommentId: null, replyToLabel: null, returnToAssetPage: 1 });
      await renderComments(ctx, located.assetId, located.page, "reply");
      return true;
    }
    if (payload.startsWith("cl_")) {
      const commentId = payload.slice(3);
      if (!deliveryService || !ctx.from) {
        await replyHtml(ctx, buildDbDisabledHint("收藏"));
        return true;
      }
      const result = await deliveryService.toggleAssetCommentLike(String(ctx.from.id), commentId);
      if (!result.ok || !result.assetId) {
        await replyHtml(ctx, result.message);
        return true;
      }
      await replyHtml(ctx, result.message, { reply_markup: mainKeyboard });
      await renderComments(ctx, result.assetId, 1, "reply");
      return true;
    }
    if (payload.startsWith("cr_")) {
      const commentId = payload.slice(3);
      if (!deliveryService || !ctx.from) {
        await replyHtml(ctx, buildDbDisabledHint("回复"));
        return true;
      }
      const chatId = ctx.chat?.id;
      if (!chatId) {
        await replyHtml(ctx, "⚠️ 无法识别当前会话。");
        return true;
      }
      const context = await deliveryService.getAssetCommentContext(String(ctx.from.id), commentId);
      if (!context) {
        await replyHtml(ctx, "⚠️ 评论不存在或无权限。");
        return true;
      }
      const key = toMetaKey(ctx.from.id, chatId);
      const existing = commentInputStates.get(key);
      const returnToAssetPage = existing?.assetId === context.assetId ? existing.returnToAssetPage ?? 1 : 1;
      setSessionMode(key, "commentInput");
      commentInputStates.set(key, { assetId: context.assetId, replyToCommentId: commentId, replyToLabel: "该评论", returnToAssetPage });
      await renderComments(ctx, context.assetId, 1, "reply");
      return true;
    }
    if (payload.startsWith("ca_")) {
      const assetId = payload.slice(3);
      if (!deliveryService || !ctx.from) {
        await replyHtml(ctx, buildDbDisabledHint("查看评论"));
        return true;
      }
      const chatId = ctx.chat?.id;
      if (!chatId) {
        await replyHtml(ctx, "⚠️ 无法识别当前会话。");
        return true;
      }
      const key = toMetaKey(ctx.from.id, chatId);
      setSessionMode(key, "commentInput");
      if (!commentInputStates.has(key) || commentInputStates.get(key)?.assetId !== assetId) {
        commentInputStates.set(key, { assetId, replyToCommentId: null, replyToLabel: null, returnToAssetPage: 1 });
      }
      await renderComments(ctx, assetId, 1, "reply");
      return true;
    }
    return false;
  };

  const notifyCommentTargets = async (
    ctx: Context,
    input: {
      content: string;
      commentId: string;
      notify: {
        assetTitle: string;
        shareCode: string;
        publisherUserId: string | null;
        replyToAuthorUserId: string | null;
        replyToCommentId: string | null;
      };
    }
  ) => {
    if (!deliveryService || !ctx.from) {
      return;
    }
    const username = ctx.me?.username;
    if (!username) {
      return;
    }
    const stripHtml = (value: string) => value.replace(/<[^>]*>/g, "");
    const threadRootId = input.notify.replyToCommentId ?? input.commentId;
    const openThreadLink = buildStartLink(username, `ct_${threadRootId}`);
    const openListLink = buildStartLink(username, `cv_${input.commentId}`);
    const replyLink = buildStartLink(username, `cr_${threadRootId}`);
    const titleText = stripHtml(input.notify.assetTitle).trim() || "未命名";
    const titleShort = (() => {
      const normalized = titleText.replace(/\s+/g, " ").trim();
      if (!normalized) {
        return "未命名";
      }
      return normalized.length > 40 ? `${normalized.slice(0, 40)}…` : normalized;
    })();
    const senderId = String(ctx.from.id);
    const senderName = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name?.trim() || "用户";
    const senderLine = `来自：<a href="tg://user?id=${escapeHtml(senderId)}">${escapeHtml(senderName)}</a>`;
    const excerpt = (() => {
      const normalized = input.content.trim().replace(/\s+/g, " ");
      if (!normalized) {
        return "";
      }
      return normalized.length > 160 ? `${normalized.slice(0, 160)}…` : normalized;
    })();
    const notifyReplyTo = input.notify.replyToAuthorUserId && input.notify.replyToAuthorUserId !== senderId;
    const notifyPublisher =
      input.notify.publisherUserId &&
      input.notify.publisherUserId !== senderId &&
      input.notify.publisherUserId !== input.notify.replyToAuthorUserId;
    const textLines = [
      `${notifyReplyTo ? "<b>↩️ 有新回复</b>" : "<b>💬 有新评论</b>"} · <b>${escapeHtml(titleShort)}</b>`,
      "",
      senderLine,
      excerpt ? `${notifyReplyTo ? "回复" : "评论"}：<blockquote expandable>${escapeHtml(excerpt)}</blockquote>` : "",
      "",
      `<a href="${escapeHtml(openThreadLink)}">💬 查看对话</a>`,
      `<a href="${escapeHtml(openListLink)}">📄 查看列表</a>`,
      `<a href="${escapeHtml(replyLink)}">↩️ 直接回复</a>`
    ];
    if (notifyReplyTo) {
      const chatId = Number(input.notify.replyToAuthorUserId);
      if (Number.isFinite(chatId)) {
        const allowed = await deliveryService.checkAndRecordUserNotification(String(chatId), {
          type: "comment",
          uniqueId: input.commentId,
          minIntervalMs: 0
        });
        if (allowed) {
          await withTelegramRetry(() =>
            ctx.api.sendMessage(chatId, textLines.join("\n"), { parse_mode: "HTML", link_preview_options: { is_disabled: true } })
          ).catch((error) =>
            logErrorThrottled(
              { component: "tenant_social", op: "comment_notify_send", scope: "reply_to" },
              error,
              { key: "comment_notify_send", intervalMs: 30_000 }
            )
          );
        }
      }
    }
    if (notifyPublisher) {
      const chatId = Number(input.notify.publisherUserId);
      if (Number.isFinite(chatId)) {
        const allowed = await deliveryService.checkAndRecordUserNotification(String(chatId), {
          type: "comment",
          uniqueId: input.commentId,
          minIntervalMs: 0
        });
        if (allowed) {
          await withTelegramRetry(() =>
            ctx.api.sendMessage(chatId, textLines.join("\n"), { parse_mode: "HTML", link_preview_options: { is_disabled: true } })
          ).catch((error) =>
            logErrorThrottled(
              { component: "tenant_social", op: "comment_notify_send", scope: "publisher" },
              error,
              { key: "comment_notify_send", intervalMs: 30_000 }
            )
          );
        }
      }
    }
  };

  const handleCommentInputText = async (ctx: Context, text: string) => {
    if (!ctx.from || !ctx.chat) {
      return false;
    }
    const key = toMetaKey(ctx.from.id, ctx.chat.id);
    const mode = ensureSessionMode(key);
    const state = mode === "commentInput" ? commentInputStates.get(key) : undefined;
    if (mode !== "commentInput") {
      return false;
    }
    if (!state) {
      setSessionMode(key, "idle");
      return true;
    }
    const rawTrimmed = text.trim();
    if (rawTrimmed.startsWith("/")) {
      setSessionMode(key, "idle");
      commentInputStates.delete(key);
      await replyHtml(ctx, buildSuccessHint("已退出评论模式。"), { reply_markup: mainKeyboard });
      return true;
    }
    const command = normalizeButtonText(text);
    if (
      command === "分享" ||
      command === "储存" ||
      command === "完成" ||
      command === "列表" ||
      command === "搜索" ||
      command === "足迹" ||
      command === "关注" ||
      command === "设置"
    ) {
      await replyHtml(ctx, buildInputExitHint("评论", { afterExitHtml: "再点击消息里的 <b>⬅️ 返回内容</b> 或继续输入评论。" }), {
        reply_markup: mainKeyboard
      });
      return true;
    }
    if (!deliveryService) {
      setSessionMode(key, "idle");
      await replyHtml(ctx, buildDbDisabledHint("发表评论"), { reply_markup: mainKeyboard });
      return true;
    }
    const authorName = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name?.trim() || null;
    const result = await deliveryService.addAssetComment(String(ctx.from.id), state.assetId, {
      authorName,
      content: text,
      replyToCommentId: state.replyToCommentId
    });
    if (result.ok && result.notify && result.commentId) {
      await notifyCommentTargets(ctx, { content: text, commentId: result.commentId, notify: result.notify }).catch((error) =>
        logErrorThrottled(
          { component: "tenant_social", op: "comment_notify_targets", commentId: result.commentId, assetId: state.assetId },
          error,
          { key: "comment_notify_targets", intervalMs: 30_000 }
        )
      );
    }
    setSessionMode(key, "commentInput");
    if (state.replyToCommentId) {
      commentInputStates.set(key, state);
    } else {
      commentInputStates.set(key, {
        assetId: state.assetId,
        replyToCommentId: null,
        replyToLabel: null,
        returnToAssetPage: state.returnToAssetPage
      });
    }
    await replyHtml(ctx, result.message, { reply_markup: mainKeyboard });
    await renderComments(ctx, state.assetId, 1, "reply");
    return true;
  };

  return { renderComments, handleStartPayload, handleCommentInputText, notifyCommentTargets };
};
