\pset pager off
\pset tuples_only off
\pset format aligned
\timing on

-- Read-only checks before deleting the empty shell tenant/project `prod`.
-- Usage:
--   psql -U <user> -d <db> -f scripts/delete-empty-prod-tenant-precheck.sql

select now() as audited_at;

select id, code, name, "createdAt"
from "Tenant"
where code in ('prod', 'vault')
order by code;

-- `prod` must be an empty shell across all business-bearing tables.
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

-- `prod` should also no longer be referenced as projectId.
select 'Asset.projectId' as reference_name, count(*) as rows
from "Asset"
where "projectId" = (select id from "Tenant" where code = 'prod')
union all
select 'UploadBatch.projectId', count(*)
from "UploadBatch"
where "projectId" = (select id from "Tenant" where code = 'prod')
union all
select 'Event.projectId', count(*)
from "Event"
where "projectId" = (select id from "Tenant" where code = 'prod')
union all
select 'TenantUser.projectId', count(*)
from "TenantUser"
where "projectId" = (select id from "Tenant" where code = 'prod')
union all
select 'UserPreference.projectId', count(*)
from "UserPreference"
where "projectId" = (select id from "Tenant" where code = 'prod')
union all
select 'TenantSetting.projectId', count(*)
from "TenantSetting"
where "projectId" = (select id from "Tenant" where code = 'prod')
union all
select 'Broadcast.projectId', count(*)
from "Broadcast"
where "projectId" = (select id from "Tenant" where code = 'prod')
order by reference_name;

-- Fresh observation should still show only `vault` recent writes.
select 'recent Event project distribution' as section, t.code as project_code, count(*) as rows
from "Event" e
join "Tenant" t on t.id = e."projectId"
where e."createdAt" >= now() - interval '24 hours'
group by t.code
order by t.code;

select 'recent TenantSetting project distribution' as section, t.code as project_code, count(*) as rows
from "TenantSetting" s
join "Tenant" t on t.id = s."projectId"
where s."updatedAt" >= now() - interval '24 hours'
group by t.code
order by t.code;

select 'recent project-check expectation' as check_name,
       count(*) filter (where code = 'vault') as vault_rows,
       count(*) filter (where code = 'prod') as prod_rows
from "Tenant"
where code in ('prod', 'vault');
