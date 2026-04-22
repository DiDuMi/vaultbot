import type { PrismaClient } from "@prisma/client";
import { normalizeMinReplicas } from "./delivery-strategy";
import { logError } from "../../infra/logging";
import { ensureRuntimeProjectContext } from "../../infra/persistence/tenant-guard";
import { isSingleOwnerModeEnabled } from "../../infra/runtime-mode";
import { normalizeProjectContextConfig, type ProjectContextInput } from "../../project-context";

export const createDeliveryCore = (deps: {
  prisma: PrismaClient;
  config: ProjectContextInput;
}) => {
  type ProjectSearchMode = "OFF" | "ENTITLED_ONLY" | "PUBLIC";
  const projectContext = normalizeProjectContextConfig(deps.config);

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

  const bootstrapProjectSettings = async (projectId: string) => {
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
    const existing = await deps.prisma.tenantSetting.findMany({ where: { tenantId: projectId, key: { in: keys } }, select: { key: true } });
    const existingKeys = new Set(existing.map((row) => row.key));
    const missing = entries
      .filter((entry) => !existingKeys.has(entry.key))
      .map((entry) => ({ tenantId: projectId, projectId, key: entry.key, value: "1" }));
    if (missing.length === 0) {
      return;
    }
    await deps.prisma.tenantSetting.createMany({ data: missing, skipDuplicates: true });
  };

  const ensureProjectContext = async () => {
    const project = await ensureRuntimeProjectContext(deps.prisma, {
      code: projectContext.code,
      name: projectContext.name
    });
    await bootstrapProjectSettings(project.projectId).catch((error) =>
      logError({ component: "delivery_core", op: "bootstrap_project_settings", projectId: project.projectId }, error)
    );
    return project;
  };

  let cachedRuntimeProjectContext: Promise<{ projectId: string; code: string; name: string }> | null = null;
  const getRuntimeProjectContext = async () => {
    if (!cachedRuntimeProjectContext) {
      cachedRuntimeProjectContext = ensureProjectContext().catch((error) => {
        cachedRuntimeProjectContext = null;
        throw error;
      });
    }
    return cachedRuntimeProjectContext;
  };

  const getRuntimeProjectId = async () => {
    const project = await getRuntimeProjectContext();
    return project.projectId;
  };

  const getTenantId = async () => {
    return getRuntimeProjectId();
  };

  const ensureInitialOwner = async (projectId: string, userId: string) => {
    const anyMember = await deps.prisma.tenantMember.findFirst({ where: { tenantId: projectId }, select: { id: true } });
    if (anyMember) {
      return false;
    }
    const batch = await deps.prisma.uploadBatch.findFirst({
      where: { tenantId: projectId, userId, status: "COMMITTED" },
      select: { id: true }
    });
    if (!batch) {
      return false;
    }
    try {
      await deps.prisma.tenantMember.create({ data: { tenantId: projectId, tgUserId: userId, role: "OWNER" } });
    } catch {
      return true;
    }
    return true;
  };

  const isTenantAdmin = async (userId: string) => {
    const projectId = await getTenantId();
    const member = await deps.prisma.tenantMember.findFirst({ where: { tenantId: projectId, tgUserId: userId } });
    if (member?.role === "OWNER") {
      return true;
    }
    if (!isSingleOwnerModeEnabled() && member?.role === "ADMIN") {
      return true;
    }
    return ensureInitialOwner(projectId, userId);
  };

  const canManageProject = async (userId: string) => isTenantAdmin(userId);

  const getProjectSearchMode = async (): Promise<ProjectSearchMode> => {
    const tenantId = await getTenantId();
    const tenant = await deps.prisma.tenant.findUnique({ where: { id: tenantId }, select: { searchMode: true } });
    const mode = tenant?.searchMode ?? "ENTITLED_ONLY";
    return mode === "OFF" || mode === "ENTITLED_ONLY" || mode === "PUBLIC" ? mode : "ENTITLED_ONLY";
  };

  const setProjectSearchMode = async (actorUserId: string, mode: ProjectSearchMode) => {
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

  const getProjectMinReplicas = async () => {
    if (isSingleOwnerModeEnabled()) {
      return 1;
    }
    const tenantId = await getTenantId();
    const row =
      (await deps.prisma.tenantSetting
        .findUnique({
          where: { projectId_key: { projectId: tenantId, key: "min_replicas" } },
          select: { value: true }
        })
        .catch(() => null)) ??
      (await deps.prisma.tenantSetting
        .findUnique({
          where: { tenantId_key: { tenantId, key: "min_replicas" } },
          select: { value: true }
        })
        .catch(() => null));
    const raw = row?.value ?? null;
    const parsed = raw ? Number(raw) : 1;
    return normalizeMinReplicas(parsed);
  };

  const setProjectMinReplicas = async (actorUserId: string, value: number) => {
    if (!(await isTenantAdmin(actorUserId))) {
      return { ok: false, message: "🔒 无权限：仅管理员可修改副本最小成功数。" };
    }
    if (isSingleOwnerModeEnabled()) {
      return { ok: false, message: "当前为单人项目模式，副本最小成功数固定为 1。" };
    }
    const tenantId = await getTenantId();
    const next = normalizeMinReplicas(value);
    await deps.prisma.tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key: "min_replicas" } },
      update: { projectId: tenantId, value: String(next) },
      create: { tenantId, projectId: tenantId, key: "min_replicas", value: String(next) }
    });
    return { ok: true, message: `✅ 已设置副本最小成功数：<b>${next}</b>` };
  };

  const resolveShareCode = async (shareCode: string) => {
    const asset = await deps.prisma.asset.findUnique({ where: { shareCode } });
    return asset?.id ?? null;
  };

  const trackOpen = async (projectId: string, userId: string, assetId: string) => {
    await deps.prisma.event.create({ data: { tenantId: projectId, projectId, userId, assetId, type: "OPEN" } });
  };

  const trackVisit = async (
    userId: string,
    source: "start" | "start_payload" | "home" | "help" | "tag",
    metadata?: Record<string, unknown>
  ) => {
    const tenantId = await getTenantId();
    await deps.prisma.event.create({ data: { tenantId, projectId: tenantId, userId, type: "IMPRESSION", payload: { source, ...metadata } } });
  };

  return {
    formatLocalDate,
    startOfLocalDay,
    startOfLocalWeek,
    startOfLocalMonth,
    getRuntimeProjectContext,
    getRuntimeProjectId,
    getTenantId,
    ensureInitialOwner,
    isTenantAdmin,
    canManageProject,
    getProjectSearchMode,
    setProjectSearchMode,
    getProjectMinReplicas,
    setProjectMinReplicas,
    resolveShareCode,
    trackOpen,
    trackVisit
  };
};
