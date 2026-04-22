import { createTenantSocial } from "../tenant/social";

export const createProjectSocial = (
  ...args: Parameters<typeof createTenantSocial>
): ReturnType<typeof createTenantSocial> => createTenantSocial(...args);
