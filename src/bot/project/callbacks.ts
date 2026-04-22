import { registerTenantCallbackRoutes } from "../tenant/callbacks";

export const registerProjectCallbackRoutes = (
  ...args: Parameters<typeof registerTenantCallbackRoutes>
): ReturnType<typeof registerTenantCallbackRoutes> => registerTenantCallbackRoutes(...args);
