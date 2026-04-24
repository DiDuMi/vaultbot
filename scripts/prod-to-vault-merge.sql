\set ON_ERROR_STOP on
\pset pager off
\timing on

-- Consolidate business data from tenant/project code `prod` into `vault`.
-- IMPORTANT:
--   1. Rehearse this script against a restored backup before production use.
--   2. Run during a maintenance window.
--   3. This script intentionally leaves the `prod` Tenant row in place.
--      Delete the empty shell only after post-merge observation passes.

begin;

select pg_advisory_xact_lock(922337203685477000);

do $$
declare
  prod_id text;
  vault_id text;
  prod_owner text;
  vault_owner text;
  recent_uploads_30d integer;
  incomplete_batches integer;
  non_root_topics integer;
  replica_message_collisions integer;
  prod_group_count integer;
  group_overlap_count integer;
begin
  select id into prod_id from "Tenant" where code = 'prod';
  select id into vault_id from "Tenant" where code = 'vault';

  if prod_id is null then
    raise exception 'Missing tenant/project code=prod';
  end if;
  if vault_id is null then
    raise exception 'Missing tenant/project code=vault';
  end if;
  if prod_id = vault_id then
    raise exception 'prod and vault resolve to the same id (%)', prod_id;
  end if;

  select "tgUserId" into prod_owner
  from "TenantMember"
  where "tenantId" = prod_id and role = 'OWNER'
  order by "createdAt" asc
  limit 1;

  select "tgUserId" into vault_owner
  from "TenantMember"
  where "tenantId" = vault_id and role = 'OWNER'
  order by "createdAt" asc
  limit 1;

  if prod_owner is null or vault_owner is null or prod_owner <> vault_owner then
    raise exception 'Owner mismatch: prod=% vault=%', coalesce(prod_owner, '<null>'), coalesce(vault_owner, '<null>');
  end if;

  select count(*) into recent_uploads_30d
  from "UploadBatch"
  where "tenantId" = prod_id
    and "createdAt" >= now() - interval '30 days';

  if recent_uploads_30d > 0 then
    raise exception 'prod still has recent uploads in the last 30 days (% rows)', recent_uploads_30d;
  end if;

  select count(distinct b.id) into incomplete_batches
  from "UploadBatch" b
  join "UploadItem" ui on ui."batchId" = b.id
  where b."tenantId" = prod_id
    and ui.status in ('PENDING', 'FAILED');

  if incomplete_batches > 0 then
    raise exception 'prod still has incomplete upload batches (%)', incomplete_batches;
  end if;

  select count(*) into non_root_topics
  from "TenantTopic"
  where "tenantId" = prod_id
    and "collectionId" <> 'none';

  if non_root_topics > 0 then
    raise exception 'prod has non-root tenant topics (%); handle them manually before running this script', non_root_topics;
  end if;

  select count(*) into prod_group_count
  from "VaultGroup"
  where "tenantId" = prod_id;

  select count(*) into group_overlap_count
  from "VaultGroup" prod
  join "VaultGroup" vault on vault."chatId" = prod."chatId"
  where prod."tenantId" = prod_id
    and vault."tenantId" = vault_id;

  if prod_group_count <> group_overlap_count then
    raise exception 'prod and vault do not share the same vault groups (% prod groups, % overlaps)', prod_group_count, group_overlap_count;
  end if;

  with vault_group_map as (
    select prod.id as prod_vault_group_id,
           vault.id as vault_vault_group_id
    from "VaultGroup" prod
    join "VaultGroup" vault on vault."chatId" = prod."chatId"
    where prod."tenantId" = prod_id
      and vault."tenantId" = vault_id
  ),
  collisions as (
    select x.vault_vault_group_id, x."messageId"
    from (
      select map.vault_vault_group_id, r."messageId"
      from "AssetReplica" r
      join vault_group_map map on map.prod_vault_group_id = r."vaultGroupId"
      union all
      select r."vaultGroupId" as vault_vault_group_id, r."messageId"
      from "AssetReplica" r
      where r."vaultGroupId" in (select vault_vault_group_id from vault_group_map)
    ) x
    group by x.vault_vault_group_id, x."messageId"
    having count(*) > 1
  )
  select count(*) into replica_message_collisions from collisions;

  if replica_message_collisions > 0 then
    raise exception 'asset replica messageId collisions detected after vaultGroup remap (%)', replica_message_collisions;
  end if;
end
$$;

create temp table tmp_vault_group_map on commit drop as
select prod.id as prod_vault_group_id,
       vault.id as vault_vault_group_id,
       prod."chatId"
