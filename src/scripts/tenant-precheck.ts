import { loadConfig } from "../config";

const config = loadConfig();
const expectedTenantCode = process.env.EXPECTED_TENANT_CODE;

console.log("=== Project Precheck ===");
console.log(`PROJECT_CODE: ${config.projectContext.code}`);
console.log(`EXPECTED_TENANT_CODE: ${expectedTenantCode || "not set"}`);
console.log(`OPS_TOKEN: ${config.opsToken ? "set" : "not set"}`);

if (expectedTenantCode && config.projectContext.code !== expectedTenantCode) {
  console.error(`❌ Project code mismatch! expected: ${expectedTenantCode}, actual: ${config.projectContext.code}`);
  process.exit(1);
}

if (!config.opsToken) {
  console.warn("⚠️ OPS_TOKEN is not set; ops endpoints will be unavailable");
}

console.log("✅ Project precheck passed");
