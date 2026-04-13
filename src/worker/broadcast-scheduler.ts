import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";
import { startIntervalScheduler } from "./orchestration";

type BroadcastQueueLike = Pick<Queue, "add">;

export const startBroadcastScheduler = (deps: {
  prisma: PrismaClient;
  broadcastQueue: BroadcastQueueLike | null;
  runBroadcast: (broadcastId: string, runId: string) => Promise<void>;
  logError: (meta: { op: string; broadcastId?: string; runId?: string }, error: unknown) => void;
}) => {
  let schedulerRunning = false;

  const tick = async () => {
    if (schedulerRunning) {
      return;
    }
    schedulerRunning = true;
    try {
      const now = new Date();
      const due = await deps.prisma.broadcast.findMany({
        where: { status: "SCHEDULED", nextRunAt: { lte: now } },
        orderBy: { nextRunAt: "asc" },
        take: 10
      });
      for (const item of due) {
        const run = await deps.prisma.$transaction(async (tx) => {
          const locked = await tx.broadcast.updateMany({
            where: { id: item.id, status: "SCHEDULED", nextRunAt: { lte: now } },
            data: { status: "RUNNING" }
          });
          if (locked.count === 0) {
            return null;
          }
          return tx.broadcastRun.create({
            data: { broadcastId: item.id, targetCount: 0, successCount: 0, failedCount: 0, blockedCount: 0 }
          });
        });
        if (!run) {
          continue;
        }
        try {
          if (deps.broadcastQueue) {
            await deps.broadcastQueue.add(
              "run",
              { broadcastId: item.id, runId: run.id },
              { jobId: `broadcast:${item.id}:${run.id}`, attempts: 1, removeOnComplete: true, removeOnFail: 100 }
            );
          } else {
            await deps.runBroadcast(item.id, run.id);
          }
        } catch (error) {
          deps.logError({ op: "broadcast_schedule_dispatch", broadcastId: item.id, runId: run.id }, error);
          await deps.prisma.broadcast
            .update({ where: { id: item.id }, data: { status: "SCHEDULED" } })
            .catch((dbError) => deps.logError({ op: "broadcast_schedule_rollback", broadcastId: item.id, runId: run.id }, dbError));
          await deps.prisma.broadcastRun
            .update({ where: { id: run.id }, data: { failedCount: 1, finishedAt: new Date() } })
            .catch((dbError) => deps.logError({ op: "broadcast_run_mark_failed", broadcastId: item.id, runId: run.id }, dbError));
        }
      }
    } finally {
      schedulerRunning = false;
    }
  };

  return startIntervalScheduler(5000, tick, (error) => deps.logError({ op: "broadcast_scheduler_tick" }, error));
};
