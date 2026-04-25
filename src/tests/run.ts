import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Keyboard } from "grammy";
import { createProjectAdminInput } from "../bot/project/admin-input";
import { createProjectBatchActions } from "../bot/project/batch-actions";
import { createProjectOpenHandler } from "../bot/project/open";
import { commentListCallbackRe } from "../bot/project/callbacks-social";
import { createProjectSocial } from "../bot/project/social";
import { createUploadBatchStore } from "../services/use-cases";
import { buildBlockingHint, buildPublisherLine, extractStartPayloadFromText, resolveUserLabel, toMetaKey } from "../bot/project/ui-utils";
import {
  footMoreCallbackRe,
  historyMoreCallbackRe,
  historyScopeCallbackRe,
  historySetFilterCollectionCallbackRe,
  tagIndexPageCallbackRe,
  tagIndexRefreshCallbackRe,
  tagOpenCallbackRe
} from "../bot/project/callbacks-social";
import { rankMoreCallbackRe } from "../bot/project/callbacks-home";
import { buildWorkerHeartbeatLines, parseHeartbeatAgoMin } from "../services/use-cases/worker-heartbeat";
import { registerDeliveryModuleTests } from "./use-cases/delivery-modules";
import { createWorkerRoutes } from "../worker/routes";
import { startIntervalScheduler } from "../worker/orchestration";
import {
  backfillProjectUsers,
  backfillTenantUsers,
  computeProjectNextBroadcastRunAt,
  computeNextBroadcastRunAt,
  ensureProjectRuntimeId,
  ensureRuntimeProjectId,
  getBroadcastTargetUserIds,
  getProjectAssetPublisherUserId,
  getLatestProjectAssetPublisherUserId,
  getProjectScopeId,
  getProjectBroadcastTargetUserIds,
  isSafeTelegramNumericId,
  parseProjectTelegramUserId,
  resolveProjectScopeId,
  sendMediaGroupWithRetry,
  sendProjectMediaGroupWithRetry,
  syncProjectUsers
} from "../worker/helpers";
import {
  upsertProjectSetting,
  upsertProjectWorkerProcessHeartbeat,
  upsertProjectWorkerReplicationHeartbeat,
  upsertTenantSetting,
  upsertWorkerProcessHeartbeat,
  upsertWorkerReplicationHeartbeat
} from "../worker/storage";
import { buildAssetActionLine, buildPreviewLinkLine } from "../bot/project/register-core";
import { createProjectHistoryRenderer } from "../bot/project/history";
import { buildFootprintKeyboard, buildMyKeyboard, buildRankingKeyboard } from "../bot/project/keyboards";
import { getMemberLabel, getMemberScopeLabel } from "../bot/project/labels";
import {
  createProjectRenderers,
  registerProjectCallbackRoutes,
  registerProjectBot,
  registerProjectCommands,
  registerProjectMessageHandlers,
  registerProjectMiddlewares
} from "../bot/project";
import { createProjectRenderers as createProjectRenderersModule } from "../bot/project/renderers";
import { registerProjectCommands as registerProjectCommandsModule } from "../bot/project/commands";
import { registerProjectMessageHandlers as registerProjectMessageHandlersModule } from "../bot/project/messages";
import { registerProjectMiddlewares as registerProjectMiddlewaresModule } from "../bot/project/middlewares";
import { registerProjectCallbackRoutes as registerProjectCallbackRoutesModule } from "../bot/project/callbacks";
import {
  createProjectAdminInputHandlers,
  createProjectBotFrame,
  createProjectCollectionHelpers,
  createProjectInteractionStateHandlers,
  createProjectManagePanelHelpers,
  createProjectMetaFlowHelpers,
  createProjectBotScaffold,
  createProjectStartPayloadHelpers,
  createProjectBotViews,
  formatProjectLocalDateTime,
  getProjectCollectionTitle,
  registerProjectBotFlows
} from "../bot/project/composition";
import { createProjectTagRenderers } from "../bot/project/tags";
import { createDeliveryDiscovery, createProjectDiscovery } from "../services/use-cases/delivery-discovery";
import { createDeliveryAdmin, createProjectAdmin } from "../services/use-cases/delivery-admin";
import { createDeliveryCore } from "../services/use-cases/delivery-core";
import { createDeliveryPreferences, createProjectPreferences } from "../services/use-cases/delivery-preferences";
import { createDeliveryProjectPreferences } from "../services/use-cases/delivery-project-preferences";
import { createDeliveryProjectSocial, createProjectSocial as createProjectSocialService } from "../services/use-cases/delivery-project-social";
import { createDeliveryProjectStats, createProjectStats as createProjectStatsService } from "../services/use-cases/delivery-project-stats";
import { createDeliveryStorage, createProjectStorage } from "../services/use-cases/delivery-storage";
import { createDeliverySocial } from "../services/use-cases/delivery-social";
import { createDeliveryStats } from "../services/use-cases/delivery-stats";
import { isSingleOwnerModeEnabled } from "../infra/runtime-mode";
import {
  assertProjectCodeConsistency,
  assertProjectContextConsistency,
  ensureRuntimeProject,
  ensureRuntimeProjectContext,
  ensureRuntimeTenant,
  getProjectDiagnostics
} from "../infra/persistence/tenant-guard";
import {
  buildIdentityService,
  createGetUserProfileSummary,
  createGetProjectAssetAccess,
  createGetTenantAssetAccess
} from "../services/use-cases/delivery-factories";
import { resolveLocaleFromTelegramLanguageCode } from "../i18n";
import { createProjectContextConfigFromTenant, normalizeProjectContextConfig } from "../project-context";
import { createDeliveryReplicaSelection, createProjectReplicaSelection } from "../services/use-cases/delivery-replica-selection";
import { createDeliveryProjectVault, createDeliveryTenantVault } from "../services/use-cases/delivery-project-vault";
import { createUploadService } from "../services/use-cases/upload";
import { createProjectReplicateBatch, createReplicateBatch } from "../worker/replication-worker";
import { createServer } from "../server";
import { loadConfig } from "../config";
import type { Asset as LegacyAsset, Event as LegacyEvent, PermissionRule as LegacyPermissionRule, Project, ProjectAsset, ProjectEvent, ProjectPermissionRule, Tenant } from "../core/domain/models";

type TestCase = { name: string; run: () => Promise<void> | void };

const tests: TestCase[] = [];
const test = (name: string, run: TestCase["run"]) => tests.push({ name, run });

test("source: user-facing text files do not contain known mojibake fragments", () => {
  const suspiciousFragments = ["\uFFFD", "馃", "鉁", "鈿", "鏈", "鏃犳"];
  const srcDir = path.join(process.cwd(), "src");
  const offenders: Array<{ file: string; fragment: string }> = [];

  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "tests") {
          continue;
        }
        visit(fullPath);
        continue;
      }
      if (!/\.(ts|js)$/i.test(entry.name)) {
        continue;
      }
      const content = fs.readFileSync(fullPath, "utf8");
      const hit = suspiciousFragments.find((fragment) => content.includes(fragment));
      if (hit) {
        offenders.push({ file: path.relative(process.cwd(), fullPath), fragment: hit });
      }
    }
  };

  visit(srcDir);
  assert.deepEqual(offenders, []);
});

test("source: high-frequency bot log components do not use tenant-prefixed names", () => {
  const targetFiles = [
    path.join(process.cwd(), "src", "bot", "tenant", "callbacks", "assets.ts"),
    path.join(process.cwd(), "src", "bot", "tenant", "callbacks", "social.ts"),
    path.join(process.cwd(), "src", "bot", "tenant", "social.ts"),
    path.join(process.cwd(), "src", "bot", "tenant", "history.ts"),
    path.join(process.cwd(), "src", "bot", "tenant", "index.ts"),
    path.join(process.cwd(), "src", "bot", "tenant", "ui-utils.ts")
  ];
  const blocked = [
    'component: "tenant_assets"',
    'component: "tenant_social"',
    'component: "tenant_social_callbacks"',
    'component: "tenant_ui"',
    'component: "tenant"'
  ];
  const offenders: Array<{ file: string; fragment: string }> = [];

  for (const fullPath of targetFiles) {
    const content = fs.readFileSync(fullPath, "utf8");
    for (const fragment of blocked) {
      if (content.includes(fragment)) {
        offenders.push({ file: path.relative(process.cwd(), fullPath), fragment });
      }
    }
  }

  assert.deepEqual(offenders, []);
});

test("project-context: creates project config from tenant fields", () => {
  assert.deepEqual(
    createProjectContextConfigFromTenant({
      tenantCode: "demo-project",
      tenantName: "Demo Project"
    }),
    {
      code: "demo-project",
      name: "Demo Project"
    }
  );
});

test("config: projectCode and projectName are primary fields with tenant aliases", () => {
  const previous = {
    BOT_TOKEN: process.env.BOT_TOKEN,
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    PROJECT_CODE: process.env.PROJECT_CODE,
    PROJECT_NAME: process.env.PROJECT_NAME,
    TENANT_CODE: process.env.TENANT_CODE,
    TENANT_NAME: process.env.TENANT_NAME,
    VAULT_CHAT_ID: process.env.VAULT_CHAT_ID,
    PORT: process.env.PORT,
    HOST: process.env.HOST
  };
  process.env.BOT_TOKEN = "token";
  process.env.DATABASE_URL = "postgresql://example";
  process.env.REDIS_URL = "memory";
  process.env.PROJECT_CODE = "demo-project";
  process.env.PROJECT_NAME = "Demo Project";
  process.env.TENANT_CODE = "legacy-project";
  process.env.TENANT_NAME = "Legacy Project";
  process.env.VAULT_CHAT_ID = "-1001";
  process.env.PORT = "3002";
  process.env.HOST = "127.0.0.1";
  try {
    const config = loadConfig();
    assert.equal(config.projectCode, "demo-project");
    assert.equal(config.projectName, "Demo Project");
    assert.equal(config.tenantCode, "demo-project");
    assert.equal(config.tenantName, "Demo Project");
    assert.deepEqual(config.projectContext, { code: "demo-project", name: "Demo Project" });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("source: bot project index is no longer a pure tenant re-export shell", () => {
  const file = path.join(process.cwd(), "src", "bot", "project", "index.ts");
  const content = fs.readFileSync(file, "utf8");
  assert.equal(content.includes("registerTenantBot as registerProjectBot"), false);
  assert.equal(content.includes("export const registerProjectBot"), true);
  assert.equal(content.includes("./register-core"), true);
  assert.equal(content.includes("registerProjectBotCore"), true);
});

test("source: bot tenant index has been reduced to a thin compatibility wrapper", () => {
  const file = path.join(process.cwd(), "src", "bot", "tenant", "index.ts");
  const content = fs.readFileSync(file, "utf8");
  assert.equal(content.includes("../project/register-core"), true);
  assert.equal(content.includes("registerProjectBotCore as registerTenantBot"), true);
  assert.equal(content.includes("createProjectBotViews"), false);
});

test("source: bot tenant register-core is now a compatibility re-export", () => {
  const file = path.join(process.cwd(), "src", "bot", "tenant", "register-core.ts");
  const content = fs.readFileSync(file, "utf8");
  assert.equal(content.includes("../project/register-core"), true);
  assert.equal(content.includes("registerProjectBotCore"), true);
});

test("source: bot project register core is the primary orchestration implementation", () => {
  const file = path.join(process.cwd(), "src", "bot", "project", "register-core.ts");
  const content = fs.readFileSync(file, "utf8");
  assert.equal(content.includes("registerProjectBotCore"), true);
  assert.equal(content.includes("registerTenantBot = registerProjectBotCore"), true);
});

test("source: tenant bot index no longer contains concrete registration logic", () => {
  const file = path.join(process.cwd(), "src", "bot", "tenant", "index.ts");
  const content = fs.readFileSync(file, "utf8");
  assert.equal(content.includes("registerProjectBotCore as registerTenantBot"), true);
  assert.equal(content.includes("registerProjectBotFlows"), false);
  assert.equal(content.includes("createProjectBotViews"), false);
});

test("source: builder tests now target project register core instead of tenant entry", () => {
  const file = path.join(process.cwd(), "src", "tests", "run.ts");
  const content = fs.readFileSync(file, "utf8");
  assert.equal(content.includes('from "../bot/project/register-core"'), true);
});

test("source: bot project composition exports reusable frame helpers", () => {
  const file = path.join(process.cwd(), "src", "bot", "project", "composition.ts");
  const content = fs.readFileSync(file, "utf8");
  assert.equal(content.includes("export const createProjectBotFrame"), true);
  assert.equal(content.includes("export const formatProjectLocalDateTime"), true);
});

test("project-context: normalize helper accepts project context shape directly", () => {
  assert.deepEqual(
    normalizeProjectContextConfig({
      code: "demo-project",
      name: "Demo Project"
    }),
    {
      code: "demo-project",
      name: "Demo Project"
    }
  );
});

test("domain models: project-first types keep legacy tenant aliases compatible", () => {
  const project: Project = { id: "project_1", code: "demo-project", name: "Demo Project" };
  const tenant: Tenant = project;
  const projectAsset: ProjectAsset = {
    id: "asset_1",
    projectId: "project_1",
    title: "Asset",
    description: "Demo",
    shareCode: "share_1"
  };
  const legacyAsset: LegacyAsset = { ...projectAsset, tenantId: "project_1" };
  const projectRule: ProjectPermissionRule = { id: "rule_1", projectId: "project_1" };
  const legacyRule: LegacyPermissionRule = { ...projectRule, tenantId: "project_1" };
  const projectEvent: ProjectEvent = { id: "event_1", projectId: "project_1", userId: "user_1", type: "OPEN" };
  const legacyEvent: LegacyEvent = { ...projectEvent, tenantId: "project_1" };

  assert.equal(tenant.code, "demo-project");
  assert.equal(legacyAsset.tenantId, "project_1");
  assert.equal(legacyRule.tenantId, "project_1");
  assert.equal(legacyEvent.projectId, "project_1");
});

test("tenant-guard: project diagnostics wrap tenant diagnostics with project wording", async () => {
  const result = await getProjectDiagnostics(
    {
      tenant: {
        findMany: async () => [
          {
            id: "tenant_1",
            code: "demo-project",
            name: "Demo Project",
            createdAt: new Date("2026-04-19T00:00:00.000Z"),
            _count: { assets: 3, events: 4, users: 5, uploadBatches: 6 }
          }
        ]
      }
    } as never,
    "demo-project"
  );

  assert.equal(result.currentProjectCode, "demo-project");
  assert.equal(result.matched, true);
  assert.deepEqual(result.projects, [
    {
      id: "tenant_1",
      code: "demo-project",
      name: "Demo Project",
      createdAt: new Date("2026-04-19T00:00:00.000Z"),
      assets: 3,
      events: 4,
      users: 5,
      batches: 6
    }
  ]);
});

test("tenant-guard: project context consistency reuses tenant guard checks", async () => {
  const previousExpected = process.env.EXPECTED_TENANT_CODE;
  process.env.EXPECTED_TENANT_CODE = "demo-project";
  try {
    await assert.doesNotReject(() =>
      assertProjectContextConsistency(
        {
          tenant: {
            findUnique: async () => ({ id: "tenant_1" })
          }
        } as never,
        { code: "demo-project", name: "Demo Project" }
      )
    );
  } finally {
    process.env.EXPECTED_TENANT_CODE = previousExpected;
  }
});

test("tenant-guard: project code consistency uses project-first wording", async () => {
  const previousExpected = process.env.EXPECTED_TENANT_CODE;
  process.env.EXPECTED_TENANT_CODE = "expected-project";
  try {
    await assert.rejects(
      () =>
        assertProjectCodeConsistency(
          {
            tenant: {
              findUnique: async () => null,
              findMany: async () => [{ code: "vault" }]
            }
          } as never,
          "actual-project"
        ),
      /PROJECT_CODE/
    );
  } finally {
    process.env.EXPECTED_TENANT_CODE = previousExpected;
  }
});

test("tenant-guard: runtime project context wraps runtime tenant", async () => {
  const result = await ensureRuntimeProjectContext(
    {
      tenant: {
        findUnique: async () => ({ id: "tenant_1", code: "demo-project", name: "Demo Project" }),
        update: async () => ({})
      }
    } as never,
    { code: "demo-project", name: "Demo Project" }
  );

  assert.deepEqual(result, {
    projectId: "tenant_1",
    code: "demo-project",
    name: "Demo Project"
  });
});

test("worker-helper: runtime project id wraps runtime project context", async () => {
  const result = await ensureRuntimeProjectId(
    {
      tenant: {
        findUnique: async () => ({ id: "tenant_1", code: "demo-project", name: "Demo Project" }),
        update: async () => ({})
      }
    } as never,
    { code: "demo-project", name: "Demo Project" }
  );

  assert.equal(result, "tenant_1");
});

test("worker-helper: project scope and runtime helpers remain compatibility aliases", () => {
  assert.equal(ensureProjectRuntimeId, ensureRuntimeProjectId);
  assert.equal(getProjectScopeId, resolveProjectScopeId);
});

test("worker-helper: project user backfill remains a compatibility alias", () => {
  assert.equal(backfillProjectUsers, backfillTenantUsers);
  assert.equal(syncProjectUsers, backfillProjectUsers);
});

test("worker-helper: project broadcast target ids remain a compatibility alias", () => {
  assert.equal(getProjectBroadcastTargetUserIds, getBroadcastTargetUserIds);
});

test("worker-helper: additional project aliases remain compatible", () => {
  assert.equal(getProjectAssetPublisherUserId, getLatestProjectAssetPublisherUserId);
  assert.equal(parseProjectTelegramUserId, isSafeTelegramNumericId);
  assert.equal(sendProjectMediaGroupWithRetry, sendMediaGroupWithRetry);
  assert.equal(computeProjectNextBroadcastRunAt, computeNextBroadcastRunAt);
});

test("worker-helper: runtime-oriented project aliases remain compatible", () => {
  assert.equal(getProjectAssetPublisherUserId, getLatestProjectAssetPublisherUserId);
  assert.equal(sendProjectMediaGroupWithRetry, sendMediaGroupWithRetry);
});

test("worker-storage: project setting upsert remains a compatibility alias", () => {
  assert.equal(upsertProjectSetting, upsertTenantSetting);
});

test("worker-storage: project heartbeat upserts remain compatibility aliases", () => {
  assert.equal(upsertProjectWorkerProcessHeartbeat, upsertWorkerProcessHeartbeat);
  assert.equal(upsertProjectWorkerReplicationHeartbeat, upsertWorkerReplicationHeartbeat);
});

test("worker replication: project batch replicator remains a compatibility alias", () => {
  assert.equal(createProjectReplicateBatch, createReplicateBatch);
});

test("worker-storage: project setting dual-writes projectId", async () => {
  const calls: Array<{
    where: Record<string, unknown>;
    update: { projectId: string; value: string };
    create: { tenantId: string; projectId: string; key: string; value: string };
  }> = [];

  await upsertProjectSetting(
    {
      tenantSetting: {
        upsert: async (args: {
          where: Record<string, unknown>;
          update: { projectId: string; value: string };
          create: { tenantId: string; projectId: string; key: string; value: string };
        }) => {
          calls.push(args);
          return {};
        }
      }
    } as never,
    "tenant_1",
    "worker_heartbeat",
    "123"
  );

  assert.deepEqual(calls, [
    {
      where: { projectId_key: { projectId: "tenant_1", key: "worker_heartbeat" } },
      update: { projectId: "tenant_1", value: "123" },
      create: { tenantId: "tenant_1", projectId: "tenant_1", key: "worker_heartbeat", value: "123" }
    }
  ]);
});

test("worker-helper: broadcast target ids prefer projectId and fall back to tenantId", async () => {
  const eventWheres: Array<Record<string, unknown>> = [];
  const userWheres: Array<Record<string, unknown>> = [];

  const ids = await getProjectBroadcastTargetUserIds(
    {
      event: {
        groupBy: async ({ where }: { where: Record<string, unknown> }) => {
          eventWheres.push(where);
          return Object.prototype.hasOwnProperty.call(where, "projectId") ? [] : [{ userId: "viewer_1" }];
        }
      },
      tenantUser: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          userWheres.push(where);
          return Object.prototype.hasOwnProperty.call(where, "projectId") ? [] : [{ tgUserId: "viewer_2" }];
        }
      },
      tenantMember: {
        findMany: async () => [{ tgUserId: "owner_1" }]
      }
    } as never,
    "tenant_1"
  );

  assert.deepEqual(ids, ["viewer_1", "viewer_2"]);
  assert.deepEqual(eventWheres, [{ projectId: "tenant_1" }, { tenantId: "tenant_1" }]);
  assert.deepEqual(userWheres, [{ projectId: "tenant_1" }, { tenantId: "tenant_1" }]);
});

test("worker-helper: backfill users dual-writes projectId", async () => {
  const upsertCalls: Array<{
    where: { tenantId_tgUserId: { tenantId: string; tgUserId: string } };
    update: { projectId: string; username: string | null; firstName: string | null; lastName: string | null; lastSeenAt: Date };
    create: {
      tenantId: string;
      projectId: string;
      tgUserId: string;
      username: string | null;
      firstName: string | null;
      lastName: string | null;
      languageCode: null;
      isBot: false;
      lastSeenAt: Date;
    };
  }> = [];

  await backfillProjectUsers(
    {
      api: {
        getChat: async () => ({
          username: "demo_user",
          first_name: "Demo",
          last_name: "User"
        })
      }
    } as never,
    {
      event: {
        groupBy: async ({ where }: { where: Record<string, unknown> }) =>
          Object.prototype.hasOwnProperty.call(where, "projectId") ? [{ userId: "1001" }] : []
      },
      assetComment: {
        groupBy: async () => []
      },
      uploadBatch: {
        groupBy: async ({ where }: { where: Record<string, unknown> }) =>
          Object.prototype.hasOwnProperty.call(where, "projectId") ? [] : []
      },
      tenantMember: {
        findMany: async () => []
      },
      tenantUser: {
        findMany: async ({ where }: { where: Record<string, unknown> }) =>
          Object.prototype.hasOwnProperty.call(where, "projectId") ? [] : [],
        upsert: async (args: {
          where: { tenantId_tgUserId: { tenantId: string; tgUserId: string } };
          update: { projectId: string; username: string | null; firstName: string | null; lastName: string | null; lastSeenAt: Date };
          create: {
            tenantId: string;
            projectId: string;
            tgUserId: string;
            username: string | null;
            firstName: string | null;
            lastName: string | null;
            languageCode: null;
            isBot: false;
            lastSeenAt: Date;
          };
        }) => {
          upsertCalls.push(args);
          return {};
        }
      }
    } as never,
    "tenant_1"
  );

  assert.equal(upsertCalls.length, 1);
  assert.equal(upsertCalls[0]?.update.projectId, "tenant_1");
  assert.equal(upsertCalls[0]?.create.projectId, "tenant_1");
  assert.equal(upsertCalls[0]?.where.tenantId_tgUserId.tgUserId, "1001");
});

test("worker-helper: latest asset publisher prefers projectId", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const userId = await getLatestProjectAssetPublisherUserId(
    {
      uploadBatch: {
        findFirst: async (args: Record<string, unknown>) => {
          calls.push(args);
          return { userId: "publisher_1" };
        }
      }
    } as never,
    "tenant_1",
    "asset_1"
  );

  assert.equal(userId, "publisher_1");
  assert.deepEqual(calls, [
    {
      where: { projectId: "tenant_1", assetId: "asset_1", status: "COMMITTED" },
      orderBy: { createdAt: "desc" },
      select: { userId: true }
    }
  ]);
});

test("worker-helper: latest asset publisher falls back to tenantId", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const userId = await getLatestProjectAssetPublisherUserId(
    {
      uploadBatch: {
        findFirst: async (args: Record<string, unknown>) => {
          calls.push(args);
          return calls.length === 1 ? null : { userId: "publisher_2" };
        }
      }
    } as never,
    "tenant_1",
    "asset_1"
  );

  assert.equal(userId, "publisher_2");
  assert.deepEqual(calls, [
    {
      where: { projectId: "tenant_1", assetId: "asset_1", status: "COMMITTED" },
      orderBy: { createdAt: "desc" },
      select: { userId: true }
    },
    {
      where: { tenantId: "tenant_1", assetId: "asset_1", status: "COMMITTED" },
      orderBy: { createdAt: "desc" },
      select: { userId: true }
    }
  ]);
});

test("worker-helper: resolveProjectScopeId prefers projectId and falls back to tenantId", () => {
  assert.equal(resolveProjectScopeId({ projectId: "project_1", tenantId: "tenant_1" }), "project_1");
  assert.equal(resolveProjectScopeId({ projectId: "", tenantId: "tenant_1" }), "tenant_1");
  assert.equal(resolveProjectScopeId({ projectId: null, tenantId: "tenant_1" }), "tenant_1");
});

test("labels: member labels use project wording by default", () => {
  assert.equal(getMemberLabel({ locale: "zh-CN" }), "项目成员");
  assert.equal(getMemberScopeLabel({ locale: "zh-CN" }), "项目成员");
  assert.equal(getMemberLabel({ locale: "en-US" }), "Project Member");
  assert.equal(getMemberScopeLabel({ locale: "en-US" }), "Project Member");
});

test("tenant-vault: project factory remains a compatibility alias", () => {
  assert.equal(createDeliveryProjectVault, createDeliveryTenantVault);
});

