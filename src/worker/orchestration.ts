export const startIntervalScheduler = (intervalMs: number, tick: () => Promise<void>, onError: (error: unknown) => void) => {
  let running = false;

  return setInterval(() => {
    if (running) {
      return;
    }

    running = true;
    tick()
      .catch(onError)
      .finally(() => {
        running = false;
      });
  }, intervalMs);
};
