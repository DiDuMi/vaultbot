import { Bot } from "grammy";
import { PrismaClient } from "@prisma/client";
import { Queue, Worker } from "bullmq";
import { loadConfig } from "../config";
import { assertTenantCodeConsistency } from "../infra/persistence/tenant-guard";
import { createRedisConnection } from "../infra/queue";
import { copyToVault, withTelegramRetry } from "../infra/telegram";
import { createDeliveryService } from "../services/use-cases";
import { startIntervalScheduler } from "./orchestration";
import { createWorkerRoutes } from "./routes";
import { upsertWorkerProcessHeartbeat, upsertWorkerReplicationHeartbeat } from "./storage";
import { buildBroadcastKeyboard, escapeHtml, isBlockedError, logWorkerError, stripHtml } from "./strategy";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const parseNumberWithBounds = (raw: string | undefined, fallback: number, min: number, max: number) => {
  const value = Number(raw ?? "");
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
};

const sendMediaGroupWithRetry = async (
  bot: Bot,
  chatId: string,
  album: { type: "photo" | "video"; media: string }[],
  threadId?: number
) => {
  const run = () => {
    if (threadId !== undefined) {
      return bot.api.sendMediaGroup(chatId, album, { message_thread_id: threadId });
    }
    return bot.api.sendMediaGroup(chatId, album);
  };
  return withTelegramRetry(run);
};

const getBroadcastTargetUserIds = async (prisma: PrismaClient, tenantId: string) => {
  const [users, members] = await Promise.all([
    prisma.event.groupBy({ by: ["userId"], where: { tenantId } }),
    prisma.tenantMember.findMany({ where: { tenantId }, select: { tgUserId: true } })
  ]);
  const excluded = new Set(members.map((m) => m.tgUserId));
  return users.map((u) => u.userId).filter((id) => !excluded.has(id));
};

const ensureTenantId = async (prisma: PrismaClient, config: { tenantCode: string; tenantName: string }) => {
  const tenant = await prisma.tenant.upsert({
    where: { code: config.tenantCode },
    update: { name: config.tenantName },
    create: { code: config.tenantCode, name: config.tenantName }
  });
  return tenant.id;
};

const isSafeTelegramNumericId = (value: string) => {
  const numericId = Number(value);
  if (!Number.isSafeInteger(numericId)) {
    return null;
  }
  if (numericId <= 0) {
    return null;
  }
  return numericId;
};

