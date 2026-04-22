import type { PrismaClient } from "@prisma/client";

export const upsertProjectSetting = async (prisma: PrismaClient, projectId: string, key: string, value: string) => {
  await prisma.tenantSetting.upsert({
    where: { tenantId_key: { tenantId: projectId, key } },
    update: { projectId, value },
    create: { tenantId: projectId, projectId, key, value }
  });
};

export const upsertTenantSetting = upsertProjectSetting;

export const upsertWorkerProcessHeartbeat = async (prisma: PrismaClient, projectId: string, now: number) => {
  await upsertProjectSetting(prisma, projectId, "worker_heartbeat", String(now));
};

export const upsertWorkerReplicationHeartbeat = async (prisma: PrismaClient, projectId: string, now: number) => {
  await upsertProjectSetting(prisma, projectId, "worker_replication_heartbeat", String(now));
};
