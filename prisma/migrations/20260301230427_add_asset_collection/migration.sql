-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "collectionId" TEXT;

-- CreateIndex
CREATE INDEX "Asset_tenantId_collectionId_idx" ON "Asset"("tenantId", "collectionId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
