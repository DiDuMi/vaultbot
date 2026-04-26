# Production Schema Cleanup Readiness - 2026-04-27

## Audit Metadata

- Environment: production
- Host: `72.60.208.20`
- Project path: `/root/vaultbot`
- Database container: `vaultbot-postgres-1`
- Audit script: `scripts/schema-cleanup-readiness-audit.sql`
- Production output file: `/root/vaultbot/backups/schema_cleanup_readiness_20260427_042215.txt`
- Audit time: `2026-04-26 20:22:15 UTC`

## Summary

Production data is in good shape for continued project-first cleanup, but it is not yet approval to delete `Tenant*` or `tenantId`.

Data readiness is mostly green:

- `Tenant` rows: `1`
- Only active project: `vault`
- Existing `projectId` columns:
  - `project_id_null_rows = 0`
  - `project_tenant_mismatch_rows = 0`
- Dangling `tenantId` references: `0`
- Dangling `projectId` references: `0`
- Recent 24h writes:
  - `recent_project_id_null_rows = 0`
  - `recent_project_tenant_mismatch_rows = 0`

Destructive cleanup is still blocked because the schema and code still use tenant-compatible structures as real storage.

## ProjectId Compatibility Tables

| Table | Rows | projectId null | projectId <> tenantId | tenant scopes | project scopes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Asset | 950 | 0 | 0 | 1 | 1 |
| Broadcast | 1 | 0 | 0 | 1 | 1 |
| Collection | 0 | 0 | 0 | 0 | 0 |
| Event | 133121 | 0 | 0 | 1 | 1 |
| TenantSetting | 10 | 0 | 0 | 1 | 1 |
| TenantUser | 3356 | 0 | 0 | 1 | 1 |
| UploadBatch | 950 | 0 | 0 | 1 | 1 |
| UserPreference | 84 | 0 | 0 | 1 | 1 |

## TenantId Footprint

| Table | Rows | tenant scopes |
| --- | ---: | ---: |
| Asset | 950 | 1 |
| AssetComment | 22 | 1 |
| AssetCommentLike | 2 | 1 |
| AssetLike | 111 | 1 |
| AssetTag | 2752 | 1 |
| Broadcast | 1 | 1 |
| Collection | 0 | 0 |
| Event | 133121 | 1 |
| PermissionRule | 0 | 0 |
| Tag | 1188 | 1 |
| TenantMember | 2 | 1 |
| TenantSetting | 10 | 1 |
| TenantTopic | 2 | 1 |
| TenantUser | 3356 | 1 |
| TenantVaultBinding | 2 | 1 |
| UploadBatch | 950 | 1 |
| UserPreference | 84 | 1 |
| VaultGroup | 2 | 1 |

## Compatibility Tables Still Carry Data

| Table | Rows |
| --- | ---: |
| TenantMember | 2 |
| TenantSetting | 10 |
| TenantTopic | 2 |
| TenantUser | 3356 |
| TenantVaultBinding | 2 |
| VaultGroup | 2 |

These rows are not garbage. They still represent real production state: members, settings, users, storage groups, vault bindings, and topic routing.

## Decision

Current decision:

- Continue Phase B project-first cleanup.
- Do not delete `Tenant`.
- Do not delete `TenantMember`.
- Do not delete `TenantVaultBinding`.
- Do not delete `TenantTopic`.
- Do not delete any `tenantId` columns.
- Do not run destructive Prisma migrations.

## Next Actions

1. Continue code cleanup so service, worker, discovery, upload, social, and stats paths read by project-first APIs.
2. Design additive migration for long-lived tables that still lack `projectId`, especially:
   - `Tag`
   - `AssetTag`
   - `AssetComment`
   - `AssetCommentLike`
   - `AssetLike`
   - `VaultGroup`
   - `TenantVaultBinding` / future project storage binding
   - `TenantTopic` / future project topic mapping
3. Rehearse any additive migration on a production backup restore before production.
4. Re-run `scripts/schema-cleanup-readiness-audit.sql` after each major cleanup round.
