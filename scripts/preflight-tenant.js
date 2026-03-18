require("dotenv/config");
const { PrismaClient } = require("@prisma/client");

const tenantCode = (process.env.TENANT_CODE || "").trim();
const expectedTenantCode = (process.env.EXPECTED_TENANT_CODE || "").trim();
const allowMismatch = process.env.ALLOW_TENANT_CODE_MISMATCH === "1";

if (!tenantCode) {
  console.error("❌ 缺少 TENANT_CODE");
  process.exit(1);
}

if (expectedTenantCode && tenantCode !== expectedTenantCode) {
  console.error(`❌ TENANT_CODE 校验失败：当前=${tenantCode}，期望=${expectedTenantCode}`);
  process.exit(1);
}

const prisma = new PrismaClient();

const run = async () => {
  const existing = await prisma.tenant.findUnique({
    where: { code: tenantCode },
    select: { id: true, code: true, name: true, createdAt: true }
  });
  if (existing) {
    const [assets, events, users, batches] = await Promise.all([
      prisma.asset.count({ where: { tenantId: existing.id } }),
      prisma.event.count({ where: { tenantId: existing.id } }),
      prisma.tenantUser.count({ where: { tenantId: existing.id } }),
      prisma.uploadBatch.count({ where: { tenantId: existing.id } })
    ]);
    console.log(
      `✅ TENANT_CODE 校验通过：${tenantCode} | assets=${assets} events=${events} users=${users} batches=${batches}`
    );
    return;
  }
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "asc" },
    select: { code: true },
    take: 20
  });
  if (tenants.length === 0 || allowMismatch) {
    console.log(`✅ TENANT_CODE 校验通过：${tenantCode}（库中暂无租户或允许新建）`);
    return;
  }
  const summary = tenants.map((row) => row.code).filter(Boolean).join(", ");
  console.error(`❌ TENANT_CODE 不匹配：当前=${tenantCode}，数据库已有租户=${summary}`);
  console.error("可设置 ALLOW_TENANT_CODE_MISMATCH=1 放行新租户创建");
  process.exit(1);
};

run()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ preflight 执行失败：${message}`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
