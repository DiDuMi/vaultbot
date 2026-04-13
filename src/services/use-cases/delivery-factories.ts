import type { PrismaClient } from "@prisma/client";
import type {
  DeliveryDiscoveryService,
  DeliveryIdentityService,
  DeliverySocialService
} from "./delivery";

type DeliveryUserSummaryDeps = {
  prisma: PrismaClient;
  getTenantId: () => Promise<string>;
};

type DeliveryAssetAccessDeps = {
  prisma: PrismaClient;
  isTenantUserSafe: (userId: string) => Promise<boolean>;
};

type IdentityServiceDeps = {
  selectReplicas: DeliveryIdentityService["selectReplicas"];
  resolveShareCode: DeliveryIdentityService["resolveShareCode"];
  upsertTenantUserFromTelegram: DeliveryIdentityService["upsertTenantUserFromTelegram"];
  getTenantUserLabel: DeliveryIdentityService["getTenantUserLabel"];
  getUserProfileSummary: DeliveryIdentityService["getUserProfileSummary"];
  trackOpen: DeliveryIdentityService["trackOpen"];
  trackVisit: DeliveryIdentityService["trackVisit"];
  isTenantUser: DeliveryIdentityService["isTenantUser"];
  isTenantAdmin: DeliveryIdentityService["canManageAdmins"];
};

export const createGetUserProfileSummary = ({
  prisma,
  getTenantId
}: DeliveryUserSummaryDeps): DeliveryIdentityService["getUserProfileSummary"] => {
  return async (userId) => {
    const tenantId = await getTenantId();
    const [row, visitCount, openCount, openedRows] = await Promise.all([
      prisma.tenantUser.findUnique({
        where: { tenantId_tgUserId: { tenantId, tgUserId: userId } },
        select: { username: true, firstName: true, lastName: true, createdAt: true, lastSeenAt: true }
      }),
      prisma.event.count({ where: { tenantId, userId, type: "IMPRESSION" } }),
      prisma.event.count({ where: { tenantId, userId, type: "OPEN", assetId: { not: null } } }),
      prisma.event.findMany({
        where: { tenantId, userId, type: "OPEN", assetId: { not: null } },
        distinct: ["assetId"],
        select: { assetId: true }
      })
    ]);
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

export const createGetTenantAssetAccess = ({ prisma, isTenantUserSafe }: DeliveryAssetAccessDeps) => {
  return async (tenantId: string, userId: string, assetId: string) => {
    const asset = await prisma.asset.findFirst({
      where: { id: assetId, tenantId },
      select: { id: true, visibility: true }
    });
    if (!asset) {
      return { status: "missing" as const };
    }
    if (asset.visibility !== "RESTRICTED") {
      return { status: "ok" as const, asset };
    }
    const isTenant = await isTenantUserSafe(userId);
    if (!isTenant) {
      return { status: "forbidden" as const };
    }
    return { status: "ok" as const, asset };
  };
};

export const buildIdentityService = ({
  selectReplicas,
  resolveShareCode,
  upsertTenantUserFromTelegram,
  getTenantUserLabel,
  getUserProfileSummary,
  trackOpen,
  trackVisit,
  isTenantUser,
  isTenantAdmin
}: IdentityServiceDeps): DeliveryIdentityService => {
  return {
    selectReplicas,
    resolveShareCode,
    upsertTenantUserFromTelegram,
    getTenantUserLabel,
    getUserProfileSummary,
    trackOpen,
    trackVisit,
    isTenantUser,
    canManageAdmins: isTenantAdmin,
    canManageCollections: isTenantAdmin
  };
};

export const buildDiscoveryService = (deps: DeliveryDiscoveryService): DeliveryDiscoveryService => {
  return deps;
};

export const buildSocialService = (deps: DeliverySocialService): DeliverySocialService => {
  return deps;
};
