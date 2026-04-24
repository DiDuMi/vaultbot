# Prod To Vault Merge Runbook

## Goal

Consolidate business data from the historical `prod` tenant/project into the active `vault` tenant/project, while preserving existing asset ids and share codes.

This runbook is for the **data consolidation** stage only.

It is **not** the final "delete all tenant structures" step.

## Preconditions

Before running the merge:

- `vault` is the current runtime target in production.
- `prod` and `vault` have the same owner.
- `prod` has no recent uploads and no incomplete upload batches.
- `prod` and `vault` share the same vault groups and bindings.
- A fresh backup exists and has been validated.
- The merge script has been rehearsed against a restored backup.

## Backup

Create a fresh backup before every rehearsal or production execution.

Production example:

```bash
cd /root/vaultbot
mkdir -p backups
BACKUP_BASE="backups/prod_to_vault_premerge_$(date -u +%Y%m%d_%H%M%S)"
docker exec vaultbot-postgres-1 pg_dump -U vaultbot -d vaultbot -Fc > "${BACKUP_BASE}.dump"
sha256sum "${BACKUP_BASE}.dump" > "${BACKUP_BASE}.dump.sha256"
docker cp "${BACKUP_BASE}.dump" vaultbot-postgres-1:/tmp/premerge_check.dump
docker exec vaultbot-postgres-1 sh -lc 'pg_restore --list /tmp/premerge_check.dump | sed -n "1,20p"; rm -f /tmp/premerge_check.dump'
```

## Readiness Checks

Run the read-only precheck:

```bash
docker exec -i vaultbot-postgres-1 psql -U vaultbot -d vaultbot -f - < /root/vaultbot/scripts/prod-to-vault-precheck.sql
```

Do **not** proceed if any of these fail:

- owner mismatch between `prod` and `vault`
- recent uploads still landing in `prod`
- incomplete prod upload batches
- vault group overlap mismatch
- replica message id collisions after remap
- non-root `TenantTopic` rows under `prod`

## Rehearsal

Recommended rehearsal flow:

1. Restore the latest backup to a temporary PostgreSQL instance.
2. Run `scripts/prod-to-vault-precheck.sql`.
3. Run `scripts/prod-to-vault-merge.sql`.
4. Run `scripts/prod-to-vault-postcheck.sql`.
5. Verify a sample of historical `prod` share codes still resolves correctly after consolidation.

## Production Execution

Run during a maintenance window.

Suggested order:

1. stop or pause write-heavy entrypoints if possible
2. confirm backup exists
3. run precheck
4. run merge
5. run postcheck
6. resume traffic
7. begin observation

Execution:

```bash
docker exec -i vaultbot-postgres-1 psql -U vaultbot -d vaultbot -f - < /root/vaultbot/scripts/prod-to-vault-merge.sql
docker exec -i vaultbot-postgres-1 psql -U vaultbot -d vaultbot -f - < /root/vaultbot/scripts/prod-to-vault-postcheck.sql
```

## What The Merge Script Does

- merges overlapping `TenantUser` rows into `vault`
- merges overlapping `UserPreference` rows into `vault`
- merges overlapping `TenantSetting` rows into `vault`
- carries prod-only `TenantMember` rows into `vault`
- moves `Collection`, `PermissionRule`, `Asset`, `UploadBatch`, `Event`, `Broadcast`
- remaps `Tag` / `AssetTag` into `vault`
- remaps `AssetReplica.vaultGroupId` from prod vault groups to the matching vault vault groups
- removes duplicate `prod` `TenantTopic`, `TenantVaultBinding`, and `VaultGroup` rows

The script intentionally leaves the `prod` row in `Tenant` untouched.

## Post-Merge Observation

After the merge, continue using the existing production observation audit:

```bash
docker exec -i vaultbot-postgres-1 psql -U vaultbot -d vaultbot -f - < /root/vaultbot/scripts/project-observation-audit.sql
```

Recommended minimum observation windows:

- 24 hours
- 72 hours

Only consider deleting the empty `prod` tenant shell after:

- `prod` no longer owns business rows
- old share links still work
- no new writes target `prod`
- runtime checks still resolve to `vault`

## Current Backup Reference

Fresh production backup created during preparation:

- path: `/root/vaultbot/backups/prod_to_vault_premerge_20260422_232940.dump`
- sha256: `a3110e35c3ec7d985514aff4ae3a7d4245c1abf6a2c2915258ee47a11e6f4bf5`
- commit: `1f2bc580a5215f76fbc18603285ac065887d9795`

Create a new backup again right before the actual production merge.
