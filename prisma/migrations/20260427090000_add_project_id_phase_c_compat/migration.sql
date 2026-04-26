-- Phase C compatibility fields for project-first cleanup.
-- This is additive only: keep tenantId/Tenant* compatibility in place.

ALTER TABLE "TenantMember" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "VaultGroup" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "TenantVaultBinding" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "TenantTopic" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "Tag" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "AssetTag" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "PermissionRule" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "AssetComment" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "AssetCommentLike" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "AssetLike" ADD COLUMN IF NOT EXISTS "projectId" TEXT;

UPDATE "TenantMember" SET "projectId" = "tenantId" WHERE "projectId" IS NULL;
UPDATE "VaultGroup" SET "projectId" = "tenantId" WHERE "projectId" IS NULL;
UPDATE "TenantVaultBinding" SET "projectId" = "tenantId" WHERE "projectId" IS NULL;
UPDATE "TenantTopic" SET "projectId" = "tenantId" WHERE "projectId" IS NULL;
UPDATE "Tag" SET "projectId" = "tenantId" WHERE "projectId" IS NULL;
UPDATE "AssetTag" SET "projectId" = "tenantId" WHERE "projectId" IS NULL;
UPDATE "PermissionRule" SET "projectId" = "tenantId" WHERE "projectId" IS NULL;
UPDATE "AssetComment" SET "projectId" = "tenantId" WHERE "projectId" IS NULL;
UPDATE "AssetCommentLike" SET "projectId" = "tenantId" WHERE "projectId" IS NULL;
UPDATE "AssetLike" SET "projectId" = "tenantId" WHERE "projectId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "TenantMember_projectId_tgUserId_key"
  ON "TenantMember"("projectId", "tgUserId");
CREATE INDEX IF NOT EXISTS "TenantMember_projectId_idx"
  ON "TenantMember"("projectId");

CREATE UNIQUE INDEX IF NOT EXISTS "VaultGroup_projectId_chatId_key"
  ON "VaultGroup"("projectId", "chatId");
CREATE INDEX IF NOT EXISTS "VaultGroup_projectId_idx"
  ON "VaultGroup"("projectId");

CREATE UNIQUE INDEX IF NOT EXISTS "TenantVaultBinding_projectId_vaultGroupId_role_key"
  ON "TenantVaultBinding"("projectId", "vaultGroupId", "role");
CREATE INDEX IF NOT EXISTS "TenantVaultBinding_projectId_idx"
  ON "TenantVaultBinding"("projectId");

CREATE UNIQUE INDEX IF NOT EXISTS "TenantTopic_projectId_vaultGroupId_collectionId_version_key"
  ON "TenantTopic"("projectId", "vaultGroupId", "collectionId", "version");
CREATE INDEX IF NOT EXISTS "TenantTopic_projectId_idx"
  ON "TenantTopic"("projectId");

CREATE UNIQUE INDEX IF NOT EXISTS "Tag_projectId_name_key"
  ON "Tag"("projectId", "name");
CREATE INDEX IF NOT EXISTS "Tag_projectId_idx"
  ON "Tag"("projectId");

CREATE INDEX IF NOT EXISTS "AssetTag_projectId_tagId_createdAt_idx"
  ON "AssetTag"("projectId", "tagId", "createdAt");
CREATE INDEX IF NOT EXISTS "AssetTag_projectId_assetId_createdAt_idx"
  ON "AssetTag"("projectId", "assetId", "createdAt");

CREATE INDEX IF NOT EXISTS "PermissionRule_projectId_idx"
  ON "PermissionRule"("projectId");

CREATE INDEX IF NOT EXISTS "AssetComment_projectId_assetId_createdAt_idx"
  ON "AssetComment"("projectId", "assetId", "createdAt");
CREATE INDEX IF NOT EXISTS "AssetComment_projectId_authorUserId_createdAt_idx"
  ON "AssetComment"("projectId", "authorUserId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "AssetCommentLike_projectId_commentId_userId_key"
  ON "AssetCommentLike"("projectId", "commentId", "userId");
CREATE INDEX IF NOT EXISTS "AssetCommentLike_projectId_commentId_createdAt_idx"
  ON "AssetCommentLike"("projectId", "commentId", "createdAt");
CREATE INDEX IF NOT EXISTS "AssetCommentLike_projectId_userId_createdAt_idx"
  ON "AssetCommentLike"("projectId", "userId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "AssetLike_projectId_assetId_userId_key"
  ON "AssetLike"("projectId", "assetId", "userId");
CREATE INDEX IF NOT EXISTS "AssetLike_projectId_assetId_createdAt_idx"
  ON "AssetLike"("projectId", "assetId", "createdAt");
CREATE INDEX IF NOT EXISTS "AssetLike_projectId_userId_createdAt_idx"
  ON "AssetLike"("projectId", "userId", "createdAt");
