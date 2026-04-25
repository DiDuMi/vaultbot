# Final Detenant Closure Checklist

## Purpose

This document is the closure checklist for fully completing the detenant refactor.

It is meant to answer one concrete question:

- what work still remains before the system can honestly be called "fully detenantized"

It is not:

- the immediate next-task list only
- the production observation runbook
- the final destructive migration script

It is:

- the final phased checklist from the current compatibility state to true single-project structure

Related context:

- [PHASE_B_AFTER_PROD_MERGE_CHECKLIST.md](/E:/MU/chucun/docs/PHASE_B_AFTER_PROD_MERGE_CHECKLIST.md)
- [DETENANT_EXECUTION_MATRIX.md](/E:/MU/chucun/docs/DETENANT_EXECUTION_MATRIX.md)
- [SCHEMA_PHASE_B_DESIGN.md](/E:/MU/chucun/docs/SCHEMA_PHASE_B_DESIGN.md)
- [SCHEMA_CLEANUP_DESIGN.md](/E:/MU/chucun/docs/SCHEMA_CLEANUP_DESIGN.md)
- [PROJECT_FIRST_OPS_ADDENDUM_20260423.md](/E:/MU/chucun/docs/PROJECT_FIRST_OPS_ADDENDUM_20260423.md)

## Current State

At the time this checklist was created, the repo is no longer in the old "two business tenants are active" state.

The current reality is:

- production business data has already been consolidated into `vault`
- the empty shell `prod` tenant has already been removed from production
- project-first wrappers and entrypoints are already widespread
- production observation has remained stable after these changes

But the system is still not fully detenantized because:

- schema still centers around `Tenant*` structures
- many business tables still use `tenantId`
- compatibility aliases and fallback logic still exist
- worker / upload / vault-routing internals still rely on tenant-shaped storage concepts

## P0 - Must Finish First

These items are the minimum remaining application-layer closure work.

### P0-1 Stop Expanding Tenant Compatibility

- Do not add any new `tenant-*` entrypoints.
- Do not add any new direct `tenantId`-driven business logic in high-level modules.
- New code should default to `project-*` naming and project-first entrypoints only.

Completion signal:

- new feature work can be written without touching tenant-named APIs

### P0-2 Continue Default-Path Project-first Cleanup

Keep shrinking default-path compatibility exposure in:

- [delivery.ts](/E:/MU/chucun/src/services/use-cases/delivery.ts)
- [delivery-core.ts](/E:/MU/chucun/src/services/use-cases/delivery-core.ts)
- [delivery-storage.ts](/E:/MU/chucun/src/services/use-cases/delivery-storage.ts)
- [delivery-preferences.ts](/E:/MU/chucun/src/services/use-cases/delivery-preferences.ts)
- [worker/index.ts](/E:/MU/chucun/src/worker/index.ts)
- [worker/helpers.ts](/E:/MU/chucun/src/worker/helpers.ts)

Required direction:

- project-first names become the obvious default
- tenant names remain only as compatibility aliases

Completion signal:

- reading the top-level assembly no longer requires tenant mental mapping

### P0-3 Keep Production Observation Clean

Before touching any destructive cleanup:

- continue observation windows after each deployment
- confirm recent writes still satisfy:
  - `recent_project_id_null_rows = 0`
  - `recent_project_tenant_mismatch_rows = 0`
- confirm recent distribution still only hits `vault`

Completion signal:

- observation stays green across multiple compatible rounds

## P1 - Reduce Compatibility Surface

These items shrink the amount of tenant logic still spread across the codebase.

### P1-1 Concentrate Fallback Logic

Modules that still need careful cleanup:

- [delivery-discovery.ts](/E:/MU/chucun/src/services/use-cases/delivery-discovery.ts)
- [delivery-social.ts](/E:/MU/chucun/src/services/use-cases/delivery-social.ts)
- [delivery-stats.ts](/E:/MU/chucun/src/services/use-cases/delivery-stats.ts)
- [delivery-tenant-vault.ts](/E:/MU/chucun/src/services/use-cases/delivery-tenant-vault.ts)
- [upload.ts](/E:/MU/chucun/src/services/use-cases/upload.ts)
- [replication-worker.ts](/E:/MU/chucun/src/worker/replication-worker.ts)
- [replication-scheduler.ts](/E:/MU/chucun/src/worker/replication-scheduler.ts)