const backfillTenantUsers = async (bot: Bot, prisma: PrismaClient, tenantId: string) => {
  const limit = (() => {
    const raw = Number(process.env.SYNC_USERS_LIMIT ?? "");
    if (!Number.isFinite(raw)) {
      return 300;
    }
    return Math.max(1, Math.min(2000, Math.trunc(raw)));
  })();

  const [eventUsers, commentUsers, batchUsers, members, existingUsers] = await Promise.all([
    prisma.event.groupBy({ by: ["userId"], where: { tenantId } }),
    prisma.assetComment.groupBy({ by: ["authorUserId"], where: { tenantId } }),
    prisma.uploadBatch.groupBy({ by: ["userId"], where: { tenantId } }),
    prisma.tenantMember.findMany({ where: { tenantId }, select: { tgUserId: true } }),
    prisma.tenantUser.findMany({ where: { tenantId }, select: { tgUserId: true } })
  ]);

  const existing = new Set(existingUsers.map((u) => u.tgUserId));
  const candidates = new Set<string>();
  for (const row of eventUsers) {
    candidates.add(row.userId);
  }
  for (const row of commentUsers) {
    candidates.add(row.authorUserId);
  }
  for (const row of batchUsers) {
    candidates.add(row.userId);
  }
  for (const row of members) {
    candidates.add(row.tgUserId);
  }

  const ids = Array.from(candidates)
    .filter((id) => id && !existing.has(id))
    .slice(0, limit);

  if (ids.length === 0) {
    return;
  }

  for (const id of ids) {
    const numericId = isSafeTelegramNumericId(id);
    if (numericId === null) {
      continue;
    }
    const chat = await withTelegramRetry(() => bot.api.getChat(numericId)).catch(() => null);
    const username = (chat as { username?: string | null } | null)?.username?.trim().replace(/^@+/, "") || null;
    const firstName = (chat as { first_name?: string | null } | null)?.first_name?.trim() || null;
    const lastName = (chat as { last_name?: string | null } | null)?.last_name?.trim() || null;
    const now = new Date();
    await prisma.tenantUser
      .upsert({
        where: { tenantId_tgUserId: { tenantId, tgUserId: id } },
        update: { username, firstName, lastName, lastSeenAt: now },
        create: {
          tenantId,
          tgUserId: id,
          username,
          firstName,
          lastName,
          languageCode: null,
          isBot: false,
          lastSeenAt: now
        }
      })
      .catch(() => undefined);
    await sleep(200);
  }
};

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
  const connection = useRedis ? createRedisConnection(config.redisUrl) : null;
  if (connection) {
    const redisOk = await Promise.race([connection.ping().then(() => true), sleep(1500).then(() => false)]).catch(() => false);
    if (!redisOk) {
      await connection.quit().catch(() => undefined);
      throw new Error("Redis 不可用：请先启动 Redis，或设置 REDIS_URL=memory（仅本地轮询模式）");
    }
  }

  if (process.env.SYNC_USERS === "1") {
    const tenantId = await ensureTenantId(prisma, { tenantCode: config.tenantCode, tenantName: config.tenantName });
    await backfillTenantUsers(bot, prisma, tenantId);
    if (connection) {
      await connection.quit().catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
    return;
  }
  const runtimeTenantId = await ensureTenantId(prisma, { tenantCode: config.tenantCode, tenantName: config.tenantName });

  const replicateBatch = async (batchId: string) => {
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
    const targets = [{ binding: required, required: true }, ...optional.map((b) => ({ binding: b, required: false }))];

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
            .catch(() => undefined);
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
      const threadId = await ensureThreadId(vaultGroup.id, vaultChatId, isForum).catch(() => undefined);

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
          await prisma.uploadItem.update({ where: { id: item.id }, data: { status: "SUCCESS", lastError: null } }).catch(() => undefined);
        }
        continue;
      }
      if (item.status === "SUCCESS") {
        await prisma.uploadItem
          .update({ where: { id: item.id }, data: { status: "PENDING", lastError: null } })
          .catch(() => undefined);
      } else if (item.status === "FAILED") {
        continue;
      } else {
        await prisma.uploadItem.update({ where: { id: item.id }, data: { status: "PENDING" } }).catch(() => undefined);
      }
    }

    if (hasFailure) {
      throw new Error("replication failed");
    }
  };

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
      await prisma.broadcast.update({ where: { id: broadcastId }, data: { status: "FAILED" } }).catch(() => undefined);
      throw error;
    }
  };

  const broadcastQueue = connection ? new Queue("broadcast", { connection }) : null;
  const replicationQueue = connection ? new Queue("replication", { connection }) : null;
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

  const routes = createWorkerRoutes({ replicateBatch, runBroadcast, runFollowKeywordNotify });

  const replicationWorker = connection
    ? new Worker(
        "replication",
        routes.replicationRoute,
        { connection, concurrency: 5 }
      )
    : null;

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
  let schedulerRunning = false;
  const startBroadcastScheduler = () => {
    const tick = async () => {
      if (schedulerRunning) {
        return;
      }
      schedulerRunning = true;
      try {
        const now = new Date();
        const due = await prisma.broadcast.findMany({
          where: { status: "SCHEDULED", nextRunAt: { lte: now } },
          orderBy: { nextRunAt: "asc" },
          take: 10
        });
        for (const item of due) {
          const run = await prisma.$transaction(async (tx) => {
            const locked = await tx.broadcast.updateMany({
              where: { id: item.id, status: "SCHEDULED", nextRunAt: { lte: now } },
              data: { status: "RUNNING" }
            });
            if (locked.count === 0) {
              return null;
            }
            return tx.broadcastRun.create({
              data: { broadcastId: item.id, targetCount: 0, successCount: 0, failedCount: 0, blockedCount: 0 }
            });
          });
          if (!run) {
            continue;
          }
          try {
            if (broadcastQueue) {
              await broadcastQueue.add(
                "run",
                { broadcastId: item.id, runId: run.id },
                { jobId: `broadcast:${item.id}:${run.id}`, attempts: 1, removeOnComplete: true, removeOnFail: 100 }
              );
            } else {
              await runBroadcast(item.id, run.id);
            }
          } catch (error) {
            logWorkerError({ op: "broadcast_schedule_dispatch", broadcastId: item.id, runId: run.id }, error);
            await prisma.broadcast
              .update({ where: { id: item.id }, data: { status: "SCHEDULED" } })
              .catch((dbError) =>
                logWorkerError({ op: "broadcast_schedule_rollback", broadcastId: item.id, runId: run.id }, dbError)
              );
            await prisma.broadcastRun
              .update({ where: { id: run.id }, data: { failedCount: 1, finishedAt: new Date() } })
              .catch((dbError) => logWorkerError({ op: "broadcast_run_mark_failed", broadcastId: item.id, runId: run.id }, dbError));
          }
        }
      } finally {
        schedulerRunning = false;
      }
    };
    schedulerTimer = startIntervalScheduler(5000, tick, (error) => logWorkerError({ op: "broadcast_scheduler_tick" }, error));
  };

  startBroadcastScheduler();

  let replicationTimer: NodeJS.Timeout | null = null;
  const replicationEnqueuedAt = new Map<string, number>();
  const replicationEnqueuedTtlMs = parseNumberWithBounds(
    process.env.REPLICATION_ENQUEUED_TTL_MS,
    60 * 60 * 1000,
    60_000,
    24 * 60 * 60 * 1000
  );
  const replicationBackfillEnabled = process.env.REPLICATION_BACKFILL_ENABLED !== "0";
  const replicationBackfillTake = parseNumberWithBounds(process.env.REPLICATION_BACKFILL_TAKE, 5, 0, 50);
  const replicationEnqueuedMaxSize = parseNumberWithBounds(
    process.env.REPLICATION_ENQUEUED_MAX_SIZE,
    20_000,
    1000,
    200_000
  );
  const replicationMetricsLogIntervalMs = parseNumberWithBounds(
    process.env.REPLICATION_METRICS_LOG_INTERVAL_MS,
    60_000,
    5_000,
    3_600_000
  );
  let replicationTtlEvictions = 0;
  let replicationCapEvictions = 0;
  let lastReplicationMetricsLogAt = Date.now();
  const flushReplicationMetrics = (now: number) => {
    if (now - lastReplicationMetricsLogAt < replicationMetricsLogIntervalMs) {
      return;
    }
    const hasChanges = replicationTtlEvictions > 0 || replicationCapEvictions > 0;
    if (hasChanges) {
      console.info(
        JSON.stringify({
          level: "info",
          at: new Date(now).toISOString(),
          component: "worker",
          op: "replication_enqueued_cleanup",
          mapSize: replicationEnqueuedAt.size,
          ttlEvictions: replicationTtlEvictions,
          capEvictions: replicationCapEvictions
        })
      );
      replicationTtlEvictions = 0;
      replicationCapEvictions = 0;
    }
    lastReplicationMetricsLogAt = now;
  };
  const cleanupReplicationEnqueuedAt = (now: number) => {
    for (const [batchId, ts] of replicationEnqueuedAt) {
      if (now - ts > replicationEnqueuedTtlMs) {
        replicationEnqueuedAt.delete(batchId);
        replicationTtlEvictions += 1;
      }
    }
    while (replicationEnqueuedAt.size > replicationEnqueuedMaxSize) {
      const oldest = replicationEnqueuedAt.keys().next();
      if (oldest.done) {
        break;
      }
      replicationEnqueuedAt.delete(oldest.value);
      replicationCapEvictions += 1;
    }
    flushReplicationMetrics(now);
  };
  let backfillOffset = 0;
  const startReplicationScheduler = () => {
    const tick = async () => {
      const now = Date.now();
      cleanupReplicationEnqueuedAt(now);
      await upsertWorkerProcessHeartbeat(prisma, runtimeTenantId, now).catch((error) =>
        logWorkerError({ op: "heartbeat_process_upsert", tenantId: runtimeTenantId }, error)
      );
      const batches = await prisma.uploadBatch.findMany({
        where: { status: "COMMITTED", items: { some: { status: { in: ["PENDING", "FAILED"] } } } },
        take: 10,
        orderBy: { createdAt: "desc" },
        select: { id: true, tenantId: true }
      });
      const replicationHeartbeatTenantIds = new Set<string>();
      for (const batch of batches) {
        const last = replicationEnqueuedAt.get(batch.id) ?? 0;
        if (now - last < 10_000) {
          continue;
        }
        replicationEnqueuedAt.set(batch.id, now);
        if (replicationQueue) {
          const enqueued = await replicationQueue
            .add(
              "replicate",
              { batchId: batch.id },
              { jobId: `replicate:poll:${batch.id}:${now}`, priority: 5, attempts: 1, removeOnComplete: true, removeOnFail: 100 }
            )
            .then(() => true)
            .catch((error) => {
              logWorkerError({ op: "replication_enqueue_poll", tenantId: batch.tenantId, batchId: batch.id }, error);
              return false;
            });
          if (enqueued) {
            replicationHeartbeatTenantIds.add(batch.tenantId);
          }
        } else {
          const replicated = await replicateBatch(batch.id)
            .then(() => true)
            .catch((error) => {
              logWorkerError({ op: "replication_direct_poll", tenantId: batch.tenantId, batchId: batch.id }, error);
              return false;
            });
          if (replicated) {
            replicationHeartbeatTenantIds.add(batch.tenantId);
          }
        }
      }

      if (!replicationBackfillEnabled || replicationBackfillTake <= 0 || batches.length > 0) {
        for (const tenantId of replicationHeartbeatTenantIds) {
          await upsertWorkerReplicationHeartbeat(prisma, tenantId, now).catch((error) =>
            logWorkerError({ op: "heartbeat_replication_upsert", tenantId }, error)
          );
        }
        return;
      }

      const backfill = await prisma.uploadBatch.findMany({
        where: { status: "COMMITTED" },
        orderBy: { createdAt: "desc" },
        take: replicationBackfillTake,
        skip: backfillOffset,
        select: { id: true, tenantId: true }
      });
      backfillOffset += backfill.length;
      if (backfill.length < replicationBackfillTake) {
        backfillOffset = 0;
      }
      for (const batch of backfill) {
        const last = replicationEnqueuedAt.get(batch.id) ?? 0;
        if (now - last < 10_000) {
          continue;
        }
        replicationEnqueuedAt.set(batch.id, now);
        if (replicationQueue) {
          const enqueued = await replicationQueue
            .add(
              "replicate",
              { batchId: batch.id },
              { jobId: `replicate:backfill:${batch.id}:${now}`, priority: 20, attempts: 1, removeOnComplete: true, removeOnFail: 100 }
            )
            .then(() => true)
            .catch((error) => {
              logWorkerError({ op: "replication_enqueue_backfill", tenantId: batch.tenantId, batchId: batch.id }, error);
              return false;
            });
          if (enqueued) {
            replicationHeartbeatTenantIds.add(batch.tenantId);
          }
        } else {
          const replicated = await replicateBatch(batch.id)
            .then(() => true)
            .catch((error) => {
              logWorkerError({ op: "replication_direct_backfill", tenantId: batch.tenantId, batchId: batch.id }, error);
              return false;
            });
          if (replicated) {
            replicationHeartbeatTenantIds.add(batch.tenantId);
          }
        }
      }

      for (const tenantId of replicationHeartbeatTenantIds) {
        await upsertWorkerReplicationHeartbeat(prisma, tenantId, now).catch((error) =>
          logWorkerError({ op: "heartbeat_replication_upsert", tenantId }, error)
        );
      }
    };
    replicationTimer = startIntervalScheduler(15000, tick, (error) => logWorkerError({ op: "replication_scheduler_tick" }, error));
  };

  startReplicationScheduler();

  const shutdown = async () => {
    if (replicationWorker) {
      await replicationWorker.close();
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
    if (broadcastQueue) {
      await broadcastQueue.close();
    }
    if (replicationQueue) {
      await replicationQueue.close();
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
