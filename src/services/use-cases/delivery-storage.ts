import type { PrismaClient } from "@prisma/client";
import { logError } from "../../infra/logging";

export const createDeliveryStorage = (prisma: PrismaClient, getRuntimeProjectId: () => Promise<string>) => {
  const getPreference = async (tgUserId: string, key: string) => {
    const projectId = await getRuntimeProjectId();
    const row =
      (await prisma.userPreference.findUnique({
        where: { projectId_tgUserId_key: { projectId, tgUserId, key } },
        select: { value: true }
      })) ??
      (await prisma.userPreference.findUnique({
        where: { tenantId_tgUserId_key: { tenantId: projectId, tgUserId, key } },
        select: { value: true }
      }));
    return row?.value ?? null;
  };

  const upsertPreference = async (tgUserId: string, key: string, value: string | null) => {
    const projectId = await getRuntimeProjectId();
    await prisma.userPreference.upsert({
      where: { tenantId_tgUserId_key: { tenantId: projectId, tgUserId, key } },
      update: { projectId, value },
      create: { tenantId: projectId, projectId, tgUserId, key, value }
    });
  };

  const deletePreference = async (tgUserId: string, key: string) => {
    const projectId = await getRuntimeProjectId();
    await prisma.userPreference
      .delete({
        where: { tenantId_tgUserId_key: { tenantId: projectId, tgUserId, key } }
      })
      .catch((error) => logError({ component: "delivery_storage", op: "delete_preference", projectId, tgUserId, key }, error));
  };

  const getSetting = async (key: string) => {
    const projectId = await getRuntimeProjectId();
    const row =
      (await prisma.tenantSetting.findUnique({
        where: { projectId_key: { projectId, key } },
        select: { value: true }
      })) ??
      (await prisma.tenantSetting.findUnique({
        where: { tenantId_key: { tenantId: projectId, key } },
        select: { value: true }
      }));
    return row?.value ?? null;
  };

  const upsertSetting = async (key: string, value: string | null) => {
    const projectId = await getRuntimeProjectId();
    await prisma.tenantSetting.upsert({
      where: { tenantId_key: { tenantId: projectId, key } },
      update: { projectId, value },
      create: { tenantId: projectId, projectId, key, value }
    });
  };

  const deleteSetting = async (key: string) => {
    const projectId = await getRuntimeProjectId();
    await prisma.tenantSetting
      .delete({
        where: { tenantId_key: { tenantId: projectId, key } }
      })
      .catch((error) => logError({ component: "delivery_storage", op: "delete_setting", projectId, key }, error));
  };

  return { getPreference, upsertPreference, deletePreference, getSetting, upsertSetting, deleteSetting };
};
