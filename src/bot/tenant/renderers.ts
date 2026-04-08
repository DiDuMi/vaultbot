import { InlineKeyboard, Keyboard } from "grammy";
import type { Context } from "grammy";
import type { DeliveryService } from "../../services/use-cases";
import { logError } from "../../infra/logging";
import {
  buildDbDisabledHint,
  buildPublisherLine,
  buildStartLink,
  escapeHtml,
  type KeyValueStore,
  sanitizeTelegramHtml,
  shouldShowPublisherLine,
  stripHtmlTags,
  toMetaKey,
  replyHtml,
  upsertHtml
} from "./ui-utils";
import {
  buildAdKeyboard,
  buildBroadcastButtonsKeyboard,
  buildBroadcastKeyboard,
  buildHelpKeyboard,
  buildHomeDetailKeyboard,
  buildHomeKeyboard,
  buildAutoCategorizeKeyboard,
  buildFollowKeyboard,
  buildNotifyKeyboard,
  buildHidePublisherKeyboard,
  buildMyKeyboard,
  buildProtectKeyboard,
  buildRankPublicKeyboard,
  buildSearchModeKeyboard,
  buildVaultKeyboard,
  buildRankingKeyboard,
  buildSettingsKeyboard,
  buildStartShortcutKeyboard,
  buildUserKeyboard,
  buildWelcomeKeyboard
} from "./keyboards";

