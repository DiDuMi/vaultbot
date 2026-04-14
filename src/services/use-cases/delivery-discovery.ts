import type { PrismaClient } from "@prisma/client";
import { normalizeLimit, normalizePage, normalizePageSize } from "./delivery-strategy";
import { logError } from "../../infra/logging";

export const createDeliveryDiscovery = (deps: {
  prisma: PrismaClient;
  getTenantId: () => Promise<string>;
  isTenantUserSafe: (userId: string) => Promise<boolean>;
  startOfLocalDay: (date: Date) => Date;
}) => {
  const recycledVisibilityKey = (assetId: string) => `recycled_visibility:${assetId}`;
  const stripHtml = (value: string) => value.replace(/<[^>]*>/g, " ");
  const normalizeTagName = (raw: string) => {
    const withoutHash = raw.trim().replace(/^#+/, "");
    if (!withoutHash) {
      return null;
    }
    const normalized = withoutHash.toLowerCase().slice(0, 32);
    if (!normalized) {
      return null;
    }
    if (Buffer.byteLength(normalized, "utf8") > 60) {
      return null;
    }
    return normalized;
  };

  const extractHashtags = (title: string, description: string | null) => {
    const plain = `${stripHtml(title)}\n${stripHtml(description ?? "")}`.replace(/\s+/g, " ").trim();
    if (!plain) {
      return [];
    }
    const names = new Set<string>();
    for (const match of plain.matchAll(/#([\p{L}\p{N}_-]{1,32})/gu)) {
      const normalized = normalizeTagName(match[1] ?? "");
      if (!normalized) {
        continue;
      }
      names.add(normalized);
      if (names.size >= 30) {
        break;
      }
    }
    return Array.from(names);
  };

  const backfillTenantTagsIfEmpty = async (tenantId: string) => {
    if (
      typeof deps.prisma.asset?.findMany !== "function" ||
      typeof deps.prisma.$transaction !== "function" ||
      typeof deps.prisma.tag?.upsert !== "function"
    ) {
      return;
    }
    const existingCount =
      typeof deps.prisma.assetTag?.count === "function"
        ? await deps.prisma.assetTag.count({ where: { tenantId } }).catch(() => 0)
        : 0;
    if (existingCount > 0) {
      return;
    }
    const assets = await deps.prisma.asset
      .findMany({
        where: { tenantId },
        select: { id: true, title: true, description: true }
      })
      .catch(() => []);
    if (assets.length === 0) {
      return;
    }
    await deps.prisma.$transaction(async (tx) => {
      for (const asset of assets) {
        const tags = extractHashtags(asset.title, asset.description);
        if (tags.length === 0) {
          continue;
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
          data: tagIds.map((tagId) => ({ tenantId, assetId: asset.id, tagId })),
          skipDuplicates: true
        });
      }
    });
  };

  const searchAssets = async (
    userId: string,
    query: string,
    page: number,
    pageSize: number,
    options?: { collectionId?: string | null }
  ) => {
    const tenantId = await deps.getTenantId();
    const isTenantViewer = await deps.isTenantUserSafe(userId);
    const safeQuery = query.trim().slice(0, 100);
    const safePage = normalizePage(page);
    const safeSize = normalizePageSize(pageSize, { maxSize: 50 });
    const collectionId = options?.collectionId;
    const where =
      collectionId === undefined
        ? {
            tenantId,
            searchable: true,
            ...(isTenantViewer ? {} : { visibility: "PUBLIC" as const }),
            OR: [
              { title: { contains: safeQuery, mode: "insensitive" as const } },
              { description: { contains: safeQuery, mode: "insensitive" as const } }
            ]
          }
        : {
            tenantId,
            searchable: true,
            collectionId,
            ...(isTenantViewer ? {} : { visibility: "PUBLIC" as const }),
            OR: [
              { title: { contains: safeQuery, mode: "insensitive" as const } },
              { description: { contains: safeQuery, mode: "insensitive" as const } }
            ]
          };
    const [total, assets] = await Promise.all([
      deps.prisma.asset.count({ where }),
      deps.prisma.asset.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: safeSize,
        skip: (safePage - 1) * safeSize,
        select: {
          id: true,
          title: true,
          description: true,
          shareCode: true,
          uploadBatches: { orderBy: { createdAt: "desc" }, take: 1, select: { userId: true } }
        }
      })
    ]);
    await deps.prisma.event
      .create({
        data: {
          tenantId,
          userId,
          type: "SEARCH",
          payload: { q: safeQuery, page: safePage }
        }
      })
      .catch((error) =>
        logError({ component: "delivery_discovery", op: "event_create_search", tenantId, userId, page: safePage }, error)
      );
    return {
      total,
      items: assets.map((asset) => ({
        assetId: asset.id,
        shareCode: asset.shareCode ?? null,
        title: asset.title,
        description: asset.description,
        publisherUserId: asset.uploadBatches[0]?.userId ?? null
      }))
    };
  };

  const getTagById = async (tagId: string) => {
    const tenantId = await deps.getTenantId();
    const tag = await deps.prisma.tag.findFirst({ where: { id: tagId, tenantId }, select: { id: true, name: true } });
    return tag ? { tagId: tag.id, name: tag.name } : null;
  };

  const getTagByName = async (name: string) => {
    const tenantId = await deps.getTenantId();
    const normalized = normalizeTagName(name);
    if (!normalized) {
      return null;
    }
    const tag = await deps.prisma.tag.findUnique({
      where: { tenantId_name: { tenantId, name: normalized } },
      select: { id: true, name: true }
    });
    return tag ? { tagId: tag.id, name: tag.name } : null;
  };

  async function listTopTags(
    limit: number,
    options?: { viewerUserId?: string }
  ): Promise<{ tagId: string; name: string; count: number }[]>;
  async function listTopTags(
    page: number,
    pageSize: number,
    options?: { viewerUserId?: string }
  ): Promise<{ total: number; items: { tagId: string; name: string; count: number }[] }>;
  async function listTopTags(limitOrPage: number, pageSizeOrOptions?: number | { viewerUserId?: string }, options?: { viewerUserId?: string }) {
    const tenantId = await deps.getTenantId();
    await backfillTenantTagsIfEmpty(tenantId).catch((error) =>
      logError({ component: "delivery_discovery", op: "backfill_tenant_tags_if_empty", tenantId }, error)
    );
    const pageSize = typeof pageSizeOrOptions === "number" ? pageSizeOrOptions : undefined;
    const finalOptions = (typeof pageSizeOrOptions === "number" ? options : pageSizeOrOptions) ?? {};
    const isTenantViewer = finalOptions.viewerUserId ? await deps.isTenantUserSafe(finalOptions.viewerUserId) : true;
    const assetVisibilityWhere = isTenantViewer ? {} : { visibility: "PUBLIC" as const };
    if (typeof pageSize !== "number") {
      const safeLimit = normalizeLimit(limitOrPage, { defaultLimit: 20, maxLimit: 50 });
      const grouped = await deps.prisma.assetTag.groupBy({
        by: ["tagId"],
        where: { tenantId, asset: { searchable: true, ...assetVisibilityWhere } },
        _count: { tagId: true },
        orderBy: [{ _count: { tagId: "desc" } }, { tagId: "asc" }],
        take: safeLimit
      });
      const tagIds = grouped.map((g) => g.tagId);
      if (tagIds.length === 0) {
        return [];
      }
      const tags = await deps.prisma.tag.findMany({ where: { id: { in: tagIds }, tenantId }, select: { id: true, name: true } });
      const nameById = new Map(tags.map((t) => [t.id, t.name]));
      return grouped
        .map((g) => {
          const name = nameById.get(g.tagId);
          if (!name) {
            return null;
          }
          return { tagId: g.tagId, name, count: g._count.tagId };
        })
        .filter((row): row is { tagId: string; name: string; count: number } => Boolean(row))
        .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.name.localeCompare(b.name)));
    }
    const safePage = normalizePage(limitOrPage);
    const safePageSize = normalizePageSize(pageSize, { defaultSize: 20, maxSize: 50 });
    const where = { tenantId, asset: { searchable: true, ...assetVisibilityWhere } };
    const [total, grouped] = await Promise.all([
      deps.prisma.tag.count({
        where: { tenantId, assets: { some: { asset: { searchable: true, ...assetVisibilityWhere } } } }
      }),
      deps.prisma.assetTag.groupBy({
        by: ["tagId"],
        where,
        _count: { tagId: true },
        orderBy: [{ _count: { tagId: "desc" } }, { tagId: "asc" }],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize
      })
    ]);
    const tagIds = grouped.map((g) => g.tagId);
    if (tagIds.length === 0) {
      return { total, items: [] };
    }
    const tags = await deps.prisma.tag.findMany({ where: { id: { in: tagIds }, tenantId }, select: { id: true, name: true } });
    const nameById = new Map(tags.map((t) => [t.id, t.name]));
    const items = grouped
      .map((g) => {
        const name = nameById.get(g.tagId);
        if (!name) {
          return null;
        }
        return { tagId: g.tagId, name, count: g._count.tagId };
      })
      .filter((row): row is { tagId: string; name: string; count: number } => Boolean(row))
      .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.name.localeCompare(b.name)));
    return { total, items };
  };

  const listAssetsByTagId = async (userId: string, tagId: string, page: number, pageSize: number) => {
    const tenantId = await deps.getTenantId();
    const isTenantViewer = await deps.isTenantUserSafe(userId);
    const safePage = normalizePage(page);
    const safeSize = normalizePageSize(pageSize, { maxSize: 50 });
    const where = {
      tenantId,
      searchable: true,
      ...(isTenantViewer ? {} : { visibility: "PUBLIC" as const }),
      tags: { some: { tagId } }
    };
    const [total, assets] = await Promise.all([
      deps.prisma.asset.count({ where }),
      deps.prisma.asset.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: safeSize,
        skip: (safePage - 1) * safeSize,
        select: {
          id: true,
          title: true,
          description: true,
          shareCode: true,
          uploadBatches: { orderBy: { createdAt: "desc" }, take: 1, select: { userId: true } }
        }
      })
    ]);
    await deps.prisma.event
      .create({
        data: { tenantId, userId, type: "SEARCH", payload: { tagId, page: safePage } }
      })
      .catch((error) =>
        logError({ component: "delivery_discovery", op: "event_create_search_tag", tenantId, userId, tagId, page: safePage }, error)
      );
    return {
      total,
      items: assets.map((asset) => ({
        assetId: asset.id,
        shareCode: asset.shareCode ?? null,
        title: asset.title,
        description: asset.description,
        publisherUserId: asset.uploadBatches[0]?.userId ?? null
      }))
    };
  };

  const getUserAssetMeta = async (userId: string, assetId: string) => {
    const batch = await deps.prisma.uploadBatch.findFirst({
      where: { userId, assetId, status: "COMMITTED" },
      orderBy: { createdAt: "desc" },
      include: { asset: true }
    });
    if (!batch?.asset) {
      return null;
    }
    return {
      assetId: batch.assetId,
      shareCode: batch.asset.shareCode ?? null,
      title: batch.asset.title,
      description: batch.asset.description,
      collectionId: batch.asset.collectionId,
      searchable: batch.asset.searchable,
      visibility: batch.asset.visibility
    };
  };

  const setUserAssetSearchable = async (userId: string, assetId: string, searchable: boolean) => {
    const tenantId = await deps.getTenantId();
    const ownerBatch = await deps.prisma.uploadBatch.findFirst({
      where: { tenantId, userId, assetId, status: "COMMITTED" },
      select: { id: true }
    });
    if (!ownerBatch) {
      return { ok: false, message: "🔒 无权限或内容不存在。" };
    }
    const existing = await deps.prisma.asset.findFirst({ where: { id: assetId, tenantId }, select: { id: true, searchable: true } });
    if (!existing) {
      return { ok: false, message: "⚠️ 内容不存在或已删除。" };
    }
    if (existing.searchable === searchable) {
      return { ok: true, message: searchable ? "✅ 当前已处于显示状态。" : "✅ 当前已处于隐藏状态。" };
    }
    await deps.prisma.asset.update({ where: { id: existing.id }, data: { searchable } });
    return { ok: true, message: searchable ? "✅ 已显示该内容。" : "✅ 已隐藏该内容。" };
  };

  const deleteUserAsset = async (userId: string, assetId: string) => {
    const tenantId = await deps.getTenantId();
    const ownerBatch = await deps.prisma.uploadBatch.findFirst({
      where: { tenantId, userId, assetId, status: "COMMITTED" },
      select: { id: true }
    });
    if (!ownerBatch) {
      return { ok: false, message: "🔒 无权限或内容不存在。" };
    }
    const existing = await deps.prisma.asset.findFirst({ where: { id: assetId, tenantId }, select: { id: true } });
    if (!existing) {
      return { ok: true, message: "✅ 内容不存在或已删除。" };
    }
    await deps.prisma.$transaction(async (tx) => {
      await tx.tenantSetting.deleteMany({ where: { tenantId, key: recycledVisibilityKey(existing.id) } });
      await tx.assetCommentLike.deleteMany({ where: { tenantId, comment: { assetId: existing.id } } });
      await tx.assetComment.deleteMany({ where: { tenantId, assetId: existing.id } });
      await tx.assetLike.deleteMany({ where: { tenantId, assetId: existing.id } });
      await tx.assetTag.deleteMany({ where: { tenantId, assetId: existing.id } });
      await tx.assetReplica.deleteMany({ where: { assetId: existing.id } });
      await tx.uploadItem.deleteMany({ where: { batch: { tenantId, assetId: existing.id } } });
      await tx.uploadBatch.deleteMany({ where: { tenantId, assetId: existing.id } });
      await tx.asset.delete({ where: { id: existing.id } });
    });
    return { ok: true, message: "✅ 已删除该内容。" };
  };

  const recycleUserAsset = async (userId: string, assetId: string) => {
    const tenantId = await deps.getTenantId();
    const ownerBatch = await deps.prisma.uploadBatch.findFirst({
      where: { tenantId, userId, assetId, status: "COMMITTED" },
      select: { id: true }
    });
    if (!ownerBatch) {
      return { ok: false, message: "🔒 无权限或内容不存在。" };
    }
    const existing = await deps.prisma.asset.findFirst({
      where: { id: assetId, tenantId },
      select: { id: true, searchable: true, visibility: true }
    });
    if (!existing) {
      return { ok: true, message: "✅ 内容不存在或已删除。" };
    }
    if (!existing.searchable && existing.visibility === "RESTRICTED") {
      return { ok: true, message: "✅ 当前已在回收状态。" };
    }
    await deps.prisma.$transaction(async (tx) => {
      await tx.tenantSetting.upsert({
        where: { tenantId_key: { tenantId, key: recycledVisibilityKey(existing.id) } },
        update: { value: existing.visibility },
        create: { tenantId, key: recycledVisibilityKey(existing.id), value: existing.visibility }
      });
      await tx.asset.update({ where: { id: existing.id }, data: { searchable: false, visibility: "RESTRICTED" } });
    });
    return { ok: true, message: "✅ 已回收该内容，可在管理模式恢复。" };
  };

  const restoreUserAsset = async (userId: string, assetId: string) => {
    const tenantId = await deps.getTenantId();
    const ownerBatch = await deps.prisma.uploadBatch.findFirst({
      where: { tenantId, userId, assetId, status: "COMMITTED" },
      select: { id: true }
    });
    if (!ownerBatch) {
      return { ok: false, message: "🔒 无权限或内容不存在。" };
    }
    const existing = await deps.prisma.asset.findFirst({
      where: { id: assetId, tenantId },
      select: { id: true, searchable: true, visibility: true }
    });
    if (!existing) {
      return { ok: false, message: "⚠️ 内容不存在或已删除。" };
    }
    if (existing.searchable && existing.visibility !== "RESTRICTED") {
      return { ok: true, message: "✅ 当前已是正常状态。" };
    }
    const previousVisibility = await deps.prisma.tenantSetting
      .findUnique({
        where: { tenantId_key: { tenantId, key: recycledVisibilityKey(existing.id) } },
        select: { value: true }
      })
      .then((row) => row?.value ?? null);
    const restoredVisibility =
      previousVisibility === "PUBLIC" || previousVisibility === "PROTECTED" || previousVisibility === "RESTRICTED"
        ? previousVisibility
        : "PROTECTED";
    await deps.prisma.$transaction(async (tx) => {
      await tx.asset.update({ where: { id: existing.id }, data: { searchable: true, visibility: restoredVisibility } });
      await tx.tenantSetting.deleteMany({ where: { tenantId, key: recycledVisibilityKey(existing.id) } });
    });
    return { ok: true, message: "✅ 已恢复该内容。" };
  };

  const listUserRecycledAssets = async (userId: string, page: number, pageSize: number) => {
    const tenantId = await deps.getTenantId();
    const safePage = normalizePage(page);
    const safeSize = normalizePageSize(pageSize);
    const where = {
      tenantId,
      searchable: false,
      visibility: "RESTRICTED" as const,
      uploadBatches: {
        some: {
          tenantId,
          userId,
          status: "COMMITTED" as const
        }
      }
    };
    const [total, assets] = await Promise.all([
      deps.prisma.asset.count({ where }),
      deps.prisma.asset.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: safeSize,
        skip: (safePage - 1) * safeSize,
        select: {
          id: true,
          title: true,
          description: true,
          shareCode: true,
          updatedAt: true
        }
      })
    ]);
    return {
      total,
      items: assets.map((asset) => ({
        assetId: asset.id,
        title: asset.title,
        description: asset.description,
        shareCode: asset.shareCode ?? null,
        updatedAt: asset.updatedAt
      }))
    };
  };

  const restoreUserAssets = async (userId: string, assetIds: string[]) => {
    const uniqueIds = [...new Set(assetIds.map((id) => id.trim()).filter(Boolean))].slice(0, 50);
    if (uniqueIds.length === 0) {
      return { ok: false, message: "⚠️ 当前页没有可恢复内容。", restored: 0 };
    }
    let restored = 0;
    for (const assetId of uniqueIds) {
      const result = await restoreUserAsset(userId, assetId);
      if (result.ok) {
        restored += 1;
      }
    }
    if (restored === 0) {
      return { ok: false, message: "⚠️ 没有可恢复的内容。", restored };
    }
    return { ok: true, message: `✅ 已恢复 ${restored} 条内容。`, restored };
  };

  const buildBatchListWhere = async (options: {
    userId?: string;
    collectionId?: string | null;
    date?: Date;
    viewerUserId?: string;
  }) => {
    const tenantId = await deps.getTenantId();
    const dayStart = options.date ? deps.startOfLocalDay(options.date) : undefined;
    const dayEnd = dayStart ? new Date(dayStart.getTime() + 24 * 60 * 60 * 1000) : undefined;
    const isTenantViewer = options.viewerUserId ? await deps.isTenantUserSafe(options.viewerUserId) : true;
    const assetWhere = {
      ...(options.collectionId === undefined ? {} : { collectionId: options.collectionId }),
      ...(isTenantViewer ? {} : { visibility: "PUBLIC" as const })
    };
    const where = {
      tenantId,
      status: "COMMITTED" as const,
      ...(options.userId ? { userId: options.userId } : {}),
      ...(Object.keys(assetWhere).length > 0 ? { asset: assetWhere } : {}),
      ...(dayStart && dayEnd ? { createdAt: { gte: dayStart, lt: dayEnd } } : {})
    };
    return where;
  };

  const listUserBatches = async (
    userId: string,
    page: number,
    pageSize: number,
    options?: { collectionId?: string | null; date?: Date }
  ) => {
    const safePage = normalizePage(page);
    const safeSize = normalizePageSize(pageSize);
    const where = await buildBatchListWhere({
      userId,
      collectionId: options?.collectionId,
      date: options?.date,
      viewerUserId: userId
    });
    const [total, batches] = await Promise.all([
      deps.prisma.uploadBatch.count({ where }),
      deps.prisma.uploadBatch.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: safeSize,
        skip: (safePage - 1) * safeSize,
        include: { asset: true, items: { select: { id: true } } }
      })
    ]);
    return {
      total,
      items: batches.map((batch) => ({
        assetId: batch.assetId,
        shareCode: batch.asset?.shareCode ?? null,
        title: batch.asset?.title ?? `Upload ${batch.id}`,
        description: batch.asset?.description ?? null,
        count: batch.items.length,
        publisherUserId: batch.userId
      }))
    };
  };

  const listTenantBatches = async (
    viewerUserId: string,
    page: number,
    pageSize: number,
    options?: { collectionId?: string | null; date?: Date }
  ) => {
    const safePage = normalizePage(page);
    const safeSize = normalizePageSize(pageSize);
    const where = await buildBatchListWhere({
      collectionId: options?.collectionId,
      date: options?.date,
      viewerUserId
    });
    const [total, batches] = await Promise.all([
      deps.prisma.uploadBatch.count({ where }),
      deps.prisma.uploadBatch.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: safeSize,
        skip: (safePage - 1) * safeSize,
        include: { asset: true, items: { select: { id: true } } }
      })
    ]);
    return {
      total,
      items: batches.map((batch) => ({
        assetId: batch.assetId,
        shareCode: batch.asset?.shareCode ?? null,
        title: batch.asset?.title ?? `Upload ${batch.id}`,
        description: batch.asset?.description ?? null,
        count: batch.items.length,
        publisherUserId: batch.userId
      }))
    };
  };

  const listUserOpenHistory = async (userId: string, page: number, pageSize: number, options?: { since?: Date }) => {
    const tenantId = await deps.getTenantId();
    const safePage = normalizePage(page);
    const safeSize = normalizePageSize(pageSize);
    const since = options?.since;
    const where = {
      tenantId,
      userId,
      type: "OPEN" as const,
      assetId: { not: null },
      ...(since ? { createdAt: { gte: since } } : {})
    };
    const [distinctAssets, grouped] = await Promise.all([
      deps.prisma.event.findMany({ where, distinct: ["assetId"], select: { assetId: true } }),
      deps.prisma.event.groupBy({
        by: ["assetId"],
        where,
        _max: { createdAt: true },
        orderBy: { _max: { createdAt: "desc" } },
        take: safeSize,
        skip: (safePage - 1) * safeSize
      })
    ]);
    const total = distinctAssets.length;
    const assetIds = grouped.map((g) => g.assetId).filter((id): id is string => typeof id === "string" && id.length > 0);
    if (assetIds.length === 0) {
      return { total, items: [] };
    }
    const assets = await deps.prisma.asset.findMany({
      where: { id: { in: assetIds } },
      select: {
        id: true,
        title: true,
        description: true,
        shareCode: true,
        uploadBatches: { orderBy: { createdAt: "desc" }, take: 1, select: { userId: true } }
      }
    });
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
    const items = grouped
      .map((g) => {
        const assetId = g.assetId;
        const openedAt = g._max.createdAt;
        if (typeof assetId !== "string" || !openedAt) {
          return null;
        }
        const asset = assetMap.get(assetId);
        return {
          assetId,
          shareCode: asset?.shareCode ?? null,
          title: asset?.title ?? assetId,
          description: asset?.description ?? null,
          openedAt,
          publisherUserId: asset?.uploadBatches[0]?.userId ?? null
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    return { total, items };
  };

  const listUserLikedAssets = async (userId: string, page: number, pageSize: number, options?: { since?: Date }) => {
    const tenantId = await deps.getTenantId();
    const safePage = normalizePage(page);
    const safeSize = normalizePageSize(pageSize);
    const isTenant = await deps.isTenantUserSafe(userId);
    const since = options?.since;
    const where = isTenant ? { tenantId, userId } : { tenantId, userId, asset: { visibility: "PUBLIC" as const } };
    const finalWhere = since ? { ...where, createdAt: { gte: since } } : where;
    const [total, likes] = await Promise.all([
      deps.prisma.assetLike.count({ where: finalWhere }),
      deps.prisma.assetLike.findMany({
        where: finalWhere,
        orderBy: { createdAt: "desc" },
        take: safeSize,
        skip: (safePage - 1) * safeSize,
        select: {
          assetId: true,
          createdAt: true,
          asset: {
            select: {
              title: true,
              description: true,
              shareCode: true,
              uploadBatches: { orderBy: { createdAt: "desc" }, take: 1, select: { userId: true } }
            }
          }
        }
      })
    ]);
    return {
      total,
      items: likes.map((row) => ({
        assetId: row.assetId,
        shareCode: row.asset?.shareCode ?? null,
        title: row.asset?.title ?? row.assetId,
        description: row.asset?.description ?? null,
        likedAt: row.createdAt,
        publisherUserId: row.asset?.uploadBatches[0]?.userId ?? null
      }))
    };
  };

  return {
    searchAssets,
    getTagById,
    getTagByName,
    listTopTags,
    listAssetsByTagId,
    getUserAssetMeta,
    setUserAssetSearchable,
    deleteUserAsset,
    recycleUserAsset,
    restoreUserAsset,
    listUserRecycledAssets,
    restoreUserAssets,
    listUserBatches,
    listTenantBatches,
    listUserOpenHistory,
    listUserLikedAssets
  };
};
