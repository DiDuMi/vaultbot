-- CreateEnum
CREATE TYPE "TenantSearchMode" AS ENUM ('OFF', 'ENTITLED_ONLY', 'PUBLIC');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PUBLIC', 'PROTECTED', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "TenantMemberRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'SUPPORT', 'ANALYST');

-- CreateEnum
CREATE TYPE "VaultGroupStatus" AS ENUM ('ACTIVE', 'DEGRADED', 'BANNED');

-- CreateEnum
CREATE TYPE "VaultBindingRole" AS ENUM ('PRIMARY', 'BACKUP', 'COLD');

-- CreateEnum
CREATE TYPE "ReplicaStatus" AS ENUM ('ACTIVE', 'BAD', 'EVICTED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('IMPRESSION', 'OPEN', 'SEARCH', 'LIKE', 'UNLIKE', 'FAVORITE', 'UNFAVORITE', 'PUSH_CLICK', 'SUPPORT_MESSAGE');

-- CreateEnum
CREATE TYPE "UploadBatchStatus" AS ENUM ('COMMITTED', 'CANCELED');

-- CreateEnum
CREATE TYPE "UploadItemStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "searchMode" "TenantSearchMode" NOT NULL DEFAULT 'ENTITLED_ONLY',
    "visibility" "Visibility" NOT NULL DEFAULT 'PROTECTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantMember" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tgUserId" TEXT NOT NULL,
    "role" "TenantMemberRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "status" "VaultGroupStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantVaultBinding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vaultGroupId" TEXT NOT NULL,
    "role" "VaultBindingRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantVaultBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantTopic" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vaultGroupId" TEXT NOT NULL,
    "messageThreadId" BIGINT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "Visibility" NOT NULL DEFAULT 'PROTECTED',
    "searchable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetReplica" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "vaultGroupId" TEXT NOT NULL,
    "messageId" BIGINT NOT NULL,
    "messageThreadId" BIGINT,
    "fileUniqueId" TEXT,
    "size" INTEGER,
    "hash" TEXT,
    "status" "ReplicaStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetReplica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "searchable" BOOLEAN NOT NULL DEFAULT true,
    "visibility" "Visibility" NOT NULL DEFAULT 'PROTECTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissionRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "collectionId" TEXT,
    "assetId" TEXT,
    "allowRoles" TEXT[],
    "allowTags" TEXT[],
    "allowUserIds" TEXT[],
    "denyUserIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermissionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assetId" TEXT,
    "type" "EventType" NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "status" "UploadBatchStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "UploadItemStatus" NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_code_key" ON "Tenant"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMember_tenantId_tgUserId_key" ON "TenantMember"("tenantId", "tgUserId");

-- CreateIndex
CREATE UNIQUE INDEX "VaultGroup_tenantId_chatId_key" ON "VaultGroup"("tenantId", "chatId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantVaultBinding_tenantId_vaultGroupId_role_key" ON "TenantVaultBinding"("tenantId", "vaultGroupId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "TenantTopic_tenantId_vaultGroupId_version_key" ON "TenantTopic"("tenantId", "vaultGroupId", "version");

-- CreateIndex
CREATE INDEX "AssetReplica_assetId_vaultGroupId_idx" ON "AssetReplica"("assetId", "vaultGroupId");

-- CreateIndex
CREATE INDEX "Event_tenantId_userId_type_idx" ON "Event"("tenantId", "userId", "type");

-- CreateIndex
CREATE INDEX "UploadBatch_tenantId_assetId_idx" ON "UploadBatch"("tenantId", "assetId");

-- CreateIndex
CREATE INDEX "UploadItem_batchId_idx" ON "UploadItem"("batchId");

-- AddForeignKey
ALTER TABLE "TenantMember" ADD CONSTRAINT "TenantMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultGroup" ADD CONSTRAINT "VaultGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantVaultBinding" ADD CONSTRAINT "TenantVaultBinding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantVaultBinding" ADD CONSTRAINT "TenantVaultBinding_vaultGroupId_fkey" FOREIGN KEY ("vaultGroupId") REFERENCES "VaultGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantTopic" ADD CONSTRAINT "TenantTopic_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantTopic" ADD CONSTRAINT "TenantTopic_vaultGroupId_fkey" FOREIGN KEY ("vaultGroupId") REFERENCES "VaultGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetReplica" ADD CONSTRAINT "AssetReplica_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetReplica" ADD CONSTRAINT "AssetReplica_vaultGroupId_fkey" FOREIGN KEY ("vaultGroupId") REFERENCES "VaultGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionRule" ADD CONSTRAINT "PermissionRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionRule" ADD CONSTRAINT "PermissionRule_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionRule" ADD CONSTRAINT "PermissionRule_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadBatch" ADD CONSTRAINT "UploadBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadBatch" ADD CONSTRAINT "UploadBatch_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadItem" ADD CONSTRAINT "UploadItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
