-- Phase A shadow-only migration draft for P0 tables.
-- Scope:
--   TenantUser
--   Asset
--   Collection
--   Event
--   UploadBatch
--   UserPreference
--   TenantSetting
--   Broadcast
--
-- Notes:
--   1. This migration only adds nullable projectId columns plus indexes/unique constraints.
--   2. It does not include backfill. Use scripts/schema-phase-a-backfill.sql separately.
--   3. This migration is intended for shadow-environment rehearsal first, not direct production deploy.

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "Broadcast" ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "Collection" ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "TenantSetting" ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "TenantUser" ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "UploadBatch" ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "UserPreference" ADD COLUMN     "projectId" TEXT;

-- CreateIndex
CREATE INDEX "Asset_projectId_collectionId_idx" ON "Asset"("projectId", "collectionId");

-- CreateIndex
CREATE INDEX "Broadcast_projectId_status_nextRunAt_idx" ON "Broadcast"("projectId", "status", "nextRunAt");

-- CreateIndex
CREATE INDEX "Collection_projectId_idx" ON "Collection"("projectId");

-- CreateIndex
CREATE INDEX "Event_projectId_userId_type_idx" ON "Event"("projectId", "userId", "type");

-- CreateIndex
CREATE INDEX "TenantSetting_projectId_idx" ON "TenantSetting"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantSetting_projectId_key_key" ON "TenantSetting"("projectId", "key");

-- CreateIndex
CREATE INDEX "TenantUser_projectId_tgUserId_idx" ON "TenantUser"("projectId", "tgUserId");

-- CreateIndex
CREATE INDEX "TenantUser_projectId_username_idx" ON "TenantUser"("projectId", "username");

-- CreateIndex
CREATE UNIQUE INDEX "TenantUser_projectId_tgUserId_key" ON "TenantUser"("projectId", "tgUserId");

-- CreateIndex
CREATE INDEX "UploadBatch_projectId_assetId_idx" ON "UploadBatch"("projectId", "assetId");

-- CreateIndex
CREATE INDEX "UserPreference_projectId_tgUserId_idx" ON "UserPreference"("projectId", "tgUserId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_projectId_tgUserId_key_key" ON "UserPreference"("projectId", "tgUserId", "key");
