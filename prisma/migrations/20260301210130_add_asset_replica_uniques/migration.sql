/*
  Warnings:

  - A unique constraint covering the columns `[assetId,uploadItemId,vaultGroupId]` on the table `AssetReplica` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[vaultGroupId,messageId]` on the table `AssetReplica` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "AssetReplica_assetId_uploadItemId_vaultGroupId_key" ON "AssetReplica"("assetId", "uploadItemId", "vaultGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetReplica_vaultGroupId_messageId_key" ON "AssetReplica"("vaultGroupId", "messageId");
