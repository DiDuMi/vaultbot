\set ON_ERROR_STOP on
\pset pager off
\timing on

-- Delete the empty shell tenant/project row `prod`.
-- IMPORTANT:
--   1. Run only after observation confirms `prod` remains empty.
--   2. Run only after `delete-empty-prod-tenant-precheck.sql` passes.
--   3. This script deletes only the `Tenant` row itself.
--      It does not perform any broader schema cleanup.

begin;

select pg_advisory_xact_lock(922337203685476999);

do $$
declare
  prod_id text;
  remaining_business_rows bigint;
  remaining_project_refs bigint;
begin
  select id into prod_id
  from "Tenant"
  where code = 'prod';

  if prod_id is null then
    raise exception 'Missing shell tenant/project code=prod';
  end if;

  select
    coalesce((select count(*) from "TenantMember" where "tenantId" = prod_id), 0) +
    coalesce((select count(*) from "TenantUser" where "tenantId" = prod_id), 0) +
    coalesce((select count(*) from "Asset" where "tenantId" = prod_id), 0) +
    coalesce((select count(*) from "UploadBatch" where "tenantId" = prod_id), 0) +
    coalesce((select count(*) from "Event" where "tenantId" = prod_id), 0) +
    coalesce((select count(*) from "Tag" where "tenantId" = prod_id), 0) +
    coalesce((select count(*) from "AssetTag" where "tenantId" = prod_id), 0) +
    coalesce((select count(*) from "UserPreference" where "tenantId" = prod_id), 0) +
    coalesce((select count(*) from "TenantSetting" where "tenantId" = prod_id), 0) +
    coalesce((select count(*) from "AssetComment" where "tenantId" = prod_id), 0) +
    coalesce((select count(*) from "AssetCommentLike" where "tenantId" = prod_id), 0) +
    coalesce((select count(*) from "AssetLike" where "tenantId" = prod_id), 0) +
    coalesce((select count(*) from "VaultGroup" where "tenantId" = prod_id), 0) +
    coalesce((select count(*) from "TenantVaultBinding" where "tenantId" = prod_id), 0) +
    coalesce((select count(*) from "TenantTopic" where "tenantId" = prod_id), 0)
  into remaining_business_rows;

  if remaining_business_rows <> 0 then
    raise exception 'prod is not empty across tenantId-scoped business tables (% remaining rows)', remaining_business_rows;
  end if;

  select
    coalesce((select count(*) from "Asset" where "projectId" = prod_id), 0) +
    coalesce((select count(*) from "UploadBatch" where "projectId" = prod_id), 0) +
    coalesce((select count(*) from "Event" where "projectId" = prod_id), 0) +
    coalesce((select count(*) from "TenantUser" where "projectId" = prod_id), 0) +
    coalesce((select count(*) from "UserPreference" where "projectId" = prod_id), 0) +
    coalesce((select count(*) from "TenantSetting" where "projectId" = prod_id), 0) +
    coalesce((select count(*) from "Broadcast" where "projectId" = prod_id), 0)
  into remaining_project_refs;

  if remaining_project_refs <> 0 then
    raise exception 'prod is still referenced by projectId-scoped rows (% remaining references)', remaining_project_refs;
  end if;
end
$$;

delete from "Tenant"
where code = 'prod';

commit;
