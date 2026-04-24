\pset pager off
\pset tuples_only off
\pset format aligned
\timing on

-- Post-delete verification for removing the empty shell tenant/project `prod`.
-- Usage:
--   psql -U <user> -d <db> -f scripts/delete-empty-prod-tenant-postcheck.sql

select now() as audited_at;

select id, code, name, "createdAt"
from "Tenant"
where code in ('prod', 'vault')
order by code;

select 'Tenant rows named prod' as check_name,
       count(*) as rows
from "Tenant"
where code = 'prod';

select 'Asset.projectId' as reference_name, count(*) as rows
from "Asset"
where "projectId" not in (select id from "Tenant")
union all
select 'UploadBatch.projectId', count(*)
from "UploadBatch"
where "projectId" is not null
  and "projectId" not in (select id from "Tenant")
union all
select 'Event.projectId', count(*)
from "Event"
where "projectId" is not null
  and "projectId" not in (select id from "Tenant")
union all
select 'TenantUser.projectId', count(*)
from "TenantUser"
where "projectId" is not null
  and "projectId" not in (select id from "Tenant")
union all
select 'UserPreference.projectId', count(*)
from "UserPreference"
where "projectId" is not null
  and "projectId" not in (select id from "Tenant")
union all
select 'TenantSetting.projectId', count(*)
from "TenantSetting"
where "projectId" is not null
  and "projectId" not in (select id from "Tenant")
union all
select 'Broadcast.projectId', count(*)
from "Broadcast"
where "projectId" is not null
  and "projectId" not in (select id from "Tenant")
order by reference_name;

select 'vault totals' as section, 'Asset' as table_name, count(*) as rows
from "Asset"
where "tenantId" = (select id from "Tenant" where code = 'vault')
union all
select 'vault totals', 'UploadBatch', count(*)
from "UploadBatch"
where "tenantId" = (select id from "Tenant" where code = 'vault')
union all
select 'vault totals', 'Event', count(*)
from "Event"
where "tenantId" = (select id from "Tenant" where code = 'vault')
union all
select 'vault totals', 'TenantUser', count(*)
from "TenantUser"
where "tenantId" = (select id from "Tenant" where code = 'vault')
order by table_name;
