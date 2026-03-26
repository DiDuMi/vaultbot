import Fastify from "fastify";
import { webhookCallback } from "grammy";
import type { Bot } from "grammy";
import type { Config } from "./config";
import { prisma } from "./infra/persistence";
import { getTenantDiagnostics } from "./infra/persistence/tenant-guard";
import { createRedisConnection } from "./infra/queue";

const withTimeout = async <T>(promise: Promise<T>, ms: number) => {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => {
        clearTimeout(timer);
        reject(new Error("timeout"));
      }, ms);
    })
  ]);
};

const parseNumberWithBounds = (raw: string | undefined, fallback: number, min: number, max: number) => {
  const value = Number(raw ?? "");
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
};

const getClientIp = (headers: Record<string, unknown>, ip: string) => {
  const forwarded = headers["x-forwarded-for"];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof firstForwarded === "string" && firstForwarded.trim() !== "") {
    return firstForwarded.split(",")[0]?.trim() || ip;
  }
  return ip;
};

export const createServer = (bot: Bot, config: Config, enableWebhook: boolean) => {
  const app = Fastify({ logger: { redact: ["req.headers", "res.headers"] } });
  const healthTimeoutMs = parseNumberWithBounds(process.env.HEALTH_CHECK_TIMEOUT_MS, 1500, 200, 10_000);
  const opsRateLimitWindowMs = parseNumberWithBounds(process.env.OPS_TENANT_CHECK_RATE_WINDOW_MS, 60_000, 1_000, 3_600_000);
  const opsRateLimitMax = parseNumberWithBounds(process.env.OPS_TENANT_CHECK_RATE_LIMIT, 60, 1, 10_000);
  const opsRateLimitStates = new Map<string, { windowStartAt: number; count: number }>();
  const checkReadiness = async () => {
    let database = false;
    let redis = config.redisUrl === "memory";
    try {
      await withTimeout(prisma.$queryRawUnsafe("SELECT 1"), healthTimeoutMs);
      database = true;
    } catch {
      database = false;
    }
    if (config.redisUrl !== "memory") {
      const connection = createRedisConnection(config.redisUrl);
      try {
        await withTimeout(connection.connect(), healthTimeoutMs);
        await withTimeout(connection.ping(), healthTimeoutMs);
        redis = true;
      } catch {
        redis = false;
      } finally {
        await connection.quit().catch((error) => {
          console.error(
            JSON.stringify({
              level: "warn",
              at: new Date().toISOString(),
              component: "server",
              op: "health_redis_quit",
              error: error instanceof Error ? error.message : String(error ?? "unknown error")
            })
          );
        });
      }
    }
    const ok = database && redis;
    return { ok, checks: { database, redis } };
  };
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

  app.get("/health/live", async () => ({ ok: true, uptimeSec: Math.floor(process.uptime()) }));
  app.get("/health/ready", async (_, reply) => {
    const result = await checkReadiness();
    const ok = result.ok;
    if (!ok) {
      reply.code(503);
    }
    return result;
  });
  app.get("/health", async (_, reply) => {
    const result = await checkReadiness();
    const ok = result.ok;
    if (!ok) {
      reply.code(503);
    }
    return result;
  });
  app.get("/ops/tenant-check", async (request, reply) => {
    const now = Date.now();
    const auditBase = {
      at: new Date().toISOString(),
      op: "tenant_check",
      ip: getClientIp(request.headers as Record<string, unknown>, request.ip)
    };
    const current = opsRateLimitStates.get(auditBase.ip);
    const inWindow = current && now - current.windowStartAt < opsRateLimitWindowMs;
    const nextCount = inWindow ? current.count + 1 : 1;
    opsRateLimitStates.set(auditBase.ip, { windowStartAt: inWindow ? current.windowStartAt : now, count: nextCount });
    if (opsRateLimitStates.size > 10_000) {
      for (const [ip, state] of opsRateLimitStates) {
        if (now - state.windowStartAt >= opsRateLimitWindowMs) {
          opsRateLimitStates.delete(ip);
        }
      }
    }
    if (nextCount > opsRateLimitMax) {
      const retryAfterSec = Math.max(1, Math.ceil(opsRateLimitWindowMs / 1000));
      reply.header("Retry-After", String(retryAfterSec));
      reply.code(429);
      console.info(JSON.stringify({ ...auditBase, status: "rejected", code: 429, reason: "rate_limited" }));
      return { ok: false };
    }
    if (!config.opsToken || config.opsToken.trim() === "") {
      reply.code(503);
      console.info(JSON.stringify({ ...auditBase, status: "rejected", code: 503, reason: "ops_token_missing" }));
      return { ok: false };
    }
    const auth = request.headers["x-ops-token"];
    const token = Array.isArray(auth) ? auth[0] : auth;
    if (token !== config.opsToken) {
      reply.code(401);
      console.info(JSON.stringify({ ...auditBase, status: "rejected", code: 401, reason: "token_mismatch" }));
      return { ok: false };
    }
    const result = await getTenantDiagnostics(prisma, config.tenantCode);
    console.info(JSON.stringify({ ...auditBase, status: "ok", code: 200 }));
    return { ok: true, ...result };
  });

  return app;
};
