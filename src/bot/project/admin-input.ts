import { createTenantAdminInput } from "../tenant/admin-input";

export const createProjectAdminInput = (
  ...args: Parameters<typeof createTenantAdminInput>
): ReturnType<typeof createTenantAdminInput> => createTenantAdminInput(...args);
