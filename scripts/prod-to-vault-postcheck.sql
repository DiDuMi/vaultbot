\pset pager off
\pset tuples_only off
\pset format aligned
\timing on

-- Post-merge verification for prod -> vault consolidation.
-- Usage:
--   psql -U <user> -d <db> -f scripts/prod-to-vault-postcheck.sql

select now() as audited_at;

select id, code, name, "createdAt"
from "Tenant"
where code in ('prod', 'vault')
order by code;

select 'TenantMember' as table_name, count(*) as prod_rows
from "TenantMember"
where "tenantId" = (select id from "Tenant" where code = 'prod')
union all
select 'TenantUser', count(*)
from "TenantUser"
where "tenantId" = (select id from "Tenant" where code = 'prod')
union all
select 'Asset', count(*)
from "Asset"
where "tenantId" = (select id from "Tenant" where code = 'prod')
union all
select 'UploadBatch', count(*)
from "UploadBatch"
where "tenantId" = (select id from "Tenant" where code = 'prod')
union all
select 'Event', count(*)
from "Event"
where "tenantId" = (select id from "Tenant" where code = 'prod')
union all
select 'Tag', count(*)
from "Tag"
where "tenantId" = (select id from "Tenant" where code = 'prod')
union all
select 'AssetTag', count(*)
from "AssetTag"
where "tenantId" = (select id from "Tenant" where code = 'prod')
union all
select 'UserPreference', count(*)
from "UserPreference"
where "tenantId" = (select id from "Tenant" where code = 'prod')
union all
select 'TenantSetting', count(*)
from "TenantSetting"
where "tenantId" = (select id from "Tenant" where code = 'prod')
union all
select 'AssetComment', count(*)
from "AssetComment"
where "tenantId" = (select id from "Tenant" where code = 'prod')
union all
select 'AssetCommentLike', count(*)
from "AssetCommentLike"
where "tenantId" = (select id from "Tenant" where code = 'prod')
union all
select 'AssetLike', count(*)
from "AssetLike"
where "tenantId" = (select id from "Tenant" where code = 'prod')
union all
select 'VaultGroup', count(*)
from "VaultGroup"
where "tenantId" = (select id from "Tenant" where code = 'prod')
union all
select 'TenantVaultBinding', count(*)
from "TenantVaultBinding"
where "tenantId" = (select id from "Tenant" where code = 'prod')
union all
select 'TenantTopic', count(*)
from "TenantTopic"
where "tenantId" = (select id from "Tenant" where code = 'prod')
order by table_name;

select 'vault business totals' as section, 'Asset' as table_name, count(*) as rows
from "Asset"
where "tenantId" = (select id from "Tenant" where code = 'vault')
union all
select 'vault business totals', 'UploadBatch', count(*)
from "UploadBatch"
where "tenantId" = (select id from "Tenant" where code = 'vault')
union all
select 'vault business totals', 'Event', count(*)
from "Event"
where "tenantId" = (select id from "Tenant" where code = 'vault')
union all
select 'vault business totals', 'TenantUser', count(*)
from "TenantUser"
where "tenantId" = (select id from "Tenant" where code = 'vault')
order by table_name;

select 'shareCode continuity sample' as section, id, title, "shareCode"
from "Asset"
where "tenantId" = (select id from "Tenant" where code = 'vault')
  and "shareCode" is not null
order by "updatedAt" desc
limit 20;
