import { Bot } from "grammy";
import { PrismaClient } from "@prisma/client";
import { Queue, Worker } from "bullmq";
import { loadConfig } from "../config";
import { assertTenantCodeConsistency } from "../infra/persistence/tenant-guard";
import { createRedisConnection } from "../infra/queue";
import { copyToVault, withTelegramRetry } from "../infra/telegram";
import { createDeliveryService } from "../services/use-cases";
import { startBroadcastScheduler } from "./broadcast-scheduler";
import {
  backfillTenantUsers,
  ensureTenantId,
  getBroadcastTargetUserIds,
  parseNumberWithBounds,
  sendMediaGroupWithRetry,
  sleep
} from "./helpers";
import { startIntervalScheduler } from "./orchestration";
import { startReplicationScheduler } from "./replication-scheduler";
import { createReplicateBatch } from "./replication-worker";
import { createWorkerRoutes } from "./routes";
import { upsertWorkerProcessHeartbeat, upsertWorkerReplicationHeartbeat } from "./storage";
import { buildBroadcastKeyboard, escapeHtml, isBlockedError, logWorkerError, stripHtml } from "./strategy";

const start = async () => {
  const config = loadConfig();
  const bot = new Bot(config.botToken);
  const prisma = new PrismaClient();
  await assertTenantCodeConsistency(prisma, config.tenantCode);
  const deliveryService = createDeliveryService(prisma, { tenantCode: config.tenantCode, tenantName: config.tenantName });
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
      throw new Error("Redis 不可用：请先启动 Redis，或设置 REDIS_URL=memory（仅本地轮询模式）");
    }
  }

  if (process.env.SYNC_USERS === "1") {
    const tenantId = await ensureTenantId(prisma, { tenantCode: config.tenantCode, tenantName: config.tenantName });
    await backfillTenantUsers(bot, prisma, tenantId);
    if (connection) {
      await connection.quit().catch((error) => logWorkerError({ op: "redis_quit_after_sync_users" }, error));
    }
    await prisma.$disconnect().catch((error) => logWorkerError({ op: "prisma_disconnect_after_sync_users" }, error));
    return;
  }
  const runtimeTenantId = await ensureTenantId(prisma, { tenantCode: config.tenantCode, tenantName: config.tenantName });

  const legacyReplicateBatch = async (batchId: string, options?: { includeOptional?: boolean }) => {
    const includeOptional = options?.includeOptional !== false;
    const batch = await prisma.uploadBatch.findUnique({
      where: { id: batchId },
      include: { items: { orderBy: { createdAt: "asc" } } }
    });
    if (!batch) {
      return;
    }

    const asset = await prisma.asset.findUnique({
      where: { id: batch.assetId },
      select: { collectionId: true, collection: { select: { title: true } } }
    });
    const rawCollectionId = asset?.collectionId ?? null;
    const collectionId = rawCollectionId ?? "none";
    const collectionTitle = asset?.collection?.title ?? (rawCollectionId ? "分类" : "未分类");

    const bindings = await prisma.tenantVaultBinding.findMany({
      where: { tenantId: batch.tenantId, role: { in: ["PRIMARY", "BACKUP"] } },
      include: { vaultGroup: true },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }]
    });
    if (bindings.length === 0) {
      const configuredChatId = BigInt(config.vaultChatId);
      const createdGroup = await prisma.vaultGroup.upsert({
        where: { tenantId_chatId: { tenantId: batch.tenantId, chatId: configuredChatId } },
        update: {},
        create: { tenantId: batch.tenantId, chatId: configuredChatId }
      });
      await prisma.tenantVaultBinding.upsert({
        where: { tenantId_vaultGroupId_role: { tenantId: batch.tenantId, vaultGroupId: createdGroup.id, role: "PRIMARY" } },
        update: {},
        create: { tenantId: batch.tenantId, vaultGroupId: createdGroup.id, role: "PRIMARY" }
      });
      const createdBinding = await prisma.tenantVaultBinding.findUnique({
        where: { tenantId_vaultGroupId_role: { tenantId: batch.tenantId, vaultGroupId: createdGroup.id, role: "PRIMARY" } },
        include: { vaultGroup: true }
      });
      if (createdBinding) {
        bindings.push(createdBinding);
      }
    }

    const roleRank = (role: "PRIMARY" | "BACKUP") => (role === "PRIMARY" ? 0 : 1);
    const dedup = new Map<string, (typeof bindings)[number]>();
    for (const binding of bindings) {
      const existing = dedup.get(binding.vaultGroupId);
      if (!existing || roleRank(binding.role as "PRIMARY" | "BACKUP") < roleRank(existing.role as "PRIMARY" | "BACKUP")) {
        dedup.set(binding.vaultGroupId, binding);
      }
    }
    const uniqueBindings = Array.from(dedup.values()).sort((a, b) => roleRank(a.role as "PRIMARY" | "BACKUP") - roleRank(b.role as "PRIMARY" | "BACKUP"));
    const nonBanned = uniqueBindings.filter((b) => b.vaultGroup.status !== "BANNED");
    const required = nonBanned.find((b) => b.role === "PRIMARY") ?? nonBanned[0] ?? uniqueBindings[0];
    const optional = nonBanned.filter((b) => b.vaultGroupId !== required.vaultGroupId);
    const targets = includeOptional
      ? [{ binding: required, required: true }, ...optional.map((b) => ({ binding: b, required: false }))]
      : [{ binding: required, required: true }];

    const rawMinReplicas = await prisma.tenantSetting
      .findUnique({
        where: { tenantId_key: { tenantId: batch.tenantId, key: "min_replicas" } },
        select: { value: true }
      })
      .then((row) => row?.value ?? null)
      .catch(() => null);
    const parsedMin = rawMinReplicas ? Number(rawMinReplicas) : 1;
    const minReplicas = !Number.isFinite(parsedMin) ? 1 : Math.min(3, Math.max(1, Math.trunc(parsedMin)));

    if (targets.length < minReplicas) {
      const message = `可用存储群不足：当前 ${targets.length} 个，要求最少 ${minReplicas} 个。`;
      await prisma.uploadItem.updateMany({
        where: { batchId: batch.id, status: { in: ["PENDING", "FAILED"] } },
        data: { status: "FAILED", lastError: message }
      });
      return;
    }

    const existing = await prisma.assetReplica.findMany({
      where: { assetId: batch.assetId, status: "ACTIVE", vaultGroupId: { in: targets.map((t) => t.binding.vaultGroupId) } },
      select: { uploadItemId: true, vaultGroupId: true }
    });
    const existingKeys = new Set(existing.filter((r) => r.uploadItemId).map((r) => `${r.uploadItemId}:${r.vaultGroupId}`));
    const hasReplica = (uploadItemId: string, vaultGroupId: string) => existingKeys.has(`${uploadItemId}:${vaultGroupId}`);
    const markReplica = (uploadItemId: string, vaultGroupId: string) => {
      existingKeys.add(`${uploadItemId}:${vaultGroupId}`);
    };

    const ensureThreadId = async (vaultGroupId: string, vaultChatId: string, isForum: boolean) => {
      if (isForum) {
        const topic = await prisma.tenantTopic.findFirst({
          where: { tenantId: batch.tenantId, vaultGroupId, collectionId, version: 1 }
        });
        const existingThreadId = topic?.messageThreadId ? Number(topic.messageThreadId) : null;
        if (existingThreadId) {
          return existingThreadId;
        }
        const normalized = String(collectionTitle || "未分类")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 64);
        const created = await withTelegramRetry(() => bot.api.createForumTopic(vaultChatId, normalized || "未分类")).catch(() => null);
        const createdThreadId = created?.message_thread_id;
        if (typeof createdThreadId === "number") {
          await prisma.tenantTopic
            .upsert({
              where: {
                tenantId_vaultGroupId_collectionId_version: {
                  tenantId: batch.tenantId,
                  vaultGroupId,
                  collectionId,
                  version: 1
                }
              },
              update: { messageThreadId: BigInt(createdThreadId) },
              create: {
                tenantId: batch.tenantId,
                vaultGroupId,
                collectionId,
                messageThreadId: BigInt(createdThreadId),
                version: 1
              }
            })
            .catch((error) =>
              logWorkerError(
                { op: "tenant_topic_upsert", tenantId: batch.tenantId, scope: `vaultGroupId:${vaultGroupId}:collectionId:${collectionId}:v1` },
                error
              )
            );
          return createdThreadId;
        }
        return undefined;
      }
      if (config.vaultThreadId !== undefined) {
        await prisma.tenantTopic.upsert({
          where: {
            tenantId_vaultGroupId_collectionId_version: {
              tenantId: batch.tenantId,
              vaultGroupId,
              collectionId: "none",
              version: 1
            }
          },
          update: { messageThreadId: BigInt(config.vaultThreadId) },
          create: {
            tenantId: batch.tenantId,
            vaultGroupId,
            collectionId: "none",
            messageThreadId: BigInt(config.vaultThreadId),
            version: 1
          }
        });
        return config.vaultThreadId;
      }
      return undefined;
    };

    let hasFailure = false;

    for (const target of targets) {
      const vaultGroup = target.binding.vaultGroup;
      const vaultChatId = vaultGroup.chatId.toString();
      const chat = await bot.api.getChat(vaultChatId).catch(() => null);
      const isForum = (chat as { is_forum?: boolean } | null)?.is_forum === true;
      const threadId = await ensureThreadId(vaultGroup.id, vaultChatId, isForum).catch((error) => {
        logWorkerError({ op: "ensure_thread_id", tenantId: batch.tenantId, scope: `vaultGroupId:${vaultGroup.id}:chatId:${vaultChatId}` }, error);
        return undefined;
      });

      type BatchItem = (typeof batch)["items"][number];
      const items: BatchItem[] = batch.items;
      let index = 0;
      while (index < items.length) {
        const item = items[index];
        if (target.required && item.status === "SUCCESS") {
          index += 1;
          continue;
        }
        const canGroup = item.mediaGroupId && (item.kind === "photo" || item.kind === "video") && item.fileId;
        if (canGroup) {
          const groupId = item.mediaGroupId as string;
          const groupItems: BatchItem[] = [];
          const album: { type: "photo" | "video"; media: string }[] = [];
          while (
            index < items.length &&
            items[index].mediaGroupId === groupId &&
            (items[index].kind === "photo" || items[index].kind === "video") &&
            items[index].fileId
          ) {
            groupItems.push(items[index]);
            album.push({
              type: items[index].kind === "photo" ? "photo" : "video",
              media: items[index].fileId as string
            });
            index += 1;
          }
          const shouldReplicate = groupItems.some((groupItem) => !hasReplica(groupItem.id, vaultGroup.id));
          if (!shouldReplicate) {
            continue;
          }
          try {
            const copiedMessages = await sendMediaGroupWithRetry(bot, vaultChatId, album, threadId);
            await prisma.$transaction(async (tx) => {
              await Promise.all(
                groupItems.map((groupItem, itemIndex) =>
                  tx.assetReplica.upsert({
                    where: {
                      assetId_uploadItemId_vaultGroupId: {
                        assetId: batch.assetId,
                        uploadItemId: groupItem.id,
                        vaultGroupId: vaultGroup.id
                      }
                    },
                    update: {
                      messageId: BigInt(copiedMessages[itemIndex].message_id),
                      messageThreadId: threadId !== undefined ? BigInt(threadId) : null,
                      status: "ACTIVE"
                    },
                    create: {
                      assetId: batch.assetId,
                      uploadItemId: groupItem.id,
                      vaultGroupId: vaultGroup.id,
                      messageId: BigInt(copiedMessages[itemIndex].message_id),
                      messageThreadId: threadId !== undefined ? BigInt(threadId) : undefined,
                      status: "ACTIVE"
                    }
                  })
                )
              );
              if (target.required) {
                await Promise.all(
                  groupItems.map((groupItem) =>
                    tx.uploadItem.update({ where: { id: groupItem.id }, data: { status: "SUCCESS", lastError: null } })
                  )
                );
              }
            });
            for (const groupItem of groupItems) {
              markReplica(groupItem.id, vaultGroup.id);
            }
          } catch (error) {
            if (target.required) {
              hasFailure = true;
              const message = error instanceof Error ? error.message : "unknown error";
              await Promise.all(
                groupItems.map((groupItem) =>
                  prisma.uploadItem.update({ where: { id: groupItem.id }, data: { status: "FAILED", lastError: message } })
                )
              );
            }
          }
          continue;
        }
        if (hasReplica(item.id, vaultGroup.id)) {
          index += 1;
          continue;
        }
        try {
          const copied = await copyToVault(bot, {
            fromChatId: item.chatId,
            messageId: Number(item.messageId),
            toChatId: vaultChatId,
            threadId
          });

          await prisma.$transaction(async (tx) => {
            await tx.assetReplica.upsert({
              where: {
                assetId_uploadItemId_vaultGroupId: {
                  assetId: batch.assetId,
                  uploadItemId: item.id,
                  vaultGroupId: vaultGroup.id
                }
              },
              update: {
                messageId: BigInt(copied.message_id),
                messageThreadId: threadId !== undefined ? BigInt(threadId) : null,
                status: "ACTIVE"
              },
              create: {
                assetId: batch.assetId,
                uploadItemId: item.id,
                vaultGroupId: vaultGroup.id,
                messageId: BigInt(copied.message_id),
                messageThreadId: threadId !== undefined ? BigInt(threadId) : undefined,
                status: "ACTIVE"
              }
            });
            if (target.required) {
              await tx.uploadItem.update({ where: { id: item.id }, data: { status: "SUCCESS", lastError: null } });
            }
          });
          markReplica(item.id, vaultGroup.id);
        } catch (error) {
          if (target.required) {
            hasFailure = true;
            const message = error instanceof Error ? error.message : "unknown error";
            await prisma.uploadItem.update({ where: { id: item.id }, data: { status: "FAILED", lastError: message } });
          }
        }
        index += 1;
      }
    }

    const counts = await prisma.assetReplica
      .groupBy({
        by: ["uploadItemId"],
        where: {
          assetId: batch.assetId,
          status: "ACTIVE",
          uploadItemId: { not: null },
          vaultGroupId: { in: targets.map((t) => t.binding.vaultGroupId) }
        },
        _count: { _all: true }
      })
      .catch(() => []);
    const countByUploadItemId = new Map<string, number>();
    for (const row of counts) {
      const id = row.uploadItemId;
      if (typeof id === "string") {
        countByUploadItemId.set(id, row._count._all);
      }
    }
    for (const item of batch.items) {
      const successCount = countByUploadItemId.get(item.id) ?? 0;
      if (successCount >= minReplicas) {
        if (item.status !== "SUCCESS") {
          await prisma.uploadItem
            .update({ where: { id: item.id }, data: { status: "SUCCESS", lastError: null } })
            .catch((error) =>
              logWorkerError(
                { op: "upload_item_status_update", tenantId: batch.tenantId, batchId: batch.id, scope: `uploadItemId:${item.id}:next:SUCCESS` },
                error
              )
            );
        }
        continue;
      }
      if (item.status === "SUCCESS") {
        await prisma.uploadItem
          .update({ where: { id: item.id }, data: { status: "PENDING", lastError: null } })
          .catch((error) =>
            logWorkerError(
              { op: "upload_item_status_update", tenantId: batch.tenantId, batchId: batch.id, scope: `uploadItemId:${item.id}:next:PENDING` },
              error
            )
          );
      } else if (item.status === "FAILED") {
        continue;
      } else {
        await prisma.uploadItem
          .update({ where: { id: item.id }, data: { status: "PENDING" } })
          .catch((error) =>
            logWorkerError(
              { op: "upload_item_status_update", tenantId: batch.tenantId, batchId: batch.id, scope: `uploadItemId:${item.id}:next:PENDING` },
              error
            )
          );
      }
    }

    if (hasFailure) {
      throw new Error("replication failed");
    }
  };

  const replicateBatch = createReplicateBatch({
    bot,
    prisma,
    config,
    sendMediaGroupWithRetry
  });

  const runBroadcast = async (broadcastId: string, runId: string) => {
    try {
      const broadcast = await prisma.broadcast.findUnique({ where: { id: broadcastId } });
      if (!broadcast) {
        return;
      }
      const keyboard = buildBroadcastKeyboard(broadcast.buttons);
      const targetUserIds = await getBroadcastTargetUserIds(prisma, broadcast.tenantId);
      await prisma.broadcastRun.update({ where: { id: runId }, data: { targetCount: targetUserIds.length } });

      let successCount = 0;
      let failedCount = 0;
      let blockedCount = 0;
      const errorsSample: { userId: string; message: string }[] = [];

      const shouldStop = async () => {
        const current = await prisma.broadcast.findUnique({ where: { id: broadcastId }, select: { status: true } });
        return current?.status === "CANCELED";
      };

      for (let index = 0; index < targetUserIds.length; index += 1) {
        if (index % 20 === 0 && (await shouldStop())) {
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
        await prisma.broadcast.update({ where: { id: broadcastId }, data: { status: "SCHEDULED", nextRunAt: new Date(Date.now() + latest.repeatEveryMs) } });
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
      select: { id: true, tenantId: true, title: true, description: true, shareCode: true }
    });
    if (!asset?.shareCode) {
      return;
    }
    const publisherBatch = await prisma.uploadBatch.findFirst({
      where: { tenantId: asset.tenantId, assetId: asset.id, status: "COMMITTED" },
      orderBy: { createdAt: "desc" },
      select: { userId: true }
    });
    const publisherUserId = publisherBatch?.userId ?? null;
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
        logWorkerError({ op: "follow_notify_send", scope: `asset:${asset.id}:user:${chatId}`, tenantId: asset.tenantId }, error);
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
  replicationTimer = startReplicationScheduler({
    prisma,
    runtimeTenantId,
    replicationQueue,
    replicationBackfillQueue,
    replicateBatch,
    upsertWorkerProcessHeartbeat: (tenantId, ts) => upsertWorkerProcessHeartbeat(prisma, tenantId, ts),
    upsertWorkerReplicationHeartbeat: (tenantId, ts) => upsertWorkerReplicationHeartbeat(prisma, tenantId, ts),
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
