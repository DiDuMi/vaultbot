import { registerTenantCallbackRoutes as registerProjectCallbackRoutesImpl } from "../tenant/callbacks";

export const registerProjectCallbackRoutes = (
  ...args: Parameters<typeof registerProjectCallbackRoutesImpl>
): ReturnType<typeof registerProjectCallbackRoutesImpl> => registerProjectCallbackRoutesImpl(...args);
