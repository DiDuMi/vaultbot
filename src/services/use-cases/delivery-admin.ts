import type { PrismaClient } from "@prisma/client";
import { normalizeLimit } from "./delivery-strategy";

type SettingKeys = {
  startWelcomeHtml: string;
  deliveryAdConfig: string;
  protectContentEnabled: string;
  hidePublisherEnabled: string;
  publicRankingEnabled: string;
  autoCategorizeEnabled: string;
  autoCategorizeRules: string;
};

const parseBooleanSetting = (raw: string | null) => {
  if (!raw) {
    return false;
  }
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
};

const normalizeBroadcastButtons = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: { text: string; url: string }[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const maybe = row as { text?: unknown; url?: unknown };
    const text = typeof maybe.text === "string" ? maybe.text.trim() : "";
    const url = typeof maybe.url === "string" ? maybe.url.trim() : "";
    if (!text || !url) {
      continue;
    }
    items.push({ text, url });
  }
  return items;
};

const defaultAdConfig = {
  prevText: "⬅️ 上一页",
  nextText: "下一页 ➡️",
  adButtonText: null as string | null,
  adButtonUrl: null as string | null
};

const normalizeAdConfig = (value: string | null) => {
  if (!value) {
    return { ...defaultAdConfig };
  }
  try {
    const parsed = JSON.parse(value) as Partial<typeof defaultAdConfig>;
    const prevText = typeof parsed.prevText === "string" && parsed.prevText.trim() ? parsed.prevText.trim() : defaultAdConfig.prevText;
    const nextText = typeof parsed.nextText === "string" && parsed.nextText.trim() ? parsed.nextText.trim() : defaultAdConfig.nextText;
    const adButtonText = typeof parsed.adButtonText === "string" && parsed.adButtonText.trim() ? parsed.adButtonText.trim() : null;
    const adButtonUrl = typeof parsed.adButtonUrl === "string" && parsed.adButtonUrl.trim() ? parsed.adButtonUrl.trim() : null;
    return { prevText, nextText, adButtonText, adButtonUrl };
  } catch {
    return { ...defaultAdConfig };
  }
};

