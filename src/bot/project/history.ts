import { createHistoryRenderer } from "../tenant/history";

export const createProjectHistoryRenderer = (
  ...args: Parameters<typeof createHistoryRenderer>
): ReturnType<typeof createHistoryRenderer> => createHistoryRenderer(...args);