export const createTenantRenderers = (deps: {
  deliveryService: DeliveryService | null;
  mainKeyboard: InlineKeyboard | Keyboard;
  syncSessionForView: (ctx: Context) => void;
  broadcastDraftStates: KeyValueStore<{ draftId: string }>;
  rankingViewStates: KeyValueStore<{ range: "today" | "week" | "month"; metric: "open" | "visit" | "like" | "comment" }>;
  formatLocalDateTime: (date: Date) => string;
}) => {
  const logRendererError = (scope: string, error: unknown) => {
    logError({ component: "bot", op: "renderer_error", scope }, error);
  };

  const renderStats = async (ctx: Context) => {
    deps.syncSessionForView(ctx);
    if (!deps.deliveryService) {
      await upsertHtml(ctx, buildDbDisabledHint("查看统计"), buildHomeKeyboard());
      return;
    }
    if (!ctx.from || !(await deps.deliveryService.isTenantUser(String(ctx.from.id)))) {
      await upsertHtml(ctx, "🔒 仅租户可查看统计。", buildHomeKeyboard());
      return;
    }
    const stats = await deps.deliveryService.getTenantStats();
    const text = [
      "📊 统计",
      "",
      `访客：${stats.visitors} 人（7 天：${stats.visits7d} 次访问）`,
      `访问：${stats.visits} 次`,
      `浏览：${stats.opens} 次（浏览用户：${stats.openUsers} 人，7 天：${stats.opens7d} 次）`,
      "",
      `文件组：${stats.assets}`,
      `批次：${stats.batches}`,
      `文件：${stats.files}`
    ].join("\n");
    await upsertHtml(ctx, text, buildHomeDetailKeyboard("stats"));
  };

  const renderRanking = async (
    ctx: Context,
    range: "today" | "week" | "month" = "month",
    metric: "open" | "visit" | "like" | "comment" = "open",
    showMoreActions = false
  ) => {
    deps.syncSessionForView(ctx);
    if (!deps.deliveryService) {
      await upsertHtml(ctx, buildDbDisabledHint("查看排行"));
      return;
    }
    if (!ctx.from) {
      await upsertHtml(ctx, "⚠️ 无法识别当前用户。", buildHomeKeyboard());
      return;
    }
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (chatId) {
      deps.rankingViewStates.set(toMetaKey(ctx.from.id, chatId), { range, metric });
    }
    const userId = String(ctx.from.id);
    const isTenant = await deps.deliveryService.isTenantUser(userId).catch(() => false);
    if (!isTenant) {
      const enabled = await deps.deliveryService.getTenantPublicRankingEnabled().catch(() => false);
      if (!enabled) {
        await upsertHtml(ctx, "🔒 租户未开放排行。", new InlineKeyboard().text("👣 足迹", "user:history"));
        return;
      }
    }
    const items =
      metric === "like"
        ? await deps.deliveryService.getTenantLikeRanking(range, 10, userId)
        : metric === "visit"
          ? await deps.deliveryService.getTenantVisitRanking(range, 10, userId)
          : metric === "comment"
            ? await deps.deliveryService.getTenantCommentRanking(range, 10, userId)
            : await deps.deliveryService.getTenantRanking(range, 10, userId);
    if (items.length === 0) {
      const emptyText =
        metric === "like"
          ? "🏆 暂无收藏数据。"
          : metric === "visit"
            ? "🏆 暂无访问数据。"
            : metric === "comment"
              ? "🏆 暂无评论数据。"
              : "🏆 暂无浏览数据。";
      await upsertHtml(ctx, emptyText, buildRankingKeyboard({ range, metric, isTenant }, showMoreActions));
      return;
    }
    const username = ctx.me?.username;
    const rangeTitle = range === "today" ? "今日" : range === "week" ? "本周" : "本月";
    const metricTitle = metric === "like" ? "收藏" : metric === "visit" ? "访问" : metric === "comment" ? "评论" : "浏览";
    const content = (
      await Promise.all(
        items.map(async (item, index) => {
          const order = index + 1;
          const titleText = escapeHtml(stripHtmlTags(item.title));
          const openLink = username && item.shareCode ? buildStartLink(username, `p_${item.shareCode}`) : undefined;
          const metricCount =
            metric === "like"
              ? (item as { likes: number }).likes
              : metric === "visit"
                ? (item as { visits: number }).visits
                : metric === "comment"
                  ? (item as { comments: number }).comments
                  : (item as { opens: number }).opens;
          const titleLine = `${order}. ${titleText} · ${metricTitle} ${metricCount} 次`;
          const openLine = openLink ? `<a href="${escapeHtml(openLink)}">点击查看</a>` : "";
          return [
            titleLine,
            openLine
          ]
            .filter(Boolean)
            .join("\n");
        })
      )
    ).join("\n\n");
    await upsertHtml(ctx, `🏆 排行｜${rangeTitle}·${metricTitle}\n\n${content}`, buildRankingKeyboard({ range, metric, isTenant }, showMoreActions));
  };

  const renderHelp = async (ctx: Context) => {
    deps.syncSessionForView(ctx);
    const botName = ctx.me?.first_name?.trim() || ctx.me?.username?.trim() || "bot";
    if (!deps.deliveryService || !ctx.from) {
      const text = [
        `📖 ${escapeHtml(botName)} 使用说明`,
        "",
        "🔓 打开内容",
        "发送打开哈希即可，例如：Abc123",
        "也可以发送：/start Abc123",
        "",
        "📚 列表 / 👣 足迹",
        "点下方按钮查看内容与足迹。",
        "",
        "⚠️ 当前未启用数据库，部分功能不可用。"
      ].join("\n");
      await upsertHtml(ctx, text, buildStartShortcutKeyboard());
      return;
    }

    const userId = String(ctx.from.id);
    const [isTenant, searchMode, rankPublic] = await Promise.all([
      deps.deliveryService.isTenantUser(userId).catch(() => false),
      deps.deliveryService.getTenantSearchMode().catch(() => "ENTITLED_ONLY" as const),
      deps.deliveryService.getTenantPublicRankingEnabled().catch(() => false)
    ]);

    if (isTenant) {
      const text = [
        `📖 ${escapeHtml(botName)} 使用说明（租户）`,
        "",
        "1) 发布作品",
        "点底部 分享 → 发送照片/视频/文件（可多条/相册）→ 点消息里的 ✅ 完成 → 按提示提交标题/描述。",
        "",
        "2) 保存后会得到",
        "打开哈希（给用户领取内容）",
        "管理（给你自己修改标题/描述）",
        "",
        "3) 用户如何领取",
        "把“打开哈希”发给我，或让用户使用 /start 打开哈希。",
        "",
        "4) 内容组织与运营",
        "在 ⚙️ 设置 管理管理员/分类/欢迎词/广告等；统计与排行可在设置页查看或点按钮进入。",
        rankPublic ? "提示：当前已对用户开放 🏆 排行。" : "提示：当前 🏆 排行 仅租户可见。",
        searchMode === "PUBLIC"
          ? "提示：当前已对用户开放 🔎 搜索。"
          : searchMode === "OFF"
            ? "提示：当前已关闭 🔎 搜索。"
            : "提示：当前 🔎 搜索 仅租户可用。"
      ]
        .filter(Boolean)
        .join("\n");
      await upsertHtml(ctx, text, buildHelpKeyboard());
      return;
    }

    const searchHint =
      searchMode === "PUBLIC"
        ? ["可直接发送关键词搜索，或发送：搜索 关键词。", "例如：搜索 教程。"].join("\n")
        : searchMode === "OFF"
          ? "当前未开放搜索；你可以用 📚 列表 或发送 #标签 浏览内容。"
          : "搜索仅对租户开放；你可以用 📚 列表 或发送 #标签 浏览内容。";
    const text = [
      `📖 ${escapeHtml(botName)} 使用说明`,
      "",
      "🔓 打开内容",
      "发送打开哈希即可，例如：Abc123",
      "也可以发送：/start Abc123",
      "",
      "📚 列表",
      "从列表里浏览内容，点 🔓 打开内容 领取文件。",
      "",
      "🔎 搜索 / 🏷 标签",
      searchHint,
      "发送 标签 可查看热门标签。",
      "",
      "👤 我的",
      "“我的”包含足迹、关注与通知设置。"
    ].join("\n");
    const keyboard = new InlineKeyboard()
      .text("📚 列表", "help:list")
      .text("👤 我的", "my:show")
      .row()
      .text("🏆 排行", "home:rank");
    await upsertHtml(ctx, text, keyboard);
  };

  const renderFollow = async (ctx: Context) => {
    deps.syncSessionForView(ctx);
    if (!deps.deliveryService) {
      await upsertHtml(ctx, buildDbDisabledHint("使用关注"), buildHelpKeyboard());
      return;
    }
    if (!ctx.from) {
      await upsertHtml(ctx, "⚠️ 无法识别当前用户。", buildHelpKeyboard());
      return;
    }
    const keywords = await deps.deliveryService.getUserFollowKeywords(String(ctx.from.id)).catch((error) => {
      logRendererError("follow_keywords", error);
      return [];
    });
    const list = keywords.length === 0 ? "暂无关键词。" : keywords.map((k, i) => `${i + 1}. ${escapeHtml(k)}`).join("\n");
    const text = [
      "🔔 关注",
      "",
      "设置最多 5 个关键词；当发布内容的标题/描述命中关键词时，我会通知你。",
      "",
      "当前关键词",
      list
    ].join("\n");
    await upsertHtml(ctx, text, buildFollowKeyboard({ keywords }));
  };

  const renderMy = async (ctx: Context) => {
    deps.syncSessionForView(ctx);
    if (!deps.deliveryService) {
      await upsertHtml(ctx, buildDbDisabledHint("查看我的信息"), buildHelpKeyboard());
      return;
    }
    if (!ctx.from) {
      await upsertHtml(ctx, "⚠️ 无法识别当前用户。", buildHelpKeyboard());
      return;
    }
    const userId = String(ctx.from.id);
    const summary = await deps.deliveryService.getUserProfileSummary(userId).catch((error) => {
      logRendererError("my_summary", error);
      return {
        displayName: null,
        activatedAt: null,
        lastSeenAt: null,
        activeDays: 0,
        visitCount: 0,
        openCount: 0,
        openedShares: 0
      };
    });
    const name = summary.displayName || [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "未设置昵称";
    const text = [
      "👤 我的",
      "",
      `昵称：${escapeHtml(name)}`,
      `ID：${escapeHtml(userId)}`,
      summary.activatedAt ? `激活时间：${escapeHtml(deps.formatLocalDateTime(summary.activatedAt))}` : "激活时间：—",
      summary.activeDays > 0 ? `激活天数：${summary.activeDays} 天` : "激活天数：—",
      `访问次数：${summary.visitCount}`,
      `打开次数：${summary.openCount}`,
      `访问过的分享：${summary.openedShares}`,
      summary.lastSeenAt ? `最近活跃：${escapeHtml(deps.formatLocalDateTime(summary.lastSeenAt))}` : ""
    ]
      .filter(Boolean)
      .join("\n");
    await upsertHtml(ctx, text, buildMyKeyboard());
  };

  const renderNotifySettings = async (ctx: Context) => {
    deps.syncSessionForView(ctx);
    if (!deps.deliveryService) {
      await upsertHtml(ctx, buildDbDisabledHint("配置通知"), buildHelpKeyboard());
      return;
    }
    if (!ctx.from) {
      await upsertHtml(ctx, "⚠️ 无法识别当前用户。", buildHelpKeyboard());
      return;
    }
    const settings = await deps.deliveryService.getUserNotifySettings(String(ctx.from.id)).catch((error) => {
      logRendererError("notify_settings", error);
      return {
        followEnabled: true,
        commentEnabled: true
      };
    });
    const text = [
      "🔕 通知设置",
      "",
      `关注命中通知：${settings.followEnabled ? "已开启" : "已关闭"}`,
      `评论/回复通知：${settings.commentEnabled ? "已开启" : "已关闭"}`,
      "",
      "提示：为避免打扰，系统会做去重与频控。"
    ].join("\n");
    await upsertHtml(ctx, text, buildNotifyKeyboard(settings));
  };

  const renderSettings = async (ctx: Context, showMoreActions = false) => {
    deps.syncSessionForView(ctx);
    if (!deps.deliveryService) {
      await upsertHtml(ctx, buildDbDisabledHint("打开设置"), buildHelpKeyboard());
      return;
    }
    if (!ctx.from) {
      await upsertHtml(ctx, "⚠️ 无法识别当前用户。", buildHelpKeyboard());
      return;
    }
    const userId = String(ctx.from.id);
    const isTenant = await deps.deliveryService.isTenantUser(userId);
    if (!isTenant) {
      await upsertHtml(ctx, "🔒 仅租户可打开设置。", buildHelpKeyboard());
      return;
    }
    const canManageAdmins = await deps.deliveryService.canManageAdmins(userId);
    const canManageCollections = await deps.deliveryService.canManageCollections(userId);
    const stats = await deps.deliveryService.getTenantHomeStats().catch(() => null);
    const admins = await deps.deliveryService.listTenantAdmins();
    const owners = admins.filter((m) => m.role === "OWNER");
    const adminOnly = admins.filter((m) => m.role !== "OWNER");
    const preview = admins
      .slice(0, 5)
      .map((m, index) => {
        const order = index + 1;
        const role = m.role === "OWNER" ? "OWNER" : "ADMIN";
        return `${order}. ${escapeHtml(m.tgUserId)} · ${role}`;
      })
      .join("\n");
    const content = [
      `OWNER：${owners.length} · ADMIN：${adminOnly.length}`,
      admins.length === 0 ? "暂无管理员。" : preview,
      admins.length > 5 ? `… 其余 ${admins.length - 5} 人请点击“👥 管理员列表”查看。` : ""
    ]
      .filter(Boolean)
      .join("\n");
    const adminIds = admins.filter((m) => m.role !== "OWNER").map((m) => m.tgUserId);
    const text = [
      "⚙️ 设置",
      stats
        ? [
            "",
            `📊 运营数据（截止到 ${escapeHtml(stats.asOfDate)}）`,
            `📁 Bot已存文件数：${stats.storedFiles}`,
            `累计运营时间：${stats.daysRunning} 天`,
            `累计用户数：${stats.totalUsers}`,
            `昨日新增用户数：${stats.newUsersYesterday}`,
            `昨日访问用户数：${stats.visitUsersYesterday}`,
            `累计下发文件次数：${stats.deliveriesTotal}`,
            `昨日下发文件次数：${stats.deliveriesYesterday}`
          ].join("\n")
        : "",
      "",
      "👥 管理员",
      content,
      "",
      canManageAdmins ? "点击“👥 管理员列表”进行移除，点击“➕ 添加管理员”新增管理员。" : "🔒 仅管理员可添加/移除管理员。"
    ]
      .filter(Boolean)
      .join("\n");
    await upsertHtml(ctx, text, buildSettingsKeyboard({ canManageAdmins, adminIds, canManageCollections }, showMoreActions));
  };

  const renderVaultSettings = async (ctx: Context) => {
    deps.syncSessionForView(ctx);
    if (!deps.deliveryService) {
      await upsertHtml(ctx, buildDbDisabledHint("配置存储群"), buildHelpKeyboard());
      return;
    }
    if (!ctx.from) {
      await upsertHtml(ctx, "⚠️ 无法识别当前用户。", buildHelpKeyboard());
      return;
    }
    const userId = String(ctx.from.id);
    if (!(await deps.deliveryService.isTenantUser(userId))) {
      await upsertHtml(ctx, "🔒 仅租户可配置存储群。", buildHelpKeyboard());
      return;
    }
    const canManage = await deps.deliveryService.canManageAdmins(userId);
    const minReplicas = await deps.deliveryService.getTenantMinReplicas().catch(() => 1);
    const groups = await deps.deliveryService.listVaultGroups().catch(() => []);
    const primary = groups.find((g) => g.role === "PRIMARY") ?? null;
    const backups = groups.filter((g) => g.role === "BACKUP");
    const statusLabel = (status: "ACTIVE" | "DEGRADED" | "BANNED") =>
      status === "ACTIVE" ? "正常" : status === "DEGRADED" ? "降级" : "封禁";
    const primaryLine = primary
      ? `主群：${escapeHtml(primary.chatId)} · ${statusLabel(primary.status)}`
      : "主群：未配置";
    const backupLines =
      backups.length === 0
        ? ["备份群：未配置"]
        : [
            "备份群：",
            ...backups.map((g, i) => `${i + 1}. ${escapeHtml(g.chatId)} · ${statusLabel(g.status)}`)
          ];
    const text = [
      "🗄 存储群",
      "",
      primaryLine,
      ...backupLines,
      "",
      `副本最小成功数：${minReplicas}`,
      "",
      "建议：主/备至少各 1 个；上传后尽量做多副本，单群被封时可切换继续交付。",
      "注意：添加新群前，需把所有 Bot（主/备）加入并授予管理员权限（能发消息/复制消息/创建话题）。",
      "",
      canManage ? "点击按钮进行配置。" : "🔒 仅管理员可修改。"
    ].join("\n");
    await upsertHtml(ctx, text, buildVaultKeyboard({ canManage, minReplicas, primaryId: primary?.vaultGroupId ?? null, groups }));
  };

  const renderWelcomeSettings = async (ctx: Context) => {
    deps.syncSessionForView(ctx);
    if (!deps.deliveryService) {
      await upsertHtml(ctx, buildDbDisabledHint("配置欢迎词"), buildHelpKeyboard());
      return;
    }
    if (!ctx.from) {
      await upsertHtml(ctx, "⚠️ 无法识别当前用户。", buildHelpKeyboard());
      return;
    }
    const userId = String(ctx.from.id);
    if (!(await deps.deliveryService.isTenantUser(userId))) {
      await upsertHtml(ctx, "🔒 仅租户可配置欢迎词。", buildHelpKeyboard());
      return;
    }
    const canManage = await deps.deliveryService.canManageAdmins(userId);
    const current = await deps.deliveryService.getTenantStartWelcomeHtml().catch(() => null);
    const preview = current?.trim() ? sanitizeTelegramHtml(current.trim()) : "👋 你好！这里是内容领取入口。\n发送打开哈希即可获取文件。";
    const text = [
      "<b>👋 /start 欢迎词</b>",
      "",
      canManage ? "支持 Telegram HTML（例如 <b>加粗</b> / <code>代码</code>）。" : "🔒 仅管理员可修改欢迎词。",
      "",
      "<b>当前预览：</b>",
      preview
    ].join("\n");
    await upsertHtml(ctx, text, buildWelcomeKeyboard(canManage));
  };

  const renderAdSettings = async (ctx: Context) => {
    deps.syncSessionForView(ctx);
    if (!deps.deliveryService) {
      await upsertHtml(ctx, buildDbDisabledHint("配置广告"), buildHelpKeyboard());
      return;
    }
    if (!ctx.from) {
      await upsertHtml(ctx, "⚠️ 无法识别当前用户。", buildHelpKeyboard());
      return;
    }
    const userId = String(ctx.from.id);
    if (!(await deps.deliveryService.isTenantUser(userId))) {
      await upsertHtml(ctx, "🔒 仅租户可配置广告。", buildHelpKeyboard());
      return;
    }
    const canManage = await deps.deliveryService.canManageAdmins(userId);
    const config = await deps.deliveryService.getTenantDeliveryAdConfig().catch(() => ({
      prevText: "⬅️ 上一页",
      nextText: "下一组 ➡️",
      adButtonText: null,
      adButtonUrl: null
    }));
    const hasAdButton = Boolean(config.adButtonText && config.adButtonUrl);
    const text = [
      "📣 领取翻页广告配置",
      "",
      "上一页按钮：已移除（用户上拉聊天记录即可查看上一组）",
      `下一组按钮：${escapeHtml(config.nextText)}`,
      "",
      hasAdButton
        ? `广告按钮：${escapeHtml(config.adButtonText as string)}\n广告链接：${escapeHtml(config.adButtonUrl as string)}`
        : "广告按钮：未启用",
      "",
      canManage ? "点击按钮逐项修改。" : "🔒 仅管理员可修改配置。"
    ].join("\n");
    await upsertHtml(ctx, text, buildAdKeyboard(canManage, hasAdButton));
  };

  const renderProtectSettings = async (ctx: Context) => {
    deps.syncSessionForView(ctx);
    if (!deps.deliveryService) {
      await upsertHtml(ctx, buildDbDisabledHint("配置内容保护"), buildHelpKeyboard());
      return;
    }
    if (!ctx.from) {
      await upsertHtml(ctx, "⚠️ 无法识别当前用户。", buildHelpKeyboard());
      return;
    }
    const userId = String(ctx.from.id);
    if (!(await deps.deliveryService.isTenantUser(userId))) {
      await upsertHtml(ctx, "🔒 仅租户可配置内容保护。", buildHelpKeyboard());
      return;
    }
    const canManage = await deps.deliveryService.canManageAdmins(userId);
    const enabled = await deps.deliveryService.getTenantProtectContentEnabled().catch(() => false);
    const text = [
      "🔒 内容保护（防转发/防保存）",
      "",
      `当前状态：${enabled ? "已开启" : "未开启"}`,
      "",
      "开启后：用户领取到的文件将不可转发、不可保存到相册/下载（Telegram 保护内容）。",
      "",
      canManage ? "点击按钮开启/关闭。" : "🔒 仅管理员可修改。"
    ].join("\n");
    await upsertHtml(ctx, text, buildProtectKeyboard({ canManage, enabled }));
  };

  const renderHidePublisherSettings = async (ctx: Context) => {
    deps.syncSessionForView(ctx);
    if (!deps.deliveryService) {
      await upsertHtml(ctx, buildDbDisabledHint("配置隐藏发布者"), buildHelpKeyboard());
      return;
    }
    if (!ctx.from) {
      await upsertHtml(ctx, "⚠️ 无法识别当前用户。", buildHelpKeyboard());
      return;
    }
    const userId = String(ctx.from.id);
    if (!(await deps.deliveryService.isTenantUser(userId))) {
      await upsertHtml(ctx, "🔒 仅租户可配置隐藏发布者。", buildHelpKeyboard());
      return;
    }
    const canManage = await deps.deliveryService.canManageAdmins(userId);
    const enabled = await deps.deliveryService.getTenantHidePublisherEnabled().catch(() => false);
    const text = [
      "🙈 隐藏发布者",
      "",
      `当前状态：${enabled ? "已开启" : "未开启"}`,
      "",
      "开启后：访客与普通用户打开/搜索/查看列表时不展示“发布者”信息；租户管理员与发布者本人仍可见。",
      "",
      canManage ? "点击按钮开启/关闭。" : "🔒 仅管理员可修改。"
    ].join("\n");
    await upsertHtml(ctx, text, buildHidePublisherKeyboard({ canManage, enabled }));
  };

  const renderAutoCategorizeSettings = async (ctx: Context) => {
    deps.syncSessionForView(ctx);
    if (!deps.deliveryService) {
      await upsertHtml(ctx, buildDbDisabledHint("配置自动归类"), buildHelpKeyboard());
      return;
    }
    if (!ctx.from) {
      await upsertHtml(ctx, "⚠️ 无法识别当前用户。", buildHelpKeyboard());
      return;
    }
    const userId = String(ctx.from.id);
    if (!(await deps.deliveryService.isTenantUser(userId))) {
      await upsertHtml(ctx, "🔒 仅租户可配置自动归类。", buildHelpKeyboard());
      return;
    }
    const canManage = await deps.deliveryService.canManageAdmins(userId);
    const enabled = await deps.deliveryService.getTenantAutoCategorizeEnabled().catch(() => false);
    const [rules, collections] = await Promise.all([
      deps.deliveryService.getTenantAutoCategorizeRules().catch(() => []),
      deps.deliveryService.listCollections().catch(() => [])
    ]);
    const titleById = new Map(collections.map((c) => [c.id, stripHtmlTags(c.title)]));
    const rulesText =
      rules.length === 0
        ? "（未配置关键词规则，将仅按“分类名称”是否出现在标题/描述里进行匹配）"
        : rules
            .slice(0, 20)
            .map((r, i) => {
              const title = titleById.get(r.collectionId) ?? r.collectionId;
              const kws = r.keywords.map((k) => escapeHtml(k)).join(" ");
              return `${i + 1}. ${escapeHtml(title)}：${kws}`;
            })
            .join("\n");
    const text = [
      "🤖 自动归类",
      "",
      `当前状态：${enabled ? "已开启" : "未开启"}`,
      "",
      "开启后：当你保存标题/描述时，如果该内容尚未手动选择分类，我会尝试根据标题/描述自动分配分类。",
      "",
      "关键词规则",
      rulesText,
      "",
      canManage ? "点击按钮开启/关闭，或编辑关键词规则。" : "🔒 仅管理员可修改。"
    ].join("\n");
    await upsertHtml(ctx, text, buildAutoCategorizeKeyboard({ canManage, enabled }));
  };

  const renderRankPublicSettings = async (ctx: Context) => {
    deps.syncSessionForView(ctx);
    if (!deps.deliveryService) {
      await upsertHtml(ctx, buildDbDisabledHint("配置排行开放"), buildHelpKeyboard());
      return;
    }
    if (!ctx.from) {
      await upsertHtml(ctx, "⚠️ 无法识别当前用户。", buildHelpKeyboard());
      return;
    }
    const userId = String(ctx.from.id);
    if (!(await deps.deliveryService.isTenantUser(userId))) {
      await upsertHtml(ctx, "🔒 仅租户可配置排行开放。", buildHelpKeyboard());
      return;
    }
    const canManage = await deps.deliveryService.canManageAdmins(userId);
    const enabled = await deps.deliveryService.getTenantPublicRankingEnabled().catch(() => false);
    const text = [
      "🏆 排行开放",
      "",
      `当前状态：${enabled ? "已对用户开放" : "仅租户可见"}`,
      "",
      "开启后：非租户用户也可以查看“🏆 排行”（今日/本周/本月），并可点击查看内容。",
      "",
      canManage ? "点击按钮开启/关闭。" : "🔒 仅管理员可修改。"
    ].join("\n");
    await upsertHtml(ctx, text, buildRankPublicKeyboard({ canManage, enabled }));
  };

  const renderSearchModeSettings = async (ctx: Context) => {
    deps.syncSessionForView(ctx);
    if (!deps.deliveryService) {
      await upsertHtml(ctx, buildDbDisabledHint("配置搜索开放"), buildHelpKeyboard());
      return;
    }
    if (!ctx.from) {
      await upsertHtml(ctx, "⚠️ 无法识别当前用户。", buildHelpKeyboard());
      return;
    }
    const userId = String(ctx.from.id);
    if (!(await deps.deliveryService.isTenantUser(userId))) {
      await upsertHtml(ctx, "🔒 仅租户可配置搜索开放。", buildHelpKeyboard());
      return;
    }
    const canManage = await deps.deliveryService.canManageAdmins(userId);
    const mode = await deps.deliveryService.getTenantSearchMode().catch(() => "ENTITLED_ONLY" as const);
    const statusText =
      mode === "PUBLIC" ? "已对用户开放" : mode === "OFF" ? "已关闭" : "仅租户可见";
    const text = [
      "🔎 搜索开放",
      "",
      `当前状态：${statusText}`,
      "",
      "对用户开放后：非租户用户可以直接发送关键词搜索内容，也可以发送 #标签 查看合集。",
      "",
      canManage ? "点击按钮切换模式。" : "🔒 仅管理员可修改。"
    ].join("\n");
    await upsertHtml(ctx, text, buildSearchModeKeyboard({ canManage, mode }));
  };

  const renderBroadcast = async (ctx: Context) => {
    deps.syncSessionForView(ctx);
    if (!deps.deliveryService) {
      await upsertHtml(ctx, buildDbDisabledHint("使用推送"), buildHelpKeyboard());
      return;
    }
    if (!ctx.from) {
      await upsertHtml(ctx, "⚠️ 无法识别当前用户。", buildHelpKeyboard());
      return;
    }
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!chatId) {
      await upsertHtml(ctx, "⚠️ 无法识别当前会话。", buildHelpKeyboard());
      return;
    }
    const userId = String(ctx.from.id);
    if (!(await deps.deliveryService.isTenantUser(userId))) {
      await upsertHtml(ctx, "🔒 仅租户可使用推送。", buildHelpKeyboard());
      return;
    }
    const canManage = await deps.deliveryService.canManageAdmins(userId);
    const key = toMetaKey(ctx.from.id, chatId);
    const draft = await deps.deliveryService.getMyBroadcastDraft(userId).catch(() => null);
    if (draft) {
      deps.broadcastDraftStates.set(key, { draftId: draft.id });
    } else {
      deps.broadcastDraftStates.delete(key);
    }
    const targetCount = canManage ? await deps.deliveryService.getBroadcastTargetCount(userId).catch(() => 0) : 0;
    const hasDraft = Boolean(draft);
    const isScheduled = draft?.status === "SCHEDULED" || draft?.status === "RUNNING";
    const canSend = Boolean(draft && draft.status === "DRAFT" && (draft.contentHtml.trim() || draft.mediaFileId));
    const statusText =
      draft?.status === "SCHEDULED"
        ? "⏰ 已安排"
        : draft?.status === "RUNNING"
          ? "🚚 推送中"
          : draft?.status === "DRAFT"
            ? "📝 草稿"
            : "—";
    const nextRun =
      draft?.nextRunAt ? `下次推送：${escapeHtml(deps.formatLocalDateTime(new Date(draft.nextRunAt)))}` : "下次推送：—";
    const repeat = draft?.repeatEveryMs ? `循环间隔：${Math.round(draft.repeatEveryMs / 60000)} 分钟` : "循环间隔：—";
    const contentPreview = draft?.contentHtml?.trim() ? sanitizeTelegramHtml(draft.contentHtml.trim()) : "（尚未设置文案）";
    const mediaLine = draft?.mediaKind ? `媒体：${escapeHtml(draft.mediaKind)}` : "媒体：—";
    const buttonsCount = draft ? draft.buttons.length : 0;
    const text = [
      "📢 全员推送",
      "",
      canManage ? `目标用户数：${targetCount}` : "🔒 仅管理员可创建与发送推送。",
      "",
      `状态：${statusText}`,
      hasDraft ? nextRun : "",
      hasDraft ? repeat : "",
      hasDraft ? mediaLine : "",
      hasDraft ? `按钮数：${buttonsCount}` : "",
      "",
      "文案预览：",
      contentPreview
    ]
      .filter(Boolean)
      .join("\n");
    await upsertHtml(ctx, text, buildBroadcastKeyboard({ canManage, hasDraft, canSend, isScheduled }));
  };

  const renderBroadcastButtons = async (ctx: Context) => {
    if (!deps.deliveryService || !ctx.from) {
      await renderBroadcast(ctx);
      return;
    }
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!chatId) {
      await renderBroadcast(ctx);
      return;
    }
    const userId = String(ctx.from.id);
    const canManage = await deps.deliveryService.canManageAdmins(userId);
    if (!canManage) {
      await upsertHtml(ctx, "🔒 仅管理员可配置推送按钮。", buildHelpKeyboard());
      return;
    }
    const draft = await deps.deliveryService.getMyBroadcastDraft(userId).catch(() => null);
    if (!draft || draft.status !== "DRAFT") {
      await upsertHtml(ctx, "⚠️ 未找到可编辑的推送草稿。", buildHelpKeyboard());
      return;
    }
    const text = [
      "🔗 推送按钮",
      "",
      draft.buttons.length === 0
        ? "暂无按钮。"
        : draft.buttons.map((b, index) => `${index + 1}. ${escapeHtml(b.text)}\n${escapeHtml(b.url)}`).join("\n\n")
    ].join("\n");
    await upsertHtml(ctx, text, buildBroadcastButtonsKeyboard({ buttons: draft.buttons }));
  };

  const renderStartHome = async (ctx: Context) => {
    const firstName = ctx.from?.first_name?.trim() || ctx.from?.username?.trim() || "朋友";
    const userId = ctx.from ? String(ctx.from.id) : "";
    const welcome = deps.deliveryService ? await deps.deliveryService.getTenantStartWelcomeHtml().catch(() => null) : null;
    const welcomeText = welcome?.trim() ? sanitizeTelegramHtml(welcome.trim()) : null;
    const botName = ctx.me?.first_name?.trim() || ctx.me?.username?.trim() || "bot";
    const intro = `这里是“${escapeHtml(botName)}”，用于领取与管理内容。`;
    const welcomeBlock = welcomeText ? ["", "——", welcomeText].join("\n") : "";
    const footer = ["〰️〰️〰️〰️〰️〰️", "<i>本支持机器人由 @V5MeshBot 提供技术支持</i>"].join("\n");
    if (!deps.deliveryService || !ctx.from) {
      await replyHtml(
        ctx,
        [
          `👋 你好，<b>${escapeHtml(firstName)}</b>`,
          userId ? `ID：<code>${escapeHtml(userId)}</code>` : "",
          intro,
          welcomeBlock,
          "",
          "快速开始",
          "发送打开哈希即可领取内容，例如：Abc123",
          footer,
          "⚠️ 当前未启用数据库，部分功能不可用。"
        ]
          .filter(Boolean)
          .join("\n"),
        {
        reply_markup: buildStartShortcutKeyboard()
        }
      );
      await replyHtml(ctx, "已为你打开菜单。", { reply_markup: deps.mainKeyboard });
      return;
    }
    const isTenant = await deps.deliveryService.isTenantUser(String(ctx.from.id)).catch(() => false);
    const roleLine = isTenant ? "👤 身份：<b>租户成员</b>（可发布作品）" : "👤 身份：<b>用户</b>（可浏览与领取内容）";
    const quickStart = isTenant
      ? ["<b>🚀 快速开始</b>", "点底部 分享 → 发送媒体 → 点 ✅ 完成 保存 → 按提示提交标题/描述。", "也可以发送打开哈希领取内容，例如：<code>Abc123</code>。"].join("\n")
      : ["<b>🚀 快速开始</b>", "发送打开哈希即可领取内容，例如：<code>Abc123</code>", "或点底部 📚 列表 / 🔎 搜索 浏览内容。"].join("\n");
    await replyHtml(
      ctx,
      [
        `👋 你好，<b>${escapeHtml(firstName)}</b>`,
        `ID：<code>${escapeHtml(String(ctx.from.id))}</code>`,
        intro,
        "",
        roleLine,
        "",
        quickStart,
        welcomeBlock,
        "",
        footer
      ]
        .filter(Boolean)
        .join("\n"),
      {
        reply_markup: buildStartShortcutKeyboard()
      }
    );
    if (isTenant) {
      await replyHtml(ctx, "已为你打开菜单（分享/列表/搜索/足迹/我的/设置）。", { reply_markup: deps.mainKeyboard });
      return;
    }
    await replyHtml(ctx, "已为你打开菜单（列表/搜索/足迹/我的）。", { reply_markup: buildUserKeyboard() });
  };


  return {
    renderStats,
    renderRanking,
    renderHelp,
    renderMy,
    renderFollow,
    renderNotifySettings,
    renderSettings,
    renderVaultSettings,
    renderWelcomeSettings,
    renderAdSettings,
    renderProtectSettings,
    renderHidePublisherSettings,
    renderAutoCategorizeSettings,
    renderRankPublicSettings,
    renderSearchModeSettings,
    renderBroadcast,
    renderBroadcastButtons,
    renderStartHome
  };
};
