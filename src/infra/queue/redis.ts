import IORedis from "ioredis";
import { logError } from "../logging";

type CreateRedisConnectionOptions = {
  component?: string;
  logIntervalMs?: number;
};

const redactConnectionString = (raw: string) => {
  try {
    const url = new URL(raw);
    if (url.username) {
      url.username = "***";
    }
    if (url.password) {
      url.password = "***";
    }
    return url.toString();
  } catch {
    return raw.replace(/\/\/([^@]+)@/g, "//***@");
  }
};

export const createRedisConnection = (url: string, options?: CreateRedisConnectionOptions) => {
  const redis = new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: true });
  const component = options?.component ?? "redis";
  const logIntervalMs = options?.logIntervalMs ?? 10_000;
  let lastLoggedAt = 0;
  redis.on("error", (error) => {
    const now = Date.now();
    if (now - lastLoggedAt < logIntervalMs) {
      return;
    }
    lastLoggedAt = now;
    logError({ component, op: "redis_error", redisUrl: redactConnectionString(url) }, error);
  });
  return redis;
};
