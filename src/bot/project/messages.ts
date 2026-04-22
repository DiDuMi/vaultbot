import { registerTenantMessageHandlers } from "../tenant/register-messages";

export const registerProjectMessageHandlers = (
  ...args: Parameters<typeof registerTenantMessageHandlers>
): ReturnType<typeof registerTenantMessageHandlers> => registerTenantMessageHandlers(...args);