test("project-vault: project-first entry re-exports the compatibility factory", async () => {
  const projectVault = createDeliveryProjectVault({
    prisma: {
      tenantMember: {
        findFirst: async () => ({ id: "member_1" })
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    canManageProject: async () => true,
    ensureInitialOwner: async () => false
  });

  assert.equal(await projectVault.isProjectMember("user_1"), true);
});

test("delivery-admin: project factory remains a compatibility alias", () => {
  assert.equal(createProjectAdmin, createDeliveryAdmin);
});

test("discovery: project factory remains a compatibility alias", () => {
  assert.equal(createProjectDiscovery, createDeliveryDiscovery);
});

test("replica-selection: project factory remains a compatibility alias", () => {
  assert.equal(createProjectReplicaSelection, createDeliveryReplicaSelection);
});

test("preferences: project factory remains a compatibility alias", () => {
  assert.equal(createDeliveryProjectPreferences, createDeliveryPreferences);
  assert.equal(createProjectPreferences, createDeliveryPreferences);
  assert.equal(createProjectStorage, createDeliveryStorage);
});

test("storage: project-first method aliases remain compatible", async () => {
  const storage = createProjectStorage(
    {
      userPreference: {
        findUnique: async () => ({ value: "pref_v1" }),
        upsert: async () => ({}),
        delete: async () => ({})
      },
      tenantSetting: {
        findUnique: async () => ({ value: "setting_v1" }),
        upsert: async () => ({}),
        delete: async () => ({})
      }
    } as never,
    async () => "tenant_1"
  );

  assert.equal(storage.getProjectPreference, storage.getPreference);
  assert.equal(storage.upsertProjectPreference, storage.upsertPreference);
  assert.equal(storage.deleteProjectPreference, storage.deletePreference);
  assert.equal(storage.getProjectSetting, storage.getSetting);
  assert.equal(storage.upsertProjectSetting, storage.upsertSetting);
  assert.equal(storage.deleteProjectSetting, storage.deleteSetting);
});

test("social: project factory remains a compatibility alias", () => {
  assert.equal(createDeliveryProjectSocial, createDeliverySocial);
  assert.equal(createProjectSocialService, createDeliverySocial);
});

test("stats: project factory remains a compatibility alias", () => {
  assert.equal(createDeliveryProjectStats, createDeliveryStats);
  assert.equal(createProjectStatsService, createDeliveryStats);
});

test("bot project wrapper: high-level exports are independent project wrappers", async () => {
  const { createTenantRenderers } = await import("../bot/tenant/renderers");
  const { registerTenantCommands } = await import("../bot/tenant/register-commands");
  const { registerTenantMessageHandlers } = await import("../bot/tenant/register-messages");
  const { registerTenantMiddlewares } = await import("../bot/tenant/register-middlewares");
  const { registerTenantCallbackRoutes } = await import("../bot/tenant/callbacks");
  assert.notEqual(createProjectRenderers, createTenantRenderers);
  assert.notEqual(registerProjectCommands, registerTenantCommands);
  assert.notEqual(registerProjectMessageHandlers, registerTenantMessageHandlers);
  assert.notEqual(registerProjectMiddlewares, registerTenantMiddlewares);
  assert.notEqual(registerProjectCallbackRoutes, registerTenantCallbackRoutes);
});

test("bot project wrapper: registerProjectBot is a project entry wrapper instead of the tenant function reference", async () => {
  const { registerTenantBot } = await import("../bot/tenant");
  assert.equal(typeof registerProjectBot, "function");
  assert.notEqual(registerProjectBot, registerTenantBot);
});

test("bot project composition: reusable frame helpers are available", async () => {
  const { isCancelText, getDefaultKeyboard } = createProjectBotFrame(null);
  assert.equal(isCancelText("/cancel"), true);
  assert.equal(isCancelText("继续"), false);
  assert.equal(typeof formatProjectLocalDateTime(new Date("2026-04-21T08:09:00.000Z")), "string");
  const keyboard = await getDefaultKeyboard({ from: undefined } as never);
  assert.ok(keyboard);
});

test("bot project composition: scaffold owns session and action initialization", () => {
  const store = createUploadBatchStore();
  const scaffold = createProjectBotScaffold(
    store,
    {
      commitBatch: async () => ({ batchId: "batch_1", assetId: "asset_1" }),
      createBatch: () => {
        throw new Error("not used");
      },
      addMessage: () => {
        throw new Error("not used");
      },
      cancelBatch: () => ({ ok: true, message: "ok" }),
      updateAssetMeta: async () => ({ shareCode: "share_1" })
    } as never,
    null
  );

  assert.equal(typeof scaffold.ensureSessionMode, "function");
  assert.equal(typeof scaffold.commit, "function");
  assert.equal(typeof scaffold.openShareCode, "function");
  assert.equal(scaffold.historyPageSize, 10);
  assert.equal(scaffold.maxMetaBytes, 1500);
});

test("bot project composition: views factory owns middleware and renderer composition", () => {
  const bot = { use: () => undefined } as never;
  const views = createProjectBotViews(bot, {
    deliveryService: null,
    mainKeyboard: new Keyboard().text("菜单"),
    syncSessionForView: () => undefined,
    ensureSessionMode: () => "idle",
    setSessionMode: () => undefined,
    collectionStates: createStore<string | null>().store,
    historyFilterStates: createStore<string | null | undefined>().store,
    historyDateStates: createStore<Date>().store,
    historyScopeStates: createStore<"community" | "mine">().store,
    broadcastDraftStates: createStore<{ draftId: string }>().store,
    commentInputStates: createStore<{ assetId: string; replyToCommentId: string | null; replyToLabel: string | null }>().store,
    rankingViewStates: createStore<{ range: "today" | "week" | "month"; metric: "open" | "visit" | "like" | "comment" }>().store,
    formatLocalDateTime: formatProjectLocalDateTime
  });

  assert.equal(typeof views.hydrateUserPreferences, "function");
  assert.equal(typeof views.renderHistory, "function");
  assert.equal(typeof views.renderSearch, "function");
  assert.equal(typeof views.renderComments, "function");
  assert.equal(typeof views.renderTagIndex, "function");
});

test("bot project composition: admin input factory provides default datetime parsing", () => {
  const handlers = createProjectAdminInputHandlers({
    deliveryService: null,
    mainKeyboard: new Keyboard().text("菜单"),
    isActive: () => false,
    getSessionMode: () => "idle",
    setSessionMode: () => undefined,
    broadcastInputStates: createStore<any>().store,
    settingsInputStates: createStore<any>().store,
    renderBroadcast: async () => undefined,
    renderBroadcastButtons: async () => undefined,
    renderWelcomeSettings: async () => undefined,
    renderAdSettings: async () => undefined,
    renderAutoCategorizeSettings: async () => undefined,
    renderVaultSettings: async () => undefined
  } as never);

  assert.equal(typeof handlers.handleBroadcastText, "function");
  assert.equal(typeof handlers.handleSettingsText, "function");
});

test("bot project composition: interaction state helpers provide command reset and exit handlers", () => {
  const helpers = createProjectInteractionStateHandlers({
    getDefaultKeyboard: async () => new Keyboard().text("菜单"),
    ensureSessionMode: () => "idle",
    getSessionLabel: () => "分享",
    setSessionMode: () => undefined,
    setActive: () => undefined,
    cancel: async () => ({ ok: true, message: "ok" })
  });

  assert.equal(typeof helpers.resetSessionForCommand, "function");
  assert.equal(typeof helpers.exitCurrentInputState, "function");
});

test("bot project composition: collection title helper uses project-safe fallback", () => {
  assert.equal(getProjectCollectionTitle([], null), "未分类");
  assert.equal(getProjectCollectionTitle([{ id: "c1", title: "<b>教程</b>" }], "c1"), "教程");
  assert.equal(getProjectCollectionTitle([], "missing"), "未分类");
});

test("bot project composition: collection helper provides renderCollections", () => {
  const helpers = createProjectCollectionHelpers({
    deliveryService: null,
    mainKeyboard: new Keyboard().text("菜单"),
    hydrateUserPreferences: async () => undefined,
    collectionStates: createStore<any>().store,
    collectionPickerStates: createStore<any>().store
  });

  assert.equal(typeof helpers.renderCollections, "function");
});

test("bot project composition: manage panel helper provides renderManagePanel", () => {
  const helpers = createProjectManagePanelHelpers({
    deliveryService: null,
    mainKeyboard: new Keyboard().text("菜单"),
    syncSessionForView: () => undefined
  });

  assert.equal(typeof helpers.renderManagePanel, "function");
});

test("bot project composition: start payload helper provides tracking and routing handlers", () => {
  const helpers = createProjectStartPayloadHelpers({
    deliveryService: null,
    handleStartPayload: async () => false,
    openShareCode: async () => "opened",
    renderTagAssets: async () => undefined,
    renderManagePanel: async () => undefined
  });

  assert.equal(typeof helpers.trackStartPayloadVisit, "function");
  assert.equal(typeof helpers.handleStartPayloadEntry, "function");
});

test("bot project composition: meta flow helpers provide upload status and startMeta", () => {
  const helpers = createProjectMetaFlowHelpers({
    metaStates: createStore<any>().store,
    setSessionMode: () => undefined,
    maxMetaBytes: 1500,
    maxTitleBytes: 200,
    maxDescriptionBytes: 1200
  });

  assert.equal(typeof helpers.renderUploadStatus, "function");
  assert.equal(typeof helpers.startMeta, "function");
});

test("bot project composition: flow registration helper owns command callback and message orchestration", () => {
  const calls: string[] = [];
  const bot = {
    command: () => {
      calls.push("command");
      return bot;
    },
    callbackQuery: () => {
      calls.push("callback");
      return bot;
    },
    on: () => {
      calls.push("on");
      return bot;
    }
  } as never;

  registerProjectBotFlows(bot, {
    commands: {
      deliveryService: null,
      resetSessionForCommand: async () => undefined,
      trackStartPayloadVisit: async () => undefined,
      handleStartPayloadEntry: async () => true,
      renderStartHome: async () => undefined,
      renderHelp: async () => undefined,
      exitCurrentInputState: async () => true,
      renderTagIndex: async () => undefined,
      renderFootprint: async () => undefined
    },
    callbacks: {
      services: {
        deliveryService: null,
        uploadService: null as never,
        batchActions: { commit: async () => ({}), cancel: async () => ({}) }
      },
      session: {
        mainKeyboard: new Keyboard().text("菜单"),
        historyPageSize: 10,
        getSessionMode: () => "idle",
        setSessionMode: () => undefined,
        isActive: () => false,
        syncSessionForView: () => undefined,
        hydrateUserPreferences: async () => undefined,
        formatLocalDateTime: formatProjectLocalDateTime
      },
      states: {
        settingsInputStates: createStore<any>().store,
        adminInputStates: createStore<any>().store,
        broadcastInputStates: createStore<any>().store,
        broadcastDraftStates: createStore<any>().store,
        collectionStates: createStore<any>().store,
        historyFilterStates: createStore<any>().store,
        historyDateStates: createStore<any>().store,
        historyScopeStates: createStore<any>().store,
        collectionInputStates: createStore<any>().store,
        collectionPickerStates: createStore<any>().store,
        searchStates: createStore<any>().store,
        commentInputStates: createStore<any>().store,
        rankingViewStates: createStore<any>().store
      },
      renderers: {
        renderUploadStatus: async () => undefined,
        renderManagePanel: async () => undefined,
        startMeta: async () => undefined,
        renderComments: async () => undefined,
        openAsset: async () => undefined,
        refreshAssetActions: async () => undefined,
        renderFootprint: async () => undefined,
        renderHistory: async () => undefined,
        renderSearch: async () => undefined,
        renderTagIndex: async () => undefined,
        renderTagAssets: async () => undefined,
        renderCollections: async () => undefined,
        renderHelp: async () => undefined,
        renderMy: async () => undefined,
        renderFollow: async () => undefined,
        renderNotifySettings: async () => undefined,
        renderSettings: async () => undefined,
        renderWelcomeSettings: async () => undefined,
        renderAdSettings: async () => undefined,
        renderProtectSettings: async () => undefined,
        renderHidePublisherSettings: async () => undefined,
        renderAutoCategorizeSettings: async () => undefined,
        renderRankPublicSettings: async () => undefined,
        renderSearchModeSettings: async () => undefined,
        renderVaultSettings: async () => undefined,
        renderBroadcast: async () => undefined,
        renderBroadcastButtons: async () => undefined,
        renderStartHome: async () => undefined,
        renderStats: async () => undefined,
        renderRanking: async () => undefined
      }
    } as never,
    messages: {
      deliveryService: null,
      mainKeyboard: new Keyboard().text("菜单"),
      getDefaultKeyboard: async () => new Keyboard().text("菜单"),
      isCancelText: () => false,
      exitCurrentInputState: async () => undefined,
      handleMetaInput: async () => false,
      handleBroadcastPhoto: async () => undefined,
      handleBroadcastVideo: async () => undefined,
      handleBroadcastDocument: async () => undefined,
      handleBroadcastText: async () => false,
      handleSettingsText: async () => false,
      handleCommentInputText: async () => false,
      notifyCommentTargets: async () => undefined,
      renderComments: async () => undefined,
      renderFollow: async () => undefined,
      renderHistory: async () => undefined,
      renderSearch: async () => undefined,
      renderFootprint: async () => undefined,
      renderMy: async () => undefined,
      renderSettings: async () => undefined,
      renderTagIndex: async () => undefined,
      renderTagAssets: async () => undefined,
      renderUploadStatus: async () => undefined,
      renderCollections: async () => undefined,
      openShareCode: async () => undefined,
      trackStartPayloadVisit: async () => undefined,
      handleStartPayloadEntry: async () => true,
      getSessionMode: () => "idle",
      ensureSessionMode: () => "idle",
      setSessionMode: () => undefined,
      setActive: () => undefined,
      historyScopeStates: createStore<any>().store,
      historyDateStates: createStore<any>().store,
      searchStates: createStore<any>().store,
      collectionInputStates: createStore<any>().store,
      adminInputStates: createStore<any>().store,
      commentInputStates: createStore<any>().store,
      updateVaultTopicIndexByCollection: async () => undefined
    }
  });

  assert.ok(calls.length > 0);
});

test("bot project wrapper modules: direct modules are independent wrapper functions", async () => {
  const { createTenantRenderers } = await import("../bot/tenant/renderers");
  const { registerTenantCommands } = await import("../bot/tenant/register-commands");
  const { registerTenantMessageHandlers } = await import("../bot/tenant/register-messages");
  const { registerTenantMiddlewares } = await import("../bot/tenant/register-middlewares");
  const { registerTenantCallbackRoutes } = await import("../bot/tenant/callbacks");
  assert.notEqual(createProjectRenderersModule, createTenantRenderers);
  assert.notEqual(registerProjectCommandsModule, registerTenantCommands);
  assert.notEqual(registerProjectMessageHandlersModule, registerTenantMessageHandlers);
  assert.notEqual(registerProjectMiddlewaresModule, registerTenantMiddlewares);
  assert.notEqual(registerProjectCallbackRoutesModule, registerTenantCallbackRoutes);
});

test("server: project-check uses project diagnostics wording", async () => {
  const app = createServer(
    {} as never,
    {
      botToken: "token",
      webhookPath: "/telegram/webhook",
      databaseUrl: "memory",
      redisUrl: "memory",
      projectContext: { code: "demo-project", name: "Demo Project" },
      projectCode: "demo-project",
      projectName: "Demo Project",
      tenantCode: "demo-project",
      tenantName: "Demo Project",
      vaultChatId: "-1001",
      host: "127.0.0.1",
      port: 3002,
      opsToken: "ops-token"
    },
    false,
    {
      prisma: { $queryRawUnsafe: async () => 1 } as never,
      getProjectDiagnostics: async () => ({
        currentProjectCode: "demo-project",
        matched: true,
        projects: []
      }),
      getTenantDiagnostics: async () => ({
        currentTenantCode: "demo-project",
        matched: true,
        tenants: []
      })
    }
  );

  try {
    const response = await app.inject({
      method: "GET",
      url: "/ops/project-check",
      headers: { "x-ops-token": "ops-token" }
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      ok: true,
      currentProjectCode: "demo-project",
      matched: true,
      projects: []
    });
  } finally {
    await app.close();
  }
});

test("server: tenant-check remains a compatibility route", async () => {
  const app = createServer(
    {} as never,
    {
      botToken: "token",
      webhookPath: "/telegram/webhook",
      databaseUrl: "memory",
      redisUrl: "memory",
      projectContext: { code: "demo-project", name: "Demo Project" },
      projectCode: "demo-project",
      projectName: "Demo Project",
      tenantCode: "demo-project",
      tenantName: "Demo Project",
      vaultChatId: "-1001",
      host: "127.0.0.1",
      port: 3002,
      opsToken: "ops-token"
    },
    false,
    {
      prisma: { $queryRawUnsafe: async () => 1 } as never,
      getProjectDiagnostics: async () => ({
        currentProjectCode: "demo-project",
        matched: true,
        projects: []
      }),
      getTenantDiagnostics: async () => ({
        currentTenantCode: "demo-project",
        matched: true,
        tenants: []
      })
    }
  );

  try {
    const response = await app.inject({
      method: "GET",
      url: "/ops/tenant-check",
      headers: { "x-ops-token": "ops-token" }
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      ok: true,
      currentTenantCode: "demo-project",
      matched: true,
      tenants: []
    });
  } finally {
    await app.close();
  }
});

test("server: OPS_PROJECT_CHECK rate-limit envs override legacy tenant envs", async () => {
  const previous = {
    OPS_PROJECT_CHECK_RATE_WINDOW_MS: process.env.OPS_PROJECT_CHECK_RATE_WINDOW_MS,
    OPS_PROJECT_CHECK_RATE_LIMIT: process.env.OPS_PROJECT_CHECK_RATE_LIMIT,
    OPS_TENANT_CHECK_RATE_WINDOW_MS: process.env.OPS_TENANT_CHECK_RATE_WINDOW_MS,
    OPS_TENANT_CHECK_RATE_LIMIT: process.env.OPS_TENANT_CHECK_RATE_LIMIT
  };
  process.env.OPS_PROJECT_CHECK_RATE_WINDOW_MS = "60000";
  process.env.OPS_PROJECT_CHECK_RATE_LIMIT = "1";
  process.env.OPS_TENANT_CHECK_RATE_WINDOW_MS = "60000";
  process.env.OPS_TENANT_CHECK_RATE_LIMIT = "999";

  const app = createServer(
    {} as never,
    {
      botToken: "token",
      webhookPath: "/telegram/webhook",
      databaseUrl: "memory",
      redisUrl: "memory",
      projectContext: { code: "demo-project", name: "Demo Project" },
      projectCode: "demo-project",
      projectName: "Demo Project",
      tenantCode: "demo-project",
      tenantName: "Demo Project",
      vaultChatId: "-1001",
      host: "127.0.0.1",
      port: 3002,
      opsToken: "ops-token"
    },
    false,
    {
      prisma: { $queryRawUnsafe: async () => 1 } as never,
      getProjectDiagnostics: async () => ({
        currentProjectCode: "demo-project",
        matched: true,
        projects: []
      }),
      getTenantDiagnostics: async () => ({
        currentTenantCode: "demo-project",
        matched: true,
        tenants: []
      })
    }
  );

  try {
    const first = await app.inject({
      method: "GET",
      url: "/ops/project-check",
      headers: { "x-ops-token": "ops-token" }
    });
    const second = await app.inject({
      method: "GET",
      url: "/ops/project-check",
      headers: { "x-ops-token": "ops-token" }
    });

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 429);
  } finally {
    await app.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

const createStore = <T>() => {
  const map = new Map<string, T>();
  return {
    map,
    store: {
      get: (key: string) => map.get(key),
      set: (key: string, value: T) => {
        map.set(key, value);
      },
      has: (key: string) => map.has(key),
      delete: (key: string) => map.delete(key)
    } as any
  };
};

const createMockCtx = (overrides?: Partial<Record<string, unknown>>) => {
  const calls: Array<{ method: "reply" | "editMessageText"; args: unknown[] }> = [];
  const ctx = {
    from: { id: 1, username: "u", first_name: "U" },
    chat: { id: 2 },
    me: { username: "bot" },
    reply: async (...args: unknown[]) => {
      calls.push({ method: "reply", args });
      return { message_id: 1 };
    },
    editMessageText: async (...args: unknown[]) => {
      calls.push({ method: "editMessageText", args });
      return true;
    },
    callbackQuery: undefined,
    message: undefined,
    ...overrides
  };
  return { ctx: ctx as any, calls };
};

test("tags: renderTagIndex prefers project search mode", async () => {
  const { ctx, calls } = createMockCtx();
  let projectCalls = 0;
  const tags = createProjectTagRenderers({
    deliveryService: {
      getProjectSearchMode: async () => {
        projectCalls += 1;
        return "PUBLIC" as const;
      },
      getTenantSearchMode: async () => {
        throw new Error("should not be called");
      },
      isProjectMember: async () => false,
      listTopTags: async () => ({
        total: 1,
        items: [{ tagId: "tag-1", name: "精选", count: 3 }]
      })
    } as never,
    mainKeyboard: new Keyboard().text("菜单")
  });

  await tags.renderTagIndex(ctx, "reply");

  assert.equal(projectCalls, 1);
  assert.ok(calls.some((c) => c.method === "reply" && String(c.args[0]).includes("热门标签")));
});

test("ui-utils: resolveUserLabel prefers project label alias", async () => {
  const { ctx } = createMockCtx();
  let projectCalls = 0;
  const label = await resolveUserLabel(ctx, "project-user-label", {
    getProjectUserLabel: async () => {
      projectCalls += 1;
      return "@project-user";
    }
  } as never);

  assert.equal(label, "@project-user");
  assert.equal(projectCalls, 1);
});

test("ui-utils: buildPublisherLine uses readable publisher label", async () => {
  const { ctx } = createMockCtx();
  const line = await buildPublisherLine(ctx, "123", {
    getProjectUserLabel: async () => "@publisher"
  } as never);

  assert.ok(line.includes("发布者："));
  assert.ok(line.includes("@publisher"));
});

test("ui-utils: buildBlockingHint uses readable label", () => {
  assert.equal(buildBlockingHint("需要确认"), "提示：需要确认");
});

test("admin-input: broadcastInput 无数据库时会退出并提示", async () => {
  const modes = new Map<string, "idle" | "broadcastInput">();
  const setSessionModeCalls: Array<{ key: string; mode: string }> = [];
  const { store: broadcastInputStates } = createStore<{ mode: "broadcastContent"; draftId: string }>();
  const { store: settingsInputStates } = createStore<any>();
  const { ctx, calls } = createMockCtx();
  const key = toMetaKey(ctx.from.id, ctx.chat.id);
  modes.set(key, "broadcastInput");
  broadcastInputStates.set(key, { mode: "broadcastContent", draftId: "d1" });

  const admin = createProjectAdminInput({
    deliveryService: null,
    mainKeyboard: new Keyboard().text("菜单"),
    isActive: () => false,
    getSessionMode: (k) => (modes.get(k) ?? "idle") as never,
    setSessionMode: (k, mode) => {
      modes.set(k, mode as never);
      setSessionModeCalls.push({ key: k, mode });
    },
    broadcastInputStates,
    settingsInputStates,
    parseLocalDateTime: () => null,
    renderBroadcast: async () => undefined,
    renderBroadcastButtons: async () => undefined,
    renderWelcomeSettings: async () => undefined,
    renderAdSettings: async () => undefined,
    renderAutoCategorizeSettings: async () => undefined,
    renderVaultSettings: async () => undefined
  });

  const handled = await admin.handleBroadcastText(ctx, "hello");
  assert.equal(handled, true);
  assert.equal(modes.get(key), "idle");
  assert.ok(setSessionModeCalls.some((item) => item.key === key && item.mode === "idle"));
  assert.ok(calls.some((c) => c.method === "reply" && String(c.args[0]).includes("未启用数据库")));
});

test("admin-input: broadcastScheduleAt 时间格式错误会提示", async () => {
  const modes = new Map<string, "idle" | "broadcastInput">();
  const { store: broadcastInputStates } = createStore<
    | { mode: "broadcastScheduleAt"; draftId: string }
    | { mode: "broadcastRepeatEvery"; draftId: string }
    | { mode: "broadcastContent"; draftId: string }
    | { mode: "broadcastButtonText"; draftId: string }
    | { mode: "broadcastButtonUrl"; draftId: string; text: string }
  >();
  const { store: settingsInputStates } = createStore<any>();
  const { ctx, calls } = createMockCtx();
  const key = toMetaKey(ctx.from.id, ctx.chat.id);
  modes.set(key, "broadcastInput");
  broadcastInputStates.set(key, { mode: "broadcastScheduleAt", draftId: "d1" });

  const deliveryService = {
    canManageProject: async () => true,
    canManageAdmins: async () => true,
    scheduleBroadcast: async () => ({ message: "ok" })
  } as never;

  const admin = createProjectAdminInput({
    deliveryService,
    mainKeyboard: new Keyboard().text("菜单"),
    isActive: () => false,
    getSessionMode: (k) => (modes.get(k) ?? "idle") as never,
    setSessionMode: (k, mode) => modes.set(k, mode as never),
    broadcastInputStates,
    settingsInputStates,
    parseLocalDateTime: () => null,
    renderBroadcast: async () => undefined,
    renderBroadcastButtons: async () => undefined,
    renderWelcomeSettings: async () => undefined,
    renderAdSettings: async () => undefined,
    renderAutoCategorizeSettings: async () => undefined,
    renderVaultSettings: async () => undefined
  });

  const handled = await admin.handleBroadcastText(ctx, "bad");
  assert.equal(handled, true);
  assert.ok(calls.some((c) => c.method === "reply" && String(c.args[0]).includes("时间格式错误")));
});

test("admin-input: broadcastScheduleAt 过去时间不会立即发送", async () => {
  const modes = new Map<string, "idle" | "broadcastInput">();
  const { store: broadcastInputStates } = createStore<
    | { mode: "broadcastScheduleAt"; draftId: string }
    | { mode: "broadcastRepeatEvery"; draftId: string }
    | { mode: "broadcastContent"; draftId: string }
    | { mode: "broadcastButtonText"; draftId: string }
    | { mode: "broadcastButtonUrl"; draftId: string; text: string }
  >();
  const { store: settingsInputStates } = createStore<any>();
  const { ctx, calls } = createMockCtx();
  const key = toMetaKey(ctx.from.id, ctx.chat.id);
  modes.set(key, "broadcastInput");
  broadcastInputStates.set(key, { mode: "broadcastScheduleAt", draftId: "d1" });

  let scheduled = false;
  const deliveryService = {
    canManageProject: async () => true,
    canManageAdmins: async () => true,
    scheduleBroadcast: async () => {
      scheduled = true;
      return { message: "ok" };
    }
  } as never;

  const admin = createProjectAdminInput({
    deliveryService,
    mainKeyboard: new Keyboard().text("菜单"),
    isActive: () => false,
    getSessionMode: (k) => (modes.get(k) ?? "idle") as never,
    setSessionMode: (k, mode) => modes.set(k, mode as never),
    broadcastInputStates,
    settingsInputStates,
    parseLocalDateTime: () => new Date(Date.now() - 60_000),
    renderBroadcast: async () => undefined,
    renderBroadcastButtons: async () => undefined,
    renderWelcomeSettings: async () => undefined,
    renderAdSettings: async () => undefined,
    renderAutoCategorizeSettings: async () => undefined,
    renderVaultSettings: async () => undefined
  });

  const handled = await admin.handleBroadcastText(ctx, "2026-01-01 00:00");
  assert.equal(handled, true);
  assert.equal(scheduled, false);
  assert.equal(modes.get(key), "broadcastInput");
  assert.ok(calls.some((c) => c.method === "reply" && String(c.args[0]).includes("不能早于当前时间")));
});

test("admin-input: welcome 清除会写入 null", async () => {
  const modes = new Map<string, "idle" | "settingsInput">();
  const { store: broadcastInputStates } = createStore<any>();
  const { store: settingsInputStates } = createStore<any>();
  const { ctx } = createMockCtx();
  const key = toMetaKey(ctx.from.id, ctx.chat.id);
  modes.set(key, "settingsInput");
  settingsInputStates.set(key, { mode: "welcome" });

  const welcomeCalls: Array<unknown[]> = [];
  const deliveryService = {
    canManageProject: async () => true,
    canManageAdmins: async () => true,
    setProjectStartWelcomeHtml: async (...args: unknown[]) => {
      welcomeCalls.push(args);
      return { message: "ok" };
    },
    setTenantStartWelcomeHtml: async (...args: unknown[]) => {
      welcomeCalls.push(args);
      return { message: "ok" };
    }
  } as never;

  let renderCalled = false;
  const admin = createProjectAdminInput({
    deliveryService,
    mainKeyboard: new Keyboard().text("菜单"),
    isActive: () => false,
    getSessionMode: (k) => (modes.get(k) ?? "idle") as never,
    setSessionMode: (k, mode) => modes.set(k, mode as never),
    broadcastInputStates,
    settingsInputStates,
    parseLocalDateTime: () => null,
    renderBroadcast: async () => undefined,
    renderBroadcastButtons: async () => undefined,
    renderWelcomeSettings: async () => {
      renderCalled = true;
    },
    renderAdSettings: async () => undefined,
    renderAutoCategorizeSettings: async () => undefined,
    renderVaultSettings: async () => undefined
  });

  const handled = await admin.handleSettingsText(ctx, "清除");
  assert.equal(handled, true);
  assert.ok(welcomeCalls.length === 1);
  assert.equal(welcomeCalls[0]?.[1], null);
  assert.equal(renderCalled, true);
});

test("social: 评论输入中发送保留词会提示并不退出", async () => {
  const modes = new Map<string, "idle" | "commentInput">();
  const { store: commentInputStates } = createStore<{ assetId: string; replyToCommentId: string | null; replyToLabel: string | null }>();
  const { ctx, calls } = createMockCtx();
  const key = toMetaKey(ctx.from.id, ctx.chat.id);
  modes.set(key, "commentInput");
  commentInputStates.set(key, { assetId: "a1", replyToCommentId: null, replyToLabel: null });

  const social = createProjectSocial({
    deliveryService: null,
    mainKeyboard: new Keyboard().text("菜单"),
    ensureSessionMode: (k) => (modes.get(k) ?? "idle") as never,
    setSessionMode: (k, mode) => modes.set(k, mode as never),
    commentInputStates,
    formatLocalDateTime: () => "x"
  });

  const handled = await social.handleCommentInputText(ctx, "分享");
  assert.equal(handled, true);
  assert.equal(modes.get(key), "commentInput");
  assert.ok(calls.some((c) => c.method === "reply" && String(c.args[0]).includes("正在评论")));
});

test("social: 无数据库时发表评论会退出并提示", async () => {
  const modes = new Map<string, "idle" | "commentInput">();
  const { store: commentInputStates } = createStore<{ assetId: string; replyToCommentId: string | null; replyToLabel: string | null }>();
  const { ctx, calls } = createMockCtx();
  const key = toMetaKey(ctx.from.id, ctx.chat.id);
  modes.set(key, "commentInput");
  commentInputStates.set(key, { assetId: "a1", replyToCommentId: null, replyToLabel: null });

  const social = createProjectSocial({
    deliveryService: null,
    mainKeyboard: new Keyboard().text("菜单"),
    ensureSessionMode: (k) => (modes.get(k) ?? "idle") as never,
    setSessionMode: (k, mode) => modes.set(k, mode as never),
    commentInputStates,
    formatLocalDateTime: () => "x"
  });

  const handled = await social.handleCommentInputText(ctx, "hello");
  assert.equal(handled, true);
  assert.equal(modes.get(key), "idle");
  assert.ok(calls.some((c) => c.method === "reply" && String(c.args[0]).includes("无法发表评论")));
});

test("social: 评论输入中发送 /start 会退出评论模式并不发表评论", async () => {
  const modes = new Map<string, "idle" | "commentInput">();
  const { store: commentInputStates } = createStore<{ assetId: string; replyToCommentId: string | null; replyToLabel: string | null }>();
  const { ctx, calls } = createMockCtx();
  const key = toMetaKey(ctx.from.id, ctx.chat.id);
  modes.set(key, "commentInput");
  commentInputStates.set(key, { assetId: "a1", replyToCommentId: null, replyToLabel: null });

  const social = createProjectSocial({
    deliveryService: {
      addAssetComment: async () => {
        throw new Error("should not be called");
      }
    } as never,
    mainKeyboard: new Keyboard().text("菜单"),
    ensureSessionMode: (k) => (modes.get(k) ?? "idle") as never,
    setSessionMode: (k, mode) => modes.set(k, mode as never),
    commentInputStates,
    formatLocalDateTime: () => "x"
  });

  const handled = await social.handleCommentInputText(ctx, "/start");
  assert.equal(handled, true);
  assert.equal(modes.get(key), "idle");
  assert.ok(calls.some((c) => c.method === "reply" && String(c.args[0]).includes("已退出评论模式")));
});

test("messages: search mode remains active after consecutive queries", async () => {
  const textHandlers: Array<(ctx: any) => Promise<void>> = [];
  const bot = {
    on: (event: string, handler: (ctx: any) => Promise<void>) => {
      if (event === "message:text") {
        textHandlers.push(handler);
      }
    }
  } as any;

  const sessionModes = new Map<string, string>();
  const { store: historyScopeStates } = createStore<"community" | "mine">();
  const { store: historyDateStates } = createStore<Date>();
  const { store: searchStates } = createStore<{ query: string }>();
  const { store: collectionInputStates } = createStore<any>();
  const { store: adminInputStates } = createStore<any>();
  const { store: commentInputStates } = createStore<any>();
  const searchCalls: string[] = [];

  registerProjectMessageHandlers(bot, {
    deliveryService: null,
    mainKeyboard: new Keyboard().text("菜单"),
    getDefaultKeyboard: async () => new Keyboard().text("菜单"),
    isCancelText: () => false,
    exitCurrentInputState: async () => undefined,
    handleMetaInput: async () => false,
    handleBroadcastPhoto: async () => undefined,
    handleBroadcastVideo: async () => undefined,
    handleBroadcastDocument: async () => undefined,
    handleBroadcastText: async () => false,
    handleSettingsText: async () => false,
    handleCommentInputText: async () => false,
    notifyCommentTargets: async () => undefined,
    renderComments: async () => undefined,
    renderFollow: async () => undefined,
    renderHistory: async () => undefined,
    renderSearch: async (_ctx, query) => {
      searchCalls.push(query);
    },
    renderFootprint: async () => undefined,
    renderMy: async () => undefined,
    renderSettings: async () => undefined,
    renderTagIndex: async () => undefined,
    renderTagAssets: async () => undefined,
    renderUploadStatus: async () => undefined,
    renderCollections: async () => undefined,
    openShareCode: async () => undefined,
    trackStartPayloadVisit: async () => undefined,
    handleStartPayloadEntry: async () => false,
    getSessionMode: (key: string) => sessionModes.get(key) ?? "idle",
    ensureSessionMode: (key: string) => sessionModes.get(key) ?? "idle",
    setSessionMode: (key: string, mode: string) => {
      sessionModes.set(key, mode);
    },
    setActive: () => undefined,
    historyScopeStates,
    historyDateStates,
    searchStates,
    collectionInputStates,
    adminInputStates,
    commentInputStates,
    updateVaultTopicIndexByCollection: async () => undefined
  });

  const textHandler = textHandlers[0];
  assert.ok(textHandler);

  const key = toMetaKey(1, 2);
  sessionModes.set(key, "searchInput");
  const ctx = {
    from: { id: 1, first_name: "U" },
    chat: { id: 2 },
    me: { username: "bot" },
    message: { text: "原神" },
    reply: async () => ({ message_id: 1 })
  } as any;

  await textHandler(ctx);
  ctx.message.text = "鸭鸭幼稚园";
  await textHandler(ctx);

  assert.deepEqual(searchCalls, ["原神", "鸭鸭幼稚园"]);
  assert.equal(sessionModes.get(key), "searchInput");
});

test("messages: 收藏 command is treated like 我的 entry", async () => {
  const textHandlers: Array<(ctx: any) => Promise<void>> = [];
  const bot = {
    on: (event: string, handler: (ctx: any) => Promise<void>) => {
      if (event === "message:text") {
        textHandlers.push(handler);
      }
    }
  } as any;

  let myRendered = 0;
  registerProjectMessageHandlers(bot, {
    deliveryService: null,
    mainKeyboard: new Keyboard().text("菜单"),
    getDefaultKeyboard: async () => new Keyboard().text("菜单"),
    isCancelText: () => false,
    exitCurrentInputState: async () => undefined,
    handleMetaInput: async () => false,
    handleBroadcastPhoto: async () => undefined,
    handleBroadcastVideo: async () => undefined,
    handleBroadcastDocument: async () => undefined,
    handleBroadcastText: async () => false,
    handleSettingsText: async () => false,
    handleCommentInputText: async () => false,
    notifyCommentTargets: async () => undefined,
    renderComments: async () => undefined,
    renderFollow: async () => undefined,
    renderHistory: async () => undefined,
    renderSearch: async () => undefined,
    renderFootprint: async () => undefined,
    renderMy: async () => {
      myRendered += 1;
    },
    renderSettings: async () => undefined,
    renderTagIndex: async () => undefined,
    renderTagAssets: async () => undefined,
    renderUploadStatus: async () => undefined,
    renderCollections: async () => undefined,
    openShareCode: async () => undefined,
    trackStartPayloadVisit: async () => undefined,
    handleStartPayloadEntry: async () => false,
    getSessionMode: () => "idle",
    ensureSessionMode: () => "idle",
    setSessionMode: () => undefined,
    setActive: () => undefined,
    historyScopeStates: createStore<"community" | "mine">().store,
    historyDateStates: createStore<Date>().store,
    searchStates: createStore<{ query: string }>().store,
    collectionInputStates: createStore<any>().store,
    adminInputStates: createStore<any>().store,
    commentInputStates: createStore<any>().store,
    updateVaultTopicIndexByCollection: async () => undefined
  });

  const textHandler = textHandlers[0];
  assert.ok(textHandler);
  await textHandler!({
    from: { id: 1, first_name: "U" },
    chat: { id: 2 },
    me: { username: "bot" },
    message: { text: "收藏" },
    reply: async () => ({ message_id: 1 })
  });
  assert.equal(myRendered, 1);
});

test("i18n: telegram non-zh language still keeps Chinese locale by default", () => {
  assert.equal(resolveLocaleFromTelegramLanguageCode("en"), "zh-CN");
  assert.equal(resolveLocaleFromTelegramLanguageCode("en-US"), "zh-CN");
  assert.equal(resolveLocaleFromTelegramLanguageCode("zh-CN"), "zh-CN");
});

test("messages: English keyboard commands still route to the original Chinese actions", async () => {
  const textHandlers: Array<(ctx: any) => Promise<void>> = [];
  const bot = {
    on: (event: string, handler: (ctx: any) => Promise<void>) => {
      if (event === "message:text") {
        textHandlers.push(handler);
      }
    }
  } as any;

  let historyRendered = 0;
  let searchPrompted = 0;
  let myRendered = 0;
  registerProjectMessageHandlers(bot, {
    deliveryService: null,
    mainKeyboard: new Keyboard().text("菜单"),
    getDefaultKeyboard: async () => new Keyboard().text("菜单"),
    isCancelText: () => false,
    exitCurrentInputState: async () => undefined,
    handleMetaInput: async () => false,
    handleBroadcastPhoto: async () => undefined,
    handleBroadcastVideo: async () => undefined,
    handleBroadcastDocument: async () => undefined,
    handleBroadcastText: async () => false,
    handleSettingsText: async () => false,
    handleCommentInputText: async () => false,
    notifyCommentTargets: async () => undefined,
    renderComments: async () => undefined,
    renderFollow: async () => undefined,
    renderHistory: async () => {
      historyRendered += 1;
    },
    renderSearch: async () => undefined,
    renderFootprint: async () => undefined,
    renderMy: async () => {
      myRendered += 1;
    },
    renderSettings: async () => undefined,
    renderTagIndex: async () => undefined,
    renderTagAssets: async () => undefined,
    renderUploadStatus: async () => undefined,
    renderCollections: async () => undefined,
    openShareCode: async () => undefined,
    trackStartPayloadVisit: async () => undefined,
    handleStartPayloadEntry: async () => false,
    getSessionMode: () => "idle",
    ensureSessionMode: () => "idle",
    setSessionMode: () => undefined,
    setActive: () => undefined,
    historyScopeStates: createStore<"community" | "mine">().store,
    historyDateStates: createStore<Date>().store,
    searchStates: createStore<{ query: string }>().store,
    collectionInputStates: createStore<any>().store,
    adminInputStates: createStore<any>().store,
    commentInputStates: createStore<any>().store,
    updateVaultTopicIndexByCollection: async () => undefined
  });

  const textHandler = textHandlers[0];
  assert.ok(textHandler);

  const libraryCtx = {
    from: { id: 1, first_name: "U" },
    chat: { id: 2 },
    me: { username: "bot" },
    message: { text: "Library" },
    reply: async (...args: unknown[]) => {
      if (String(args[0]).includes("搜索")) {
        searchPrompted += 1;
      }
      return { message_id: 1 };
    }
  };
  await textHandler!(libraryCtx);

  const myCtx = {
    ...libraryCtx,
    message: { text: "My" }
  };
  await textHandler!(myCtx);

  const searchCtx = {
    ...libraryCtx,
    message: { text: "Search" }
  };
  await textHandler!(searchCtx);

  assert.equal(historyRendered, 1);
  assert.equal(myRendered, 1);
  assert.equal(searchPrompted, 1);
});

test("ui-utils: extractStartPayloadFromText 能解析 t.me start 链接", () => {
  assert.equal(extractStartPayloadFromText("https://t.me/ChuYunbot?start=hZ9hyXAf"), "hZ9hyXAf");
  assert.equal(extractStartPayloadFromText("t.me/ChuYunbot?start=p_hZ9hyXAf_2"), "p_hZ9hyXAf_2");
  assert.equal(extractStartPayloadFromText("tg://resolve?domain=ChuYunbot&start=hZ9hyXAf"), "hZ9hyXAf");
  assert.equal(extractStartPayloadFromText("https://example.com/?start=hZ9hyXAf"), null);
});

test("callbacks: comment:list 回调能正确解析 assetId 与页码", () => {
  const data = "comment:list:cmnfoiur202f2rnsr73z4icfw:1:3";
  const match = data.match(commentListCallbackRe);
  assert.ok(match);
  assert.equal(match?.[1], "cmnfoiur202f2rnsr73z4icfw");
  assert.equal(match?.[2], "1");
  assert.equal(match?.[3], "3");
});

test("callbacks: history:setfilter:collection 回调不吞分隔符", () => {
  const data = "history:setfilter:collection:cmnfoiur202f2rnsr73z4icfw";
  const match = data.match(historySetFilterCollectionCallbackRe);
  assert.ok(match);
  assert.equal(match?.[1], "cmnfoiur202f2rnsr73z4icfw");
});

test("callbacks: history:scope 回调能正确解析列表视图", () => {
  const data = "history:scope:community";
  const match = data.match(historyScopeCallbackRe);
  assert.ok(match);
  assert.equal(match?.[1], "community");
});

test("callbacks: history:more 回调能正确解析动作与页码", () => {
  const data = "history:more:3";
  const match = data.match(historyMoreCallbackRe);
  assert.ok(match);
  assert.equal(match?.[1], "more");
  assert.equal(match?.[2], "3");
});

test("callbacks: foot:more 回调能正确解析参数", () => {
  const data = "foot:more:like:2:30d";
  const match = data.match(footMoreCallbackRe);
  assert.ok(match);
  assert.equal(match?.[1], "more");
  assert.equal(match?.[2], "like");
  assert.equal(match?.[3], "2");
  assert.equal(match?.[4], "30d");
});

test("callbacks: rank:more 回调能正确解析参数", () => {
  const data = "rank:more:week:visit";
  const match = data.match(rankMoreCallbackRe);
  assert.ok(match);
  assert.equal(match?.[1], "more");
  assert.equal(match?.[2], "week");
  assert.equal(match?.[3], "visit");
});

test("index: 普通用户操作行仅显示点击查看", () => {
  const line = buildAssetActionLine({
    username: "bot_name",
    shareCode: "abc123",
    assetId: "asset_1",
    canManage: false
  });
  assert.equal(line, '操作：<a href="https://t.me/bot_name?start=p_abc123">点击查看</a>');
});

test("index: 管理员操作行并排显示管理与点击查看", () => {
  const line = buildAssetActionLine({
    username: "bot_name",
    shareCode: "abc123",
    assetId: "asset_1",
    canManage: true
  });
  assert.equal(
    line,
    '操作：<a href="https://t.me/bot_name?start=m_asset_1">管理</a> ｜ <a href="https://t.me/bot_name?start=p_abc123">点击查看</a>'
  );
});

test("index: 预览链接展示使用超链接而非 code 包裹", () => {
  const line = buildPreviewLinkLine("https://t.me/bot_name?start=p_abc123");
  assert.ok(line.includes('<a href="https://t.me/bot_name?start=p_abc123">点击预览</a>'));
  assert.equal(line.includes("<code>"), false);
  assert.equal(line.includes("预览 -"), false);
});

test("keyboards: 排行指标 like 文案显示为收藏", () => {
  const keyboard = buildRankingKeyboard({ range: "today", metric: "like", isTenant: true });
  const textList = (keyboard as unknown as { inline_keyboard: Array<Array<{ text: string }>> }).inline_keyboard
    .flat()
    .map((item) => item.text);
  assert.ok(textList.includes("收藏 ✅"));
  assert.equal(textList.includes("点赞 ✅"), false);
  assert.equal(textList.includes("点赞"), false);
});

test("keyboards: 足迹 tab like 文案显示为收藏", () => {
  const keyboard = buildFootprintKeyboard({ tab: "like", range: "30d", page: 1, totalPages: 1 });
  const textList = (keyboard as unknown as { inline_keyboard: Array<Array<{ text: string }>> }).inline_keyboard
    .flat()
    .map((item) => item.text);
  assert.ok(textList.includes("收藏 ✅"));
  assert.equal(textList.includes("点赞 ✅"), false);
  assert.equal(textList.includes("点赞"), false);
});

test("keyboards: 我的页入口显示为收藏", () => {
  const keyboard = buildMyKeyboard();
  const textList = (keyboard as unknown as { inline_keyboard: Array<Array<{ text: string }>> }).inline_keyboard
    .flat()
    .map((item) => item.text);
  assert.ok(textList.includes("⭐ 收藏"));
  assert.equal(textList.includes("🔔 关注"), false);
});

test("copy: like 核心入口文案保持收藏语义", () => {
  const files = [
    path.resolve(__dirname, "../bot/tenant/open.ts"),
    path.resolve(__dirname, "../bot/project/index.ts"),
    path.resolve(__dirname, "../bot/project/register-core.ts"),
    path.resolve(__dirname, "../bot/tenant/renderers.ts"),
    path.resolve(__dirname, "../bot/tenant/keyboards.ts"),
    path.resolve(__dirname, "../bot/tenant/social.ts"),
    path.resolve(__dirname, "../services/use-cases/delivery-social.ts")
  ];
  const texts = files.map((file) => fs.readFileSync(file, "utf8"));
  assert.ok(texts.some((text) => text.includes("收藏")));
  for (const text of texts) {
    assert.equal(text.includes("点赞"), false);
    assert.equal(text.includes("已赞"), false);
  }
});

test("callbacks: tag:open 回调能正确解析 tagId 与页码", () => {
  const data = "tag:open:tag_123:12";
  const match = data.match(tagOpenCallbackRe);
  assert.ok(match);
  assert.equal(match?.[1], "tag_123");
  assert.equal(match?.[2], "12");
});

test("callbacks: tags:page 回调能正确解析热门标签页码", () => {
  const data = "tags:page:3";
  const match = data.match(tagIndexPageCallbackRe);
  assert.ok(match);
  assert.equal(match?.[1], "3");
});

test("callbacks: tags:refresh 回调能正确解析热门标签刷新页码", () => {
  const data = "tags:refresh:5";
  const match = data.match(tagIndexRefreshCallbackRe);
  assert.ok(match);
  assert.equal(match?.[1], "5");
});

test("worker-heartbeat: parseHeartbeatAgoMin 能正确计算分钟", () => {
  const nowMs = 1_000_000;
  assert.equal(parseHeartbeatAgoMin(String(nowMs - 2 * 60_000), nowMs), 2);
  assert.equal(parseHeartbeatAgoMin("invalid", nowMs), null);
});

test("worker-heartbeat: buildWorkerHeartbeatLines 能区分进程与副本任务心跳", () => {
  const nowMs = 2_000_000;
  const lines = buildWorkerHeartbeatLines({
    processRaw: String(nowMs - 60_000),
    replicationRaw: null,
    nowMs
  });
  assert.equal(lines.processAgoMin, 1);
  assert.equal(lines.replicationAgoMin, null);
  assert.ok(lines.processLine.includes("1 分钟前"));
  assert.ok(lines.replicationLine.includes("暂无"));
});

test("runtime-mode: single owner mode accepts common truthy values", () => {
  const previous = process.env.SINGLE_OWNER_MODE;
  try {
    process.env.SINGLE_OWNER_MODE = "true";
    assert.equal(isSingleOwnerModeEnabled(), true);
    process.env.SINGLE_OWNER_MODE = "0";
    assert.equal(isSingleOwnerModeEnabled(), false);
  } finally {
    process.env.SINGLE_OWNER_MODE = previous;
  }
});

test("worker: computeNextBroadcastRunAt keeps cadence without drift", () => {
  const next = computeNextBroadcastRunAt({
    previousNextRunAt: new Date("2026-04-14T10:00:00.000Z"),
    repeatEveryMs: 60 * 60 * 1000,
    now: new Date("2026-04-14T12:20:00.000Z")
  });
  assert.equal(next.toISOString(), "2026-04-14T13:00:00.000Z");
});

test("orchestration: interval scheduler 不会在上一次 tick 未结束时重入", async () => {
  let activeRuns = 0;
  let maxConcurrentRuns = 0;
  let totalRuns = 0;

  const timer = startIntervalScheduler(
    5,
    async () => {
      activeRuns += 1;
      totalRuns += 1;
      maxConcurrentRuns = Math.max(maxConcurrentRuns, activeRuns);
      await new Promise((resolve) => setTimeout(resolve, 30));
      activeRuns -= 1;
    },
    (error) => {
      throw error;
    }
  );

  await new Promise((resolve) => setTimeout(resolve, 120));
  clearInterval(timer);
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(maxConcurrentRuns, 1);
  assert.ok(totalRuns >= 1);
});

test("integration: 上传流程会提交批次并返回资产ID", async () => {
  const store = createUploadBatchStore();
  store.addMessage(1, 2, { messageId: 101, chatId: 2, kind: "photo", fileId: "f1" });
  store.addMessage(1, 2, { messageId: 102, chatId: 2, kind: "video", fileId: "f2" });
  const commits: Array<{ count: number }> = [];
  const actions = createProjectBatchActions(store, {
    commitBatch: async (batch) => {
      commits.push({ count: batch.messages.length });
      return { batchId: "b1", assetId: "a1" };
    },
    updateAssetMeta: async () => ({ shareCode: "x" }),
    updateAssetCollection: async (_assetId, collectionId) => ({ collectionId })
  });
  const result = await actions.commit(1, 2);
  assert.equal(result.ok, true);
  assert.equal((result as { assetId?: string }).assetId, "a1");
  assert.equal(commits.length, 1);
  assert.equal(commits[0]?.count, 2);
  assert.equal(store.getBatch(1, 2), undefined);
});

test("upload-service: commitBatch dual-writes projectId for asset and upload batch", async () => {
  const assetCreateCalls: Array<Record<string, unknown>> = [];
  const uploadBatchCreateCalls: Array<Record<string, unknown>> = [];

  const prisma = {
    tenant: {
      findUnique: async ({ where }: { where: { code?: string } }) =>
        where.code === "demo" ? { id: "tenant_1", code: "demo", name: "Demo" } : null,
      update: async () => ({}),
      create: async () => ({ id: "tenant_1", code: "demo", name: "Demo" })
    },
    vaultGroup: {
      upsert: async () => ({ id: "vault_group_1" })
    },
    tenantVaultBinding: {
      upsert: async () => ({})
    },
    tenantTopic: {
      upsert: async () => ({})
    },
    collection: {
      findFirst: async () => null,
      findMany: async () => []
    },
    asset: {
      findUnique: async () => null
    },
    tenantSetting: {
      findUnique: async () => null
    },
    $transaction: async (runner: (tx: any) => Promise<{ assetId: string; batchId: string }>) =>
      runner({
        tenant: {
          findUnique: async ({ where }: { where: { code?: string } }) =>
            where.code === "demo" ? { id: "tenant_1", code: "demo", name: "Demo" } : null,
          update: async () => ({}),
          create: async () => ({ id: "tenant_1", code: "demo", name: "Demo" })
        },
        vaultGroup: {
          upsert: async () => ({ id: "vault_group_1" })
        },
        tenantVaultBinding: {
          findFirst: async () => ({ vaultGroupId: "vault_group_1" }),
          upsert: async () => ({})
        },
        tenantTopic: {
          upsert: async () => ({})
        },
        asset: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            assetCreateCalls.push(data);
            return { id: "asset_1" };
          }
        },
        uploadBatch: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            uploadBatchCreateCalls.push(data);
            return { id: "batch_1" };
          }
        }
      })
  } as never;

  const service = createUploadService(
    prisma,
    { add: async () => ({}) },
    null,
    { projectContext: { code: "demo", name: "Demo" }, vaultChatId: "-1001", vaultThreadId: 123 }
  );

  const result = await service.commitBatch({
    id: "upload_1",
    userId: 42,
    chatId: 7,
    createdAt: Date.now(),
    status: "pending",
    messages: [{ messageId: 101, chatId: 7, kind: "photo", fileId: "f1" }]
  });

  assert.deepEqual(result, { batchId: "batch_1", assetId: "asset_1" });
  assert.deepEqual(assetCreateCalls.at(-1), {
    tenantId: "tenant_1",
    projectId: "tenant_1",
    collectionId: undefined,
    title: "Upload upload_1",
    description: "Batch upload_1"
  });
  assert.deepEqual(uploadBatchCreateCalls.at(-1), {
    tenantId: "tenant_1",
    projectId: "tenant_1",
    assetId: "asset_1",
    userId: "42",
    chatId: "7",
    status: "COMMITTED",
    items: {
      create: [{ messageId: "101", chatId: "7", kind: "photo", mediaGroupId: undefined, fileId: "f1" }]
    }
  });
});

