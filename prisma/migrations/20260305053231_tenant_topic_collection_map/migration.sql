/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,vaultGroupId,collectionId,version]` on the table `TenantTopic` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "TenantTopic_tenantId_vaultGroupId_version_key";

-- AlterTable
ALTER TABLE "TenantTopic" ADD COLUMN     "collectionId" TEXT,
ADD COLUMN     "indexMessageId" BIGINT;

-- CreateIndex
CREATE UNIQUE INDEX "TenantTopic_tenantId_vaultGroupId_collectionId_version_key" ON "TenantTopic"("tenantId", "vaultGroupId", "collectionId", "version");
