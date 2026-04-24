import { createOpenHandler as createProjectOpenHandlerImpl } from "../tenant/open";

export const createProjectOpenHandler = (
  ...args: Parameters<typeof createProjectOpenHandlerImpl>
): ReturnType<typeof createProjectOpenHandlerImpl> => createProjectOpenHandlerImpl(...args);

export { createProjectOpenHandler as createOpenHandler };
