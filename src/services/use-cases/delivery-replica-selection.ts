import type { PrismaClient } from "@prisma/client";
import type { UploadMessage } from "./upload";
import { buildWorkerHeartbeatLines } from "./worker-heartbeat";

type DeliveryMessage = {
  fromChatId: string;
  messageId: number;
  kind: UploadMessage["kind"];
  mediaGroupId?: string;
  fileId?: string;
};

type DeliverySelection =
  | {
      status: "ready";
      tenantId: string;
      messages: DeliveryMessage[];
      title: string;
      description: string | null;
      publisherUserId: string | null;
    }
  | { status: "missing"; message: string }
  | { status: "pending"; message: string }
  | { status: "failed"; message: string };

export const createDeliveryReplicaSelection = (deps: {
  prisma: PrismaClient;
  getTenantId: () => Promise<string>;
  isTenantUserSafe: (userId: string) => Promise<boolean>;
  getTenantMinReplicas: () => Promise<number>;
  getSetting: (key: string) => Promise<string | null>;
}) => {
  const selectReplicas = async (userId: string, assetId: string): Promise<DeliverySelection> => {
    const asset = await deps.prisma.asset.findUnique({
      where: { id: assetId },
      include: {
        replicas: {
          where: { status: "ACTIVE" },
          include: { vaultGroup: true },
          orderBy: { createdAt: "asc" }
        }
      }
    });
    if (!asset) {
      return { status: "missing", message: "内容不存在" };
    }
    if (asset.visibility !== "PUBLIC") {
      const isTenant = await deps.isTenantUserSafe(userId);
      if (!isTenant) {
        return { status: "failed", message: "🔒 无权限或内容不存在。" };
      }
    }

    const batch = await deps.prisma.uploadBatch.findFirst({
      where: { assetId: asset.id },
      include: { items: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" }
    });
    if (!batch) {
      if (asset.replicas.length === 0) {
        return { status: "missing", message: "未找到可用副本" };
      }
      return {
        status: "ready",
        tenantId: asset.tenantId,
        messages: asset.replicas.map((replica) => ({
          fromChatId: replica.vaultGroup.chatId.toString(),
          messageId: Number(replica.messageId),
          kind: "document",
          mediaGroupId: undefined,
          fileId: undefined
        })),
        title: asset.title ?? "未命名",
        description: asset.description,
        publisherUserId: null
      };
    }

    const statusRank = (status: "ACTIVE" | "DEGRADED" | "BANNED") => {
      if (status === "ACTIVE") {
        return 0;
      }
      if (status === "DEGRADED") {
        return 1;
      }
      return 2;
    };
    const allCandidates = asset.replicas.filter((replica) => replica.uploadItemId);
    const nonBanned = allCandidates.filter((replica) => replica.vaultGroup.status !== "BANNED");
    const sorted = (nonBanned.length ? nonBanned : allCandidates).sort((a, b) => {
      const rankDiff = statusRank(a.vaultGroup.status) - statusRank(b.vaultGroup.status);
      if (rankDiff !== 0) {
        return rankDiff;
      }
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    const replicaMap = new Map<string, (typeof sorted)[number]>();
    for (const replica of sorted) {
      const key = replica.uploadItemId as string;
      if (!replicaMap.has(key)) {
        replicaMap.set(key, replica);
      }
    }
    const messages: DeliveryMessage[] = [];
    let missingReplica = false;
    for (const item of batch.items) {
      const replica = replicaMap.get(item.id);
      if (!replica) {
        missingReplica = true;
        continue;
      }
      messages.push({
        fromChatId: replica.vaultGroup.chatId.toString(),
        messageId: Number(replica.messageId),
        kind: item.kind as UploadMessage["kind"],
        mediaGroupId: item.mediaGroupId ?? undefined,
        fileId: item.fileId ?? undefined
      });
    }
    if (!missingReplica && messages.length > 0) {
      return {
        status: "ready",
        tenantId: asset.tenantId,
        messages,
        title: asset.title ?? "未命名",
        description: asset.description,
        publisherUserId: batch.userId
      };
    }

    const failed = batch.items.find((item) => item.status === "FAILED");
    if (failed) {
      return {
        status: "failed",
        message: failed.lastError ? `副本写入失败：${failed.lastError}` : "副本写入失败"
      };
    }
    const pending = batch.items.some((item) => item.status === "PENDING");
    if (pending || missingReplica) {
      const total = batch.items.length;
      const done = batch.items.filter((item) => item.status === "SUCCESS").length;
      const pendingCount = batch.items.filter((item) => item.status === "PENDING").length;
      const minReplicas = await deps.getTenantMinReplicas().catch(() => 1);
      const tenantId = await deps.getTenantId();
      const bindings = await deps.prisma.tenantVaultBinding
        .findMany({
          where: { tenantId, role: { in: ["PRIMARY", "BACKUP"] } },
          include: { vaultGroup: true }
        })
        .catch(() => []);
      const uniqueVaultIds = new Set(bindings.map((b) => b.vaultGroupId));
      const availableVaults = new Set(bindings.filter((b) => b.vaultGroup.status !== "BANNED").map((b) => b.vaultGroupId));
      const [processHeartbeatRaw, replicationHeartbeatRaw] = await Promise.all([
        deps.getSetting("worker_heartbeat").catch(() => null),
        deps.getSetting("worker_replication_heartbeat").catch(() => null)
      ]);
      const { processLine, replicationLine } = buildWorkerHeartbeatLines({
        processRaw: processHeartbeatRaw,
        replicationRaw: replicationHeartbeatRaw
      });
      const ageMs = Date.now() - batch.createdAt.getTime();
      const ageMin = Math.max(0, Math.floor(ageMs / 60_000));
      const notEnoughVaults = availableVaults.size < minReplicas;
      const message = [
        `副本写入中（${done}/${total}），请稍后再试。`,
        `当前状态：PENDING ${pendingCount} · 已达标 ${done} · minReplicas ${minReplicas} · 可用存储群 ${availableVaults.size}/${uniqueVaultIds.size}`,
        ageMin > 0 ? `批次已等待：${ageMin} 分钟` : "",
        processLine,
        replicationLine,
        notEnoughVaults
          ? "⚠️ 可用存储群数量小于 minReplicas：请在“⚙️ 设置 → 🗄 存储群”添加备份群或降低 minReplicas。"
          : "大量文件会受 Telegram 限流影响，可能需要几分钟。",
        "若长时间不动，请确认已运行副本写入进程：npm run worker",
        "Docker 部署可用：docker compose logs -f worker",
        `批次ID：${batch.id}`
      ]
        .filter(Boolean)
        .join("\n");
      return { status: "pending", message };
    }
    if (messages.length === 0) {
      return { status: "missing", message: "未找到可用副本" };
    }
    return {
      status: "ready",
      tenantId: asset.tenantId,
      messages,
      title: asset.title ?? "未命名",
      description: asset.description,
      publisherUserId: batch.userId
    };
  };

  return { selectReplicas };
};
