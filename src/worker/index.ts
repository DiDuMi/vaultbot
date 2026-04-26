import { Bot } from "grammy";
import { PrismaClient } from "@prisma/client";
import { Queue, Worker } from "bullmq";
import { loadConfig } from "../config";
import { assertProjectContextConsistency } from "../infra/persistence/tenant-guard";
import { createRedisConnection } from "../infra/queue";
import { withTelegramRetry } from "../infra/telegram";
import { createDeliveryService } from "../services/use-cases";
import { startBroadcastScheduler } from "./broadcast-scheduler";
import {
  computeProjectNextBroadcastRunAt,
  ensureProjectRuntimeId,
  parseNumberWithBounds,
  sendProjectMediaGroupWithRetry,
  sleep
} from "./helpers";
import {
  getProjectAssetPublisherUserId,
  getProjectBroadcastTargetUserIds,
  getProjectScopeId,
  syncProjectUsers
} from "./project-audience";
import { startIntervalScheduler } from "./orchestration";
import { startProjectReplicationScheduler } from "./replication-scheduler";
import { createProjectReplicateBatch } from "./replication-worker";
import { createWorkerRoutes } from "./routes";
import { upsertProjectWorkerProcessHeartbeat, upsertProjectWorkerReplicationHeartbeat } from "./storage";
import { buildBroadcastKeyboard, escapeHtml, isBlockedError, logWorkerError, stripHtml } from "./strategy";

