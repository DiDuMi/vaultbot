import type { PrismaClient } from "@prisma/client";
import { normalizePage, normalizePageSize } from "./delivery-strategy";

export const createDeliverySocial = (deps: {
  prisma: PrismaClient;
  getRuntimeProjectId: () => Promise<string>;
  isProjectMemberSafe: (userId: string) => Promise<boolean>;
  getProjectAssetAccess: (
    tenantId: string,
    userId: string,
    assetId: string
  ) => Promise<{ status: "ok"; asset: { id: string; visibility: string } } | { status: "missing" } | { status: "forbidden" }>;
}) => {
  const listUserComments = async (
    userId: string,
    kind: "comment" | "reply",
    page: number,
    pageSize: number,
    options?: { since?: Date }
  ) => {
    const projectId = await deps.getRuntimeProjectId();
    const safePage = normalizePage(page);
    const safeSize = normalizePageSize(pageSize);
    const isProjectMember = await deps.isProjectMemberSafe(userId);
    const since = options?.since;
    const where = {
      tenantId: projectId,
      authorUserId: userId,
      replyToCommentId: kind === "reply" ? { not: null } : null,
      ...(since ? { createdAt: { gte: since } } : {}),
      ...(isProjectMember ? {} : { asset: { visibility: { not: "RESTRICTED" as const } } })
    };
    const [total, comments] = await Promise.all([
      deps.prisma.assetComment.count({ where }),
      deps.prisma.assetComment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: safeSize,
        skip: (safePage - 1) * safeSize,
        select: {
          id: true,
          assetId: true,
          content: true,
          replyToCommentId: true,
          createdAt: true,
          replyTo: { select: { authorUserId: true, authorName: true } },
          asset: {
            select: {
              title: true,
              description: true,
              shareCode: true,
              uploadBatches: { orderBy: { createdAt: "desc" }, take: 1, select: { userId: true } }
            }
          }
        }
      })
    ]);
    return {
      total,
      items: comments.map((c) => ({
        id: c.id,
        assetId: c.assetId,
        shareCode: c.asset?.shareCode ?? null,
        title: c.asset?.title ?? c.assetId,
        description: c.asset?.description ?? null,
        content: c.content,
        replyToCommentId: c.replyToCommentId ?? null,
        replyTo: c.replyTo ? { authorUserId: c.replyTo.authorUserId, authorName: c.replyTo.authorName ?? null } : null,
        createdAt: c.createdAt,
        publisherUserId: c.asset?.uploadBatches[0]?.userId ?? null
      }))
    };
  };

  const listAssetComments = async (userId: string, assetId: string, page: number, pageSize: number) => {
    const projectId = await deps.getRuntimeProjectId();
    const safePage = normalizePage(page);
    const safeSize = normalizePageSize(pageSize, { maxSize: 50 });
    const access = await deps.getProjectAssetAccess(projectId, userId, assetId);
    if (access.status !== "ok") {
      return { total: 0, items: [] };
    }
    const [total, comments] = await Promise.all([
      deps.prisma.assetComment.count({ where: { tenantId: projectId, assetId } }),
      deps.prisma.assetComment.findMany({
        where: { tenantId: projectId, assetId },
        orderBy: { createdAt: "desc" },
        take: safeSize,
        skip: (safePage - 1) * safeSize,
        select: {
          id: true,
          authorUserId: true,
          authorName: true,
          content: true,
          replyToCommentId: true,
          replyTo: { select: { authorUserId: true, authorName: true } },
          createdAt: true
        }
      })
    ]);
    return { total, items: comments };
  };

  const getAssetCommentCount = async (userId: string, assetId: string) => {
    const projectId = await deps.getRuntimeProjectId();
    const access = await deps.getProjectAssetAccess(projectId, userId, assetId);
    if (access.status !== "ok") {
      return 0;
    }
    return deps.prisma.assetComment.count({ where: { tenantId: projectId, assetId } });
  };

  const getAssetCommentContext = async (userId: string, commentId: string) => {
    const projectId = await deps.getRuntimeProjectId();
    const comment = await deps.prisma.assetComment.findFirst({
      where: { id: commentId, tenantId: projectId },
      select: {
        id: true,
        assetId: true,
        authorUserId: true,
        authorName: true,
        createdAt: true
      }
    });
    if (!comment) {
      return null;
    }
    const access = await deps.getProjectAssetAccess(projectId, userId, comment.assetId);
    if (access.status !== "ok") {
      return null;
    }
    return { assetId: comment.assetId, authorUserId: comment.authorUserId, authorName: comment.authorName };
  };

  const locateAssetComment = async (userId: string, commentId: string, pageSize: number) => {
    const projectId = await deps.getRuntimeProjectId();
    const safeSize = normalizePageSize(pageSize, { maxSize: 50 });
    const comment = await deps.prisma.assetComment.findFirst({
      where: { id: commentId, tenantId: projectId },
      select: { id: true, assetId: true, createdAt: true }
    });
    if (!comment) {
      return null;
    }
    const access = await deps.getProjectAssetAccess(projectId, userId, comment.assetId);
    if (access.status !== "ok") {
      return null;
    }
    const newerCount = await deps.prisma.assetComment.count({
      where: { tenantId: projectId, assetId: comment.assetId, createdAt: { gt: comment.createdAt } }
    });
    const page = Math.floor(newerCount / safeSize) + 1;
    return { assetId: comment.assetId, page: page < 1 ? 1 : page };
  };

  const getCommentThread = async (userId: string, rootCommentId: string) => {
    const projectId = await deps.getRuntimeProjectId();
    const root = await deps.prisma.assetComment.findFirst({
      where: { id: rootCommentId, tenantId: projectId },
      select: {
        id: true,
        assetId: true,
        authorUserId: true,
        authorName: true,
        content: true,
        createdAt: true,
        asset: { select: { title: true, shareCode: true } }
      }
    });
    if (!root) {
      return null;
    }
    const access = await deps.getProjectAssetAccess(projectId, userId, root.assetId);
    if (access.status !== "ok") {
      return null;
    }
    const replies = await deps.prisma.assetComment.findMany({
      where: { tenantId: projectId, assetId: root.assetId, replyToCommentId: root.id },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: { id: true, authorUserId: true, authorName: true, content: true, createdAt: true }
    });
    return {
      assetId: root.assetId,
      assetTitle: root.asset.title ?? "未命名",
      shareCode: root.asset.shareCode,
      root: {
        id: root.id,
        authorUserId: root.authorUserId,
        authorName: root.authorName,
        content: root.content,
        createdAt: root.createdAt
      },
      replies
    };
  };

  const toggleAssetCommentLike = async (userId: string, commentId: string) => {
    const projectId = await deps.getRuntimeProjectId();
    const context = await getAssetCommentContext(userId, commentId);
    if (!context) {
      return { ok: false, message: "⚠️ 评论不存在或无权限。" };
    }
    const existing = await deps.prisma.assetCommentLike.findFirst({
      where: { tenantId: projectId, commentId, userId },
      select: { id: true }
    });
    if (existing) {
      await deps.prisma.assetCommentLike.delete({ where: { id: existing.id } });
      const count = await deps.prisma.assetCommentLike.count({ where: { tenantId: projectId, commentId } });
      return { ok: true, message: "✅ 已取消收藏。", liked: false, count, assetId: context.assetId };
    }
    await deps.prisma.assetCommentLike.create({
      data: { tenantId: projectId, commentId, userId }
    });
    const count = await deps.prisma.assetCommentLike.count({ where: { tenantId: projectId, commentId } });
    return { ok: true, message: "⭐️ 已收藏。", liked: true, count, assetId: context.assetId };
  };

  const getAssetLikeCount = async (userId: string, assetId: string) => {
    const projectId = await deps.getRuntimeProjectId();
    const access = await deps.getProjectAssetAccess(projectId, userId, assetId);
    if (access.status !== "ok") {
      return 0;
    }
    return deps.prisma.assetLike.count({ where: { tenantId: projectId, assetId } });
  };

  const hasAssetLiked = async (userId: string, assetId: string) => {
    const projectId = await deps.getRuntimeProjectId();
    const access = await deps.getProjectAssetAccess(projectId, userId, assetId);
    if (access.status !== "ok") {
      return false;
    }
    const found = await deps.prisma.assetLike.findFirst({ where: { tenantId: projectId, assetId, userId }, select: { id: true } });
    return Boolean(found);
  };

  const toggleAssetLike = async (userId: string, assetId: string) => {
    const projectId = await deps.getRuntimeProjectId();
    const access = await deps.getProjectAssetAccess(projectId, userId, assetId);
    if (access.status === "missing") {
      return { ok: false, message: "⚠️ 内容不存在或已删除。" };
    }
    if (access.status === "forbidden") {
      return { ok: false, message: "🔒 无权限或内容不存在。" };
    }
    const existing = await deps.prisma.assetLike.findFirst({
      where: { tenantId: projectId, assetId, userId },
      select: { id: true }
    });
    if (existing) {
      await deps.prisma.assetLike.delete({ where: { id: existing.id } });
      const count = await deps.prisma.assetLike.count({ where: { tenantId: projectId, assetId } });
      return { ok: true, message: "✅ 已取消收藏。", liked: false, count };
    }
    await deps.prisma.assetLike.create({ data: { tenantId: projectId, assetId, userId } });
    const count = await deps.prisma.assetLike.count({ where: { tenantId: projectId, assetId } });
    return { ok: true, message: "⭐️ 已收藏。", liked: true, count };
  };

  const addAssetComment = async (
    userId: string,
    assetId: string,
    input: { authorName: string | null; content: string; replyToCommentId?: string | null }
  ) => {
    const projectId = await deps.getRuntimeProjectId();
    const access = await deps.getProjectAssetAccess(projectId, userId, assetId);
    if (access.status === "missing") {
      return { ok: false, message: "⚠️ 内容不存在或已删除。" };
    }
    if (access.status === "forbidden") {
      return { ok: false, message: "🔒 无权限或内容不存在。" };
    }
    const content = input.content.trim();
    if (!content) {
      return { ok: false, message: "⚠️ 评论不能为空。" };
    }
    if (Buffer.byteLength(content, "utf8") > 800) {
      return { ok: false, message: "⚠️ 评论过长，请控制在 800 字节以内。" };
    }
    const authorName = input.authorName?.trim() ? input.authorName.trim().slice(0, 100) : null;
    const replyToCommentId = input.replyToCommentId ?? null;
    const [asset, publisherBatch] = await Promise.all([
      deps.prisma.asset.findFirst({ where: { id: assetId, tenantId: projectId }, select: { title: true, shareCode: true } }),
      deps.prisma.uploadBatch.findFirst({
        where: { tenantId: projectId, assetId, status: "COMMITTED" },
        orderBy: { createdAt: "desc" },
        select: { userId: true }
      })
    ]);
    const publisherUserId = publisherBatch?.userId ?? null;
    let replyToAuthorUserId: string | null = null;
    if (replyToCommentId) {
      const exists = await deps.prisma.assetComment.findFirst({
        where: { id: replyToCommentId, tenantId: projectId, assetId },
        select: { id: true, authorUserId: true }
      });
      if (!exists) {
        return { ok: false, message: "⚠️ 回复目标不存在或已删除。" };
      }
      replyToAuthorUserId = exists.authorUserId;
    }
    const comment = await deps.prisma.assetComment.create({
      data: {
        tenantId: projectId,
        assetId,
        authorUserId: userId,
        authorName,
        content,
        replyToCommentId
      },
      select: { id: true }
    });
    const shareCode = asset?.shareCode;
    const assetTitle = asset?.title ?? "未命名";
    return {
      ok: true,
      message: replyToCommentId ? "✅ 已回复。" : "✅ 已评论。",
      commentId: comment.id,
      notify: shareCode ? { assetTitle, shareCode, publisherUserId, replyToAuthorUserId, replyToCommentId } : undefined
    };
  };

  return {
    listUserComments,
    listAssetComments,
    getAssetCommentCount,
    getAssetCommentContext,
    locateAssetComment,
    getCommentThread,
    toggleAssetCommentLike,
    getAssetLikeCount,
    hasAssetLiked,
    toggleAssetLike,
    addAssetComment
  };
};
