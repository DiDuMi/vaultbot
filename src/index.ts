import { createBot } from "./bot";
import { loadConfig } from "./config";
import { logError } from "./infra/logging";
import { prisma } from "./infra/persistence";
import { assertProjectContextConsistency } from "./infra/persistence/tenant-guard";
import { createServer } from "./server";

const start = async () => {
  const config = loadConfig();
  await assertProjectContextConsistency(prisma, config.projectContext);
  const { bot, shutdown: shutdownBotResources } = createBot(config);
  const enableWebhook = Boolean(config.webhookBaseUrl);
  const server = createServer(bot, config, enableWebhook);
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    await server.close().catch((error) => logError({ component: "main", op: "shutdown_server_close" }, error));
    await Promise.resolve(bot.stop()).catch((error) => logError({ component: "main", op: "shutdown_bot_stop" }, error));
    await shutdownBotResources().catch((error) => logError({ component: "main", op: "shutdown_bot_resources" }, error));
    await prisma.$disconnect().catch((error) => logError({ component: "main", op: "shutdown_prisma_disconnect" }, error));
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
      { command: "start", description: "\u5f00\u59cb" },
      { command: "help", description: "\u5e2e\u52a9" },
      { command: "tag", description: "\u70ed\u95e8\u6807\u7b7e" },
      { command: "history", description: "\u6d4f\u89c8\u8db3\u8ff9" }
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
      throw error;
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

    await bot.start().catch((error) => {
      logError({ component: "main", op: "bot_start" }, error);
      throw error;
    });
  }
};

start().catch((error) => {
  logError({ component: "main", op: "startup" }, error);
  process.exit(1);
});
