const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getTelegramErrorCode = (error: unknown) => {
  const response = (error as { response?: { error_code?: number } })?.response;
  if (typeof response?.error_code === "number") {
    return response.error_code;
  }
  return null;
};

const isTransientNetworkError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /(ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|socket hang up|network error)/i.test(message);
};

export const getTelegramRetryAfterMs = (error: unknown) => {
  const response = (error as { response?: { error_code?: number; parameters?: { retry_after?: number } } })
    ?.response;
  if (response?.error_code === 429 && response.parameters?.retry_after) {
    return response.parameters.retry_after * 1000;
  }
  const message = error instanceof Error ? error.message : "";
  const match = message.match(/retry after (\d+)/i);
  if (match) {
    return Number(match[1]) * 1000;
  }
  return null;
};

export const withTelegramRetry = async <T>(
  fn: () => Promise<T>,
  options?: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number }
) => {
  const maxAttempts = options?.maxAttempts ?? 5;
  const baseDelayMs = options?.baseDelayMs ?? 500;
  const maxDelayMs = options?.maxDelayMs ?? 10_000;
  let attempt = 0;
  while (attempt < maxAttempts) {
    try {
      return await fn();
    } catch (error) {
      const retryAfterMs = getTelegramRetryAfterMs(error);
      if (retryAfterMs !== null) {
        await sleep(retryAfterMs);
        attempt += 1;
        continue;
      }
      const code = getTelegramErrorCode(error);
      if ((code !== null && code >= 500 && code < 600) || isTransientNetworkError(error)) {
        const exp = Math.min(attempt, 8);
        const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, exp));
        const jitter = Math.floor(Math.random() * 100);
        await sleep(delay + jitter);
        attempt += 1;
        continue;
      }
      throw error;
    }
  }
  return fn();
};
