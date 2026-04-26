# Phase C ProjectId Compatibility Deploy - 2026-04-27

## Summary

Production Phase C additive schema migration and matching application code have been applied.

This was not a destructive detenant migration. It added `projectId` compatibility columns and indexes to the remaining tenant-scoped tables that still carry real production state.

## Production Backup

- Backup file: `/root/vaultbot/backups/phase_c_project_id_pre_20260427_050603.dump`
- Size: `11M`

## Migration

- Migration directory: `prisma/migrations/20260427090000_add_project_id_phase_c_compat`
- Migration file: `migration.sql`
- Production checksum: `26d8add152ec0f7acde68a9429a956a9cca84010ab0732eda5867cfe530fb964`
- Migration metadata recorded in `_prisma_migrations`:
  - `migration_name = 20260427090000_add_project_id_phase_c_compat`
  - `applied_steps_count = 1`

## Tables Updated

Added nullable `projectId`, backfilled `projectId = tenantId`, and added project indexes/uniques for:

- `TenantMember`
- `VaultGroup`
- `TenantVaultBinding`
- `TenantTopic`
- `Tag`
- `AssetTag`
- `PermissionRule`
- `AssetComment`
- `AssetCommentLike`
- `AssetLike`

## Production Backfill Result

Rows backfilled:

- `TenantMember`: `2`
- `VaultGroup`: `2`
- `TenantVaultBinding`: `2`
- `TenantTopic`: `2`
- `Tag`: `1188`
- `AssetTag`: `2752`
- `PermissionRule`: `0`
- `AssetComment`: `22`
- `AssetCommentLike`: `2`
- `AssetLike`: `112`

## Post-Migration Audit

- Audit output: `/root/vaultbot/backups/schema_cleanup_readiness_after_phase_c_20260427_050603.txt`

Post-migration readiness showed all 18 audited tenant-scoped tables have:

- `project_id_null_rows = 0`
- `project_tenant_mismatch_rows = 0`
- dangling `tenantId` references = `0`
- dangling `projectId` references = `0`

Recent 24h checks:

- `recent_project_id_null_rows = 0`
- `recent_project_tenant_mismatch_rows = 0`

## Runtime Check

After deploying the matching source files, production app and worker were rebuilt and recreated with Docker image:

- `vaultbot:latest f0fd2133370e`

Production containers are running:

- `vaultbot-app-1`
- `vaultbot-worker-1`
- `vaultbot-postgres-1`
- `vaultbot-redis-1`

`/health/ready` returned:

- `ok = true`
- `database = true`
- `redis = true`

`/ops/project-check` returned:

- `ok = true`
- `currentProjectCode = vault`
- `matched = true`
- `assets = 952`
- `events = 133329`
- `users = 3358`
- `batches = 952`

## Post-Code-Deploy Audit

- Audit output: `/root/vaultbot/backups/schema_cleanup_readiness_after_code_deploy_20260427_073145.txt`

During the app/worker rebuild window, the old running code wrote a small amount of tag data without `projectId`:

- `Tag`: `5`
- `AssetTag`: `12`

Those rows were backfilled immediately with `projectId = tenantId`. The final audit after code deployment showed all 18 audited tables have:

- `project_id_null_rows = 0`
- `project_tenant_mismatch_rows = 0`
- dangling `tenantId` references = `0`
- dangling `projectId` references = `0`
- recent 24h project dual-write checks = `0`

## Remaining Work

The database and matching application code have advanced. The next work should be planned as a separate cleanup phase:

- monitor the deployed dual-write paths for a short period
- switch remaining reads for newly covered tables to project-first where still needed
- design the destructive removal of `tenantId` / `Tenant*` only after code paths stop depending on them

Do not delete `Tenant*` or `tenantId` in the same change as Phase C. Treat destructive deletion as Phase D, with its own migration, rollback plan, and preflight audit.
