import type { PrismaClient } from "@prisma/client";

export const listProjectVaultBindings = (prisma: PrismaClient, projectId: string) =>
  prisma.tenantVaultBinding.findMany({
    where: { tenantId: projectId, role: { in: ["PRIMARY", "BACKUP"] } },
    include: { vaultGroup: true },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }]
  });

export const ensureProjectPrimaryVaultBinding = async (
  prisma: PrismaClient,
  projectId: string,
  configuredChatId: bigint
) => {
  const createdGroup = await prisma.vaultGroup.upsert({
    where: { tenantId_chatId: { tenantId: projectId, chatId: configuredChatId } },
    update: {},
    create: { tenantId: projectId, chatId: configuredChatId }
  });
  await prisma.tenantVaultBinding.upsert({
    where: { tenantId_vaultGroupId_role: { tenantId: projectId, vaultGroupId: createdGroup.id, role: "PRIMARY" } },
    update: {},
    create: { tenantId: projectId, vaultGroupId: createdGroup.id, role: "PRIMARY" }
  });
  return prisma.tenantVaultBinding.findUnique({
    where: { tenantId_vaultGroupId_role: { tenantId: projectId, vaultGroupId: createdGroup.id, role: "PRIMARY" } },
    include: { vaultGroup: true }
  });
};

export const findProjectTopic = (
  prisma: PrismaClient,
  input: { projectId: string; vaultGroupId: string; collectionId: string }
) =>
  prisma.tenantTopic.findFirst({
    where: { tenantId: input.projectId, vaultGroupId: input.vaultGroupId, collectionId: input.collectionId, version: 1 }
  });

export const upsertProjectTopicThreadId = (
  prisma: PrismaClient,
  input: { projectId: string; vaultGroupId: string; collectionId: string; threadId: number }
) =>
  prisma.tenantTopic.upsert({
    where: {
      tenantId_vaultGroupId_collectionId_version: {
        tenantId: input.projectId,
        vaultGroupId: input.vaultGroupId,
        collectionId: input.collectionId,
        version: 1
      }
    },
    update: { messageThreadId: BigInt(input.threadId) },
    create: {
      tenantId: input.projectId,
      vaultGroupId: input.vaultGroupId,
      collectionId: input.collectionId,
      messageThreadId: BigInt(input.threadId),
      version: 1
    }
  });

export const getProjectSettingValue = async (prisma: PrismaClient, projectId: string, key: string) =>
  (await prisma.tenantSetting
    .findUnique({
      where: { projectId_key: { projectId, key } },
      select: { value: true }
    })
    .then((row) => row?.value ?? null)
    .catch(() => null)) ??
  (await prisma.tenantSetting
    .findUnique({
      where: { tenantId_key: { tenantId: projectId, key } },
      select: { value: true }
    })
    .then((row) => row?.value ?? null)
    .catch(() => null));

export const getProjectMinReplicasSetting = (prisma: PrismaClient, projectId: string) =>
  getProjectSettingValue(prisma, projectId, "min_replicas");
