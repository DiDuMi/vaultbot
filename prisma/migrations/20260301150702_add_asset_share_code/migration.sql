/*
  Warnings:

  - A unique constraint covering the columns `[shareCode]` on the table `Asset` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "shareCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Asset_shareCode_key" ON "Asset"("shareCode");
