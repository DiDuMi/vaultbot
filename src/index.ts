import { createBot } from "./bot";
import { loadConfig } from "./config";
import { createServer } from "./server";

const start = async () => {
  const config = loadConfig();
  const bot = createBot(config);
  const enableWebhook = Boolean(config.webhookBaseUrl);
  const server = createServer(bot, config, enableWebhook);

  await server.listen({ host: config.host, port: config.port });

  try {
    await bot.api.setMyCommands([
      { command: "start", description: "开始" },
      { command: "help", description: "帮助" }
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "unknown error");
    console.error("[main:setMyCommands]", message);
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
      const message = error instanceof Error ? error.message : String(error ?? "unknown error");
      console.error("[main:setWebhook]", message);
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
      const message = error instanceof Error ? error.message : String(error ?? "unknown error");
      console.error("[main:clearWebhook]", message);
    }

    try {
      await bot.start();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown error");
      console.error("[main:botStart]", message);
    }
  }
};

start().catch((error) => {
  const message = error instanceof Error ? error.message : String(error ?? "unknown error");
  console.error("[main]", message);
  process.exit(1);
});