const start = async () => {
  const config = loadConfig();
  const bot = new Bot(config.botToken);
  const prisma = new PrismaClient();
  await assertProjectContextConsistency(prisma, config.projectContext);
  const deliveryService = createDeliveryService(prisma, config.projectContext);
  const me = await Promise.race([
    bot.api.getMe(),
    sleep(5000).then(() => null)
  ]).catch(() => null);
  const botUsername = me?.username ?? null;
  const useRedis = config.redisUrl !== "memory";
  const connection = useRedis ? createRedisConnection(config.redisUrl, { component: "worker" }) : null;
  if (connection) {
    const redisOk = await Promise.race([connection.ping().then(() => true), sleep(1500).then(() => false)]).catch(() => false);
    if (!redisOk) {
      await connection.quit().catch((error) => logWorkerError({ op: "redis_quit_on_fail" }, error));
      throw new Error("Redis \u4e0d\u53ef\u7528\uff1a\u8bf7\u5148\u542f\u52a8 Redis\uff0c\u6216\u8bbe\u7f6e REDIS_URL=memory\uff08\u4ec5\u672c\u5730\u8f6e\u8be2\u6a21\u5f0f\uff09\u3002");
    }
  }

  if (process.env.SYNC_USERS === "1") {
    const projectId = await ensureProjectRuntimeId(prisma, config.projectContext);
    await syncProjectUsers(bot, prisma, projectId);
    if (connection) {
      await connection.quit().catch((error) => logWorkerError({ op: "redis_quit_after_sync_users" }, error));
    }
    await prisma.$disconnect().catch((error) => logWorkerError({ op: "prisma_disconnect_after_sync_users" }, error));
    return;
  }
  const runtimeProjectId = await ensureProjectRuntimeId(prisma, config.projectContext);

  const replicateBatch = createProjectReplicateBatch({
    bot,
    prisma,
    config,
    sendMediaGroupWithRetry: sendProjectMediaGroupWithRetry
  });

  const runBroadcast = async (broadcastId: string, runId: string) => {
    try {
      const broadcast = await prisma.broadcast.findUnique({ where: { id: broadcastId } });
      if (!broadcast) {
        return;
      }
      const broadcastScopeId = getProjectScopeId({ projectId: broadcast.projectId, tenantId: broadcast.tenantId });
      const keyboard = buildBroadcastKeyboard(broadcast.buttons);
      const targetUserIds = await getProjectBroadcastTargetUserIds(prisma, broadcastScopeId);
      await prisma.broadcastRun.update({ where: { id: runId }, data: { targetCount: targetUserIds.length } });

      let successCount = 0;
      let failedCount = 0;
      let blockedCount = 0;
      const errorsSample: { userId: string; message: string }[] = [];
      const cancelCheckInterval = 50;
      let lastCancelCheckAt = 0;

      const shouldStop = async () => {
        const now = Date.now();
        if (now - lastCancelCheckAt < 1000) {
          return false;
        }
        lastCancelCheckAt = now;
        const current = await prisma.broadcast.findUnique({ where: { id: broadcastId }, select: { status: true } });
        return current?.status === "CANCELED";
      };

      for (let index = 0; index < targetUserIds.length; index += 1) {
        if (index > 0 && index % cancelCheckInterval === 0 && (await shouldStop())) {
          break;
        }
        const chatId = targetUserIds[index];
        try {
          const caption = broadcast.contentHtml || "";
          if (broadcast.mediaKind && broadcast.mediaFileId) {
            if (broadcast.mediaKind === "photo") {
              await withTelegramRetry(() =>
                bot.api.sendPhoto(chatId, broadcast.mediaFileId as string, { caption, parse_mode: "HTML", reply_markup: keyboard })
              );
            } else if (broadcast.mediaKind === "video") {
              await withTelegramRetry(() =>
                bot.api.sendVideo(chatId, broadcast.mediaFileId as string, { caption, parse_mode: "HTML", reply_markup: keyboard })
              );
            } else {
              await withTelegramRetry(() =>
                bot.api.sendDocument(chatId, broadcast.mediaFileId as string, { caption, parse_mode: "HTML", reply_markup: keyboard })
              );
            }
          } else {
            await withTelegramRetry(() => bot.api.sendMessage(chatId, caption, { parse_mode: "HTML", reply_markup: keyboard }));
          }
          successCount += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";
          if (isBlockedError(error)) {
            blockedCount += 1;
          } else {
            failedCount += 1;
            if (errorsSample.length < 20) {
              errorsSample.push({ userId: chatId, message });
            }
          }
        }
        await sleep(50);
      }

      const finishedAt = new Date();
      await prisma.broadcastRun.update({
        where: { id: runId },
        data: {
          successCount,
          failedCount,
          blockedCount,
          errorsSample: errorsSample.length ? (errorsSample as unknown as object) : undefined,
          finishedAt
        }
      });

      const latest = await prisma.broadcast.findUnique({ where: { id: broadcastId } });
      if (!latest || latest.status === "CANCELED") {
        return;
      }
      if (latest.repeatEveryMs) {
        const nextRunAt = computeProjectNextBroadcastRunAt({
          previousNextRunAt: latest.nextRunAt ?? null,
          repeatEveryMs: latest.repeatEveryMs,
          now: finishedAt
        });
        await prisma.broadcast.update({ where: { id: broadcastId }, data: { status: "SCHEDULED", nextRunAt } });
        return;
      }
      await prisma.broadcast.update({ where: { id: broadcastId }, data: { status: "COMPLETED", nextRunAt: null } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      await prisma.broadcastRun.update({
        where: { id: runId },
        data: { failedCount: 1, errorsSample: [{ userId: "system", message }] as unknown as object, finishedAt: new Date() }
      });
      await prisma.broadcast
        .update({ where: { id: broadcastId }, data: { status: "FAILED" } })
        .catch((dbError) => logWorkerError({ op: "broadcast_mark_failed", broadcastId, runId }, dbError));
      throw error;
    }
  };

  const broadcastQueue = connection ? new Queue("broadcast", { connection }) : null;
  const replicationQueue = connection ? new Queue("replication", { connection }) : null;
  const replicationBackfillQueue = connection ? new Queue("replication_backfill", { connection }) : null;
  const notifyQueue = connection ? new Queue("notify", { connection }) : null;

  const runFollowKeywordNotify = async (assetId: string) => {
    if (!botUsername) {
      return;
    }
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true, tenantId: true, projectId: true, title: true, description: true, shareCode: true }
    });
    if (!asset?.shareCode) {
      return;
    }
    const assetScopeId = getProjectScopeId({ projectId: asset.projectId, tenantId: asset.tenantId });
    const publisherUserId = await getProjectAssetPublisherUserId(prisma, assetScopeId, asset.id);
    const subs = await deliveryService.listFollowKeywordSubscriptions().catch(() => []);
    const plainTitle = stripHtml(asset.title ?? "");
    const plainDescription = stripHtml(asset.description ?? "");
    const haystack = `${plainTitle}\n${plainDescription}`.toLowerCase();
    const openLink = `https://t.me/${botUsername}?start=${asset.shareCode}`;
    for (const sub of subs) {
      const targetId = sub.userId;
      if (!targetId || targetId === publisherUserId) {
        continue;
      }
      const hit = sub.keywords.find((k) => haystack.includes(k.toLowerCase()));
      if (!hit) {
        continue;
      }
      const chatId = Number(targetId);
      if (!Number.isFinite(chatId)) {
        continue;
      }
      const allowed = await deliveryService.checkAndRecordUserNotification(String(chatId), {
        type: "follow",
        uniqueId: asset.id,
        minIntervalMs: 8000
      });
      if (!allowed) {
        continue;
      }
      const titleText = plainTitle.trim() || "未命名";
      const text = [
        `🔔 关注命中：<code>${escapeHtml(hit)}</code>`,
        "",
        `<b>${escapeHtml(titleText)}</b>`,
        `<a href="${escapeHtml(openLink)}">点击查看</a>`
      ].join("\n");
      try {
        await withTelegramRetry(() =>
          bot.api.sendMessage(chatId, text, { parse_mode: "HTML", link_preview_options: { is_disabled: true } })
        );
      } catch (error) {
        logWorkerError({ op: "follow_notify_send", scope: `asset:${asset.id}:user:${chatId}`, projectId: assetScopeId }, error);
        continue;
      }
      await sleep(30);
    }
  };

  const routes = createWorkerRoutes({
    replicateRequired: (batchId: string) => replicateBatch(batchId, { includeOptional: false }),
    replicateBackfill: (batchId: string) => replicateBatch(batchId, { includeOptional: true }),
    runBroadcast,
    runFollowKeywordNotify
  });

  const replicationConcurrency = parseNumberWithBounds(process.env.REPLICATION_CONCURRENCY, 5, 1, 50);
  const replicationBackfillConcurrency = parseNumberWithBounds(process.env.REPLICATION_BACKFILL_CONCURRENCY, 1, 1, 10);
  const shouldPurgeReplicationQueue = process.env.REPLICATION_QUEUE_PURGE === "1";
  if (shouldPurgeReplicationQueue) {
    if (replicationQueue) {
      await replicationQueue.pause().catch((error) => logWorkerError({ op: "replication_queue_purge_pause" }, error));
      await replicationQueue.obliterate({ force: true }).catch((error) => logWorkerError({ op: "replication_queue_purge_obliterate" }, error));
      await replicationQueue.resume().catch((error) => logWorkerError({ op: "replication_queue_purge_resume" }, error));
    }
    if (replicationBackfillQueue) {
      await replicationBackfillQueue.pause().catch((error) => logWorkerError({ op: "replication_backfill_queue_purge_pause" }, error));
      await replicationBackfillQueue.obliterate({ force: true }).catch((error) => logWorkerError({ op: "replication_backfill_queue_purge_obliterate" }, error));
      await replicationBackfillQueue.resume().catch((error) => logWorkerError({ op: "replication_backfill_queue_purge_resume" }, error));
    }
  }

  const replicationWorker = connection
    ? new Worker(
        "replication",
        routes.replicationRoute,
        { connection, concurrency: replicationConcurrency }
      )
    : null;

  const replicationBackfillWorker = connection
    ? new Worker(
        "replication_backfill",
        routes.replicationRoute,
        { connection, concurrency: replicationBackfillConcurrency }
      )
    : null;

  const replicationBackfillAutoPauseEnabled = process.env.REPLICATION_BACKFILL_AUTOPAUSE !== "0";
  const replicationBackfillAutoPauseIntervalMs = parseNumberWithBounds(
    process.env.REPLICATION_BACKFILL_AUTOPAUSE_INTERVAL_MS,
    2000,
    500,
    30_000
  );
  let replicationBackfillAutoPauseTimer: NodeJS.Timeout | null = null;
  const startReplicationBackfillAutoPause = () => {
    if (!replicationBackfillAutoPauseEnabled || !replicationBackfillQueue) {
      return;
    }
    const tick = async () => {
      const shouldPauseBecauseDisabled = process.env.REPLICATION_BACKFILL_ENABLED === "0";
      const hasPendingWork = await prisma.uploadBatch
        .findFirst({
          where: { status: "COMMITTED", items: { some: { status: { in: ["PENDING", "FAILED"] } } } },
          select: { id: true }
        })
        .then(Boolean)
        .catch(() => false);
      const foregroundQueueHasJobs = await (async () => {
        if (!replicationQueue) {
          return false;
        }
        try {
          const counts = (await replicationQueue.getJobCounts()) as Record<string, number>;
          const waiting = counts.waiting ?? 0;
          const active = counts.active ?? 0;
          const delayed = counts.delayed ?? 0;
          const prioritized = (counts as Record<string, number>).prioritized ?? 0;
          return waiting + active + delayed + prioritized > 0;
        } catch {
          return false;
        }
      })();
      const shouldPause = shouldPauseBecauseDisabled || hasPendingWork || foregroundQueueHasJobs;
      if (shouldPause) {
        await replicationBackfillQueue.pause().catch((error) => logWorkerError({ op: "replication_backfill_autopause_pause" }, error));
        return;
      }
      await replicationBackfillQueue.resume().catch((error) => logWorkerError({ op: "replication_backfill_autopause_resume" }, error));
    };
    replicationBackfillAutoPauseTimer = startIntervalScheduler(replicationBackfillAutoPauseIntervalMs, tick, () => undefined);
  };

  const broadcastWorker = connection
    ? new Worker(
        "broadcast",
        routes.broadcastRoute,
        { connection, concurrency: 1 }
      )
    : null;

  const notifyWorker = connection
    ? new Worker(
        "notify",
        routes.notifyRoute,
        { connection, concurrency: 2 }
      )
    : null;

  let schedulerTimer: NodeJS.Timeout | null = null;
  schedulerTimer = startBroadcastScheduler({
    prisma,
    broadcastQueue,
    runBroadcast,
    logError: (meta, error) => logWorkerError(meta, error)
  });
  startReplicationBackfillAutoPause();

  let replicationTimer: NodeJS.Timeout | null = null;
  replicationTimer = startProjectReplicationScheduler({
    prisma,
    runtimeProjectId,
    replicationQueue,
    replicationBackfillQueue,
    replicateBatch,
    upsertWorkerProcessHeartbeat: (projectId, ts) => upsertProjectWorkerProcessHeartbeat(prisma, projectId, ts),
    upsertWorkerReplicationHeartbeat: (projectId, ts) => upsertProjectWorkerReplicationHeartbeat(prisma, projectId, ts),
    parseNumberWithBounds,
    logError: (meta, error) => logWorkerError(meta, error)
  });

  const shutdown = async () => {
    if (replicationWorker) {
      await replicationWorker.close();
    }
    if (replicationBackfillWorker) {
      await replicationBackfillWorker.close();
    }
    if (broadcastWorker) {
      await broadcastWorker.close();
    }
    if (notifyWorker) {
      await notifyWorker.close();
    }
    if (schedulerTimer) {
      clearInterval(schedulerTimer);
      schedulerTimer = null;
    }
    if (replicationTimer) {
      clearInterval(replicationTimer);
      replicationTimer = null;
    }
    if (replicationBackfillAutoPauseTimer) {
      clearInterval(replicationBackfillAutoPauseTimer);
      replicationBackfillAutoPauseTimer = null;
    }
    if (broadcastQueue) {
      await broadcastQueue.close();
    }
    if (replicationQueue) {
      await replicationQueue.close();
    }
    if (replicationBackfillQueue) {
      await replicationBackfillQueue.close();
    }
    if (notifyQueue) {
      await notifyQueue.close();
    }
    if (connection) {
      await connection.quit();
    }
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

start().catch((error) => {
  logWorkerError({ op: "worker_startup" }, error);
  process.exit(1);
});