Goal:

- fallback reads remain, but are pushed down into fewer helper boundaries
- module bodies stop repeatedly spelling tenant/project dual-path logic

Completion signal:

- fallback behavior is localized and auditable

### P1-2 Collapse Compatibility Wrappers

Wrappers are useful during migration, but eventually should shrink.

Continue evaluating:

- `delivery-project-*`
- `bot/project/*`
- compatibility re-exports from tenant paths

Goal:

- wrapper layers remain only where they still provide migration value
- unnecessary re-export shells are removed or flattened

Completion signal:

- wrapper count decreases without changing runtime behavior

### P1-3 Shrink Bot Tenant Mental Model

Even if the folder remains for a while, the active product path should feel project-first.

Target:

- [src/bot/project](/E:/MU/chucun/src/bot/project) is the only path most app code cares about
- [src/bot/tenant](/E:/MU/chucun/src/bot/tenant) becomes compatibility-only in both usage and understanding

Completion signal:

- Bot/UI development no longer naturally starts from tenant-named modules

## P2 - Schema Cleanup Preparation

This phase is where "fully detenantized" starts to become a structural question, not just a naming question.

### P2-1 Final Schema Target Must Be Explicit

The team must decide, table by table:

- which models stay
- which models are renamed
- which models are replaced
- which models are deleted

Must be explicit for:

- `Tenant`
- `TenantUser`
- `TenantMember`
- `TenantSetting`
- `TenantVaultBinding`
- `TenantTopic`
- business tables with `tenantId`

Completion signal:

- no ambiguous "we'll probably remove this later" remains in the cleanup design

### P2-2 Migration Strategy Must Exist

Before destructive work:

- draft the migration order
- define rehearsal steps
- define rollback steps
- define success metrics for each stage

Required artifacts:

- migration SQL drafts
- backfill / rewrite SQL
- rehearsal notes
- rollback notes

Completion signal:

- schema cleanup can be rehearsed end-to-end without improvisation

### P2-3 Compatibility Exit Criteria Must Be Written Down

Before removing tenant compatibility:

- define exactly what proves fallback is no longer needed
- define which old entrypoints can be deleted
- define how to verify old share/open paths remain safe

Completion signal:

- deleting compatibility code is rule-driven, not intuition-driven

## Final Cleanup

This is the actual endgame.

Do not start this phase just because the app "feels simpler".

### Final-1 Execute Schema Migration

- apply the planned schema changes
- run backfill / rewrite
- validate in rehearsal environments first
- deploy with rollback readiness

### Final-2 Remove Tenant Compatibility

Candidates for eventual removal:

- tenant fallback env handling
- tenant-only wrapper exports
- `/ops/tenant-check`
- tenant compatibility helper names
- tenant compatibility tests

### Final-3 Remove Tenant Structural Fields

Only after migration and observation:

- remove obsolete `tenantId`
- remove obsolete `Tenant*` models or transform them into project-native structures

### Final-4 Update Production Ops Language

Final documentation should no longer default to tenant wording.

That includes:

- deploy guides
- runbooks
- acceptance checklists
- architecture status docs

Completion signal:

- a new maintainer can understand the system as a single-project product without learning the historical tenant model first

## What Still Counts As "Not Done"

The refactor should still be considered incomplete if any of these remain true:

- schema is still fundamentally tenant-native
- deleting tenant compatibility would break core runtime paths
- upper layers still commonly depend on tenant-named APIs
- production still requires tenant mental mapping to operate safely

## What Will Count As "Done"

The detenant refactor can be considered fully complete only when all of the following are true:

- production operates as a true single-project system
- application-layer default APIs are project-first
- compatibility aliases are reduced to near-zero or removed
- fallback logic is either gone or intentionally minimized and isolated
- schema no longer depends on tenant structures as the primary business model
- ops documentation is project-first end to end

## Recommended Immediate Next Step

From the current state, the most useful next step is:

- continue shrinking fallback spread in discovery / social / upload / worker internals

The most useful parallel track is:

- complete the final schema target design and destructive-migration rehearsal plan

That pairing keeps progress moving without jumping too early into irreversible cleanup.
