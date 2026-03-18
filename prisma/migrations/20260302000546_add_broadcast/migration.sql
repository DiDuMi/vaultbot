-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "creatorChatId" TEXT NOT NULL,
    "status" "BroadcastStatus" NOT NULL DEFAULT 'DRAFT',
    "contentHtml" TEXT NOT NULL,
    "mediaKind" TEXT,
    "mediaFileId" TEXT,
    "buttons" JSONB,
    "nextRunAt" TIMESTAMP(3),
    "repeatEveryMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastRun" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "targetCount" INTEGER NOT NULL,
    "successCount" INTEGER NOT NULL,
    "failedCount" INTEGER NOT NULL,
    "blockedCount" INTEGER NOT NULL,
    "errorsSample" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "BroadcastRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Broadcast_tenantId_status_nextRunAt_idx" ON "Broadcast"("tenantId", "status", "nextRunAt");

-- CreateIndex
CREATE INDEX "BroadcastRun_broadcastId_startedAt_idx" ON "BroadcastRun"("broadcastId", "startedAt");

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRun" ADD CONSTRAINT "BroadcastRun_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
