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

export const getTenantDiagnostics = async (prisma: PrismaClient, tenantCode: string): Promise<TenantDiagnostics> => {
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
  return {
    currentTenantCode: tenantCode,
    matched: rows.some((row) => row.code === tenantCode),
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
  const result = await getTenantDiagnostics(prisma, projectCode);
  return {
    currentProjectCode: result.currentTenantCode,
    matched: result.matched,
    projects: result.tenants
  };
};

export const assertTenantCodeConsistency = async (
  prisma: PrismaClient,
  tenantCode: string,
  allowMismatch = process.env.ALLOW_TENANT_CODE_MISMATCH === "1"
) => {
  const expectedTenantCode = (process.env.EXPECTED_TENANT_CODE || "").trim();
  if (expectedTenantCode && expectedTenantCode !== tenantCode) {
    throw new Error(`TENANT_CODE \u6821\u9a8c\u5931\u8d25\uff1a\u5f53\u524d=${tenantCode}\uff0c\u671f\u671b=${expectedTenantCode}`);
  }
  const requireExisting = process.env.REQUIRE_EXISTING_TENANT === "1";
  const existing = await prisma.tenant.findUnique({
    where: { code: tenantCode },
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
      throw new Error("\u6570\u636e\u5e93\u4e2d\u5c1a\u65e0\u79df\u6237\u6570\u636e\uff1a\u5df2\u963b\u6b62\u542f\u52a8\uff0c\u907f\u514d\u8fde\u5230\u7a7a\u5e93\u6216\u65b0\u5e93\u5bfc\u81f4\u8bbe\u7f6e\u4e0e\u7edf\u8ba1\u88ab\u91cd\u7f6e\u3002");
    }
    return;
  }
  if (allowMismatch) {
    return;
  }
  const codes = tenants.map((row) => row.code).filter(Boolean);
  const summary = codes.join(", ");
  throw new Error(
    `TENANT_CODE \u4e0d\u5339\u914d\uff1a\u5f53\u524d=${tenantCode}\uff0c\u6570\u636e\u5e93\u5df2\u6709\u79df\u6237=${summary}\u3002\u5df2\u963b\u6b62\u542f\u52a8\uff0c\u907f\u514d\u5199\u5165\u65b0\u79df\u6237\u5bfc\u81f4\u7edf\u8ba1\u5f52\u96f6\u3002\u82e5\u786e\u8ba4\u9700\u8981\u65b0\u5efa\u79df\u6237\uff0c\u8bf7\u8bbe\u7f6e ALLOW_TENANT_CODE_MISMATCH=1\u3002`
  );
};

export const assertProjectContextConsistency = async (
  prisma: PrismaClient,
  projectContext: { code: string; name: string },
  allowMismatch = process.env.ALLOW_TENANT_CODE_MISMATCH === "1"
) => assertTenantCodeConsistency(prisma, projectContext.code, allowMismatch);

const isSingleOwnerBootstrapAllowed = () => {
  const raw = (process.env.SINGLE_OWNER_ALLOW_TENANT_BOOTSTRAP || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
};

export const ensureRuntimeTenant = async (
  prisma: PrismaClient,
  input: { tenantCode: string; tenantName: string }
) => {
  const existing = await prisma.tenant.findUnique({
    where: { code: input.tenantCode },
    select: { id: true, code: true, name: true }
  });
  if (existing) {
    if (existing.name !== input.tenantName) {
      await prisma.tenant.update({
        where: { id: existing.id },
        data: { name: input.tenantName }
      });
    }
    return { id: existing.id, code: existing.code, name: input.tenantName };
  }

  if (isSingleOwnerModeEnabled() && !isSingleOwnerBootstrapAllowed()) {
    throw new Error(
      `\u5355\u4eba\u9879\u76ee\u6a21\u5f0f\u4e0b\u7981\u6b62\u81ea\u52a8\u521b\u5efa tenant\uff1a${input.tenantCode}\u3002\u5982\u786e\u8ba4\u662f\u9996\u6b21\u521d\u59cb\u5316\uff0c\u8bf7\u663e\u5f0f\u8bbe\u7f6e SINGLE_OWNER_ALLOW_TENANT_BOOTSTRAP=1\u3002`
    );
  }

  return prisma.tenant.create({
    data: { code: input.tenantCode, name: input.tenantName },
    select: { id: true, code: true, name: true }
  });
};

export const ensureRuntimeProjectContext = async (
  prisma: PrismaClient,
  projectContext: { code: string; name: string }
): Promise<RuntimeProjectContext> => {
  const tenant = await ensureRuntimeTenant(prisma, {
    tenantCode: projectContext.code,
    tenantName: projectContext.name
  });
  return {
    projectId: tenant.id,
    code: tenant.code,
    name: tenant.name
  };
};
