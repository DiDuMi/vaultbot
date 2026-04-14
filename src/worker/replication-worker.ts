import type { PrismaClient } from "@prisma/client";
import type { Bot } from "grammy";
import { copyToVault, withTelegramRetry } from "../infra/telegram";
import { logWorkerError } from "./strategy";

export const createReplicateBatch = (deps: {
  bot: Bot;
  prisma: PrismaClient;
  config: { vaultChatId: string; vaultThreadId?: number };
  sendMediaGroupWithRetry: (
    bot: Bot,
    chatId: string,
    album: { type: "photo" | "video"; media: string }[],
    threadId?: number
  ) => Promise<Array<{ message_id: number }>>;
}) => {
  const isSingleOwnerModeEnabled = () => {
    const raw = (process.env.SINGLE_OWNER_MODE || "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
  };
  return async (batchId: string, options?: { includeOptional?: boolean }) => {
    const includeOptional = isSingleOwnerModeEnabled() ? false : options?.includeOptional !== false;
    const batch = await deps.prisma.uploadBatch.findUnique({
      where: { id: batchId },
      include: { items: { orderBy: { createdAt: "asc" } } }
    });
    if (!batch) {
      return;
    }

    const asset = await deps.prisma.asset.findUnique({
      where: { id: batch.assetId },
      select: { collectionId: true, collection: { select: { title: true } } }
    });
    const rawCollectionId = asset?.collectionId ?? null;
    const collectionId = rawCollectionId ?? "none";
    const collectionTitle = asset?.collection?.title ?? (rawCollectionId ? "鍒嗙被" : "鏈垎绫?");

    const bindings = await deps.prisma.tenantVaultBinding.findMany({
      where: { tenantId: batch.tenantId, role: { in: ["PRIMARY", "BACKUP"] } },
      include: { vaultGroup: true },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }]
    });
    if (bindings.length === 0) {
      const configuredChatId = BigInt(deps.config.vaultChatId);
      const createdGroup = await deps.prisma.vaultGroup.upsert({
        where: { tenantId_chatId: { tenantId: batch.tenantId, chatId: configuredChatId } },
        update: {},
        create: { tenantId: batch.tenantId, chatId: configuredChatId }
      });
      await deps.prisma.tenantVaultBinding.upsert({
        where: { tenantId_vaultGroupId_role: { tenantId: batch.tenantId, vaultGroupId: createdGroup.id, role: "PRIMARY" } },
        update: {},
        create: { tenantId: batch.tenantId, vaultGroupId: createdGroup.id, role: "PRIMARY" }
      });
      const createdBinding = await deps.prisma.tenantVaultBinding.findUnique({
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
    const uniqueBindings = Array.from(dedup.values()).sort(
      (a, b) => roleRank(a.role as "PRIMARY" | "BACKUP") - roleRank(b.role as "PRIMARY" | "BACKUP")
    );
    const nonBanned = uniqueBindings.filter((b) => b.vaultGroup.status !== "BANNED");
    const required = nonBanned.find((b) => b.role === "PRIMARY") ?? nonBanned[0] ?? uniqueBindings[0];
    const optional = nonBanned.filter((b) => b.vaultGroupId !== required.vaultGroupId);
    const targets = includeOptional
      ? [{ binding: required, required: true }, ...optional.map((b) => ({ binding: b, required: false }))]
      : [{ binding: required, required: true }];

    const rawMinReplicas = await deps.prisma.tenantSetting
      .findUnique({
        where: { tenantId_key: { tenantId: batch.tenantId, key: "min_replicas" } },
        select: { value: true }
      })
      .then((row) => row?.value ?? null)
      .catch(() => null);
    const parsedMin = rawMinReplicas ? Number(rawMinReplicas) : 1;
    const minReplicas = isSingleOwnerModeEnabled()
      ? 1
      : !Number.isFinite(parsedMin)
        ? 1
        : Math.min(3, Math.max(1, Math.trunc(parsedMin)));

    if (targets.length < minReplicas) {
      const message = `鍙敤瀛樺偍缇や笉瓒筹細褰撳墠 ${targets.length} 涓紝瑕佹眰鏈€灏?${minReplicas} 涓€俙`;
      await deps.prisma.uploadItem.updateMany({
        where: { batchId: batch.id, status: { in: ["PENDING", "FAILED"] } },
        data: { status: "FAILED", lastError: message }
      });
      return;
    }

    const existing = await deps.prisma.assetReplica.findMany({
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
        const topic = await deps.prisma.tenantTopic.findFirst({
          where: { tenantId: batch.tenantId, vaultGroupId, collectionId, version: 1 }
        });
        const existingThreadId = topic?.messageThreadId ? Number(topic.messageThreadId) : null;
        if (existingThreadId) {
          return existingThreadId;
        }
        const normalized = String(collectionTitle || "鏈垎绫?")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 64);
        const created = await withTelegramRetry(() =>
          deps.bot.api.createForumTopic(vaultChatId, normalized || "鏈垎绫?")
        ).catch(() => null);
        const createdThreadId = created?.message_thread_id;
        if (typeof createdThreadId === "number") {
          await deps.prisma.tenantTopic
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
      if (deps.config.vaultThreadId !== undefined) {
        await deps.prisma.tenantTopic.upsert({
          where: {
            tenantId_vaultGroupId_collectionId_version: {
              tenantId: batch.tenantId,
              vaultGroupId,
              collectionId: "none",
              version: 1
            }
          },
          update: { messageThreadId: BigInt(deps.config.vaultThreadId) },
          create: {
            tenantId: batch.tenantId,
            vaultGroupId,
            collectionId: "none",
            messageThreadId: BigInt(deps.config.vaultThreadId),
            version: 1
          }
        });
        return deps.config.vaultThreadId;
      }
      return undefined;
    };

    let hasFailure = false;

    for (const target of targets) {
      const vaultGroup = target.binding.vaultGroup;
      const vaultChatId = vaultGroup.chatId.toString();
      const chat = await deps.bot.api.getChat(vaultChatId).catch(() => null);
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
            const copiedMessages = await deps.sendMediaGroupWithRetry(deps.bot, vaultChatId, album, threadId);
            await deps.prisma.$transaction(async (tx) => {
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
                  deps.prisma.uploadItem.update({ where: { id: groupItem.id }, data: { status: "FAILED", lastError: message } })
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
          const copied = await copyToVault(deps.bot, {
            fromChatId: item.chatId,
            messageId: Number(item.messageId),
            toChatId: vaultChatId,
            threadId
          });

          await deps.prisma.$transaction(async (tx) => {
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
            await deps.prisma.uploadItem.update({ where: { id: item.id }, data: { status: "FAILED", lastError: message } });
          }
        }
        index += 1;
      }
    }

    const counts = await deps.prisma.assetReplica
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
          await deps.prisma.uploadItem
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
        await deps.prisma.uploadItem
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
        await deps.prisma.uploadItem
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
};
