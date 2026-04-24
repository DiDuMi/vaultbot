import type { PrismaClient } from "@prisma/client";
import type { Bot } from "grammy";
import { ensureRuntimeProjectContext } from "../infra/persistence/tenant-guard";
import { withTelegramRetry } from "../infra/telegram";
import { logWorkerError } from "./strategy";

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const parseNumberWithBounds = (raw: string | undefined, fallback: number, min: number, max: number) => {
  const value = Number(raw ?? "");
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
};

export const sendMediaGroupWithRetry = async (
  bot: Bot,
  chatId: string,
  album: { type: "photo" | "video"; media: string }[],
  threadId?: number
) => {
  const run = () => {
    if (threadId !== undefined) {
      return bot.api.sendMediaGroup(chatId, album, { message_thread_id: threadId });
    }
    return bot.api.sendMediaGroup(chatId, album);
  };
  return withTelegramRetry(run);
};
export const sendProjectMediaGroupWithRetry = sendMediaGroupWithRetry;

export const getProjectBroadcastTargetUserIds = async (prisma: PrismaClient, projectId: string) => {
  const [projectUsers, projectUserRows, members] = await Promise.all([
    prisma.event.groupBy({ by: ["userId"], where: { projectId } }).catch(() => []),
    prisma.tenantUser.findMany({ where: { projectId }, select: { tgUserId: true } }).catch(() => []),
    prisma.tenantMember.findMany({ where: { tenantId: projectId }, select: { tgUserId: true } })
  ]);
  const [audienceEvents, fallbackUserRows] =
    projectUsers.length > 0 || projectUserRows.length > 0
      ? [projectUsers, projectUserRows]
      : await Promise.all([
          prisma.event.groupBy({ by: ["userId"], where: { tenantId: projectId } }),
          prisma.tenantUser.findMany({ where: { tenantId: projectId }, select: { tgUserId: true } })
        ]);
  const excluded = new Set(members.map((m) => m.tgUserId));
  const audience = new Set<string>();
  for (const row of audienceEvents) {
    if (row.userId) {
      audience.add(row.userId);
    }
  }
  for (const row of fallbackUserRows) {
    if (row.tgUserId) {
      audience.add(row.tgUserId);
    }
  }
  return Array.from(audience).filter((id) => !excluded.has(id));
};

export const getBroadcastTargetUserIds = getProjectBroadcastTargetUserIds;

export const resolveProjectScopeId = (input: { projectId?: string | null; tenantId: string }) => {
  return input.projectId?.trim() || input.tenantId;
};
export const getProjectScopeId = resolveProjectScopeId;

export const getLatestProjectAssetPublisherUserId = async (prisma: PrismaClient, projectId: string, assetId: string) => {
  const projectBatch =
    (await prisma.uploadBatch
      .findFirst({
        where: { projectId, assetId, status: "COMMITTED" },
        orderBy: { createdAt: "desc" },
        select: { userId: true }
      })
      .catch(() => null)) ?? null;
  if (projectBatch?.userId) {
    return projectBatch.userId;
  }
  const fallbackBatch = await prisma.uploadBatch.findFirst({
    where: { tenantId: projectId, assetId, status: "COMMITTED" },
    orderBy: { createdAt: "desc" },
    select: { userId: true }
  });
  return fallbackBatch?.userId ?? null;
};
export const getProjectAssetPublisherUserId = getLatestProjectAssetPublisherUserId;

export const computeNextBroadcastRunAt = (input: { previousNextRunAt: Date | null; repeatEveryMs: number; now?: Date }) => {
  const nowMs = (input.now ?? new Date()).getTime();
  const baseMs = input.previousNextRunAt?.getTime() ?? nowMs;
  let nextMs = baseMs + input.repeatEveryMs;
  while (nextMs <= nowMs) {
    nextMs += input.repeatEveryMs;
  }
  return new Date(nextMs);
};
export const computeProjectNextBroadcastRunAt = computeNextBroadcastRunAt;

