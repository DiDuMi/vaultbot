import type { PrismaClient } from "@prisma/client";
import { normalizeLimit, normalizePage, normalizePageSize } from "./delivery-strategy";
import { withProjectFallback } from "./project-fallback";

type ProjectTagResult = { tagId: string; name: string } | null;
type ProjectTopTag = { tagId: string; name: string; count: number };
type ProjectTagGroup = { tagId: string; _count: { tagId: number } };
type ProjectTagAssetItem = {
  assetId: string;
  shareCode: string | null;
  title: string;
  description: string | null;
  publisherUserId: string | null;
};

const stripHtml = (value: string) => value.replace(/<[^>]*>/g, " ");

export const normalizeTagName = (raw: string) => {
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

export const extractHashtags = (title: string, description: string | null) => {
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

export const findProjectTagById = async (prisma: PrismaClient, projectId: string, tagId: string): Promise<ProjectTagResult> => {
  const directTag =
    (await prisma.tag
      .findFirst({ where: { id: tagId, projectId }, select: { id: true, name: true } } as never)
      .catch(() => null)) ??
    (await prisma.tag.findFirst({ where: { id: tagId, tenantId: projectId }, select: { id: true, name: true } }));
  if (directTag) {
    return { tagId: directTag.id, name: directTag.name };
  }

  // Safe fallback: only resolve the tag if it's actually referenced by this project.
  const link = await withProjectFallback({
    queryByProject: () =>
      prisma.assetTag
        .findFirst({
          where: { tenantId: projectId, tagId, asset: { projectId } },
          select: { tag: { select: { id: true, name: true } } }
        })
        .catch(() => null),
    queryByFallback: () =>
      prisma.assetTag
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

export const findProjectTagByName = async (prisma: PrismaClient, projectId: string, name: string): Promise<ProjectTagResult> => {
  const normalized = normalizeTagName(name);
  if (!normalized) {
    return null;
  }
  const directTag =
    (await prisma.tag
      .findUnique({
        where: { projectId_name: { projectId, name: normalized } },
        select: { id: true, name: true }
      } as never)
      .catch(() => null)) ??
    (await prisma.tag.findUnique({
      where: { tenantId_name: { tenantId: projectId, name: normalized } },
      select: { id: true, name: true }
    }));
  if (directTag) {
    return { tagId: directTag.id, name: directTag.name };
  }

  const link = await withProjectFallback({
    queryByProject: () =>
      prisma.assetTag
        .findFirst({
          where: { tenantId: projectId, tag: { name: normalized }, asset: { projectId } },
          select: { tag: { select: { id: true, name: true } } }
        })
        .catch(() => null),
    queryByFallback: () =>
      prisma.assetTag
        .findFirst({
          where: { tenantId: projectId, tag: { name: normalized }, asset: { tenantId: projectId } },
          select: { tag: { select: { id: true, name: true } } }
        })
        .catch(() => null),
    shouldFallback: (current) => current === null
  });

  const tag = link?.tag ?? null;
  return tag ? { tagId: tag.id, name: tag.name } : null;
};

const hydrateProjectTagGroups = async (
  prisma: PrismaClient,
  projectId: string,
  grouped: ProjectTagGroup[]
): Promise<ProjectTopTag[]> => {
  const tagIds = grouped.map((g) => g.tagId);
  if (tagIds.length === 0) {
    return [];
  }
  const tags =
    (await prisma.tag
      .findMany({ where: { id: { in: tagIds }, projectId }, select: { id: true, name: true } } as never)
      .catch(() => [])) ??
    (await prisma.tag.findMany({ where: { id: { in: tagIds }, tenantId: projectId }, select: { id: true, name: true } }));
  const nameById = new Map(tags.map((t) => [t.id, t.name]));
  return grouped
    .map((g) => {
      const name = nameById.get(g.tagId);
      if (!name) {
        return null;
      }
      return { tagId: g.tagId, name, count: g._count.tagId };
    })
    .filter((row): row is ProjectTopTag => Boolean(row))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.name.localeCompare(b.name)));
};

export const listProjectTopTags = async (input: {
  prisma: PrismaClient;
  projectId: string;
  limitOrPage: number;
  pageSize?: number;
  assetVisibilityWhere: Record<string, unknown>;
}): Promise<ProjectTopTag[] | { total: number; items: ProjectTopTag[] }> => {
  const { prisma, projectId, limitOrPage, pageSize, assetVisibilityWhere } = input;
  if (typeof pageSize !== "number") {
    const safeLimit = normalizeLimit(limitOrPage, { defaultLimit: 20, maxLimit: 50 });
    const groupedByProject = await prisma.assetTag.groupBy({
      by: ["tagId"],
      where: { tenantId: projectId, asset: { projectId, searchable: true, ...assetVisibilityWhere } },
      _count: { tagId: true },
      orderBy: [{ _count: { tagId: "desc" } }, { tagId: "asc" }],
      take: safeLimit
    });
    const grouped =
      groupedByProject.length > 0
        ? groupedByProject
        : await prisma.assetTag.groupBy({
            by: ["tagId"],
            where: { tenantId: projectId, asset: { searchable: true, ...assetVisibilityWhere } },
            _count: { tagId: true },
            orderBy: [{ _count: { tagId: "desc" } }, { tagId: "asc" }],
            take: safeLimit
          });
    return hydrateProjectTagGroups(prisma, projectId, grouped);
  }

  const safePage = normalizePage(limitOrPage);
  const safePageSize = normalizePageSize(pageSize, { defaultSize: 20, maxSize: 50 });
  const queryTagIndex = async (scopedAssetWhere: Record<string, unknown>) => {
    const [total, grouped] = await Promise.all([
      prisma.tag.count({
        where: { tenantId: projectId, assets: { some: { asset: scopedAssetWhere as never } } } as never
      }),
      prisma.assetTag.groupBy({
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

  return { total: index.total, items: await hydrateProjectTagGroups(prisma, projectId, index.grouped) };
};

export const listProjectAssetsByTagId = async (input: {
  prisma: PrismaClient;
  projectId: string;
  tagId: string;
  page: number;
  pageSize: number;
  assetVisibilityWhere: Record<string, unknown>;
}): Promise<{ total: number; items: ProjectTagAssetItem[] }> => {
  const { prisma, projectId, tagId, page, pageSize, assetVisibilityWhere } = input;
  const safePage = normalizePage(page);
  const safeSize = normalizePageSize(pageSize, { maxSize: 50 });
  const baseWhere = {
    searchable: true,
    ...assetVisibilityWhere,
    tags: { some: { tagId } }
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

  const result = await withProjectFallback({
    queryByProject: () => queryAssets({ projectId, ...baseWhere }),
    queryByFallback: () => queryAssets({ tenantId: projectId, ...baseWhere }),
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

export const backfillProjectTagsIfEmpty = async (prisma: PrismaClient, projectId: string) => {
  if (
    typeof prisma.asset?.findMany !== "function" ||
    typeof prisma.$transaction !== "function" ||
    typeof prisma.tag?.upsert !== "function"
  ) {
    return;
  }
  const existingCount =
    typeof prisma.assetTag?.count === "function" ? await prisma.assetTag.count({ where: { projectId } } as never).catch(() => 0) : 0;
  if (existingCount > 0) {
    return;
  }
  let assets = await prisma.asset
    .findMany({
      where: { projectId },
      select: { id: true, title: true, description: true }
    })
    .catch(() => []);
  if (assets.length === 0) {
    assets = await prisma.asset
      .findMany({
        where: { tenantId: projectId },
        select: { id: true, title: true, description: true }
      })
      .catch(() => []);
  }
  if (assets.length === 0) {
    return;
  }
  await prisma.$transaction(async (tx) => {
    for (const asset of assets) {
      const tags = extractHashtags(asset.title, asset.description);
      if (tags.length === 0) {
        continue;
      }
      const tagIds: string[] = [];
      for (const name of tags) {
        const tag = await tx.tag.upsert({
          where: { tenantId_name: { tenantId: projectId, name } },
          create: { tenantId: projectId, projectId, name },
          update: { projectId }
        });
        tagIds.push(tag.id);
      }
      await tx.assetTag.createMany({
        data: tagIds.map((tagId) => ({ tenantId: projectId, projectId, assetId: asset.id, tagId })),
        skipDuplicates: true
      });
    }
  });
};