test("upload-service: tenant setting reads prefer projectId and fall back to tenantId", async () => {
  const tenantSettingCalls: Array<Record<string, unknown>> = [];
  const prisma = {
    tenant: {
      findUnique: async ({ where }: { where: { code?: string } }) =>
        where.code === "demo" ? { id: "tenant_1", code: "demo", name: "Demo" } : null,
      update: async () => ({}),
      create: async () => ({ id: "tenant_1", code: "demo", name: "Demo" })
    },
    vaultGroup: {
      upsert: async () => ({ id: "vault_group_1" })
    },
    tenantVaultBinding: {
      upsert: async () => ({}),
      findFirst: async () => ({ vaultGroupId: "vault_group_1" })
    },
    tenantTopic: {
      upsert: async () => ({})
    },
    collection: {
      findFirst: async () => null,
      findMany: async () => []
    },
    tenantSetting: {
      findUnique: async (args: Record<string, unknown>) => {
        tenantSettingCalls.push(args);
        if (tenantSettingCalls.length === 1) {
          return null;
        }
        if (tenantSettingCalls.length === 2) {
          return { value: "1" };
        }
        return null;
      }
    },
    asset: {
      findUnique: async () => ({
        tenantId: "tenant_1",
        collectionId: null,
        title: "Upload upload_1",
        description: "Batch upload_1"
      })
    },
    $transaction: async (runner: (tx: any) => Promise<{ assetId: string; batchId: string }>) =>
      runner({
        tenant: {
          findUnique: async ({ where }: { where: { code?: string } }) =>
            where.code === "demo" ? { id: "tenant_1", code: "demo", name: "Demo" } : null,
          update: async () => ({}),
          create: async () => ({ id: "tenant_1", code: "demo", name: "Demo" })
        },
        vaultGroup: {
          upsert: async () => ({ id: "vault_group_1" })
        },
        tenantVaultBinding: {
          findFirst: async () => ({ vaultGroupId: "vault_group_1" }),
          upsert: async () => ({})
        },
        tenantTopic: {
          upsert: async () => ({})
        },
        asset: {
          create: async () => ({ id: "asset_1" })
        },
        uploadBatch: {
          create: async () => ({ id: "batch_1" })
        }
      })
  } as never;

  const service = createUploadService(
    prisma,
    { add: async () => ({}) },
    null,
    { projectContext: { code: "demo", name: "Demo" }, vaultChatId: "-1001", vaultThreadId: 123 }
  );

  await service.commitBatch({
    id: "upload_1",
    userId: 42,
    chatId: 7,
    createdAt: Date.now(),
    status: "pending",
    messages: [{ messageId: 101, chatId: 7, kind: "photo", fileId: "f1" }]
  });

  assert.deepEqual(tenantSettingCalls.slice(0, 2), [
    {
      where: { projectId_key: { projectId: "tenant_1", key: "auto_categorize_enabled" } },
      select: { value: true }
    },
    {
      where: { tenantId_key: { tenantId: "tenant_1", key: "auto_categorize_enabled" } },
      select: { value: true }
    }
  ]);
});

test("upload-service: updateAssetCollection prefers projectId and falls back to tenantId", async () => {
  const assetFindCalls: Array<Record<string, unknown>> = [];
  const collectionFindCalls: Array<Record<string, unknown>> = [];
  const assetUpdateCalls: Array<Record<string, unknown>> = [];

  const prisma = {
    tenant: {
      findUnique: async ({ where }: { where: { code?: string } }) =>
        where.code === "demo" ? { id: "tenant_1", code: "demo", name: "Demo" } : null,
      update: async () => ({}),
      create: async () => ({ id: "tenant_1", code: "demo", name: "Demo" })
    },
    vaultGroup: {
      upsert: async () => ({ id: "vault_group_1" })
    },
    tenantVaultBinding: {
      upsert: async () => ({}),
      findFirst: async () => ({ vaultGroupId: "vault_group_1" })
    },
    tenantTopic: {
      upsert: async () => ({})
    },
    asset: {
      findFirst: async (args: Record<string, unknown>) => {
        assetFindCalls.push(args);
        return assetFindCalls.length === 1 ? null : { id: "asset_1", tenantId: "tenant_1", collectionId: null };
      },
      update: async (args: Record<string, unknown>) => {
        assetUpdateCalls.push(args);
        return {};
      }
    },
    collection: {
      findFirst: async (args: Record<string, unknown>) => {
        collectionFindCalls.push(args);
        return collectionFindCalls.length === 1 ? null : { id: "collection_1" };
      }
    },
    tenantSetting: {
      findUnique: async () => null
    },
    $transaction: async (runner: (tx: any) => Promise<{ tenantId: string; vaultGroupId: string }>) =>
      runner({
        tenant: {
          findUnique: async ({ where }: { where: { code?: string } }) =>
            where.code === "demo" ? { id: "tenant_1", code: "demo", name: "Demo" } : null,
          update: async () => ({}),
          create: async () => ({ id: "tenant_1", code: "demo", name: "Demo" })
        },
        vaultGroup: {
          upsert: async () => ({ id: "vault_group_1" })
        },
        tenantVaultBinding: {
          findFirst: async () => ({ vaultGroupId: "vault_group_1" }),
          upsert: async () => ({})
        },
        tenantTopic: {
          upsert: async () => ({})
        }
      })
  } as never;

  const service = createUploadService(
    prisma,
    { add: async () => ({}) },
    null,
    { projectContext: { code: "demo", name: "Demo" }, vaultChatId: "-1001", vaultThreadId: 123 }
  );

  const result = await service.updateAssetCollection("asset_1", "collection_1");

  assert.deepEqual(result, { collectionId: "collection_1" });
  assert.deepEqual(assetFindCalls, [
    { where: { id: "asset_1", projectId: "tenant_1" } },
    { where: { id: "asset_1", tenantId: "tenant_1" } }
  ]);
  assert.deepEqual(collectionFindCalls, [
    {
      where: { id: "collection_1", projectId: "tenant_1" },
      select: { id: true }
    },
    {
      where: { id: "collection_1", tenantId: "tenant_1" },
      select: { id: true }
    }
  ]);
  assert.deepEqual(assetUpdateCalls, [
    { where: { id: "asset_1" }, data: { collectionId: "collection_1" } }
  ]);
});

test("upload-service: updateAssetMeta prefers project collections and falls back to tenant collections", async () => {
  const collectionFindManyCalls: Array<Record<string, unknown>> = [];
  const prisma = {
    asset: {
      findUnique: async () => ({
        id: "asset_1",
        tenantId: "tenant_1",
        collectionId: null,
        title: "old title",
        description: "old desc",
        shareCode: "share_1"
      }),
      update: async () => ({})
    },
    tenantSetting: {
      findUnique: async ({ where }: { where: { projectId_key?: { projectId: string; key: string }; tenantId_key?: { tenantId: string; key: string } } }) => {
        const key = where.projectId_key?.key ?? where.tenantId_key?.key;
        if (key === "auto_categorize_enabled") {
          return where.projectId_key ? null : { value: "1" };
        }
        if (key === "auto_categorize_rules") {
          return where.projectId_key ? null : { value: JSON.stringify([{ collectionId: "collection_1", keywords: ["demo"] }]) };
        }
        return null;
      }
    },
    collection: {
      findMany: async (args: Record<string, unknown>) => {
        collectionFindManyCalls.push(args);
        return collectionFindManyCalls.length === 1 ? [] : [{ id: "collection_1", title: "Demo Collection" }];
      }
    },
    tag: {
      upsert: async () => ({ id: "tag_1" })
    },
    assetTag: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 })
    },
    $transaction: async (runner: (tx: any) => Promise<void>) =>
      runner({
        assetTag: {
          deleteMany: async () => ({ count: 0 }),
          createMany: async () => ({ count: 0 })
        },
        tag: {
          upsert: async () => ({ id: "tag_1" })
        }
      })
  } as never;

  const service = createUploadService(
    prisma,
    { add: async () => ({}) },
    null,
    { projectContext: { code: "demo", name: "Demo" }, vaultChatId: "-1001", vaultThreadId: 123 }
  );

  await service.updateAssetMeta("asset_1", { title: "demo title", description: "demo desc" });

  assert.deepEqual(collectionFindManyCalls, [
    {
      where: { projectId: "tenant_1" },
      select: { id: true, title: true }
    },
    {
      where: { tenantId: "tenant_1" },
      select: { id: true, title: true }
    }
  ]);
});

