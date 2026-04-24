import type { PrismaClient } from "@prisma/client";
import { normalizeLimit } from "./delivery-strategy";

type RankingRange = "today" | "week" | "month";

export const createDeliveryStats = (deps: {
  prisma: PrismaClient;
  getRuntimeProjectId: () => Promise<string>;
  isProjectMemberSafe: (userId: string) => Promise<boolean>;
  formatLocalDate: (date: Date) => string;
  startOfLocalDay: (date: Date) => Date;
  startOfLocalWeek: (date: Date) => Date;
  startOfLocalMonth: (date: Date) => Date;
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

  const getSince = (range: RankingRange, now: Date) => {
    return range === "today"
      ? deps.startOfLocalDay(now)
      : range === "week"
        ? deps.startOfLocalWeek(now)
        : deps.startOfLocalMonth(now);
  };

  const prepareRankingContext = async (range: RankingRange, limit: number, viewerUserId?: string) => {
    const projectId = await deps.getRuntimeProjectId();
    const since = getSince(range, new Date());
    const maxReturn = normalizeLimit(limit, { defaultLimit: 10, maxLimit: 50 });
    const isPublicViewer = viewerUserId ? !(await deps.isProjectMemberSafe(viewerUserId)) : false;
    const take = isPublicViewer ? Math.min(maxReturn * 3, 200) : maxReturn;
    return { projectId, since, maxReturn, isPublicViewer, take };
  };

  const buildRankingBase = async (input: {
    assetIds: string[];
    valueMap: Map<string, number>;
    isPublicViewer: boolean;
    maxReturn: number;
  }) => {
    const assetIds = input.assetIds;
    if (assetIds.length === 0) {
      return [];
    }
    const assets = await deps.prisma.asset.findMany({
      where: { id: { in: assetIds } },
      select: {
        id: true,
        title: true,
        shareCode: true,
        visibility: true,
        uploadBatches: { orderBy: { createdAt: "desc" }, take: 1, select: { userId: true } }
      }
    });
    const assetMap = new Map(assets.map((a) => [a.id, a]));
    const valueMap = new Map(assetIds.map((id) => [id, 0]));
    const items = assetIds
      .map((assetId) => {
        const found = assetMap.get(assetId);
        const value = input.valueMap.get(assetId) ?? 0;
        if (found && input.isPublicViewer && found.visibility !== "PUBLIC") {
          return null;
        }
        if (!found) {
          return null;
        }
        return {
          assetId,
          title: found.title,
          shareCode: found.shareCode ?? null,
          value,
          publisherUserId: found.uploadBatches[0]?.userId ?? null
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    return input.isPublicViewer ? items.slice(0, input.maxReturn) : items;
  };

  const getProjectHomeStats = async () => {
    const projectId = await deps.getRuntimeProjectId();
    const now = new Date();
    const todayStart = deps.startOfLocalDay(now);
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const asOfDate = deps.formatLocalDate(yesterdayStart);
    const runHomeStats = async (scopeKey: "projectId" | "tenantId") => {
      const [userFirstSeen, visitUsersYesterday, deliveriesTotal, deliveriesYesterday, storedFiles, earliestEvent] = await Promise.all([
        deps.prisma.event.groupBy({
          by: ["userId"],
          where: { [scopeKey]: projectId, createdAt: { lt: todayStart } } as never,
          _min: { createdAt: true }
        }),
        deps.prisma.event.groupBy({
          by: ["userId"],
          where: { [scopeKey]: projectId, type: "IMPRESSION", createdAt: { gte: yesterdayStart, lt: todayStart } } as never
        }),
        deps.prisma.event.count({ where: { [scopeKey]: projectId, type: "OPEN", createdAt: { lt: todayStart } } as never }),
        deps.prisma.event.count({
          where: { [scopeKey]: projectId, type: "OPEN", createdAt: { gte: yesterdayStart, lt: todayStart } } as never
        }),
        deps.prisma.uploadItem.count({
          where: { batch: { [scopeKey]: projectId, status: "COMMITTED", createdAt: { lt: todayStart } } } as never
        }),
        deps.prisma.event.findFirst({
          where: { [scopeKey]: projectId, createdAt: { lt: todayStart } } as never,
          orderBy: { createdAt: "asc" },
          select: { createdAt: true }
        })
      ]);
      return { userFirstSeen, visitUsersYesterday, deliveriesTotal, deliveriesYesterday, storedFiles, earliestEvent };
    };
    const { userFirstSeen, visitUsersYesterday, deliveriesTotal, deliveriesYesterday, storedFiles, earliestEvent } =
      await withProjectTenantFallback({
        queryByProject: () => runHomeStats("projectId"),
        queryByTenant: () => runHomeStats("tenantId"),
        shouldFallback: (result) =>
          result.userFirstSeen.length === 0 &&
          result.visitUsersYesterday.length === 0 &&
          result.deliveriesTotal === 0 &&
          result.deliveriesYesterday === 0 &&
          result.storedFiles === 0 &&
          !result.earliestEvent
      });
    const totalUsers = userFirstSeen.length;
    const newUsersYesterday = userFirstSeen.filter((row) => {
      const createdAt = row._min.createdAt;
      if (!createdAt) {
        return false;
      }
      return createdAt >= yesterdayStart && createdAt < todayStart;
    }).length;
    const daysRunning = earliestEvent?.createdAt
      ? Math.max(
          0,
          Math.floor((todayStart.getTime() - deps.startOfLocalDay(earliestEvent.createdAt).getTime()) / (24 * 60 * 60 * 1000))
        )
      : 0;
    return {
      asOfDate,
      daysRunning,
      totalUsers,
      newUsersYesterday,
      visitUsersYesterday: visitUsersYesterday.length,
      storedFiles,
      deliveriesTotal,
      deliveriesYesterday
    };
  };
  const getProjectStats = async () => {
    const projectId = await deps.getRuntimeProjectId();
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const runStats = async (scopeKey: "projectId" | "tenantId") => {
      const [visitorUsers, openUserGroups] = await Promise.all([
        deps.prisma.event.groupBy({ by: ["userId"], where: { [scopeKey]: projectId, type: "IMPRESSION" } as never }),
        deps.prisma.event.groupBy({ by: ["userId"], where: { [scopeKey]: projectId, type: "OPEN" } as never })
      ]);
      const [visits, opens, assets, batches, files, visits7d, opens7d] = await Promise.all([
        deps.prisma.event.count({ where: { [scopeKey]: projectId, type: "IMPRESSION" } as never }),
        deps.prisma.event.count({ where: { [scopeKey]: projectId, type: "OPEN" } as never }),
        deps.prisma.asset.count({ where: { [scopeKey]: projectId } as never }),
        deps.prisma.uploadBatch.count({ where: { [scopeKey]: projectId, status: "COMMITTED" } as never }),
        deps.prisma.uploadItem.count({ where: { batch: { [scopeKey]: projectId } } as never }),
        deps.prisma.event.count({ where: { [scopeKey]: projectId, type: "IMPRESSION", createdAt: { gte: since7d } } as never }),
        deps.prisma.event.count({ where: { [scopeKey]: projectId, type: "OPEN", createdAt: { gte: since7d } } as never })
      ]);
      return { visitorUsers, openUserGroups, visits, opens, assets, batches, files, visits7d, opens7d };
    };
    const { visitorUsers, openUserGroups, visits, opens, assets, batches, files, visits7d, opens7d } =
      await withProjectTenantFallback({
        queryByProject: () => runStats("projectId"),
        queryByTenant: () => runStats("tenantId"),
        shouldFallback: (result) =>
          result.visitorUsers.length === 0 &&
          result.openUserGroups.length === 0 &&
          result.visits === 0 &&
          result.opens === 0 &&
          result.assets === 0 &&
          result.batches === 0 &&
          result.files === 0 &&
          result.visits7d === 0 &&
          result.opens7d === 0
      });
    return {
      visitors: visitorUsers.length,
      visits,
      opens,
      openUsers: openUserGroups.length,
      assets,
      batches,
      files,
      visits7d,
      opens7d
    };
  };
  const getProjectRanking = async (
    range: RankingRange,
    limit: number,
    viewerUserId?: string
  ): Promise<{ assetId: string; title: string; shareCode: string | null; opens: number; publisherUserId: string | null }[]> => {
    const { projectId, since, maxReturn, isPublicViewer, take } = await prepareRankingContext(range, limit, viewerUserId);
    const grouped = await withProjectTenantFallback({
      queryByProject: () =>
        deps.prisma.event.groupBy({
          by: ["assetId"],
          where: { projectId, type: "OPEN", assetId: { not: null }, createdAt: { gte: since } } as never,
          _count: { assetId: true },
          orderBy: { _count: { assetId: "desc" } },
          take
        }),
      queryByTenant: () =>
        deps.prisma.event.groupBy({
          by: ["assetId"],
          where: { tenantId: projectId, type: "OPEN", assetId: { not: null }, createdAt: { gte: since } } as never,
          _count: { assetId: true },
          orderBy: { _count: { assetId: "desc" } },
          take
        }),
      shouldFallback: (result) => result.length === 0
    });
    const assetIds = grouped.map((g) => g.assetId).filter((id): id is string => Boolean(id));
    const valueMap = new Map(assetIds.map((id) => [id, 0]));
    for (const row of grouped) {
      if (row.assetId) {
        valueMap.set(row.assetId, row._count.assetId);
      }
    }
    const items = await buildRankingBase({ assetIds, valueMap, isPublicViewer, maxReturn });
    return items.map((item) => ({ ...item, opens: item.value })).map(({ value, ...rest }) => rest);
  };
  const getProjectLikeRanking = async (
    range: RankingRange,
    limit: number,
    viewerUserId?: string
  ): Promise<{ assetId: string; title: string; shareCode: string | null; likes: number; publisherUserId: string | null }[]> => {
    const { projectId, since, maxReturn, isPublicViewer, take } = await prepareRankingContext(range, limit, viewerUserId);
    const grouped = await withProjectTenantFallback({
      queryByProject: () =>
        deps.prisma.assetLike.groupBy({
          by: ["assetId"],
          where: { projectId, createdAt: { gte: since } } as never,
          _count: { assetId: true },
          orderBy: { _count: { assetId: "desc" } },
          take
        }),
      queryByTenant: () =>
        deps.prisma.assetLike.groupBy({
          by: ["assetId"],
          where: { tenantId: projectId, createdAt: { gte: since } } as never,
          _count: { assetId: true },
          orderBy: { _count: { assetId: "desc" } },
          take
        }),
      shouldFallback: (result) => result.length === 0
    });
    const assetIds = grouped.map((g) => g.assetId).filter((id): id is string => Boolean(id));
    const valueMap = new Map(assetIds.map((id) => [id, 0]));
    for (const row of grouped) {
      valueMap.set(row.assetId, row._count.assetId);
    }
    const items = await buildRankingBase({ assetIds, valueMap, isPublicViewer, maxReturn });
    return items.map((item) => ({ ...item, likes: item.value })).map(({ value, ...rest }) => rest);
  };
  const getProjectVisitRanking = async (
    range: RankingRange,
    limit: number,
    viewerUserId?: string
  ): Promise<{ assetId: string; title: string; shareCode: string | null; visits: number; publisherUserId: string | null }[]> => {
    const { projectId, since, maxReturn, isPublicViewer, take } = await prepareRankingContext(range, limit, viewerUserId);
    const grouped = await withProjectTenantFallback({
      queryByProject: () =>
        deps.prisma.event.groupBy({
          by: ["assetId"],
          where: { projectId, type: "IMPRESSION", assetId: { not: null }, createdAt: { gte: since } } as never,
          _count: { assetId: true },
          orderBy: { _count: { assetId: "desc" } },
          take
        }),
      queryByTenant: () =>
        deps.prisma.event.groupBy({
          by: ["assetId"],
          where: { tenantId: projectId, type: "IMPRESSION", assetId: { not: null }, createdAt: { gte: since } } as never,
          _count: { assetId: true },
          orderBy: { _count: { assetId: "desc" } },
          take
        }),
      shouldFallback: (result) => result.length === 0
    });
    const assetIds = grouped.map((g) => g.assetId).filter((id): id is string => Boolean(id));
    const valueMap = new Map(assetIds.map((id) => [id, 0]));
    for (const row of grouped) {
      if (row.assetId) {
        valueMap.set(row.assetId, row._count.assetId);
      }
    }
    const items = await buildRankingBase({ assetIds, valueMap, isPublicViewer, maxReturn });
    return items.map((item) => ({ ...item, visits: item.value })).map(({ value, ...rest }) => rest);
  };
  const getProjectCommentRanking = async (
    range: RankingRange,
    limit: number,
    viewerUserId?: string
  ): Promise<{ assetId: string; title: string; shareCode: string | null; comments: number; publisherUserId: string | null }[]> => {
    const { projectId, since, maxReturn, isPublicViewer, take } = await prepareRankingContext(range, limit, viewerUserId);
    const grouped = await withProjectTenantFallback({
      queryByProject: () =>
        deps.prisma.assetComment.groupBy({
          by: ["assetId"],
          where: { projectId, createdAt: { gte: since } } as never,
          _count: { assetId: true },
          orderBy: { _count: { assetId: "desc" } },
          take
        }),
      queryByTenant: () =>
        deps.prisma.assetComment.groupBy({
          by: ["assetId"],
          where: { tenantId: projectId, createdAt: { gte: since } } as never,
          _count: { assetId: true },
          orderBy: { _count: { assetId: "desc" } },
          take
        }),
      shouldFallback: (result) => result.length === 0
    });
    const assetIds = grouped.map((g) => g.assetId).filter((id): id is string => Boolean(id));
    const valueMap = new Map(assetIds.map((id) => [id, 0]));
    for (const row of grouped) {
      valueMap.set(row.assetId, row._count.assetId);
    }
    const items = await buildRankingBase({ assetIds, valueMap, isPublicViewer, maxReturn });
    return items.map((item) => ({ ...item, comments: item.value })).map(({ value, ...rest }) => rest);
  };
  return {
    getProjectHomeStats,
    getProjectStats,
    getProjectRanking,
    getProjectLikeRanking,
    getProjectVisitRanking,
    getProjectCommentRanking
  };
};
