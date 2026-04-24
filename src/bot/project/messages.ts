import { registerTenantMessageHandlers as registerProjectMessageHandlersImpl } from "../tenant/register-messages";

export const registerProjectMessageHandlers = (
  ...args: Parameters<typeof registerProjectMessageHandlersImpl>
): ReturnType<typeof registerProjectMessageHandlersImpl> => registerProjectMessageHandlersImpl(...args);
