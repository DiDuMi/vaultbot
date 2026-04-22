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
  prevText: "\u2b05\ufe0f \u4e0a\u4e00\u9875",
  nextText: "\u4e0b\u4e00\u9875 \u27a1\ufe0f",
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

export const createProjectAdmin = (deps: {
  prisma: PrismaClient;
  settingKeys: SettingKeys;
  getRuntimeProjectId: () => Promise<string>;
  canManageProject: (userId: string) => Promise<boolean>;
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

  const findOwnedBroadcast = async (
    projectId: string,
    actorUserId: string,
    broadcastId: string,
    options?: {
      statuses?: Array<"DRAFT" | "SCHEDULED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED">;
      select?: Record<string, unknown>;
    }
  ): Promise<any> => {
    const baseWhere = {
      id: broadcastId,
      creatorUserId: actorUserId,
      ...(options?.statuses ? { status: options.statuses.length === 1 ? options.statuses[0] : { in: options.statuses } } : {})
    };
    if (options?.select) {
      return (
        (await deps.prisma.broadcast.findFirst({
          where: { ...baseWhere, projectId },
          select: options.select as never
        })) ??
        (await deps.prisma.broadcast.findFirst({
          where: { ...baseWhere, tenantId: projectId },
          select: options.select as never
        }))
      );
    }
    return (
      (await deps.prisma.broadcast.findFirst({
        where: { ...baseWhere, projectId }
      })) ??
      (await deps.prisma.broadcast.findFirst({
        where: { ...baseWhere, tenantId: projectId }
      }))
    );
  };

  const getBroadcastTargetUserIds = async () => {
    const projectId = await deps.getRuntimeProjectId();
    const [projectUsers, projectTenantUsers, members] = await Promise.all([
      deps.prisma.event.groupBy({ by: ["userId"], where: { projectId } }).catch(() => []),
      deps.prisma.tenantUser.findMany({ where: { projectId }, select: { tgUserId: true } }).catch(() => []),
      deps.prisma.tenantMember.findMany({ where: { tenantId: projectId }, select: { tgUserId: true } })
    ]);
    const [users, tenantUsers] =
      projectUsers.length > 0 || projectTenantUsers.length > 0
        ? [projectUsers, projectTenantUsers]
        : await Promise.all([
            deps.prisma.event.groupBy({ by: ["userId"], where: { tenantId: projectId } }),
            deps.prisma.tenantUser.findMany({ where: { tenantId: projectId }, select: { tgUserId: true } })
          ]);
    const excluded = new Set(members.map((m) => m.tgUserId));
    const audience = new Set<string>();
    for (const row of users) {
      if (row.userId) {
        audience.add(row.userId);
      }
    }
    for (const row of tenantUsers) {
      if (row.tgUserId) {
        audience.add(row.tgUserId);
      }
    }
    return Array.from(audience).filter((id) => !excluded.has(id));
  };

  const getProjectStartWelcomeHtml = async () => deps.getSetting(deps.settingKeys.startWelcomeHtml);
  const setProjectStartWelcomeHtml = async (actorUserId: string, html: string | null) => {
    if (!(await deps.canManageProject(actorUserId))) {
      return { ok: false, message: "\u65e0\u6743\u9650\uff1a\u4ec5\u7ba1\u7406\u5458\u53ef\u4fee\u6539\u6b22\u8fce\u8bcd\u3002" };
    }
    const normalized = html ? html.trim() : "";
    if (!normalized) {
      await deps.deleteSetting(deps.settingKeys.startWelcomeHtml);
      return { ok: true, message: "\u5df2\u91cd\u7f6e\u6b22\u8fce\u8bcd\u3002" };
    }
    if (Buffer.byteLength(normalized, "utf8") > 4000) {
      return { ok: false, message: "\u6b22\u8fce\u8bcd\u8fc7\u957f\uff0c\u8bf7\u63a7\u5236\u5728 4000 \u5b57\u8282\u4ee5\u5185\u3002" };
    }
    await deps.upsertSetting(deps.settingKeys.startWelcomeHtml, normalized);
    return { ok: true, message: "\u5df2\u66f4\u65b0\u6b22\u8fce\u8bcd\u3002" };
  };
  const getProjectDeliveryAdConfig = async () => {
    const raw = await deps.getSetting(deps.settingKeys.deliveryAdConfig);
    return normalizeAdConfig(raw);
  };

  const setProjectDeliveryAdConfig = async (
    actorUserId: string,
    config: { prevText: string; nextText: string; adButtonText: string | null; adButtonUrl: string | null }
  ) => {
    if (!(await deps.canManageProject(actorUserId))) {
      return { ok: false, message: "\u65e0\u6743\u9650\uff1a\u4ec5\u7ba1\u7406\u5458\u53ef\u914d\u7f6e\u5e7f\u544a\u3002" };
    }
    const normalized = normalizeAdConfig(JSON.stringify(config));
    if (Buffer.byteLength(normalized.prevText, "utf8") > 60 || Buffer.byteLength(normalized.nextText, "utf8") > 60) {
      return { ok: false, message: "\u7ffb\u9875\u6587\u6848\u8fc7\u957f\uff0c\u8bf7\u63a7\u5236\u5728 60 \u5b57\u8282\u4ee5\u5185\u3002" };
    }
    if (normalized.adButtonText && Buffer.byteLength(normalized.adButtonText, "utf8") > 60) {
      return { ok: false, message: "\u5e7f\u544a\u6309\u94ae\u6587\u6848\u8fc7\u957f\uff0c\u8bf7\u63a7\u5236\u5728 60 \u5b57\u8282\u4ee5\u5185\u3002" };
    }
    if (normalized.adButtonUrl && !/^https?:\/\//i.test(normalized.adButtonUrl)) {
      return { ok: false, message: "\u5e7f\u544a\u94fe\u63a5\u683c\u5f0f\u9519\u8bef\uff1a\u4ec5\u652f\u6301 http/https\u3002" };
    }
    await deps.upsertSetting(deps.settingKeys.deliveryAdConfig, JSON.stringify(normalized));
    return { ok: true, message: "\u5df2\u66f4\u65b0\u5e7f\u544a\u914d\u7f6e\u3002" };
  };
  const getProjectProtectContentEnabled = async () => parseBooleanSetting(await deps.getSetting(deps.settingKeys.protectContentEnabled));

  const setProjectProtectContentEnabled = async (actorUserId: string, enabled: boolean) => {
    if (!(await deps.canManageProject(actorUserId))) {
      return { ok: false, message: "\u65e0\u6743\u9650\uff1a\u4ec5\u7ba1\u7406\u5458\u53ef\u4fee\u6539\u5185\u5bb9\u4fdd\u62a4\u3002" };
    }
    if (enabled) {
      await deps.upsertSetting(deps.settingKeys.protectContentEnabled, "1");
      return { ok: true, message: "\u5df2\u5f00\u542f\u5185\u5bb9\u4fdd\u62a4\uff1a\u7528\u6237\u9886\u53d6\u540e\u4e0d\u53ef\u8f6c\u53d1\u6216\u4fdd\u5b58\u3002" };
    }
    await deps.deleteSetting(deps.settingKeys.protectContentEnabled);
    return { ok: true, message: "\u5df2\u5173\u95ed\u5185\u5bb9\u4fdd\u62a4\u3002" };
  };
  const getProjectHidePublisherEnabled = async () => parseBooleanSetting(await deps.getSetting(deps.settingKeys.hidePublisherEnabled));

  const setProjectHidePublisherEnabled = async (actorUserId: string, enabled: boolean) => {
    if (!(await deps.canManageProject(actorUserId))) {
      return { ok: false, message: "\u65e0\u6743\u9650\uff1a\u4ec5\u7ba1\u7406\u5458\u53ef\u4fee\u6539\u9690\u85cf\u53d1\u5e03\u8005\u8bbe\u7f6e\u3002" };
    }
    if (enabled) {
      await deps.upsertSetting(deps.settingKeys.hidePublisherEnabled, "1");
      return { ok: true, message: "\u5df2\u5f00\u542f\u9690\u85cf\u53d1\u5e03\u8005\u3002" };
    }
    await deps.deleteSetting(deps.settingKeys.hidePublisherEnabled);
    return { ok: true, message: "\u5df2\u5173\u95ed\u9690\u85cf\u53d1\u5e03\u8005\u3002" };
  };
  const getProjectAutoCategorizeEnabled = async () => parseBooleanSetting(await deps.getSetting(deps.settingKeys.autoCategorizeEnabled));

  const setProjectAutoCategorizeEnabled = async (actorUserId: string, enabled: boolean) => {
    if (!(await deps.canManageProject(actorUserId))) {
      return { ok: false, message: "\u65e0\u6743\u9650\uff1a\u4ec5\u7ba1\u7406\u5458\u53ef\u4fee\u6539\u81ea\u52a8\u5f52\u7c7b\u8bbe\u7f6e\u3002" };
    }
    if (enabled) {
      await deps.upsertSetting(deps.settingKeys.autoCategorizeEnabled, "1");
      return { ok: true, message: "\u5df2\u5f00\u542f\u81ea\u52a8\u5f52\u7c7b\uff1a\u4fdd\u5b58\u6807\u9898/\u63cf\u8ff0\u540e\u5c06\u5c1d\u8bd5\u81ea\u52a8\u5206\u914d\u5206\u7c7b\u3002" };
    }
    await deps.deleteSetting(deps.settingKeys.autoCategorizeEnabled);
    return { ok: true, message: "\u5df2\u5173\u95ed\u81ea\u52a8\u5f52\u7c7b\u3002" };
  };
  const getProjectAutoCategorizeRules = async () => {
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
  const setProjectAutoCategorizeRules = async (actorUserId: string, rules: { collectionId: string; keywords: string[] }[]) => {
    if (!(await deps.canManageProject(actorUserId))) {
      return { ok: false, message: "\u65e0\u6743\u9650\uff1a\u4ec5\u7ba1\u7406\u5458\u53ef\u4fee\u6539\u81ea\u52a8\u5f52\u7c7b\u89c4\u5219\u3002" };
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
      return { ok: true, message: "\u5df2\u6e05\u7a7a\u81ea\u52a8\u5f52\u7c7b\u89c4\u5219\u3002" };
    }
    await deps.upsertSetting(deps.settingKeys.autoCategorizeRules, JSON.stringify(limited));
    return { ok: true, message: `\u5df2\u66f4\u65b0\u81ea\u52a8\u5f52\u7c7b\u89c4\u5219\uff08${limited.length} \u6761\uff09\u3002` };
  };
  const getProjectPublicRankingEnabled = async () => parseBooleanSetting(await deps.getSetting(deps.settingKeys.publicRankingEnabled));

  const setProjectPublicRankingEnabled = async (actorUserId: string, enabled: boolean) => {
    if (!(await deps.canManageProject(actorUserId))) {
      return { ok: false, message: "\u65e0\u6743\u9650\uff1a\u4ec5\u7ba1\u7406\u5458\u53ef\u4fee\u6539\u6392\u884c\u5f00\u653e\u8bbe\u7f6e\u3002" };
    }
    if (enabled) {
      await deps.upsertSetting(deps.settingKeys.publicRankingEnabled, "1");
      return { ok: true, message: "\u5df2\u5411\u7528\u6237\u5f00\u653e\u6392\u884c\u5165\u53e3\u3002" };
    }
    await deps.deleteSetting(deps.settingKeys.publicRankingEnabled);
    return { ok: true, message: "\u5df2\u5173\u95ed\u7528\u6237\u6392\u884c\u5165\u53e3\u3002" };
  };
  const getBroadcastTargetCount = async (actorUserId: string) => {
    if (!(await deps.canManageProject(actorUserId))) {
      return 0;
    }
    const ids = await getBroadcastTargetUserIds();
    return ids.length;
  };

  const createBroadcastDraft = async (actorUserId: string, actorChatId: string) => {
    if (!(await deps.canManageProject(actorUserId))) {
      return { ok: false, message: "\u65e0\u6743\u9650\uff1a\u4ec5\u7ba1\u7406\u5458\u53ef\u521b\u5efa\u63a8\u9001\u3002" };
    }
    const projectId = await deps.getRuntimeProjectId();
    const draft = await deps.prisma.broadcast.create({
      data: { tenantId: projectId, projectId, creatorUserId: actorUserId, creatorChatId: actorChatId, status: "DRAFT", contentHtml: "" },
      select: { id: true }
    });
    return { ok: true, id: draft.id, message: "\u5df2\u521b\u5efa\u63a8\u9001\u8349\u7a3f\u3002" };
  };

  const listMyBroadcasts = async (actorUserId: string, limit: number) => {
    const projectId = await deps.getRuntimeProjectId();
    const take = normalizeLimit(limit, { defaultLimit: 10, maxLimit: 30 });
    const rows =
      (await deps.prisma.broadcast.findMany({
        where: { projectId, creatorUserId: actorUserId },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take
      })) ??
      [];
    const resolvedRows =
      rows.length > 0
        ? rows
        : await deps.prisma.broadcast.findMany({
            where: { tenantId: projectId, creatorUserId: actorUserId },
            orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
            take
          });
    return resolvedRows.map(toBroadcastSummary);
  };

  const getBroadcastById = async (actorUserId: string, broadcastId: string) => {
    const projectId = await deps.getRuntimeProjectId();
    const row = await findOwnedBroadcast(projectId, actorUserId, broadcastId);
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
    if (!(await deps.canManageProject(actorUserId))) {
      return { ok: false, message: "\u65e0\u6743\u9650\uff1a\u4ec5\u7ba1\u7406\u5458\u53ef\u7f16\u8f91\u63a8\u9001\u3002" };
    }
    const projectId = await deps.getRuntimeProjectId();
    const existing = await findOwnedBroadcast(projectId, actorUserId, draftId, {
      statuses: ["DRAFT"],
      select: { id: true }
    });
    if (!existing) {
      return { ok: false, message: "\u8349\u7a3f\u4e0d\u5b58\u5728\u6216\u5df2\u4e0d\u53ef\u7f16\u8f91\u3002" };
    }
    const html = input.contentHtml.trim();
    if (!html && !input.mediaFileId) {
      return { ok: false, message: "\u6587\u6848\u4e0e\u5a92\u4f53\u81f3\u5c11\u9700\u8bbe\u7f6e\u4e00\u9879\u3002" };
    }
    if (Buffer.byteLength(html, "utf8") > 4000) {
      return { ok: false, message: "\u6587\u6848\u8fc7\u957f\uff0c\u8bf7\u63a7\u5236\u5728 4000 \u5b57\u8282\u4ee5\u5185\u3002" };
    }
    await deps.prisma.broadcast.update({
      where: { id: existing.id },
      data: { contentHtml: html, mediaKind: input.mediaKind, mediaFileId: input.mediaFileId }
    });
    return { ok: true, message: "\u5df2\u66f4\u65b0\u63a8\u9001\u5185\u5bb9\u3002" };
  };

  const updateBroadcastDraftButtons = async (actorUserId: string, draftId: string, buttons: { text: string; url: string }[]) => {
    if (!(await deps.canManageProject(actorUserId))) {
      return { ok: false, message: "\u65e0\u6743\u9650\uff1a\u4ec5\u7ba1\u7406\u5458\u53ef\u7f16\u8f91\u63a8\u9001\u3002" };
    }
    const projectId = await deps.getRuntimeProjectId();
    const existing = await findOwnedBroadcast(projectId, actorUserId, draftId, {
      statuses: ["DRAFT"],
      select: { id: true }
    });
    if (!existing) {
      return { ok: false, message: "\u8349\u7a3f\u4e0d\u5b58\u5728\u6216\u5df2\u4e0d\u53ef\u7f16\u8f91\u3002" };
    }
    const trimmed = buttons
      .map((b) => ({ text: b.text.trim(), url: b.url.trim() }))
      .filter((b) => b.text && b.url);
    if (trimmed.length > 6) {
      return { ok: false, message: "\u6309\u94ae\u8fc7\u591a\uff0c\u6700\u591a 6 \u4e2a\u3002" };
    }
    for (const item of trimmed) {
      if (Buffer.byteLength(item.text, "utf8") > 60) {
        return { ok: false, message: "\u6309\u94ae\u6587\u6848\u8fc7\u957f\uff0c\u8bf7\u63a7\u5236\u5728 60 \u5b57\u8282\u4ee5\u5185\u3002" };
      }
      if (!/^https?:\/\//i.test(item.url)) {
        return { ok: false, message: "\u6309\u94ae\u94fe\u63a5\u683c\u5f0f\u9519\u8bef\uff1a\u4ec5\u652f\u6301 http/https\u3002" };
      }
    }
    await deps.prisma.broadcast.update({ where: { id: existing.id }, data: { buttons: trimmed as unknown as object } });
    return { ok: true, message: "\u5df2\u66f4\u65b0\u6309\u94ae\u914d\u7f6e\u3002" };
  };

  const scheduleBroadcast = async (
    actorUserId: string,
    draftId: string,
    schedule: { nextRunAt: Date; repeatEveryMs?: number | null }
  ) => {
    if (!(await deps.canManageProject(actorUserId))) {
      return { ok: false, message: "\u65e0\u6743\u9650\uff1a\u4ec5\u7ba1\u7406\u5458\u53ef\u53d1\u8d77\u63a8\u9001\u3002" };
    }
    const projectId = await deps.getRuntimeProjectId();
    const draft = await findOwnedBroadcast(projectId, actorUserId, draftId, {
      statuses: ["DRAFT"]
    });
    if (!draft) {
      return { ok: false, message: "\u8349\u7a3f\u4e0d\u5b58\u5728\u6216\u5df2\u4e0d\u53ef\u63a8\u9001\u3002" };
    }
    if (!draft.contentHtml.trim() && !draft.mediaFileId) {
      return { ok: false, message: "\u8bf7\u5148\u7f16\u8f91\u63a8\u9001\u5185\u5bb9\u6216\u8bbe\u7f6e\u5a92\u4f53\u3002" };
    }
    const nextRunAt = schedule.nextRunAt;
    if (!(nextRunAt instanceof Date) || Number.isNaN(nextRunAt.getTime())) {
      return { ok: false, message: "\u65f6\u95f4\u683c\u5f0f\u9519\u8bef\u3002" };
    }
    const repeatEveryMs = schedule.repeatEveryMs ?? null;
    if (repeatEveryMs !== null && (repeatEveryMs < 5 * 60 * 1000 || repeatEveryMs > 365 * 24 * 60 * 60 * 1000)) {
      return { ok: false, message: "\u5faa\u73af\u95f4\u9694\u4e0d\u5408\u6cd5\uff1a\u6700\u5c11 5 \u5206\u949f\uff0c\u6700\u591a 365 \u5929\u3002" };
    }
    await deps.prisma.broadcast.update({ where: { id: draft.id }, data: { status: "SCHEDULED", nextRunAt, repeatEveryMs } });
    return { ok: true, message: repeatEveryMs ? "\u5df2\u521b\u5efa\u5faa\u73af\u63a8\u9001\u3002" : "\u5df2\u521b\u5efa\u5b9a\u65f6\u63a8\u9001\u3002" };
  };

  const cancelBroadcast = async (actorUserId: string, broadcastId: string) => {
    if (!(await deps.canManageProject(actorUserId))) {
      return { ok: false, message: "\u65e0\u6743\u9650\uff1a\u4ec5\u7ba1\u7406\u5458\u53ef\u53d6\u6d88\u63a8\u9001\u3002" };
    }
    const projectId = await deps.getRuntimeProjectId();
    const existing = await findOwnedBroadcast(projectId, actorUserId, broadcastId, {
      statuses: ["SCHEDULED", "RUNNING"],
      select: { id: true }
    });
    if (!existing) {
      return { ok: false, message: "\u63a8\u9001\u4e0d\u5b58\u5728\u6216\u4e0d\u53ef\u53d6\u6d88\u3002" };
    }
    await deps.prisma.broadcast.update({ where: { id: existing.id }, data: { status: "CANCELED", nextRunAt: null, repeatEveryMs: null } });
    return { ok: true, message: "\u5df2\u53d6\u6d88\u63a8\u9001\u3002" };
  };

  const deleteBroadcastDraft = async (actorUserId: string, draftId: string) => {
    if (!(await deps.canManageProject(actorUserId))) {
      return { ok: false, message: "\u65e0\u6743\u9650\uff1a\u4ec5\u7ba1\u7406\u5458\u53ef\u5220\u9664\u8349\u7a3f\u3002" };
    }
    const projectId = await deps.getRuntimeProjectId();
    const existing = await findOwnedBroadcast(projectId, actorUserId, draftId, {
      statuses: ["DRAFT"],
      select: { id: true }
    });
    if (!existing) {
      return { ok: true, message: "\u8349\u7a3f\u4e0d\u5b58\u5728\u6216\u5df2\u5220\u9664\u3002" };
    }
    await deps.prisma.broadcast.delete({ where: { id: existing.id } });
    return { ok: true, message: "\u5df2\u5220\u9664\u8349\u7a3f\u3002" };
  };

  const listBroadcastRuns = async (actorUserId: string, broadcastId: string, limit: number) => {
    if (!(await deps.canManageProject(actorUserId))) {
      return [];
    }
    const projectId = await deps.getRuntimeProjectId();
    const existing = await findOwnedBroadcast(projectId, actorUserId, broadcastId, {
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
    getProjectStartWelcomeHtml,
    setProjectStartWelcomeHtml,
    getProjectDeliveryAdConfig,
    setProjectDeliveryAdConfig,
    getProjectProtectContentEnabled,
    setProjectProtectContentEnabled,
    getProjectHidePublisherEnabled,
    setProjectHidePublisherEnabled,
    getProjectAutoCategorizeEnabled,
    setProjectAutoCategorizeEnabled,
    getProjectAutoCategorizeRules,
    setProjectAutoCategorizeRules,
    getProjectPublicRankingEnabled,
    setProjectPublicRankingEnabled,
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

export const createDeliveryAdmin = createProjectAdmin;
