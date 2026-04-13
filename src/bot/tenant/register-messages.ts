import type { Bot, Context } from "grammy";
import { logError, logErrorThrottled } from "../../infra/logging";
import type { DeliveryService } from "../../services/use-cases";
import {
  buildDbDisabledHint,
  buildGuideHint,
  buildInputExitHint,
  escapeHtml,
  extractStartPayloadFromText,
  normalizeButtonText,
  replyHtml,
  stripHtmlTags,
  toMetaKey
} from "./ui-utils";
import {
  actionKeyboard,
  buildAdminInputKeyboard,
  buildCollectionInputKeyboard,
  buildFollowInputKeyboard,
  buildHelpKeyboard
} from "./keyboards";

type ReplyMarkup = NonNullable<Parameters<Context["reply"]>[1]>["reply_markup"];

type KeyValueStore<T> = {
  get: (key: string) => T | undefined;
  set: (key: string, value: T) => void;
  has: (key: string) => boolean;
  delete: (key: string) => boolean;
};

export const registerTenantMessageHandlers = (
  bot: Bot,
  deps: {
    deliveryService: DeliveryService | null;
    mainKeyboard: ReplyMarkup;
    getDefaultKeyboard: (ctx: Context) => Promise<ReplyMarkup | undefined>;
    isCancelText: (value: string) => boolean;
    exitCurrentInputState: (ctx: Context) => Promise<unknown>;
    handleMetaInput: (ctx: Context, text: string) => Promise<boolean>;
    handleBroadcastPhoto: (ctx: Context) => Promise<unknown>;
    handleBroadcastVideo: (ctx: Context) => Promise<unknown>;
    handleBroadcastDocument: (ctx: Context) => Promise<unknown>;
    handleBroadcastText: (ctx: Context, text: string) => Promise<boolean>;
    handleSettingsText: (ctx: Context, text: string) => Promise<boolean>;
    handleCommentInputText: (ctx: Context, text: string) => Promise<boolean>;
    notifyCommentTargets: (ctx: Context, options: { content: string; commentId: string; notify: any }) => Promise<void>;
    renderComments: (ctx: Context, assetId: string, page: number, mode: "reply" | "edit") => Promise<void>;
    renderFollow: (ctx: Context) => Promise<void>;
    renderHistory: (ctx: Context, page: number, scope?: "community" | "mine", showMoreActions?: boolean) => Promise<void>;
    renderSearch: (ctx: Context, query: string, page: number, mode: "reply" | "edit") => Promise<void>;
    renderFootprint: (
      ctx: Context,
      tab: "open" | "like" | "comment" | "reply",
      range: "7d" | "30d" | "all",
      page: number,
      mode: "reply" | "edit",
      showMoreActions?: boolean
    ) => Promise<void>;
    renderMy: (ctx: Context) => Promise<void>;
    renderSettings: (ctx: Context) => Promise<void>;
    renderTagIndex: (ctx: Context, mode: "reply" | "edit") => Promise<void>;
    renderTagAssets: (ctx: Context, tagId: string, page: number, mode: "reply" | "edit") => Promise<void>;
    renderUploadStatus: (ctx: Context) => Promise<void>;
    renderCollections: (ctx: Context, options: any) => Promise<void>;
    openShareCode: (ctx: Context, payload: string, page?: number) => Promise<unknown>;
    trackStartPayloadVisit: (
      ctx: Context,
      payload: string,
      entry: "command" | "text_link",
      status: "received" | "routed_social" | "opened" | "failed",
      reason?: string
    ) => Promise<void>;
    handleStartPayloadEntry: (ctx: Context, payload: string, entry: "command" | "text_link") => Promise<boolean>;
    getSessionMode: (key: string) => any;
    ensureSessionMode: (key: string) => any;
    setSessionMode: (key: string, mode: any) => void;
    setActive: (userId: number, chatId: number, active: boolean) => void;
    historyScopeStates: KeyValueStore<"community" | "mine">;
    historyDateStates: KeyValueStore<Date>;
    searchStates: KeyValueStore<{ query: string }>;
    collectionInputStates: KeyValueStore<any>;
    adminInputStates: KeyValueStore<any>;
    commentInputStates: KeyValueStore<any>;
    updateVaultTopicIndexByCollection: (ctx: Context, collectionId: string, title: string) => Promise<void>;
  }
) => {
  bot.on("message:photo", async (ctx) => {
    await deps.handleBroadcastPhoto(ctx);
  });

  bot.on("message:video", async (ctx) => {
    await deps.handleBroadcastVideo(ctx);
  });

  bot.on("message:document", async (ctx) => {
    await deps.handleBroadcastDocument(ctx);
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (deps.isCancelText(text)) {
      await deps.exitCurrentInputState(ctx);
      return;
    }
    if (await deps.handleMetaInput(ctx, text)) {
      return;
    }
    if (ctx.from && ctx.chat && ctx.message.reply_to_message) {
      const replied = ctx.message.reply_to_message;
      const replyFromBot = Boolean(replied?.from?.is_bot) && (ctx.me?.username ? replied?.from?.username === ctx.me.username : true);
      if (replyFromBot) {
        const entities = Array.isArray(replied?.entities) ? replied.entities : [];
        const urls: string[] = [];
        for (const entity of entities) {
          if (entity?.type === "text_link" && typeof entity.url === "string") {
            urls.push(entity.url);
          }
          if (entity?.type === "url" && typeof replied?.text === "string") {
            const raw = replied.text.slice(entity.offset ?? 0, (entity.offset ?? 0) + (entity.length ?? 0));
            if (raw) {
              urls.push(raw);
            }
          }
        }
        const commentId = (() => {
          for (const url of urls) {
            try {
              const parsed = new URL(url);
              const start = parsed.searchParams.get("start") ?? "";
              if (start.startsWith("cv_") || start.startsWith("cr_") || start.startsWith("ct_")) {
                const id = start.slice(3).trim();
                if (id) {
                  return id;
                }
              }
            } catch {
              continue;
            }
          }
          return null;
        })();
        if (commentId) {
          if (!deps.deliveryService) {
            await replyHtml(ctx, buildDbDisabledHint("回复"), { reply_markup: deps.mainKeyboard });
            return;
          }
          const userId = String(ctx.from.id);
          const context = await deps.deliveryService.getAssetCommentContext(userId, commentId);
          if (!context) {
            await replyHtml(ctx, "⚠️ 评论不存在或无权限。", { reply_markup: deps.mainKeyboard });
            return;
          }
          const key = toMetaKey(ctx.from.id, ctx.chat.id);
          deps.setSessionMode(key, "commentInput");
          deps.commentInputStates.set(key, { assetId: context.assetId, replyToCommentId: commentId, replyToLabel: "该评论" });
          const authorName = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name?.trim() || null;
          const result = await deps.deliveryService.addAssetComment(userId, context.assetId, {
            authorName,
            content: text,
            replyToCommentId: commentId
          });
          if (result.ok && result.notify && result.commentId) {
            await deps
              .notifyCommentTargets(ctx, { content: text, commentId: result.commentId, notify: result.notify })
              .catch((error) =>
                logErrorThrottled(
                  { component: "tenant", op: "comment_notify_targets", scope: "reply_comment", commentId: result.commentId, assetId: context.assetId },
                  error,
                  { intervalMs: 30_000 }
                )
              );
          }
          await replyHtml(ctx, result.message, { reply_markup: deps.mainKeyboard });
          const located = await deps.deliveryService.locateAssetComment(userId, commentId, 8).catch(() => null);
          await deps.renderComments(ctx, context.assetId, located?.page ?? 1, "reply");
          return;
        }
      }
    }
    if (await deps.handleCommentInputText(ctx, text)) {
      return;
    }
    if (ctx.from && ctx.chat) {
      const key = toMetaKey(ctx.from.id, ctx.chat.id);
      const mode = deps.getSessionMode(key);
      if (mode === "followInput") {
        const command = normalizeButtonText(text);
        if (
          command === "分享" ||
          command === "储存" ||
          command === "完成" ||
          command === "列表" ||
          command === "搜索" ||
          command === "足迹" ||
          command === "我的" ||
          command === "设置"
        ) {
          await replyHtml(ctx, buildInputExitHint("添加关注关键词"), { reply_markup: buildFollowInputKeyboard() });
          return;
        }
        if (!deps.deliveryService) {
          deps.setSessionMode(key, "idle");
          await replyHtml(ctx, buildDbDisabledHint("保存关注关键词"), { reply_markup: deps.mainKeyboard });
          return;
        }
        const userId = String(ctx.from.id);
        const isClear = text.trim() === "清空" || text.trim() === "清除";
        const current = await deps.deliveryService.getUserFollowKeywords(userId).catch(() => []);
        const added = isClear ? [] : text.split(/[,\n，；;]+/g).map((s) => s.trim()).filter(Boolean);
        const next = isClear ? [] : [...current, ...added];
        const result = await deps.deliveryService.setUserFollowKeywords(userId, next);
        deps.setSessionMode(key, "idle");
        await replyHtml(ctx, result.message, { reply_markup: deps.mainKeyboard });
        await deps.renderFollow(ctx);
        return;
      }
    }
    if (await deps.handleBroadcastText(ctx, text)) {
      return;
    }
    if (await deps.handleSettingsText(ctx, text)) {
      return;
    }
    if (ctx.from && ctx.chat) {
      const key = toMetaKey(ctx.from.id, ctx.chat.id);
      const mode = deps.getSessionMode(key);
      const inputState = mode === "collectionInput" ? deps.collectionInputStates.get(key) : undefined;
      if (mode === "collectionInput" && (inputState?.mode === "createCollection" || inputState?.mode === "renameCollection")) {
        const command = normalizeButtonText(text);
        if (
          command === "分享" ||
          command === "储存" ||
          command === "完成" ||
          command === "列表" ||
          command === "搜索" ||
          command === "足迹" ||
          command === "我的" ||
          command === "关注" ||
          command === "设置"
        ) {
          await replyHtml(ctx, buildInputExitHint("编辑分类"), { reply_markup: buildCollectionInputKeyboard() });
          return;
        }
        if (!deps.deliveryService) {
          deps.setSessionMode(key, "idle");
          await replyHtml(ctx, buildDbDisabledHint(`${inputState.mode === "renameCollection" ? "重命名" : "创建"}分类`), {
            reply_markup: deps.mainKeyboard
          });
          return;
        }
        if (inputState.mode === "renameCollection") {
          const result = await deps.deliveryService.updateCollection(String(ctx.from.id), inputState.collectionId ?? "", text);
          if (result.ok) {
            const normalizedTitle = text.trim().replace(/\s+/g, " ") || "未分类";
            void deps.updateVaultTopicIndexByCollection(ctx, inputState.collectionId ?? "", normalizedTitle).catch((error) =>
              logError(
                { component: "tenant", op: "update_vault_topic_index", scope: "rename_collection", collectionId: inputState.collectionId ?? "" },
                error
              )
            );
            deps.setSessionMode(key, "idle");
            await replyHtml(ctx, result.message, { reply_markup: deps.mainKeyboard });
            await deps.renderCollections(ctx, { returnTo: "settings" });
            return;
          }
          await replyHtml(ctx, result.message, { reply_markup: buildCollectionInputKeyboard() });
          return;
        }
        const result = await deps.deliveryService.createCollection(String(ctx.from.id), text);
        if (result.ok) {
          if (result.id) {
            const normalizedTitle = text.trim().replace(/\s+/g, " ") || "未分类";
            void deps.updateVaultTopicIndexByCollection(ctx, result.id, normalizedTitle).catch((error) =>
              logError({ component: "tenant", op: "update_vault_topic_index", scope: "create_collection", collectionId: result.id }, error)
            );
          }
          deps.setSessionMode(key, "idle");
          await replyHtml(ctx, result.message, { reply_markup: deps.mainKeyboard });
          await deps.renderCollections(ctx, { returnTo: "settings" });
          return;
        }
        await replyHtml(ctx, result.message, { reply_markup: buildCollectionInputKeyboard() });
        return;
      }
    }
    if (ctx.from && ctx.chat) {
      const key = toMetaKey(ctx.from.id, ctx.chat.id);
      const mode = deps.getSessionMode(key);
      const adminState = mode === "adminInput" ? deps.adminInputStates.get(key) : undefined;
      if (mode === "adminInput" && adminState?.mode === "addAdmin") {
        const command = normalizeButtonText(text);
        if (
          command === "分享" ||
          command === "储存" ||
          command === "完成" ||
          command === "列表" ||
          command === "搜索" ||
          command === "足迹" ||
          command === "我的" ||
          command === "关注" ||
          command === "设置"
        ) {
          await replyHtml(ctx, buildInputExitHint("添加管理员"), { reply_markup: buildAdminInputKeyboard() });
          return;
        }
        if (!deps.deliveryService) {
          deps.setSessionMode(key, "idle");
          await replyHtml(ctx, buildDbDisabledHint("添加管理员"), { reply_markup: deps.mainKeyboard });
          return;
        }
        const actorUserId = String(ctx.from.id);
        const canManageAdmins = await deps.deliveryService.canManageAdmins(actorUserId);
        if (!canManageAdmins) {
          deps.setSessionMode(key, "idle");
          await replyHtml(ctx, "🔒 无权限：仅管理员可添加管理员。", { reply_markup: buildHelpKeyboard() });
          return;
        }
        const id = text.replace(/\s+/g, "");
        if (!/^\d{5,20}$/.test(id)) {
          await replyHtml(ctx, "⚠️ ID 格式错误：请发送 Telegram 数字 ID，例如 <code>123456</code>。", {
            reply_markup: buildAdminInputKeyboard()
          });
          return;
        }
        const result = await deps.deliveryService.addTenantAdmin(actorUserId, id);
        deps.setSessionMode(key, "idle");
        await replyHtml(ctx, result.message, { reply_markup: deps.mainKeyboard });
        await deps.renderSettings(ctx);
        return;
      }
    }
    const normalizedCommand = normalizeButtonText(text);
    const command = normalizedCommand === "关注" ? "我的" : normalizedCommand;
    const isTopLevelCommand =
      command === "分享" ||
      command === "储存" ||
      command === "完成" ||
      command === "列表" ||
      command === "搜索" ||
      command === "足迹" ||
      command === "我的" ||
      command === "设置" ||
      command === "标签";
    if (ctx.from && ctx.chat) {
      const key = toMetaKey(ctx.from.id, ctx.chat.id);
      const mode = deps.ensureSessionMode(key);
      if (mode === "searchInput" && isTopLevelCommand && command !== "搜索") {
        deps.setSessionMode(key, "idle");
      }
      if (mode === "searchInput" && !isTopLevelCommand && !text.startsWith("/") && text.trim().length >= 1) {
        const query = text.trim();
        deps.searchStates.set(key, { query });
        if (query.length >= 2) {
          deps.setSessionMode(key, "idle");
        }
        await deps.renderSearch(ctx, query, 1, "reply");
        return;
      }
    }
    if (command === "分享" || command === "储存") {
      if (!ctx.from || !ctx.chat) {
        return;
      }
      deps.setActive(ctx.from.id, ctx.chat.id, true);
      await deps.renderUploadStatus(ctx);
      return;
    }
    if (command === "完成") {
      await replyHtml(ctx, "请点击消息里的 <b>✅ 完成</b> 保存。", { reply_markup: actionKeyboard });
      return;
    }
    if (command === "列表") {
      if (ctx.from && ctx.chat) {
        const key = toMetaKey(ctx.from.id, ctx.chat.id);
        deps.historyScopeStates.set(key, "community");
        if (deps.deliveryService && !deps.historyDateStates.has(key)) {
          const now = new Date();
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          deps.historyDateStates.set(key, today);
          await deps.deliveryService
            .setUserHistoryListDate(String(ctx.from.id), today)
            .catch((error) =>
              logErrorThrottled(
                { component: "tenant", op: "set_user_history_list_date", scope: "menu_list", userId: String(ctx.from.id) },
                error,
                { intervalMs: 30_000 }
              )
            );
        }
      }
      await deps.renderHistory(ctx, 1, "community");
      return;
    }
    if (command === "搜索") {
      if (ctx.from && ctx.chat) {
        const key = toMetaKey(ctx.from.id, ctx.chat.id);
        deps.setSessionMode(key, "searchInput");
      }
      const keyboard = await deps.getDefaultKeyboard(ctx);
      await replyHtml(ctx, ["<b>🔎 搜索</b>", "", "请直接发送关键词开始搜索。", "也可以发送：<code>搜索 关键词</code>。", "例如：<code>搜索 教程</code>。"].join("\n"), {
        reply_markup: keyboard
      });
      return;
    }
    if (command === "足迹") {
      await deps.renderFootprint(ctx, "open", "30d", 1, "reply");
      return;
    }
    if (command === "我的") {
      await deps.renderMy(ctx);
      return;
    }
    if (command === "设置") {
      await deps.renderSettings(ctx);
      return;
    }
    const searchMatch = text.match(/^搜索\s+(.+)$/);
    if (searchMatch) {
      const query = searchMatch[1].trim();
      if (ctx.from && ctx.chat) {
        const key = toMetaKey(ctx.from.id, ctx.chat.id);
        deps.searchStates.set(key, { query });
        deps.setSessionMode(key, query.length >= 2 ? "idle" : "searchInput");
      }
      await deps.renderSearch(ctx, query, 1, "reply");
      return;
    }
    if (text === "标签") {
      await deps.renderTagIndex(ctx, "reply");
      return;
    }
    const tagMatch = text.match(/^#([\p{L}\p{N}_-]{1,32})$/u);
    if (tagMatch) {
      if (!deps.deliveryService) {
        await replyHtml(ctx, buildDbDisabledHint("查看标签"), { reply_markup: deps.mainKeyboard });
        return;
      }
      const tagName = tagMatch[1] ?? "";
      const found = await deps.deliveryService.getTagByName(tagName).catch(() => null);
      if (!found) {
        await replyHtml(ctx, `🔎 未找到标签：<code>#${escapeHtml(tagName)}</code>\n发送 <code>标签</code> 查看热门标签。`, {
          reply_markup: deps.mainKeyboard
        });
        return;
      }
      await deps.renderTagAssets(ctx, found.tagId, 1, "reply");
      return;
    }
    const match = text.match(/^打开(?:内容)?\s+(.+)$/);
    if (match) {
      await deps.openShareCode(ctx, match[1].trim());
      return;
    }
    const payloadFromLink = extractStartPayloadFromText(text);
    if (payloadFromLink) {
      await deps.trackStartPayloadVisit(ctx, payloadFromLink, "text_link", "received");
      await deps.handleStartPayloadEntry(ctx, payloadFromLink, "text_link");
      return;
    }
    if (/^[a-zA-Z0-9_-]{6,16}$/.test(text)) {
      await deps.openShareCode(ctx, text);
      return;
    }
    const keyboard = await deps.getDefaultKeyboard(ctx);
    await replyHtml(ctx, buildGuideHint("请使用底部按钮操作。", "搜索请发送：<code>搜索 关键词</code>；我的页可查看足迹/关注/通知。"), {
      reply_markup: keyboard
    });
  });
};
