import type { PrismaClient } from "@prisma/client";
import { logError } from "../../infra/logging";

export const createDeliveryStorage = (prisma: PrismaClient, getTenantId: () => Promise<string>) => {
  const getPreference = async (tgUserId: string, key: string) => {
    const tenantId = await getTenantId();
    const row = await prisma.userPreference.findUnique({
      where: { tenantId_tgUserId_key: { tenantId, tgUserId, key } },
      select: { value: true }
    });
    return row?.value ?? null;
  };

  const upsertPreference = async (tgUserId: string, key: string, value: string | null) => {
    const tenantId = await getTenantId();
    await prisma.userPreference.upsert({
      where: { tenantId_tgUserId_key: { tenantId, tgUserId, key } },
      update: { value },
      create: { tenantId, tgUserId, key, value }
    });
  };

  const deletePreference = async (tgUserId: string, key: string) => {
    const tenantId = await getTenantId();
    await prisma.userPreference
      .delete({
        where: { tenantId_tgUserId_key: { tenantId, tgUserId, key } }
      })
      .catch((error) => logError({ component: "delivery_storage", op: "delete_preference", tenantId, tgUserId, key }, error));
  };

  const getSetting = async (key: string) => {
    const tenantId = await getTenantId();
    const row = await prisma.tenantSetting.findUnique({
      where: { tenantId_key: { tenantId, key } },
      select: { value: true }
    });
    return row?.value ?? null;
  };

  const upsertSetting = async (key: string, value: string | null) => {
    const tenantId = await getTenantId();
    await prisma.tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key } },
      update: { value },
      create: { tenantId, key, value }
    });
  };

  const deleteSetting = async (key: string) => {
    const tenantId = await getTenantId();
    await prisma.tenantSetting
      .delete({
        where: { tenantId_key: { tenantId, key } }
      })
      .catch((error) => logError({ component: "delivery_storage", op: "delete_setting", tenantId, key }, error));
  };

  return { getPreference, upsertPreference, deletePreference, getSetting, upsertSetting, deleteSetting };
};
