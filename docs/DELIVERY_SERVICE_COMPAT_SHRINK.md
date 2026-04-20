# Delivery Service Compatibility Shrink List

## Purpose

This document records which `tenant-*` compatibility members on `DeliveryService` are still materially used by production code, and which ones now exist mostly as compatibility surface.

The goal is to avoid blind deletion. Future shrink work should remove compatibility members only after:

1. project-first callers are already in place
2. tests cover the active path
3. the member is verified as unused in production code

## Current Rule

- `project-*` is the primary application surface.
- `tenant-*` remains compatibility surface unless a production caller still depends on it.

## Group A: Still Used In Production Code

No remaining delivery-service compatibility members are currently known to have direct production callers under `src/`.

### Compatibility-Shaped Permission Aliases

- `canManageAdmins`
- `canManageCollections`
  - Local UI naming has been normalized to the project-oriented form
  - Removed on 2026-04-21 after confirming no production callers

### Batch Listing

Removed on 2026-04-21:

- `listTenantBatches`

## Group B: No Direct Production Callers, Compatibility Only

These members appear to be retained mainly for compatibility. They are good candidates for staged removal later.

### Identity Compatibility

- Removed on 2026-04-21:
  - `isTenantUser`
  - `getTenantUserLabel`

### Settings Compatibility

Removed on 2026-04-21:

- `getTenantSearchMode`
- `setTenantSearchMode`
- `getTenantMinReplicas`
- `setTenantMinReplicas`

### Admin / Configuration Compatibility

Removed on 2026-04-21:

- `getTenantStartWelcomeHtml`
- `setTenantStartWelcomeHtml`
- `getTenantDeliveryAdConfig`
- `setTenantDeliveryAdConfig`
- `getTenantProtectContentEnabled`
- `setTenantProtectContentEnabled`
- `getTenantHidePublisherEnabled`
- `setTenantHidePublisherEnabled`
- `getTenantAutoCategorizeEnabled`
- `setTenantAutoCategorizeEnabled`
- `getTenantAutoCategorizeRules`
- `setTenantAutoCategorizeRules`
- `getTenantPublicRankingEnabled`
- `setTenantPublicRankingEnabled`
- `listTenantAdmins`
- `addTenantAdmin`
- `removeTenantAdmin`

### Stats Compatibility

Removed on 2026-04-21:

- `getTenantHomeStats`
- `getTenantStats`
- `getTenantRanking`
- `getTenantLikeRanking`
- `getTenantVisitRanking`
- `getTenantCommentRanking`

## Suggested Removal Order

1. Remove compatibility exports that have no production callers:
   - stats compatibility members
     status: completed
   - settings compatibility members
     status: completed
   - admin compatibility members
     status: completed
2. Re-audit the remaining compatibility surface after future UI/service cleanup rounds.

## Preconditions Before Removal

For each candidate:

- Confirm no production references under `src/` outside compatibility definitions.
- Keep or add a test for the surviving `project-*` path.
- Remove the compatibility member from:
  - implementation exports
  - `DeliveryService` type surface
  - tests that only assert the old alias

## Non-Goals

- This document does not propose schema deletion.
- This document does not change runtime behavior.
- This document does not remove compatibility by itself.
