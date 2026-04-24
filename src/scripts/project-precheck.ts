import { loadConfig } from "../config";

const config = loadConfig();
const expectedProjectCode = process.env.EXPECTED_TENANT_CODE;

console.log("=== Project Precheck ===");
console.log(`PROJECT_CODE: ${config.projectCode}`);
console.log(`EXPECTED_TENANT_CODE: ${expectedProjectCode || "not set"}`);
console.log(`OPS_TOKEN: ${config.opsToken ? "set" : "not set"}`);

if (expectedProjectCode && config.projectCode !== expectedProjectCode) {
  console.error(`❌ Project code mismatch! expected: ${expectedProjectCode}, actual: ${config.projectCode}`);
  process.exit(1);
}

if (!config.opsToken) {
  console.warn("⚠️ OPS_TOKEN is not set; ops endpoints will be unavailable");
}

console.log("✅ Project precheck passed");
