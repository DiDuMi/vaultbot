export const parseHeartbeatAgoMin = (raw: string | null, nowMs = Date.now()) => {
  const heartbeatMs = raw ? Number(raw) : NaN;
  if (!Number.isFinite(heartbeatMs)) {
    return null;
  }
  return Math.max(0, Math.floor((nowMs - heartbeatMs) / 60_000));
};

export const buildWorkerHeartbeatLines = (input: { processRaw: string | null; replicationRaw: string | null; nowMs?: number }) => {
  const processAgoMin = parseHeartbeatAgoMin(input.processRaw, input.nowMs);
  const replicationAgoMin = parseHeartbeatAgoMin(input.replicationRaw, input.nowMs);
  const processLine =
    processAgoMin === null ? "Worker 进程心跳：暂无" : `Worker 进程心跳：${processAgoMin} 分钟前`;
  const replicationLine =
    replicationAgoMin === null
      ? "副本任务心跳：暂无（近期无任务或未上报）"
      : `副本任务心跳：${replicationAgoMin} 分钟前`;
  return { processAgoMin, replicationAgoMin, processLine, replicationLine };
};
