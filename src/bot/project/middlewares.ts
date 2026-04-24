import { registerTenantMiddlewares as registerProjectMiddlewaresImpl } from "../tenant/register-middlewares";

export const registerProjectMiddlewares = (
  ...args: Parameters<typeof registerProjectMiddlewaresImpl>
): ReturnType<typeof registerProjectMiddlewaresImpl> => registerProjectMiddlewaresImpl(...args);
