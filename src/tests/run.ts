import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Keyboard } from "grammy";
import { createTenantAdminInput } from "../bot/tenant/admin-input";
import { createBatchActions } from "../bot/tenant/batch-actions";
import { createOpenHandler } from "../bot/tenant/open";
import { commentListCallbackRe } from "../bot/tenant/callbacks/social";
import { createTenantSocial } from "../bot/tenant/social";
import { createUploadBatchStore } from "../services/use-cases";
import { buildPublisherLine, extractStartPayloadFromText, resolveUserLabel, toMetaKey } from "../bot/tenant/ui-utils";
import {
  footMoreCallbackRe,
  historyMoreCallbackRe,
  historyScopeCallbackRe,
  historySetFilterCollectionCallbackRe,
  tagIndexPageCallbackRe,
  tagIndexRefreshCallbackRe,
  tagOpenCallbackRe
} from "../bot/tenant/callbacks/social";
import { rankMoreCallbackRe } from "../bot/tenant/callbacks/home";
import { buildWorkerHeartbeatLines, parseHeartbeatAgoMin } from "../services/use-cases/worker-heartbeat";
import { registerDeliveryModuleTests } from "./use-cases/delivery-modules";
import { createWorkerRoutes } from "../worker/routes";
import { startIntervalScheduler } from "../worker/orchestration";
import {
  backfillProjectUsers,
  backfillTenantUsers,
  computeNextBroadcastRunAt,
  ensureRuntimeProjectId,
  getBroadcastTargetUserIds,
  getProjectBroadcastTargetUserIds
} from "../worker/helpers";
import { buildAssetActionLine, buildPreviewLinkLine } from "../bot/tenant/index";
import { createHistoryRenderer } from "../bot/tenant/history";
import { buildFootprintKeyboard, buildMyKeyboard, buildRankingKeyboard } from "../bot/tenant/keyboards";
import { createTenantRenderers } from "../bot/tenant/renderers";
import { registerTenantCommands } from "../bot/tenant/register-commands";
import { registerTenantMessageHandlers } from "../bot/tenant/register-messages";
import { registerTenantMiddlewares } from "../bot/tenant/register-middlewares";
import { registerTenantCallbackRoutes } from "../bot/tenant/callbacks";
import {
  createProjectRenderers,
  registerProjectCallbackRoutes,
  registerProjectCommands,
  registerProjectMessageHandlers,
  registerProjectMiddlewares
} from "../bot/project";
import { createProjectRenderers as createProjectRenderersModule } from "../bot/project/renderers";
import { registerProjectCommands as registerProjectCommandsModule } from "../bot/project/commands";
import { registerProjectMessageHandlers as registerProjectMessageHandlersModule } from "../bot/project/messages";
import { registerProjectMiddlewares as registerProjectMiddlewaresModule } from "../bot/project/middlewares";
import { registerProjectCallbackRoutes as registerProjectCallbackRoutesModule } from "../bot/project/callbacks";
import { createTagRenderers } from "../bot/tenant/tags";
import { createDeliveryDiscovery, createProjectDiscovery } from "../services/use-cases/delivery-discovery";
import { createDeliveryAdmin, createProjectAdmin } from "../services/use-cases/delivery-admin";
import { createDeliveryCore } from "../services/use-cases/delivery-core";
import { createDeliveryStorage } from "../services/use-cases/delivery-storage";
import { createDeliverySocial } from "../services/use-cases/delivery-social";
import { createDeliveryStats } from "../services/use-cases/delivery-stats";
import { isSingleOwnerModeEnabled } from "../infra/runtime-mode";
import {
  assertProjectContextConsistency,
  ensureRuntimeProjectContext,
  ensureRuntimeTenant,
  getProjectDiagnostics
} from "../infra/persistence/tenant-guard";
import {
  buildIdentityService,
  createGetProjectAssetAccess,
  createGetTenantAssetAccess
} from "../services/use-cases/delivery-factories";
import { resolveLocaleFromTelegramLanguageCode } from "../i18n";
import { createProjectContextConfigFromTenant, normalizeProjectContextConfig } from "../project-context";
import { createDeliveryReplicaSelection, createProjectReplicaSelection } from "../services/use-cases/delivery-replica-selection";
import { createDeliveryProjectVault, createDeliveryTenantVault } from "../services/use-cases/delivery-tenant-vault";
import { createReplicateBatch } from "../worker/replication-worker";
import { createServer } from "../server";

