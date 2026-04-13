import { InlineKeyboard } from "grammy";

export const formatWorkerError = (error: unknown) => {
  return error instanceof Error ? error.stack || error.message : String(error ?? "unknown error");
};

export const extractWorkerErrorCode = (error: unknown) => {
  const response = (error as { response?: { error_code?: number } })?.response;
  return typeof response?.error_code === "number" ? response.error_code : null;
};

export const logWorkerError = (
  fields: {
    op: string;
    scope?: string;
    tenantId?: string;
    batchId?: string;
    broadcastId?: string;
    runId?: string;
    [key: string]: unknown;
  },
  error: unknown
) => {
  const intervalMs = (() => {
    const raw = Number(process.env.WORKER_ERROR_LOG_INTERVAL_MS ?? "5000");
    if (!Number.isFinite(raw)) {
      return 5000;
    }
    return Math.max(0, Math.trunc(raw));
  })();
  const maxKeys = (() => {
    const raw = Number(process.env.WORKER_ERROR_LOG_MAX_KEYS ?? "5000");
    if (!Number.isFinite(raw)) {
      return 5000;
    }
    return Math.max(100, Math.trunc(raw));
  })();
  const shouldThrottle = intervalMs > 0 && fields.op !== "worker_startup";
  const key = `${fields.op}:${fields.scope ?? ""}`;
  const state = (globalThis as unknown as { __vaultbotWorkerLogLimiter?: Map<string, number> }).__vaultbotWorkerLogLimiter;
  const limiter =
    state ??
    (() => {
      const map = new Map<string, number>();
      (globalThis as unknown as { __vaultbotWorkerLogLimiter?: Map<string, number> }).__vaultbotWorkerLogLimiter = map;
      return map;
    })();
  if (shouldThrottle) {
    if (limiter.size > maxKeys) {
      limiter.clear();
    }
    const now = Date.now();
    const last = limiter.get(key) ?? 0;
    if (now - last < intervalMs) {
      return;
    }
    limiter.set(key, now);
  }
  const payload = {
    level: "error",
    component: "worker",
    at: new Date().toISOString(),
    ...fields,
    errorCode: extractWorkerErrorCode(error),
    error: formatWorkerError(error)
  };
  console.error(JSON.stringify(payload));
};

export const escapeHtml = (value: string) => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

export const stripHtml = (value: string) => value.replace(/<[^>]*>/g, "");

export const isBlockedError = (error: unknown) => {
  const response = (error as { response?: { error_code?: number; description?: string } })?.response;
  if (response?.error_code === 403) {
    return true;
  }
  const message = error instanceof Error ? error.message : "";
  return /bot was blocked|user is deactivated|chat not found/i.test(message);
};

export const buildBroadcastKeyboard = (buttons: unknown) => {
  if (!Array.isArray(buttons)) {
    return undefined;
  }
  const keyboard = new InlineKeyboard();
  let hasAny = false;
  for (const raw of buttons) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const item = raw as { text?: unknown; url?: unknown };
    const text = typeof item.text === "string" ? item.text.trim() : "";
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (!text || !url) {
      continue;
    }
    if (!/^https?:\/\//i.test(url)) {
      continue;
    }
    keyboard.url(text, url).row();
    hasAny = true;
  }
  return hasAny ? keyboard : undefined;
};
