import { createBatchActions } from "../tenant/batch-actions";

export const createProjectBatchActions = (
  ...args: Parameters<typeof createBatchActions>
): ReturnType<typeof createBatchActions> => createBatchActions(...args);
