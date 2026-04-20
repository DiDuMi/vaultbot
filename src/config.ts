import "dotenv/config";
import { createProjectContextConfigFromTenant, type ProjectContextConfig } from "./project-context";

export type Config = {
  botToken: string;
  webhookPath: string;
  webhookBaseUrl?: string;
  webhookSecret?: string;
  opsToken?: string;
  databaseUrl: string;
  redisUrl: string;
  projectContext: ProjectContextConfig;
  tenantCode: string;
  tenantName: string;
  vaultChatId: string;
  vaultThreadId?: number;
  host: string;
  port: number;
};

const normalizePath = (value: string) => {
  if (!value.startsWith("/")) {
    return `/${value}`;
  }
  return value;
};

const readEnv = (name: string, fallback?: string) => {
  const value = process.env[name];
  if (value !== undefined && value.trim() !== "") {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`Missing environment variable: ${name}`);
};

const readOptionalInt = (name: string) => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`Invalid environment variable: ${name} must be an integer`);
  }
  return value;
};

const assertPort = (value: number) => {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error("Invalid environment variable: PORT must be an integer between 1 and 65535");
  }
  return value;
};

const assertTelegramId = (name: string, value: string) => {
  const normalized = value.trim();
  if (!/^-?\d+$/.test(normalized)) {
    throw new Error(`Invalid environment variable: ${name} must be an integer string`);
  }
  return normalized;
};

export const loadConfig = (): Config => {
  const webhookPath = normalizePath(readEnv("WEBHOOK_PATH", "/telegram/webhook"));
  const tenantCode = readEnv("TENANT_CODE");
  const tenantName = readEnv("TENANT_NAME");
  const config: Config = {
    botToken: readEnv("BOT_TOKEN"),
    webhookPath,
    webhookBaseUrl: process.env.WEBHOOK_BASE_URL,
    webhookSecret: process.env.WEBHOOK_SECRET,
    opsToken: process.env.OPS_TOKEN,
    databaseUrl: readEnv("DATABASE_URL"),
    redisUrl: readEnv("REDIS_URL"),
    projectContext: createProjectContextConfigFromTenant({ tenantCode, tenantName }),
    tenantCode,
    tenantName,
    vaultChatId: assertTelegramId("VAULT_CHAT_ID", readEnv("VAULT_CHAT_ID")),
    vaultThreadId: readOptionalInt("VAULT_THREAD_ID"),
    host: readEnv("HOST", "0.0.0.0"),
    port: assertPort(Number(readEnv("PORT", "3002")))
  };
  if (config.webhookBaseUrl && (!config.webhookSecret || config.webhookSecret.trim() === "")) {
    throw new Error("\u542f\u7528 WEBHOOK_BASE_URL \u65f6\u5fc5\u987b\u8bbe\u7f6e WEBHOOK_SECRET");
  }
  return config;
};
