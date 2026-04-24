import { createTenantRenderers as createProjectRenderersImpl } from "../tenant/renderers";

export const createProjectRenderers = (...args: Parameters<typeof createProjectRenderersImpl>): ReturnType<typeof createProjectRenderersImpl> =>
  createProjectRenderersImpl(...args);
