import { registerTenantMiddlewares } from "../tenant/register-middlewares";

export const registerProjectMiddlewares = (
  ...args: Parameters<typeof registerTenantMiddlewares>
): ReturnType<typeof registerTenantMiddlewares> => registerTenantMiddlewares(...args);