from "VaultGroup" prod
join "VaultGroup" vault on vault."chatId" = prod."chatId"
where prod."tenantId" = (select id from "Tenant" where code = 'prod')
  and vault."tenantId" = (select id from "Tenant" where code = 'vault');

create temp table tmp_tag_map on commit drop as
select prod.id as prod_tag_id,
       vault.id as vault_tag_id,
       prod.name
from "Tag" prod
join "Tag" vault on vault.name = prod.name
where prod."tenantId" = (select id from "Tenant" where code = 'prod')
  and vault."tenantId" = (select id from "Tenant" where code = 'vault');

insert into "Tag" (id, "tenantId", name, "createdAt", "updatedAt")
select 'merge_tag_' || substr(md5(random()::text || clock_timestamp()::text || prod.name), 1, 24),
       (select id from "Tenant" where code = 'vault'),
       prod.name,
       prod."createdAt",
       greatest(prod."updatedAt", now())
from "Tag" prod
where prod."tenantId" = (select id from "Tenant" where code = 'prod')
  and not exists (
    select 1
    from "Tag" vault
    where vault."tenantId" = (select id from "Tenant" where code = 'vault')
      and vault.name = prod.name
  );

insert into tmp_tag_map (prod_tag_id, vault_tag_id, name)
select prod.id,
       vault.id,
       prod.name
from "Tag" prod
join "Tag" vault on vault.name = prod.name
where prod."tenantId" = (select id from "Tenant" where code = 'prod')
  and vault."tenantId" = (select id from "Tenant" where code = 'vault')
  and not exists (
    select 1 from tmp_tag_map existing where existing.prod_tag_id = prod.id
  );

-- Merge overlapping TenantUser rows into vault, then move prod-only rows.
update "TenantUser" vault
set username = coalesce(vault.username, prod.username),
    "firstName" = coalesce(vault."firstName", prod."firstName"),
    "lastName" = coalesce(vault."lastName", prod."lastName"),
    "languageCode" = coalesce(vault."languageCode", prod."languageCode"),
    "isBot" = vault."isBot" or prod."isBot",
    "lastSeenAt" = greatest(vault."lastSeenAt", prod."lastSeenAt"),
    "createdAt" = least(vault."createdAt", prod."createdAt"),
    "updatedAt" = greatest(vault."updatedAt", prod."updatedAt")
from "TenantUser" prod
where prod."tenantId" = (select id from "Tenant" where code = 'prod')
  and vault."tenantId" = (select id from "Tenant" where code = 'vault')
  and vault."tgUserId" = prod."tgUserId";

delete from "TenantUser" prod
using "TenantUser" vault
where prod."tenantId" = (select id from "Tenant" where code = 'prod')
  and vault."tenantId" = (select id from "Tenant" where code = 'vault')
  and vault."tgUserId" = prod."tgUserId";

update "TenantUser"
set "tenantId" = (select id from "Tenant" where code = 'vault'),
    "projectId" = (select id from "Tenant" where code = 'vault')
where "tenantId" = (select id from "Tenant" where code = 'prod');

-- Merge overlapping user preferences, then move prod-only rows.
update "UserPreference" vault
set value = coalesce(vault.value, prod.value),
    "updatedAt" = greatest(vault."updatedAt", prod."updatedAt"),
    "createdAt" = least(vault."createdAt", prod."createdAt")
from "UserPreference" prod
where prod."tenantId" = (select id from "Tenant" where code = 'prod')
  and vault."tenantId" = (select id from "Tenant" where code = 'vault')
  and vault."tgUserId" = prod."tgUserId"
  and vault.key = prod.key;

delete from "UserPreference" prod
using "UserPreference" vault
where prod."tenantId" = (select id from "Tenant" where code = 'prod')
  and vault."tenantId" = (select id from "Tenant" where code = 'vault')
  and vault."tgUserId" = prod."tgUserId"
  and vault.key = prod.key;

update "UserPreference"
set "tenantId" = (select id from "Tenant" where code = 'vault'),
    "projectId" = (select id from "Tenant" where code = 'vault')
where "tenantId" = (select id from "Tenant" where code = 'prod');

-- Merge overlapping project settings, then move prod-only rows.
update "TenantSetting" vault
set value = coalesce(vault.value, prod.value),
    "updatedAt" = greatest(vault."updatedAt", prod."updatedAt"),
    "createdAt" = least(vault."createdAt", prod."createdAt")
