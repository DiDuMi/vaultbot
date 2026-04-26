import { loadConfig } from "../config";

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

const config = loadConfig();
const expectedProjectCode = readEnvWithLegacyFallback("EXPECTED_PROJECT_CODE", "EXPECTED_TENANT_CODE");

console.log("=== Project Precheck ===");
console.log(`PROJECT_CODE: ${config.projectCode}`);
console.log(`EXPECTED_PROJECT_CODE: ${expectedProjectCode || "not set"}`);
console.log(`OPS_TOKEN: ${config.opsToken ? "set" : "not set"}`);

if (expectedProjectCode && config.projectCode !== expectedProjectCode) {
  console.error(`Project code mismatch! expected: ${expectedProjectCode}, actual: ${config.projectCode}`);
  process.exit(1);
}

if (!config.opsToken) {
  console.warn("OPS_TOKEN is not set; ops endpoints will be unavailable");
}

console.log("Project precheck passed");
