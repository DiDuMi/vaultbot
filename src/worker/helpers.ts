import type { PrismaClient } from "@prisma/client";
import type { Bot } from "grammy";
import { ensureRuntimeProjectContext } from "../infra/persistence/tenant-guard";
import { withTelegramRetry } from "../infra/telegram";
export {
  backfillProjectUsers,
  backfillTenantUsers,
  getBroadcastTargetUserIds,
  getLatestProjectAssetPublisherUserId,
  getProjectAssetPublisherUserId,
  getProjectBroadcastTargetUserIds,
  getProjectScopeId,
  isSafeTelegramNumericId,
  parseProjectTelegramUserId,
  resolveProjectScopeId,
  syncProjectUsers
} from "./project-audience";

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
