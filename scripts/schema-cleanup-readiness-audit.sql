\pset pager off
\pset tuples_only off
\pset format aligned
\timing on

-- Read-only audit before considering any Tenant*/tenantId schema cleanup.
-- This script does not mutate data and does not approve destructive migration by itself.
-- Usage:
--   psql -U <user> -d <db> -f scripts/schema-cleanup-readiness-audit.sql

select now() as audited_at;

select 'tenant_rows' as section, count(*) as rows
from "Tenant";

select id, code, name, "createdAt", "updatedAt"
from "Tenant"
order by "createdAt" asc;

-- ProjectId readiness for tables that already have projectId compatibility columns.
select 'Asset' as table_name,
       count(*) as total_rows,
       count(*) filter (where "projectId" is null) as project_id_null_rows,
       count(*) filter (where "projectId" is distinct from "tenantId") as project_tenant_mismatch_rows,
       count(distinct "tenantId") as tenant_scope_count,
       count(distinct "projectId") filter (where "projectId" is not null) as project_scope_count
from "Asset"
union all
select 'AssetComment', count(*),
       count(*) filter (where "projectId" is null),
       count(*) filter (where "projectId" is distinct from "tenantId"),
       count(distinct "tenantId"),
       count(distinct "projectId") filter (where "projectId" is not null)
from "AssetComment"
union all
select 'AssetCommentLike', count(*),
       count(*) filter (where "projectId" is null),
       count(*) filter (where "projectId" is distinct from "tenantId"),
       count(distinct "tenantId"),
       count(distinct "projectId") filter (where "projectId" is not null)
from "AssetCommentLike"
union all
select 'AssetLike', count(*),
       count(*) filter (where "projectId" is null),
       count(*) filter (where "projectId" is distinct from "tenantId"),
       count(distinct "tenantId"),
       count(distinct "projectId") filter (where "projectId" is not null)
from "AssetLike"
union all
select 'AssetTag', count(*),
       count(*) filter (where "projectId" is null),
       count(*) filter (where "projectId" is distinct from "tenantId"),
       count(distinct "tenantId"),
       count(distinct "projectId") filter (where "projectId" is not null)
from "AssetTag"
union all
select 'Collection', count(*),
       count(*) filter (where "projectId" is null),
       count(*) filter (where "projectId" is distinct from "tenantId"),
       count(distinct "tenantId"),
       count(distinct "projectId") filter (where "projectId" is not null)
from "Collection"
union all
select 'Event', count(*),
       count(*) filter (where "projectId" is null),
       count(*) filter (where "projectId" is distinct from "tenantId"),
       count(distinct "tenantId"),
       count(distinct "projectId") filter (where "projectId" is not null)
from "Event"
union all
select 'PermissionRule', count(*),
       count(*) filter (where "projectId" is null),
       count(*) filter (where "projectId" is distinct from "tenantId"),
       count(distinct "tenantId"),
       count(distinct "projectId") filter (where "projectId" is not null)
from "PermissionRule"
union all
select 'Tag', count(*),
       count(*) filter (where "projectId" is null),
       count(*) filter (where "projectId" is distinct from "tenantId"),
       count(distinct "tenantId"),
       count(distinct "projectId") filter (where "projectId" is not null)
from "Tag"
union all
select 'TenantMember', count(*),
       count(*) filter (where "projectId" is null),
       count(*) filter (where "projectId" is distinct from "tenantId"),
       count(distinct "tenantId"),
       count(distinct "projectId") filter (where "projectId" is not null)
from "TenantMember"
union all
select 'UploadBatch', count(*),
       count(*) filter (where "projectId" is null),
       count(*) filter (where "projectId" is distinct from "tenantId"),
       count(distinct "tenantId"),
       count(distinct "projectId") filter (where "projectId" is not null)
from "UploadBatch"
union all
select 'TenantUser', count(*),
       count(*) filter (where "projectId" is null),
       count(*) filter (where "projectId" is distinct from "tenantId"),
       count(distinct "tenantId"),
       count(distinct "projectId") filter (where "projectId" is not null)
from "TenantUser"
union all
select 'UserPreference', count(*),
       count(*) filter (where "projectId" is null),
       count(*) filter (where "projectId" is distinct from "tenantId"),
       count(distinct "tenantId"),
       count(distinct "projectId") filter (where "projectId" is not null)
from "UserPreference"
union all
select 'TenantSetting', count(*),
       count(*) filter (where "projectId" is null),
       count(*) filter (where "projectId" is distinct from "tenantId"),
       count(distinct "tenantId"),
       count(distinct "projectId") filter (where "projectId" is not null)
