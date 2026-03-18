import { Bot } from "grammy";
import type { Config } from "./config";
import { registerTenantBot } from "./bot/tenant";
import { createRedisConnection, createQueue } from "./infra/queue";
import { prisma } from "./infra/persistence";
import { logError } from "./infra/logging";
import {
  createDeliveryService,
  createInMemoryUploadService,
  createUploadBatchStore,
  createUploadService,
  type NotifyQueue,
  type UploadQueue
} from "./services/use-cases";

const formatTelegramError = (error: unknown) => {
  const anyError = error as {
    method?: string;
    description?: string;
    error_code?: number;
    response?: { error_code?: number; description?: string; parameters?: { retry_after?: number } };
    parameters?: { retry_after?: number };
  };
  const retryAfter =
    typeof anyError?.parameters?.retry_after === "number"
      ? anyError.parameters.retry_after
      : typeof anyError?.response?.parameters?.retry_after === "number"
        ? anyError.response.parameters.retry_after
        : undefined;
  const code = typeof anyError?.error_code === "number" ? anyError.error_code : anyError?.response?.error_code;
  const description = typeof anyError?.description === "string" ? anyError.description : anyError?.response?.description;
  const method = typeof anyError?.method === "string" ? anyError.method : undefined;
  return { method, code, description, retryAfter };
};

export const createBot = (config: Config) => {
  const bot = new Bot(config.botToken);
  bot.catch((error) => {
    logError({ component: "bot", op: "grammy_catch", ...formatTelegramError(error) }, error);
  });
  const uploadStore = createUploadBatchStore();
  const queue: UploadQueue =
    config.redisUrl === "memory"
      ? { add: async () => ({}) }
      : createQueue("replication", createRedisConnection(config.redisUrl));
  const notifyQueue: NotifyQueue | null =
    config.redisUrl === "memory" ? null : (createQueue("notify", createRedisConnection(config.redisUrl)) as unknown as NotifyQueue);
  const uploadService =
    config.databaseUrl === "memory"
      ? createInMemoryUploadService()
      : createUploadService(prisma, queue, notifyQueue, {
          tenantCode: config.tenantCode,
          tenantName: config.tenantName,
          vaultChatId: config.vaultChatId,
          vaultThreadId: config.vaultThreadId
        });
  const deliveryService =
    config.databaseUrl === "memory"
      ? null
      : createDeliveryService(prisma, { tenantCode: config.tenantCode, tenantName: config.tenantName });

  registerTenantBot(bot, uploadStore, uploadService, deliveryService);

  return bot;
};