test("upload-service: updateAssetMeta uses project collections immediately when available", async () => {
  const collectionFindManyCalls: Array<Record<string, unknown>> = [];
  const prisma = {
    asset: {
      findUnique: async () => ({
        id: "asset_1",
        tenantId: "tenant_1",
        collectionId: null,
        title: "old title",
        description: "old desc",
        shareCode: "share_1"
      }),
      update: async () => ({})
    },
    tenantSetting: {
      findUnique: async ({ where }: { where: { projectId_key?: { projectId: string; key: string }; tenantId_key?: { tenantId: string; key: string } } }) => {
        const key = where.projectId_key?.key ?? where.tenantId_key?.key;
        if (key === "auto_categorize_enabled") {
          return { value: "1" };
        }
        if (key === "auto_categorize_rules") {
          return { value: JSON.stringify([{ collectionId: "collection_1", keywords: ["demo"] }]) };
        }
        return null;
      }
    },
    collection: {
      findMany: async (args: Record<string, unknown>) => {
        collectionFindManyCalls.push(args);
        return [{ id: "collection_1", title: "Demo Collection" }];
      }
    },
    tag: {
      upsert: async () => ({ id: "tag_1" })
    },
    assetTag: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 })
    },
    $transaction: async (runner: (tx: any) => Promise<void>) =>
      runner({
        assetTag: {
          deleteMany: async () => ({ count: 0 }),
          createMany: async () => ({ count: 0 })
        },
        tag: {
          upsert: async () => ({ id: "tag_1" })
        }
      })
  } as never;

  const service = createUploadService(
    prisma,
    { add: async () => ({}) },
    null,
    { projectContext: { code: "demo", name: "Demo" }, vaultChatId: "-1001", vaultThreadId: 123 }
  );

  await service.updateAssetMeta("asset_1", { title: "demo title", description: "demo desc" });

  assert.deepEqual(collectionFindManyCalls, [
    {
      where: { projectId: "tenant_1" },
      select: { id: true, title: true }
    }
  ]);
});

test("integration: 副本路由会把任务转发给编排层", async () => {
  const calls: string[] = [];
  const routes = createWorkerRoutes({
    replicateRequired: async (batchId: string) => {
      calls.push(`replicate_required:${batchId}`);
    },
    replicateBackfill: async (batchId: string) => {
      calls.push(`replicate_backfill:${batchId}`);
    },
    runBroadcast: async (broadcastId, runId) => {
      calls.push(`broadcast:${broadcastId}:${runId}`);
    },
    runFollowKeywordNotify: async (assetId) => {
      calls.push(`notify:${assetId}`);
    }
  });
  await routes.replicationRoute({ data: { batchId: "batch-1" } });
  await routes.replicationRoute({ name: "replicate_backfill", data: { batchId: "batch-2" } });
  await routes.broadcastRoute({ data: { broadcastId: "b1", runId: "r1" } });
  await routes.notifyRoute({ name: "follow_keyword", data: { assetId: "a1" } });
  assert.deepEqual(calls, [
    "replicate_required:batch-1",
    "replicate_backfill:batch-2",
    "broadcast:b1:r1",
    "notify:a1"
  ]);
});

test("delivery-admin: can list and fetch multiple broadcasts by id", async () => {
  const rows = [
    {
      id: "b_new",
      tenantId: "tenant_1",
      creatorUserId: "u1",
      status: "DRAFT" as const,
      contentHtml: "draft",
      mediaKind: null,
      mediaFileId: null,
      buttons: [],
      nextRunAt: null,
      repeatEveryMs: null,
      createdAt: new Date("2026-04-14T10:00:00.000Z"),
      updatedAt: new Date("2026-04-14T12:00:00.000Z")
    },
    {
      id: "b_old",
      tenantId: "tenant_1",
      creatorUserId: "u1",
      status: "SCHEDULED" as const,
      contentHtml: "scheduled",
      mediaKind: "photo",
      mediaFileId: "file_1",
      buttons: [{ text: "打开", url: "https://example.com" }],
      nextRunAt: new Date("2026-04-15T10:00:00.000Z"),
      repeatEveryMs: 3_600_000,
      createdAt: new Date("2026-04-13T10:00:00.000Z"),
      updatedAt: new Date("2026-04-13T12:00:00.000Z")
    }
  ];
  const findManyCalls: Array<Record<string, unknown>> = [];
  const findFirstCalls: Array<Record<string, unknown>> = [];

  const admin = createDeliveryAdmin({
    prisma: {
      broadcast: {
        findMany: async (args: Record<string, unknown>) => {
          findManyCalls.push(args);
          return findManyCalls.length === 1 ? [] : rows;
        },
        findFirst: async ({ where }: { where: { id: string; projectId?: string; tenantId?: string } }) => {
          findFirstCalls.push({ where });
          if ("projectId" in where) {
            return null;
          }
          return rows.find((row) => row.id === where.id) ?? null;
        }
      }
    } as never,
    settingKeys: {
      startWelcomeHtml: "a",
      deliveryAdConfig: "b",
      protectContentEnabled: "c",
      hidePublisherEnabled: "d",
      publicRankingEnabled: "e",
      autoCategorizeEnabled: "f",
      autoCategorizeRules: "g"
    },
    getRuntimeProjectId: async () => "tenant_1",
    canManageProject: async () => true,
    getSetting: async () => null,
    upsertSetting: async () => undefined,
    deleteSetting: async () => undefined
  });

  const list = await admin.listMyBroadcasts("u1", 10);
  assert.deepEqual(list.map((item) => item.id), ["b_new", "b_old"]);
  const selected = await admin.getBroadcastById("u1", "b_old");
  assert.equal(selected?.id, "b_old");
  assert.equal(selected?.buttons.length, 1);
  assert.deepEqual(findManyCalls, [
    {
      where: { projectId: "tenant_1", creatorUserId: "u1" },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 10
    },
    {
      where: { tenantId: "tenant_1", creatorUserId: "u1" },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 10
    }
  ]);
  assert.deepEqual(findFirstCalls, [
    { where: { id: "b_old", projectId: "tenant_1", creatorUserId: "u1" } },
    { where: { id: "b_old", tenantId: "tenant_1", creatorUserId: "u1" } }
  ]);
});

test("tenant-vault: single owner mode hides extra admins", async () => {
  const previous = process.env.SINGLE_OWNER_MODE;
  process.env.SINGLE_OWNER_MODE = "1";
  try {
    const tenantVault = createDeliveryTenantVault({
      prisma: {
        tenantMember: {
          findMany: async () => [
            { tgUserId: "owner_1", role: "OWNER", createdAt: new Date("2026-04-14T10:00:00.000Z") },
            { tgUserId: "admin_1", role: "ADMIN", createdAt: new Date("2026-04-14T11:00:00.000Z") }
          ]
        }
      } as never,
      getRuntimeProjectId: async () => "tenant_1",
      canManageProject: async () => true,
      ensureInitialOwner: async () => false
    });

    const projectManagers = await tenantVault.listProjectManagers();
    assert.deepEqual(projectManagers, [{ tgUserId: "owner_1", role: "OWNER" }]);
  } finally {
    process.env.SINGLE_OWNER_MODE = previous;
  }
});

