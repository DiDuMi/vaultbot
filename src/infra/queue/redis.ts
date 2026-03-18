import IORedis from "ioredis";

export const createRedisConnection = (url: string) => {
  const redis = new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: true });
  redis.on("error", () => undefined);
  return redis;
};
