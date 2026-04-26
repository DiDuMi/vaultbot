import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizePage } from "./delivery-strategy";
import { logError } from "../../infra/logging";
import {
  listProjectCommittedBatches,
  listProjectLikedAssets,
  listProjectOpenHistory,
  listProjectRecycledAssets,
  searchProjectAssets
} from "./delivery-project-scope";
import {
  backfillProjectTagsIfEmpty,
  findProjectTagById,
  findProjectTagByName,
  listProjectAssetsByTagId,
  listProjectTopTags
} from "./delivery-project-tags";
import {
  deleteProjectUserAsset,
  getProjectUserAssetMeta,
  recycleProjectUserAsset,
  restoreProjectUserAsset,
  setProjectUserAssetSearchable
} from "./delivery-project-assets";

export { withProjectTenantFallback } from "./project-fallback";

export const createProjectDiscovery = (deps: {
  prisma: PrismaClient;
  getRuntimeProjectId: () => Promise<string>;
  isProjectMemberSafe: (userId: string) => Promise<boolean>;
  startOfLocalDay: (date: Date) => Date;
}) => {
  const buildPublicAssetVisibilityWhere = (isProjectViewer: boolean) =>
    isProjectViewer ? {} : { visibility: { not: "RESTRICTED" as const } };
  const createSearchEvent = async (input: {
    projectId: string;
    userId: string;
    payload: Prisma.InputJsonObject;
    logContext: Record<string, unknown>;
    op: "event_create_search" | "event_create_search_tag";
  }) =>
    deps.prisma.event
      .create({
        data: {
          tenantId: input.projectId,
          projectId: input.projectId,
          userId: input.userId,
          type: "SEARCH",
          payload: input.payload
        }
      })
      .catch((error) =>
        logError({ component: "delivery_discovery", op: input.op, ...input.logContext }, error)
      );

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
    const result = await searchProjectAssets({
      prisma: deps.prisma,
      projectId,
      query,
      page,
      pageSize,
      collectionId: options?.collectionId,
      assetVisibilityWhere: buildPublicAssetVisibilityWhere(isProjectViewer)
    });
    await createSearchEvent({
      projectId,
      userId,
      payload: { q: safeQuery, page: safePage },
      logContext: { projectId, userId, page: safePage },
      op: "event_create_search"
    });
    return result;
  };

  const getTagById = async (tagId: string) => {
    const projectId = await deps.getRuntimeProjectId();
    return findProjectTagById(deps.prisma, projectId, tagId);
  };

  const getTagByName = async (name: string) => {
    const projectId = await deps.getRuntimeProjectId();
    return findProjectTagByName(deps.prisma, projectId, name);
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
    await backfillProjectTagsIfEmpty(deps.prisma, projectId).catch((error) =>
      logError({ component: "delivery_discovery", op: "backfill_project_tags_if_empty", projectId }, error)
    );
    const pageSize = typeof pageSizeOrOptions === "number" ? pageSizeOrOptions : undefined;
    const finalOptions = (typeof pageSizeOrOptions === "number" ? options : pageSizeOrOptions) ?? {};
    const isProjectViewer = finalOptions.viewerUserId ? await deps.isProjectMemberSafe(finalOptions.viewerUserId) : true;
    const assetVisibilityWhere = buildPublicAssetVisibilityWhere(isProjectViewer);
    return listProjectTopTags({ prisma: deps.prisma, projectId, limitOrPage, pageSize, assetVisibilityWhere });
  };

  const listAssetsByTagId = async (userId: string, tagId: string, page: number, pageSize: number) => {
    const projectId = await deps.getRuntimeProjectId();
    const isProjectViewer = await deps.isProjectMemberSafe(userId);
    const safePage = normalizePage(page);
    const result = await listProjectAssetsByTagId({
      prisma: deps.prisma,
      projectId,
      tagId,
      page,
      pageSize,
      assetVisibilityWhere: buildPublicAssetVisibilityWhere(isProjectViewer)
    });
    await createSearchEvent({
      projectId,
      userId,
      payload: { tagId, page: safePage },
      logContext: { projectId, userId, tagId, page: safePage },
      op: "event_create_search_tag"
    });
    return result;
  };

  const getUserAssetMeta = async (userId: string, assetId: string) => {
    const projectId = await deps.getRuntimeProjectId();
    return getProjectUserAssetMeta(deps.prisma, projectId, userId, assetId);
  };

  const setUserAssetSearchable = async (userId: string, assetId: string, searchable: boolean) => {
    const projectId = await deps.getRuntimeProjectId();
    return setProjectUserAssetSearchable(deps.prisma, projectId, userId, assetId, searchable);
  };

  const deleteUserAsset = async (userId: string, assetId: string) => {
    const projectId = await deps.getRuntimeProjectId();
    return deleteProjectUserAsset(deps.prisma, projectId, userId, assetId);
  };

  const recycleUserAsset = async (userId: string, assetId: string) => {
    const projectId = await deps.getRuntimeProjectId();
    return recycleProjectUserAsset(deps.prisma, projectId, userId, assetId);
  };

  const restoreUserAsset = async (userId: string, assetId: string) => {
    const projectId = await deps.getRuntimeProjectId();
    return restoreProjectUserAsset(deps.prisma, projectId, userId, assetId);
  };

  const listUserRecycledAssets = async (userId: string, page: number, pageSize: number) => {
    const projectId = await deps.getRuntimeProjectId();
    return listProjectRecycledAssets({ prisma: deps.prisma, projectId, userId, page, pageSize });
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

  const listUserBatches = async (
    userId: string,
    page: number,
    pageSize: number,
    options?: { collectionId?: string | null; date?: Date }
  ) => {
    const projectId = await deps.getRuntimeProjectId();
    const isProjectViewer = await deps.isProjectMemberSafe(userId);
    return listProjectCommittedBatches({
      prisma: deps.prisma,
      projectId,
      page,
      pageSize,
      userId,
      collectionId: options?.collectionId,
      date: options?.date,
      startOfLocalDay: deps.startOfLocalDay,
      assetVisibilityWhere: buildPublicAssetVisibilityWhere(isProjectViewer)
    });
  };

  const listProjectBatches = async (
    viewerUserId: string,
    page: number,
    pageSize: number,
    options?: { collectionId?: string | null; date?: Date }
  ) => {
    const projectId = await deps.getRuntimeProjectId();
    const isProjectViewer = await deps.isProjectMemberSafe(viewerUserId);
    return listProjectCommittedBatches({
      prisma: deps.prisma,
      projectId,
      page,
      pageSize,
      collectionId: options?.collectionId,
      date: options?.date,
      startOfLocalDay: deps.startOfLocalDay,
      assetVisibilityWhere: buildPublicAssetVisibilityWhere(isProjectViewer)
    });
  };

  const listUserOpenHistory = async (userId: string, page: number, pageSize: number, options?: { since?: Date }) => {
    const projectId = await deps.getRuntimeProjectId();
    return listProjectOpenHistory({ prisma: deps.prisma, projectId, userId, page, pageSize, since: options?.since });
  };

  const listUserLikedAssets = async (userId: string, page: number, pageSize: number, options?: { since?: Date }) => {
    const projectId = await deps.getRuntimeProjectId();
    const isProjectMember = await deps.isProjectMemberSafe(userId);
    const visibilityWhere = buildPublicAssetVisibilityWhere(!isProjectMember ? false : true);
    return listProjectLikedAssets({
      prisma: deps.prisma,
      projectId,
      userId,
      page,
      pageSize,
      assetVisibilityWhere: visibilityWhere,
      since: options?.since
    });
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
