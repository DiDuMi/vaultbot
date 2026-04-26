import type { PrismaClient } from "@prisma/client";
import { normalizePage, normalizePageSize } from "./delivery-strategy";
import { withProjectTenantFallback } from "./project-fallback";

type ProjectRecycledAssetItem = {
  assetId: string;
  title: string;
  description: string | null;
  shareCode: string | null;
  updatedAt: Date;
};

type ProjectBatchSummaryItem = {
  assetId: string;
  shareCode: string | null;
  title: string;
  description: string | null;
  count: number;
  publisherUserId: string;
};

type ProjectOpenHistoryItem = {
  assetId: string;
  shareCode: string | null;
  title: string;
  description: string | null;
  openedAt: Date;
  publisherUserId: string | null;
};

type ProjectLikedAssetItem = {
  assetId: string;
  shareCode: string | null;
  title: string;
  description: string | null;
  likedAt: Date;
  publisherUserId: string | null;
};

type ProjectSearchAssetItem = {
  assetId: string;
  shareCode: string | null;
  title: string;
  description: string | null;
  publisherUserId: string | null;
};

export const findOwnedProjectCommittedBatch = async (
  prisma: PrismaClient,
  projectId: string,
  userId: string,
  assetId: string,
  extra: Record<string, unknown>
) =>
  withProjectTenantFallback({
    queryByProject: () =>
      prisma.uploadBatch.findFirst({
        where: { projectId, userId, assetId, status: "COMMITTED" },
        orderBy: { createdAt: "desc" },
        ...extra
      } as never),
    queryByTenant: () =>
      prisma.uploadBatch.findFirst({
        where: { tenantId: projectId, userId, assetId, status: "COMMITTED" },
        orderBy: { createdAt: "desc" },
        ...extra
      } as never),
    shouldFallback: (current) => current === null
  }) as Promise<any>;

export const findProjectAssetById = async <T>(
  prisma: PrismaClient,
  projectId: string,
  assetId: string,
  select: T
) =>
  withProjectTenantFallback({
    queryByProject: () => prisma.asset.findFirst({ where: { id: assetId, projectId }, select } as never),
    queryByTenant: () => prisma.asset.findFirst({ where: { id: assetId, tenantId: projectId }, select } as never),
    shouldFallback: (current) => current === null
  });

export const listProjectHistoryAssetsByIds = async (prisma: PrismaClient, projectId: string, assetIds: string[]) =>
  withProjectTenantFallback({
    queryByProject: () =>
      prisma.asset
        .findMany({
          where: { id: { in: assetIds }, projectId },
          select: {
            id: true,
            title: true,
            description: true,
            shareCode: true,
            uploadBatches: { orderBy: { createdAt: "desc" }, take: 1, select: { userId: true } }
          }
        } as never)
        .catch(() => []),
    queryByTenant: () =>
      prisma.asset.findMany({
        where: { id: { in: assetIds }, tenantId: projectId },
        select: {
          id: true,
          title: true,
          description: true,
          shareCode: true,
          uploadBatches: { orderBy: { createdAt: "desc" }, take: 1, select: { userId: true } }
        }
      } as never),
    shouldFallback: (current) => current.length === 0
  }) as unknown as Promise<
    Array<{
      id: string;
      title: string;
      description: string | null;
      shareCode: string | null;
      uploadBatches: Array<{ userId: string }>;
    }>
  >;

