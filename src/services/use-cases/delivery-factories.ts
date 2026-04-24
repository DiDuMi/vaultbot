import type { PrismaClient } from "@prisma/client";
import type {
  DeliveryIdentityCompatibilityAliases,
  DeliveryDiscoveryService,
  DeliveryIdentityService,
  DeliverySocialService
} from "./delivery";

type DeliveryUserSummaryDeps = {
  prisma: PrismaClient;
  getRuntimeProjectId: () => Promise<string>;
};

type DeliveryAssetAccessDeps = {
  prisma: PrismaClient;
  isProjectMemberSafe: (userId: string) => Promise<boolean>;
  canManageProjectSafe: (userId: string) => Promise<boolean>;
};

type IdentityServiceDeps = {
  selectReplicas: DeliveryIdentityService["selectReplicas"];
  resolveShareCode: DeliveryIdentityService["resolveShareCode"];
  upsertProjectUserFromTelegram: DeliveryIdentityService["upsertProjectUserFromTelegram"];
  upsertTenantUserFromTelegram: DeliveryIdentityCompatibilityAliases["upsertTenantUserFromTelegram"];
  getProjectUserLabel: DeliveryIdentityService["getProjectUserLabel"];
  getUserProfileSummary: DeliveryIdentityService["getUserProfileSummary"];
  trackOpen: DeliveryIdentityService["trackOpen"];
  trackVisit: DeliveryIdentityService["trackVisit"];
  isProjectMember: DeliveryIdentityService["isProjectMember"];
  canManageProject: DeliveryIdentityService["canManageProject"];
};

export const createGetUserProfileSummary = ({
  prisma,
  getRuntimeProjectId
}: DeliveryUserSummaryDeps): DeliveryIdentityService["getUserProfileSummary"] => {
  return async (userId) => {
    const projectId = await getRuntimeProjectId();
    const queryByProject = async () => {
      const [row, visitCount, openCount, openedRows] = await Promise.all([
        prisma.tenantUser.findUnique({
          where: { projectId_tgUserId: { projectId, tgUserId: userId } },
          select: { username: true, firstName: true, lastName: true, createdAt: true, lastSeenAt: true }
        }),
        prisma.event.count({ where: { projectId, userId, type: "IMPRESSION" } }),
        prisma.event.count({ where: { projectId, userId, type: "OPEN", assetId: { not: null } } }),
        prisma.event.findMany({
          where: { projectId, userId, type: "OPEN", assetId: { not: null } },
          distinct: ["assetId"],
          select: { assetId: true }
        })
      ]);
      return { row, visitCount, openCount, openedRows };
    };
    const queryByTenant = async () => {
      const [row, visitCount, openCount, openedRows] = await Promise.all([
        prisma.tenantUser.findUnique({
          where: { tenantId_tgUserId: { tenantId: projectId, tgUserId: userId } },
          select: { username: true, firstName: true, lastName: true, createdAt: true, lastSeenAt: true }
        }),
        prisma.event.count({ where: { tenantId: projectId, userId, type: "IMPRESSION" } }),
        prisma.event.count({ where: { tenantId: projectId, userId, type: "OPEN", assetId: { not: null } } }),
        prisma.event.findMany({
          where: { tenantId: projectId, userId, type: "OPEN", assetId: { not: null } },
          distinct: ["assetId"],
          select: { assetId: true }
        })
      ]);
      return { row, visitCount, openCount, openedRows };
    };
    let result = await queryByProject().catch(() => null);
    if (!result || (!result.row && result.visitCount === 0 && result.openCount === 0 && result.openedRows.length === 0)) {
      result = await queryByTenant();
    }
    const { row, visitCount, openCount, openedRows } = result;
    const username = row?.username?.trim().replace(/^@+/, "");
    const fullName = [row?.firstName?.trim(), row?.lastName?.trim()].filter(Boolean).join(" ");
    const displayName = username ? `@${username}` : fullName || null;
    const activatedAt = row?.createdAt ?? null;
    const lastSeenAt = row?.lastSeenAt ?? null;
    const activeDays = activatedAt ? Math.max(1, Math.floor((Date.now() - activatedAt.getTime()) / (24 * 60 * 60 * 1000)) + 1) : 0;
    return {
      displayName,
      activatedAt,
      lastSeenAt,
      activeDays,
      visitCount,
      openCount,
      openedShares: openedRows.length
    };
  };
};

export const createGetProjectAssetAccess = ({ prisma, isProjectMemberSafe, canManageProjectSafe }: DeliveryAssetAccessDeps) => {
  return async (projectId: string, userId: string, assetId: string) => {
    const asset =
      (await prisma.asset.findFirst({
        where: { id: assetId, projectId },
        select: { id: true, visibility: true }
      })) ??
      (await prisma.asset.findFirst({
        where: { id: assetId, tenantId: projectId },
        select: { id: true, visibility: true }
      }));
    if (!asset) {
      return { status: "missing" as const };
    }
    if (asset.visibility === "PUBLIC" || asset.visibility === "PROTECTED") {
      return { status: "ok" as const, asset };
    }
    const isProjectMember = await isProjectMemberSafe(userId);
    if (!isProjectMember) {
      return { status: "forbidden" as const };
    }
    const [isAdmin, owned] = await Promise.all([
      canManageProjectSafe(userId),
      prisma.uploadBatch.findFirst({
        where: { projectId, assetId, userId, status: "COMMITTED" },
        select: { id: true }
      }).then((row) => row ?? null).catch(() => null)
    ]);
    const fallbackOwned =
      owned ??
      (await prisma.uploadBatch.findFirst({
        where: { tenantId: projectId, assetId, userId, status: "COMMITTED" },
        select: { id: true }
      }));
    if (!isAdmin && !fallbackOwned) {
      return { status: "forbidden" as const };
    }
    return { status: "ok" as const, asset };
  };
};

export const createProjectAssetAccess = createGetProjectAssetAccess;
export const createGetTenantAssetAccess = createGetProjectAssetAccess;
export const createProjectUserProfileSummary = createGetUserProfileSummary;

export const buildIdentityService = ({
  selectReplicas,
  resolveShareCode,
  upsertProjectUserFromTelegram,
  upsertTenantUserFromTelegram,
  getProjectUserLabel,
  getUserProfileSummary,
  trackOpen,
  trackVisit,
  isProjectMember,
  canManageProject
}: IdentityServiceDeps): DeliveryIdentityService => {
  return {
    selectReplicas,
    resolveShareCode,
    upsertProjectUserFromTelegram,
    upsertTenantUserFromTelegram,
    getProjectUserLabel,
    getUserProfileSummary,
    trackOpen,
    trackVisit,
    isProjectMember,
    canManageProject,
    canManageProjectAdmins: canManageProject,
    canManageProjectCollections: canManageProject
  };
};

export const buildProjectIdentityService = buildIdentityService;

export const buildDiscoveryService = (deps: DeliveryDiscoveryService): DeliveryDiscoveryService => {
  return deps;
};

export const buildProjectDiscoveryService = buildDiscoveryService;

export const buildSocialService = (deps: DeliverySocialService): DeliverySocialService => {
  return deps;
};

export const buildProjectSocialService = buildSocialService;
