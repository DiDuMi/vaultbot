import type { PrismaClient } from "@prisma/client";

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

export const assertTenantCodeConsistency = async (
  prisma: PrismaClient,
  tenantCode: string,
  allowMismatch = process.env.ALLOW_TENANT_CODE_MISMATCH === "1"
) => {
  const expectedTenantCode = (process.env.EXPECTED_TENANT_CODE || "").trim();
  if (expectedTenantCode && expectedTenantCode !== tenantCode) {
    throw new Error(`TENANT_CODE 校验失败：当前=${tenantCode}，期望=${expectedTenantCode}`);
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
      throw new Error("数据库中尚无租户数据：已阻止启动，避免连到空库/新库导致设置与统计被重置。");
    }
    return;
  }
  if (allowMismatch) {
    return;
  }
  const codes = tenants.map((row) => row.code).filter(Boolean);
  const summary = codes.join(", ");
  throw new Error(
    `TENANT_CODE 不匹配：当前=${tenantCode}，数据库已有租户=${summary}。已阻止启动，避免写入新租户导致统计归零。若确认要新建租户，请设置 ALLOW_TENANT_CODE_MISMATCH=1。`
  );
};
