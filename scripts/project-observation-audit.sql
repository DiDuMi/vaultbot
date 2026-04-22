-- Production observation audit template
-- Purpose:
--   Verify that newly written rows continue to dual-write projectId and tenantId
--   after Phase A backfill has completed in production.
--
-- Usage:
--   psql -U <user> -d <db> -f scripts/project-observation-audit.sql
--
-- Notes:
--   1. This script is read-only.
--   2. It focuses on recent writes, not full historical backfill status.
--   3. Adjust the observation window by replacing interval '24 hours' if needed.

\pset pager off
\pset tuples_only off
\pset format aligned
\timing on

select now() as audited_at;

select id, code, name, "createdAt"
from "Tenant"
order by "createdAt" asc;

-- Recent-write completeness and consistency checks
select 'TenantUser' as table_name,
       count(*) filter (where "updatedAt" >= now() - interval '24 hours') as recent_rows,
       count(*) filter (where "updatedAt" >= now() - interval '24 hours' and "projectId" is null) as recent_project_id_null_rows,
       count(*) filter (where "updatedAt" >= now() - interval '24 hours' and "projectId" is distinct from "tenantId") as recent_project_tenant_mismatch_rows
from "TenantUser"
union all
select 'Asset',
       count(*) filter (where "updatedAt" >= now() - interval '24 hours'),
       count(*) filter (where "updatedAt" >= now() - interval '24 hours' and "projectId" is null),
       count(*) filter (where "updatedAt" >= now() - interval '24 hours' and "projectId" is distinct from "tenantId")
from "Asset"
union all
select 'Collection',
       count(*) filter (where "updatedAt" >= now() - interval '24 hours'),
       count(*) filter (where "updatedAt" >= now() - interval '24 hours' and "projectId" is null),
       count(*) filter (where "updatedAt" >= now() - interval '24 hours' and "projectId" is distinct from "tenantId")
from "Collection"
union all
select 'Event',
       count(*) filter (where "createdAt" >= now() - interval '24 hours'),
       count(*) filter (where "createdAt" >= now() - interval '24 hours' and "projectId" is null),
       count(*) filter (where "createdAt" >= now() - interval '24 hours' and "projectId" is distinct from "tenantId")
from "Event"
union all
select 'UploadBatch',
       count(*) filter (where "createdAt" >= now() - interval '24 hours'),
       count(*) filter (where "createdAt" >= now() - interval '24 hours' and "projectId" is null),
       count(*) filter (where "createdAt" >= now() - interval '24 hours' and "projectId" is distinct from "tenantId")
from "UploadBatch"
union all
select 'UserPreference',
       count(*) filter (where "updatedAt" >= now() - interval '24 hours'),
       count(*) filter (where "updatedAt" >= now() - interval '24 hours' and "projectId" is null),
       count(*) filter (where "updatedAt" >= now() - interval '24 hours' and "projectId" is distinct from "tenantId")
from "UserPreference"
union all
select 'TenantSetting',
       count(*) filter (where "updatedAt" >= now() - interval '24 hours'),
       count(*) filter (where "updatedAt" >= now() - interval '24 hours' and "projectId" is null),
       count(*) filter (where "updatedAt" >= now() - interval '24 hours' and "projectId" is distinct from "tenantId")
from "TenantSetting"
union all
select 'Broadcast',
       count(*) filter (where "updatedAt" >= now() - interval '24 hours'),
       count(*) filter (where "updatedAt" >= now() - interval '24 hours' and "projectId" is null),
       count(*) filter (where "updatedAt" >= now() - interval '24 hours' and "projectId" is distinct from "tenantId")
from "Broadcast"
order by table_name;

-- Recent-write tenant/project distribution
select 'Asset.recent project distribution' as section, t.code as project_code, count(*) as rows
from "Asset" a
join "Tenant" t on t.id = a."projectId"
where a."updatedAt" >= now() - interval '24 hours'
group by t.code
order by t.code;

select 'UploadBatch.recent project distribution' as section, t.code as project_code, count(*) as rows
from "UploadBatch" b
join "Tenant" t on t.id = b."projectId"
where b."createdAt" >= now() - interval '24 hours'
group by t.code
order by t.code;

select 'Event.recent project distribution' as section, t.code as project_code, count(*) as rows
from "Event" e
join "Tenant" t on t.id = e."projectId"
where e."createdAt" >= now() - interval '24 hours'
group by t.code
order by t.code;

select 'TenantUser.recent project distribution' as section, t.code as project_code, count(*) as rows
from "TenantUser" u
join "Tenant" t on t.id = u."projectId"
where u."updatedAt" >= now() - interval '24 hours'
group by t.code
order by t.code;

-- Recent samples for manual inspection
select 'TenantSetting recent sample' as section, id, "tenantId", "projectId", key
from "TenantSetting"
where "updatedAt" >= now() - interval '24 hours'
order by "updatedAt" desc
limit 10;

select 'TenantUser recent sample' as section, id, "tenantId", "projectId", "tgUserId", username
from "TenantUser"
where "updatedAt" >= now() - interval '24 hours'
order by "updatedAt" desc
limit 10;

select 'Asset recent sample' as section, id, "tenantId", "projectId", title, "shareCode"
from "Asset"
where "updatedAt" >= now() - interval '24 hours'
order by "updatedAt" desc
limit 10;

select 'UploadBatch recent sample' as section, id, "tenantId", "projectId", "assetId", status
from "UploadBatch"
where "createdAt" >= now() - interval '24 hours'
order by "createdAt" desc
limit 10;

select 'Event recent sample' as section, id, "tenantId", "projectId", "userId", type
from "Event"
where "createdAt" >= now() - interval '24 hours'
order by "createdAt" desc
limit 10;
