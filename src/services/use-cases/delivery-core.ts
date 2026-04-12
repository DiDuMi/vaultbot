import type { PrismaClient } from "@prisma/client";
import { normalizeMinReplicas } from "./delivery-strategy";

export const createDeliveryCore = (deps: {
  prisma: PrismaClient;
  config: { tenantCode: string; tenantName: string };
}) => {
  const pad2 = (value: number) => String(value).padStart(2, "0");
  const formatLocalDate = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const startOfLocalDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const startOfLocalWeek = (date: Date) => {
    const day = startOfLocalDay(date);
    const weekday = day.getDay();
    const offset = weekday === 0 ? 6 : weekday - 1;
    return new Date(day.getTime() - offset * 24 * 60 * 60 * 1000);
  };
  const startOfLocalMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);

  const tenantSettingKeys = {
    protectContentEnabled: "protect_content_enabled",
    hidePublisherEnabled: "hide_publisher_enabled",
    publicRankingEnabled: "public_ranking_enabled",
    autoCategorizeEnabled: "auto_categorize_enabled"
  } as const;

  const parseTruthyEnv = (name: string) => {
    const raw = process.env[name];
    if (!raw || raw.trim() === "") {
      return null;
    }
    const value = raw.trim().toLowerCase();
    return value === "1" || value === "true" || value === "yes" || value === "on";
  };

  const bootstrapTenantSettings = async (tenantId: string) => {
    const entries = [
      { key: tenantSettingKeys.hidePublisherEnabled, enabled: parseTruthyEnv("TENANT_BOOTSTRAP_HIDE_PUBLISHER_ENABLED") },
      { key: tenantSettingKeys.protectContentEnabled, enabled: parseTruthyEnv("TENANT_BOOTSTRAP_PROTECT_CONTENT_ENABLED") },
      { key: tenantSettingKeys.publicRankingEnabled, enabled: parseTruthyEnv("TENANT_BOOTSTRAP_PUBLIC_RANKING_ENABLED") },
      { key: tenantSettingKeys.autoCategorizeEnabled, enabled: parseTruthyEnv("TENANT_BOOTSTRAP_AUTO_CATEGORIZE_ENABLED") }
    ].filter((entry) => entry.enabled === true);
    if (entries.length === 0) {
      return;
    }
    const keys = entries.map((entry) => entry.key);
    const existing = await deps.prisma.tenantSetting.findMany({ where: { tenantId, key: { in: keys } }, select: { key: true } });
    const existingKeys = new Set(existing.map((row) => row.key));
    const missing = entries.filter((entry) => !existingKeys.has(entry.key)).map((entry) => ({ tenantId, key: entry.key, value: "1" }));
    if (missing.length === 0) {
      return;
    }
    await deps.prisma.tenantSetting.createMany({ data: missing, skipDuplicates: true });
  };

  const ensureTenant = async () => {
    const tenant = await deps.prisma.tenant.upsert({
      where: { code: deps.config.tenantCode },
      update: { name: deps.config.tenantName },
      create: { code: deps.config.tenantCode, name: deps.config.tenantName }
    });
    await bootstrapTenantSettings(tenant.id).catch(() => undefined);
    return tenant.id;
  };

  let cachedTenantId: Promise<string> | null = null;
  const getTenantId = async () => {
    if (!cachedTenantId) {
      cachedTenantId = ensureTenant().catch((error) => {
        cachedTenantId = null;
        throw error;
      });
    }
    return cachedTenantId;
  };

  const ensureInitialOwner = async (tenantId: string, userId: string) => {
    const anyMember = await deps.prisma.tenantMember.findFirst({ where: { tenantId }, select: { id: true } });
    if (anyMember) {
      return false;
    }
    const batch = await deps.prisma.uploadBatch.findFirst({
      where: { tenantId, userId, status: "COMMITTED" },
      select: { id: true }
    });
    if (!batch) {
      return false;
    }
    try {
      await deps.prisma.tenantMember.create({ data: { tenantId, tgUserId: userId, role: "OWNER" } });
    } catch {
      return true;
    }
    return true;
  };

  const isTenantAdmin = async (userId: string) => {
    const tenantId = await getTenantId();
    const member = await deps.prisma.tenantMember.findFirst({ where: { tenantId, tgUserId: userId } });
    if (member?.role === "OWNER" || member?.role === "ADMIN") {
      return true;
    }
    return ensureInitialOwner(tenantId, userId);
  };

  const getTenantSearchMode = async () => {
    const tenantId = await getTenantId();
    const tenant = await deps.prisma.tenant.findUnique({ where: { id: tenantId }, select: { searchMode: true } });
    const mode = tenant?.searchMode ?? "ENTITLED_ONLY";
    return mode === "OFF" || mode === "ENTITLED_ONLY" || mode === "PUBLIC" ? mode : "ENTITLED_ONLY";
  };

  const setTenantSearchMode = async (actorUserId: string, mode: "OFF" | "ENTITLED_ONLY" | "PUBLIC") => {
    if (!(await isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可修改搜索开放设置。" };
    }
    const tenantId = await getTenantId();
    const nextMode = mode === "OFF" || mode === "ENTITLED_ONLY" || mode === "PUBLIC" ? mode : "ENTITLED_ONLY";
    await deps.prisma.tenant.update({ where: { id: tenantId }, data: { searchMode: nextMode } });
    if (nextMode === "PUBLIC") {
      return { ok: true, message: "✅ 已对用户开放搜索。" };
    }
    if (nextMode === "OFF") {
      return { ok: true, message: "✅ 已关闭搜索。" };
    }
    return { ok: true, message: "✅ 已设置为仅租户可搜索。" };
  };

  const getTenantMinReplicas = async () => {
    const tenantId = await getTenantId();
    const row = await deps.prisma.tenantSetting
      .findUnique({
        where: { tenantId_key: { tenantId, key: "min_replicas" } },
        select: { value: true }
      })
      .catch(() => null);
    const raw = row?.value ?? null;
    const parsed = raw ? Number(raw) : 1;
    return normalizeMinReplicas(parsed);
  };

  const setTenantMinReplicas = async (actorUserId: string, value: number) => {
    if (!(await isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可修改副本最小成功数。" };
    }
    const tenantId = await getTenantId();
    const next = normalizeMinReplicas(value);
    await deps.prisma.tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key: "min_replicas" } },
      update: { value: String(next) },
      create: { tenantId, key: "min_replicas", value: String(next) }
    });
    return { ok: true, message: `✅ 已设置副本最小成功数：<b>${next}</b>` };
  };

  const resolveShareCode = async (shareCode: string) => {
    const asset = await deps.prisma.asset.findUnique({ where: { shareCode } });
    return asset?.id ?? null;
  };

  const trackOpen = async (tenantId: string, userId: string, assetId: string) => {
    await deps.prisma.event.create({ data: { tenantId, userId, assetId, type: "OPEN" } });
  };

  const trackVisit = async (
    userId: string,
    source: "start" | "start_payload" | "home" | "help",
    metadata?: Record<string, unknown>
  ) => {
    const tenantId = await getTenantId();
    await deps.prisma.event.create({ data: { tenantId, userId, type: "IMPRESSION", payload: { source, ...metadata } } });
  };

  return {
    formatLocalDate,
    startOfLocalDay,
    startOfLocalWeek,
    startOfLocalMonth,
    getTenantId,
    ensureInitialOwner,
    isTenantAdmin,
    getTenantSearchMode,
    setTenantSearchMode,
    getTenantMinReplicas,
    setTenantMinReplicas,
    resolveShareCode,
    trackOpen,
    trackVisit
  };
};