test("tenant-vault: project manager aliases reuse tenant admin writes", async () => {
  const upsertCalls: Array<{ tenantId: string; tgUserId: string; role: string }> = [];
  const deleteCalls: Array<{ tenantId: string; tgUserId: string }> = [];
  const tenantVault = createDeliveryTenantVault({
    prisma: {
      tenantMember: {
        findUnique: async ({ where }: { where: { tenantId_tgUserId: { tenantId: string; tgUserId: string } } }) => {
          if (where.tenantId_tgUserId.tgUserId === "owner_1") {
            return { role: "OWNER" };
          }
          if (where.tenantId_tgUserId.tgUserId === "admin_1") {
            return { role: "ADMIN" };
          }
          return null;
        },
        upsert: async ({
          create
        }: {
          create: { tenantId: string; tgUserId: string; role: string };
        }) => {
          upsertCalls.push(create);
          return {};
        },
        delete: async ({ where }: { where: { tenantId_tgUserId: { tenantId: string; tgUserId: string } } }) => {
          deleteCalls.push(where.tenantId_tgUserId);
          return {};
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    canManageProject: async () => true,
    ensureInitialOwner: async () => false
  });

  const addResult = await tenantVault.addProjectManager("owner_1", "admin_2");
  assert.equal(addResult.ok, true);
  assert.deepEqual(upsertCalls.at(-1), { tenantId: "tenant_1", tgUserId: "admin_2", role: "ADMIN" });

  const removeResult = await tenantVault.removeProjectManager("owner_1", "admin_1");
  assert.equal(removeResult.ok, true);
  assert.deepEqual(deleteCalls.at(-1), { tenantId: "tenant_1", tgUserId: "admin_1" });
});

test("tenant-vault: collection listing uses project-oriented runtime deps", async () => {
  let runtimeProjectCalls = 0;
  const tenantVault = createDeliveryTenantVault({
    prisma: {
      collection: {
        findMany: async () => [{ id: "c1", title: "Collection 1" }]
      }
    } as never,
    getRuntimeProjectId: async () => {
      runtimeProjectCalls += 1;
      return "tenant_1";
    },
    canManageProject: async () => true,
    ensureInitialOwner: async () => false
  });

  const result = await tenantVault.listCollections();
  assert.deepEqual(result, [{ id: "c1", title: "Collection 1" }]);
  assert.equal(runtimeProjectCalls, 1);
});

test("tenant-vault: listCollections prefers projectId and falls back to tenantId", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const tenantVault = createDeliveryTenantVault({
    prisma: {
      collection: {
        findMany: async (args: Record<string, unknown>) => {
          calls.push(args);
          const where = (args as any).where ?? {};
          return where.projectId ? [] : [{ id: "c1", title: "Collection 1" }];
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    canManageProject: async () => true,
    ensureInitialOwner: async () => false
  });

  const result = await tenantVault.listCollections();
  assert.deepEqual(result, [{ id: "c1", title: "Collection 1" }]);
  assert.ok(calls.some((c) => (c as any).where?.projectId === "tenant_1"));
  assert.ok(calls.some((c) => (c as any).where?.tenantId === "tenant_1"));
});

test("tenant-vault: createCollection dual-writes projectId", async () => {
  const createCalls: Array<Record<string, unknown>> = [];
  const tenantVault = createDeliveryTenantVault({
    prisma: {
      collection: {
        create: async (args: Record<string, unknown>) => {
          createCalls.push(args);
          return { id: "c1" };
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    canManageProject: async () => true,
    ensureInitialOwner: async () => false
  });

  const result = await tenantVault.createCollection("owner_1", " Collection 1 ");
  assert.equal(result.ok, true);
  assert.deepEqual(createCalls[0], {
    data: { tenantId: "tenant_1", projectId: "tenant_1", title: "Collection 1" }
  });
});

test("tenant-guard: ensureRuntimeProject is the primary runtime bootstrap helper", async () => {
  const result = await ensureRuntimeProject(
    {
      tenant: {
        findUnique: async () => ({ id: "tenant_1", code: "demo-project", name: "Demo Project" }),
        update: async () => ({})
      }
    } as never,
    { projectCode: "demo-project", projectName: "Demo Project" }
  );

  assert.deepEqual(result, {
    id: "tenant_1",
    code: "demo-project",
    name: "Demo Project"
  });
});

test("tenant-vault: updateCollection prefers projectId and falls back to tenantId", async () => {
  const findCalls: Array<Record<string, unknown>> = [];
  const updateCalls: Array<Record<string, unknown>> = [];
  const tenantVault = createDeliveryTenantVault({
    prisma: {
      collection: {
        findFirst: async (args: Record<string, unknown>) => {
          findCalls.push(args);
          const where = (args as any).where ?? {};
          return where.projectId ? null : { id: "c1", title: "Old" };
        },
        update: async (args: Record<string, unknown>) => {
          updateCalls.push(args);
          return {};
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    canManageProject: async () => true,
    ensureInitialOwner: async () => false
  });

  const result = await tenantVault.updateCollection("owner_1", "c1", "New");
  assert.equal(result.ok, true);
  assert.ok(findCalls.some((c) => (c as any).where?.projectId === "tenant_1"));
  assert.ok(findCalls.some((c) => (c as any).where?.tenantId === "tenant_1"));
  assert.deepEqual(updateCalls[0], { where: { id: "c1" }, data: { title: "New" } });
});

test("tenant-vault: deleteCollection prefers projectId and falls back to tenantId", async () => {
  const findCalls: Array<Record<string, unknown>> = [];
  const deleteCalls: Array<Record<string, unknown>> = [];
  const tenantVault = createDeliveryTenantVault({
    prisma: {
      collection: {
        findFirst: async (args: Record<string, unknown>) => {
          findCalls.push(args);
          const where = (args as any).where ?? {};
          return where.projectId ? null : { id: "c1", title: "Collection 1" };
        },
        delete: async (args: Record<string, unknown>) => {
          deleteCalls.push(args);
          return {};
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    canManageProject: async () => true,
    ensureInitialOwner: async () => false
  });

  const result = await tenantVault.deleteCollection("owner_1", "c1");
  assert.equal(result.ok, true);
  assert.ok(findCalls.some((c) => (c as any).where?.projectId === "tenant_1"));
  assert.ok(findCalls.some((c) => (c as any).where?.tenantId === "tenant_1"));
  assert.deepEqual(deleteCalls[0], { where: { id: "c1" } });
});

test("tenant-vault: project member alias matches tenant user alias", async () => {
  const tenantVault = createDeliveryTenantVault({
    prisma: {
      tenantMember: {
        findFirst: async () => ({ id: "member_1" })
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    canManageProject: async () => true,
    ensureInitialOwner: async () => false
  });

  assert.equal(await tenantVault.isProjectMember("user_1"), true);
});

test("delivery-admin: exposes project settings surface", async () => {
  const upsertCalls: Array<{ key: string; value: string | null }> = [];
  const deleteCalls: string[] = [];
  const admin = createDeliveryAdmin({
    prisma: {} as never,
    settingKeys: {
      startWelcomeHtml: "welcome",
      deliveryAdConfig: "ad",
      protectContentEnabled: "protect",
      hidePublisherEnabled: "hide",
      publicRankingEnabled: "ranking",
      autoCategorizeEnabled: "auto",
      autoCategorizeRules: "rules"
    },
    getRuntimeProjectId: async () => "tenant_1",
    canManageProject: async () => true,
    getSetting: async (key) => (key === "welcome" ? "<b>hello</b>" : null),
    upsertSetting: async (key, value) => {
      upsertCalls.push({ key, value });
    },
    deleteSetting: async (key) => {
      deleteCalls.push(key);
    }
  });

  assert.equal(await admin.getProjectStartWelcomeHtml(), "<b>hello</b>");

  const enableResult = await admin.setProjectPublicRankingEnabled("owner_1", true);
  assert.equal(enableResult.ok, true);
  assert.deepEqual(upsertCalls.at(-1), { key: "ranking", value: "1" });

  const disableResult = await admin.setProjectPublicRankingEnabled("owner_1", false);
  assert.equal(disableResult.ok, true);
  assert.equal(deleteCalls.at(-1), "ranking");
});

test("delivery-admin: create draft uses project-oriented runtime deps", async () => {
  let runtimeProjectCalls = 0;
  const createCalls: Array<{
    tenantId: string;
    projectId: string;
    creatorUserId: string;
    creatorChatId: string;
    status: string;
    contentHtml: string;
  }> = [];
  const admin = createDeliveryAdmin({
    prisma: {
      broadcast: {
        create: async ({
          data
        }: {
          data: {
            tenantId: string;
            projectId: string;
            creatorUserId: string;
            creatorChatId: string;
            status: string;
            contentHtml: string;
          };
        }) => {
          createCalls.push(data);
          return { id: `draft:${data.tenantId}` };
        }
      }
    } as never,
    settingKeys: {
      startWelcomeHtml: "welcome",
      deliveryAdConfig: "ad",
      protectContentEnabled: "protect",
      hidePublisherEnabled: "hide",
      publicRankingEnabled: "ranking",
      autoCategorizeEnabled: "auto",
      autoCategorizeRules: "rules"
    },
    getRuntimeProjectId: async () => {
      runtimeProjectCalls += 1;
      return "tenant_1";
    },
    canManageProject: async () => true,
    getSetting: async () => null,
    upsertSetting: async () => undefined,
    deleteSetting: async () => undefined
  });

  const result = await admin.createBroadcastDraft("owner_1", "chat_1");
  assert.equal(result.ok, true);
  assert.equal(result.id, "draft:tenant_1");
  assert.equal(runtimeProjectCalls, 1);
  assert.deepEqual(createCalls.at(-1), {
    tenantId: "tenant_1",
    projectId: "tenant_1",
    creatorUserId: "owner_1",
    creatorChatId: "chat_1",
    status: "DRAFT",
    contentHtml: ""
  });
});

test("delivery-admin: broadcast target count prefers projectId and falls back to tenantId", async () => {
  const eventWheres: Array<Record<string, unknown>> = [];
  const userWheres: Array<Record<string, unknown>> = [];
  const admin = createDeliveryAdmin({
    prisma: {
      event: {
        groupBy: async ({ where }: { where: Record<string, unknown> }) => {
          eventWheres.push(where);
          return Object.prototype.hasOwnProperty.call(where, "projectId") ? [] : [{ userId: "viewer_1" }];
        }
      },
      tenantUser: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          userWheres.push(where);
          return Object.prototype.hasOwnProperty.call(where, "projectId") ? [] : [{ tgUserId: "viewer_2" }];
        }
      },
      tenantMember: {
        findMany: async () => [{ tgUserId: "owner_1" }]
      }
    } as never,
    settingKeys: {
      startWelcomeHtml: "welcome",
      deliveryAdConfig: "ad",
      protectContentEnabled: "protect",
      hidePublisherEnabled: "hide",
      publicRankingEnabled: "ranking",
      autoCategorizeEnabled: "auto",
      autoCategorizeRules: "rules"
    },
    getRuntimeProjectId: async () => "tenant_1",
    canManageProject: async () => true,
    getSetting: async () => null,
    upsertSetting: async () => undefined,
    deleteSetting: async () => undefined
  });

  assert.equal(await admin.getBroadcastTargetCount("owner_1"), 2);
  assert.deepEqual(eventWheres, [{ projectId: "tenant_1" }, { tenantId: "tenant_1" }]);
  assert.deepEqual(userWheres, [{ projectId: "tenant_1" }, { tenantId: "tenant_1" }]);
});

test("delivery-admin: mutating broadcast actions fall back from projectId to tenantId", async () => {
  const findFirstCalls: Array<Record<string, unknown>> = [];
  const updateCalls: Array<Record<string, unknown>> = [];
  const deleteCalls: Array<Record<string, unknown>> = [];
  const runQueries: Array<Record<string, unknown>> = [];

  const admin = createDeliveryAdmin({
    prisma: {
      broadcast: {
        findFirst: async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
          findFirstCalls.push({ where, select });
          if (Object.prototype.hasOwnProperty.call(where, "projectId")) {
            return null;
          }
          const status = (where as { status?: string | { in: string[] } }).status;
          const normalizedStatus =
            typeof status === "string" ? status : Array.isArray((status as { in?: string[] } | undefined)?.in) ? (status as { in: string[] }).in[0] : "DRAFT";
          const base = {
            id: "draft_1",
            tenantId: "tenant_1",
            creatorUserId: "owner_1",
            status: normalizedStatus as "DRAFT" | "SCHEDULED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED",
            contentHtml: "hello",
            mediaKind: null,
            mediaFileId: null,
            buttons: [],
            nextRunAt: null,
            repeatEveryMs: null,
            createdAt: new Date("2026-04-14T10:00:00.000Z"),
            updatedAt: new Date("2026-04-14T12:00:00.000Z")
          };
          if (select) {
            return { id: base.id };
          }
          return base;
        },
        update: async (args: Record<string, unknown>) => {
          updateCalls.push(args);
          return {};
        },
        delete: async (args: Record<string, unknown>) => {
          deleteCalls.push(args);
          return {};
        }
      },
      broadcastRun: {
        findMany: async (args: Record<string, unknown>) => {
          runQueries.push(args);
          return [];
        }
      }
    } as never,
    settingKeys: {
      startWelcomeHtml: "welcome",
      deliveryAdConfig: "ad",
      protectContentEnabled: "protect",
      hidePublisherEnabled: "hide",
      publicRankingEnabled: "ranking",
      autoCategorizeEnabled: "auto",
      autoCategorizeRules: "rules"
    },
    getRuntimeProjectId: async () => "tenant_1",
    canManageProject: async () => true,
    getSetting: async () => null,
    upsertSetting: async () => undefined,
    deleteSetting: async () => undefined
  });

  const contentResult = await admin.updateBroadcastDraftContent("owner_1", "draft_1", {
    contentHtml: "updated",
    mediaKind: null,
    mediaFileId: null
  });
  assert.equal(contentResult.ok, true);

  const buttonResult = await admin.updateBroadcastDraftButtons("owner_1", "draft_1", [{ text: "Open", url: "https://example.com" }]);
  assert.equal(buttonResult.ok, true);

  const scheduleResult = await admin.scheduleBroadcast("owner_1", "draft_1", {
    nextRunAt: new Date("2026-04-15T10:00:00.000Z")
  });
  assert.equal(scheduleResult.ok, true);

  const cancelResult = await admin.cancelBroadcast("owner_1", "draft_1");
  assert.equal(cancelResult.ok, true);

  const deleteResult = await admin.deleteBroadcastDraft("owner_1", "draft_1");
  assert.equal(deleteResult.ok, true);

  const runs = await admin.listBroadcastRuns("owner_1", "draft_1", 5);
  assert.deepEqual(runs, []);

  assert.deepEqual(
    findFirstCalls.map((call) => call.where),
    [
      { id: "draft_1", creatorUserId: "owner_1", status: "DRAFT", projectId: "tenant_1" },
      { id: "draft_1", creatorUserId: "owner_1", status: "DRAFT", tenantId: "tenant_1" },
      { id: "draft_1", creatorUserId: "owner_1", status: "DRAFT", projectId: "tenant_1" },
      { id: "draft_1", creatorUserId: "owner_1", status: "DRAFT", tenantId: "tenant_1" },
      { id: "draft_1", creatorUserId: "owner_1", status: "DRAFT", projectId: "tenant_1" },
      { id: "draft_1", creatorUserId: "owner_1", status: "DRAFT", tenantId: "tenant_1" },
      { id: "draft_1", creatorUserId: "owner_1", status: { in: ["SCHEDULED", "RUNNING"] }, projectId: "tenant_1" },
      { id: "draft_1", creatorUserId: "owner_1", status: { in: ["SCHEDULED", "RUNNING"] }, tenantId: "tenant_1" },
      { id: "draft_1", creatorUserId: "owner_1", status: "DRAFT", projectId: "tenant_1" },
      { id: "draft_1", creatorUserId: "owner_1", status: "DRAFT", tenantId: "tenant_1" },
      { id: "draft_1", creatorUserId: "owner_1", projectId: "tenant_1" },
      { id: "draft_1", creatorUserId: "owner_1", tenantId: "tenant_1" }
    ]
  );
  assert.deepEqual(updateCalls, [
    {
      where: { id: "draft_1" },
      data: { contentHtml: "updated", mediaKind: null, mediaFileId: null }
    },
    {
      where: { id: "draft_1" },
      data: { buttons: [{ text: "Open", url: "https://example.com" }] }
    },
    {
      where: { id: "draft_1" },
      data: { status: "SCHEDULED", nextRunAt: new Date("2026-04-15T10:00:00.000Z"), repeatEveryMs: null }
    },
    {
      where: { id: "draft_1" },
      data: { status: "CANCELED", nextRunAt: null, repeatEveryMs: null }
    }
  ]);
  assert.deepEqual(deleteCalls, [{ where: { id: "draft_1" } }]);
  assert.deepEqual(runQueries, [
    {
      where: { broadcastId: "draft_1" },
      orderBy: { startedAt: "desc" },
      take: 5,
      select: {
        id: true,
        targetCount: true,
        successCount: true,
        failedCount: true,
        blockedCount: true,
        startedAt: true,
        finishedAt: true
      }
    }
  ]);
});

test("identity-service: exposes project-oriented aliases", async () => {
  const identity = buildIdentityService({
    selectReplicas: async () => ({ status: "missing", message: "x" }),
    resolveShareCode: async () => null,
    upsertProjectUserFromTelegram: async () => undefined,
    upsertTenantUserFromTelegram: async () => undefined,
    getProjectUserLabel: async () => "@project-user",
    getUserProfileSummary: async () => ({
      displayName: null,
      activatedAt: null,
      lastSeenAt: null,
      activeDays: 0,
      visitCount: 0,
      openCount: 0,
      openedShares: 0
    }),
    trackOpen: async () => undefined,
    trackVisit: async () => undefined,
    isProjectMember: async () => true,
    canManageProject: async () => true
  });

  assert.equal(await identity.isProjectMember("u1"), true);
  assert.equal(await identity.canManageProject("u1"), true);
  assert.equal(await identity.canManageProjectAdmins("u1"), true);
  assert.equal(await identity.canManageProjectCollections("u1"), true);
  assert.equal(await identity.getProjectUserLabel("u1"), "@project-user");
  await assert.doesNotReject(() => identity.upsertProjectUserFromTelegram({ id: 1 }));
});

test("identity-service: user profile summary prefers projectId and falls back to tenantId", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const getUserProfileSummary = createGetUserProfileSummary({
    prisma: {
      tenantUser: {
        findUnique: async (args: Record<string, unknown>) => {
          calls.push({ kind: "tenantUser", ...args });
          const where = (args as any).where ?? {};
          if (where.projectId_tgUserId) {
            return null;
          }
          return {
            username: "demo_user",
            firstName: "Demo",
            lastName: "User",
            createdAt: new Date("2026-04-20T00:00:00.000Z"),
            lastSeenAt: new Date("2026-04-22T00:00:00.000Z")
          };
        }
      },
      event: {
        count: async (args: Record<string, unknown>) => {
          calls.push({ kind: "eventCount", ...args });
          const where = (args as any).where ?? {};
          return where.projectId ? 0 : where.type === "IMPRESSION" ? 3 : 2;
        },
        findMany: async (args: Record<string, unknown>) => {
          calls.push({ kind: "eventFindMany", ...args });
          const where = (args as any).where ?? {};
          return where.projectId ? [] : [{ assetId: "asset_1" }, { assetId: "asset_2" }];
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1"
  });

  const summary = await getUserProfileSummary("user_1");
  assert.equal(summary.displayName, "@demo_user");
  assert.equal(summary.visitCount, 3);
  assert.equal(summary.openCount, 2);
  assert.equal(summary.openedShares, 2);
  assert.ok(calls.some((c) => (c as any).kind === "tenantUser" && (c as any).where?.projectId_tgUserId?.projectId === "tenant_1"));
  assert.ok(calls.some((c) => (c as any).kind === "tenantUser" && (c as any).where?.tenantId_tgUserId?.tenantId === "tenant_1"));
});

test("tenant-vault: upsertProjectUserFromTelegram dual-writes projectId", async () => {
  const upsertCalls: Array<{
    where: { tenantId_tgUserId: { tenantId: string; tgUserId: string } };
    update: {
      projectId: string;
      username: string | null;
      firstName: string | null;
      lastName: string | null;
      languageCode: string | null;
      isBot: boolean;
      lastSeenAt: Date;
    };
    create: {
      tenantId: string;
      projectId: string;
      tgUserId: string;
      username: string | null;
      firstName: string | null;
      lastName: string | null;
      languageCode: string | null;
      isBot: boolean;
      lastSeenAt: Date;
    };
  }> = [];

  const tenantVault = createDeliveryTenantVault({
    prisma: {
      tenantUser: {
        upsert: async (args: {
          where: { tenantId_tgUserId: { tenantId: string; tgUserId: string } };
          update: {
            projectId: string;
            username: string | null;
            firstName: string | null;
            lastName: string | null;
            languageCode: string | null;
            isBot: boolean;
            lastSeenAt: Date;
          };
          create: {
            tenantId: string;
            projectId: string;
            tgUserId: string;
            username: string | null;
            firstName: string | null;
            lastName: string | null;
            languageCode: string | null;
            isBot: boolean;
            lastSeenAt: Date;
          };
        }) => {
          upsertCalls.push(args);
          return {};
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    canManageProject: async () => true,
    ensureInitialOwner: async () => false
  });

  await tenantVault.upsertProjectUserFromTelegram({
    id: 42,
    username: "@demo_user",
    first_name: "Demo",
    last_name: "User",
    language_code: "zh-hans",
    is_bot: false
  });

  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(upsertCalls[0].where, { tenantId_tgUserId: { tenantId: "tenant_1", tgUserId: "42" } });
  assert.equal(upsertCalls[0].update.projectId, "tenant_1");
  assert.equal(upsertCalls[0].create.tenantId, "tenant_1");
  assert.equal(upsertCalls[0].create.projectId, "tenant_1");
  assert.equal(upsertCalls[0].create.tgUserId, "42");
  assert.equal(upsertCalls[0].create.username, "demo_user");
});

test("tenant-vault: getProjectUserLabel prefers projectId and falls back to tenantId", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const tenantVault = createDeliveryTenantVault({
    prisma: {
      tenantUser: {
        findUnique: async (args: Record<string, unknown>) => {
          calls.push(args);
          return calls.length === 1 ? null : { username: "fallback_user", firstName: "Fallback", lastName: "User" };
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    canManageProject: async () => true,
    ensureInitialOwner: async () => false
  });

  const label = await tenantVault.getProjectUserLabel("user_1");

  assert.equal(label, "@fallback_user");
  assert.deepEqual(calls, [
    {
      where: { projectId_tgUserId: { projectId: "tenant_1", tgUserId: "user_1" } },
      select: { username: true, firstName: true, lastName: true }
    },
    {
      where: { tenantId_tgUserId: { tenantId: "tenant_1", tgUserId: "user_1" } },
      select: { username: true, firstName: true, lastName: true }
    }
  ]);
});

test("tenant-vault: single owner mode blocks backup vault changes", async () => {
  const previous = process.env.SINGLE_OWNER_MODE;
  process.env.SINGLE_OWNER_MODE = "1";
  try {
    const tenantVault = createDeliveryTenantVault({
      prisma: {} as never,
      getRuntimeProjectId: async () => "tenant_1",
      canManageProject: async () => true,
      ensureInitialOwner: async () => false
    });

    const result = await tenantVault.addBackupVaultGroup("owner_1", "-100123456");
    assert.equal(result.ok, false);
    assert.ok(result.message.includes("单人项目模式"));
  } finally {
    process.env.SINGLE_OWNER_MODE = previous;
  }
});

test("delivery-core: single owner mode forces min replicas to 1", async () => {
  const previous = process.env.SINGLE_OWNER_MODE;
  process.env.SINGLE_OWNER_MODE = "1";
  try {
    const core = createDeliveryCore({
      prisma: {
        tenant: {
          upsert: async () => ({ id: "tenant_1" })
        }
      } as never,
      config: { code: "demo", name: "demo" }
    });

    const result = await core.getProjectMinReplicas();
    assert.equal(result, 1);
  } finally {
    process.env.SINGLE_OWNER_MODE = previous;
  }
});

test("delivery-core: exposes project-first search mode and min replica aliases", async () => {
  const createManyCalls: Array<Array<{ tenantId: string; projectId: string; key: string; value: string }>> = [];
  const findUniqueCalls: Array<Record<string, unknown>> = [];
  const upsertCalls: Array<{
    where: { tenantId_key: { tenantId: string; key: string } };
    update: { projectId: string; value: string };
    create: { tenantId: string; projectId: string; key: string; value: string };
  }> = [];
  const core = createDeliveryCore({
    prisma: {
      tenant: {
        findUnique: async ({ where }: { where: { code?: string; id?: string } }) => {
          if (where.code === "demo") {
            return { id: "tenant_1", code: "demo", name: "Demo" };
          }
          if (where.id === "tenant_1") {
            return { searchMode: "PUBLIC" };
          }
          return null;
        },
        update: async () => ({})
      },
      tenantMember: {
        findFirst: async () => ({ role: "OWNER" })
      },
      tenantSetting: {
        findMany: async ({ where }: { where: { tenantId: string; key: { in: string[] } } }) => {
          if (where.key.in.includes("min_replicas")) {
            return [{ key: "min_replicas" }];
          }
          return [];
        },
        createMany: async ({ data }: { data: Array<{ tenantId: string; projectId: string; key: string; value: string }> }) => {
          createManyCalls.push(data);
          return { count: data.length };
        },
        findUnique: async (args: Record<string, unknown>) => {
          findUniqueCalls.push(args);
          return { value: "3" };
        },
        upsert: async (args: {
          where: { tenantId_key: { tenantId: string; key: string } };
          update: { projectId: string; value: string };
          create: { tenantId: string; projectId: string; key: string; value: string };
        }) => {
          upsertCalls.push(args);
          return {};
        }
      }
    } as never,
    config: { code: "demo", name: "Demo" }
  });

  assert.equal(await core.getProjectSearchMode(), "PUBLIC");
  assert.equal(await core.getProjectMinReplicas(), 3);
  assert.deepEqual(findUniqueCalls, [
    {
      where: { projectId_key: { projectId: "tenant_1", key: "min_replicas" } },
      select: { value: true }
    }
  ]);

  const result = await core.setProjectMinReplicas("owner_1", 4);
  assert.equal(result.ok, true);
  assert.equal(createManyCalls.length, 0);
  assert.deepEqual(upsertCalls.at(-1), {
    where: { tenantId_key: { tenantId: "tenant_1", key: "min_replicas" } },
    update: { projectId: "tenant_1", value: "3" },
    create: { tenantId: "tenant_1", projectId: "tenant_1", key: "min_replicas", value: "3" }
  });
});

test("delivery-core: getProjectMinReplicas falls back from projectId to tenantId", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const core = createDeliveryCore({
    prisma: {
      tenant: {
        findUnique: async ({ where }: { where: { code?: string; id?: string } }) => {
          if (where.code === "demo") {
            return { id: "tenant_1", code: "demo", name: "Demo" };
          }
          if (where.id === "tenant_1") {
            return { searchMode: "PUBLIC" };
          }
          return null;
        },
        update: async () => ({})
      },
      tenantSetting: {
        findMany: async () => [],
        findUnique: async (args: Record<string, unknown>) => {
          calls.push(args);
          return calls.length === 1 ? null : { value: "2" };
        }
      }
    } as never,
    config: { code: "demo", name: "Demo" }
  });

  assert.equal(await core.getProjectMinReplicas(), 2);
  assert.deepEqual(calls, [
    {
      where: { projectId_key: { projectId: "tenant_1", key: "min_replicas" } },
      select: { value: true }
    },
    {
      where: { tenantId_key: { tenantId: "tenant_1", key: "min_replicas" } },
      select: { value: true }
    }
  ]);
});

test("delivery-core: bootstrap settings and tracking dual-write projectId", async () => {
  const createManyCalls: Array<Array<{ tenantId: string; projectId: string; key: string; value: string }>> = [];
  const eventCalls: Array<{
    tenantId: string;
    projectId: string;
    userId: string;
    assetId?: string;
    type: string;
    payload?: Record<string, unknown>;
  }> = [];

  const core = createDeliveryCore({
    prisma: {
      tenant: {
        findUnique: async ({ where }: { where: { code?: string; id?: string } }) => {
          if (where.code === "demo") {
            return { id: "tenant_1", code: "demo", name: "Demo" };
          }
          if (where.id === "tenant_1") {
            return { searchMode: "PUBLIC" };
          }
          return null;
        },
        update: async () => ({})
      },
      tenantSetting: {
        findMany: async () => [],
        createMany: async ({ data }: { data: Array<{ tenantId: string; projectId: string; key: string; value: string }> }) => {
          createManyCalls.push(data);
          return { count: data.length };
        }
      },
      event: {
        create: async ({ data }: { data: { tenantId: string; projectId: string; userId: string; assetId?: string; type: string; payload?: Record<string, unknown> } }) => {
          eventCalls.push(data);
          return {};
        }
      }
    } as never,
    config: { code: "demo", name: "Demo" }
  });

  process.env.TENANT_BOOTSTRAP_PROTECT_CONTENT_ENABLED = "1";
  try {
    assert.equal(await core.getRuntimeProjectId(), "tenant_1");
    assert.deepEqual(createManyCalls.at(-1), [
      {
        tenantId: "tenant_1",
        projectId: "tenant_1",
        key: "protect_content_enabled",
        value: "1"
      }
    ]);

    await core.trackOpen("tenant_1", "user_1", "asset_1");
    await core.trackVisit("user_1", "home", { ref: "feed" });

    assert.deepEqual(eventCalls, [
      {
        tenantId: "tenant_1",
        projectId: "tenant_1",
        userId: "user_1",
        assetId: "asset_1",
        type: "OPEN"
      },
      {
        tenantId: "tenant_1",
        projectId: "tenant_1",
        userId: "user_1",
        type: "IMPRESSION",
        payload: { source: "home", ref: "feed" }
      }
    ]);
  } finally {
    delete process.env.TENANT_BOOTSTRAP_PROTECT_CONTENT_ENABLED;
  }
});

test("delivery-core: bootstrap settings prefer projectId and fall back to tenantId", async () => {
  const findManyCalls: Array<Record<string, unknown>> = [];
  const createManyCalls: Array<Array<{ tenantId: string; projectId: string; key: string; value: string }>> = [];
  const core = createDeliveryCore({
    prisma: {
      tenant: {
        findUnique: async ({ where }: { where: { code?: string } }) =>
          where.code === "demo" ? { id: "tenant_1", code: "demo", name: "Demo" } : null,
        update: async () => ({})
      },
      tenantSetting: {
        findMany: async (args: Record<string, unknown>) => {
          findManyCalls.push(args);
          const where = (args as any).where ?? {};
          return where.projectId ? [] : [];
        },
        createMany: async ({ data }: { data: Array<{ tenantId: string; projectId: string; key: string; value: string }> }) => {
          createManyCalls.push(data);
          return { count: data.length };
        }
      }
    } as never,
    config: { code: "demo", name: "Demo" }
  });

  process.env.TENANT_BOOTSTRAP_PROTECT_CONTENT_ENABLED = "1";
  try {
    await core.getRuntimeProjectId();
    assert.ok(findManyCalls.some((c) => (c as any).where?.projectId === "tenant_1"));
    assert.ok(findManyCalls.some((c) => (c as any).where?.tenantId === "tenant_1"));
    assert.equal(createManyCalls.length, 1);
  } finally {
    delete process.env.TENANT_BOOTSTRAP_PROTECT_CONTENT_ENABLED;
  }
});

test("delivery-core: project owner bootstrap prefers projectId batches and falls back to tenantId", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const core = createDeliveryCore({
    prisma: {
      tenant: {
        findUnique: async () => ({ id: "tenant_1", code: "demo", name: "demo" }),
        update: async () => ({})
      },
      tenantMember: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          calls.push({ kind: "member", where });
          return null;
        },
        create: async () => ({})
      },
      uploadBatch: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          calls.push({ kind: "batch", where });
          return where.projectId ? null : { id: "batch_1" };
        }
      }
    } as never,
    config: { code: "demo", name: "demo" }
  });

  const result = await core.isProjectAdmin("owner_1");
  assert.equal(result, true);
  assert.ok(calls.some((c) => (c as any).kind === "batch" && (c as any).where?.projectId === "tenant_1"));
  assert.ok(calls.some((c) => (c as any).kind === "batch" && (c as any).where?.tenantId === "tenant_1"));
});

test("delivery-core: exposes project-first runtime wrappers", async () => {
  const core = createDeliveryCore({
    prisma: {
      tenant: {
        findUnique: async ({ where }: { where: { code?: string } }) =>
          where.code === "demo-project" ? { id: "tenant_1", code: "demo-project", name: "Demo Project" } : null,
        update: async () => ({})
      },
      tenantSetting: {
        findMany: async () => []
      }
    } as never,
    config: { code: "demo-project", name: "Demo Project" }
  });

  assert.deepEqual(await core.getRuntimeProjectContext(), {
    projectId: "tenant_1",
    code: "demo-project",
    name: "Demo Project"
  });
  assert.equal(await core.getRuntimeProjectId(), "tenant_1");
  assert.equal(await core.getProjectRuntimeScopeId(), "tenant_1");
});

test("delivery-core: tenant runtime alias remains compatible", async () => {
  const core = createDeliveryCore({
    prisma: {
      tenant: {
        findUnique: async ({ where }: { where: { code?: string } }) =>
          where.code === "demo-project" ? { id: "tenant_1", code: "demo-project", name: "Demo Project" } : null,
        update: async () => ({})
      },
      tenantSetting: {
        findMany: async () => []
      }
    } as never,
    config: { code: "demo-project", name: "Demo Project" }
  });

  assert.equal(await core.getTenantId(), "tenant_1");
});

test("delivery-core: single owner mode only grants project manage rights to owner", async () => {
  const previous = process.env.SINGLE_OWNER_MODE;
  process.env.SINGLE_OWNER_MODE = "1";
  try {
    const core = createDeliveryCore({
      prisma: {
        tenant: {
          findUnique: async () => ({ id: "tenant_1", code: "demo", name: "demo" }),
          update: async () => ({})
        },
        tenantMember: {
          findFirst: async () => ({ role: "ADMIN" })
        },
        uploadBatch: {
          findFirst: async () => null
        }
      } as never,
      config: { code: "demo", name: "demo" }
    });

    const result = await core.isProjectAdmin("admin_1");
    assert.equal(result, false);
  } finally {
    process.env.SINGLE_OWNER_MODE = previous;
  }
});

test("delivery-core: tenant manage alias remains compatible", async () => {
  const core = createDeliveryCore({
    prisma: {
      tenant: {
        findUnique: async () => ({ id: "tenant_1", code: "demo", name: "demo" }),
        update: async () => ({})
      },
      tenantMember: {
        findFirst: async () => ({ role: "OWNER" })
      }
    } as never,
    config: { code: "demo", name: "demo" }
  });

  assert.equal(await core.canManageProject("owner_1"), true);
  assert.equal(await core.isTenantAdmin("owner_1"), true);
});

test("tenant-guard: single owner mode blocks implicit tenant bootstrap", async () => {
  const previousMode = process.env.SINGLE_OWNER_MODE;
  const previousBootstrap = process.env.SINGLE_OWNER_ALLOW_TENANT_BOOTSTRAP;
  process.env.SINGLE_OWNER_MODE = "1";
  process.env.SINGLE_OWNER_ALLOW_TENANT_BOOTSTRAP = "";
  try {
    await assert.rejects(
      () =>
        ensureRuntimeTenant(
          {
            tenant: {
              findUnique: async () => null,
              create: async () => {
                throw new Error("should not create");
              }
            }
          } as never,
          { tenantCode: "demo", tenantName: "demo" }
        ),
      /禁止自动创建项目/
    );
  } finally {
    process.env.SINGLE_OWNER_MODE = previousMode;
    process.env.SINGLE_OWNER_ALLOW_TENANT_BOOTSTRAP = previousBootstrap;
  }
});

test("replication-worker: single owner mode ignores optional backup targets", async () => {
  const previous = process.env.SINGLE_OWNER_MODE;
  process.env.SINGLE_OWNER_MODE = "1";
  try {
    const capturedVaultGroupIds: string[][] = [];
    const replicateBatch = createReplicateBatch({
      bot: {
        api: {
          getChat: async () => ({ is_forum: false })
        }
      } as never,
      prisma: {
        uploadBatch: {
          findUnique: async () => ({
            id: "batch_1",
            tenantId: "tenant_1",
            assetId: "asset_1",
            items: []
          })
        },
        asset: {
          findUnique: async () => ({
            collectionId: null,
            collection: null
          })
        },
        tenantVaultBinding: {
          findMany: async () => [
            { role: "PRIMARY", vaultGroupId: "vg_primary", createdAt: new Date(), vaultGroup: { id: "vg_primary", chatId: BigInt(-1001), status: "ACTIVE" } },
            { role: "BACKUP", vaultGroupId: "vg_backup", createdAt: new Date(), vaultGroup: { id: "vg_backup", chatId: BigInt(-1002), status: "ACTIVE" } }
          ]
        },
        tenantSetting: {
          findUnique: async () => ({ value: "3" })
        },
        assetReplica: {
          findMany: async ({ where }: { where: { vaultGroupId: { in: string[] } } }) => {
            capturedVaultGroupIds.push(where.vaultGroupId.in);
            return [];
          },
          groupBy: async ({ where }: { where: { vaultGroupId: { in: string[] } } }) => {
            capturedVaultGroupIds.push(where.vaultGroupId.in);
            return [];
          }
        },
        uploadItem: {
          updateMany: async () => ({ count: 0 }),
          update: async () => ({})
        }
      } as never,
      config: { vaultChatId: "-1001" },
      sendMediaGroupWithRetry: async () => []
    });

    await replicateBatch("batch_1", { includeOptional: true });
    assert.deepEqual(capturedVaultGroupIds, [["vg_primary"], ["vg_primary"]]);
  } finally {
    process.env.SINGLE_OWNER_MODE = previous;
  }
});

test("replication-worker: min replicas prefers projectId and falls back to tenantId", async () => {
  const tenantSettingCalls: Array<Record<string, unknown>> = [];
  const replicateBatch = createReplicateBatch({
    bot: {
      api: {
        getChat: async () => ({ is_forum: false })
      }
    } as never,
    prisma: {
      uploadBatch: {
        findUnique: async () => ({
          id: "batch_1",
          tenantId: "tenant_legacy",
          projectId: "tenant_1",
          assetId: "asset_1",
          items: []
        })
      },
      asset: {
        findUnique: async () => ({
          collectionId: null,
          collection: null
        })
      },
      tenantVaultBinding: {
        findMany: async () => [
          { role: "PRIMARY", vaultGroupId: "vg_primary", createdAt: new Date(), vaultGroup: { id: "vg_primary", chatId: BigInt(-1001), status: "ACTIVE" } }
        ]
      },
      tenantSetting: {
        findUnique: async (args: Record<string, unknown>) => {
          tenantSettingCalls.push(args);
          return tenantSettingCalls.length === 1 ? null : { value: "2" };
        }
      },
      assetReplica: {
        findMany: async () => [],
        groupBy: async () => []
      },
      uploadItem: {
        updateMany: async () => ({ count: 0 }),
        update: async () => ({})
      }
    } as never,
    config: { vaultChatId: "-1001" },
    sendMediaGroupWithRetry: async () => []
  });

  await replicateBatch("batch_1", { includeOptional: true });
  assert.deepEqual(tenantSettingCalls, [
    {
      where: { projectId_key: { projectId: "tenant_1", key: "min_replicas" } },
      select: { value: true }
    },
    {
      where: { tenantId_key: { tenantId: "tenant_1", key: "min_replicas" } },
      select: { value: true }
    }
  ]);
});

test("renderers: settings copy switches to single-owner wording", async () => {
  const previous = process.env.SINGLE_OWNER_MODE;
  process.env.SINGLE_OWNER_MODE = "1";
  try {
    const { ctx, calls } = createMockCtx();
    const { store: broadcastDraftStates } = createStore<{ draftId: string }>();
    const { store: rankingViewStates } = createStore<{ range: "today" | "week" | "month"; metric: "open" | "visit" | "like" | "comment" }>();
    const renderers = createProjectRenderers({
      deliveryService: {
        isProjectMember: async () => true,
        isTenantUser: async () => true,
        canManageProject: async () => true,
        canManageProjectAdmins: async () => true,
        canManageProjectCollections: async () => true,
        getProjectHomeStats: async () => null,
        getTenantHomeStats: async () => null,
        listProjectManagers: async () => [{ tgUserId: "owner_1", role: "OWNER" }]
      } as never,
      mainKeyboard: new Keyboard().text("菜单"),
      syncSessionForView: () => undefined,
      broadcastDraftStates,
      rankingViewStates,
      formatLocalDateTime: () => "x"
    });

    await renderers.renderSettings(ctx);
    const text = String(calls.at(-1)?.args[0] ?? "");
    assert.ok(text.includes("项目拥有者"));
    assert.ok(text.includes("单人项目模式"));
  } finally {
    process.env.SINGLE_OWNER_MODE = previous;
  }
});

test("renderers: vault settings become overview-only in single-owner mode", async () => {
  const previous = process.env.SINGLE_OWNER_MODE;
  process.env.SINGLE_OWNER_MODE = "1";
  try {
    const { ctx, calls } = createMockCtx();
    const { store: broadcastDraftStates } = createStore<{ draftId: string }>();
    const { store: rankingViewStates } = createStore<{ range: "today" | "week" | "month"; metric: "open" | "visit" | "like" | "comment" }>();
    const renderers = createProjectRenderers({
      deliveryService: {
        isProjectMember: async () => true,
        isTenantUser: async () => true,
        canManageProject: async () => true,
        canManageProjectAdmins: async () => true,
        getProjectMinReplicas: async () => 1,
        getTenantMinReplicas: async () => 1,
        listVaultGroups: async () => [{ vaultGroupId: "vg_1", chatId: "-1001", role: "PRIMARY", status: "ACTIVE" }]
      } as never,
      mainKeyboard: new Keyboard().text("菜单"),
      syncSessionForView: () => undefined,
      broadcastDraftStates,
      rankingViewStates,
      formatLocalDateTime: () => "x"
    });

    await renderers.renderVaultSettings(ctx);
    const text = String(calls.at(-1)?.args[0] ?? "");
    assert.ok(text.includes("不再开放多存储群治理"));
    assert.ok(text.includes("仅作概览展示"));
  } finally {
    process.env.SINGLE_OWNER_MODE = previous;
  }
});

test("renderers: help copy uses project-member wording in single-owner mode", async () => {
  const previous = process.env.SINGLE_OWNER_MODE;
  process.env.SINGLE_OWNER_MODE = "1";
  try {
    const { ctx, calls } = createMockCtx();
    const { store: broadcastDraftStates } = createStore<{ draftId: string }>();
    const { store: rankingViewStates } = createStore<{ range: "today" | "week" | "month"; metric: "open" | "visit" | "like" | "comment" }>();
    const renderers = createProjectRenderers({
      deliveryService: {
        isProjectMember: async () => true,
        isTenantUser: async () => true,
        canManageProject: async () => true,
        getProjectSearchMode: async () => "ENTITLED_ONLY",
        getProjectPublicRankingEnabled: async () => false,
        getTenantSearchMode: async () => "ENTITLED_ONLY",
        getTenantPublicRankingEnabled: async () => false
      } as never,
      mainKeyboard: new Keyboard().text("菜单"),
      syncSessionForView: () => undefined,
      broadcastDraftStates,
      rankingViewStates,
      formatLocalDateTime: () => "x"
    });

    await renderers.renderHelp(ctx);
    const text = String(calls.at(-1)?.args[0] ?? "");
    assert.ok(text.includes("项目成员"));
    assert.equal(text.includes("租户）"), false);
  } finally {
    process.env.SINGLE_OWNER_MODE = previous;
  }
});

test("renderers: start home uses project member wording", async () => {
  const previous = process.env.SINGLE_OWNER_MODE;
  process.env.SINGLE_OWNER_MODE = "0";
  try {
    const { ctx, calls } = createMockCtx();
    const { store: broadcastDraftStates } = createStore<{ draftId: string }>();
    const { store: rankingViewStates } = createStore<{ range: "today" | "week" | "month"; metric: "open" | "visit" | "like" | "comment" }>();
    const renderers = createProjectRenderers({
      deliveryService: {
        isProjectMember: async () => true,
        isTenantUser: async () => true,
        canManageProject: async () => true,
        getProjectSearchMode: async () => "ENTITLED_ONLY",
        getProjectPublicRankingEnabled: async () => false,
        getProjectStartWelcomeHtml: async () => null
      } as never,
      mainKeyboard: new Keyboard().text("菜单"),
      syncSessionForView: () => undefined,
      broadcastDraftStates,
      rankingViewStates,
      formatLocalDateTime: () => "x"
    });

    await renderers.renderStartHome(ctx);
    const joined = calls.map((c) => String(c.args[0] ?? "")).join("\n");
    assert.ok(joined.includes("项目成员"));
    assert.equal(joined.includes("租户成员"), false);
  } finally {
    process.env.SINGLE_OWNER_MODE = previous;
  }
});

test("renderers: stats prefers project stats alias", async () => {
  const { ctx, calls } = createMockCtx();
  const { store: broadcastDraftStates } = createStore<{ draftId: string }>();
  const { store: rankingViewStates } = createStore<{ range: "today" | "week" | "month"; metric: "open" | "visit" | "like" | "comment" }>();
  let projectCalls = 0;
  const renderers = createProjectRenderers({
    deliveryService: {
      isProjectMember: async () => true,
      getProjectStats: async () => {
        projectCalls += 1;
        return {
          visitors: 12,
          visits: 34,
          opens: 56,
          openUsers: 7,
          assets: 8,
          batches: 9,
          files: 10,
          visits7d: 11,
          opens7d: 12
        };
      },
      getTenantStats: async () => {
        throw new Error("should not be called");
      }
    } as never,
    mainKeyboard: new Keyboard().text("菜单"),
    syncSessionForView: () => undefined,
    broadcastDraftStates,
    rankingViewStates,
    formatLocalDateTime: () => "x"
  });

  await renderers.renderStats(ctx);

  assert.equal(projectCalls, 1);
  assert.ok(calls.length > 0);
});

test("renderers: ranking prefers project ranking aliases", async () => {
  const { ctx, calls } = createMockCtx();
  const { store: broadcastDraftStates } = createStore<{ draftId: string }>();
  const { store: rankingViewStates } = createStore<{ range: "today" | "week" | "month"; metric: "open" | "visit" | "like" | "comment" }>();
  let projectRankingCalls = 0;
  const renderers = createProjectRenderers({
    deliveryService: {
      isProjectMember: async () => false,
      getProjectPublicRankingEnabled: async () => true,
      getTenantPublicRankingEnabled: async () => {
        throw new Error("should not be called");
      },
      getProjectRanking: async () => {
        projectRankingCalls += 1;
        return [
          {
            assetId: "asset_1",
            title: "Project ranking asset",
            shareCode: "share_1",
            opens: 5,
            publisherUserId: "publisher_1"
          }
        ];
      },
      getTenantRanking: async () => {
        throw new Error("should not be called");
      }
    } as never,
    mainKeyboard: new Keyboard().text("菜单"),
    syncSessionForView: () => undefined,
    broadcastDraftStates,
    rankingViewStates,
    formatLocalDateTime: () => "x"
  });

  await renderers.renderRanking(ctx, "month", "open");

  assert.equal(projectRankingCalls, 1);
  assert.ok(calls.length > 0);
});

test("stats: ranking context uses project-oriented runtime deps", async () => {
  let runtimeProjectCalls = 0;
  let projectMemberCalls = 0;
  const stats = createDeliveryStats({
    prisma: {
      event: {
        groupBy: async () => [],
        count: async () => 0
      },
      asset: {
        findMany: async () => []
      }
    } as never,
    getRuntimeProjectId: async () => {
      runtimeProjectCalls += 1;
      return "tenant_1";
    },
    isProjectMemberSafe: async () => {
      projectMemberCalls += 1;
      return false;
    },
    formatLocalDate: () => "2026-04-20",
    startOfLocalDay: (date) => date,
    startOfLocalWeek: (date) => date,
    startOfLocalMonth: (date) => date
  });

  const result = await stats.getProjectRanking("today", 10, "user_public");
  assert.deepEqual(result, []);
  assert.equal(runtimeProjectCalls, 1);
  assert.equal(projectMemberCalls, 1);
});

test("stats: project stats prefer projectId and fall back to tenantId", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const stats = createDeliveryStats({
    prisma: {
      event: {
        groupBy: async (args: Record<string, unknown>) => {
          calls.push({ kind: "groupBy", ...args });
          const where = (args as any).where ?? {};
          return where.projectId ? [] : [{ userId: "u1" }];
        },
        count: async (args: Record<string, unknown>) => {
          calls.push({ kind: "count", ...args });
          const where = (args as any).where ?? {};
          return where.projectId ? 0 : 5;
        }
      },
      asset: {
        count: async (args: Record<string, unknown>) => {
          calls.push({ kind: "assetCount", ...args });
          const where = (args as any).where ?? {};
          return where.projectId ? 0 : 2;
        },
        findMany: async () => []
      },
      uploadBatch: {
        count: async (args: Record<string, unknown>) => {
          calls.push({ kind: "batchCount", ...args });
          const where = (args as any).where ?? {};
          return where.projectId ? 0 : 3;
        }
      },
      uploadItem: {
        count: async (args: Record<string, unknown>) => {
          calls.push({ kind: "itemCount", ...args });
          const where = (args as any).where?.batch ?? {};
          return where.projectId ? 0 : 4;
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => true,
    formatLocalDate: () => "2026-04-22",
    startOfLocalDay: (date) => date,
    startOfLocalWeek: (date) => date,
    startOfLocalMonth: (date) => date
  });

  const result = await stats.getProjectStats();
  assert.equal(result.visitors, 1);
  assert.equal(result.assets, 2);
  assert.ok(calls.some((c) => (c as any).where?.projectId === "tenant_1"));
  assert.ok(calls.some((c) => (c as any).where?.tenantId === "tenant_1"));
});

test("stats: project ranking prefers projectId and falls back to tenantId", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const stats = createDeliveryStats({
    prisma: {
      event: {
        groupBy: async (args: Record<string, unknown>) => {
          calls.push(args);
          const where = (args as any).where ?? {};
          return where.projectId ? [] : [{ assetId: "asset_1", _count: { assetId: 7 } }];
        },
        count: async () => 0
      },
      asset: {
        findMany: async () => [
          {
            id: "asset_1",
            title: "Asset",
            shareCode: "share_1",
            visibility: "PUBLIC",
            uploadBatches: [{ userId: "publisher_1" }]
          }
        ]
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => false,
    formatLocalDate: () => "2026-04-22",
    startOfLocalDay: (date) => date,
    startOfLocalWeek: (date) => date,
    startOfLocalMonth: (date) => date
  });

  const result = await stats.getProjectRanking("today", 10, "user_public");
  assert.deepEqual(result, [
    {
      assetId: "asset_1",
      title: "Asset",
      shareCode: "share_1",
      opens: 7,
      publisherUserId: "publisher_1"
    }
  ]);
  assert.ok(calls.some((c) => (c as any).where?.projectId === "tenant_1"));
  assert.ok(calls.some((c) => (c as any).where?.tenantId === "tenant_1"));
});

test("history: community scope prefers project batch alias", async () => {
  const { ctx, calls } = createMockCtx();
  const { store: historyFilterStates } = createStore<string | null | undefined>();
  const { store: historyDateStates } = createStore<Date>();
  const { store: historyScopeStates } = createStore<"community" | "mine">();
  let projectCalls = 0;
  const renderHistory = createProjectHistoryRenderer({
    deliveryService: {
      setUserHistoryListDate: async () => undefined,
      listProjectBatches: async () => {
        projectCalls += 1;
        return {
          total: 1,
          items: [
            {
              assetId: "asset_1",
              shareCode: "share_1",
              title: "Project batch item",
              description: "Visible",
              count: 2,
              publisherUserId: "publisher_1"
            }
          ]
        };
      },
      listUserBatches: async () => ({ total: 0, items: [] }),
      listCollections: async () => [],
      getProjectHidePublisherEnabled: async () => false,
      isProjectMember: async () => true,
      canManageProject: async () => false,
      getProjectUserLabel: async () => "@publisher_1",
      getTenantUserLabel: async () => null
    } as never,
    mainKeyboard: new Keyboard().text("菜单"),
    syncSessionForView: () => undefined,
    hydrateUserPreferences: async () => undefined,
    historyPageSize: 10,
    historyFilterStates,
    historyDateStates,
    historyScopeStates,
    buildAssetActionLine: ({ assetId }) => `open:${assetId}`
  });

  await renderHistory(ctx, 1, "community");

  assert.equal(projectCalls, 1);
  assert.ok(calls.length > 0);
});

test("integration: delivery flow returns a hint while replicas are pending", async () => {
  const { ctx, calls } = createMockCtx();
  const open = createProjectOpenHandler({
    getProjectProtectContentEnabled: async () => false,
    getTenantProtectContentEnabled: async () => false,
    selectReplicas: async () => ({ status: "pending", message: "Replica write in progress" }),
    resolveShareCode: async () => null
  } as never);
  await open.openAsset(ctx, "asset1", 1);
  assert.ok(calls.some((c) => c.method === "reply" && String(c.args[0]).includes("Replica write in progress")));
});

test("integration: open handler tracks open with project id from selection", async () => {
  const { ctx } = createMockCtx();
  const trackOpenCalls: Array<{ projectId: string; userId: string; assetId: string }> = [];
  const open = createProjectOpenHandler({
    getProjectProtectContentEnabled: async () => false,
    selectReplicas: async () => ({
      status: "ready" as const,
      projectId: "project_1",
      messages: [],
      title: "Project asset",
      description: null,
      publisherUserId: null
    }),
    getProjectDeliveryAdConfig: async () => ({
      prevText: "prev",
      nextText: "next",
      adButtonText: null,
      adButtonUrl: null
    }),
    getAssetCommentCount: async () => 0,
    getAssetLikeCount: async () => 0,
    hasAssetLiked: async () => false,
    isProjectMember: async () => false,
    trackOpen: async (projectId: string, userId: string, assetId: string) => {
      trackOpenCalls.push({ projectId, userId, assetId });
    }
  } as never);

  await open.openAsset(ctx, "asset_1", 1);

  assert.deepEqual(trackOpenCalls, [{ projectId: "project_1", userId: "1", assetId: "asset_1" }]);
});

test("discovery: recycle and restore preserve original visibility", async () => {
  const tenantId = "tenant_1";
  const asset = {
    id: "asset_1",
    searchable: true,
    visibility: "PUBLIC" as "PUBLIC" | "PROTECTED" | "RESTRICTED"
  };
  const settings = new Map<string, string>();
  const upsertCalls: Array<{
    where: { tenantId_key: { tenantId: string; key: string } };
    update: { projectId: string; value: string | null };
    create: { tenantId: string; projectId: string; key: string; value: string | null };
  }> = [];

  const prisma = {
    uploadBatch: {
      findFirst: async () => ({ id: "batch_1" })
    },
    asset: {
      findFirst: async () => ({ ...asset }),
      update: async ({ data }: { data: { searchable?: boolean; visibility?: "PUBLIC" | "PROTECTED" | "RESTRICTED" } }) => {
        if (data.searchable !== undefined) {
          asset.searchable = data.searchable;
        }
        if (data.visibility !== undefined) {
          asset.visibility = data.visibility;
        }
        return { ...asset };
      }
    },
    tenantSetting: {
      upsert: async ({
        where,
        create,
        update
      }: {
        where: { tenantId_key: { tenantId: string; key: string } };
        create: { tenantId: string; projectId: string; key: string; value: string | null };
        update: { projectId: string; value: string | null };
      }) => {
        upsertCalls.push({ where, create, update });
        settings.set(create.key, update.value ?? create.value ?? "");
      },
      findUnique: async ({
        where
      }: {
        where: { tenantId_key?: { key: string }; projectId_key?: { key: string } };
      }) => ({
        value: settings.get(where.projectId_key?.key ?? where.tenantId_key?.key ?? "") ?? null
      }),
      deleteMany: async ({ where }: { where: { key: string } }) => {
        settings.delete(where.key);
        return { count: 1 };
      }
    },
    $transaction: async (runner: (tx: any) => Promise<void>) => runner(prisma)
  } as never;

  const discovery = createDeliveryDiscovery({
    prisma,
    getRuntimeProjectId: async () => tenantId,
    isProjectMemberSafe: async () => true,
    startOfLocalDay: (date) => date
  });

  const recycled = await discovery.recycleUserAsset("user_1", asset.id);
  assert.equal(recycled.ok, true);
  assert.equal(asset.searchable, false);
  assert.equal(asset.visibility, "RESTRICTED");
  assert.deepEqual(upsertCalls.at(-1), {
    where: { tenantId_key: { tenantId: "tenant_1", key: "recycled_visibility:asset_1" } },
    update: { projectId: "tenant_1", value: "PUBLIC" },
    create: { tenantId: "tenant_1", projectId: "tenant_1", key: "recycled_visibility:asset_1", value: "PUBLIC" }
  });

  const restored = await discovery.restoreUserAsset("user_1", asset.id);
  assert.equal(restored.ok, true);
  assert.equal(asset.searchable, true);
  assert.equal(asset.visibility, "PUBLIC");
});

test("discovery: deleteUserAsset prefers projectId and falls back to tenantId", async () => {
  const batchCalls: Array<Record<string, unknown>> = [];
  const assetCalls: Array<Record<string, unknown>> = [];
  const deleted: string[] = [];
  const settingDeletes: Array<Record<string, unknown>> = [];
  const uploadItemDeletes: Array<Record<string, unknown>> = [];
  const uploadBatchDeletes: Array<Record<string, unknown>> = [];
  const commentLikeDeletes: Array<Record<string, unknown>> = [];
  const commentDeletes: Array<Record<string, unknown>> = [];
  const likeDeletes: Array<Record<string, unknown>> = [];
  const tagDeletes: Array<Record<string, unknown>> = [];

  const discovery = createDeliveryDiscovery({
    prisma: {
      uploadBatch: {
        findFirst: async (args: Record<string, unknown>) => {
          batchCalls.push(args);
          return batchCalls.length === 1 ? null : { id: "batch_1" };
        },
        deleteMany: async () => ({ count: 1 })
      },
      asset: {
        findFirst: async (args: Record<string, unknown>) => {
          assetCalls.push(args);
          return assetCalls.length === 1 ? null : { id: "asset_1" };
        },
        delete: async ({ where }: { where: { id: string } }) => {
          deleted.push(where.id);
          return {};
        }
      },
      tenantSetting: {
        deleteMany: async (args: Record<string, unknown>) => {
          settingDeletes.push(args);
          return { count: 1 };
        }
      },
      assetCommentLike: {
        deleteMany: async (args: Record<string, unknown>) => {
          commentLikeDeletes.push(args);
          return { count: 1 };
        }
      },
      assetComment: {
        deleteMany: async (args: Record<string, unknown>) => {
          commentDeletes.push(args);
          return { count: 1 };
        }
      },
      assetLike: {
        deleteMany: async (args: Record<string, unknown>) => {
          likeDeletes.push(args);
          return { count: 1 };
        }
      },
      assetTag: {
        deleteMany: async (args: Record<string, unknown>) => {
          tagDeletes.push(args);
          return { count: 1 };
        }
      },
      assetReplica: {
        deleteMany: async () => ({ count: 1 })
      },
      uploadItem: {
        deleteMany: async (args: Record<string, unknown>) => {
          uploadItemDeletes.push(args);
          return { count: 1 };
        }
      },
      $transaction: async (runner: (tx: any) => Promise<void>) =>
        runner({
          tenantSetting: {
            deleteMany: async (args: Record<string, unknown>) => {
              settingDeletes.push(args);
              return { count: 1 };
            }
          },
          assetCommentLike: {
            deleteMany: async (args: Record<string, unknown>) => {
              commentLikeDeletes.push(args);
              return { count: 1 };
            }
          },
          assetComment: {
            deleteMany: async (args: Record<string, unknown>) => {
              commentDeletes.push(args);
              return { count: 1 };
            }
          },
          assetLike: {
            deleteMany: async (args: Record<string, unknown>) => {
              likeDeletes.push(args);
              return { count: 1 };
            }
          },
          assetTag: {
            deleteMany: async (args: Record<string, unknown>) => {
              tagDeletes.push(args);
              return { count: 1 };
            }
          },
          assetReplica: { deleteMany: async () => ({ count: 1 }) },
          uploadItem: {
            deleteMany: async (args: Record<string, unknown>) => {
              uploadItemDeletes.push(args);
              return { count: 1 };
            }
          },
          uploadBatch: {
            deleteMany: async (args: Record<string, unknown>) => {
              uploadBatchDeletes.push(args);
              return { count: 1 };
            }
          },
          asset: {
            delete: async ({ where }: { where: { id: string } }) => {
              deleted.push(where.id);
              return {};
            }
          }
        })
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => true,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.deleteUserAsset("user_1", "asset_1");

  assert.equal(result.ok, true);
  assert.deepEqual(batchCalls, [
    {
      orderBy: { createdAt: "desc" },
      where: { projectId: "tenant_1", userId: "user_1", assetId: "asset_1", status: "COMMITTED" },
      select: { id: true }
    },
    {
      orderBy: { createdAt: "desc" },
      where: { tenantId: "tenant_1", userId: "user_1", assetId: "asset_1", status: "COMMITTED" },
      select: { id: true }
    }
  ]);
  assert.deepEqual(assetCalls, [
    {
      where: { id: "asset_1", projectId: "tenant_1" },
      select: { id: true }
    },
    {
      where: { id: "asset_1", tenantId: "tenant_1" },
      select: { id: true }
    }
  ]);
  assert.deepEqual(settingDeletes, [
    { where: { projectId: "tenant_1", key: "recycled_visibility:asset_1" } },
    { where: { tenantId: "tenant_1", key: "recycled_visibility:asset_1" } }
  ]);
  assert.deepEqual(commentLikeDeletes, [
    { where: { comment: { asset: { projectId: "tenant_1", id: "asset_1" } } } },
    { where: { tenantId: "tenant_1", comment: { assetId: "asset_1" } } }
  ]);
  assert.deepEqual(commentDeletes, [
    { where: { asset: { projectId: "tenant_1", id: "asset_1" } } },
    { where: { tenantId: "tenant_1", assetId: "asset_1" } }
  ]);
  assert.deepEqual(likeDeletes, [
    { where: { asset: { projectId: "tenant_1", id: "asset_1" } } },
    { where: { tenantId: "tenant_1", assetId: "asset_1" } }
  ]);
  assert.deepEqual(tagDeletes, [
    { where: { asset: { projectId: "tenant_1", id: "asset_1" } } },
    { where: { tenantId: "tenant_1", assetId: "asset_1" } }
  ]);
  assert.deepEqual(uploadItemDeletes, [
    { where: { batch: { projectId: "tenant_1", assetId: "asset_1" } } },
    { where: { batch: { tenantId: "tenant_1", assetId: "asset_1" } } }
  ]);
  assert.deepEqual(uploadBatchDeletes, [
    { where: { projectId: "tenant_1", assetId: "asset_1" } },
    { where: { tenantId: "tenant_1", assetId: "asset_1" } }
  ]);
  assert.deepEqual(deleted, ["asset_1"]);
});

test("discovery: restoreUserAsset prefers projectId and falls back to tenantId", async () => {
  const batchCalls: Array<Record<string, unknown>> = [];
  const assetCalls: Array<Record<string, unknown>> = [];
  const settingCalls: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const settingDeletes: Array<Record<string, unknown>> = [];

  const discovery = createDeliveryDiscovery({
    prisma: {
      uploadBatch: {
        findFirst: async (args: Record<string, unknown>) => {
          batchCalls.push(args);
          return batchCalls.length === 1 ? null : { id: "batch_1" };
        }
      },
      asset: {
        findFirst: async (args: Record<string, unknown>) => {
          assetCalls.push(args);
          return assetCalls.length === 1
            ? null
            : { id: "asset_1", searchable: false, visibility: "RESTRICTED" };
        }
      },
      tenantSetting: {
        findUnique: async (args: Record<string, unknown>) => {
          settingCalls.push(args);
          return settingCalls.length === 1 ? null : { value: "PUBLIC" };
        }
      },
      $transaction: async (runner: (tx: any) => Promise<void>) =>
        runner({
          asset: {
            update: async (args: Record<string, unknown>) => {
              updates.push(args);
              return {};
            }
          },
          tenantSetting: {
            deleteMany: async (args: Record<string, unknown>) => {
              settingDeletes.push(args);
              return { count: 1 };
            }
          }
        })
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => true,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.restoreUserAsset("user_1", "asset_1");

  assert.equal(result.ok, true);
  assert.deepEqual(batchCalls, [
    {
      orderBy: { createdAt: "desc" },
      where: { projectId: "tenant_1", userId: "user_1", assetId: "asset_1", status: "COMMITTED" },
      select: { id: true }
    },
    {
      orderBy: { createdAt: "desc" },
      where: { tenantId: "tenant_1", userId: "user_1", assetId: "asset_1", status: "COMMITTED" },
      select: { id: true }
    }
  ]);
  assert.deepEqual(assetCalls, [
    {
      where: { id: "asset_1", projectId: "tenant_1" },
      select: { id: true, searchable: true, visibility: true }
    },
    {
      where: { id: "asset_1", tenantId: "tenant_1" },
      select: { id: true, searchable: true, visibility: true }
    }
  ]);
  assert.deepEqual(settingCalls, [
    {
      where: { projectId_key: { projectId: "tenant_1", key: "recycled_visibility:asset_1" } },
      select: { value: true }
    },
    {
      where: { tenantId_key: { tenantId: "tenant_1", key: "recycled_visibility:asset_1" } },
      select: { value: true }
    }
  ]);
  assert.deepEqual(updates, [
    {
      where: { id: "asset_1" },
      data: { searchable: true, visibility: "PUBLIC" }
    }
  ]);
  assert.deepEqual(settingDeletes, [
    { where: { projectId: "tenant_1", key: "recycled_visibility:asset_1" } },
    { where: { tenantId: "tenant_1", key: "recycled_visibility:asset_1" } }
  ]);
});

test("discovery: getUserAssetMeta prefers projectId and falls back to tenantId", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const discovery = createDeliveryDiscovery({
    prisma: {
      uploadBatch: {
        findFirst: async (args: Record<string, unknown>) => {
          calls.push(args);
          if (calls.length === 1) {
            return null;
          }
          return {
            assetId: "asset_1",
            asset: {
              shareCode: "share_1",
              title: "Asset title",
              description: "Asset desc",
              collectionId: "collection_1",
              searchable: true,
              visibility: "PUBLIC"
            }
          };
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => true,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.getUserAssetMeta("user_1", "asset_1");

  assert.deepEqual(result, {
    assetId: "asset_1",
    shareCode: "share_1",
    title: "Asset title",
    description: "Asset desc",
    collectionId: "collection_1",
    searchable: true,
    visibility: "PUBLIC"
  });
  assert.deepEqual(calls, [
    {
      where: { projectId: "tenant_1", userId: "user_1", assetId: "asset_1", status: "COMMITTED" },
      orderBy: { createdAt: "desc" },
      include: { asset: true }
    },
    {
      where: { tenantId: "tenant_1", userId: "user_1", assetId: "asset_1", status: "COMMITTED" },
      orderBy: { createdAt: "desc" },
      include: { asset: true }
    }
  ]);
});

test("discovery: setUserAssetSearchable prefers projectId and falls back to tenantId", async () => {
  const batchCalls: Array<Record<string, unknown>> = [];
  const assetFindCalls: Array<Record<string, unknown>> = [];
  const assetUpdateCalls: Array<Record<string, unknown>> = [];

  const discovery = createDeliveryDiscovery({
    prisma: {
      uploadBatch: {
        findFirst: async (args: Record<string, unknown>) => {
          batchCalls.push(args);
          return { id: "batch_1" };
        }
      },
      asset: {
        findFirst: async (args: Record<string, unknown>) => {
          assetFindCalls.push(args);
          return assetFindCalls.length === 1 ? null : { id: "asset_1", searchable: true };
        },
        update: async (args: Record<string, unknown>) => {
          assetUpdateCalls.push(args);
          return {};
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => true,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.setUserAssetSearchable("user_1", "asset_1", false);
  assert.equal(result.ok, true);

  assert.deepEqual(batchCalls, [
    {
      orderBy: { createdAt: "desc" },
      where: { projectId: "tenant_1", userId: "user_1", assetId: "asset_1", status: "COMMITTED" },
      select: { id: true }
    }
  ]);
  assert.deepEqual(assetFindCalls, [
    { where: { id: "asset_1", projectId: "tenant_1" }, select: { id: true, searchable: true } },
    { where: { id: "asset_1", tenantId: "tenant_1" }, select: { id: true, searchable: true } }
  ]);
  assert.deepEqual(assetUpdateCalls, [{ where: { id: "asset_1" }, data: { searchable: false } }]);
});

test("discovery: listUserRecycledAssets prefers projectId and falls back to tenantId", async () => {
  const countCalls: Array<Record<string, unknown>> = [];
  const findManyCalls: Array<Record<string, unknown>> = [];
  const discovery = createDeliveryDiscovery({
    prisma: {
      asset: {
        count: async (args: Record<string, unknown>) => {
          countCalls.push(args);
          return countCalls.length === 1 ? 0 : 1;
        },
        findMany: async (args: Record<string, unknown>) => {
          findManyCalls.push(args);
          return findManyCalls.length === 1
            ? []
            : [
                {
                  id: "asset_1",
                  title: "Recycled asset",
                  description: "Archived",
                  shareCode: "share_1",
                  updatedAt: new Date("2026-04-21T10:00:00.000Z")
                }
              ];
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => true,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.listUserRecycledAssets("user_1", 1, 10);

  assert.equal(result.total, 1);
  assert.deepEqual(result.items.map((item) => item.assetId), ["asset_1"]);
  assert.deepEqual(countCalls, [
    {
      where: {
        projectId: "tenant_1",
        searchable: false,
        visibility: "RESTRICTED",
        uploadBatches: { some: { projectId: "tenant_1", userId: "user_1", status: "COMMITTED" } }
      }
    },
    {
      where: {
        tenantId: "tenant_1",
        searchable: false,
        visibility: "RESTRICTED",
        uploadBatches: { some: { tenantId: "tenant_1", userId: "user_1", status: "COMMITTED" } }
      }
    }
  ]);
  assert.deepEqual(findManyCalls, [
    {
      where: {
        projectId: "tenant_1",
        searchable: false,
        visibility: "RESTRICTED",
        uploadBatches: { some: { projectId: "tenant_1", userId: "user_1", status: "COMMITTED" } }
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 10,
      skip: 0,
      select: {
        id: true,
        title: true,
        description: true,
        shareCode: true,
        updatedAt: true
      }
    },
    {
      where: {
        tenantId: "tenant_1",
        searchable: false,
        visibility: "RESTRICTED",
        uploadBatches: { some: { tenantId: "tenant_1", userId: "user_1", status: "COMMITTED" } }
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 10,
      skip: 0,
      select: {
        id: true,
        title: true,
        description: true,
        shareCode: true,
        updatedAt: true
      }
    }
  ]);
});

test("access: protected asset is allowed for public viewer", async () => {
  const getProjectAssetAccess = createGetProjectAssetAccess({
    prisma: {
      asset: {
        findFirst: async () => ({ id: "asset_1", visibility: "PROTECTED" })
      },
      uploadBatch: {
        findFirst: async () => null
      }
    } as never,
    isProjectMemberSafe: async () => false,
    canManageProjectSafe: async () => false
  });

  const result = await getProjectAssetAccess("tenant_1", "user_1", "asset_1");
  assert.equal(result.status, "ok");
});

test("access: project asset access prefers projectId and falls back to tenantId", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const getProjectAssetAccess = createGetProjectAssetAccess({
    prisma: {
      asset: {
        findFirst: async (args: Record<string, unknown>) => {
          calls.push({ kind: "asset", ...args });
          const where = (args as any).where ?? {};
          return where.projectId ? null : { id: "asset_1", visibility: "RESTRICTED" };
        }
      },
      uploadBatch: {
        findFirst: async (args: Record<string, unknown>) => {
          calls.push({ kind: "batch", ...args });
          const where = (args as any).where ?? {};
          return where.projectId ? null : { id: "batch_1" };
        }
      }
    } as never,
    isProjectMemberSafe: async () => true,
    canManageProjectSafe: async () => false
  });

  const result = await getProjectAssetAccess("tenant_1", "user_1", "asset_1");
  assert.deepEqual(result, { status: "ok", asset: { id: "asset_1", visibility: "RESTRICTED" } });
  assert.ok(calls.some((c) => (c as any).kind === "asset" && (c as any).where?.projectId === "tenant_1"));
  assert.ok(calls.some((c) => (c as any).kind === "asset" && (c as any).where?.tenantId === "tenant_1"));
  assert.ok(calls.some((c) => (c as any).kind === "batch" && (c as any).where?.projectId === "tenant_1"));
  assert.ok(calls.some((c) => (c as any).kind === "batch" && (c as any).where?.tenantId === "tenant_1"));
});

test("access: tenant helper remains a compatibility alias of project asset access", async () => {
  const deps = {
    prisma: {
      asset: {
        findFirst: async () => ({ id: "asset_1", visibility: "RESTRICTED" })
      },
      uploadBatch: {
        findFirst: async () => ({ id: "batch_1" })
      }
    } as never,
    isProjectMemberSafe: async () => true,
    canManageProjectSafe: async () => false
  };

  const getProjectAssetAccess = createGetProjectAssetAccess(deps);
  const getTenantAssetAccess = createGetTenantAssetAccess(deps);

  assert.deepEqual(
    await getProjectAssetAccess("tenant_1", "user_1", "asset_1"),
    await getTenantAssetAccess("tenant_1", "user_1", "asset_1")
  );
});

test("replica-selection: protected asset remains accessible by share link for public viewer", async () => {
  const select = createDeliveryReplicaSelection({
    prisma: {
      asset: {
        findUnique: async () => ({
          id: "asset_1",
          tenantId: "tenant_1",
          visibility: "PROTECTED",
          title: "Protected asset",
          description: "Shared by code",
          replicas: [
            {
              uploadItemId: "item_1",
              createdAt: new Date("2026-04-14T10:00:00.000Z"),
              messageId: BigInt(101),
              vaultGroup: { chatId: BigInt(-100123), status: "ACTIVE" }
            }
          ]
        })
      },
      uploadBatch: {
        findFirst: async () => ({
          userId: "publisher_1",
          items: [{ id: "item_1", kind: "document", mediaGroupId: null, fileId: "file_1", status: "SUCCESS" }]
        })
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => false,
    getProjectMinReplicas: async () => 1,
    getSetting: async () => null
  });

  const result = await select.selectReplicas("user_public", "asset_1");
  assert.equal(result.status, "ready");
});

test("replica-selection: restricted asset is still blocked for public viewer", async () => {
  const select = createDeliveryReplicaSelection({
    prisma: {
      asset: {
        findUnique: async () => ({
          id: "asset_1",
          tenantId: "tenant_1",
          visibility: "RESTRICTED",
          title: "Restricted asset",
          description: "Private",
          replicas: []
        })
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => false,
    getProjectMinReplicas: async () => 1,
    getSetting: async () => null
  });

  const result = await select.selectReplicas("user_public", "asset_1");
  assert.equal(result.status, "failed");
});

test("replica-selection: pending status uses project-oriented runtime deps", async () => {
  let projectIdCalls = 0;
  let minReplicaCalls = 0;
  let projectMemberCalls = 0;
  const select = createDeliveryReplicaSelection({
    prisma: {
      asset: {
        findUnique: async () => ({
          id: "asset_1",
          tenantId: "tenant_1",
          visibility: "RESTRICTED",
          title: "Restricted asset",
          description: "Pending",
          replicas: []
        })
      },
      uploadBatch: {
        findFirst: async () => ({
          id: "batch_1",
          createdAt: new Date(Date.now() - 60_000),
          items: [{ id: "item_1", status: "PENDING", kind: "document", mediaGroupId: null, fileId: "file_1" }]
        })
      },
      tenantVaultBinding: {
        findMany: async () => []
      }
    } as never,
    getRuntimeProjectId: async () => {
      projectIdCalls += 1;
      return "tenant_1";
    },
    isProjectMemberSafe: async () => {
      projectMemberCalls += 1;
      return true;
    },
    getProjectMinReplicas: async () => {
      minReplicaCalls += 1;
      return 1;
    },
    getSetting: async () => null
  });

  const result = await select.selectReplicas("user_member", "asset_1");
  assert.equal(result.status, "pending");
  assert.equal(projectMemberCalls, 1);
  assert.equal(minReplicaCalls, 1);
  assert.equal(projectIdCalls, 1);
});

test("access: restricted asset is forbidden for non-owner tenant user", async () => {
  const getTenantAssetAccess = createGetTenantAssetAccess({
    prisma: {
      asset: {
        findFirst: async () => ({ id: "asset_1", visibility: "RESTRICTED" })
      },
      uploadBatch: {
        findFirst: async () => null
      }
    } as never,
    isProjectMemberSafe: async () => true,
    canManageProjectSafe: async () => false
  });

  const result = await getTenantAssetAccess("tenant_1", "user_1", "asset_1");
  assert.equal(result.status, "forbidden");
});

test("access: restricted asset is allowed for owner", async () => {
  const getTenantAssetAccess = createGetTenantAssetAccess({
    prisma: {
      asset: {
        findFirst: async () => ({ id: "asset_1", visibility: "RESTRICTED" })
      },
      uploadBatch: {
        findFirst: async () => ({ id: "batch_1" })
      }
    } as never,
    isProjectMemberSafe: async () => true,
    canManageProjectSafe: async () => false
  });

  const result = await getTenantAssetAccess("tenant_1", "user_1", "asset_1");
  assert.equal(result.status, "ok");
});

test("discovery: public viewer search returns non-restricted assets", async () => {
  const prisma = {
    asset: {
      count: async ({ where }: { where: { visibility?: { not: "RESTRICTED" } } }) => {
        assert.equal(where.visibility?.not, "RESTRICTED");
        return 1;
      },
      findMany: async ({ where }: { where: { visibility?: { not: "RESTRICTED" } } }) => {
        assert.equal(where.visibility?.not, "RESTRICTED");
        return [
          {
            id: "asset_public",
            title: "Public title",
            description: "Visible",
            shareCode: "public-code",
            uploadBatches: [{ userId: "publisher_1" }]
          }
        ];
      }
    },
    event: {
      create: async () => undefined
    }
  } as never;

  const discovery = createDeliveryDiscovery({
    prisma,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => false,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.searchAssets("user_public", "title", 1, 10);
  assert.equal(result.total, 1);
  assert.deepEqual(result.items.map((item) => item.assetId), ["asset_public"]);
});

test("discovery: search uses project-oriented runtime deps", async () => {
  let runtimeProjectCalls = 0;
  let projectMemberCalls = 0;
  const discovery = createDeliveryDiscovery({
    prisma: {
      asset: {
        count: async () => 0,
        findMany: async () => []
      },
      event: {
        create: async () => undefined
      }
    } as never,
    getRuntimeProjectId: async () => {
      runtimeProjectCalls += 1;
      return "tenant_1";
    },
    isProjectMemberSafe: async () => {
      projectMemberCalls += 1;
      return false;
    },
    startOfLocalDay: (date) => date
  });

  const result = await discovery.searchAssets("user_public", "title", 1, 10);
  assert.equal(result.total, 0);
  assert.equal(runtimeProjectCalls, 1);
  assert.equal(projectMemberCalls, 1);
});

test("discovery: search prefers projectId scope then falls back to tenantId", async () => {
  const assetCountWheres: Array<Record<string, unknown>> = [];
  const assetFindManyWheres: Array<Record<string, unknown>> = [];
  const eventCreates: Array<Record<string, unknown>> = [];

  const prisma = {
    asset: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        assetCountWheres.push(where);
        // First try (projectId) misses, second try (tenantId) hits.
        return Object.prototype.hasOwnProperty.call(where, "projectId") ? 0 : 1;
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        assetFindManyWheres.push(where);
        return Object.prototype.hasOwnProperty.call(where, "projectId")
          ? []
          : [
              {
                id: "asset_fallback",
                title: "Fallback title",
                description: "Fallback desc",
                shareCode: "fallback-code",
                uploadBatches: [{ userId: "publisher_1" }]
              }
            ];
      }
    },
    event: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        eventCreates.push(data);
        return undefined;
      }
    }
  } as never;

  const discovery = createDeliveryDiscovery({
    prisma,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => false,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.searchAssets("user_public", "title", 1, 10);
  assert.equal(result.total, 1);
  assert.deepEqual(result.items.map((item) => item.assetId), ["asset_fallback"]);

  assert.equal(assetCountWheres.length, 2);
  assert.equal(assetFindManyWheres.length, 2);
  assert.equal(assetCountWheres[0]?.projectId, "tenant_1");
  assert.equal(assetFindManyWheres[0]?.projectId, "tenant_1");
  assert.equal((assetCountWheres[1] as any)?.tenantId, "tenant_1");
  assert.equal((assetFindManyWheres[1] as any)?.tenantId, "tenant_1");

  assert.equal(eventCreates.length, 1);
  assert.equal(eventCreates[0]?.tenantId, "tenant_1");
  assert.equal(eventCreates[0]?.projectId, "tenant_1");
});

test("discovery: public viewer tag index excludes only restricted assets", async () => {
  const prisma = {
    assetTag: {
      groupBy: async ({ where }: { where: { asset: { visibility?: { not: "RESTRICTED" }; searchable: boolean } } }) => {
        assert.equal(where.asset.visibility?.not, "RESTRICTED");
        return [{ tagId: "tag_public", _count: { tagId: 2 } }];
      }
    },
    tag: {
      count: async ({
        where
      }: {
        where: { assets: { some: { asset: { visibility?: { not: "RESTRICTED" }; searchable: boolean } } } };
      }) => {
        assert.equal(where.assets.some.asset.visibility?.not, "RESTRICTED");
        return 1;
      },
      findMany: async () => [{ id: "tag_public", name: "公开" }]
    }
  } as never;

  const discovery = createDeliveryDiscovery({
    prisma,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => false,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.listTopTags(1, 20, { viewerUserId: "user_public" });
  assert.equal(result.total, 1);
  assert.deepEqual(result.items, [{ tagId: "tag_public", name: "公开", count: 2 }]);
});

test("discovery: public viewer tag assets exclude only restricted assets", async () => {
  const prisma = {
    asset: {
      count: async ({ where }: { where: { visibility?: { not: "RESTRICTED" } } }) => {
        assert.equal(where.visibility?.not, "RESTRICTED");
        return 1;
      },
      findMany: async ({ where }: { where: { visibility?: { not: "RESTRICTED" } } }) => {
        assert.equal(where.visibility?.not, "RESTRICTED");
        return [
          {
            id: "asset_1",
            title: "Protected via tag",
            description: "Visible",
            shareCode: "share_1",
            uploadBatches: [{ userId: "publisher_1" }]
          }
        ];
      }
    },
    event: {
      create: async () => undefined
    }
  } as never;

  const discovery = createDeliveryDiscovery({
    prisma,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => false,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.listAssetsByTagId("user_public", "tag_1", 1, 10);
  assert.equal(result.total, 1);
  assert.deepEqual(result.items.map((item) => item.assetId), ["asset_1"]);
});

test("discovery: listAssetsByTagId prefers projectId scope then falls back to tenantId", async () => {
  const countWheres: Array<Record<string, unknown>> = [];
  const findManyWheres: Array<Record<string, unknown>> = [];
  const eventCreates: Array<Record<string, unknown>> = [];

  const prisma = {
    asset: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        countWheres.push(where);
        return Object.prototype.hasOwnProperty.call(where, "projectId") ? 0 : 1;
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        findManyWheres.push(where);
        return Object.prototype.hasOwnProperty.call(where, "projectId")
          ? []
          : [
              {
                id: "asset_fallback",
                title: "Tag fallback",
                description: "Visible",
                shareCode: "share_fallback",
                uploadBatches: [{ userId: "publisher_1" }]
              }
            ];
      }
    },
    event: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        eventCreates.push(data);
        return undefined;
      }
    }
  } as never;

  const discovery = createDeliveryDiscovery({
    prisma,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => false,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.listAssetsByTagId("user_public", "tag_1", 1, 10);
  assert.equal(result.total, 1);
  assert.deepEqual(result.items.map((item) => item.assetId), ["asset_fallback"]);

  assert.equal(countWheres.length, 2);
  assert.equal(findManyWheres.length, 2);
  assert.equal(countWheres[0]?.projectId, "tenant_1");
  assert.equal(findManyWheres[0]?.projectId, "tenant_1");
  assert.equal((countWheres[1] as any)?.tenantId, "tenant_1");
  assert.equal((findManyWheres[1] as any)?.tenantId, "tenant_1");

  assert.equal(eventCreates.length, 1);
  assert.equal(eventCreates[0]?.tenantId, "tenant_1");
  assert.equal(eventCreates[0]?.projectId, "tenant_1");
});

test("discovery: getTagById falls back via assetTag link when direct tag lookup misses", async () => {
  const tagFindFirstCalls: Array<Record<string, unknown>> = [];
  const assetTagFindFirstCalls: Array<Record<string, unknown>> = [];

  const discovery = createDeliveryDiscovery({
    prisma: {
      tag: {
        findFirst: async (args: Record<string, unknown>) => {
          tagFindFirstCalls.push(args);
          return null;
        }
      },
      assetTag: {
        findFirst: async (args: Record<string, unknown>) => {
          assetTagFindFirstCalls.push(args);
          return assetTagFindFirstCalls.length === 1 ? null : { tag: { id: "tag_1", name: "教程" } };
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => true,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.getTagById("tag_1");
  assert.deepEqual(result, { tagId: "tag_1", name: "教程" });

  assert.deepEqual(tagFindFirstCalls, [{ where: { id: "tag_1", tenantId: "tenant_1" }, select: { id: true, name: true } }]);
  assert.equal(assetTagFindFirstCalls.length, 2);
  assert.equal((assetTagFindFirstCalls[0] as any)?.where?.asset?.projectId, "tenant_1");
  assert.equal((assetTagFindFirstCalls[1] as any)?.where?.asset?.tenantId, "tenant_1");
});

test("discovery: getTagByName falls back via assetTag link when direct tag lookup misses", async () => {
  const tagFindUniqueCalls: Array<Record<string, unknown>> = [];
  const assetTagFindFirstCalls: Array<Record<string, unknown>> = [];

  const discovery = createDeliveryDiscovery({
    prisma: {
      tag: {
        findUnique: async (args: Record<string, unknown>) => {
          tagFindUniqueCalls.push(args);
          return null;
        }
      },
      assetTag: {
        findFirst: async (args: Record<string, unknown>) => {
          assetTagFindFirstCalls.push(args);
          return { tag: { id: "tag_1", name: "教程" } };
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => true,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.getTagByName("#教程");
  assert.deepEqual(result, { tagId: "tag_1", name: "教程" });

  assert.deepEqual(tagFindUniqueCalls, [{ where: { tenantId_name: { tenantId: "tenant_1", name: "教程" } }, select: { id: true, name: true } }]);
  assert.equal(assetTagFindFirstCalls.length, 1);
  assert.equal((assetTagFindFirstCalls[0] as any)?.where?.asset?.projectId, "tenant_1");
  assert.equal((assetTagFindFirstCalls[0] as any)?.where?.tag?.name, "教程");
});

test("discovery: public viewer community list excludes only restricted assets", async () => {
  const prisma = {
    uploadBatch: {
      count: async ({ where }: { where: { asset: { visibility?: { not: "RESTRICTED" } } } }) => {
        assert.equal(where.asset.visibility?.not, "RESTRICTED");
        assert.equal((where.asset as any).projectId, "tenant_1");
        return 1;
      },
      findMany: async ({ where }: { where: { asset: { visibility?: { not: "RESTRICTED" } } } }) => {
        assert.equal(where.asset.visibility?.not, "RESTRICTED");
        assert.equal((where.asset as any).projectId, "tenant_1");
        return [
          {
            id: "batch_1",
            assetId: "asset_1",
            userId: "publisher_1",
            asset: { shareCode: "share_1", title: "Protected list item", description: "Visible" },
            items: [{ id: "item_1" }]
          }
        ];
      }
    }
  } as never;

  const discovery = createDeliveryDiscovery({
    prisma,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => false,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.listProjectBatches("user_public", 1, 10);
  assert.equal(result.total, 1);
  assert.deepEqual(result.items.map((item) => item.assetId), ["asset_1"]);
});

test("discovery: listProjectBatches prefers projectId and falls back to tenantId", async () => {
  const countCalls: Array<Record<string, unknown>> = [];
  const findManyCalls: Array<Record<string, unknown>> = [];
  const discovery = createDeliveryDiscovery({
    prisma: {
      uploadBatch: {
        count: async (args: Record<string, unknown>) => {
          countCalls.push(args);
          return countCalls.length === 1 ? 0 : 1;
        },
        findMany: async (args: Record<string, unknown>) => {
          findManyCalls.push(args);
          return findManyCalls.length === 1
            ? []
            : [
                {
                  assetId: "asset_1",
                  userId: "publisher_1",
                  id: "batch_1",
                  items: [{ id: "item_1" }],
                  asset: {
                    shareCode: "share_1",
                    title: "Asset title",
                    description: "Asset desc"
                  }
                }
              ];
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => true,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.listProjectBatches("user_public", 1, 10);

  assert.equal(result.total, 1);
  assert.deepEqual(result.items.map((item) => item.assetId), ["asset_1"]);
  assert.deepEqual(countCalls, [
    { where: { projectId: "tenant_1", status: "COMMITTED" } },
    { where: { tenantId: "tenant_1", status: "COMMITTED" } }
  ]);
  assert.deepEqual(findManyCalls, [
    {
      where: { projectId: "tenant_1", status: "COMMITTED" },
      orderBy: { createdAt: "desc" },
      take: 10,
      skip: 0,
      include: { asset: true, items: { select: { id: true } } }
    },
    {
      where: { tenantId: "tenant_1", status: "COMMITTED" },
      orderBy: { createdAt: "desc" },
      take: 10,
      skip: 0,
      include: { asset: true, items: { select: { id: true } } }
    }
  ]);
});

test("discovery: listProjectBatches filters by collectionId with correct asset scope", async () => {
  const countCalls: Array<Record<string, unknown>> = [];
  const findManyCalls: Array<Record<string, unknown>> = [];

  const discovery = createDeliveryDiscovery({
    prisma: {
      uploadBatch: {
        count: async (args: Record<string, unknown>) => {
          countCalls.push(args);
          return countCalls.length === 1 ? 0 : 1;
        },
        findMany: async (args: Record<string, unknown>) => {
          findManyCalls.push(args);
          return findManyCalls.length === 1
            ? []
            : [
                {
                  assetId: "asset_1",
                  userId: "publisher_1",
                  id: "batch_1",
                  items: [{ id: "item_1" }],
                  asset: { shareCode: "share_1", title: "Asset title", description: "Asset desc" }
                }
              ];
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => false,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.listProjectBatches("user_public", 1, 10, { collectionId: "collection_1" });

  assert.equal(result.total, 1);
  assert.deepEqual(result.items.map((item) => item.assetId), ["asset_1"]);

  assert.equal(countCalls.length, 2);
  assert.equal(findManyCalls.length, 2);

  assert.equal((countCalls[0] as any)?.where?.projectId, "tenant_1");
  assert.equal((countCalls[0] as any)?.where?.asset?.collectionId, "collection_1");
  assert.equal((countCalls[0] as any)?.where?.asset?.projectId, "tenant_1");
  assert.equal((countCalls[0] as any)?.where?.asset?.visibility?.not, "RESTRICTED");

  assert.equal((countCalls[1] as any)?.where?.tenantId, "tenant_1");
  assert.equal((countCalls[1] as any)?.where?.asset?.collectionId, "collection_1");
  assert.equal((countCalls[1] as any)?.where?.asset?.tenantId, "tenant_1");
  assert.equal((countCalls[1] as any)?.where?.asset?.visibility?.not, "RESTRICTED");

  assert.equal((findManyCalls[0] as any)?.where?.asset?.projectId, "tenant_1");
  assert.equal((findManyCalls[1] as any)?.where?.asset?.tenantId, "tenant_1");
});

test("discovery: listProjectBatches filters by date with correct range and scope fallback", async () => {
  const countCalls: Array<Record<string, unknown>> = [];
  const findManyCalls: Array<Record<string, unknown>> = [];

  const dayStart = new Date("2026-04-21T00:00:00.000Z");
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const discovery = createDeliveryDiscovery({
    prisma: {
      uploadBatch: {
        count: async (args: Record<string, unknown>) => {
          countCalls.push(args);
          return countCalls.length === 1 ? 0 : 1;
        },
        findMany: async (args: Record<string, unknown>) => {
          findManyCalls.push(args);
          return findManyCalls.length === 1
            ? []
            : [
                {
                  assetId: "asset_1",
                  userId: "publisher_1",
                  id: "batch_1",
                  items: [{ id: "item_1" }],
                  asset: { shareCode: "share_1", title: "Asset title", description: "Asset desc" }
                }
              ];
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => false,
    startOfLocalDay: () => dayStart
  });

  const result = await discovery.listProjectBatches("user_public", 1, 10, { date: new Date("2026-04-21T12:34:56.000Z") });

  assert.equal(result.total, 1);
  assert.deepEqual(result.items.map((item) => item.assetId), ["asset_1"]);

  assert.equal(countCalls.length, 2);
  assert.equal(findManyCalls.length, 2);

  for (const call of countCalls) {
    const where = (call as any).where ?? {};
    assert.equal(where.createdAt.gte.getTime(), dayStart.getTime());
    assert.equal(where.createdAt.lt.getTime(), dayEnd.getTime());
    assert.equal(where.asset.visibility.not, "RESTRICTED");
  }
  assert.equal((countCalls[0] as any)?.where?.projectId, "tenant_1");
  assert.equal((countCalls[0] as any)?.where?.asset?.projectId, "tenant_1");
  assert.equal((countCalls[1] as any)?.where?.tenantId, "tenant_1");
  assert.equal((countCalls[1] as any)?.where?.asset?.tenantId, "tenant_1");

  for (const call of findManyCalls) {
    const where = (call as any).where ?? {};
    assert.equal(where.createdAt.gte.getTime(), dayStart.getTime());
    assert.equal(where.createdAt.lt.getTime(), dayEnd.getTime());
    assert.equal(where.asset.visibility.not, "RESTRICTED");
  }
  assert.equal((findManyCalls[0] as any)?.where?.asset?.projectId, "tenant_1");
  assert.equal((findManyCalls[1] as any)?.where?.asset?.tenantId, "tenant_1");
});

test("discovery: listUserBatches prefers projectId and falls back to tenantId", async () => {
  const countCalls: Array<Record<string, unknown>> = [];
  const findManyCalls: Array<Record<string, unknown>> = [];
  const discovery = createDeliveryDiscovery({
    prisma: {
      uploadBatch: {
        count: async (args: Record<string, unknown>) => {
          countCalls.push(args);
          return countCalls.length === 1 ? 0 : 1;
        },
        findMany: async (args: Record<string, unknown>) => {
          findManyCalls.push(args);
          return findManyCalls.length === 1
            ? []
            : [
                {
                  assetId: "asset_1",
                  userId: "user_1",
                  id: "batch_1",
                  items: [{ id: "item_1" }],
                  asset: {
                    shareCode: "share_1",
                    title: "Asset title",
                    description: "Asset desc"
                  }
                }
              ];
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => true,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.listUserBatches("user_1", 1, 10);

  assert.equal(result.total, 1);
  assert.deepEqual(result.items.map((item) => item.assetId), ["asset_1"]);
  assert.deepEqual(countCalls, [
    { where: { projectId: "tenant_1", status: "COMMITTED", userId: "user_1" } },
    { where: { tenantId: "tenant_1", status: "COMMITTED", userId: "user_1" } }
  ]);
  assert.deepEqual(findManyCalls, [
    {
      where: { projectId: "tenant_1", status: "COMMITTED", userId: "user_1" },
      orderBy: { createdAt: "desc" },
      take: 10,
      skip: 0,
      include: { asset: true, items: { select: { id: true } } }
    },
    {
      where: { tenantId: "tenant_1", status: "COMMITTED", userId: "user_1" },
      orderBy: { createdAt: "desc" },
      take: 10,
      skip: 0,
      include: { asset: true, items: { select: { id: true } } }
    }
  ]);
});

test("discovery: listUserBatches filters by collectionId with correct asset scope", async () => {
  const countCalls: Array<Record<string, unknown>> = [];
  const findManyCalls: Array<Record<string, unknown>> = [];

  const discovery = createDeliveryDiscovery({
    prisma: {
      uploadBatch: {
        count: async (args: Record<string, unknown>) => {
          countCalls.push(args);
          return countCalls.length === 1 ? 0 : 1;
        },
        findMany: async (args: Record<string, unknown>) => {
          findManyCalls.push(args);
          return findManyCalls.length === 1
            ? []
            : [
                {
                  assetId: "asset_1",
                  userId: "user_1",
                  id: "batch_1",
                  items: [{ id: "item_1" }],
                  asset: { shareCode: "share_1", title: "Asset title", description: "Asset desc" }
                }
              ];
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => true,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.listUserBatches("user_1", 1, 10, { collectionId: "collection_1" });

  assert.equal(result.total, 1);
  assert.deepEqual(result.items.map((item) => item.assetId), ["asset_1"]);

  assert.equal(countCalls.length, 2);
  assert.equal(findManyCalls.length, 2);

  assert.equal((countCalls[0] as any)?.where?.projectId, "tenant_1");
  assert.equal((countCalls[0] as any)?.where?.asset?.collectionId, "collection_1");
  assert.equal((countCalls[0] as any)?.where?.asset?.projectId, "tenant_1");

  assert.equal((countCalls[1] as any)?.where?.tenantId, "tenant_1");
  assert.equal((countCalls[1] as any)?.where?.asset?.collectionId, "collection_1");
  assert.equal((countCalls[1] as any)?.where?.asset?.tenantId, "tenant_1");

  assert.equal((findManyCalls[0] as any)?.where?.asset?.projectId, "tenant_1");
  assert.equal((findManyCalls[1] as any)?.where?.asset?.tenantId, "tenant_1");
});

test("discovery: listUserBatches filters by date with correct range and scope fallback", async () => {
  const countCalls: Array<Record<string, unknown>> = [];
  const findManyCalls: Array<Record<string, unknown>> = [];

  const dayStart = new Date("2026-04-21T00:00:00.000Z");
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const discovery = createDeliveryDiscovery({
    prisma: {
      uploadBatch: {
        count: async (args: Record<string, unknown>) => {
          countCalls.push(args);
          return countCalls.length === 1 ? 0 : 1;
        },
        findMany: async (args: Record<string, unknown>) => {
          findManyCalls.push(args);
          return findManyCalls.length === 1
            ? []
            : [
                {
                  assetId: "asset_1",
                  userId: "user_1",
                  id: "batch_1",
                  items: [{ id: "item_1" }],
                  asset: { shareCode: "share_1", title: "Asset title", description: "Asset desc" }
                }
              ];
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => true,
    startOfLocalDay: () => dayStart
  });

  const result = await discovery.listUserBatches("user_1", 1, 10, { date: new Date("2026-04-21T12:34:56.000Z") });

  assert.equal(result.total, 1);
  assert.deepEqual(result.items.map((item) => item.assetId), ["asset_1"]);

  assert.equal(countCalls.length, 2);
  assert.equal(findManyCalls.length, 2);

  for (const call of countCalls) {
    const where = (call as any).where ?? {};
    assert.equal(where.createdAt.gte.getTime(), dayStart.getTime());
    assert.equal(where.createdAt.lt.getTime(), dayEnd.getTime());
  }
  assert.equal((countCalls[0] as any)?.where?.projectId, "tenant_1");
  assert.equal((countCalls[1] as any)?.where?.tenantId, "tenant_1");

  for (const call of findManyCalls) {
    const where = (call as any).where ?? {};
    assert.equal(where.createdAt.gte.getTime(), dayStart.getTime());
    assert.equal(where.createdAt.lt.getTime(), dayEnd.getTime());
  }
  assert.equal((findManyCalls[0] as any)?.where?.projectId, "tenant_1");
  assert.equal((findManyCalls[1] as any)?.where?.tenantId, "tenant_1");
});

test("discovery: listUserOpenHistory prefers projectId and falls back to tenantId", async () => {
  const findManyCalls: Array<Record<string, unknown>> = [];
  const groupByCalls: Array<Record<string, unknown>> = [];
  const assetCalls: Array<Record<string, unknown>> = [];

  const openedAt = new Date("2026-04-21T10:00:00.000Z");

  const discovery = createDeliveryDiscovery({
    prisma: {
      event: {
        findMany: async (args: Record<string, unknown>) => {
          findManyCalls.push(args);
          return findManyCalls.length === 1 ? [] : [{ assetId: "asset_1" }];
        },
        groupBy: async (args: Record<string, unknown>) => {
          groupByCalls.push(args);
          return groupByCalls.length === 1 ? [] : [{ assetId: "asset_1", _max: { createdAt: openedAt } }];
        }
      },
      asset: {
        findMany: async (args: Record<string, unknown>) => {
          assetCalls.push(args);
          return assetCalls.length === 1
            ? []
            : [
                {
                  id: "asset_1",
                  title: "Asset title",
                  description: "Asset desc",
                  shareCode: "share_1",
                  uploadBatches: [{ userId: "publisher_1" }]
                }
              ];
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => true,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.listUserOpenHistory("user_1", 1, 10);

  assert.equal(result.total, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.assetId, "asset_1");
  assert.equal(result.items[0]?.title, "Asset title");
  assert.equal(result.items[0]?.openedAt.getTime(), openedAt.getTime());

  assert.deepEqual(findManyCalls.map((call) => (call as any).where), [
    { projectId: "tenant_1", userId: "user_1", type: "OPEN", assetId: { not: null } },
    { tenantId: "tenant_1", userId: "user_1", type: "OPEN", assetId: { not: null } }
  ]);
  assert.deepEqual(groupByCalls.map((call) => (call as any).where), [
    { projectId: "tenant_1", userId: "user_1", type: "OPEN", assetId: { not: null } },
    { tenantId: "tenant_1", userId: "user_1", type: "OPEN", assetId: { not: null } }
  ]);
  assert.deepEqual(assetCalls.map((call) => (call as any).where), [
    { id: { in: ["asset_1"] }, projectId: "tenant_1" },
    { id: { in: ["asset_1"] }, tenantId: "tenant_1" }
  ]);
});

test("discovery: listUserOpenHistory keeps since filter across project-first and fallback", async () => {
  const findManyCalls: Array<Record<string, unknown>> = [];
  const groupByCalls: Array<Record<string, unknown>> = [];
  const assetCalls: Array<Record<string, unknown>> = [];

  const openedAt = new Date("2026-04-21T10:00:00.000Z");
  const since = new Date("2026-04-20T00:00:00.000Z");

  const discovery = createDeliveryDiscovery({
    prisma: {
      event: {
        findMany: async (args: Record<string, unknown>) => {
          findManyCalls.push(args);
          return findManyCalls.length === 1 ? [] : [{ assetId: "asset_1" }];
        },
        groupBy: async (args: Record<string, unknown>) => {
          groupByCalls.push(args);
          return groupByCalls.length === 1 ? [] : [{ assetId: "asset_1", _max: { createdAt: openedAt } }];
        }
      },
      asset: {
        findMany: async (args: Record<string, unknown>) => {
          assetCalls.push(args);
          return assetCalls.length === 1
            ? []
            : [
                {
                  id: "asset_1",
                  title: "Asset title",
                  description: "Asset desc",
                  shareCode: "share_1",
                  uploadBatches: [{ userId: "publisher_1" }]
                }
              ];
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => true,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.listUserOpenHistory("user_1", 1, 10, { since });
  assert.equal(result.total, 1);
  assert.equal(result.items.length, 1);

  assert.deepEqual(findManyCalls.map((call) => (call as any).where), [
    { projectId: "tenant_1", userId: "user_1", type: "OPEN", assetId: { not: null }, createdAt: { gte: since } },
    { tenantId: "tenant_1", userId: "user_1", type: "OPEN", assetId: { not: null }, createdAt: { gte: since } }
  ]);
  assert.deepEqual(groupByCalls.map((call) => (call as any).where), [
    { projectId: "tenant_1", userId: "user_1", type: "OPEN", assetId: { not: null }, createdAt: { gte: since } },
    { tenantId: "tenant_1", userId: "user_1", type: "OPEN", assetId: { not: null }, createdAt: { gte: since } }
  ]);
  assert.deepEqual(assetCalls.map((call) => (call as any).where), [
    { id: { in: ["asset_1"] }, projectId: "tenant_1" },
    { id: { in: ["asset_1"] }, tenantId: "tenant_1" }
  ]);
});

test("discovery: public viewer likes exclude only restricted assets", async () => {
  const prisma = {
    assetLike: {
      count: async ({ where }: { where: { asset: { visibility?: { not: "RESTRICTED" } } } }) => {
        assert.equal(where.asset.visibility?.not, "RESTRICTED");
        return 1;
      },
      findMany: async ({ where }: { where: { asset: { visibility?: { not: "RESTRICTED" } } } }) => {
        assert.equal(where.asset.visibility?.not, "RESTRICTED");
        return [
          {
            assetId: "asset_1",
            createdAt: new Date("2026-04-15T00:00:00.000Z"),
            asset: {
              title: "Protected liked item",
              description: "Visible",
              shareCode: "share_1",
              uploadBatches: [{ userId: "publisher_1" }]
            }
          }
        ];
      }
    }
  } as never;

  const discovery = createDeliveryDiscovery({
    prisma,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => false,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.listUserLikedAssets("user_public", 1, 10);
  assert.equal(result.total, 1);
  assert.deepEqual(result.items.map((item) => item.assetId), ["asset_1"]);
});

test("discovery: listUserLikedAssets prefers projectId and falls back to tenantId", async () => {
  const countWheres: Array<Record<string, unknown>> = [];
  const findManyWheres: Array<Record<string, unknown>> = [];

  const discovery = createDeliveryDiscovery({
    prisma: {
      assetLike: {
        count: async ({ where }: { where: Record<string, unknown> }) => {
          countWheres.push(where);
          const assetWhere = (where as any)?.asset ?? {};
          return Object.prototype.hasOwnProperty.call(assetWhere, "projectId") ? 0 : 1;
        },
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          findManyWheres.push(where);
          const assetWhere = (where as any)?.asset ?? {};
          return Object.prototype.hasOwnProperty.call(assetWhere, "projectId")
            ? []
            : [
                {
                  assetId: "asset_1",
                  createdAt: new Date("2026-04-15T00:00:00.000Z"),
                  asset: {
                    title: "Liked",
                    description: "Visible",
                    shareCode: "share_1",
                    uploadBatches: [{ userId: "publisher_1" }]
                  }
                }
              ];
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => false,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.listUserLikedAssets("user_public", 1, 10);
  assert.equal(result.total, 1);
  assert.deepEqual(result.items.map((item) => item.assetId), ["asset_1"]);

  assert.equal(countWheres.length, 2);
  assert.equal(findManyWheres.length, 2);
  assert.equal((countWheres[0] as any)?.asset?.projectId, "tenant_1");
  assert.equal((findManyWheres[0] as any)?.asset?.projectId, "tenant_1");
  assert.equal((countWheres[1] as any)?.asset?.tenantId, "tenant_1");
  assert.equal((findManyWheres[1] as any)?.asset?.tenantId, "tenant_1");
});

test("discovery: listUserLikedAssets keeps since filter across project-first and fallback", async () => {
  const countWheres: Array<Record<string, unknown>> = [];
  const findManyWheres: Array<Record<string, unknown>> = [];

  const since = new Date("2026-04-20T00:00:00.000Z");

  const discovery = createDeliveryDiscovery({
    prisma: {
      assetLike: {
        count: async ({ where }: { where: Record<string, unknown> }) => {
          countWheres.push(where);
          const assetWhere = (where as any)?.asset ?? {};
          return Object.prototype.hasOwnProperty.call(assetWhere, "projectId") ? 0 : 1;
        },
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          findManyWheres.push(where);
          const assetWhere = (where as any)?.asset ?? {};
          return Object.prototype.hasOwnProperty.call(assetWhere, "projectId")
            ? []
            : [
                {
                  assetId: "asset_1",
                  createdAt: new Date("2026-04-21T00:00:00.000Z"),
                  asset: {
                    title: "Liked",
                    description: "Visible",
                    shareCode: "share_1",
                    uploadBatches: [{ userId: "publisher_1" }]
                  }
                }
              ];
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => false,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.listUserLikedAssets("user_public", 1, 10, { since });
  assert.equal(result.total, 1);
  assert.deepEqual(result.items.map((item) => item.assetId), ["asset_1"]);

  assert.equal(countWheres.length, 2);
  assert.equal(findManyWheres.length, 2);

  assert.equal((countWheres[0] as any)?.createdAt?.gte?.getTime(), since.getTime());
  assert.equal((findManyWheres[0] as any)?.createdAt?.gte?.getTime(), since.getTime());
  assert.equal((countWheres[0] as any)?.asset?.projectId, "tenant_1");
  assert.equal((findManyWheres[0] as any)?.asset?.projectId, "tenant_1");

  assert.equal((countWheres[1] as any)?.createdAt?.gte?.getTime(), since.getTime());
  assert.equal((findManyWheres[1] as any)?.createdAt?.gte?.getTime(), since.getTime());
  assert.equal((countWheres[1] as any)?.asset?.tenantId, "tenant_1");
  assert.equal((findManyWheres[1] as any)?.asset?.tenantId, "tenant_1");
});

test("social: public viewer comments history excludes only restricted assets", async () => {
  const social = createDeliverySocial({
    prisma: {
      assetComment: {
        count: async ({ where }: { where: { asset?: { visibility?: { not: "RESTRICTED" } } } }) => {
          assert.equal(where.asset?.visibility?.not, "RESTRICTED");
          return 1;
        },
        findMany: async ({ where }: { where: { asset?: { visibility?: { not: "RESTRICTED" } } } }) => {
          assert.equal(where.asset?.visibility?.not, "RESTRICTED");
          return [
            {
              id: "comment_1",
              assetId: "asset_1",
              content: "nice",
              replyToCommentId: null,
              createdAt: new Date("2026-04-15T00:00:00.000Z"),
              replyTo: null,
              asset: {
                title: "Protected comment asset",
                description: "Visible",
                shareCode: "share_1",
                uploadBatches: [{ userId: "publisher_1" }]
              }
            }
          ];
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => false,
    getProjectAssetAccess: async () => ({ status: "ok", asset: { id: "asset_1", visibility: "PROTECTED" } })
  });

  const result = await social.listUserComments("user_public", "comment", 1, 10);
  assert.equal(result.total, 1);
  assert.deepEqual(result.items.map((item: { assetId: string }) => item.assetId), ["asset_1"]);
});

test("social: listAssetComments prefers projectId and falls back to tenantId", async () => {
  const countCalls: Array<Record<string, unknown>> = [];
  const findManyCalls: Array<Record<string, unknown>> = [];
  const social = createDeliverySocial({
    prisma: {
      assetComment: {
        count: async (args: Record<string, unknown>) => {
          countCalls.push(args);
          const where = (args as any).where ?? {};
          return where.asset?.projectId ? 0 : 1;
        },
        findMany: async (args: Record<string, unknown>) => {
          findManyCalls.push(args);
          const where = (args as any).where ?? {};
          return where.asset?.projectId
            ? []
            : [
                {
                  id: "comment_1",
                  authorUserId: "user_1",
                  authorName: "User",
                  content: "hello",
                  replyToCommentId: null,
                  replyTo: null,
                  createdAt: new Date("2026-04-22T00:00:00.000Z")
                }
              ];
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => true,
    getProjectAssetAccess: async () => ({ status: "ok", asset: { id: "asset_1", visibility: "PUBLIC" } })
  });

  const result = await social.listAssetComments("user_1", "asset_1", 1, 10);
  assert.equal(result.total, 1);
  assert.equal(result.items[0]?.id, "comment_1");
  assert.ok(countCalls.some((c) => (c as any).where?.asset?.projectId === "tenant_1"));
  assert.ok(countCalls.some((c) => (c as any).where?.tenantId === "tenant_1"));
  assert.ok(findManyCalls.some((c) => (c as any).where?.asset?.projectId === "tenant_1"));
  assert.ok(findManyCalls.some((c) => (c as any).where?.tenantId === "tenant_1"));
});

test("social: asset like queries prefer projectId and fall back to tenantId", async () => {
  const countCalls: Array<Record<string, unknown>> = [];
  const findFirstCalls: Array<Record<string, unknown>> = [];
  const social = createDeliverySocial({
    prisma: {
      assetLike: {
        count: async (args: Record<string, unknown>) => {
          countCalls.push(args);
          const where = (args as any).where ?? {};
          return where.asset?.projectId ? 0 : 2;
        },
        findFirst: async (args: Record<string, unknown>) => {
          findFirstCalls.push(args);
          const where = (args as any).where ?? {};
          return where.asset?.projectId ? null : { id: "like_1" };
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => true,
    getProjectAssetAccess: async () => ({ status: "ok", asset: { id: "asset_1", visibility: "PUBLIC" } })
  });

  const likeCount = await social.getAssetLikeCount("user_1", "asset_1");
  const liked = await social.hasAssetLiked("user_1", "asset_1");
  assert.equal(likeCount, 2);
  assert.equal(liked, true);
  assert.ok(countCalls.some((c) => (c as any).where?.asset?.projectId === "tenant_1"));
  assert.ok(countCalls.some((c) => (c as any).where?.tenantId === "tenant_1"));
  assert.ok(findFirstCalls.some((c) => (c as any).where?.asset?.projectId === "tenant_1"));
  assert.ok(findFirstCalls.some((c) => (c as any).where?.tenantId === "tenant_1"));
});

test("social: toggleAssetCommentLike prefers project-linked reads and falls back to tenantId", async () => {
  const likeFindCalls: Array<Record<string, unknown>> = [];
  const likeCountCalls: Array<Record<string, unknown>> = [];
  const social = createDeliverySocial({
    prisma: {
      assetComment: {
        findFirst: async (args: Record<string, unknown>) => {
          const where = (args as any).where ?? {};
          return where.asset?.projectId
            ? null
            : { id: "comment_1", assetId: "asset_1", authorUserId: "user_2", authorName: "User" };
        }
      },
      assetCommentLike: {
        findFirst: async (args: Record<string, unknown>) => {
          likeFindCalls.push(args);
          const where = (args as any).where ?? {};
          return where.comment?.asset?.projectId ? null : { id: "like_1" };
        },
        count: async (args: Record<string, unknown>) => {
          likeCountCalls.push(args);
          const where = (args as any).where ?? {};
          return where.comment?.asset?.projectId ? 0 : 2;
        },
        delete: async () => ({}),
        create: async () => ({})
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => true,
    getProjectAssetAccess: async () => ({ status: "ok", asset: { id: "asset_1", visibility: "PUBLIC" } })
  });

  const result = await social.toggleAssetCommentLike("user_1", "comment_1");
  assert.equal(result.ok, true);
  assert.ok(likeFindCalls.some((c) => (c as any).where?.comment?.asset?.projectId === "tenant_1"));
  assert.ok(likeFindCalls.some((c) => (c as any).where?.tenantId === "tenant_1"));
  assert.ok(likeCountCalls.some((c) => (c as any).where?.comment?.asset?.projectId === "tenant_1"));
  assert.ok(likeCountCalls.some((c) => (c as any).where?.tenantId === "tenant_1"));
});

test("social: toggleAssetLike prefers project-linked reads and falls back to tenantId", async () => {
  const findCalls: Array<Record<string, unknown>> = [];
  const countCalls: Array<Record<string, unknown>> = [];
  const social = createDeliverySocial({
    prisma: {
      assetLike: {
        findFirst: async (args: Record<string, unknown>) => {
          findCalls.push(args);
          const where = (args as any).where ?? {};
          return where.asset?.projectId ? null : { id: "like_1" };
        },
        count: async (args: Record<string, unknown>) => {
          countCalls.push(args);
          const where = (args as any).where ?? {};
          return where.asset?.projectId ? 0 : 1;
        },
        delete: async () => ({}),
        create: async () => ({})
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => true,
    getProjectAssetAccess: async () => ({ status: "ok", asset: { id: "asset_1", visibility: "PUBLIC" } })
  });

  const result = await social.toggleAssetLike("user_1", "asset_1");
  assert.equal(result.ok, true);
  assert.ok(findCalls.some((c) => (c as any).where?.asset?.projectId === "tenant_1"));
  assert.ok(findCalls.some((c) => (c as any).where?.tenantId === "tenant_1"));
  assert.ok(countCalls.some((c) => (c as any).where?.asset?.projectId === "tenant_1"));
  assert.ok(countCalls.some((c) => (c as any).where?.tenantId === "tenant_1"));
});

test("social: addAssetComment reply target lookup prefers project-linked reads and falls back to tenantId", async () => {
  const assetCalls: Array<Record<string, unknown>> = [];
  const batchCalls: Array<Record<string, unknown>> = [];
  const replyCalls: Array<Record<string, unknown>> = [];
  const social = createDeliverySocial({
    prisma: {
      asset: {
        findFirst: async (args: Record<string, unknown>) => {
          assetCalls.push(args);
          const where = (args as any).where ?? {};
          return where.projectId ? null : { title: "Asset", shareCode: "share_1" };
        }
      },
      uploadBatch: {
        findFirst: async (args: Record<string, unknown>) => {
          batchCalls.push(args);
          const where = (args as any).where ?? {};
          return where.projectId ? null : { userId: "publisher_1" };
        }
      },
      assetComment: {
        findFirst: async (args: Record<string, unknown>) => {
          replyCalls.push(args);
          const where = (args as any).where ?? {};
          return where.asset?.projectId ? null : { id: "comment_1", authorUserId: "author_1" };
        },
        create: async () => ({ id: "comment_new" })
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => true,
    getProjectAssetAccess: async () => ({ status: "ok", asset: { id: "asset_1", visibility: "PUBLIC" } })
  });

  const result = await social.addAssetComment("user_1", "asset_1", {
    authorName: "User",
    content: "hello",
    replyToCommentId: "comment_1"
  });
  assert.equal(result.ok, true);
  assert.ok(assetCalls.some((c) => (c as any).where?.projectId === "tenant_1"));
  assert.ok(assetCalls.some((c) => (c as any).where?.tenantId === "tenant_1"));
  assert.ok(batchCalls.some((c) => (c as any).where?.projectId === "tenant_1"));
  assert.ok(batchCalls.some((c) => (c as any).where?.tenantId === "tenant_1"));
  assert.ok(replyCalls.some((c) => (c as any).where?.asset?.projectId === "tenant_1"));
  assert.ok(replyCalls.some((c) => (c as any).where?.tenantId === "tenant_1"));
});

test("social: project-oriented runtime id is used for asset likes", async () => {
  let runtimeProjectCalls = 0;
  const social = createDeliverySocial({
    prisma: {
      assetLike: {
        count: async () => 2
      }
    } as never,
    getRuntimeProjectId: async () => {
      runtimeProjectCalls += 1;
      return "tenant_1";
    },
    isProjectMemberSafe: async () => true,
    getProjectAssetAccess: async () => ({ status: "ok", asset: { id: "asset_1", visibility: "PUBLIC" } })
  });

  const count = await social.getAssetLikeCount("user_1", "asset_1");
  assert.equal(count, 2);
  assert.equal(runtimeProjectCalls, 1);
});

test("storage: uses project-oriented runtime id dependency", async () => {
  let runtimeProjectCalls = 0;
  const calls: Array<Record<string, unknown>> = [];
  const storage = createProjectStorage(
    {
      userPreference: {
        findUnique: async (args: Record<string, unknown>) => {
          calls.push(args);
          return { value: "v1" };
        }
      },
      tenantSetting: {
        findUnique: async () => null
      }
    } as never,
    async () => {
      runtimeProjectCalls += 1;
      return "tenant_1";
    }
  );

  const value = await storage.getPreference("user_1", "key_1");
  assert.equal(value, "v1");
  assert.equal(runtimeProjectCalls, 1);
  assert.deepEqual(calls, [
    {
      where: { projectId_tgUserId_key: { projectId: "tenant_1", tgUserId: "user_1", key: "key_1" } },
      select: { value: true }
    }
  ]);
});

test("storage: read path falls back from projectId to tenantId", async () => {
  const preferenceCalls: Array<Record<string, unknown>> = [];
  const settingCalls: Array<Record<string, unknown>> = [];
  const storage = createProjectStorage(
    {
      userPreference: {
        findUnique: async (args: Record<string, unknown>) => {
          preferenceCalls.push(args);
          return preferenceCalls.length === 1 ? null : { value: "pref_v1" };
        }
      },
      tenantSetting: {
        findUnique: async (args: Record<string, unknown>) => {
          settingCalls.push(args);
          return settingCalls.length === 1 ? null : { value: "setting_v1" };
        }
      }
    } as never,
    async () => "tenant_1"
  );

  assert.equal(await storage.getPreference("user_1", "pref_key"), "pref_v1");
  assert.equal(await storage.getSetting("setting_key"), "setting_v1");
  assert.deepEqual(preferenceCalls, [
    {
      where: { projectId_tgUserId_key: { projectId: "tenant_1", tgUserId: "user_1", key: "pref_key" } },
      select: { value: true }
    },
    {
      where: { tenantId_tgUserId_key: { tenantId: "tenant_1", tgUserId: "user_1", key: "pref_key" } },
      select: { value: true }
    }
  ]);
  assert.deepEqual(settingCalls, [
    {
      where: { projectId_key: { projectId: "tenant_1", key: "setting_key" } },
      select: { value: true }
    },
    {
      where: { tenantId_key: { tenantId: "tenant_1", key: "setting_key" } },
      select: { value: true }
    }
  ]);
});

test("storage: dual-writes projectId for settings and preferences", async () => {
  const preferenceCalls: Array<{
    where: { tenantId_tgUserId_key: { tenantId: string; tgUserId: string; key: string } };
    update: { projectId: string; value: string | null };
    create: { tenantId: string; projectId: string; tgUserId: string; key: string; value: string | null };
  }> = [];
  const settingCalls: Array<{
    where: { tenantId_key: { tenantId: string; key: string } };
    update: { projectId: string; value: string | null };
    create: { tenantId: string; projectId: string; key: string; value: string | null };
  }> = [];

  const storage = createProjectStorage(
    {
      userPreference: {
        upsert: async (args: {
          where: { tenantId_tgUserId_key: { tenantId: string; tgUserId: string; key: string } };
          update: { projectId: string; value: string | null };
          create: { tenantId: string; projectId: string; tgUserId: string; key: string; value: string | null };
        }) => {
          preferenceCalls.push(args);
          return {};
        }
      },
      tenantSetting: {
        upsert: async (args: {
          where: { tenantId_key: { tenantId: string; key: string } };
          update: { projectId: string; value: string | null };
          create: { tenantId: string; projectId: string; key: string; value: string | null };
        }) => {
          settingCalls.push(args);
          return {};
        }
      }
    } as never,
    async () => "tenant_1"
  );

  await storage.upsertPreference("user_1", "pref_key", "v1");
  await storage.upsertSetting("setting_key", "v2");

  assert.deepEqual(preferenceCalls.at(-1), {
    where: { tenantId_tgUserId_key: { tenantId: "tenant_1", tgUserId: "user_1", key: "pref_key" } },
    update: { projectId: "tenant_1", value: "v1" },
    create: { tenantId: "tenant_1", projectId: "tenant_1", tgUserId: "user_1", key: "pref_key", value: "v1" }
  });
  assert.deepEqual(settingCalls.at(-1), {
    where: { tenantId_key: { tenantId: "tenant_1", key: "setting_key" } },
    update: { projectId: "tenant_1", value: "v2" },
    create: { tenantId: "tenant_1", projectId: "tenant_1", key: "setting_key", value: "v2" }
  });
});

test("preferences: follow keyword subscriptions prefer projectId and fall back to tenantId", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const preferences = createProjectPreferences({
    prisma: {
      userPreference: {
        findMany: async (args: Record<string, unknown>) => {
          calls.push(args);
          const where = (args as any).where ?? {};
          return where.projectId
            ? []
            : [
                { tgUserId: "user_1", value: '["猫娘","泳装"]' },
                { tgUserId: "user_2", value: '[]' }
              ];
        }
      }
    } as never,
    preferenceKeys: {
      defaultCollectionId: "default_collection_id",
      historyCollectionFilter: "history_collection_filter",
      historyListDate: "history_list_date",
      followKeywords: "follow_keywords",
      notifyFollowEnabled: "notify_follow_enabled",
      notifyCommentEnabled: "notify_comment_enabled",
      notifyState: "notify_state"
    },
    getRuntimeProjectId: async () => "tenant_1",
    getPreference: async () => null,
    upsertPreference: async () => undefined,
    deletePreference: async () => undefined,
    startOfLocalDay: (date) => date,
    formatLocalDate: () => "2026-04-22"
  });

  const rows = await preferences.listFollowKeywordSubscriptions();
  assert.deepEqual(rows, [{ userId: "user_1", keywords: ["猫娘", "泳装"] }]);
  assert.deepEqual(calls, [
    {
      where: { projectId: "tenant_1", key: "follow_keywords" },
      select: { tgUserId: true, value: true }
    },
    {
      where: { tenantId: "tenant_1", key: "follow_keywords" },
      select: { tgUserId: true, value: true }
    }
  ]);
});

test("preferences: notify settings read falls back to tenantId preference row", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const preferences = createProjectPreferences({
    prisma: {
      userPreference: {
        findFirst: async (args: Record<string, unknown>) => {
          calls.push(args);
          const where = (args as any).where ?? {};
          return where.key === "notify_follow_enabled" ? { value: "0" } : { value: "1" };
        }
      }
    } as never,
    preferenceKeys: {
      defaultCollectionId: "default_collection_id",
      historyCollectionFilter: "history_collection_filter",
      historyListDate: "history_list_date",
      followKeywords: "follow_keywords",
      notifyFollowEnabled: "notify_follow_enabled",
      notifyCommentEnabled: "notify_comment_enabled",
      notifyState: "notify_state"
    },
    getRuntimeProjectId: async () => "tenant_1",
    getPreference: async () => null,
    upsertPreference: async () => undefined,
    deletePreference: async () => undefined,
    startOfLocalDay: (date) => date,
    formatLocalDate: () => "2026-04-22"
  });

  const settings = await preferences.getUserNotifySettings("user_1");
  assert.deepEqual(settings, { followEnabled: false, commentEnabled: true });
  assert.ok(calls.some((c) => (c as any).where?.tenantId === "tenant_1"));
});

test("preferences: notification state read falls back to tenantId preference row", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const writes: Array<{ key: string; value: string | null }> = [];
  const preferences = createProjectPreferences({
    prisma: {
      userPreference: {
        findFirst: async (args: Record<string, unknown>) => {
          calls.push(args);
          return { value: '{"follow":{"lastAt":0,"ids":[]}}' };
        }
      }
    } as never,
    preferenceKeys: {
      defaultCollectionId: "default_collection_id",
      historyCollectionFilter: "history_collection_filter",
      historyListDate: "history_list_date",
      followKeywords: "follow_keywords",
      notifyFollowEnabled: "notify_follow_enabled",
      notifyCommentEnabled: "notify_comment_enabled",
      notifyState: "notify_state"
    },
    getRuntimeProjectId: async () => "tenant_1",
    getPreference: async () => null,
    upsertPreference: async (_userId, key, value) => {
      writes.push({ key, value });
    },
    deletePreference: async () => undefined,
    startOfLocalDay: (date) => date,
    formatLocalDate: () => "2026-04-22"
  });

  const allowed = await preferences.checkAndRecordUserNotification("user_1", {
    type: "follow",
    uniqueId: "asset_1",
    minIntervalMs: 1
  });
  assert.equal(allowed, true);
  assert.ok(calls.some((c) => (c as any).where?.tenantId === "tenant_1"));
  assert.equal(writes[0]?.key, "notify_state");
});

test("tenant-vault: collection impact counts prefer projectId and fall back to tenantId", async () => {
  const collectionCalls: Array<Record<string, unknown>> = [];
  const assetCalls: Array<Record<string, unknown>> = [];
  const itemCalls: Array<Record<string, unknown>> = [];
  const tenantVault = createDeliveryTenantVault({
    prisma: {
      collection: {
        findFirst: async (args: Record<string, unknown>) => {
          collectionCalls.push(args);
          const where = (args as any).where ?? {};
          return where.projectId ? null : { id: "c1" };
        }
      },
      asset: {
        count: async (args: Record<string, unknown>) => {
          assetCalls.push(args);
          const where = (args as any).where ?? {};
          return where.projectId ? 0 : 2;
        }
      },
      uploadItem: {
        count: async (args: Record<string, unknown>) => {
          itemCalls.push(args);
          const where = (args as any).where?.batch ?? {};
          return where.projectId ? 0 : 5;
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    canManageProject: async () => true,
    ensureInitialOwner: async () => false
  });

  const result = await tenantVault.getCollectionImpactCounts("owner_1", "c1");
  assert.deepEqual(result, { assets: 2, files: 5 });
  assert.ok(collectionCalls.some((c) => (c as any).where?.projectId === "tenant_1"));
  assert.ok(collectionCalls.some((c) => (c as any).where?.tenantId === "tenant_1"));
  assert.ok(assetCalls.some((c) => (c as any).where?.projectId === "tenant_1"));
  assert.ok(assetCalls.some((c) => (c as any).where?.tenantId === "tenant_1"));
  assert.ok(itemCalls.some((c) => (c as any).where?.batch?.projectId === "tenant_1"));
  assert.ok(itemCalls.some((c) => (c as any).where?.batch?.tenantId === "tenant_1"));
});

test("tenant-vault: recent assets in collection prefer projectId and fall back to tenantId", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const tenantVault = createDeliveryTenantVault({
    prisma: {
      asset: {
        findMany: async (args: Record<string, unknown>) => {
          calls.push(args);
          const where = (args as any).where ?? {};
          return where.projectId
            ? []
            : [
                {
                  id: "asset_1",
                  title: "Asset",
                  description: "Desc",
                  shareCode: "share_1",
                  updatedAt: new Date("2026-04-22T00:00:00.000Z")
                }
              ];
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    canManageProject: async () => true,
    ensureInitialOwner: async () => false
  });

  const result = await tenantVault.listRecentAssetsInCollection("c1", 10);
  assert.equal(result[0]?.assetId, "asset_1");
  assert.ok(calls.some((c) => (c as any).where?.projectId === "tenant_1"));
  assert.ok(calls.some((c) => (c as any).where?.tenantId === "tenant_1"));
});

test("tenant-vault: getPrimaryVaultChatId reads current primary binding", async () => {
  const tenantVault = createDeliveryTenantVault({
    prisma: {
      tenantVaultBinding: {
        findFirst: async () => ({
          vaultGroup: { chatId: BigInt(-1001234567890) }
        })
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    canManageProject: async () => true,
    ensureInitialOwner: async () => false
  });

  const chatId = await tenantVault.getPrimaryVaultChatId();
  assert.equal(chatId, "-1001234567890");
});

test("tenant-vault: getCollectionTopic reads current topic mapping", async () => {
  const tenantVault = createDeliveryTenantVault({
    prisma: {
      tenantVaultBinding: {
        findFirst: async () => ({ vaultGroupId: "vg_1" })
      },
      tenantTopic: {
        findFirst: async () => ({
          messageThreadId: BigInt(123),
          indexMessageId: BigInt(456)
        })
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    canManageProject: async () => true,
    ensureInitialOwner: async () => false
  });

  const topic = await tenantVault.getCollectionTopic("c1");
  assert.deepEqual(topic, { threadId: 123, indexMessageId: 456 });
});

test("tenant-vault: topic mapping writes use current primary binding", async () => {
  const upsertCalls: Array<Record<string, unknown>> = [];
  const tenantVault = createDeliveryTenantVault({
    prisma: {
      tenantVaultBinding: {
        findFirst: async () => ({ vaultGroupId: "vg_1" })
      },
      tenantTopic: {
        upsert: async (args: Record<string, unknown>) => {
          upsertCalls.push(args);
          return {};
        }
      }
    } as never,
    getRuntimeProjectId: async () => "tenant_1",
    canManageProject: async () => true,
    ensureInitialOwner: async () => false
  });

  await tenantVault.setCollectionTopicThreadId("c1", 123);
  await tenantVault.setCollectionTopicIndexMessageId("c1", 456);

  assert.equal(upsertCalls.length, 2);
  assert.deepEqual((upsertCalls[0] as any).where, {
    tenantId_vaultGroupId_collectionId_version: {
      tenantId: "tenant_1",
      vaultGroupId: "vg_1",
      collectionId: "c1",
      version: 1
    }
  });
  assert.deepEqual((upsertCalls[1] as any).where, {
    tenantId_vaultGroupId_collectionId_version: {
      tenantId: "tenant_1",
      vaultGroupId: "vg_1",
      collectionId: "c1",
      version: 1
    }
  });
});

test("discovery: listTopTags backfills tags from existing asset metadata when empty", async () => {
  const createdTags = new Map<string, string>();
  const createdLinks: Array<{ tenantId: string; assetId: string; tagId: string }> = [];
  const prisma = {
    assetTag: {
      count: async () => 0,
      groupBy: async () => [{ tagId: "tag_1", _count: { tagId: 1 } }]
    },
    asset: {
      findMany: async () => [{ id: "asset_1", title: "作品 #教程", description: "说明 #实战" }]
    },
    tag: {
      upsert: async ({ where }: { where: { tenantId_name: { tenantId: string; name: string } } }) => {
        const name = where.tenantId_name.name;
        const id = createdTags.get(name) ?? `tag_${createdTags.size + 1}`;
        createdTags.set(name, id);
        return { id, name };
      },
      findMany: async () => [{ id: "tag_1", name: "教程" }]
    },
    $transaction: async (runner: (tx: any) => Promise<void>) =>
      runner({
        tag: {
          upsert: async ({ where }: { where: { tenantId_name: { tenantId: string; name: string } } }) => {
            const name = where.tenantId_name.name;
            const id = createdTags.get(name) ?? `tag_${createdTags.size + 1}`;
            createdTags.set(name, id);
            return { id, name };
          }
        },
        assetTag: {
          createMany: async ({ data }: { data: Array<{ tenantId: string; assetId: string; tagId: string }> }) => {
            createdLinks.push(...data);
            return { count: data.length };
          }
        }
      })
  } as never;

  const discovery = createDeliveryDiscovery({
    prisma,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => true,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.listTopTags(20);
  assert.deepEqual(result, [{ tagId: "tag_1", name: "教程", count: 1 }]);
  assert.equal(createdTags.has("教程"), true);
  assert.equal(createdTags.has("实战"), true);
  assert.equal(createdLinks.length, 2);
});

test("discovery: listTopTags prefers asset projectId scope then falls back", async () => {
  const tagCountWheres: Array<Record<string, unknown>> = [];
  const groupByWheres: Array<Record<string, unknown>> = [];

  const prisma = {
    assetTag: {
      groupBy: async ({ where }: { where: Record<string, unknown> }) => {
        groupByWheres.push(where);
        return groupByWheres.length === 1 ? [] : [{ tagId: "tag_1", _count: { tagId: 1 } }];
      }
    },
    tag: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        tagCountWheres.push(where);
        const assetWhere = (where as any)?.assets?.some?.asset ?? {};
        return Object.prototype.hasOwnProperty.call(assetWhere, "projectId") ? 0 : 1;
      },
      findMany: async () => [{ id: "tag_1", name: "教程" }]
    }
  } as never;

  const discovery = createDeliveryDiscovery({
    prisma,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => false,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.listTopTags(1, 20, { viewerUserId: "user_public" });
  assert.equal(result.total, 1);
  assert.deepEqual(result.items, [{ tagId: "tag_1", name: "教程", count: 1 }]);

  assert.equal(tagCountWheres.length, 2);
  assert.equal(groupByWheres.length, 2);
  assert.equal(((tagCountWheres[0] as any)?.assets?.some?.asset as any)?.projectId, "tenant_1");
  assert.equal((((groupByWheres[0] as any)?.asset as any) ?? {}).projectId, "tenant_1");
  assert.equal(((tagCountWheres[1] as any)?.tenantId as any) ?? "tenant_1", "tenant_1");
});

test("discovery: listTopTags pagination falls back only when project total is zero", async () => {
  const tagCountWheres: Array<Record<string, unknown>> = [];
  const groupByWheres: Array<Record<string, unknown>> = [];

  const prisma = {
    assetTag: {
      groupBy: async ({ where }: { where: Record<string, unknown> }) => {
        groupByWheres.push(where);
        return groupByWheres.length === 1 ? [] : [{ tagId: "tag_1", _count: { tagId: 2 } }];
      }
    },
    tag: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        tagCountWheres.push(where);
        const assetWhere = (where as any)?.assets?.some?.asset ?? {};
        return Object.prototype.hasOwnProperty.call(assetWhere, "projectId") ? 0 : 1;
      },
      findMany: async () => [{ id: "tag_1", name: "教程" }]
    }
  } as never;

  const discovery = createDeliveryDiscovery({
    prisma,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => false,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.listTopTags(1, 20, { viewerUserId: "user_public" });
  assert.equal(result.total, 1);
  assert.deepEqual(result.items, [{ tagId: "tag_1", name: "教程", count: 2 }]);

  assert.equal(tagCountWheres.length, 2);
  assert.equal(groupByWheres.length, 2);
  assert.equal(((tagCountWheres[0] as any)?.assets?.some?.asset as any)?.projectId, "tenant_1");
  assert.equal((((groupByWheres[0] as any)?.asset as any) ?? {}).projectId, "tenant_1");
  assert.equal((tagCountWheres[1] as any)?.tenantId, "tenant_1");
  assert.equal((groupByWheres[1] as any)?.tenantId, "tenant_1");
});

test("discovery: listTopTags pagination does not fall back when project has total but current page is empty", async () => {
  const tagCountWheres: Array<Record<string, unknown>> = [];
  const groupByWheres: Array<Record<string, unknown>> = [];

  const prisma = {
    assetTag: {
      groupBy: async ({ where }: { where: Record<string, unknown> }) => {
        groupByWheres.push(where);
        return [];
      }
    },
    tag: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        tagCountWheres.push(where);
        return 1;
      },
      findMany: async () => [{ id: "tag_1", name: "教程" }]
    }
  } as never;

  const discovery = createDeliveryDiscovery({
    prisma,
    getRuntimeProjectId: async () => "tenant_1",
    isProjectMemberSafe: async () => false,
    startOfLocalDay: (date) => date
  });

  const result = await discovery.listTopTags(2, 20, { viewerUserId: "user_public" });
  assert.equal(result.total, 1);
  assert.deepEqual(result.items, []);

  assert.equal(tagCountWheres.length, 1);
  assert.equal(groupByWheres.length, 1);
  assert.equal(((tagCountWheres[0] as any)?.assets?.some?.asset as any)?.projectId, "tenant_1");
  assert.equal((((groupByWheres[0] as any)?.asset as any) ?? {}).projectId, "tenant_1");
});

registerDeliveryModuleTests(test);

const main = async () => {
  let passed = 0;
  for (const item of tests) {
    try {
      await item.run();
      passed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.stack || error.message : String(error ?? "unknown error");
      console.error(`[FAIL] ${item.name}\n${message}`);
      process.exitCode = 1;
    }
  }
  if (process.exitCode) {
    console.error(`\n${passed}/${tests.length} passed`);
    process.exit(process.exitCode);
  }
  console.log(`${passed}/${tests.length} passed`);
};

main();

