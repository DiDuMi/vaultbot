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
  const intervalMs = options?.intervalMs ?? 10_000;
  if (intervalMs <= 0) {
    logError(fields, error);
    return;
  }
  const maxKeys = options?.maxKeys ?? 5000;
  const rawKey = options?.key ?? `${fields.component}:${fields.op}`;
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
