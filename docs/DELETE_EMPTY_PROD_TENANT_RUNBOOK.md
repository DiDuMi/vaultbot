# Delete Empty Prod Tenant Runbook

## Goal

Delete the empty shell `prod` tenant row after:

- `prod -> vault` business-data consolidation has already completed
- observation confirms `prod` remains empty
- `vault` remains the only active business project

This runbook is intentionally narrow.

It deletes only the empty `Tenant(code='prod')` row.

It is **not**:

- schema cleanup
- `Tenant*` table cleanup
- `tenantId` removal

## Preconditions

Do not proceed unless all are true:

- `24h` observation passed
- `72h` observation passed
- `/ops/project-check` shows:
  - `vault` as the only business-bearing project
  - `prod` with `assets=0 events=0 users=0 batches=0`
- old share links continue to work
- no recent writes target `prod`
- a fresh production backup exists

## Readiness Checks

Run:

```bash
docker exec -i vaultbot-postgres-1 psql -U vaultbot -d vaultbot -f - < /root/vaultbot/scripts/delete-empty-prod-tenant-precheck.sql
```

Do not proceed if:

- any `tenantId = prod` table still has rows
- any `projectId = prod` references still exist
- recent write distribution still includes `prod`

## Execution

Create a fresh backup again immediately before deletion.

Then run:

```bash
docker exec -i vaultbot-postgres-1 psql -U vaultbot -d vaultbot -f - < /root/vaultbot/scripts/delete-empty-prod-tenant.sql
docker exec -i vaultbot-postgres-1 psql -U vaultbot -d vaultbot -f - < /root/vaultbot/scripts/delete-empty-prod-tenant-postcheck.sql
```

## Post-delete Observation

After deletion, continue using:

```bash
docker exec -i vaultbot-postgres-1 psql -U vaultbot -d vaultbot -f - < /root/vaultbot/scripts/project-observation-audit.sql
```

Recommended follow-up:

- immediate post-delete audit
- next `24h` observation window

## Expected Result

After successful deletion:

- `Tenant(code='prod')` no longer exists
- `vault` remains the only runtime and business project
- no dangling `projectId` references remain

## Still Not Unlocked

Even after this deletion, do **not** assume it is safe to:

- delete `TenantMember`
- delete `TenantVaultBinding`
- delete `TenantTopic`
- delete `tenantId`
- remove tenant fallback
- start destructive schema cleanup without a separate decision
