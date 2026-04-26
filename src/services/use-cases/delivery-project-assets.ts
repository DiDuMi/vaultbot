import type { PrismaClient } from "@prisma/client";
import { findOwnedProjectCommittedBatch, findProjectAssetById } from "./delivery-project-scope";

const recycledVisibilityKey = (assetId: string) => `recycled_visibility:${assetId}`;

export const getProjectUserAssetMeta = async (prisma: PrismaClient, projectId: string, userId: string, assetId: string) => {
  const batch = await findOwnedProjectCommittedBatch(prisma, projectId, userId, assetId, { include: { asset: true } });
  if (!batch?.asset) {
    return null;
  }
  return {
    assetId: batch.assetId,
    shareCode: batch.asset.shareCode ?? null,
    title: batch.asset.title,
    description: batch.asset.description,
    collectionId: batch.asset.collectionId,
    searchable: batch.asset.searchable,
    visibility: batch.asset.visibility
  };
};

export const setProjectUserAssetSearchable = async (
  prisma: PrismaClient,
  projectId: string,
  userId: string,
  assetId: string,
  searchable: boolean
) => {
  const ownerBatch = await findOwnedProjectCommittedBatch(prisma, projectId, userId, assetId, { select: { id: true } });
  if (!ownerBatch) {
    return { ok: false, message: "🔒 无权限或内容不存在。" };
  }
  const existing = await findProjectAssetById(prisma, projectId, assetId, { id: true, searchable: true });
  if (!existing) {
    return { ok: false, message: "⚠️ 内容不存在或已删除。" };
  }
  if (existing.searchable === searchable) {
    return { ok: true, message: searchable ? "✅ 当前已处于显示状态。" : "✅ 当前已处于隐藏状态。" };
  }
  await prisma.asset.update({ where: { id: existing.id }, data: { searchable } });
  return { ok: true, message: searchable ? "✅ 已显示该内容。" : "✅ 已隐藏该内容。" };
};

export const deleteProjectUserAsset = async (prisma: PrismaClient, projectId: string, userId: string, assetId: string) => {
  const ownerBatch = await findOwnedProjectCommittedBatch(prisma, projectId, userId, assetId, { select: { id: true } });
  if (!ownerBatch) {
    return { ok: false, message: "🔒 无权限或内容不存在。" };
  }
  const existing = await findProjectAssetById(prisma, projectId, assetId, { id: true });
  if (!existing) {
    return { ok: true, message: "✅ 内容不存在或已删除。" };
  }
  await prisma.$transaction(async (tx) => {
    await tx.tenantSetting.deleteMany({ where: { projectId, key: recycledVisibilityKey(existing.id) } });
    await tx.tenantSetting.deleteMany({ where: { tenantId: projectId, key: recycledVisibilityKey(existing.id) } });
    await tx.assetCommentLike.deleteMany({ where: { comment: { asset: { projectId, id: existing.id } } } });
    await tx.assetCommentLike.deleteMany({ where: { tenantId: projectId, comment: { assetId: existing.id } } });
    await tx.assetComment.deleteMany({ where: { asset: { projectId, id: existing.id } } });
    await tx.assetComment.deleteMany({ where: { tenantId: projectId, assetId: existing.id } });
    await tx.assetLike.deleteMany({ where: { asset: { projectId, id: existing.id } } });
    await tx.assetLike.deleteMany({ where: { tenantId: projectId, assetId: existing.id } });
    await tx.assetTag.deleteMany({ where: { asset: { projectId, id: existing.id } } });
    await tx.assetTag.deleteMany({ where: { tenantId: projectId, assetId: existing.id } });
    await tx.assetReplica.deleteMany({ where: { assetId: existing.id } });
    await tx.uploadItem.deleteMany({ where: { batch: { projectId, assetId: existing.id } } });
    await tx.uploadItem.deleteMany({ where: { batch: { tenantId: projectId, assetId: existing.id } } });
    await tx.uploadBatch.deleteMany({ where: { projectId, assetId: existing.id } });
    await tx.uploadBatch.deleteMany({ where: { tenantId: projectId, assetId: existing.id } });
    await tx.asset.delete({ where: { id: existing.id } });
  });
  return { ok: true, message: "✅ 已删除该内容。" };
};

export const recycleProjectUserAsset = async (prisma: PrismaClient, projectId: string, userId: string, assetId: string) => {
  const ownerBatch = await findOwnedProjectCommittedBatch(prisma, projectId, userId, assetId, { select: { id: true } });
  if (!ownerBatch) {
    return { ok: false, message: "🔒 无权限或内容不存在。" };
  }
  const existing = await findProjectAssetById(prisma, projectId, assetId, { id: true, searchable: true, visibility: true });
  if (!existing) {
    return { ok: true, message: "✅ 内容不存在或已删除。" };
  }
  if (!existing.searchable && existing.visibility === "RESTRICTED") {
    return { ok: true, message: "✅ 当前已在回收状态。" };
  }
  await prisma.$transaction(async (tx) => {
    await tx.tenantSetting.upsert({
      where: { tenantId_key: { tenantId: projectId, key: recycledVisibilityKey(existing.id) } },
      update: { projectId, value: existing.visibility },
      create: { tenantId: projectId, projectId, key: recycledVisibilityKey(existing.id), value: existing.visibility }
    });
    await tx.asset.update({ where: { id: existing.id }, data: { searchable: false, visibility: "RESTRICTED" } });
  });
  return { ok: true, message: "✅ 已回收该内容，可在管理模式恢复。" };
};

export const restoreProjectUserAsset = async (prisma: PrismaClient, projectId: string, userId: string, assetId: string) => {
  const ownerBatch = await findOwnedProjectCommittedBatch(prisma, projectId, userId, assetId, { select: { id: true } });
  if (!ownerBatch) {
    return { ok: false, message: "🔒 无权限或内容不存在。" };
  }
  const existing = await findProjectAssetById(prisma, projectId, assetId, { id: true, searchable: true, visibility: true });
  if (!existing) {
    return { ok: false, message: "⚠️ 内容不存在或已删除。" };
  }
  if (existing.searchable && existing.visibility !== "RESTRICTED") {
    return { ok: true, message: "✅ 当前已是正常状态。" };
  }
  const previousVisibility =
    (await prisma.tenantSetting
      .findUnique({
        where: { projectId_key: { projectId, key: recycledVisibilityKey(existing.id) } },
        select: { value: true }
      })
      .then((row) => row?.value ?? null)) ??
    (await prisma.tenantSetting
      .findUnique({
        where: { tenantId_key: { tenantId: projectId, key: recycledVisibilityKey(existing.id) } },
        select: { value: true }
      })
      .then((row) => row?.value ?? null));
  const restoredVisibility =
    previousVisibility === "PUBLIC" || previousVisibility === "PROTECTED" || previousVisibility === "RESTRICTED"
      ? previousVisibility
      : "PROTECTED";
  await prisma.$transaction(async (tx) => {
    await tx.asset.update({ where: { id: existing.id }, data: { searchable: true, visibility: restoredVisibility } });
    await tx.tenantSetting.deleteMany({ where: { projectId, key: recycledVisibilityKey(existing.id) } });
    await tx.tenantSetting.deleteMany({ where: { tenantId: projectId, key: recycledVisibilityKey(existing.id) } });
  });
  return { ok: true, message: "✅ 已恢复该内容。" };
};
