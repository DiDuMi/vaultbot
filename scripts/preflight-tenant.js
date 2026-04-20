require("dotenv/config");
const { PrismaClient } = require("@prisma/client");

const projectCode = (process.env.TENANT_CODE || "").trim();
const expectedTenantCode = (process.env.EXPECTED_TENANT_CODE || "").trim();
const allowMismatch = process.env.ALLOW_TENANT_CODE_MISMATCH === "1";
const requireExisting = process.env.REQUIRE_EXISTING_TENANT === "1";

if (!projectCode) {
  console.error("❌ Missing TENANT_CODE");
  process.exit(1);
}

if (expectedTenantCode && projectCode !== expectedTenantCode) {
  console.error(`❌ Project code check failed: current=${projectCode}, expected=${expectedTenantCode}`);
  process.exit(1);
}

const prisma = new PrismaClient();

const run = async () => {
  const existing = await prisma.tenant.findUnique({
    where: { code: projectCode },
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
      `✅ Project preflight passed: ${projectCode} | assets=${assets} events=${events} users=${users} batches=${batches}`
    );
    return;
  }
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "asc" },
    select: { code: true },
    take: 20
  });
  if (tenants.length === 0) {
    if (requireExisting) {
      console.error("❌ No existing project data found in database: startup blocked to avoid writing into an empty or wrong database");
      process.exit(1);
    }
    console.log(`✅ Project preflight passed: ${projectCode} (database is empty or new project creation is allowed)`);
    return;
  }
  if (allowMismatch) {
    console.log(`✅ Project preflight passed: ${projectCode} (new project creation allowed)`);
    return;
  }
  const summary = tenants.map((row) => row.code).filter(Boolean).join(", ");
  console.error(`❌ Project code mismatch: current=${projectCode}, existing database codes=${summary}`);
  console.error("You can set ALLOW_TENANT_CODE_MISMATCH=1 to allow creating a new project context");
  process.exit(1);
};

run()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Project preflight failed: ${message}`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
