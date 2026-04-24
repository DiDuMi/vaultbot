# Project-first Ops Addendum (2026-04-23)

## Purpose

This note updates the operational interpretation of the repo after:

- project-first preflight / deploy / tag-rebuild entrypoint cleanup
- production `prod -> vault` business-data consolidation

It does not replace the older historical documents.
It should be read as the latest override for production operations.

## Current Production Reality

- `PROJECT_CODE` is the primary production identifier.
- `PROJECT_NAME` is the primary production display name.
- `TENANT_CODE` and `TENANT_NAME` now exist only as legacy fallback inputs.
- After the production merge:
  - `vault` is the only active business project
  - `prod` remains only as an empty shell `Tenant` row

## Operational Entry Points

Preferred entrypoints:

- `scripts/preflight-project.js`
- `npm run preflight:project`
- `scripts/deploy-docker.sh`
- `scripts/deploy-production.sh`
- `scripts/rebuild-tags.js`

Compatibility entrypoint:

- `scripts/preflight-tenant.js`

Interpretation:

- `preflight-project.js` is the real implementation entrypoint
- `preflight-tenant.js` is a compatibility alias only
- all new operational guidance should say:
  - prefer `PROJECT_CODE`
  - prefer `PROJECT_NAME`
  - fall back to legacy `TENANT_*` only when needed

## Impact On Existing Docs

When older docs mention:

- `TENANT_CODE` as the primary runtime identifier
- "production still contains two business tenants: `vault` and `prod`"
- tenant-first deploy/preflight wording

read them with this override:

- `PROJECT_CODE` is the primary runtime identifier
- production no longer has two business-bearing tenants
- `prod` is not an active business tenant anymore
- project-first ops wording is now the canonical wording

## What Is Still Not Unlocked

This addendum does **not** mean:

- schema cleanup is now safe
- `Tenant*` can now be deleted
- `tenantId` can now be removed
- tenant fallback can now be removed

Those still require:

- observation windows
- explicit follow-up checks
- a later destructive cleanup decision

## Recommended Reading Order

For current production operations, prefer this order:

1. `docs/PROJECT_FIRST_OPS_ADDENDUM_20260423.md`
2. `docs/PROD_TO_VAULT_MERGE_RUNBOOK.md`
3. `docs/PHASE_B_AFTER_PROD_MERGE_CHECKLIST.md`
4. older deploy / status / phase design docs as historical context
