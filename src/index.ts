import { createBot } from "./bot";
import { loadConfig } from "./config";
import { logError } from "./infra/logging";
import { prisma } from "./infra/persistence";
import { assertTenantCodeConsistency } from "./infra/persistence/tenant-guard";
import { createServer } from "./server";

const start = async () => {
  const config = loadConfig();
  await assertTenantCodeConsistency(prisma, config.tenantCode);
  const bot = createBot(config);
  const enableWebhook = Boolean(config.webhookBaseUrl);
  const server = createServer(bot, config, enableWebhook);
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    await server.close().catch(() => undefined);
    await Promise.resolve(bot.stop()).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });

  await server.listen({ host: config.host, port: config.port });

  try {
    await bot.api.setMyCommands([
      { command: "start", description: "开始" },
      { command: "help", description: "帮助" }
    ]);
  } catch (error) {
    logError({ component: "main", op: "set_my_commands" }, error);
  }

  if (enableWebhook) {
    const url = new URL(config.webhookPath, config.webhookBaseUrl).toString();
    try {
      if (config.webhookSecret) {
        await bot.api.setWebhook(url, { secret_token: config.webhookSecret });
      } else {
        await bot.api.setWebhook(url);
      }
    } catch (error) {
      logError({ component: "main", op: "set_webhook" }, error);
    }
  } else {
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await bot.api.deleteWebhook({ drop_pending_updates: true });
        const info = await bot.api.getWebhookInfo();
        if (!info.url) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      logError({ component: "main", op: "clear_webhook" }, error);
    }

    try {
      await bot.start();
    } catch (error) {
      logError({ component: "main", op: "bot_start" }, error);
    }
  }
};

start().catch((error) => {
  logError({ component: "main", op: "startup" }, error);
  process.exit(1);
});
