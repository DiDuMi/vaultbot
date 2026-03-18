import Fastify from "fastify";
import { webhookCallback } from "grammy";
import type { Bot } from "grammy";
import type { Config } from "./config";
import { prisma } from "./infra/persistence";
import { getTenantDiagnostics } from "./infra/persistence/tenant-guard";

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
  app.get("/ops/tenant-check", async (request, reply) => {
    if (config.opsToken) {
      const auth = request.headers["x-ops-token"];
      const token = Array.isArray(auth) ? auth[0] : auth;
      if (token !== config.opsToken) {
        reply.code(401);
        return { ok: false };
      }
    }
    const result = await getTenantDiagnostics(prisma, config.tenantCode);
    return { ok: true, ...result };
  });

  return app;
};
