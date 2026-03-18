export type Tenant = {
  id: string;
  code: string;
  name: string;
};

export type Asset = {
  id: string;
  tenantId: string;
  title: string;
  description?: string;
  shareCode?: string;
};

export type AssetReplica = {
  id: string;
  assetId: string;
  vaultGroupId: string;
  messageId: bigint;
};

export type PermissionRule = {
  id: string;
  tenantId: string;
};

export type Event = {
  id: string;
  tenantId: string;
  userId: string;
  type: string;
};
