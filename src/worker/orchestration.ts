export const startIntervalScheduler = (intervalMs: number, tick: () => Promise<void>, onError: (error: unknown) => void) => {
  return setInterval(() => {
    tick().catch(onError);
  }, intervalMs);
};