export const ensureRuntimeProjectId = async (prisma: PrismaClient, projectContext: { code: string; name: string }) => {
  const project = await ensureRuntimeProjectContext(prisma, projectContext);
  return project.projectId;
};
export const ensureProjectRuntimeId = ensureRuntimeProjectId;

export const isSafeTelegramNumericId = (value: string) => {
  const numericId = Number(value);
  if (!Number.isSafeInteger(numericId)) {
    return null;
  }
  if (numericId <= 0) {
    return null;
  }
  return numericId;
};
export const parseProjectTelegramUserId = isSafeTelegramNumericId;

export const backfillProjectUsers = async (bot: Bot, prisma: PrismaClient, projectId: string) => {
  const limit = (() => {
    const raw = Number(process.env.SYNC_USERS_LIMIT ?? "");
    if (!Number.isFinite(raw)) {
      return 300;
    }
    return Math.max(1, Math.min(2000, Math.trunc(raw)));
  })();

  const [projectEventUsers, projectBatchUsers, projectExistingUsers, commentUsers, members] = await Promise.all([
    prisma.event.groupBy({ by: ["userId"], where: { projectId } }).catch(() => []),
    prisma.uploadBatch.groupBy({ by: ["userId"], where: { projectId } }).catch(() => []),
    prisma.tenantUser.findMany({ where: { projectId }, select: { tgUserId: true } }).catch(() => []),
    prisma.assetComment.groupBy({ by: ["authorUserId"], where: { tenantId: projectId } }),
    prisma.tenantMember.findMany({ where: { tenantId: projectId }, select: { tgUserId: true } })
  ]);
  const [eventUsers, batchUsers, existingUsers] =
    projectEventUsers.length > 0 || projectBatchUsers.length > 0 || projectExistingUsers.length > 0
      ? [projectEventUsers, projectBatchUsers, projectExistingUsers]
      : await Promise.all([
          prisma.event.groupBy({ by: ["userId"], where: { tenantId: projectId } }),
          prisma.uploadBatch.groupBy({ by: ["userId"], where: { tenantId: projectId } }),
          prisma.tenantUser.findMany({ where: { tenantId: projectId }, select: { tgUserId: true } })
        ]);

  const existing = new Set(existingUsers.map((u) => u.tgUserId));
  const candidates = new Set<string>();
  for (const row of eventUsers) {
    candidates.add(row.userId);
  }
  for (const row of commentUsers) {
    candidates.add(row.authorUserId);
  }
  for (const row of batchUsers) {
    candidates.add(row.userId);
  }
  for (const row of members) {
    candidates.add(row.tgUserId);
  }

  const ids = Array.from(candidates)
    .filter((id) => id && !existing.has(id))
    .slice(0, limit);

  if (ids.length === 0) {
    return;
  }

  for (const id of ids) {
    const numericId = isSafeTelegramNumericId(id);
    if (numericId === null) {
      continue;
    }
    const chat = await withTelegramRetry(() => bot.api.getChat(numericId)).catch(() => null);
    const username = (chat as { username?: string | null } | null)?.username?.trim().replace(/^@+/, "") || null;
    const firstName = (chat as { first_name?: string | null } | null)?.first_name?.trim() || null;
    const lastName = (chat as { last_name?: string | null } | null)?.last_name?.trim() || null;
    const now = new Date();
    await prisma.tenantUser
      .upsert({
        where: { tenantId_tgUserId: { tenantId: projectId, tgUserId: id } },
        update: { projectId, username, firstName, lastName, lastSeenAt: now },
        create: {
          tenantId: projectId,
          projectId,
          tgUserId: id,
          username,
          firstName,
          lastName,
          languageCode: null,
          isBot: false,
          lastSeenAt: now
        }
      })
      .catch((error) => logWorkerError({ op: "project_user_upsert", projectId, scope: `tgUserId:${id}` }, error));
    await sleep(200);
  }
};

export const backfillTenantUsers = backfillProjectUsers;
export const syncProjectUsers = backfillProjectUsers;