type TestCase = { name: string; run: () => Promise<void> | void };

const tests: TestCase[] = [];
const test = (name: string, run: TestCase["run"]) => tests.push({ name, run });

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

test("worker-helper: project user backfill remains a compatibility alias", () => {
  assert.equal(backfillProjectUsers, backfillTenantUsers);
});

test("worker-helper: project broadcast target ids remain a compatibility alias", () => {
  assert.equal(getProjectBroadcastTargetUserIds, getBroadcastTargetUserIds);
});

test("tenant-vault: project factory remains a compatibility alias", () => {
  assert.equal(createDeliveryProjectVault, createDeliveryTenantVault);
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

test("bot project wrapper: high-level aliases remain compatibility wrappers", () => {
  assert.equal(createProjectRenderers, createTenantRenderers);
  assert.equal(registerProjectCommands, registerTenantCommands);
  assert.equal(registerProjectMessageHandlers, registerTenantMessageHandlers);
  assert.equal(registerProjectMiddlewares, registerTenantMiddlewares);
  assert.equal(registerProjectCallbackRoutes, registerTenantCallbackRoutes);
});

test("bot project wrapper modules: direct re-exports remain compatibility wrappers", () => {
  assert.equal(createProjectRenderersModule, createTenantRenderers);
  assert.equal(registerProjectCommandsModule, registerTenantCommands);
  assert.equal(registerProjectMessageHandlersModule, registerTenantMessageHandlers);
  assert.equal(registerProjectMiddlewaresModule, registerTenantMiddlewares);
  assert.equal(registerProjectCallbackRoutesModule, registerTenantCallbackRoutes);
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
  const tags = createTagRenderers({
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

test("admin-input: broadcastInput 无数据库时会退出并提示", async () => {
  const modes = new Map<string, "idle" | "broadcastInput">();
  const setSessionModeCalls: Array<{ key: string; mode: string }> = [];
  const { store: broadcastInputStates } = createStore<{ mode: "broadcastContent"; draftId: string }>();
  const { store: settingsInputStates } = createStore<any>();
  const { ctx, calls } = createMockCtx();
  const key = toMetaKey(ctx.from.id, ctx.chat.id);
  modes.set(key, "broadcastInput");
  broadcastInputStates.set(key, { mode: "broadcastContent", draftId: "d1" });

  const admin = createTenantAdminInput({
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

  const admin = createTenantAdminInput({
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

  const admin = createTenantAdminInput({
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
  const admin = createTenantAdminInput({
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

  const social = createTenantSocial({
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

  const social = createTenantSocial({
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

  const social = createTenantSocial({
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

  registerTenantMessageHandlers(bot, {
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
  registerTenantMessageHandlers(bot, {
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
  registerTenantMessageHandlers(bot, {
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
    path.resolve(__dirname, "../bot/tenant/index.ts"),
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
  const actions = createBatchActions(store, {
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

  const admin = createDeliveryAdmin({
    prisma: {
      broadcast: {
        findMany: async () => rows,
        findFirst: async ({ where }: { where: { id: string } }) => rows.find((row) => row.id === where.id) ?? null
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
  const admin = createDeliveryAdmin({
    prisma: {
      broadcast: {
        create: async ({ data }: { data: { tenantId: string } }) => ({ id: `draft:${data.tenantId}` })
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
      config: { tenantCode: "demo", tenantName: "demo" }
    });

    const result = await core.getProjectMinReplicas();
    assert.equal(result, 1);
  } finally {
    process.env.SINGLE_OWNER_MODE = previous;
  }
});

test("delivery-core: exposes project-first search mode and min replica aliases", async () => {
  const upsertCalls: Array<{ tenantId: string; key: string; value: string }> = [];
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
        findUnique: async () => ({ value: "3" }),
        upsert: async ({ create }: { create: { tenantId: string; key: string; value: string } }) => {
          upsertCalls.push(create);
          return {};
        }
      }
    } as never,
    config: { tenantCode: "demo", tenantName: "Demo" }
  });

  assert.equal(await core.getProjectSearchMode(), "PUBLIC");
  assert.equal(await core.getProjectMinReplicas(), 3);

  const result = await core.setProjectMinReplicas("owner_1", 4);
  assert.equal(result.ok, true);
  assert.deepEqual(upsertCalls.at(-1), { tenantId: "tenant_1", key: "min_replicas", value: "3" });
});

test("delivery-core: exposes runtime project context wrappers", async () => {
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
  assert.equal(await core.getTenantId(), "tenant_1");
});

test("delivery-core: single owner mode only grants manage rights to owner", async () => {
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
      config: { tenantCode: "demo", tenantName: "demo" }
    });

    const result = await core.isTenantAdmin("admin_1");
    assert.equal(result, false);
  } finally {
    process.env.SINGLE_OWNER_MODE = previous;
  }
});

test("delivery-core: exposes project-oriented manage alias", async () => {
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
    config: { tenantCode: "demo", tenantName: "demo" }
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
      /禁止自动创建 tenant/
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

test("renderers: settings copy switches to single-owner wording", async () => {
  const previous = process.env.SINGLE_OWNER_MODE;
  process.env.SINGLE_OWNER_MODE = "1";
  try {
    const { ctx, calls } = createMockCtx();
    const { store: broadcastDraftStates } = createStore<{ draftId: string }>();
    const { store: rankingViewStates } = createStore<{ range: "today" | "week" | "month"; metric: "open" | "visit" | "like" | "comment" }>();
    const renderers = createTenantRenderers({
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
    const renderers = createTenantRenderers({
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
    const renderers = createTenantRenderers({
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

test("renderers: stats prefers project stats alias", async () => {
  const { ctx, calls } = createMockCtx();
  const { store: broadcastDraftStates } = createStore<{ draftId: string }>();
  const { store: rankingViewStates } = createStore<{ range: "today" | "week" | "month"; metric: "open" | "visit" | "like" | "comment" }>();
  let projectCalls = 0;
  const renderers = createTenantRenderers({
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
  const renderers = createTenantRenderers({
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

test("history: community scope prefers project batch alias", async () => {
  const { ctx, calls } = createMockCtx();
  const { store: historyFilterStates } = createStore<string | null | undefined>();
  const { store: historyDateStates } = createStore<Date>();
  const { store: historyScopeStates } = createStore<"community" | "mine">();
  let projectCalls = 0;
  const renderHistory = createHistoryRenderer({
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
  const open = createOpenHandler({
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
  const open = createOpenHandler({
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
        create,
        update
      }: {
        create: { key: string; value: string | null };
        update: { value: string | null };
      }) => {
        settings.set(create.key, update.value ?? create.value ?? "");
      },
      findUnique: async ({ where }: { where: { tenantId_key: { key: string } } }) => ({
        value: settings.get(where.tenantId_key.key) ?? null
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

  const restored = await discovery.restoreUserAsset("user_1", asset.id);
  assert.equal(restored.ok, true);
  assert.equal(asset.searchable, true);
  assert.equal(asset.visibility, "PUBLIC");
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

test("discovery: public viewer community list excludes only restricted assets", async () => {
  const prisma = {
    uploadBatch: {
      count: async ({ where }: { where: { asset: { visibility?: { not: "RESTRICTED" } } } }) => {
        assert.equal(where.asset.visibility?.not, "RESTRICTED");
        return 1;
      },
      findMany: async ({ where }: { where: { asset: { visibility?: { not: "RESTRICTED" } } } }) => {
        assert.equal(where.asset.visibility?.not, "RESTRICTED");
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
  const storage = createDeliveryStorage(
    {
      userPreference: {
        findUnique: async () => ({ value: "v1" })
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

