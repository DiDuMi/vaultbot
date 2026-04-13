import { InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import type { DeliveryService } from "../../services/use-cases";
import { logErrorThrottled } from "../../infra/logging";

export type KeyValueStore<T> = {
  get: (key: string) => T | undefined;
  set: (key: string, value: T) => void;
  has: (key: string) => boolean;
  delete: (key: string) => boolean;
};

export const escapeHtml = (value: string) => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

export const sanitizeTelegramHtml = (value: string) => {
  const allowedSimpleTags = new Set([
    "b",
    "strong",
    "i",
    "em",
    "u",
    "ins",
    "s",
    "strike",
    "del",
    "code",
    "pre",
    "blockquote"
  ]);

  let result = "";
  let index = 0;
  while (index < value.length) {
    const lt = value.indexOf("<", index);
    if (lt === -1) {
      result += escapeHtml(value.slice(index));
      break;
    }
    result += escapeHtml(value.slice(index, lt));
    const gt = value.indexOf(">", lt + 1);
    if (gt === -1) {
      result += escapeHtml(value.slice(lt));
      break;
    }
    const rawTag = value.slice(lt + 1, gt).trim();
    const isClose = rawTag.startsWith("/");
    const tagBody = isClose ? rawTag.slice(1).trim() : rawTag;
    const tagNameMatch = tagBody.match(/^([a-zA-Z0-9]+)\b/);
    if (!tagNameMatch) {
      result += escapeHtml(value.slice(lt, gt + 1));
      index = gt + 1;
      continue;
    }
    const tagName = tagNameMatch[1].toLowerCase();
    if (tagName === "a") {
      if (isClose) {
        result += "</a>";
      } else {
        const hrefMatch = tagBody.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'<>]+))/i);
        const href = (hrefMatch?.[2] ?? hrefMatch?.[3] ?? hrefMatch?.[4] ?? "").trim();
        const isAllowedHref = /^https?:\/\//i.test(href) || /^tg:\/\//i.test(href);
        if (!href || !isAllowedHref) {
          result += escapeHtml(value.slice(lt, gt + 1));
        } else {
          result += `<a href="${escapeHtml(href)}">`;
        }
      }
      index = gt + 1;
      continue;
    }

    if (tagName === "span") {
      if (isClose) {
        result += "</span>";
      } else {
        const classMatch = tagBody.match(/\bclass\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'<>]+))/i);
        const classValue = (classMatch?.[2] ?? classMatch?.[3] ?? classMatch?.[4] ?? "").trim();
        if (classValue.split(/\s+/).includes("tg-spoiler")) {
          result += `<span class="tg-spoiler">`;
        } else {
          result += escapeHtml(value.slice(lt, gt + 1));
        }
      }
      index = gt + 1;
      continue;
    }

    if (allowedSimpleTags.has(tagName)) {
      result += isClose ? `</${tagName}>` : `<${tagName}>`;
    } else {
      result += escapeHtml(value.slice(lt, gt + 1));
    }
    index = gt + 1;
  }
  return result;
};

export const stripHtmlTags = (value: string) => {
  return value.replace(/<[^>]*>/g, "");
};

export const normalizeButtonText = (text: string) => {
  return text.replace(/^[^A-Za-z0-9\u4e00-\u9fa5]+/g, "").trim();
};

export const buildInputExitHint = (activity: string, options?: { afterExitHtml?: string }) => {
  const suffix = options?.afterExitHtml?.trim() ? `退出后${options.afterExitHtml.trim()}` : "退出输入。";
  return `⚠️ 当前正在${escapeHtml(activity)}，请发送 <code>/cancel</code> 或点击 <b>❌ 取消</b>${suffix}`;
};

export const buildBlockingHint = (message: string, nextStepHtml?: string) => {
  const step = nextStepHtml?.trim();
  return step ? `⚠️ ${escapeHtml(message)}\n${step}` : `⚠️ ${escapeHtml(message)}`;
};

export const buildDbDisabledHint = (action: string, nextStepHtml?: string) => {
  const normalizedAction = action.trim();
  const detail = normalizedAction ? `暂时无法${escapeHtml(normalizedAction)}。` : "暂时不可用。";
  const step = nextStepHtml?.trim();
  return step ? `⚠️ <b>当前未启用数据库</b>\n${detail}\n${step}` : `⚠️ <b>当前未启用数据库</b>\n${detail}`;
};

export const buildGuideHint = (message: string, nextStepHtml?: string) => {
  const step = nextStepHtml?.trim();
  return step ? `🧭 ${escapeHtml(message)}\n${step}` : `🧭 ${escapeHtml(message)}`;
};

export const buildSuccessHint = (message: string, nextStepHtml?: string) => {
  const step = nextStepHtml?.trim();
  return step ? `✅ ${escapeHtml(message)}\n${step}` : `✅ ${escapeHtml(message)}`;
};

export const utf8ByteLength = (value: string) => {
  return Buffer.byteLength(value, "utf8");
};

export const formatApproxCount = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }
  if (value < 10) {
    return String(Math.floor(value));
  }
  const bucket = Math.min(100, Math.floor(value / 10) * 10);
  return `${bucket}+`;
};

