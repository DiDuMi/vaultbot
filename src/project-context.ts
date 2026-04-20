export type ProjectContextConfig = {
  code: string;
  name: string;
};

export type LegacyTenantConfig = {
  tenantCode: string;
  tenantName: string;
};

export type ProjectContextInput = ProjectContextConfig | LegacyTenantConfig;

export const createProjectContextConfig = (input: { code: string; name: string }): ProjectContextConfig => ({
  code: input.code,
  name: input.name
});

export const createProjectContextConfigFromTenant = (input: {
  tenantCode: string;
  tenantName: string;
}): ProjectContextConfig =>
  createProjectContextConfig({
    code: input.tenantCode,
    name: input.tenantName
  });

export const normalizeProjectContextConfig = (input: ProjectContextInput): ProjectContextConfig =>
  "code" in input && "name" in input ? createProjectContextConfig(input) : createProjectContextConfigFromTenant(input);

export const createTenantConfigFromProjectContext = (input: ProjectContextConfig) => ({
  tenantCode: input.code,
  tenantName: input.name
});
