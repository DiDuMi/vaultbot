import type { PrismaClient } from "@prisma/client";
import { normalizeLimit, normalizePage, normalizePageSize } from "./delivery-strategy";
import { logError } from "../../infra/logging";

export const createProjectDiscovery = (deps: {
  prisma: PrismaClient;
  getRuntimeProjectId: () => Promise<string>;
  isProjectMemberSafe: (userId: string) => Promise<boolean>;
  startOfLocalDay: (date: Date) => Date;
}) => {
  const withProjectTenantFallback = async <T>(input: {
    queryByProject: () => Promise<T>;
    queryByTenant: () => Promise<T>;
    shouldFallback: (result: T) => boolean;
  }) => {
    const projectResult = await input.queryByProject();
    if (!input.shouldFallback(projectResult)) {
      return projectResult;
    }
    return input.queryByTenant();
  };

  const buildPublicAssetVisibilityWhere = (isProjectViewer: boolean) =>
    isProjectViewer ? {} : { visibility: { not: "RESTRICTED" as const } };
  const recycledVisibilityKey = (assetId: string) => `recycled_visibility:${assetId}`;
  const stripHtml = (value: string) => value.replace(/<[^>]*>/g, " ");
  const findOwnedCommittedBatch = async (projectId: string, userId: string, assetId: string, extra: Record<string, unknown>) =>
    withProjectTenantFallback({
      queryByProject: () =>
        deps.prisma.uploadBatch.findFirst({
          where: { projectId, userId, assetId, status: "COMMITTED" },
          orderBy: { createdAt: "desc" },
          ...extra
        } as never),
      queryByTenant: () =>
        deps.prisma.uploadBatch.findFirst({
          where: { tenantId: projectId, userId, assetId, status: "COMMITTED" },
          orderBy: { createdAt: "desc" },
          ...extra
        } as never),
      shouldFallback: (current) => current === null
    }) as Promise<any>;
  const findProjectAsset = async <T>(projectId: string, assetId: string, select: T) =>
    withProjectTenantFallback({
      queryByProject: () => deps.prisma.asset.findFirst({ where: { id: assetId, projectId }, select } as never),
      queryByTenant: () => deps.prisma.asset.findFirst({ where: { id: assetId, tenantId: projectId }, select } as never),
      shouldFallback: (current) => current === null
    });
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

  const backfillProjectTagsIfEmpty = async (projectId: string) => {
    if (
      typeof deps.prisma.asset?.findMany !== "function" ||
      typeof deps.prisma.$transaction !== "function" ||
      typeof deps.prisma.tag?.upsert !== "function"
    ) {
      return;
    }
    const existingCount =
      typeof deps.prisma.assetTag?.count === "function"
        ? await deps.prisma.assetTag.count({ where: { tenantId: projectId } }).catch(() => 0)
        : 0;
    if (existingCount > 0) {
      return;
    }
    let assets = await deps.prisma.asset
      .findMany({
        where: { projectId },
        select: { id: true, title: true, description: true }
      })
      .catch(() => []);
    if (assets.length === 0) {
      assets = await deps.prisma.asset
        .findMany({
          where: { tenantId: projectId },
          select: { id: true, title: true, description: true }
        })
        .catch(() => []);
    }
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
            where: { tenantId_name: { tenantId: projectId, name } },
            create: { tenantId: projectId, name },
            update: {}
          });
          tagIds.push(tag.id);
        }
        await tx.assetTag.createMany({
          data: tagIds.map((tagId) => ({ tenantId: projectId, assetId: asset.id, tagId })),
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
    const projectId = await deps.getRuntimeProjectId();
    const isProjectViewer = await deps.isProjectMemberSafe(userId);
    const safeQuery = query.trim().slice(0, 100);
    const safePage = normalizePage(page);
    const safeSize = normalizePageSize(pageSize, { maxSize: 50 });
    const collectionId = options?.collectionId;

    const baseWhere = {
      searchable: true,
      ...buildPublicAssetVisibilityWhere(isProjectViewer),
      OR: [
        { title: { contains: safeQuery, mode: "insensitive" as const } },
        { description: { contains: safeQuery, mode: "insensitive" as const } }
      ]
    };

    const queryAssets = async (where: Record<string, unknown>) => {
      const [total, assets] = await Promise.all([
        deps.prisma.asset.count({ where: where as never }),
        deps.prisma.asset.findMany({
          where: where as never,
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
      return { total, assets };
    };

    const projectWhere =
      collectionId === undefined
        ? { projectId, ...baseWhere }
        : { projectId, collectionId, ...baseWhere };
    const fallbackWhere =
      collectionId === undefined
        ? { tenantId: projectId, ...baseWhere }
        : { tenantId: projectId, collectionId, ...baseWhere };

    const result = await withProjectTenantFallback({
      queryByProject: () => queryAssets(projectWhere),
      queryByTenant: () => queryAssets(fallbackWhere),
      shouldFallback: (current) => current.total === 0
    });
    const { total, assets } = result;
    await deps.prisma.event
      .create({
        data: {
          tenantId: projectId,
          projectId,
          userId,
          type: "SEARCH",
          payload: { q: safeQuery, page: safePage }
        }
      })
      .catch((error) =>
        logError({ component: "delivery_discovery", op: "event_create_search", projectId, userId, page: safePage }, error)
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
    const projectId = await deps.getRuntimeProjectId();
    const directTag = await deps.prisma.tag.findFirst({ where: { id: tagId, tenantId: projectId }, select: { id: true, name: true } });
    if (directTag) {
      return { tagId: directTag.id, name: directTag.name };
    }

    // Safe fallback: only resolve the tag if it's actually referenced by this project.
    const link = await withProjectTenantFallback({
      queryByProject: () =>
        deps.prisma.assetTag
          .findFirst({
            where: { tenantId: projectId, tagId, asset: { projectId } },
            select: { tag: { select: { id: true, name: true } } }
          })
          .catch(() => null),
      queryByTenant: () =>
        deps.prisma.assetTag
          .findFirst({
            where: { tenantId: projectId, tagId, asset: { tenantId: projectId } },
            select: { tag: { select: { id: true, name: true } } }
          })
          .catch(() => null),
      shouldFallback: (current) => current === null
    });

    const tag = link?.tag ?? null;
    return tag ? { tagId: tag.id, name: tag.name } : null;
  };

  const getTagByName = async (name: string) => {
    const projectId = await deps.getRuntimeProjectId();
    const normalized = normalizeTagName(name);
    if (!normalized) {
      return null;
    }
    const directTag = await deps.prisma.tag.findUnique({
      where: { tenantId_name: { tenantId: projectId, name: normalized } },
      select: { id: true, name: true }
    });
    if (directTag) {
      return { tagId: directTag.id, name: directTag.name };
    }

    const link = await withProjectTenantFallback({
      queryByProject: () =>
        deps.prisma.assetTag
          .findFirst({
            where: { tenantId: projectId, tag: { name: normalized }, asset: { projectId } },
            select: { tag: { select: { id: true, name: true } } }
          })
          .catch(() => null),
      queryByTenant: () =>
        deps.prisma.assetTag
          .findFirst({
            where: { tenantId: projectId, tag: { name: normalized }, asset: { tenantId: projectId } },
            select: { tag: { select: { id: true, name: true } } }
          })
          .catch(() => null),
      shouldFallback: (current) => current === null
    });

    const resolved = link?.tag ?? null;
    return resolved ? { tagId: resolved.id, name: resolved.name } : null;
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
    const projectId = await deps.getRuntimeProjectId();
    await backfillProjectTagsIfEmpty(projectId).catch((error) =>
      logError({ component: "delivery_discovery", op: "backfill_project_tags_if_empty", projectId }, error)
    );
    const pageSize = typeof pageSizeOrOptions === "number" ? pageSizeOrOptions : undefined;
    const finalOptions = (typeof pageSizeOrOptions === "number" ? options : pageSizeOrOptions) ?? {};
    const isProjectViewer = finalOptions.viewerUserId ? await deps.isProjectMemberSafe(finalOptions.viewerUserId) : true;
    const assetVisibilityWhere = buildPublicAssetVisibilityWhere(isProjectViewer);
    if (typeof pageSize !== "number") {
      const safeLimit = normalizeLimit(limitOrPage, { defaultLimit: 20, maxLimit: 50 });
      const groupedByProject = await deps.prisma.assetTag.groupBy({
        by: ["tagId"],
        where: { tenantId: projectId, asset: { projectId, searchable: true, ...assetVisibilityWhere } },
        _count: { tagId: true },
        orderBy: [{ _count: { tagId: "desc" } }, { tagId: "asc" }],
        take: safeLimit
      });
      const grouped =
        groupedByProject.length > 0
          ? groupedByProject
          : await deps.prisma.assetTag.groupBy({
              by: ["tagId"],
              where: { tenantId: projectId, asset: { searchable: true, ...assetVisibilityWhere } },
              _count: { tagId: true },
              orderBy: [{ _count: { tagId: "desc" } }, { tagId: "asc" }],
              take: safeLimit
            });
      const tagIds = grouped.map((g) => g.tagId);
      if (tagIds.length === 0) {
        return [];
      }
      const tags = await deps.prisma.tag.findMany({ where: { id: { in: tagIds }, tenantId: projectId }, select: { id: true, name: true } });
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

    const queryTagIndex = async (scopedAssetWhere: Record<string, unknown>) => {
      const [total, grouped] = await Promise.all([
        deps.prisma.tag.count({
          where: { tenantId: projectId, assets: { some: { asset: scopedAssetWhere as never } } } as never
        }),
        deps.prisma.assetTag.groupBy({
          by: ["tagId"],
          where: { tenantId: projectId, asset: scopedAssetWhere as never } as never,
          _count: { tagId: true },
          orderBy: [{ _count: { tagId: "desc" } }, { tagId: "asc" }],
          skip: (safePage - 1) * safePageSize,
          take: safePageSize
        })
      ]);
      return { total, grouped };
    };

    const projectAssetWhere = { projectId, searchable: true, ...assetVisibilityWhere };
    const fallbackAssetWhere = { searchable: true, ...assetVisibilityWhere };

    let index = await queryTagIndex(projectAssetWhere);
    if (index.total === 0) {
      index = await queryTagIndex(fallbackAssetWhere);
    }

    const { total, grouped } = index;
    const tagIds = grouped.map((g) => g.tagId);
    if (tagIds.length === 0) {
      return { total, items: [] };
    }
    const tags = await deps.prisma.tag.findMany({ where: { id: { in: tagIds }, tenantId: projectId }, select: { id: true, name: true } });
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
    const projectId = await deps.getRuntimeProjectId();
    const isProjectViewer = await deps.isProjectMemberSafe(userId);
    const safePage = normalizePage(page);
    const safeSize = normalizePageSize(pageSize, { maxSize: 50 });
    const baseWhere = {
      searchable: true,
      ...buildPublicAssetVisibilityWhere(isProjectViewer),
      tags: { some: { tagId } }
    };

    const queryAssets = async (where: Record<string, unknown>) => {
      const [total, assets] = await Promise.all([
        deps.prisma.asset.count({ where: where as never }),
        deps.prisma.asset.findMany({
          where: where as never,
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
      return { total, assets };
    };

    const projectWhere = { projectId, ...baseWhere };
    const fallbackWhere = { tenantId: projectId, ...baseWhere };

    const result = await withProjectTenantFallback({
      queryByProject: () => queryAssets(projectWhere),
      queryByTenant: () => queryAssets(fallbackWhere),
      shouldFallback: (current) => current.total === 0
    });

    const { total, assets } = result;
    await deps.prisma.event
      .create({
        data: { tenantId: projectId, projectId, userId, type: "SEARCH", payload: { tagId, page: safePage } }
      })
      .catch((error) =>
        logError({ component: "delivery_discovery", op: "event_create_search_tag", projectId, userId, tagId, page: safePage }, error)
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
    const projectId = await deps.getRuntimeProjectId();
    const batch = await findOwnedCommittedBatch(projectId, userId, assetId, { include: { asset: true } });
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
    const projectId = await deps.getRuntimeProjectId();
    const ownerBatch = await findOwnedCommittedBatch(projectId, userId, assetId, { select: { id: true } });
    if (!ownerBatch) {
      return { ok: false, message: "🔒 无权限或内容不存在。" };
    }
    const existing = await findProjectAsset(projectId, assetId, { id: true, searchable: true });
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
    const projectId = await deps.getRuntimeProjectId();
    const ownerBatch = await findOwnedCommittedBatch(projectId, userId, assetId, { select: { id: true } });
    if (!ownerBatch) {
      return { ok: false, message: "🔒 无权限或内容不存在。" };
    }
    const existing = await findProjectAsset(projectId, assetId, { id: true });
    if (!existing) {
      return { ok: true, message: "✅ 内容不存在或已删除。" };
    }
    await deps.prisma.$transaction(async (tx) => {
      await tx.tenantSetting.deleteMany({ where: { projectId, key: recycledVisibilityKey(existing.id) } });
      await tx.tenantSetting.deleteMany({ where: { tenantId: projectId, key: recycledVisibilityKey(existing.id) } });
      await tx.assetCommentLike.deleteMany({ where: { comment: { asset: { projectId, id: existing.id } } } });
      await tx.assetCommentLike.deleteMany({ where: { tenantId: projectId, comment: { assetId: existing.id } } });
      await tx.assetComment.deleteMany({ where: { asset: { projectId, id: existing.id } } });
      await tx.assetComment.deleteMany({ where: { tenantId: projectId, assetId: existing.id } });
      await tx.assetLike.deleteMany({ where: { asset: { projectId, id: existing.id } } });
      await tx.assetLike.deleteMany({ where: { tenantId: projectId, assetId: existing.id } });
      await tx.assetTag.deleteMany({ where: { asset: { projectId, id: existing.id } } });
      await tx.assetTag.deleteMany({ where: { tenantId: projectId, assetId: existing.id } });
      await tx.assetReplica.deleteMany({ where: { assetId: existing.id } });
      await tx.uploadItem.deleteMany({ where: { batch: { projectId, assetId: existing.id } } });
      await tx.uploadItem.deleteMany({ where: { batch: { tenantId: projectId, assetId: existing.id } } });
      await tx.uploadBatch.deleteMany({ where: { projectId, assetId: existing.id } });
      await tx.uploadBatch.deleteMany({ where: { tenantId: projectId, assetId: existing.id } });
      await tx.asset.delete({ where: { id: existing.id } });
    });
    return { ok: true, message: "✅ 已删除该内容。" };
  };

  const recycleUserAsset = async (userId: string, assetId: string) => {
    const projectId = await deps.getRuntimeProjectId();
    const ownerBatch = await findOwnedCommittedBatch(projectId, userId, assetId, { select: { id: true } });
    if (!ownerBatch) {
      return { ok: false, message: "🔒 无权限或内容不存在。" };
    }
    const existing = await findProjectAsset(projectId, assetId, { id: true, searchable: true, visibility: true });
    if (!existing) {
      return { ok: true, message: "✅ 内容不存在或已删除。" };
    }
    if (!existing.searchable && existing.visibility === "RESTRICTED") {
      return { ok: true, message: "✅ 当前已在回收状态。" };
    }
    await deps.prisma.$transaction(async (tx) => {
      await tx.tenantSetting.upsert({
        where: { tenantId_key: { tenantId: projectId, key: recycledVisibilityKey(existing.id) } },
        update: { projectId, value: existing.visibility },
        create: { tenantId: projectId, projectId, key: recycledVisibilityKey(existing.id), value: existing.visibility }
      });
      await tx.asset.update({ where: { id: existing.id }, data: { searchable: false, visibility: "RESTRICTED" } });
    });
    return { ok: true, message: "✅ 已回收该内容，可在管理模式恢复。" };
  };

  const restoreUserAsset = async (userId: string, assetId: string) => {
    const projectId = await deps.getRuntimeProjectId();
    const ownerBatch = await findOwnedCommittedBatch(projectId, userId, assetId, { select: { id: true } });
    if (!ownerBatch) {
      return { ok: false, message: "🔒 无权限或内容不存在。" };
    }
    const existing = await findProjectAsset(projectId, assetId, { id: true, searchable: true, visibility: true });
    if (!existing) {
      return { ok: false, message: "⚠️ 内容不存在或已删除。" };
    }
    if (existing.searchable && existing.visibility !== "RESTRICTED") {
      return { ok: true, message: "✅ 当前已是正常状态。" };
    }
    const previousVisibility =
      (await deps.prisma.tenantSetting
        .findUnique({
          where: { projectId_key: { projectId, key: recycledVisibilityKey(existing.id) } },
          select: { value: true }
        })
        .then((row) => row?.value ?? null)) ??
      (await deps.prisma.tenantSetting
        .findUnique({
          where: { tenantId_key: { tenantId: projectId, key: recycledVisibilityKey(existing.id) } },
          select: { value: true }
        })
        .then((row) => row?.value ?? null));
    const restoredVisibility =
      previousVisibility === "PUBLIC" || previousVisibility === "PROTECTED" || previousVisibility === "RESTRICTED"
        ? previousVisibility
        : "PROTECTED";
    await deps.prisma.$transaction(async (tx) => {
      await tx.asset.update({ where: { id: existing.id }, data: { searchable: true, visibility: restoredVisibility } });
      await tx.tenantSetting.deleteMany({ where: { projectId, key: recycledVisibilityKey(existing.id) } });
      await tx.tenantSetting.deleteMany({ where: { tenantId: projectId, key: recycledVisibilityKey(existing.id) } });
    });
    return { ok: true, message: "✅ 已恢复该内容。" };
  };

  const listUserRecycledAssets = async (userId: string, page: number, pageSize: number) => {
    const projectId = await deps.getRuntimeProjectId();
    const safePage = normalizePage(page);
    const safeSize = normalizePageSize(pageSize);
    const projectWhere = {
      projectId,
      searchable: false,
      visibility: "RESTRICTED" as const,
      uploadBatches: {
        some: {
          projectId,
          userId,
          status: "COMMITTED" as const
        }
      }
    };
    const [projectTotal, projectAssets] = await Promise.all([
      deps.prisma.asset.count({ where: projectWhere }),
      deps.prisma.asset.findMany({
        where: projectWhere,
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
    const [total, assets] = await withProjectTenantFallback({
      queryByProject: async () => [projectTotal, projectAssets] as const,
      queryByTenant: async () => {
        const fallbackWhere = {
          tenantId: projectId,
          searchable: false,
          visibility: "RESTRICTED" as const,
          uploadBatches: {
            some: {
              tenantId: projectId,
              userId,
              status: "COMMITTED" as const
            }
          }
        };
        return Promise.all([
          deps.prisma.asset.count({ where: fallbackWhere }),
          deps.prisma.asset.findMany({
            where: fallbackWhere,
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
        ]) as Promise<readonly [number, typeof projectAssets]>;
      },
      shouldFallback: ([projectTotalValue, projectAssetRows]) => projectTotalValue === 0 && projectAssetRows.length === 0
    });
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
    projectScopeKey?: "tenantId" | "projectId";
  }) => {
    const projectId = await deps.getRuntimeProjectId();
    const projectScopeKey = options.projectScopeKey ?? "tenantId";
    const dayStart = options.date ? deps.startOfLocalDay(options.date) : undefined;
    const dayEnd = dayStart ? new Date(dayStart.getTime() + 24 * 60 * 60 * 1000) : undefined;
    const isProjectViewer = options.viewerUserId ? await deps.isProjectMemberSafe(options.viewerUserId) : true;
    const assetWhere = {
      ...(options.collectionId === undefined ? {} : { collectionId: options.collectionId }),
      ...buildPublicAssetVisibilityWhere(isProjectViewer)
    };
    const scopedAssetWhere =
      Object.keys(assetWhere).length > 0 ? { ...assetWhere, [projectScopeKey]: projectId } : assetWhere;
    const where = {
      [projectScopeKey]: projectId,
      status: "COMMITTED" as const,
      ...(options.userId ? { userId: options.userId } : {}),
      ...(Object.keys(scopedAssetWhere).length > 0 ? { asset: scopedAssetWhere } : {}),
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
    const projectWhere = await buildBatchListWhere({
      userId,
      collectionId: options?.collectionId,
      date: options?.date,
      viewerUserId: userId,
      projectScopeKey: "projectId"
    });
    const [projectTotal, projectBatches] = await Promise.all([
      deps.prisma.uploadBatch.count({ where: projectWhere }),
      deps.prisma.uploadBatch.findMany({
        where: projectWhere,
        orderBy: { createdAt: "desc" },
        take: safeSize,
        skip: (safePage - 1) * safeSize,
        include: { asset: true, items: { select: { id: true } } }
      })
    ]);
    const [total, batches] = await withProjectTenantFallback({
      queryByProject: async () => [projectTotal, projectBatches] as const,
      queryByTenant: async () => {
        const fallbackWhere = await buildBatchListWhere({
          userId,
          collectionId: options?.collectionId,
          date: options?.date,
          viewerUserId: userId,
          projectScopeKey: "tenantId"
        });
        return Promise.all([
          deps.prisma.uploadBatch.count({ where: fallbackWhere }),
          deps.prisma.uploadBatch.findMany({
            where: fallbackWhere,
            orderBy: { createdAt: "desc" },
            take: safeSize,
            skip: (safePage - 1) * safeSize,
            include: { asset: true, items: { select: { id: true } } }
          })
        ]) as Promise<readonly [number, typeof projectBatches]>;
      },
      shouldFallback: ([projectTotalValue, projectBatchRows]) => projectTotalValue === 0 && projectBatchRows.length === 0
    });
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

  const listProjectBatches = async (
    viewerUserId: string,
    page: number,
    pageSize: number,
    options?: { collectionId?: string | null; date?: Date }
  ) => {
    const safePage = normalizePage(page);
    const safeSize = normalizePageSize(pageSize);
    const projectWhere = await buildBatchListWhere({
      collectionId: options?.collectionId,
      date: options?.date,
      viewerUserId,
      projectScopeKey: "projectId"
    });
    const [projectTotal, projectBatches] = await Promise.all([
      deps.prisma.uploadBatch.count({ where: projectWhere }),
      deps.prisma.uploadBatch.findMany({
        where: projectWhere,
        orderBy: { createdAt: "desc" },
        take: safeSize,
        skip: (safePage - 1) * safeSize,
        include: { asset: true, items: { select: { id: true } } }
      })
    ]);
    const [total, batches] = await withProjectTenantFallback({
      queryByProject: async () => [projectTotal, projectBatches] as const,
      queryByTenant: async () => {
        const fallbackWhere = await buildBatchListWhere({
          collectionId: options?.collectionId,
          date: options?.date,
          viewerUserId,
          projectScopeKey: "tenantId"
        });
        return Promise.all([
          deps.prisma.uploadBatch.count({ where: fallbackWhere }),
          deps.prisma.uploadBatch.findMany({
            where: fallbackWhere,
            orderBy: { createdAt: "desc" },
            take: safeSize,
            skip: (safePage - 1) * safeSize,
            include: { asset: true, items: { select: { id: true } } }
          })
        ]) as Promise<readonly [number, typeof projectBatches]>;
      },
      shouldFallback: ([projectTotalValue, projectBatchRows]) => projectTotalValue === 0 && projectBatchRows.length === 0
    });
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
    const projectId = await deps.getRuntimeProjectId();
    const safePage = normalizePage(page);
    const safeSize = normalizePageSize(pageSize);
    const since = options?.since;

    const buildWhere = (projectScopeKey: "projectId" | "tenantId") => ({
      [projectScopeKey]: projectId,
      userId,
      type: "OPEN" as const,
      assetId: { not: null },
      ...(since ? { createdAt: { gte: since } } : {})
    });

    const queryHistory = async (where: Record<string, unknown>) => {
      const [distinctAssets, grouped] = await Promise.all([
        deps.prisma.event.findMany({ where: where as never, distinct: ["assetId"], select: { assetId: true } }),
        deps.prisma.event.groupBy({
          by: ["assetId"],
          where: where as never,
          _max: { createdAt: true },
          orderBy: { _max: { createdAt: "desc" } },
          take: safeSize,
          skip: (safePage - 1) * safeSize
        })
      ]);
      return { total: distinctAssets.length, grouped };
    };

    const projectWhere = buildWhere("projectId");
    const fallbackWhere = buildWhere("tenantId");

    const result = await withProjectTenantFallback({
      queryByProject: () => queryHistory(projectWhere),
      queryByTenant: () => queryHistory(fallbackWhere),
      shouldFallback: (current) => current.total === 0
    });

    const { total, grouped } = result;
    const assetIds = grouped.map((g) => g.assetId).filter((id): id is string => typeof id === "string" && id.length > 0);
    if (assetIds.length === 0) {
      return { total, items: [] };
    }
    const finalAssets = await withProjectTenantFallback({
      queryByProject: () =>
        deps.prisma.asset
          .findMany({
            where: { id: { in: assetIds }, projectId },
            select: {
              id: true,
              title: true,
              description: true,
              shareCode: true,
              uploadBatches: { orderBy: { createdAt: "desc" }, take: 1, select: { userId: true } }
            }
          })
          .catch(() => []),
      queryByTenant: () =>
        deps.prisma.asset.findMany({
          where: { id: { in: assetIds }, tenantId: projectId },
          select: {
            id: true,
            title: true,
            description: true,
            shareCode: true,
            uploadBatches: { orderBy: { createdAt: "desc" }, take: 1, select: { userId: true } }
          }
        }),
      shouldFallback: (current) => current.length === 0
    });
    const assetMap = new Map(finalAssets.map((asset) => [asset.id, asset]));
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
    const projectId = await deps.getRuntimeProjectId();
    const safePage = normalizePage(page);
    const safeSize = normalizePageSize(pageSize);
    const isProjectMember = await deps.isProjectMemberSafe(userId);
    const since = options?.since;
    const visibilityWhere = buildPublicAssetVisibilityWhere(!isProjectMember ? false : true);

    const buildLikeWhere = (projectScopeKey: "projectId" | "tenantId") => {
      const base = {
        tenantId: projectId,
        userId,
        asset: { ...visibilityWhere, [projectScopeKey]: projectId }
      };
      return since ? { ...base, createdAt: { gte: since } } : base;
    };

    const queryLikes = async (where: Record<string, unknown>) => {
      const [total, likes] = await Promise.all([
        deps.prisma.assetLike.count({ where: where as never }),
        deps.prisma.assetLike.findMany({
          where: where as never,
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
      return { total, likes };
    };

    const projectWhere = buildLikeWhere("projectId");
    const fallbackWhere = buildLikeWhere("tenantId");

    const result = await withProjectTenantFallback({
      queryByProject: () => queryLikes(projectWhere),
      queryByTenant: () => queryLikes(fallbackWhere),
      shouldFallback: (current) => current.total === 0
    });

    const { total, likes } = result;
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
    listProjectBatches,
    listUserOpenHistory,
    listUserLikedAssets
  };
};

export const createDeliveryDiscovery = createProjectDiscovery;
