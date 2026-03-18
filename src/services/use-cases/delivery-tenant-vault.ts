import type { PrismaClient } from "@prisma/client";
import { normalizeLimit } from "./delivery-strategy";

type TelegramUserInput = {
  id: number | string;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  language_code?: string | null;
  is_bot?: boolean;
};

export const createDeliveryTenantVault = (deps: {
  prisma: PrismaClient;
  getTenantId: () => Promise<string>;
  isTenantAdmin: (userId: string) => Promise<boolean>;
  ensureInitialOwner: (tenantId: string, userId: string) => Promise<boolean>;
}) => {
  const upsertTenantUserFromTelegram = async (user: TelegramUserInput) => {
    const tenantId = await deps.getTenantId();
    const tgUserId = String(user.id);
    const now = new Date();
    const username = user.username?.trim().replace(/^@+/, "") || null;
    const firstName = user.first_name?.trim() || null;
    const lastName = user.last_name?.trim() || null;
    const languageCode = user.language_code?.trim() || null;
    const isBot = Boolean(user.is_bot);
    await deps.prisma.tenantUser.upsert({
      where: { tenantId_tgUserId: { tenantId, tgUserId } },
      update: { username, firstName, lastName, languageCode, isBot, lastSeenAt: now },
      create: { tenantId, tgUserId, username, firstName, lastName, languageCode, isBot, lastSeenAt: now }
    });
  };

  const getTenantUserLabel = async (userId: string) => {
    const tenantId = await deps.getTenantId();
    const row = await deps.prisma.tenantUser.findUnique({
      where: { tenantId_tgUserId: { tenantId, tgUserId: userId } },
      select: { username: true, firstName: true, lastName: true }
    });
    if (!row) {
      return null;
    }
    const username = row.username?.trim().replace(/^@+/, "");
    if (username) {
      return `@${username}`;
    }
    const fullName = [row.firstName?.trim(), row.lastName?.trim()].filter(Boolean).join(" ");
    return fullName || null;
  };

  const isTenantUser = async (userId: string) => {
    const tenantId = await deps.getTenantId();
    const member = await deps.prisma.tenantMember.findFirst({ where: { tenantId, tgUserId: userId } });
    if (member) {
      return true;
    }
    return deps.ensureInitialOwner(tenantId, userId);
  };

  const listTenantAdmins = async () => {
    const tenantId = await deps.getTenantId();
    const members = await deps.prisma.tenantMember.findMany({
      where: { tenantId, role: { in: ["OWNER", "ADMIN"] } },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: { tgUserId: true, role: true }
    });
    return members.map((member) => {
      const role: "OWNER" | "ADMIN" = member.role === "OWNER" ? "OWNER" : "ADMIN";
      return { tgUserId: member.tgUserId, role };
    });
  };

  const addTenantAdmin = async (actorUserId: string, tgUserId: string) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可添加管理员。" };
    }
    const tenantId = await deps.getTenantId();
    const existing = await deps.prisma.tenantMember.findUnique({ where: { tenantId_tgUserId: { tenantId, tgUserId } } });
    if (existing?.role === "OWNER") {
      return { ok: true, message: "✅ 已是拥有者（OWNER），无需变更。" };
    }
    await deps.prisma.tenantMember.upsert({
      where: { tenantId_tgUserId: { tenantId, tgUserId } },
      update: { role: "ADMIN" },
      create: { tenantId, tgUserId, role: "ADMIN" }
    });
    return { ok: true, message: `✅ 已添加管理员：<code>${tgUserId}</code>` };
  };

  const removeTenantAdmin = async (actorUserId: string, tgUserId: string) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可移除管理员。" };
    }
    const tenantId = await deps.getTenantId();
    const existing = await deps.prisma.tenantMember.findUnique({ where: { tenantId_tgUserId: { tenantId, tgUserId } } });
    if (!existing) {
      return { ok: true, message: "✅ 该用户不在管理员列表中。" };
    }
    if (existing.role === "OWNER") {
      return { ok: false, message: "⚠️ 不支持移除拥有者（OWNER）。" };
    }
    await deps.prisma.tenantMember.delete({ where: { tenantId_tgUserId: { tenantId, tgUserId } } });
    return { ok: true, message: `✅ 已移除管理员：<code>${tgUserId}</code>` };
  };

  const listVaultGroups = async () => {
    const tenantId = await deps.getTenantId();
    const bindings = await deps.prisma.tenantVaultBinding.findMany({
      where: { tenantId },
      include: { vaultGroup: true },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }]
    });
    const roleRank = (role: "PRIMARY" | "BACKUP" | "COLD") => (role === "PRIMARY" ? 0 : role === "BACKUP" ? 1 : 2);
    const map = new Map<string, { vaultGroupId: string; chatId: string; role: "PRIMARY" | "BACKUP" | "COLD"; status: "ACTIVE" | "DEGRADED" | "BANNED" }>();
    for (const binding of bindings) {
      const role = binding.role as "PRIMARY" | "BACKUP" | "COLD";
      const current = map.get(binding.vaultGroupId);
      const next = {
        vaultGroupId: binding.vaultGroupId,
        chatId: binding.vaultGroup.chatId.toString(),
        role,
        status: binding.vaultGroup.status as "ACTIVE" | "DEGRADED" | "BANNED"
      };
      if (!current || roleRank(role) < roleRank(current.role)) {
        map.set(binding.vaultGroupId, next);
      }
    }
    return Array.from(map.values()).sort((a, b) => roleRank(a.role) - roleRank(b.role));
  };

  const normalizeTelegramChatId = (raw: string) => (/^-?\d+$/.test(raw.trim()) ? raw.trim() : null);

  const addBackupVaultGroup = async (actorUserId: string, chatId: string) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可添加备份存储群。" };
    }
    const normalizedChatId = normalizeTelegramChatId(chatId);
    if (!normalizedChatId) {
      return { ok: false, message: "⚠️ Chat ID 格式错误：请发送 Telegram 群/频道数字 ID，例如 <code>-100123456</code>。" };
    }
    const tenantId = await deps.getTenantId();
    const vaultGroup = await deps.prisma.vaultGroup.upsert({
      where: { tenantId_chatId: { tenantId, chatId: BigInt(normalizedChatId) } },
      update: {},
      create: { tenantId, chatId: BigInt(normalizedChatId) }
    });
    const alreadyPrimary = await deps.prisma.tenantVaultBinding.findFirst({
      where: { tenantId, vaultGroupId: vaultGroup.id, role: "PRIMARY" },
      select: { id: true }
    });
    if (alreadyPrimary) {
      return { ok: true, message: "✅ 该存储群已是主群，无需添加为备份。" };
    }
    await deps.prisma.tenantVaultBinding.upsert({
      where: { tenantId_vaultGroupId_role: { tenantId, vaultGroupId: vaultGroup.id, role: "BACKUP" } },
      update: {},
      create: { tenantId, vaultGroupId: vaultGroup.id, role: "BACKUP" }
    });
    return { ok: true, message: "✅ 已添加备份存储群。" };
  };

  const removeBackupVaultGroup = async (actorUserId: string, vaultGroupId: string) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可移除备份存储群。" };
    }
    const tenantId = await deps.getTenantId();
    await deps.prisma.tenantVaultBinding.deleteMany({ where: { tenantId, vaultGroupId, role: "BACKUP" } }).catch(() => undefined);
    return { ok: true, message: "✅ 已移除备份存储群绑定。" };
  };

  const setPrimaryVaultGroup = async (actorUserId: string, vaultGroupId: string) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可切换主存储群。" };
    }
    const tenantId = await deps.getTenantId();
    const exists = await deps.prisma.tenantVaultBinding.findFirst({ where: { tenantId, vaultGroupId } });
    if (!exists) {
      return { ok: false, message: "⚠️ 存储群不存在或未绑定到当前租户。" };
    }
    await deps.prisma.$transaction(async (tx) => {
      await tx.tenantVaultBinding.deleteMany({ where: { tenantId, role: "PRIMARY", vaultGroupId: { not: vaultGroupId } } });
      await tx.tenantVaultBinding.deleteMany({ where: { tenantId, vaultGroupId, role: { in: ["BACKUP", "COLD"] } } });
      await tx.tenantVaultBinding.upsert({
        where: { tenantId_vaultGroupId_role: { tenantId, vaultGroupId, role: "PRIMARY" } },
        update: {},
        create: { tenantId, vaultGroupId, role: "PRIMARY" }
      });
    });
    return { ok: true, message: "✅ 已切换主存储群。" };
  };

  const setVaultGroupStatus = async (actorUserId: string, vaultGroupId: string, status: "ACTIVE" | "DEGRADED" | "BANNED") => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可修改存储群状态。" };
    }
    const tenantId = await deps.getTenantId();
    const binding = await deps.prisma.tenantVaultBinding.findFirst({ where: { tenantId, vaultGroupId }, include: { vaultGroup: true } });
    if (!binding) {
      return { ok: false, message: "⚠️ 存储群不存在或未绑定到当前租户。" };
    }
    const nextStatus = status === "ACTIVE" || status === "DEGRADED" || status === "BANNED" ? status : "ACTIVE";
    await deps.prisma.vaultGroup.update({ where: { id: binding.vaultGroupId }, data: { status: nextStatus } });
    return { ok: true, message: "✅ 已更新存储群状态。" };
  };

  const markReplicaBad = async (assetId: string, fromChatId: string, messageId: number) => {
    const chatIdRaw = fromChatId.trim();
    if (!/^-?\d+$/.test(chatIdRaw) || !Number.isFinite(messageId)) {
      return;
    }
    const replica = await deps.prisma.assetReplica
      .findFirst({
        where: { assetId, messageId: BigInt(messageId), vaultGroup: { chatId: BigInt(chatIdRaw) } },
        select: { id: true, status: true }
      })
      .catch(() => null);
    if (!replica || replica.status !== "ACTIVE") {
      return;
    }
    await deps.prisma.assetReplica.update({ where: { id: replica.id }, data: { status: "BAD" } }).catch(() => undefined);
  };

  const listCollections = async () => {
    const tenantId = await deps.getTenantId();
    const items = await deps.prisma.collection.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: "asc" }],
      select: { id: true, title: true }
    });
    return items.map((item) => ({ id: item.id, title: item.title }));
  };

  const createCollection = async (actorUserId: string, title: string) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可创建分类。" };
    }
    const tenantId = await deps.getTenantId();
    const normalized = title.trim().replace(/\s+/g, " ");
    if (!normalized) {
      return { ok: false, message: "⚠️ 分类名称不能为空。" };
    }
    if (Buffer.byteLength(normalized, "utf8") > 60) {
      return { ok: false, message: "⚠️ 分类名称过长，请控制在 60 字节以内。" };
    }
    const created = await deps.prisma.collection.create({ data: { tenantId, title: normalized } });
    return { ok: true, message: `✅ 已创建分类：<b>${normalized}</b>`, id: created.id };
  };

  const updateCollection = async (actorUserId: string, collectionId: string, title: string) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可重命名分类。" };
    }
    const tenantId = await deps.getTenantId();
    const normalized = title.trim().replace(/\s+/g, " ");
    if (!normalized) {
      return { ok: false, message: "⚠️ 分类名称不能为空。" };
    }
    if (Buffer.byteLength(normalized, "utf8") > 60) {
      return { ok: false, message: "⚠️ 分类名称过长，请控制在 60 字节以内。" };
    }
    const existing = await deps.prisma.collection.findFirst({ where: { id: collectionId, tenantId }, select: { id: true, title: true } });
    if (!existing) {
      return { ok: false, message: "⚠️ 分类不存在或已删除。" };
    }
    if (existing.title === normalized) {
      return { ok: true, message: "✅ 分类名称未变化。" };
    }
    await deps.prisma.collection.update({ where: { id: existing.id }, data: { title: normalized } });
    return { ok: true, message: `✅ 已更新分类：<b>${normalized}</b>` };
  };

  const deleteCollection = async (actorUserId: string, collectionId: string) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可删除分类。" };
    }
    const tenantId = await deps.getTenantId();
    const existing = await deps.prisma.collection.findFirst({ where: { id: collectionId, tenantId }, select: { id: true, title: true } });
    if (!existing) {
      return { ok: true, message: "✅ 分类不存在或已删除。" };
    }
    await deps.prisma.collection.delete({ where: { id: existing.id } });
    return { ok: true, message: `✅ 已删除分类：<b>${existing.title}</b>` };
  };

  const getCollectionImpactCounts = async (actorUserId: string, collectionId: string) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return { assets: 0, files: 0 };
    }
    const tenantId = await deps.getTenantId();
    const existing = await deps.prisma.collection.findFirst({ where: { id: collectionId, tenantId }, select: { id: true } });
    if (!existing) {
      return { assets: 0, files: 0 };
    }
    const [assets, files] = await Promise.all([
      deps.prisma.asset.count({ where: { tenantId, collectionId: existing.id } }),
      deps.prisma.uploadItem.count({
        where: { batch: { tenantId, status: "COMMITTED", asset: { collectionId: existing.id } } }
      })
    ]);
    return { assets, files };
  };

  const getPrimaryVaultChatId = async () => {
    const tenantId = await deps.getTenantId();
    const binding = await deps.prisma.tenantVaultBinding.findFirst({
      where: { tenantId, role: "PRIMARY" },
      include: { vaultGroup: true }
    });
    const chatId = binding?.vaultGroup?.chatId;
    return chatId ? chatId.toString() : null;
  };

  const getCollectionTopic = async (collectionId: string | null) => {
    const topicCollectionId = collectionId ?? "none";
    const tenantId = await deps.getTenantId();
    const binding = await deps.prisma.tenantVaultBinding.findFirst({ where: { tenantId, role: "PRIMARY" }, select: { vaultGroupId: true } });
    if (!binding) {
      return null;
    }
    const topic = await deps.prisma.tenantTopic.findFirst({
      where: { tenantId, vaultGroupId: binding.vaultGroupId, collectionId: topicCollectionId, version: 1 },
      select: { messageThreadId: true, indexMessageId: true }
    });
    return { threadId: topic?.messageThreadId ? Number(topic.messageThreadId) : null, indexMessageId: topic?.indexMessageId ? Number(topic.indexMessageId) : null };
  };

  const setCollectionTopicThreadId = async (collectionId: string | null, threadId: number) => {
    const topicCollectionId = collectionId ?? "none";
    const tenantId = await deps.getTenantId();
    const binding = await deps.prisma.tenantVaultBinding.findFirst({ where: { tenantId, role: "PRIMARY" }, select: { vaultGroupId: true } });
    if (!binding) {
      return;
    }
    await deps.prisma.tenantTopic.upsert({
      where: { tenantId_vaultGroupId_collectionId_version: { tenantId, vaultGroupId: binding.vaultGroupId, collectionId: topicCollectionId, version: 1 } },
      update: { messageThreadId: BigInt(threadId) },
      create: { tenantId, vaultGroupId: binding.vaultGroupId, collectionId: topicCollectionId, messageThreadId: BigInt(threadId), version: 1 }
    });
  };

  const setCollectionTopicIndexMessageId = async (collectionId: string | null, messageId: number | null) => {
    const topicCollectionId = collectionId ?? "none";
    const tenantId = await deps.getTenantId();
    const binding = await deps.prisma.tenantVaultBinding.findFirst({ where: { tenantId, role: "PRIMARY" }, select: { vaultGroupId: true } });
    if (!binding) {
      return;
    }
    await deps.prisma.tenantTopic.upsert({
      where: { tenantId_vaultGroupId_collectionId_version: { tenantId, vaultGroupId: binding.vaultGroupId, collectionId: topicCollectionId, version: 1 } },
      update: { indexMessageId: messageId === null ? null : BigInt(messageId) },
      create: {
        tenantId,
        vaultGroupId: binding.vaultGroupId,
        collectionId: topicCollectionId,
        indexMessageId: messageId === null ? null : BigInt(messageId),
        version: 1
      }
    });
  };

  const listRecentAssetsInCollection = async (collectionId: string | null, limit: number) => {
    const tenantId = await deps.getTenantId();
    const safeLimit = normalizeLimit(limit, { defaultLimit: 20, maxLimit: 30 });
    const items = await deps.prisma.asset.findMany({
      where: { tenantId, collectionId },
      orderBy: [{ updatedAt: "desc" }],
      take: safeLimit,
      select: { id: true, title: true, description: true, shareCode: true, updatedAt: true }
    });
    return items.map((item) => ({ assetId: item.id, title: item.title, description: item.description, shareCode: item.shareCode, updatedAt: item.updatedAt }));
  };

  return {
    upsertTenantUserFromTelegram,
    getTenantUserLabel,
    isTenantUser,
    listTenantAdmins,
    addTenantAdmin,
    removeTenantAdmin,
    listVaultGroups,
    addBackupVaultGroup,
    removeBackupVaultGroup,
    setPrimaryVaultGroup,
    setVaultGroupStatus,
    markReplicaBad,
    listCollections,
    createCollection,
    updateCollection,
    deleteCollection,
    getCollectionImpactCounts,
    getPrimaryVaultChatId,
    getCollectionTopic,
    setCollectionTopicThreadId,
    setCollectionTopicIndexMessageId,
    listRecentAssetsInCollection
  };
};
