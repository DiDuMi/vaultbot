import type { PrismaClient } from "@prisma/client";

export const upsertTenantSetting = async (prisma: PrismaClient, tenantId: string, key: string, value: string) => {
  await prisma.tenantSetting.upsert({
    where: { tenantId_key: { tenantId, key } },
    update: { value },
    create: { tenantId, key, value }
  });
};

export const upsertWorkerProcessHeartbeat = async (prisma: PrismaClient, tenantId: string, now: number) => {
  await upsertTenantSetting(prisma, tenantId, "worker_heartbeat", String(now));
};

export const upsertWorkerReplicationHeartbeat = async (prisma: PrismaClient, tenantId: string, now: number) => {
  await upsertTenantSetting(prisma, tenantId, "worker_replication_heartbeat", String(now));
};