export const createDeliveryAdmin = (deps: {
  prisma: PrismaClient;
  settingKeys: SettingKeys;
  getTenantId: () => Promise<string>;
  isTenantAdmin: (userId: string) => Promise<boolean>;
  getSetting: (key: string) => Promise<string | null>;
  upsertSetting: (key: string, value: string | null) => Promise<void>;
  deleteSetting: (key: string) => Promise<void>;
}) => {
  const toBroadcastSummary = (row: {
    id: string;
    status: "DRAFT" | "SCHEDULED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED";
    contentHtml: string;
    mediaKind: string | null;
    mediaFileId: string | null;
    buttons: unknown;
    nextRunAt: Date | null;
    repeatEveryMs: number | null;
    createdAt: Date;
    updatedAt: Date;
  }) => ({
    id: row.id,
    status: row.status,
    contentHtml: row.contentHtml,
    mediaKind: row.mediaKind ?? null,
    mediaFileId: row.mediaFileId ?? null,
    buttons: normalizeBroadcastButtons(row.buttons),
    nextRunAt: row.nextRunAt ?? null,
    repeatEveryMs: row.repeatEveryMs ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });

  const getBroadcastTargetUserIds = async () => {
    const tenantId = await deps.getTenantId();
    const [users, members] = await Promise.all([
      deps.prisma.event.groupBy({ by: ["userId"], where: { tenantId } }),
      deps.prisma.tenantMember.findMany({ where: { tenantId }, select: { tgUserId: true } })
    ]);
    const excluded = new Set(members.map((m) => m.tgUserId));
    return users.map((u) => u.userId).filter((id) => !excluded.has(id));
  };

  const getTenantStartWelcomeHtml = async () => {
    return deps.getSetting(deps.settingKeys.startWelcomeHtml);
  };

  const setTenantStartWelcomeHtml = async (actorUserId: string, html: string | null) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可修改欢迎词。" };
    }
    const normalized = html ? html.trim() : "";
    if (!normalized) {
      await deps.deleteSetting(deps.settingKeys.startWelcomeHtml);
      return { ok: true, message: "✅ 已重置欢迎词。" };
    }
    if (Buffer.byteLength(normalized, "utf8") > 4000) {
      return { ok: false, message: "⚠️ 欢迎词过长，请控制在 4000 字节以内。" };
    }
    await deps.upsertSetting(deps.settingKeys.startWelcomeHtml, normalized);
    return { ok: true, message: "✅ 已更新欢迎词。" };
  };

  const getTenantDeliveryAdConfig = async () => {
    const raw = await deps.getSetting(deps.settingKeys.deliveryAdConfig);
    return normalizeAdConfig(raw);
  };

  const setTenantDeliveryAdConfig = async (
    actorUserId: string,
    config: { prevText: string; nextText: string; adButtonText: string | null; adButtonUrl: string | null }
  ) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可配置广告。" };
    }
    const normalized = normalizeAdConfig(JSON.stringify(config));
    if (Buffer.byteLength(normalized.prevText, "utf8") > 60 || Buffer.byteLength(normalized.nextText, "utf8") > 60) {
      return { ok: false, message: "⚠️ 翻页文案过长，请控制在 60 字节以内。" };
    }
    if (normalized.adButtonText && Buffer.byteLength(normalized.adButtonText, "utf8") > 60) {
      return { ok: false, message: "⚠️ 广告按钮文案过长，请控制在 60 字节以内。" };
    }
    if (normalized.adButtonUrl && !/^https?:\/\//i.test(normalized.adButtonUrl)) {
      return { ok: false, message: "⚠️ 广告链接格式错误：仅支持 http/https。" };
    }
    await deps.upsertSetting(deps.settingKeys.deliveryAdConfig, JSON.stringify(normalized));
    return { ok: true, message: "✅ 已更新广告配置。" };
  };

  const getTenantProtectContentEnabled = async () => parseBooleanSetting(await deps.getSetting(deps.settingKeys.protectContentEnabled));

  const setTenantProtectContentEnabled = async (actorUserId: string, enabled: boolean) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可修改内容保护。" };
    }
    if (enabled) {
      await deps.upsertSetting(deps.settingKeys.protectContentEnabled, "1");
      return { ok: true, message: "✅ 已开启内容保护：用户领取后不可转发/保存。" };
    }
    await deps.deleteSetting(deps.settingKeys.protectContentEnabled);
    return { ok: true, message: "✅ 已关闭内容保护。" };
  };

  const getTenantHidePublisherEnabled = async () => parseBooleanSetting(await deps.getSetting(deps.settingKeys.hidePublisherEnabled));

  const setTenantHidePublisherEnabled = async (actorUserId: string, enabled: boolean) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可修改隐藏发布者设置。" };
    }
    if (enabled) {
      await deps.upsertSetting(deps.settingKeys.hidePublisherEnabled, "1");
      return { ok: true, message: "✅ 已开启隐藏发布者。" };
    }
    await deps.deleteSetting(deps.settingKeys.hidePublisherEnabled);
    return { ok: true, message: "✅ 已关闭隐藏发布者。" };
  };

  const getTenantAutoCategorizeEnabled = async () => parseBooleanSetting(await deps.getSetting(deps.settingKeys.autoCategorizeEnabled));

  const setTenantAutoCategorizeEnabled = async (actorUserId: string, enabled: boolean) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可修改自动归类设置。" };
    }
    if (enabled) {
      await deps.upsertSetting(deps.settingKeys.autoCategorizeEnabled, "1");
      return { ok: true, message: "✅ 已开启自动归类：保存标题/描述后尝试自动分配分类。" };
    }
    await deps.deleteSetting(deps.settingKeys.autoCategorizeEnabled);
    return { ok: true, message: "✅ 已关闭自动归类。" };
  };

  const getTenantAutoCategorizeRules = async () => {
    const raw = await deps.getSetting(deps.settingKeys.autoCategorizeRules);
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      const rules: { collectionId: string; keywords: string[] }[] = [];
      for (const row of parsed) {
        if (!row || typeof row !== "object") {
          continue;
        }
        const item = row as { collectionId?: unknown; keywords?: unknown };
        if (typeof item.collectionId !== "string" || !item.collectionId.trim()) {
          continue;
        }
        if (!Array.isArray(item.keywords)) {
          continue;
        }
        const keywords = item.keywords
          .filter((k): k is string => typeof k === "string")
          .map((k) => k.trim())
          .filter(Boolean)
          .slice(0, 20);
        if (keywords.length === 0) {
          continue;
        }
        rules.push({ collectionId: item.collectionId.trim(), keywords });
      }
      return rules.slice(0, 50);
    } catch {
      return [];
    }
  };

  const setTenantAutoCategorizeRules = async (actorUserId: string, rules: { collectionId: string; keywords: string[] }[]) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可修改自动归类规则。" };
    }
    const normalized: { collectionId: string; keywords: string[] }[] = [];
    for (const row of Array.isArray(rules) ? rules : []) {
      const collectionId = typeof row?.collectionId === "string" ? row.collectionId.trim() : "";
      if (!collectionId) {
        continue;
      }
      const keywords = Array.isArray(row.keywords)
        ? row.keywords
            .filter((k): k is string => typeof k === "string")
            .map((k) => k.trim())
            .filter(Boolean)
            .slice(0, 20)
        : [];
      if (keywords.length === 0) {
        continue;
      }
      normalized.push({ collectionId, keywords });
    }
    const limited = normalized.slice(0, 50);
    if (limited.length === 0) {
      await deps.deleteSetting(deps.settingKeys.autoCategorizeRules);
      return { ok: true, message: "✅ 已清空自动归类规则。" };
    }
    await deps.upsertSetting(deps.settingKeys.autoCategorizeRules, JSON.stringify(limited));
    return { ok: true, message: `✅ 已更新自动归类规则（${limited.length} 条）。` };
  };

  const getTenantPublicRankingEnabled = async () => parseBooleanSetting(await deps.getSetting(deps.settingKeys.publicRankingEnabled));

  const setTenantPublicRankingEnabled = async (actorUserId: string, enabled: boolean) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可修改排行开放设置。" };
    }
    if (enabled) {
      await deps.upsertSetting(deps.settingKeys.publicRankingEnabled, "1");
      return { ok: true, message: "✅ 已对用户开放排行。" };
    }
    await deps.deleteSetting(deps.settingKeys.publicRankingEnabled);
    return { ok: true, message: "✅ 已关闭用户排行入口。" };
  };

  const getBroadcastTargetCount = async (actorUserId: string) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return 0;
    }
    const ids = await getBroadcastTargetUserIds();
    return ids.length;
  };

  const createBroadcastDraft = async (actorUserId: string, actorChatId: string) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可创建推送。" };
    }
    const tenantId = await deps.getTenantId();
    const draft = await deps.prisma.broadcast.create({
      data: { tenantId, creatorUserId: actorUserId, creatorChatId: actorChatId, status: "DRAFT", contentHtml: "" },
      select: { id: true }
    });
    return { ok: true, id: draft.id, message: "✅ 已创建推送草稿。" };
  };

  const listMyBroadcasts = async (actorUserId: string, limit: number) => {
    const tenantId = await deps.getTenantId();
    const take = normalizeLimit(limit, { defaultLimit: 10, maxLimit: 30 });
    const rows = await deps.prisma.broadcast.findMany({
      where: { tenantId, creatorUserId: actorUserId },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take
    });
    return rows.map(toBroadcastSummary);
  };

  const getBroadcastById = async (actorUserId: string, broadcastId: string) => {
    const tenantId = await deps.getTenantId();
    const row = await deps.prisma.broadcast.findFirst({
      where: { id: broadcastId, tenantId, creatorUserId: actorUserId }
    });
    return row ? toBroadcastSummary(row) : null;
  };

  const getMyBroadcastDraft = async (actorUserId: string) => {
    const rows = await listMyBroadcasts(actorUserId, 20);
    return rows.find((row) => row.status === "DRAFT" || row.status === "SCHEDULED" || row.status === "RUNNING") ?? null;
  };

  const updateBroadcastDraftContent = async (
    actorUserId: string,
    draftId: string,
    input: { contentHtml: string; mediaKind: string | null; mediaFileId: string | null }
  ) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可编辑推送。" };
    }
    const tenantId = await deps.getTenantId();
    const existing = await deps.prisma.broadcast.findFirst({
      where: { id: draftId, tenantId, creatorUserId: actorUserId, status: "DRAFT" },
      select: { id: true }
    });
    if (!existing) {
      return { ok: false, message: "⚠️ 草稿不存在或已不可编辑。" };
    }
    const html = input.contentHtml.trim();
    if (!html && !input.mediaFileId) {
      return { ok: false, message: "⚠️ 文案与媒体至少设置一项。" };
    }
    if (Buffer.byteLength(html, "utf8") > 4000) {
      return { ok: false, message: "⚠️ 文案过长，请控制在 4000 字节以内。" };
    }
    await deps.prisma.broadcast.update({
      where: { id: existing.id },
      data: { contentHtml: html, mediaKind: input.mediaKind, mediaFileId: input.mediaFileId }
    });
    return { ok: true, message: "✅ 已更新推送内容。" };
  };

  const updateBroadcastDraftButtons = async (actorUserId: string, draftId: string, buttons: { text: string; url: string }[]) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可编辑推送。" };
    }
    const tenantId = await deps.getTenantId();
    const existing = await deps.prisma.broadcast.findFirst({
      where: { id: draftId, tenantId, creatorUserId: actorUserId, status: "DRAFT" },
      select: { id: true }
    });
    if (!existing) {
      return { ok: false, message: "⚠️ 草稿不存在或已不可编辑。" };
    }
    const trimmed = buttons
      .map((b) => ({ text: b.text.trim(), url: b.url.trim() }))
      .filter((b) => b.text && b.url);
    if (trimmed.length > 6) {
      return { ok: false, message: "⚠️ 按钮过多，最多 6 个。" };
    }
    for (const item of trimmed) {
      if (Buffer.byteLength(item.text, "utf8") > 60) {
        return { ok: false, message: "⚠️ 按钮文案过长，请控制在 60 字节以内。" };
      }
      if (!/^https?:\/\//i.test(item.url)) {
        return { ok: false, message: "⚠️ 按钮链接格式错误：仅支持 http/https。" };
      }
    }
    await deps.prisma.broadcast.update({ where: { id: existing.id }, data: { buttons: trimmed as unknown as object } });
    return { ok: true, message: "✅ 已更新按钮配置。" };
  };

  const scheduleBroadcast = async (
    actorUserId: string,
    draftId: string,
    schedule: { nextRunAt: Date; repeatEveryMs?: number | null }
  ) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可发起推送。" };
    }
    const tenantId = await deps.getTenantId();
    const draft = await deps.prisma.broadcast.findFirst({
      where: { id: draftId, tenantId, creatorUserId: actorUserId, status: "DRAFT" }
    });
    if (!draft) {
      return { ok: false, message: "⚠️ 草稿不存在或已不可推送。" };
    }
    if (!draft.contentHtml.trim() && !draft.mediaFileId) {
      return { ok: false, message: "⚠️ 请先编辑推送内容或设置媒体。" };
    }
    const nextRunAt = schedule.nextRunAt;
    if (!(nextRunAt instanceof Date) || Number.isNaN(nextRunAt.getTime())) {
      return { ok: false, message: "⚠️ 时间格式错误。" };
    }
    const repeatEveryMs = schedule.repeatEveryMs ?? null;
    if (repeatEveryMs !== null && (repeatEveryMs < 5 * 60 * 1000 || repeatEveryMs > 365 * 24 * 60 * 60 * 1000)) {
      return { ok: false, message: "⚠️ 循环间隔不合法：最小 5 分钟，最大 365 天。" };
    }
    await deps.prisma.broadcast.update({ where: { id: draft.id }, data: { status: "SCHEDULED", nextRunAt, repeatEveryMs } });
    return { ok: true, message: repeatEveryMs ? "✅ 已创建循环推送。" : "✅ 已创建定时推送。" };
  };

  const cancelBroadcast = async (actorUserId: string, broadcastId: string) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可取消推送。" };
    }
    const tenantId = await deps.getTenantId();
    const existing = await deps.prisma.broadcast.findFirst({
      where: { id: broadcastId, tenantId, creatorUserId: actorUserId, status: { in: ["SCHEDULED", "RUNNING"] } },
      select: { id: true }
    });
    if (!existing) {
      return { ok: false, message: "⚠️ 推送不存在或不可取消。" };
    }
    await deps.prisma.broadcast.update({ where: { id: existing.id }, data: { status: "CANCELED", nextRunAt: null, repeatEveryMs: null } });
    return { ok: true, message: "✅ 已取消推送。" };
  };

  const deleteBroadcastDraft = async (actorUserId: string, draftId: string) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可删除草稿。" };
    }
    const tenantId = await deps.getTenantId();
    const existing = await deps.prisma.broadcast.findFirst({
      where: { id: draftId, tenantId, creatorUserId: actorUserId, status: "DRAFT" },
      select: { id: true }
    });
    if (!existing) {
      return { ok: true, message: "✅ 草稿不存在或已删除。" };
    }
    await deps.prisma.broadcast.delete({ where: { id: existing.id } });
    return { ok: true, message: "✅ 已删除草稿。" };
  };

  const listBroadcastRuns = async (actorUserId: string, broadcastId: string, limit: number) => {
    if (!(await deps.isTenantAdmin(actorUserId))) {
      return [];
    }
    const tenantId = await deps.getTenantId();
    const existing = await deps.prisma.broadcast.findFirst({
      where: { id: broadcastId, tenantId, creatorUserId: actorUserId },
      select: { id: true }
    });
    if (!existing) {
      return [];
    }
    const take = normalizeLimit(limit, { defaultLimit: 10, maxLimit: 20 });
    return deps.prisma.broadcastRun.findMany({
      where: { broadcastId: existing.id },
      orderBy: { startedAt: "desc" },
      take,
      select: {
        id: true,
        targetCount: true,
        successCount: true,
        failedCount: true,
        blockedCount: true,
        startedAt: true,
        finishedAt: true
      }
    });
  };

  return {
    listMyBroadcasts,
    getBroadcastById,
    getTenantStartWelcomeHtml,
    setTenantStartWelcomeHtml,
    getTenantDeliveryAdConfig,
    setTenantDeliveryAdConfig,
    getTenantProtectContentEnabled,
    setTenantProtectContentEnabled,
    getTenantHidePublisherEnabled,
    setTenantHidePublisherEnabled,
    getTenantAutoCategorizeEnabled,
    setTenantAutoCategorizeEnabled,
    getTenantAutoCategorizeRules,
    setTenantAutoCategorizeRules,
    getTenantPublicRankingEnabled,
    setTenantPublicRankingEnabled,
    getBroadcastTargetCount,
    createBroadcastDraft,
    getMyBroadcastDraft,
    updateBroadcastDraftContent,
    updateBroadcastDraftButtons,
    scheduleBroadcast,
    cancelBroadcast,
    deleteBroadcastDraft,
    listBroadcastRuns
  };
};
