/*
  Warnings:

  - Made the column `collectionId` on table `TenantTopic` required. This step will fail if there are existing NULL values in that column.

*/
UPDATE "TenantTopic" SET "collectionId" = 'none' WHERE "collectionId" IS NULL;

-- AlterTable
ALTER TABLE "TenantTopic" ALTER COLUMN "collectionId" SET NOT NULL,
ALTER COLUMN "collectionId" SET DEFAULT 'none';
