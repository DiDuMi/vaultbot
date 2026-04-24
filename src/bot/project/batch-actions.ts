import { createBatchActions as createProjectBatchActionsImpl } from "../tenant/batch-actions";

export const createProjectBatchActions = (
  ...args: Parameters<typeof createProjectBatchActionsImpl>
): ReturnType<typeof createProjectBatchActionsImpl> => createProjectBatchActionsImpl(...args);

export { createProjectBatchActions as createBatchActions };
