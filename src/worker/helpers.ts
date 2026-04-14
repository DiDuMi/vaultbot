import type { PrismaClient } from "@prisma/client";
import type { Bot } from "grammy";
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

export const getBroadcastTargetUserIds = async (prisma: PrismaClient, tenantId: string) => {
  const [users, members] = await Promise.all([
    prisma.event.groupBy({ by: ["userId"], where: { tenantId } }),
    prisma.tenantMember.findMany({ where: { tenantId }, select: { tgUserId: true } })
  ]);
  const excluded = new Set(members.map((m) => m.tgUserId));
  return users.map((u) => u.userId).filter((id) => !excluded.has(id));
};

export const computeNextBroadcastRunAt = (input: { previousNextRunAt: Date | null; repeatEveryMs: number; now?: Date }) => {
  const nowMs = (input.now ?? new Date()).getTime();
  const baseMs = input.previousNextRunAt?.getTime() ?? nowMs;
  let nextMs = baseMs + input.repeatEveryMs;
  while (nextMs <= nowMs) {
    nextMs += input.repeatEveryMs;
  }
  return new Date(nextMs);
};

export const ensureTenantId = async (prisma: PrismaClient, config: { tenantCode: string; tenantName: string }) => {
  const tenant = await prisma.tenant.upsert({
    where: { code: config.tenantCode },
    update: { name: config.tenantName },
    create: { code: config.tenantCode, name: config.tenantName }
  });
  return tenant.id;
};

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

export const backfillTenantUsers = async (bot: Bot, prisma: PrismaClient, tenantId: string) => {
  const limit = (() => {
    const raw = Number(process.env.SYNC_USERS_LIMIT ?? "");
    if (!Number.isFinite(raw)) {
      return 300;
    }
    return Math.max(1, Math.min(2000, Math.trunc(raw)));
  })();

  const [eventUsers, commentUsers, batchUsers, members, existingUsers] = await Promise.all([
    prisma.event.groupBy({ by: ["userId"], where: { tenantId } }),
    prisma.assetComment.groupBy({ by: ["authorUserId"], where: { tenantId } }),
    prisma.uploadBatch.groupBy({ by: ["userId"], where: { tenantId } }),
    prisma.tenantMember.findMany({ where: { tenantId }, select: { tgUserId: true } }),
    prisma.tenantUser.findMany({ where: { tenantId }, select: { tgUserId: true } })
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
        where: { tenantId_tgUserId: { tenantId, tgUserId: id } },
        update: { username, firstName, lastName, lastSeenAt: now },
        create: {
          tenantId,
          tgUserId: id,
          username,
          firstName,
          lastName,
          languageCode: null,
          isBot: false,
          lastSeenAt: now
        }
      })
      .catch((error) => logWorkerError({ op: "tenant_user_upsert", tenantId, scope: `tgUserId:${id}` }, error));
    await sleep(200);
  }
};
