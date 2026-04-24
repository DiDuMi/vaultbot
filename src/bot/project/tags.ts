import { createTagRenderers as createProjectTagRenderersImpl } from "../tenant/tags";

export const createProjectTagRenderers = (
  ...args: Parameters<typeof createProjectTagRenderersImpl>
): ReturnType<typeof createProjectTagRenderersImpl> => createProjectTagRenderersImpl(...args);
