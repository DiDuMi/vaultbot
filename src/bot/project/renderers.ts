import { createTenantRenderers } from "../tenant/renderers";

export const createProjectRenderers = (...args: Parameters<typeof createTenantRenderers>): ReturnType<typeof createTenantRenderers> =>
  createTenantRenderers(...args);