export const truncatePlainText = (value: string, maxLength: number) => {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  if (maxLength <= 3) {
    return normalized.slice(0, maxLength);
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
};

export const buildStartLink = (username: string, payload: string) => {
  return `https://t.me/${username}?start=${encodeURIComponent(payload)}`;
};

export const extractStartPayloadFromText = (text: string) => {
  const raw = text.trim();
  if (!raw) {
    return null;
  }
  const match = raw.match(
    /(tg:\/\/resolve\?[^\s]+|https?:\/\/t\.me\/[^\s]+|https?:\/\/telegram\.me\/[^\s]+|t\.me\/[^\s]+|telegram\.me\/[^\s]+)/i
  );
  const candidate = match?.[1]?.trim();
  if (!candidate) {
    return null;
  }
  try {
    const url = new URL(candidate.startsWith("tg://") || candidate.startsWith("http") ? candidate : `https://${candidate}`);
    const payload = url.searchParams.get("start") ?? url.searchParams.get("startapp");
    const normalized = payload?.trim();
    return normalized ? normalized : null;
  } catch {
    return null;
  }
};

export const replyHtml = async (ctx: Context, html: string, options?: Parameters<Context["reply"]>[1]) => {
  try {
    if (options) {
      const reply_markup =
        options.reply_markup instanceof InlineKeyboard ? sanitizeInlineKeyboard(options.reply_markup) : options.reply_markup;
      return await ctx.reply(html, { ...options, reply_markup, parse_mode: "HTML" });
    }
    return await ctx.reply(html, { parse_mode: "HTML" });
  } catch {
    const fallback = escapeHtml(html);
    if (options) {
      const reply_markup =
        options.reply_markup instanceof InlineKeyboard ? sanitizeInlineKeyboard(options.reply_markup) : options.reply_markup;
      return ctx.reply(fallback, { ...options, reply_markup, parse_mode: "HTML" });
    }
    return ctx.reply(fallback, { parse_mode: "HTML" });
  }
};

export const editHtml = (ctx: Context, html: string, options?: Parameters<Context["editMessageText"]>[1]) => {
  const run = async (text: string) => {
    if (options) {
      const reply_markup =
        options.reply_markup instanceof InlineKeyboard ? sanitizeInlineKeyboard(options.reply_markup) : options.reply_markup;
      return ctx.editMessageText(text, { ...options, reply_markup, parse_mode: "HTML" });
    }
    return ctx.editMessageText(text, { parse_mode: "HTML" });
  };
  return run(html).catch(() => run(escapeHtml(html)));
};

export const upsertHtml = async (ctx: Context, html: string, reply_markup?: InlineKeyboard) => {
  if (reply_markup) {
    const safeMarkup = sanitizeInlineKeyboard(reply_markup);
    await editHtml(ctx, html, { reply_markup: safeMarkup }).catch(async () => {
      await replyHtml(ctx, html, { reply_markup: safeMarkup }).catch(async () => {
        await replyHtml(ctx, html);
      });
    });
    return;
  }
  await editHtml(ctx, html).catch(async () => {
    await replyHtml(ctx, html).catch((error) =>
      logErrorThrottled({ component: "tenant_ui", op: "upsert_html_reply_fallback" }, error, {
        key: "upsert_html_reply_fallback",
        intervalMs: 30_000
      })
    );
  });
};

export const toMetaKey = (userId: number, chatId: number) => {
  return `${chatId}:${userId}`;
};

export const isValidCallbackData = (value: string) => {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes < 1 || bytes > 64) {
    return false;
  }
  return !/[\u0000-\u001F\u007F]/.test(value);
};

export const safeCallbackData = (value: string, fallback: string) => {
  return isValidCallbackData(value) ? value : fallback;
};