from "TenantSetting"
union all
select 'TenantTopic', count(*),
       count(*) filter (where "projectId" is null),
       count(*) filter (where "projectId" is distinct from "tenantId"),
       count(distinct "tenantId"),
       count(distinct "projectId") filter (where "projectId" is not null)
from "TenantTopic"
union all
select 'Broadcast', count(*),
       count(*) filter (where "projectId" is null),
       count(*) filter (where "projectId" is distinct from "tenantId"),
       count(distinct "tenantId"),
       count(distinct "projectId") filter (where "projectId" is not null)
from "Broadcast"
union all
select 'TenantVaultBinding', count(*),
       count(*) filter (where "projectId" is null),
       count(*) filter (where "projectId" is distinct from "tenantId"),
       count(distinct "tenantId"),
       count(distinct "projectId") filter (where "projectId" is not null)
from "TenantVaultBinding"
union all
select 'VaultGroup', count(*),
       count(*) filter (where "projectId" is null),
       count(*) filter (where "projectId" is distinct from "tenantId"),
       count(distinct "tenantId"),
       count(distinct "projectId") filter (where "projectId" is not null)
from "VaultGroup"
order by table_name;

-- Current tenantId footprint. These tables cannot lose tenantId until code and schema replacements exist.
select 'TenantMember' as table_name, count(*) as total_rows, count(distinct "tenantId") as tenant_scope_count from "TenantMember"
union all select 'TenantUser', count(*), count(distinct "tenantId") from "TenantUser"
union all select 'VaultGroup', count(*), count(distinct "tenantId") from "VaultGroup"
union all select 'TenantVaultBinding', count(*), count(distinct "tenantId") from "TenantVaultBinding"
union all select 'TenantTopic', count(*), count(distinct "tenantId") from "TenantTopic"
union all select 'Asset', count(*), count(distinct "tenantId") from "Asset"
union all select 'Tag', count(*), count(distinct "tenantId") from "Tag"
union all select 'AssetTag', count(*), count(distinct "tenantId") from "AssetTag"
union all select 'Collection', count(*), count(distinct "tenantId") from "Collection"
union all select 'PermissionRule', count(*), count(distinct "tenantId") from "PermissionRule"
union all select 'Event', count(*), count(distinct "tenantId") from "Event"
union all select 'UploadBatch', count(*), count(distinct "tenantId") from "UploadBatch"
union all select 'UserPreference', count(*), count(distinct "tenantId") from "UserPreference"
union all select 'TenantSetting', count(*), count(distinct "tenantId") from "TenantSetting"
union all select 'Broadcast', count(*), count(distinct "tenantId") from "Broadcast"
union all select 'AssetComment', count(*), count(distinct "tenantId") from "AssetComment"
union all select 'AssetCommentLike', count(*), count(distinct "tenantId") from "AssetCommentLike"
union all select 'AssetLike', count(*), count(distinct "tenantId") from "AssetLike"
order by table_name;

-- Tenant-scoped compatibility tables that need an explicit replacement or retention decision.
select 'TenantMember' as table_name, count(*) as rows from "TenantMember"
union all select 'TenantVaultBinding', count(*) from "TenantVaultBinding"
union all select 'TenantTopic', count(*) from "TenantTopic"
union all select 'TenantSetting', count(*) from "TenantSetting"
union all select 'TenantUser', count(*) from "TenantUser"
union all select 'VaultGroup', count(*) from "VaultGroup"
order by table_name;

-- Dangling references should be zero before any rename or migration rehearsal.
select 'Asset.tenantId' as reference_name, count(*) as dangling_rows
from "Asset" where "tenantId" not in (select id from "Tenant")
union all select 'Collection.tenantId', count(*) from "Collection" where "tenantId" not in (select id from "Tenant")
union all select 'Event.tenantId', count(*) from "Event" where "tenantId" not in (select id from "Tenant")
union all select 'UploadBatch.tenantId', count(*) from "UploadBatch" where "tenantId" not in (select id from "Tenant")
union all select 'TenantUser.tenantId', count(*) from "TenantUser" where "tenantId" not in (select id from "Tenant")
union all select 'UserPreference.tenantId', count(*) from "UserPreference" where "tenantId" not in (select id from "Tenant")
union all select 'TenantSetting.tenantId', count(*) from "TenantSetting" where "tenantId" not in (select id from "Tenant")
union all select 'Broadcast.tenantId', count(*) from "Broadcast" where "tenantId" not in (select id from "Tenant")
union all select 'VaultGroup.tenantId', count(*) from "VaultGroup" where "tenantId" not in (select id from "Tenant")
union all select 'TenantVaultBinding.tenantId', count(*) from "TenantVaultBinding" where "tenantId" not in (select id from "Tenant")
union all select 'TenantTopic.tenantId', count(*) from "TenantTopic" where "tenantId" not in (select id from "Tenant")
union all select 'Tag.tenantId', count(*) from "Tag" where "tenantId" not in (select id from "Tenant")
union all select 'AssetTag.tenantId', count(*) from "AssetTag" where "tenantId" not in (select id from "Tenant")
union all select 'PermissionRule.tenantId', count(*) from "PermissionRule" where "tenantId" not in (select id from "Tenant")
union all select 'AssetComment.tenantId', count(*) from "AssetComment" where "tenantId" not in (select id from "Tenant")
union all select 'AssetCommentLike.tenantId', count(*) from "AssetCommentLike" where "tenantId" not in (select id from "Tenant")
union all select 'AssetLike.tenantId', count(*) from "AssetLike" where "tenantId" not in (select id from "Tenant")
order by reference_name;

