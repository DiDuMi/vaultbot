type LogFields = {
  component: string;
  op: string;
  [key: string]: unknown;
};

const formatError = (error: unknown) => {
  if (error instanceof Error) {
    const withCode = error as Error & { code?: string | number };
    return {
      name: error.name,
      message: error.message,
      code: withCode.code
    };
  }
  return { message: String(error ?? "unknown error") };
};

export const logError = (fields: LogFields, error: unknown) => {
  console.error(
    JSON.stringify({
      level: "error",
      at: new Date().toISOString(),
      ...fields,
      error: formatError(error)
    })
  );
};

export const logErrorThrottled = (
  fields: LogFields,
  error: unknown,
  options?: { key?: string; intervalMs?: number; maxKeys?: number }
) => {
  const defaultIntervalMs = (() => {
    const raw = Number(process.env.LOG_ERROR_THROTTLED_INTERVAL_MS ?? "10000");
    if (!Number.isFinite(raw)) {
      return 10_000;
    }
    return Math.max(0, Math.trunc(raw));
  })();
  const intervalMs = options?.intervalMs ?? defaultIntervalMs;
  if (intervalMs <= 0) {
    logError(fields, error);
    return;
  }
  const defaultMaxKeys = (() => {
    const raw = Number(process.env.LOG_ERROR_THROTTLED_MAX_KEYS ?? "5000");
    if (!Number.isFinite(raw)) {
      return 5000;
    }
    return Math.max(100, Math.trunc(raw));
  })();
  const maxKeys = options?.maxKeys ?? defaultMaxKeys;
  const scope = fields.scope;
  const scopePart = scope === undefined || scope === null ? "" : String(scope);
  const rawKey = options?.key ?? `${fields.component}:${fields.op}:${scopePart}`;
  const state = globalThis as unknown as { __vaultbotLogLimiter?: Map<string, number> };
  const limiter =
    state.__vaultbotLogLimiter ??
    (() => {
      const map = new Map<string, number>();
      state.__vaultbotLogLimiter = map;
      return map;
    })();
  if (limiter.size > maxKeys) {
    limiter.clear();
  }
  const now = Date.now();
  const last = limiter.get(rawKey) ?? 0;
  if (now - last < intervalMs) {
    return;
  }
  limiter.set(rawKey, now);
  logError(fields, error);
};