export const sanitizeInlineKeyboard = (keyboard: InlineKeyboard) => {
  const anyKeyboard = keyboard as unknown as {
    inline_keyboard?: Array<Array<{ callback_data?: string } & Record<string, unknown>>>;
  };
  const rows = anyKeyboard.inline_keyboard;
  if (!Array.isArray(rows)) {
    return keyboard;
  }
  for (const row of rows) {
    if (!Array.isArray(row)) {
      continue;
    }
    for (const button of row) {
      if (!button || typeof button !== "object") {
        continue;
      }
      const hasUrl = typeof (button as { url?: unknown }).url === "string";
      const rawCallback = (button as { callback_data?: unknown }).callback_data;
      if (!hasUrl) {
        if (typeof rawCallback !== "string" || !isValidCallbackData(rawCallback)) {
          (button as { callback_data?: string }).callback_data = "asset:noop";
        }
      }
    }
  }
  anyKeyboard.inline_keyboard = rows.filter((row) => Array.isArray(row) && row.length > 0);
  return keyboard;
};

type UserLabelCacheEntry = { value: string; expiresAt: number };

const userLabelCache = new Map<string, UserLabelCacheEntry>();
const userLabelCacheTtlMs = 24 * 60 * 60 * 1000;
const userLabelCacheMaxSize = 5000;

const getCachedUserLabel = (userId: string) => {
  const entry = userLabelCache.get(userId);
  if (!entry) {
    return null;
  }
  if (Date.now() >= entry.expiresAt) {
    userLabelCache.delete(userId);
    return null;
  }
  return entry.value;
};

const setCachedUserLabel = (userId: string, value: string) => {
  if (!userLabelCache.has(userId) && userLabelCache.size >= userLabelCacheMaxSize) {
    const firstKey = userLabelCache.keys().next().value as string | undefined;
    if (firstKey) {
      userLabelCache.delete(firstKey);
    }
  }
  userLabelCache.set(userId, { value, expiresAt: Date.now() + userLabelCacheTtlMs });
};

export const resolveUserLabel = async (ctx: Context, userId: string, deliveryService?: DeliveryService | null) => {
  const cached = getCachedUserLabel(userId);
  if (cached) {
    return cached;
  }
  if (deliveryService) {
    const stored = await deliveryService.getTenantUserLabel(userId).catch(() => null);
    if (stored) {
      const normalizedStored = truncatePlainText(stored.replace(/\s+/g, " "), 30) || "匿名用户";
      setCachedUserLabel(userId, normalizedStored);
      return normalizedStored;
    }
  }
  const selfId = ctx.from?.id;
  if (typeof selfId === "number" && Number.isFinite(selfId) && String(selfId) === userId) {
    const selfLabel = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name?.trim() || "匿名用户";
    const normalizedSelf = truncatePlainText(selfLabel.replace(/\s+/g, " "), 30) || "匿名用户";
    setCachedUserLabel(userId, normalizedSelf);
    return normalizedSelf;
  }
  const numericId = Number(userId);
  if (!Number.isFinite(numericId)) {
    setCachedUserLabel(userId, "匿名用户");
    return "匿名用户";
  }
  const chat = await ctx.api.getChat(numericId).catch(() => null);
  const username = (chat as { username?: string | null } | null)?.username;
  const firstName = (chat as { first_name?: string | null } | null)?.first_name;
  const lastName = (chat as { last_name?: string | null } | null)?.last_name;
  const title = (chat as { title?: string | null } | null)?.title;
  const fullName = [firstName?.trim(), lastName?.trim()].filter(Boolean).join(" ");
  const fallbackId = `用户#${String(Math.trunc(numericId)).slice(-6)}`;
  const label = username ? `@${username}` : fullName || title?.trim() || fallbackId;
  const normalized = truncatePlainText(label.replace(/\s+/g, " "), 30) || "匿名用户";
  setCachedUserLabel(userId, normalized);
  return normalized;
};

export const buildPublisherLine = async (
  ctx: Context,
  publisherUserId: string | null | undefined,
  deliveryService?: DeliveryService | null
) => {
  if (!publisherUserId) {
    return "";
  }
  const label = await resolveUserLabel(ctx, publisherUserId, deliveryService);
  return `发布者：<a href="tg://user?id=${escapeHtml(publisherUserId)}">${escapeHtml(label)}</a>`;
};

export const shouldShowPublisherLine = async (options: {
  deliveryService: DeliveryService | null;
  viewerUserId: string | null;
  publisherUserId: string | null | undefined;
}) => {
  if (!options.publisherUserId) {
    return false;
  }
  if (!options.deliveryService || !options.viewerUserId) {
    return true;
  }
  const enabled = await options.deliveryService.getTenantHidePublisherEnabled().catch(() => false);
  if (!enabled) {
    return true;
  }
  if (options.viewerUserId === options.publisherUserId) {
    return true;
  }
  return options.deliveryService.isTenantUser(options.viewerUserId).catch(() => false);
};
