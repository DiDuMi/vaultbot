import { registerTenantCommands } from "../tenant/register-commands";

export const registerProjectCommands = (...args: Parameters<typeof registerTenantCommands>): ReturnType<typeof registerTenantCommands> =>
  registerTenantCommands(...args);
