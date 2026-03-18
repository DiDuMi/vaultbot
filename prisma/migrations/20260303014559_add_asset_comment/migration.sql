-- CreateTable
CREATE TABLE "AssetComment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorName" TEXT,
    "content" TEXT NOT NULL,
    "replyToCommentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetComment_tenantId_assetId_createdAt_idx" ON "AssetComment"("tenantId", "assetId", "createdAt");

-- CreateIndex
CREATE INDEX "AssetComment_tenantId_authorUserId_createdAt_idx" ON "AssetComment"("tenantId", "authorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "AssetComment" ADD CONSTRAINT "AssetComment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetComment" ADD CONSTRAINT "AssetComment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetComment" ADD CONSTRAINT "AssetComment_replyToCommentId_fkey" FOREIGN KEY ("replyToCommentId") REFERENCES "AssetComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
