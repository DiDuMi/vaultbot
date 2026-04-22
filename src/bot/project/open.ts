import { createOpenHandler } from "../tenant/open";

export const createProjectOpenHandler = (
  ...args: Parameters<typeof createOpenHandler>
): ReturnType<typeof createOpenHandler> => createOpenHandler(...args);
