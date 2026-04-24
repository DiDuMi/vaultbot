import { createHistoryRenderer as createProjectHistoryRendererImpl } from "../tenant/history";

export const createProjectHistoryRenderer = (
  ...args: Parameters<typeof createProjectHistoryRendererImpl>
): ReturnType<typeof createProjectHistoryRendererImpl> => createProjectHistoryRendererImpl(...args);

export { createProjectHistoryRenderer as createHistoryRenderer };
