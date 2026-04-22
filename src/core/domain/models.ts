export type Project = {
  id: string;
  code: string;
  name: string;
};

export type ProjectScoped = {
  projectId: string;
};

export type LegacyTenantScoped = {
  tenantId: string;
};

export type ProjectAsset = ProjectScoped & {
  id: string;
  title: string;
  description?: string;
  shareCode?: string;
};

export type Asset = ProjectAsset & LegacyTenantScoped;

export type AssetReplica = {
  id: string;
  assetId: string;
  vaultGroupId: string;
  messageId: bigint;
};

export type ProjectPermissionRule = ProjectScoped & {
  id: string;
};

export type PermissionRule = ProjectPermissionRule & LegacyTenantScoped;

export type ProjectEvent = ProjectScoped & {
  id: string;
  userId: string;
  type: string;
};

export type Event = ProjectEvent & LegacyTenantScoped;

export type Tenant = Project;
