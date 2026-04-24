import { registerTenantCommands as registerProjectCommandsImpl } from "../tenant/register-commands";

export const registerProjectCommands = (...args: Parameters<typeof registerProjectCommandsImpl>): ReturnType<typeof registerProjectCommandsImpl> =>
  registerProjectCommandsImpl(...args);