from "TenantSetting" prod
where prod."tenantId" = (select id from "Tenant" where code = 'prod')
  and vault."tenantId" = (select id from "Tenant" where code = 'vault')
  and vault.key = prod.key;

delete from "TenantSetting" prod
using "TenantSetting" vault
where prod."tenantId" = (select id from "Tenant" where code = 'prod')
  and vault."tenantId" = (select id from "Tenant" where code = 'vault')
  and vault.key = prod.key;

update "TenantSetting"
set "tenantId" = (select id from "Tenant" where code = 'vault'),
    "projectId" = (select id from "Tenant" where code = 'vault')
where "tenantId" = (select id from "Tenant" where code = 'prod');

-- Merge members by carrying prod-only users into vault, then delete prod memberships.
insert into "TenantMember" (id, "tenantId", "tgUserId", role, "createdAt")
select 'merge_member_' || substr(md5(random()::text || clock_timestamp()::text || prod."tgUserId"), 1, 21),
       (select id from "Tenant" where code = 'vault'),
       prod."tgUserId",
       prod.role,
       prod."createdAt"
from "TenantMember" prod
where prod."tenantId" = (select id from "Tenant" where code = 'prod')
  and not exists (
    select 1
    from "TenantMember" vault
    where vault."tenantId" = (select id from "Tenant" where code = 'vault')
      and vault."tgUserId" = prod."tgUserId"
  );

delete from "TenantMember"
where "tenantId" = (select id from "Tenant" where code = 'prod');

-- Move low-risk scoped tables first.
update "Collection"
set "tenantId" = (select id from "Tenant" where code = 'vault'),
    "projectId" = (select id from "Tenant" where code = 'vault')
where "tenantId" = (select id from "Tenant" where code = 'prod');

update "PermissionRule"
set "tenantId" = (select id from "Tenant" where code = 'vault')
where "tenantId" = (select id from "Tenant" where code = 'prod');

update "Asset"
set "tenantId" = (select id from "Tenant" where code = 'vault'),
    "projectId" = (select id from "Tenant" where code = 'vault')
where "tenantId" = (select id from "Tenant" where code = 'prod');

update "AssetTag" asset_tag
set "tenantId" = (select id from "Tenant" where code = 'vault'),
    "tagId" = tag_map.vault_tag_id
from tmp_tag_map tag_map
where asset_tag."tenantId" = (select id from "Tenant" where code = 'prod')
  and asset_tag."tagId" = tag_map.prod_tag_id;

delete from "Tag"
where "tenantId" = (select id from "Tenant" where code = 'prod');

update "AssetComment"
set "tenantId" = (select id from "Tenant" where code = 'vault')
where "tenantId" = (select id from "Tenant" where code = 'prod');

update "AssetCommentLike"
set "tenantId" = (select id from "Tenant" where code = 'vault')
where "tenantId" = (select id from "Tenant" where code = 'prod');

update "AssetLike"
set "tenantId" = (select id from "Tenant" where code = 'vault')
where "tenantId" = (select id from "Tenant" where code = 'prod');

update "UploadBatch"
set "tenantId" = (select id from "Tenant" where code = 'vault'),
    "projectId" = (select id from "Tenant" where code = 'vault')
where "tenantId" = (select id from "Tenant" where code = 'prod');

update "Event"
set "tenantId" = (select id from "Tenant" where code = 'vault'),
    "projectId" = (select id from "Tenant" where code = 'vault')
where "tenantId" = (select id from "Tenant" where code = 'prod');

update "Broadcast"
set "tenantId" = (select id from "Tenant" where code = 'vault'),
    "projectId" = (select id from "Tenant" where code = 'vault')
where "tenantId" = (select id from "Tenant" where code = 'prod');

-- Remap replicas onto the vault tenant's vault groups by shared chatId.
update "AssetReplica" replica
set "vaultGroupId" = map.vault_vault_group_id
from tmp_vault_group_map map
where replica."vaultGroupId" = map.prod_vault_group_id;

-- prod topics/bindings/groups are duplicate shells after remap and can be removed.
delete from "TenantTopic"
where "tenantId" = (select id from "Tenant" where code = 'prod');

delete from "TenantVaultBinding"
where "tenantId" = (select id from "Tenant" where code = 'prod');

delete from "VaultGroup"
where "tenantId" = (select id from "Tenant" where code = 'prod');

commit;

-- Post-merge observation should confirm that:
--   1. `prod` no longer owns business rows.
--   2. legacy shareCode links continue to open successfully.
--   3. runtime writes only target `vault`.
