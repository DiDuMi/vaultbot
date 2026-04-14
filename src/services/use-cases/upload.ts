import { randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import type { PrismaClient } from "@prisma/client";
import { logError } from "../../infra/logging";
import { ensureRuntimeTenant } from "../../infra/persistence/tenant-guard";

export type UploadMessage = {
  messageId: number;
  chatId: number;
  kind: "photo" | "video" | "document" | "audio" | "voice" | "animation";
  mediaGroupId?: string;
  fileId?: string;
};

export type UploadBatch = {
  id: string;
  userId: number;
  chatId: number;
  createdAt: number;
  messages: UploadMessage[];
  status: "pending" | "committed" | "canceled";
};

type UploadStoreKey = string;

const toKey = (userId: number, chatId: number): UploadStoreKey => {
  return `${chatId}:${userId}`;
};

const createId = () => {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

export type UploadService = {
  commitBatch: (
    batch: UploadBatch,
    options?: { collectionId?: string | null }
  ) => Promise<{ batchId: string; assetId: string }>;
  updateAssetMeta: (
    assetId: string,
    input: { title: string; description: string }
  ) => Promise<{ shareCode: string }>;
  updateAssetCollection: (
    assetId: string,
    collectionId: string | null
  ) => Promise<{ collectionId: string | null }>;
};

export type UploadQueue = {
  add: (
    name: string,
    data: { batchId: string },
    options?: {
      jobId?: string;
      priority?: number;
      attempts?: number;
      backoff?: { type: "exponential"; delay: number };
      removeOnComplete?: boolean;
      removeOnFail?: number;
    }
  ) => Promise<unknown>;
};

export type NotifyQueue = {
  add: (
    name: string,
    data: unknown,
    options?: {
      jobId?: string;
      priority?: number;
      attempts?: number;
      backoff?: { type: "exponential"; delay: number };
      removeOnComplete?: boolean;
      removeOnFail?: number;
    }
  ) => Promise<unknown>;
};

export const createInMemoryUploadService = (): UploadService => {
  const commitBatch = async (batch: UploadBatch) => {
    return { batchId: batch.id, assetId: batch.id };
  };
  const updateAssetMeta = async () => {
    return { shareCode: createShareCode() };
  };
  const updateAssetCollection = async (_assetId: string, collectionId: string | null) => {
    return { collectionId };
  };
  return { commitBatch, updateAssetMeta, updateAssetCollection };
};

export const createUploadBatchStore = () => {
  const storeFilePath = resolve(process.cwd(), process.env.UPLOAD_BATCH_STORE_FILE ?? ".runtime/upload-batches.json");
  const pendingTtlMs = (() => {
    const raw = Number(process.env.UPLOAD_BATCH_TTL_MS ?? "43200000");
    if (!Number.isFinite(raw)) {
      return 43200000;
    }
    return Math.max(60000, Math.trunc(raw));
  })();
  const batches = new Map<UploadStoreKey, UploadBatch>();
  const now = () => Date.now();

  const isValidBatch = (value: unknown): value is UploadBatch => {
    if (!value || typeof value !== "object") {
      return false;
    }
    const row = value as Partial<UploadBatch>;
    if (typeof row.id !== "string" || typeof row.userId !== "number" || typeof row.chatId !== "number") {
      return false;
    }
    if (typeof row.createdAt !== "number" || !Array.isArray(row.messages)) {
      return false;
    }
    return row.status === "pending" || row.status === "committed" || row.status === "canceled";
  };

  const persist = () => {
    const values = Array.from(batches.values()).filter((batch) => batch.status === "pending");
    const payload = JSON.stringify(values);
    mkdirSync(dirname(storeFilePath), { recursive: true });
    writeFileSync(storeFilePath, payload, "utf8");
  };

  const pruneExpired = () => {
    const current = now();
    let changed = false;
    for (const [key, batch] of batches) {
      if (current - batch.createdAt > pendingTtlMs) {
        batches.delete(key);
        changed = true;
      }
    }
    if (changed) {
      persist();
    }
  };

  if (existsSync(storeFilePath)) {
    try {
      const raw = readFileSync(storeFilePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        for (const row of parsed) {
          if (isValidBatch(row) && row.status === "pending") {
            batches.set(toKey(row.userId, row.chatId), row);
          }
        }
      }
    } catch {
      batches.clear();
    }
  }
  pruneExpired();

  const getBatch = (userId: number, chatId: number) => {
    pruneExpired();
    return batches.get(toKey(userId, chatId));
  };

  const addMessage = (userId: number, chatId: number, message: UploadMessage) => {
    const key = toKey(userId, chatId);
    const existing = batches.get(key);
    const batch: UploadBatch =
      existing && existing.status === "pending"
        ? existing
        : {
            id: createId(),
            userId,
            chatId,
            createdAt: now(),
            messages: [] as UploadMessage[],
            status: "pending"
          };
    batch.messages.push(message);
    batches.set(key, batch);
    persist();
    return batch;
  };

  const commit = (userId: number, chatId: number) => {
    const key = toKey(userId, chatId);
    const batch = batches.get(key);
    if (!batch || batch.status !== "pending") {
      return undefined;
    }
    batch.status = "committed";
    batches.delete(key);
    persist();
    return batch;
  };

  const cancel = (userId: number, chatId: number) => {
    const key = toKey(userId, chatId);
    const batch = batches.get(key);
    if (!batch || batch.status !== "pending") {
      return undefined;
    }
    batch.status = "canceled";
    batches.delete(key);
    persist();
    return batch;
  };

  return { getBatch, addMessage, commit, cancel };
};

type UploadServiceConfig = {
  tenantCode: string;
  tenantName: string;
  vaultChatId: string;
  vaultThreadId?: number;
};

export const createUploadService = (
  prisma: PrismaClient,
  queue: UploadQueue,
  notifyQueue: NotifyQueue | null,
  config: UploadServiceConfig
): UploadService => {
  const settingKeys = {
    autoCategorizeEnabled: "auto_categorize_enabled",
    autoCategorizeRules: "auto_categorize_rules"
  } as const;

  const getTenantSetting = async (tenantId: string, key: string) => {
    const row = await prisma.tenantSetting.findUnique({
      where: { tenantId_key: { tenantId, key } },
      select: { value: true }
    });
    return row?.value ?? null;
  };

  const parseAutoCategorizeRules = (raw: string | null) => {
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      const rules: { collectionId: string; keywords: string[] }[] = [];
      for (const row of parsed) {
        if (!row || typeof row !== "object") {
          continue;
        }
        const item = row as { collectionId?: unknown; keywords?: unknown };
        if (typeof item.collectionId !== "string" || !item.collectionId.trim()) {
          continue;
        }
        if (!Array.isArray(item.keywords)) {
          continue;
        }
        const keywords = item.keywords
          .filter((k): k is string => typeof k === "string")
          .map((k) => k.trim())
          .filter(Boolean)
          .slice(0, 20);
        if (keywords.length === 0) {
          continue;
        }
        rules.push({ collectionId: item.collectionId.trim(), keywords });
      }
      return rules.slice(0, 50);
    } catch {
      return [];
    }
  };

  const toLower = (value: string) => value.toLowerCase();
  const stripHtml = (value: string) => value.replace(/<[^>]*>/g, " ");
  const normalizeText = (title: string, description: string) => {
    const t = stripHtml(title);
    const d = stripHtml(description);
    return toLower(`${t}\n${d}`.replace(/\s+/g, " ").trim());
  };

  const extractHashtags = (title: string, description: string) => {
    const plain = `${stripHtml(title)}\n${stripHtml(description)}`.replace(/\s+/g, " ").trim();
    if (!plain) {
      return [];
    }
    const names = new Set<string>();
    for (const match of plain.matchAll(/#([\p{L}\p{N}_-]{1,32})/gu)) {
      const raw = (match[1] ?? "").trim();
      if (!raw) {
        continue;
      }
      const normalized = toLower(raw);
      if (Buffer.byteLength(normalized, "utf8") > 60) {
        continue;
      }
      names.add(normalized);
      if (names.size >= 30) {
        break;
      }
    }
    return Array.from(names);
  };

  const syncAssetTags = async (assetId: string, tenantId: string, title: string, description: string) => {
    const tags = extractHashtags(title, description);
    await prisma.$transaction(async (tx) => {
      await tx.assetTag.deleteMany({ where: { assetId } });
      if (tags.length === 0) {
        return;
      }
      const tagIds: string[] = [];
      for (const name of tags) {
        const tag = await tx.tag.upsert({
          where: { tenantId_name: { tenantId, name } },
          create: { tenantId, name },
          update: {}
        });
        tagIds.push(tag.id);
      }
      await tx.assetTag.createMany({
        data: tagIds.map((tagId) => ({ tenantId, assetId, tagId })),
        skipDuplicates: true
      });
    });
  };

  const selectCollectionIdByText = (
    title: string,
    text: string,
    collections: { id: string; title: string }[],
    rules: { collectionId: string; keywords: string[] }[]
  ) => {
    const tags = Array.from(title.matchAll(/[\[【]([^\]】]{1,32})[\]】]/g))
      .map((m) => (m[1] ?? "").trim())
      .filter(Boolean)
      .slice(0, 5);
    if (tags.length > 0) {
      const titleToId = new Map(collections.map((c) => [toLower(c.title.trim()), c.id]));
      for (const tag of tags) {
        const hit = titleToId.get(toLower(tag));
        if (hit) {
          return hit;
        }
      }
    }

    const titleById = new Map(collections.map((c) => [c.id, c.title]));
    const enabledRules = rules.filter((r) => titleById.has(r.collectionId));
    if (enabledRules.length > 0) {
      let bestCollectionId: string | null = null;
      let bestScore = 0;
      let bestOrder = Number.POSITIVE_INFINITY;
      for (let order = 0; order < enabledRules.length; order += 1) {
        const r = enabledRules[order];
        const hits = r.keywords.reduce((acc, kw) => (kw && text.includes(toLower(kw)) ? acc + 1 : acc), 0);
        if (hits <= 0) {
          continue;
        }
        if (bestCollectionId === null || hits > bestScore || (hits === bestScore && order < bestOrder)) {
          bestCollectionId = r.collectionId;
          bestScore = hits;
          bestOrder = order;
        }
      }
      return bestCollectionId;
    }

    const titles = collections
      .map((c) => ({ id: c.id, t: c.title.trim() }))
      .filter((c) => c.t.length >= 2)
      .sort((a, b) => b.t.length - a.t.length);
    for (const c of titles) {
      if (text.includes(toLower(c.t))) {
        return c.id;
      }
    }
    return null;
  };

  const createUniqueShareCode = async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const shareCode = createShareCode();
      const existing = await prisma.asset.findUnique({ where: { shareCode } });
      if (!existing) {
        return shareCode;
      }
    }
    throw new Error("share code unavailable");
  };

  const isShareCodeConflict = (error: unknown) => {
    const withCode = error as { code?: string; meta?: { target?: unknown } };
    if (withCode?.code !== "P2002") {
      return false;
    }
    const target = withCode?.meta?.target;
    if (Array.isArray(target)) {
      return target.includes("shareCode");
    }
    return String(target ?? "").includes("shareCode");
  };

  const ensureTenantAndVault = async () => {
    return prisma.$transaction(async (tx) => {
      const tenant = await ensureRuntimeTenant(tx as PrismaClient, {
        tenantCode: config.tenantCode,
        tenantName: config.tenantName
      });

      const existingPrimary = await tx.tenantVaultBinding.findFirst({
        where: { tenantId: tenant.id, role: "PRIMARY" },
        select: { vaultGroupId: true }
      });
      let primaryVaultGroupId = existingPrimary?.vaultGroupId ?? null;
      if (!primaryVaultGroupId) {
        const vaultGroup = await tx.vaultGroup.upsert({
          where: {
            tenantId_chatId: {
              tenantId: tenant.id,
              chatId: BigInt(config.vaultChatId)
            }
          },
          update: {},
          create: {
            tenantId: tenant.id,
            chatId: BigInt(config.vaultChatId)
          }
        });
        await tx.tenantVaultBinding.upsert({
          where: {
            tenantId_vaultGroupId_role: {
              tenantId: tenant.id,
              vaultGroupId: vaultGroup.id,
              role: "PRIMARY"
            }
          },
          update: {},
          create: {
            tenantId: tenant.id,
            vaultGroupId: vaultGroup.id,
            role: "PRIMARY"
          }
        });
        primaryVaultGroupId = vaultGroup.id;
      }

      if (config.vaultThreadId !== undefined) {
        await tx.tenantTopic.upsert({
          where: {
            tenantId_vaultGroupId_collectionId_version: {
              tenantId: tenant.id,
              vaultGroupId: primaryVaultGroupId,
              collectionId: "none",
              version: 1
            }
          },
          update: {
            messageThreadId: BigInt(config.vaultThreadId)
          },
          create: {
            tenantId: tenant.id,
            vaultGroupId: primaryVaultGroupId,
            collectionId: "none",
            messageThreadId: BigInt(config.vaultThreadId),
            version: 1
          }
        });
      }

      return { tenantId: tenant.id, vaultGroupId: primaryVaultGroupId };
    });
  };

  let cachedTenantAndVault: Promise<{ tenantId: string; vaultGroupId: string }> | null = null;
  const getTenantAndVault = async () => {
    if (!cachedTenantAndVault) {
      cachedTenantAndVault = ensureTenantAndVault().catch((error) => {
        cachedTenantAndVault = null;
        throw error;
      });
    }
    return cachedTenantAndVault;
  };

  const commitBatch = async (batch: UploadBatch, options?: { collectionId?: string | null }) => {
    const { tenantId } = await getTenantAndVault();
    const requestedCollectionId = options?.collectionId ?? undefined;
    const collectionId =
      requestedCollectionId === undefined
        ? undefined
        : requestedCollectionId === null
          ? null
          : (await prisma.collection.findFirst({
              where: { id: requestedCollectionId, tenantId },
              select: { id: true }
            }))
              ? requestedCollectionId
              : null;
    const created = await prisma.$transaction(async (tx) => {
      const asset = await tx.asset.create({
        data: {
          tenantId,
          collectionId,
          title: `Upload ${batch.id}`,
          description: `Batch ${batch.id}`
        }
      });

      const saved = await tx.uploadBatch.create({
        data: {
          tenantId,
          assetId: asset.id,
          userId: String(batch.userId),
          chatId: String(batch.chatId),
          status: "COMMITTED",
          items: {
            create: batch.messages.map((message) => ({
              messageId: String(message.messageId),
              chatId: String(message.chatId),
              kind: message.kind,
              mediaGroupId: message.mediaGroupId,
              fileId: message.fileId
            }))
          }
        }
      });

      return { assetId: asset.id, batchId: saved.id };
    });

    if (requestedCollectionId === undefined) {
      const asset = await prisma.asset
        .findUnique({
          where: { id: created.assetId },
          select: { tenantId: true, collectionId: true, title: true, description: true }
        })
        .catch(() => null);
      if (asset && asset.collectionId === null) {
        const enabledRaw = await getTenantSetting(asset.tenantId, settingKeys.autoCategorizeEnabled).catch(() => null);
        const enabledValue = enabledRaw?.trim().toLowerCase();
        const enabled =
          enabledValue === "1" || enabledValue === "true" || enabledValue === "yes" || enabledValue === "on";
        if (enabled) {
          const [rulesRaw, collections] = await Promise.all([
            getTenantSetting(asset.tenantId, settingKeys.autoCategorizeRules).catch(() => null),
            prisma.collection.findMany({ where: { tenantId: asset.tenantId }, select: { id: true, title: true } }).catch(() => [])
          ]);
          const rules = parseAutoCategorizeRules(rulesRaw);
          const title = asset.title ?? "";
          const description = asset.description ?? "";
          const plainTitle = stripHtml(title);
          const text = normalizeText(title, description);
          const picked = selectCollectionIdByText(plainTitle, text, collections, rules);
          if (picked) {
            await prisma.asset
              .update({ where: { id: created.assetId }, data: { collectionId: picked } })
              .catch((error) =>
                logError({ component: "upload_service", op: "auto_categorize_set_collection", assetId: created.assetId }, error)
              );
          }
        }
      }
    }

    try {
      await queue.add(
        "replicate_required",
        {
          batchId: created.batchId
        },
        {
          jobId: `replicate:${created.batchId}`,
          attempts: 5,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: true,
          removeOnFail: 100
        }
      );
    } catch (error) {
      await prisma
        .$transaction(async (tx) => {
          await tx.uploadBatch
            .delete({ where: { id: created.batchId } })
            .catch((dbError) =>
              logError({ component: "upload_service", op: "rollback_delete_upload_batch", batchId: created.batchId }, dbError)
            );
          await tx.asset
            .delete({ where: { id: created.assetId } })
            .catch((dbError) =>
              logError({ component: "upload_service", op: "rollback_delete_asset", assetId: created.assetId }, dbError)
            );
        })
        .catch((rollbackError) =>
          logError(
            { component: "upload_service", op: "rollback_commit_batch", batchId: created.batchId, assetId: created.assetId },
            rollbackError
          )
        );
      throw error;
    }

    return { batchId: created.batchId, assetId: created.assetId };
  };

  const updateAssetMeta = async (
    assetId: string,
    input: { title: string; description: string }
  ) => {
    const asset = await prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new Error("asset not found");
    }
    const isFirstPublish = !asset.shareCode;
    let shareCode = asset.shareCode ?? null;
    if (shareCode) {
      await prisma.asset.update({
        where: { id: assetId },
        data: {
          title: input.title,
          description: input.description,
          shareCode
        }
      });
    } else {
      let updated = false;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const candidate = await createUniqueShareCode();
        try {
          await prisma.asset.update({
            where: { id: assetId },
            data: {
              title: input.title,
              description: input.description,
              shareCode: candidate
            }
          });
          shareCode = candidate;
          updated = true;
          break;
        } catch (error) {
          if (!isShareCodeConflict(error)) {
            throw error;
          }
        }
      }
      if (!updated || !shareCode) {
        throw new Error("share code unavailable");
      }
    }
    await syncAssetTags(assetId, asset.tenantId, input.title, input.description).catch((error) =>
      logError({ component: "upload_service", op: "sync_asset_tags", assetId, tenantId: asset.tenantId }, error)
    );
    const enabledRaw = await getTenantSetting(asset.tenantId, settingKeys.autoCategorizeEnabled).catch(() => null);
    const enabledValue = enabledRaw?.trim().toLowerCase();
    const enabled = enabledValue === "1" || enabledValue === "true" || enabledValue === "yes" || enabledValue === "on";
    if (enabled && asset.collectionId === null) {
      const [rulesRaw, collections] = await Promise.all([
        getTenantSetting(asset.tenantId, settingKeys.autoCategorizeRules).catch(() => null),
        prisma.collection.findMany({ where: { tenantId: asset.tenantId }, select: { id: true, title: true } }).catch(() => [])
      ]);
      const rules = parseAutoCategorizeRules(rulesRaw);
      const plainTitle = stripHtml(input.title);
      const text = normalizeText(input.title, input.description);
      const picked = selectCollectionIdByText(plainTitle, text, collections, rules);
      if (picked) {
        await prisma.asset
          .update({ where: { id: assetId }, data: { collectionId: picked } })
          .catch((error) =>
            logError({ component: "upload_service", op: "auto_categorize_set_collection", assetId, tenantId: asset.tenantId }, error)
          );
      }
    }
    if (isFirstPublish && notifyQueue) {
      await notifyQueue
        .add(
          "follow_keyword",
          { assetId },
          {
            jobId: `notify:follow_keyword:${assetId}`,
            attempts: 3,
            backoff: { type: "exponential", delay: 1000 },
            removeOnComplete: true,
            removeOnFail: 100
          }
        )
        .catch((error) => logError({ component: "upload_service", op: "notify_enqueue_follow_keyword", assetId, tenantId: asset.tenantId }, error));
    }
    return { shareCode };
  };

  const updateAssetCollection = async (assetId: string, collectionId: string | null) => {
    const { tenantId } = await getTenantAndVault();
    const asset = await prisma.asset.findFirst({ where: { id: assetId, tenantId } });
    if (!asset) {
      throw new Error("asset not found");
    }
    if (collectionId === null) {
      await prisma.asset.update({ where: { id: assetId }, data: { collectionId: null } });
      return { collectionId: null };
    }
    const exists = await prisma.collection.findFirst({
      where: { id: collectionId, tenantId },
      select: { id: true }
    });
    const nextId = exists ? collectionId : null;
    await prisma.asset.update({ where: { id: assetId }, data: { collectionId: nextId } });
    return { collectionId: nextId };
  };

  return { commitBatch, updateAssetMeta, updateAssetCollection };
};

const createShareCode = () => {
  return randomBytes(6).toString("base64url");
};
