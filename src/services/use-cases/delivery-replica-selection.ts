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
      projectId: string;
      messages: DeliveryMessage[];
      title: string;
      description: string | null;
      publisherUserId: string | null;
    }
  | { status: "missing"; message: string }
  | { status: "pending"; message: string }
  | { status: "failed"; message: string };

export const createProjectReplicaSelection = (deps: {
  prisma: PrismaClient;
  getRuntimeProjectId: () => Promise<string>;
  isProjectMemberSafe: (userId: string) => Promise<boolean>;
  getProjectMinReplicas: () => Promise<number>;
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
      return { status: "missing", message: "Asset not found" };
    }
    if (asset.visibility === "RESTRICTED") {
      const isProjectMember = await deps.isProjectMemberSafe(userId);
      if (!isProjectMember) {
        return { status: "failed", message: "Forbidden or missing asset" };
      }
    }

    const batch = await deps.prisma.uploadBatch.findFirst({
      where: { assetId: asset.id },
      include: { items: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" }
    });
    if (!batch) {
      if (asset.replicas.length === 0) {
        return { status: "missing", message: "No available replica found" };
      }
      return {
        status: "ready",
        projectId: asset.tenantId,
        messages: asset.replicas.map((replica) => ({
          fromChatId: replica.vaultGroup.chatId.toString(),
          messageId: Number(replica.messageId),
          kind: "document",
          mediaGroupId: undefined,
          fileId: undefined
        })),
        title: asset.title ?? "Untitled",
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
        projectId: asset.tenantId,
        messages,
        title: asset.title ?? "Untitled",
        description: asset.description,
        publisherUserId: batch.userId
      };
    }

    const failed = batch.items.find((item) => item.status === "FAILED");
    if (failed) {
      return {
        status: "failed",
        message: failed.lastError ? `Replica write failed: ${failed.lastError}` : "Replica write failed"
      };
    }
    const pending = batch.items.some((item) => item.status === "PENDING");
    if (pending || missingReplica) {
      const total = batch.items.length;
      const done = batch.items.filter((item) => item.status === "SUCCESS").length;
      const pendingCount = batch.items.filter((item) => item.status === "PENDING").length;
      const minReplicas = await deps.getProjectMinReplicas().catch(() => 1);
      const projectId = await deps.getRuntimeProjectId();
      const bindings = await deps.prisma.tenantVaultBinding
        .findMany({
          where: { tenantId: projectId, role: { in: ["PRIMARY", "BACKUP"] } },
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
        `Replica write in progress (${done}/${total}), please try again later.`,
        `Current status: PENDING ${pendingCount} | reached ${done} | minReplicas ${minReplicas} | available vaults ${availableVaults.size}/${uniqueVaultIds.size}`,
        ageMin > 0 ? `Batch waiting: ${ageMin} min` : "",
        processLine,
        replicationLine,
        notEnoughVaults
          ? "Not enough available vaults for minReplicas. Add backup vaults or lower minReplicas."
          : "Large batches can be delayed by Telegram rate limits.",
        "If progress stalls, confirm the worker is running: npm run worker",
        "Docker deployment: docker compose logs -f worker",
        `Batch ID: ${batch.id}`
      ]
        .filter(Boolean)
        .join("\n");
      return { status: "pending", message };
    }
    if (messages.length === 0) {
      return { status: "missing", message: "No available replica found" };
    }
    return {
      status: "ready",
      projectId: asset.tenantId,
      messages,
      title: asset.title ?? "Untitled",
      description: asset.description,
      publisherUserId: batch.userId
    };
  };

  return { selectReplicas };
};

export const createDeliveryReplicaSelection = createProjectReplicaSelection;
