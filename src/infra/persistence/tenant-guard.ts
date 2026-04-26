import type { PrismaClient } from "@prisma/client";
import { isSingleOwnerModeEnabled } from "../runtime-mode";

export type TenantDiagnostics = {
  currentTenantCode: string;
  matched: boolean;
  tenants: Array<{
    id: string;
    code: string;
    name: string;
    createdAt: Date;
    assets: number;
    events: number;
    users: number;
    batches: number;
  }>;
};

export type ProjectDiagnostics = {
  currentProjectCode: string;
  matched: boolean;
  projects: Array<{
    id: string;
    code: string;
    name: string;
    createdAt: Date;
    assets: number;
    events: number;
    users: number;
    batches: number;
  }>;
};

export type RuntimeProjectContext = {
  projectId: string;
  code: string;
  name: string;
};

const readEnvWithLegacyFallback = (primaryName: string, legacyName: string) => {
  const primary = process.env[primaryName];
  if (primary !== undefined && primary.trim() !== "") {
    return primary.trim();
  }
  const legacy = process.env[legacyName];
  if (legacy !== undefined && legacy.trim() !== "") {
    return legacy.trim();
  }
  return "";
};

const isProjectCodeMismatchAllowed = () =>
  readEnvWithLegacyFallback("ALLOW_PROJECT_CODE_MISMATCH", "ALLOW_TENANT_CODE_MISMATCH") === "1";

const isExistingProjectRequired = () =>
  readEnvWithLegacyFallback("REQUIRE_EXISTING_PROJECT", "REQUIRE_EXISTING_TENANT") === "1";

const listScopedDiagnostics = async (prisma: PrismaClient, scopedCode: string) => {
  const rows = await prisma.tenant.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      createdAt: true,
      _count: {
        select: {
          assets: true,
          events: true,
          users: true,
          uploadBatches: true
        }
      }
    },
    take: 50
  });
  return { scopedCode, rows };
};

export const getTenantDiagnostics = async (prisma: PrismaClient, tenantCode: string): Promise<TenantDiagnostics> => {
  const { scopedCode, rows } = await listScopedDiagnostics(prisma, tenantCode);
  return {
    currentTenantCode: scopedCode,
    matched: rows.some((row) => row.code === scopedCode),
    tenants: rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      createdAt: row.createdAt,
      assets: row._count.assets,
      events: row._count.events,
      users: row._count.users,
      batches: row._count.uploadBatches
    }))
  };
};

export const getProjectDiagnostics = async (prisma: PrismaClient, projectCode: string): Promise<ProjectDiagnostics> => {
  const { scopedCode, rows } = await listScopedDiagnostics(prisma, projectCode);
  return {
    currentProjectCode: scopedCode,
    matched: rows.some((row) => row.code === scopedCode),
    projects: rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      createdAt: row.createdAt,
      assets: row._count.assets,
      events: row._count.events,
      users: row._count.users,
      batches: row._count.uploadBatches
    }))
  };
};

export const assertProjectCodeConsistency = async (
  prisma: PrismaClient,
  projectCode: string,
  allowMismatch = isProjectCodeMismatchAllowed()
) => {
  const expectedProjectCode = readEnvWithLegacyFallback("EXPECTED_PROJECT_CODE", "EXPECTED_TENANT_CODE");
  if (expectedProjectCode && expectedProjectCode !== projectCode) {
    throw new Error(`PROJECT_CODE 校验失败：当前=${projectCode}，期望=${expectedProjectCode}`);
  }
  const requireExisting = isExistingProjectRequired();
  const existing = await prisma.tenant.findUnique({
    where: { code: projectCode },
    select: { id: true }
  });
  if (existing) {
    return;
  }
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "asc" },
    select: { code: true },
    take: 20
  });
  if (tenants.length === 0) {
    if (requireExisting) {
      throw new Error("数据库中尚无项目数据：已阻止启动，避免连到空库或新库导致设置与统计被重置。");
    }
    return;
  }
  if (allowMismatch) {
    return;
  }
  const codes = tenants.map((row) => row.code).filter(Boolean);
  const summary = codes.join(", ");
  throw new Error(
    `PROJECT_CODE 不匹配：当前=${projectCode}，数据库已有项目=${summary}。已阻止启动，避免写入新项目导致统计归零。若确认需要新建项目，请设置 ALLOW_PROJECT_CODE_MISMATCH=1。`
  );
};

export const assertTenantCodeConsistency = assertProjectCodeConsistency;

export const assertProjectContextConsistency = async (
  prisma: PrismaClient,
  projectContext: { code: string; name: string },
  allowMismatch = isProjectCodeMismatchAllowed()
) => assertProjectCodeConsistency(prisma, projectContext.code, allowMismatch);

const isSingleOwnerBootstrapAllowed = () => {
  const raw = (process.env.SINGLE_OWNER_ALLOW_TENANT_BOOTSTRAP || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
};

export const ensureRuntimeProject = async (
  prisma: PrismaClient,
  input: { projectCode: string; projectName: string }
) => {
  const existing = await prisma.tenant.findUnique({
    where: { code: input.projectCode },
    select: { id: true, code: true, name: true }
  });
  if (existing) {
    if (existing.name !== input.projectName) {
      await prisma.tenant.update({
        where: { id: existing.id },
        data: { name: input.projectName }
      });
    }
    return { id: existing.id, code: existing.code, name: input.projectName };
  }

  if (isSingleOwnerModeEnabled() && !isSingleOwnerBootstrapAllowed()) {
    throw new Error(
      `单人项目模式下禁止自动创建项目：${input.projectCode}。如确认是首次初始化，请显式设置 SINGLE_OWNER_ALLOW_TENANT_BOOTSTRAP=1。`
    );
  }

  return prisma.tenant.create({
    data: { code: input.projectCode, name: input.projectName },
    select: { id: true, code: true, name: true }
  });
};

export const ensureRuntimeTenant = async (
  prisma: PrismaClient,
  input: { tenantCode: string; tenantName: string }
) =>
  ensureRuntimeProject(prisma, {
    projectCode: input.tenantCode,
    projectName: input.tenantName
  });

export const ensureRuntimeProjectContext = async (
  prisma: PrismaClient,
  projectContext: { code: string; name: string }
): Promise<RuntimeProjectContext> => {
  const project = await ensureRuntimeProject(prisma, {
    projectCode: projectContext.code,
    projectName: projectContext.name
  });
  return {
    projectId: project.id,
    code: project.code,
    name: project.name
  };
};
