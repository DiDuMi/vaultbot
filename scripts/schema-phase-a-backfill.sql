-- Schema Phase A shadow-environment backfill draft
-- Scope:
--   TenantUser
--   Asset
--   Collection
--   Event
--   UploadBatch
--   UserPreference
--   TenantSetting
--   Broadcast
--
-- Usage:
--   Shadow or rehearsal database only.
--   Run after the A1 migration has already added nullable projectId columns.
--   This script is intentionally idempotent: it only fills rows where projectId is null.

-- 1. Pre-check: count rows still missing projectId before backfill.
select 'TenantUser' as table_name, count(*) as missing_project_id
from "TenantUser"
where "projectId" is null
union all
select 'Asset', count(*) from "Asset" where "projectId" is null
union all
select 'Collection', count(*) from "Collection" where "projectId" is null
union all
select 'Event', count(*) from "Event" where "projectId" is null
union all
select 'UploadBatch', count(*) from "UploadBatch" where "projectId" is null
union all
select 'UserPreference', count(*) from "UserPreference" where "projectId" is null
union all
select 'TenantSetting', count(*) from "TenantSetting" where "projectId" is null
union all
select 'Broadcast', count(*) from "Broadcast" where "projectId" is null
order by table_name;

-- 2. Backfill: align projectId with the existing compatibility key.
update "TenantUser"
set "projectId" = "tenantId"
where "projectId" is null;

update "Asset"
set "projectId" = "tenantId"
where "projectId" is null;

update "Collection"
set "projectId" = "tenantId"
where "projectId" is null;

update "Event"
set "projectId" = "tenantId"
where "projectId" is null;

update "UploadBatch"
set "projectId" = "tenantId"
where "projectId" is null;

update "UserPreference"
set "projectId" = "tenantId"
where "projectId" is null;

update "TenantSetting"
set "projectId" = "tenantId"
where "projectId" is null;

update "Broadcast"
set "projectId" = "tenantId"
where "projectId" is null;

-- 3. Post-check: verify there are no null projectId values left.
select 'TenantUser' as table_name, count(*) as missing_project_id
from "TenantUser"
where "projectId" is null
union all
select 'Asset', count(*) from "Asset" where "projectId" is null
union all
select 'Collection', count(*) from "Collection" where "projectId" is null
union all
select 'Event', count(*) from "Event" where "projectId" is null
union all
select 'UploadBatch', count(*) from "UploadBatch" where "projectId" is null
union all
select 'UserPreference', count(*) from "UserPreference" where "projectId" is null
union all
select 'TenantSetting', count(*) from "TenantSetting" where "projectId" is null
union all
select 'Broadcast', count(*) from "Broadcast" where "projectId" is null
order by table_name;

-- 4. Consistency check: verify every backfilled row matches tenantId.
select 'TenantUser' as table_name, count(*) as mismatch_count
from "TenantUser"
where "projectId" is distinct from "tenantId"
union all
select 'Asset', count(*) from "Asset" where "projectId" is distinct from "tenantId"
union all
select 'Collection', count(*) from "Collection" where "projectId" is distinct from "tenantId"
union all
select 'Event', count(*) from "Event" where "projectId" is distinct from "tenantId"
union all
select 'UploadBatch', count(*) from "UploadBatch" where "projectId" is distinct from "tenantId"
union all
select 'UserPreference', count(*) from "UserPreference" where "projectId" is distinct from "tenantId"
union all
select 'TenantSetting', count(*) from "TenantSetting" where "projectId" is distinct from "tenantId"
union all
select 'Broadcast', count(*) from "Broadcast" where "projectId" is distinct from "tenantId"
order by table_name;

-- 5. Optional sample output for manual inspection.
select 'TenantSetting' as table_name, id, "tenantId", "projectId", key
from "TenantSetting"
order by "updatedAt" desc
limit 3;

select 'TenantUser' as table_name, id, "tenantId", "projectId", "tgUserId"
from "TenantUser"
order by "updatedAt" desc
limit 3;

select 'Asset' as table_name, id, "tenantId", "projectId", title
from "Asset"
order by "updatedAt" desc
limit 3;

select 'UploadBatch' as table_name, id, "tenantId", "projectId", "assetId", status
from "UploadBatch"
order by "createdAt" desc
limit 3;

select 'Broadcast' as table_name, id, "tenantId", "projectId", status
from "Broadcast"
order by "updatedAt" desc
limit 3;
