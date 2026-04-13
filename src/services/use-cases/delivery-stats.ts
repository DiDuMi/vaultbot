import type { PrismaClient } from "@prisma/client";
import { normalizeLimit } from "./delivery-strategy";

type RankingRange = "today" | "week" | "month";

export const createDeliveryStats = (deps: {
  prisma: PrismaClient;
  getTenantId: () => Promise<string>;
  isTenantUserSafe: (userId: string) => Promise<boolean>;
  formatLocalDate: (date: Date) => string;
  startOfLocalDay: (date: Date) => Date;
  startOfLocalWeek: (date: Date) => Date;
  startOfLocalMonth: (date: Date) => Date;
}) => {
  const getSince = (range: RankingRange, now: Date) => {
    return range === "today"
      ? deps.startOfLocalDay(now)
      : range === "week"
        ? deps.startOfLocalWeek(now)
        : deps.startOfLocalMonth(now);
  };

  const prepareRankingContext = async (range: RankingRange, limit: number, viewerUserId?: string) => {
    const tenantId = await deps.getTenantId();
    const since = getSince(range, new Date());
    const maxReturn = normalizeLimit(limit, { defaultLimit: 10, maxLimit: 50 });
    const isPublicViewer = viewerUserId ? !(await deps.isTenantUserSafe(viewerUserId)) : false;
    const take = isPublicViewer ? Math.min(maxReturn * 3, 200) : maxReturn;
    return { tenantId, since, maxReturn, isPublicViewer, take };
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

  const getTenantHomeStats = async () => {
    const tenantId = await deps.getTenantId();
    const now = new Date();
    const todayStart = deps.startOfLocalDay(now);
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const asOfDate = deps.formatLocalDate(yesterdayStart);
    const [userFirstSeen, visitUsersYesterday, deliveriesTotal, deliveriesYesterday, storedFiles, earliestEvent] = await Promise.all([
      deps.prisma.event.groupBy({
        by: ["userId"],
        where: { tenantId, createdAt: { lt: todayStart } },
        _min: { createdAt: true }
      }),
      deps.prisma.event.groupBy({
        by: ["userId"],
        where: { tenantId, type: "IMPRESSION", createdAt: { gte: yesterdayStart, lt: todayStart } }
      }),
      deps.prisma.event.count({ where: { tenantId, type: "OPEN", createdAt: { lt: todayStart } } }),
      deps.prisma.event.count({ where: { tenantId, type: "OPEN", createdAt: { gte: yesterdayStart, lt: todayStart } } }),
      deps.prisma.uploadItem.count({
        where: { batch: { tenantId, status: "COMMITTED", createdAt: { lt: todayStart } } }
      }),
      deps.prisma.event.findFirst({
        where: { tenantId, createdAt: { lt: todayStart } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true }
      })
    ]);
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

  const getTenantStats = async () => {
    const tenantId = await deps.getTenantId();
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [visitorUsers, openUserGroups] = await Promise.all([
      deps.prisma.event.groupBy({ by: ["userId"], where: { tenantId, type: "IMPRESSION" } }),
      deps.prisma.event.groupBy({ by: ["userId"], where: { tenantId, type: "OPEN" } })
    ]);
    const [visits, opens, assets, batches, files, visits7d, opens7d] = await Promise.all([
      deps.prisma.event.count({ where: { tenantId, type: "IMPRESSION" } }),
      deps.prisma.event.count({ where: { tenantId, type: "OPEN" } }),
      deps.prisma.asset.count({ where: { tenantId } }),
      deps.prisma.uploadBatch.count({ where: { tenantId, status: "COMMITTED" } }),
      deps.prisma.uploadItem.count({ where: { batch: { tenantId } } }),
      deps.prisma.event.count({ where: { tenantId, type: "IMPRESSION", createdAt: { gte: since7d } } }),
      deps.prisma.event.count({ where: { tenantId, type: "OPEN", createdAt: { gte: since7d } } })
    ]);
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

  const getTenantRanking = async (
    range: RankingRange,
    limit: number,
    viewerUserId?: string
  ): Promise<{ assetId: string; title: string; shareCode: string | null; opens: number; publisherUserId: string | null }[]> => {
    const { tenantId, since, maxReturn, isPublicViewer, take } = await prepareRankingContext(range, limit, viewerUserId);
    const grouped = await deps.prisma.event.groupBy({
      by: ["assetId"],
      where: { tenantId, type: "OPEN", assetId: { not: null }, createdAt: { gte: since } },
      _count: { assetId: true },
      orderBy: { _count: { assetId: "desc" } },
      take
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

  const getTenantLikeRanking = async (
    range: RankingRange,
    limit: number,
    viewerUserId?: string
  ): Promise<{ assetId: string; title: string; shareCode: string | null; likes: number; publisherUserId: string | null }[]> => {
    const { tenantId, since, maxReturn, isPublicViewer, take } = await prepareRankingContext(range, limit, viewerUserId);
    const grouped = await deps.prisma.assetLike.groupBy({
      by: ["assetId"],
      where: { tenantId, createdAt: { gte: since } },
      _count: { assetId: true },
      orderBy: { _count: { assetId: "desc" } },
      take
    });
    const assetIds = grouped.map((g) => g.assetId).filter((id): id is string => Boolean(id));
    const valueMap = new Map(assetIds.map((id) => [id, 0]));
    for (const row of grouped) {
      valueMap.set(row.assetId, row._count.assetId);
    }
    const items = await buildRankingBase({ assetIds, valueMap, isPublicViewer, maxReturn });
    return items.map((item) => ({ ...item, likes: item.value })).map(({ value, ...rest }) => rest);
  };

  const getTenantVisitRanking = async (
    range: RankingRange,
    limit: number,
    viewerUserId?: string
  ): Promise<{ assetId: string; title: string; shareCode: string | null; visits: number; publisherUserId: string | null }[]> => {
    const { tenantId, since, maxReturn, isPublicViewer, take } = await prepareRankingContext(range, limit, viewerUserId);
    const grouped = await deps.prisma.event.groupBy({
      by: ["assetId"],
      where: { tenantId, type: "IMPRESSION", assetId: { not: null }, createdAt: { gte: since } },
      _count: { assetId: true },
      orderBy: { _count: { assetId: "desc" } },
      take
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

  const getTenantCommentRanking = async (
    range: RankingRange,
    limit: number,
    viewerUserId?: string
  ): Promise<{ assetId: string; title: string; shareCode: string | null; comments: number; publisherUserId: string | null }[]> => {
    const { tenantId, since, maxReturn, isPublicViewer, take } = await prepareRankingContext(range, limit, viewerUserId);
    const grouped = await deps.prisma.assetComment.groupBy({
      by: ["assetId"],
      where: { tenantId, createdAt: { gte: since } },
      _count: { assetId: true },
      orderBy: { _count: { assetId: "desc" } },
      take
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
    getTenantHomeStats,
    getTenantStats,
    getTenantRanking,
    getTenantLikeRanking,
    getTenantVisitRanking,
    getTenantCommentRanking
  };
};
