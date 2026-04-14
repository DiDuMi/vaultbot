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
import { extractStartPayloadFromText, toMetaKey } from "../bot/tenant/ui-utils";
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
import { buildAssetActionLine, buildPreviewLinkLine } from "../bot/tenant/index";
import { buildFootprintKeyboard, buildRankingKeyboard } from "../bot/tenant/keyboards";
import { createDeliveryDiscovery } from "../services/use-cases/delivery-discovery";
import { createGetTenantAssetAccess } from "../services/use-cases/delivery-factories";

type TestCase = { name: string; run: () => Promise<void> | void };

const tests: TestCase[] = [];
const test = (name: string, run: TestCase["run"]) => tests.push({ name, run });

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
    canManageAdmins: async () => true,
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

  await new Promise((resolve) => setTimeout(resolve, 80));
  clearInterval(timer);
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(maxConcurrentRuns, 1);
  assert.ok(totalRuns >= 2);
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

test("integration: 交付流程在副本未就绪时返回提示", async () => {
  const { ctx, calls } = createMockCtx();
  const open = createOpenHandler({
    getTenantProtectContentEnabled: async () => false,
    selectReplicas: async () => ({ status: "pending", message: "副本写入中" }),
    resolveShareCode: async () => null
  } as never);
  await open.openAsset(ctx, "asset1", 1);
  assert.ok(calls.some((c) => c.method === "reply" && String(c.args[0]).includes("副本写入中")));
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
    getTenantId: async () => tenantId,
    isTenantUserSafe: async () => true,
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

test("access: protected asset is forbidden for public viewer", async () => {
  const getTenantAssetAccess = createGetTenantAssetAccess({
    prisma: {
      asset: {
        findFirst: async () => ({ id: "asset_1", visibility: "PROTECTED" })
      },
      uploadBatch: {
        findFirst: async () => null
      }
    } as never,
    isTenantUserSafe: async () => false,
    isTenantAdminSafe: async () => false
  });

  const result = await getTenantAssetAccess("tenant_1", "user_1", "asset_1");
  assert.equal(result.status, "forbidden");
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
    isTenantUserSafe: async () => true,
    isTenantAdminSafe: async () => false
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
    isTenantUserSafe: async () => true,
    isTenantAdminSafe: async () => false
  });

  const result = await getTenantAssetAccess("tenant_1", "user_1", "asset_1");
  assert.equal(result.status, "ok");
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
