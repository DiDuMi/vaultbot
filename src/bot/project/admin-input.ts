import { createTenantAdminInput as createProjectAdminInputImpl } from "../tenant/admin-input";

export const createProjectAdminInput = (
  ...args: Parameters<typeof createProjectAdminInputImpl>
): ReturnType<typeof createProjectAdminInputImpl> => createProjectAdminInputImpl(...args);
