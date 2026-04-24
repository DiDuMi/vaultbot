\pset pager off
\pset tuples_only off
\pset format aligned
\timing on

-- Read-only readiness checks for consolidating tenant/project code `prod` into `vault`.
-- Usage:
--   psql -U <user> -d <db> -f scripts/prod-to-vault-precheck.sql

select now() as audited_at;

select id, code, name, "createdAt"
from "Tenant"
where code in ('prod', 'vault')
order by code;

select 'TenantMember' as table_name, t.code as tenant_code, count(*) as rows
from "TenantMember" m
join "Tenant" t on t.id = m."tenantId"
where t.code in ('prod', 'vault')
group by t.code
union all
select 'TenantUser', t.code, count(*)
from "TenantUser" u
join "Tenant" t on t.id = u."tenantId"
where t.code in ('prod', 'vault')
group by t.code
union all
select 'Asset', t.code, count(*)
from "Asset" a
join "Tenant" t on t.id = a."tenantId"
where t.code in ('prod', 'vault')
group by t.code
union all
select 'UploadBatch', t.code, count(*)
from "UploadBatch" b
join "Tenant" t on t.id = b."tenantId"
where t.code in ('prod', 'vault')
group by t.code
union all
select 'UploadItem', t.code, count(*)
from "UploadItem" ui
join "UploadBatch" b on b.id = ui."batchId"
join "Tenant" t on t.id = b."tenantId"
where t.code in ('prod', 'vault')
group by t.code
union all
select 'AssetReplica', t.code, count(*)
from "AssetReplica" r
join "Asset" a on a.id = r."assetId"
join "Tenant" t on t.id = a."tenantId"
where t.code in ('prod', 'vault')
group by t.code
union all
select 'Tag', t.code, count(*)
from "Tag" g
join "Tenant" t on t.id = g."tenantId"
where t.code in ('prod', 'vault')
group by t.code
union all
select 'AssetTag', t.code, count(*)
from "AssetTag" at
join "Tenant" t on t.id = at."tenantId"
where t.code in ('prod', 'vault')
group by t.code
union all
select 'Event', t.code, count(*)
from "Event" e
join "Tenant" t on t.id = e."tenantId"
where t.code in ('prod', 'vault')
group by t.code
union all
select 'UserPreference', t.code, count(*)
from "UserPreference" p
join "Tenant" t on t.id = p."tenantId"
where t.code in ('prod', 'vault')
group by t.code
union all
select 'TenantSetting', t.code, count(*)
from "TenantSetting" s
join "Tenant" t on t.id = s."tenantId"
where t.code in ('prod', 'vault')
group by t.code
union all
select 'AssetComment', t.code, count(*)
from "AssetComment" c
join "Tenant" t on t.id = c."tenantId"
where t.code in ('prod', 'vault')
group by t.code
union all
select 'AssetCommentLike', t.code, count(*)
from "AssetCommentLike" cl
join "Tenant" t on t.id = cl."tenantId"
where t.code in ('prod', 'vault')
group by t.code
union all
select 'AssetLike', t.code, count(*)
from "AssetLike" al
join "Tenant" t on t.id = al."tenantId"
where t.code in ('prod', 'vault')
group by t.code
union all
select 'VaultGroup', t.code, count(*)
from "VaultGroup" vg
join "Tenant" t on t.id = vg."tenantId"
where t.code in ('prod', 'vault')
group by t.code
union all
select 'TenantVaultBinding', t.code, count(*)
from "TenantVaultBinding" vb
join "Tenant" t on t.id = vb."tenantId"
where t.code in ('prod', 'vault')
group by t.code
union all
select 'TenantTopic', t.code, count(*)
from "TenantTopic" tp
join "Tenant" t on t.id = tp."tenantId"
where t.code in ('prod', 'vault')
group by t.code
order by table_name, tenant_code;

-- prod should no longer receive fresh uploads before consolidation.
select 'prod recent uploads' as check_name,
       count(*) filter (where "createdAt" >= now() - interval '7 days') as rows_7d,
       count(*) filter (where "createdAt" >= now() - interval '30 days') as rows_30d
from "UploadBatch"
where "tenantId" = (select id from "Tenant" where code = 'prod');

select 'prod incomplete upload batches' as check_name,
       count(distinct b.id) as batches
from "UploadBatch" b
join "UploadItem" ui on ui."batchId" = b.id
where b."tenantId" = (select id from "Tenant" where code = 'prod')
  and ui.status in ('PENDING', 'FAILED');

select 'prod recent events' as check_name,
       type,
       count(*) as rows_30d
