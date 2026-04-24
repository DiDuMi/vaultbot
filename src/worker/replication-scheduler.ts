import type { PrismaClient } from "@prisma/client";
import { startIntervalScheduler } from "./orchestration";
import { resolveProjectScopeId } from "./helpers";

type QueueLike = {
  add: (
    name: string,
    data: { batchId: string },
    options: { jobId: string; priority: number; attempts: number; removeOnComplete: true; removeOnFail: number }
  ) => Promise<unknown>;
};

export const startReplicationScheduler = (deps: {
  prisma: PrismaClient;
  runtimeProjectId: string;
  replicationQueue: QueueLike | null;
  replicationBackfillQueue: QueueLike | null;
  replicateBatch: (batchId: string, options?: { includeOptional?: boolean }) => Promise<void>;
  upsertWorkerProcessHeartbeat: (projectId: string, ts: number) => Promise<void>;
  upsertWorkerReplicationHeartbeat: (projectId: string, ts: number) => Promise<void>;
  parseNumberWithBounds: (raw: string | undefined, fallback: number, min: number, max: number) => number;
  logError: (meta: { op: string; projectId?: string; batchId?: string }, error: unknown) => void;
}) => {
  const replicationEnqueuedAt = new Map<string, number>();
  const replicationEnqueuedTtlMs = deps.parseNumberWithBounds(
    process.env.REPLICATION_ENQUEUED_TTL_MS,
    60 * 60 * 1000,
    60_000,
    24 * 60 * 60 * 1000
  );
  const replicationBackfillEnabled = process.env.REPLICATION_BACKFILL_ENABLED !== "0";
  const replicationBackfillTake = deps.parseNumberWithBounds(process.env.REPLICATION_BACKFILL_TAKE, 5, 0, 50);
  const replicationEnqueuedMaxSize = deps.parseNumberWithBounds(
    process.env.REPLICATION_ENQUEUED_MAX_SIZE,
    20_000,
    1000,
    200_000
  );
  const replicationMetricsLogIntervalMs = deps.parseNumberWithBounds(
    process.env.REPLICATION_METRICS_LOG_INTERVAL_MS,
    60_000,
    5_000,
    3_600_000
  );
  let replicationTtlEvictions = 0;
  let replicationCapEvictions = 0;
  let lastReplicationMetricsLogAt = Date.now();
  let backfillOffset = 0;

  const flushReplicationMetrics = (now: number) => {
    if (now - lastReplicationMetricsLogAt < replicationMetricsLogIntervalMs) {
      return;
    }
    const hasChanges = replicationTtlEvictions > 0 || replicationCapEvictions > 0;
    if (hasChanges) {
      console.info(
        JSON.stringify({
          level: "info",
          at: new Date(now).toISOString(),
          component: "worker",
          op: "replication_enqueued_cleanup",
          mapSize: replicationEnqueuedAt.size,
          ttlEvictions: replicationTtlEvictions,
          capEvictions: replicationCapEvictions
        })
      );
      replicationTtlEvictions = 0;
      replicationCapEvictions = 0;
    }
    lastReplicationMetricsLogAt = now;
  };

  const cleanupReplicationEnqueuedAt = (now: number) => {
    for (const [batchId, ts] of replicationEnqueuedAt) {
      if (now - ts > replicationEnqueuedTtlMs) {
        replicationEnqueuedAt.delete(batchId);
        replicationTtlEvictions += 1;
      }
    }
    while (replicationEnqueuedAt.size > replicationEnqueuedMaxSize) {
      const oldest = replicationEnqueuedAt.keys().next();
      if (oldest.done) {
        break;
      }
      replicationEnqueuedAt.delete(oldest.value);
      replicationCapEvictions += 1;
    }
    flushReplicationMetrics(now);
  };

  const tick = async () => {
    const now = Date.now();
    cleanupReplicationEnqueuedAt(now);
    await deps.upsertWorkerProcessHeartbeat(deps.runtimeProjectId, now).catch((error) =>
      deps.logError({ op: "heartbeat_process_upsert", projectId: deps.runtimeProjectId }, error)
    );
    const batches = await deps.prisma.uploadBatch.findMany({
      where: { status: "COMMITTED", items: { some: { status: { in: ["PENDING", "FAILED"] } } } },
      take: 10,
      orderBy: { createdAt: "desc" },
      select: { id: true, tenantId: true, projectId: true }
    });
    const replicationHeartbeatProjectIds = new Set<string>();
    for (const batch of batches) {
      const batchProjectId = resolveProjectScopeId({ projectId: batch.projectId, tenantId: batch.tenantId });
      const last = replicationEnqueuedAt.get(batch.id) ?? 0;
      if (now - last < 10_000) {
        continue;
      }
      replicationEnqueuedAt.set(batch.id, now);
      if (deps.replicationQueue) {
        const enqueued = await deps.replicationQueue
          .add(
            "replicate_required",
            { batchId: batch.id },
            { jobId: `replicate:poll:${batch.id}:${now}`, priority: 50, attempts: 1, removeOnComplete: true, removeOnFail: 100 }
          )
          .then(() => true)
          .catch((error) => {
            deps.logError({ op: "replication_enqueue_poll", projectId: batchProjectId, batchId: batch.id }, error);
            return false;
          });
        if (enqueued) {
          replicationHeartbeatProjectIds.add(batchProjectId);
        }
      } else {
        const replicated = await deps.replicateBatch(batch.id, { includeOptional: false })
          .then(() => true)
          .catch((error) => {
            deps.logError({ op: "replication_direct_poll", projectId: batchProjectId, batchId: batch.id }, error);
            return false;
          });
        if (replicated) {
          replicationHeartbeatProjectIds.add(batchProjectId);
        }
      }
    }

    if (!replicationBackfillEnabled || replicationBackfillTake <= 0 || batches.length > 0) {
      for (const projectId of replicationHeartbeatProjectIds) {
        await deps.upsertWorkerReplicationHeartbeat(projectId, now).catch((error) =>
          deps.logError({ op: "heartbeat_replication_upsert", projectId }, error)
        );
      }
      return;
    }

    const backfill = await deps.prisma.uploadBatch.findMany({
      where: { status: "COMMITTED" },
      orderBy: { createdAt: "desc" },
      take: replicationBackfillTake,
      skip: backfillOffset,
      select: { id: true, tenantId: true, projectId: true }
    });
    backfillOffset += backfill.length;
    if (backfill.length < replicationBackfillTake) {
      backfillOffset = 0;
    }
    for (const batch of backfill) {
      const batchProjectId = resolveProjectScopeId({ projectId: batch.projectId, tenantId: batch.tenantId });
      const last = replicationEnqueuedAt.get(batch.id) ?? 0;
      if (now - last < 10_000) {
        continue;
      }
      replicationEnqueuedAt.set(batch.id, now);
      if (deps.replicationBackfillQueue) {
        const enqueued = await deps.replicationBackfillQueue
          .add(
            "replicate_backfill",
            { batchId: batch.id },
            { jobId: `replicate:backfill:${batch.id}:${now}`, priority: 100, attempts: 1, removeOnComplete: true, removeOnFail: 100 }
          )
          .then(() => true)
          .catch((error) => {
            deps.logError({ op: "replication_enqueue_backfill", projectId: batchProjectId, batchId: batch.id }, error);
            return false;
          });
        if (enqueued) {
          replicationHeartbeatProjectIds.add(batchProjectId);
        }
      } else if (deps.replicationQueue) {
        const enqueued = await deps.replicationQueue
          .add(
            "replicate_backfill",
            { batchId: batch.id },
            { jobId: `replicate:backfill:${batch.id}:${now}`, priority: 100, attempts: 1, removeOnComplete: true, removeOnFail: 100 }
          )
          .then(() => true)
          .catch((error) => {
            deps.logError({ op: "replication_enqueue_backfill", projectId: batchProjectId, batchId: batch.id }, error);
            return false;
          });
        if (enqueued) {
          replicationHeartbeatProjectIds.add(batchProjectId);
        }
      } else {
        const replicated = await deps.replicateBatch(batch.id, { includeOptional: true })
          .then(() => true)
          .catch((error) => {
            deps.logError({ op: "replication_direct_backfill", projectId: batchProjectId, batchId: batch.id }, error);
            return false;
          });
        if (replicated) {
          replicationHeartbeatProjectIds.add(batchProjectId);
        }
      }
    }

    for (const projectId of replicationHeartbeatProjectIds) {
      await deps.upsertWorkerReplicationHeartbeat(projectId, now).catch((error) =>
        deps.logError({ op: "heartbeat_replication_upsert", projectId }, error)
      );
    }
  };

  return startIntervalScheduler(15000, tick, (error) => deps.logError({ op: "replication_scheduler_tick" }, error));
};
