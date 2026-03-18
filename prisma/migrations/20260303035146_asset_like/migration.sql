-- CreateTable
CREATE TABLE "AssetLike" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetLike_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetLike_tenantId_assetId_createdAt_idx" ON "AssetLike"("tenantId", "assetId", "createdAt");

-- CreateIndex
CREATE INDEX "AssetLike_tenantId_userId_createdAt_idx" ON "AssetLike"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssetLike_tenantId_assetId_userId_key" ON "AssetLike"("tenantId", "assetId", "userId");

-- AddForeignKey
ALTER TABLE "AssetLike" ADD CONSTRAINT "AssetLike_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetLike" ADD CONSTRAINT "AssetLike_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