from "Event"
where "tenantId" = (select id from "Tenant" where code = 'prod')
  and "createdAt" >= now() - interval '30 days'
group by type
order by type;

-- Owners should match before any automatic consolidation.
select 'owner alignment' as check_name,
       prod."tgUserId" as prod_owner,
       vault."tgUserId" as vault_owner
from "TenantMember" prod
join "TenantMember" vault on vault.role = 'OWNER'
where prod.role = 'OWNER'
  and prod."tenantId" = (select id from "Tenant" where code = 'prod')
  and vault."tenantId" = (select id from "Tenant" where code = 'vault');

-- The current production assumption is that both tenants share the same vault groups/bindings.
select 'vault group overlap by chatId' as check_name,
       count(*) as overlaps
from "VaultGroup" prod
join "VaultGroup" vault on vault."chatId" = prod."chatId"
where prod."tenantId" = (select id from "Tenant" where code = 'prod')
  and vault."tenantId" = (select id from "Tenant" where code = 'vault');

select 'tenant user overlap by tgUserId' as check_name,
       count(*) as overlaps
from "TenantUser" prod
join "TenantUser" vault on vault."tgUserId" = prod."tgUserId"
where prod."tenantId" = (select id from "Tenant" where code = 'prod')
  and vault."tenantId" = (select id from "Tenant" where code = 'vault');

select 'tag overlap by name' as check_name,
       count(*) as overlaps
from "Tag" prod
join "Tag" vault on vault.name = prod.name
where prod."tenantId" = (select id from "Tenant" where code = 'prod')
  and vault."tenantId" = (select id from "Tenant" where code = 'vault');

select 'user preference overlap by user/key' as check_name,
       count(*) as overlaps
from "UserPreference" prod
join "UserPreference" vault
  on vault."tgUserId" = prod."tgUserId"
 and vault.key = prod.key
where prod."tenantId" = (select id from "Tenant" where code = 'prod')
  and vault."tenantId" = (select id from "Tenant" where code = 'vault');

select 'tenant setting overlap by key' as check_name,
       count(*) as overlaps
from "TenantSetting" prod
join "TenantSetting" vault on vault.key = prod.key
where prod."tenantId" = (select id from "Tenant" where code = 'prod')
  and vault."tenantId" = (select id from "Tenant" where code = 'vault');

-- Consolidation will remap prod replicas onto vault vaultGroup ids by shared chatId.
with vault_group_map as (
  select prod.id as prod_vault_group_id,
         vault.id as vault_vault_group_id,
         prod."chatId"
  from "VaultGroup" prod
  join "VaultGroup" vault on vault."chatId" = prod."chatId"
  where prod."tenantId" = (select id from "Tenant" where code = 'prod')
    and vault."tenantId" = (select id from "Tenant" where code = 'vault')
)
select 'replica messageId collisions after remap' as check_name,
       count(*) as collisions
from (
  select map.vault_vault_group_id, r."messageId"
  from "AssetReplica" r
  join vault_group_map map on map.prod_vault_group_id = r."vaultGroupId"
  union all
  select r."vaultGroupId", r."messageId"
  from "AssetReplica" r
  where r."vaultGroupId" in (select vault_vault_group_id from vault_group_map)
) x
group by x.vault_vault_group_id, x."messageId"
having count(*) > 1;

with vault_group_map as (
  select prod.id as prod_vault_group_id,
         vault.id as vault_vault_group_id,
         prod."chatId"
  from "VaultGroup" prod
  join "VaultGroup" vault on vault."chatId" = prod."chatId"
  where prod."tenantId" = (select id from "Tenant" where code = 'prod')
    and vault."tenantId" = (select id from "Tenant" where code = 'vault')
)
select 'prod topics that are not root topics' as check_name,
       count(*) as rows
from "TenantTopic" tp
where tp."tenantId" = (select id from "Tenant" where code = 'prod')
  and tp."collectionId" <> 'none';

-- Samples for manual review.
select 'prod settings sample' as section, key, value
from "TenantSetting"
where "tenantId" = (select id from "Tenant" where code = 'prod')
order by key;

select 'prod member sample' as section, "tgUserId", role
from "TenantMember"
where "tenantId" = (select id from "Tenant" where code = 'prod')
order by role, "createdAt";

select 'prod vault binding sample' as section, vg."chatId", vb.role, vg.status
from "TenantVaultBinding" vb
join "VaultGroup" vg on vg.id = vb."vaultGroupId"
where vb."tenantId" = (select id from "Tenant" where code = 'prod')
order by vb.role, vg."chatId";
