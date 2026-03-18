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
  },
  error: unknown
) => {
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
