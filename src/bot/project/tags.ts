import { createTagRenderers } from "../tenant/tags";

export const createProjectTagRenderers = (
  ...args: Parameters<typeof createTagRenderers>
): ReturnType<typeof createTagRenderers> => createTagRenderers(...args);
