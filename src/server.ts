import Fastify from "fastify";
import { webhookCallback } from "grammy";
import type { Bot } from "grammy";
import type { Config } from "./config";

export const createServer = (bot: Bot, config: Config, enableWebhook: boolean) => {
  const app = Fastify({ logger: { redact: ["req.headers", "res.headers"] } });
  if (enableWebhook) {
    const callback = webhookCallback(bot, "fastify");

    app.post(config.webhookPath, async (request, reply) => {
      const header = request.headers["x-telegram-bot-api-secret-token"];
      const secret = Array.isArray(header) ? header[0] : header;
      if (secret !== config.webhookSecret) {
        reply.code(401);
        return { ok: false };
      }
      return callback(request, reply);
    });
  }

  app.get("/health", async () => ({ ok: true }));

  return app;
};
