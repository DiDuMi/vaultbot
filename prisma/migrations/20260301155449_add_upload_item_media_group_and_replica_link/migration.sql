-- AlterTable
ALTER TABLE "AssetReplica" ADD COLUMN     "uploadItemId" TEXT;

-- AlterTable
ALTER TABLE "UploadItem" ADD COLUMN     "mediaGroupId" TEXT;

-- AddForeignKey
ALTER TABLE "AssetReplica" ADD CONSTRAINT "AssetReplica_uploadItemId_fkey" FOREIGN KEY ("uploadItemId") REFERENCES "UploadItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
