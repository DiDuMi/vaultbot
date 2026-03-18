-- CreateTable
CREATE TABLE "AssetCommentLike" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetCommentLike_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetCommentLike_tenantId_commentId_createdAt_idx" ON "AssetCommentLike"("tenantId", "commentId", "createdAt");

-- CreateIndex
CREATE INDEX "AssetCommentLike_tenantId_userId_createdAt_idx" ON "AssetCommentLike"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssetCommentLike_tenantId_commentId_userId_key" ON "AssetCommentLike"("tenantId", "commentId", "userId");

-- AddForeignKey
ALTER TABLE "AssetCommentLike" ADD CONSTRAINT "AssetCommentLike_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCommentLike" ADD CONSTRAINT "AssetCommentLike_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "AssetComment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
