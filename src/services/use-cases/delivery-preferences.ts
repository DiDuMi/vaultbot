import type { PrismaClient } from "@prisma/client";

type PreferenceKeys = {
  defaultCollectionId: string;
  historyCollectionFilter: string;
  historyListDate: string;
  followKeywords: string;
  notifyFollowEnabled: string;
  notifyCommentEnabled: string;
  notifyState: string;
};

type NotifyState = {
  follow?: { lastAt?: number; ids?: { id: string; at: number }[] };
  comment?: { lastAt?: number; ids?: { id: string; at: number }[] };
};

export const createDeliveryPreferences = (deps: {
  prisma: PrismaClient;
  preferenceKeys: PreferenceKeys;
  getRuntimeProjectId: () => Promise<string>;
  getPreference: (tgUserId: string, key: string) => Promise<string | null>;
  upsertPreference: (tgUserId: string, key: string, value: string | null) => Promise<void>;
  deletePreference: (tgUserId: string, key: string) => Promise<void>;
  startOfLocalDay: (date: Date) => Date;
  formatLocalDate: (date: Date) => string;
}) => {
  const getUserDefaultCollectionId = async (userId: string) => {
    const value = await deps.getPreference(userId, deps.preferenceKeys.defaultCollectionId);
    return value || null;
  };

  const setUserDefaultCollectionId = async (userId: string, collectionId: string | null) => {
    await deps.upsertPreference(userId, deps.preferenceKeys.defaultCollectionId, collectionId);
  };

  const getUserHistoryCollectionFilter = async (userId: string) => {
    const value = await deps.getPreference(userId, deps.preferenceKeys.historyCollectionFilter);
    if (!value || value === "all") {
      return undefined;
    }
    if (value === "none") {
      return null;
    }
    return value;
  };

  const setUserHistoryCollectionFilter = async (userId: string, value: string | null | undefined) => {
    if (value === undefined) {
      await deps.deletePreference(userId, deps.preferenceKeys.historyCollectionFilter);
      return;
    }
    await deps.upsertPreference(userId, deps.preferenceKeys.historyCollectionFilter, value === null ? "none" : value);
  };

  const getUserHistoryListDate = async (userId: string) => {
    const value = await deps.getPreference(userId, deps.preferenceKeys.historyListDate);
    if (!value) {
      return undefined;
    }
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return undefined;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return undefined;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return undefined;
    }
    const date = new Date(year, month - 1, day);
    if (!Number.isFinite(date.getTime())) {
      return undefined;
    }
    return deps.startOfLocalDay(date);
  };

  const setUserHistoryListDate = async (userId: string, date: Date | undefined) => {
    if (!date) {
      await deps.deletePreference(userId, deps.preferenceKeys.historyListDate);
      return;
    }
    await deps.upsertPreference(userId, deps.preferenceKeys.historyListDate, deps.formatLocalDate(deps.startOfLocalDay(date)));
  };

  const normalizeFollowKeyword = (raw: string) => {
    const normalized = raw.trim().replace(/\s+/g, " ");
    if (!normalized) {
      return null;
    }
    if (Buffer.byteLength(normalized, "utf8") > 60) {
      return null;
    }
    return normalized;
  };

  const parseFollowKeywords = (value: string | null) => {
    if (!value) {
      return [];
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .map((item) => (typeof item === "string" ? normalizeFollowKeyword(item) : null))
        .filter((item): item is string => Boolean(item));
    } catch {
      return [];
    }
  };

  const getUserFollowKeywords = async (userId: string) => {
    const value = await deps.getPreference(userId, deps.preferenceKeys.followKeywords);
    return parseFollowKeywords(value).slice(0, 5);
  };

  const setUserFollowKeywords = async (userId: string, keywords: string[]) => {
    if (!Array.isArray(keywords)) {
      return { ok: false, message: "⚠️ 关键词格式错误。" };
    }
    const normalized = keywords
      .map((k) => (typeof k === "string" ? normalizeFollowKeyword(k) : null))
      .filter((k): k is string => Boolean(k));
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const k of normalized) {
      const key = k.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push(k);
      if (unique.length >= 5) {
        break;
      }
    }
    if (unique.length === 0) {
      await deps.deletePreference(userId, deps.preferenceKeys.followKeywords);
      return { ok: true, message: "✅ 已清空关注关键词。" };
    }
    await deps.upsertPreference(userId, deps.preferenceKeys.followKeywords, JSON.stringify(unique));
    return { ok: true, message: "✅ 已更新关注关键词。" };
  };

  const listFollowKeywordSubscriptions = async () => {
    const tenantId = await deps.getRuntimeProjectId();
    const rows = await deps.prisma.userPreference.findMany({
      where: { tenantId, key: deps.preferenceKeys.followKeywords },
      select: { tgUserId: true, value: true }
    });
    return rows
      .map((row) => ({ userId: row.tgUserId, keywords: parseFollowKeywords(row.value).slice(0, 5) }))
      .filter((row) => row.keywords.length > 0);
  };

  const parseEnabledFlag = (value: string | null) => {
    if (value === null) {
      return true;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === "0" || normalized === "false" || normalized === "off") {
      return false;
    }
    if (normalized === "1" || normalized === "true" || normalized === "on") {
      return true;
    }
    return true;
  };

  const getUserNotifySettings = async (userId: string) => {
    const [followRaw, commentRaw] = await Promise.all([
      deps.getPreference(userId, deps.preferenceKeys.notifyFollowEnabled),
      deps.getPreference(userId, deps.preferenceKeys.notifyCommentEnabled)
    ]);
    return { followEnabled: parseEnabledFlag(followRaw), commentEnabled: parseEnabledFlag(commentRaw) };
  };

  const setUserNotifySettings = async (userId: string, input: { followEnabled?: boolean; commentEnabled?: boolean }) => {
    const current = await getUserNotifySettings(userId);
    const next = {
      followEnabled: typeof input.followEnabled === "boolean" ? input.followEnabled : current.followEnabled,
      commentEnabled: typeof input.commentEnabled === "boolean" ? input.commentEnabled : current.commentEnabled
    };
    await Promise.all([
      typeof input.followEnabled === "boolean"
        ? deps.upsertPreference(userId, deps.preferenceKeys.notifyFollowEnabled, next.followEnabled ? "1" : "0")
        : Promise.resolve(),
      typeof input.commentEnabled === "boolean"
        ? deps.upsertPreference(userId, deps.preferenceKeys.notifyCommentEnabled, next.commentEnabled ? "1" : "0")
        : Promise.resolve()
    ]);
    return { ok: true, message: "✅ 已更新通知设置。", settings: next };
  };

  const parseNotifyState = (value: string | null): NotifyState => {
    if (!value) {
      return {};
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || typeof parsed !== "object") {
        return {};
      }
      return parsed as NotifyState;
    } catch {
      return {};
    }
  };

  const normalizeNotifyIds = (value: unknown, keepMs: number, max: number) => {
    if (!Array.isArray(value)) {
      return [];
    }
    const now = Date.now();
    return value
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const row = item as { id?: unknown; at?: unknown };
        if (typeof row.id !== "string") {
          return null;
        }
        const at = typeof row.at === "number" ? row.at : Number(row.at);
        if (!Number.isFinite(at)) {
          return null;
        }
        return { id: row.id, at };
      })
      .filter((item): item is { id: string; at: number } => Boolean(item))
      .filter((item) => now - item.at <= keepMs)
      .slice(-max);
  };

  const checkAndRecordUserNotification = async (
    userId: string,
    input: { type: "follow" | "comment"; uniqueId: string; minIntervalMs: number }
  ) => {
    const settings = await getUserNotifySettings(userId);
    if (input.type === "follow" && !settings.followEnabled) {
      return false;
    }
    if (input.type === "comment" && !settings.commentEnabled) {
      return false;
    }
    const keepMs = 7 * 24 * 60 * 60 * 1000;
    const maxIds = 200;
    const now = Date.now();
    const raw = await deps.getPreference(userId, deps.preferenceKeys.notifyState);
    const state = parseNotifyState(raw);
    const bucket = input.type === "follow" ? (state.follow ?? {}) : (state.comment ?? {});
    const ids = normalizeNotifyIds(bucket.ids, keepMs, maxIds);
    if (ids.some((x) => x.id === input.uniqueId)) {
      return false;
    }
    const lastAt = typeof bucket.lastAt === "number" ? bucket.lastAt : Number(bucket.lastAt);
    if (Number.isFinite(lastAt) && now - lastAt < input.minIntervalMs) {
      return false;
    }
    const nextBucket = { lastAt: now, ids: [...ids, { id: input.uniqueId, at: now }].slice(-maxIds) };
    const nextState: NotifyState = input.type === "follow" ? { ...state, follow: nextBucket } : { ...state, comment: nextBucket };
    await deps.upsertPreference(userId, deps.preferenceKeys.notifyState, JSON.stringify(nextState));
    return true;
  };

  return {
    getUserDefaultCollectionId,
    setUserDefaultCollectionId,
    getUserHistoryCollectionFilter,
    setUserHistoryCollectionFilter,
    getUserHistoryListDate,
    setUserHistoryListDate,
    getUserFollowKeywords,
    setUserFollowKeywords,
    listFollowKeywordSubscriptions,
    getUserNotifySettings,
    setUserNotifySettings,
    checkAndRecordUserNotification
  };
};