export const listProjectRecycledAssets = async (input: {
  prisma: PrismaClient;
  projectId: string;
  userId: string;
  page: number;
  pageSize: number;
}): Promise<{ total: number; items: ProjectRecycledAssetItem[] }> => {
  const { prisma, projectId, userId, page, pageSize } = input;
  const safePage = normalizePage(page);
  const safeSize = normalizePageSize(pageSize);
  const buildWhere = (projectScopeKey: "projectId" | "tenantId") => ({
    [projectScopeKey]: projectId,
    searchable: false,
    visibility: "RESTRICTED" as const,
    uploadBatches: {
      some: {
        [projectScopeKey]: projectId,
        userId,
        status: "COMMITTED" as const
      }
    }
  });
  const queryAssets = async (where: Record<string, unknown>) => {
    const [total, assets] = await Promise.all([
      prisma.asset.count({ where: where as never }),
      prisma.asset.findMany({
        where: where as never,
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
    return { total, assets };
  };

  const result = await withProjectTenantFallback({
    queryByProject: () => queryAssets(buildWhere("projectId")),
    queryByTenant: () => queryAssets(buildWhere("tenantId")),
    shouldFallback: (current) => current.total === 0 && current.assets.length === 0
  });

  return {
    total: result.total,
    items: result.assets.map((asset) => ({
      assetId: asset.id,
      title: asset.title,
      description: asset.description,
      shareCode: asset.shareCode ?? null,
      updatedAt: asset.updatedAt
    }))
  };
};

export const listProjectCommittedBatches = async (input: {
  prisma: PrismaClient;
  projectId: string;
  page: number;
  pageSize: number;
  collectionId?: string | null;
  date?: Date;
  startOfLocalDay: (date: Date) => Date;
  assetVisibilityWhere: Record<string, unknown>;
  userId?: string;
}): Promise<{ total: number; items: ProjectBatchSummaryItem[] }> => {
  const { prisma, projectId, page, pageSize, collectionId, date, startOfLocalDay, assetVisibilityWhere, userId } = input;
  const safePage = normalizePage(page);
  const safeSize = normalizePageSize(pageSize);
  const dayStart = date ? startOfLocalDay(date) : undefined;
  const dayEnd = dayStart ? new Date(dayStart.getTime() + 24 * 60 * 60 * 1000) : undefined;

  const buildWhere = (projectScopeKey: "tenantId" | "projectId") => {
    const assetWhere = {
      ...(collectionId === undefined ? {} : { collectionId }),
      ...assetVisibilityWhere
    };
    const scopedAssetWhere =
      Object.keys(assetWhere).length > 0 ? { ...assetWhere, [projectScopeKey]: projectId } : assetWhere;
    return {
      [projectScopeKey]: projectId,
      status: "COMMITTED" as const,
      ...(userId ? { userId } : {}),
      ...(Object.keys(scopedAssetWhere).length > 0 ? { asset: scopedAssetWhere } : {}),
      ...(dayStart && dayEnd ? { createdAt: { gte: dayStart, lt: dayEnd } } : {})
    };
  };

  const queryBatches = async (where: Record<string, unknown>) => {
    const [total, batches] = await Promise.all([
      prisma.uploadBatch.count({ where: where as never }),
      prisma.uploadBatch.findMany({
        where: where as never,
        orderBy: { createdAt: "desc" },
        take: safeSize,
        skip: (safePage - 1) * safeSize,
        include: { asset: true, items: { select: { id: true } } }
      })
    ]);
    return { total, batches };
  };

  const result = await withProjectTenantFallback({
    queryByProject: () => queryBatches(buildWhere("projectId")),
    queryByTenant: () => queryBatches(buildWhere("tenantId")),
    shouldFallback: (current) => current.total === 0 && current.batches.length === 0
  });

  return {
    total: result.total,
    items: result.batches.map((batch) => ({
      assetId: batch.assetId,
      shareCode: batch.asset?.shareCode ?? null,
      title: batch.asset?.title ?? `Upload ${batch.id}`,
      description: batch.asset?.description ?? null,
      count: batch.items.length,
      publisherUserId: batch.userId
    }))
  };
};

export const listProjectOpenHistory = async (input: {
  prisma: PrismaClient;
  projectId: string;
  userId: string;
  page: number;
  pageSize: number;
  since?: Date;
}): Promise<{ total: number; items: ProjectOpenHistoryItem[] }> => {
  const { prisma, projectId, userId, page, pageSize, since } = input;
  const safePage = normalizePage(page);
  const safeSize = normalizePageSize(pageSize);

  const buildWhere = (projectScopeKey: "projectId" | "tenantId") => ({
    [projectScopeKey]: projectId,
    userId,
    type: "OPEN" as const,
    assetId: { not: null },
    ...(since ? { createdAt: { gte: since } } : {})
  });

  const queryHistory = async (where: Record<string, unknown>) => {
    const [distinctAssets, grouped] = await Promise.all([
      prisma.event.findMany({ where: where as never, distinct: ["assetId"], select: { assetId: true } }),
      prisma.event.groupBy({
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

  const result = await withProjectTenantFallback({
    queryByProject: () => queryHistory(buildWhere("projectId")),
    queryByTenant: () => queryHistory(buildWhere("tenantId")),
    shouldFallback: (current) => current.total === 0
  });

  const assetIds = result.grouped.map((g) => g.assetId).filter((id): id is string => typeof id === "string" && id.length > 0);
  if (assetIds.length === 0) {
    return { total: result.total, items: [] };
  }
  const finalAssets = await listProjectHistoryAssetsByIds(prisma, projectId, assetIds);
  const assetMap = new Map(finalAssets.map((asset) => [asset.id, asset]));
  const items = result.grouped
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
    .filter((item): item is ProjectOpenHistoryItem => Boolean(item));
  return { total: result.total, items };
};

export const listProjectLikedAssets = async (input: {
  prisma: PrismaClient;
  projectId: string;
  userId: string;
  page: number;
  pageSize: number;
  assetVisibilityWhere: Record<string, unknown>;
  since?: Date;
}): Promise<{ total: number; items: ProjectLikedAssetItem[] }> => {
  const { prisma, projectId, userId, page, pageSize, assetVisibilityWhere, since } = input;
  const safePage = normalizePage(page);
  const safeSize = normalizePageSize(pageSize);

  const buildWhere = (projectScopeKey: "projectId" | "tenantId") => {
    const base = {
      tenantId: projectId,
      userId,
      asset: { ...assetVisibilityWhere, [projectScopeKey]: projectId }
    };
    return since ? { ...base, createdAt: { gte: since } } : base;
  };

  const queryLikes = async (where: Record<string, unknown>) => {
    const [total, likes] = await Promise.all([
      prisma.assetLike.count({ where: where as never }),
      prisma.assetLike.findMany({
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

  const result = await withProjectTenantFallback({
    queryByProject: () => queryLikes(buildWhere("projectId")),
    queryByTenant: () => queryLikes(buildWhere("tenantId")),
    shouldFallback: (current) => current.total === 0
  });

  return {
    total: result.total,
    items: result.likes.map((row) => ({
      assetId: row.assetId,
      shareCode: row.asset?.shareCode ?? null,
      title: row.asset?.title ?? row.assetId,
      description: row.asset?.description ?? null,
      likedAt: row.createdAt,
      publisherUserId: row.asset?.uploadBatches[0]?.userId ?? null
    }))
  };
};

export const searchProjectAssets = async (input: {
  prisma: PrismaClient;
  projectId: string;
  query: string;
  page: number;
  pageSize: number;
  collectionId?: string | null;
  assetVisibilityWhere: Record<string, unknown>;
}): Promise<{ total: number; items: ProjectSearchAssetItem[] }> => {
  const { prisma, projectId, query, page, pageSize, collectionId, assetVisibilityWhere } = input;
  const safeQuery = query.trim().slice(0, 100);
  const safePage = normalizePage(page);
  const safeSize = normalizePageSize(pageSize, { maxSize: 50 });
  const baseWhere = {
    searchable: true,
    ...assetVisibilityWhere,
    OR: [
      { title: { contains: safeQuery, mode: "insensitive" as const } },
      { description: { contains: safeQuery, mode: "insensitive" as const } }
    ]
  };

  const queryAssets = async (where: Record<string, unknown>) => {
    const [total, assets] = await Promise.all([
      prisma.asset.count({ where: where as never }),
      prisma.asset.findMany({
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

  return {
    total: result.total,
    items: result.assets.map((asset) => ({
      assetId: asset.id,
      shareCode: asset.shareCode ?? null,
      title: asset.title,
      description: asset.description,
      publisherUserId: asset.uploadBatches[0]?.userId ?? null
    }))
  };
};