select 'Asset.projectId' as reference_name, count(*) as dangling_rows
from "Asset" where "projectId" is not null and "projectId" not in (select id from "Tenant")
union all select 'AssetComment.projectId', count(*) from "AssetComment" where "projectId" is not null and "projectId" not in (select id from "Tenant")
union all select 'AssetCommentLike.projectId', count(*) from "AssetCommentLike" where "projectId" is not null and "projectId" not in (select id from "Tenant")
union all select 'AssetLike.projectId', count(*) from "AssetLike" where "projectId" is not null and "projectId" not in (select id from "Tenant")
union all select 'AssetTag.projectId', count(*) from "AssetTag" where "projectId" is not null and "projectId" not in (select id from "Tenant")
union all select 'Collection.projectId', count(*) from "Collection" where "projectId" is not null and "projectId" not in (select id from "Tenant")
union all select 'Event.projectId', count(*) from "Event" where "projectId" is not null and "projectId" not in (select id from "Tenant")
union all select 'PermissionRule.projectId', count(*) from "PermissionRule" where "projectId" is not null and "projectId" not in (select id from "Tenant")
union all select 'Tag.projectId', count(*) from "Tag" where "projectId" is not null and "projectId" not in (select id from "Tenant")
union all select 'TenantMember.projectId', count(*) from "TenantMember" where "projectId" is not null and "projectId" not in (select id from "Tenant")
union all select 'UploadBatch.projectId', count(*) from "UploadBatch" where "projectId" is not null and "projectId" not in (select id from "Tenant")
union all select 'TenantUser.projectId', count(*) from "TenantUser" where "projectId" is not null and "projectId" not in (select id from "Tenant")
union all select 'UserPreference.projectId', count(*) from "UserPreference" where "projectId" is not null and "projectId" not in (select id from "Tenant")
union all select 'TenantSetting.projectId', count(*) from "TenantSetting" where "projectId" is not null and "projectId" not in (select id from "Tenant")
union all select 'TenantTopic.projectId', count(*) from "TenantTopic" where "projectId" is not null and "projectId" not in (select id from "Tenant")
union all select 'Broadcast.projectId', count(*) from "Broadcast" where "projectId" is not null and "projectId" not in (select id from "Tenant")
union all select 'TenantVaultBinding.projectId', count(*) from "TenantVaultBinding" where "projectId" is not null and "projectId" not in (select id from "Tenant")
union all select 'VaultGroup.projectId', count(*) from "VaultGroup" where "projectId" is not null and "projectId" not in (select id from "Tenant")
order by reference_name;

-- Recent-write guard. These must stay zero in production observation windows.
select 'recent_project_id_null_rows' as check_name,
       (
         select count(*) from "Event" where "createdAt" >= now() - interval '24 hours' and "projectId" is null
       ) +
       (
         select count(*) from "UploadBatch" where "createdAt" >= now() - interval '24 hours' and "projectId" is null
       ) +
       (
         select count(*) from "Broadcast" where "createdAt" >= now() - interval '24 hours' and "projectId" is null
       ) as rows
union all
select 'recent_project_tenant_mismatch_rows',
       (
         select count(*) from "Event" where "createdAt" >= now() - interval '24 hours' and "projectId" is distinct from "tenantId"
       ) +
       (
         select count(*) from "UploadBatch" where "createdAt" >= now() - interval '24 hours' and "projectId" is distinct from "tenantId"
       ) +
       (
         select count(*) from "Broadcast" where "createdAt" >= now() - interval '24 hours' and "projectId" is distinct from "tenantId"
       );
