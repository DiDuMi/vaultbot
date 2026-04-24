import { createTenantSocial as createProjectSocialImpl } from "../tenant/social";

export const createProjectSocial = (
  ...args: Parameters<typeof createProjectSocialImpl>
): ReturnType<typeof createProjectSocialImpl> => createProjectSocialImpl(...args);
