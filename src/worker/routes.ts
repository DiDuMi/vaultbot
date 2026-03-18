type QueueJob = { name?: string; data?: Record<string, unknown> };

export const createWorkerRoutes = (deps: {
  replicateBatch: (batchId: string) => Promise<void>;
  runBroadcast: (broadcastId: string, runId: string) => Promise<void>;
  runFollowKeywordNotify: (assetId: string) => Promise<void>;
}) => {
  const replicationRoute = async (job: QueueJob) => {
    const batchId = typeof job.data?.batchId === "string" ? job.data.batchId : "";
    if (!batchId) {
      return;
    }
    await deps.replicateBatch(batchId);
  };

  const broadcastRoute = async (job: QueueJob) => {
    const broadcastId = typeof job.data?.broadcastId === "string" ? job.data.broadcastId : "";
    const runId = typeof job.data?.runId === "string" ? job.data.runId : "";
    if (!broadcastId || !runId) {
      return;
    }
    await deps.runBroadcast(broadcastId, runId);
  };

  const notifyRoute = async (job: QueueJob) => {
    if (job.name !== "follow_keyword") {
      return;
    }
    const assetId = typeof job.data?.assetId === "string" ? job.data.assetId : "";
    if (!assetId) {
      return;
    }
    await deps.runFollowKeywordNotify(assetId);
  };

  return { replicationRoute, broadcastRoute, notifyRoute };
};
