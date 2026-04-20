import { InlineKeyboard, Keyboard } from "grammy";
import {
  getDeleteDraftLabel,
  getEditLabel,
  getFootprintLabel,
  getListLabel,
  getMyLabel,
  getNotifyLabel,
  getOpenContentLabel,
  getPreviewLabel,
  getRankingLabel,
  getRecentReportLabel,
  getRecycleBinLabel,
  getRecycleLabel,
  getRestoreLabel,
  getSearchLabel,
  getSettingsLabel,
  getShareLabel,
  getShowLabel,
  getStatsLabel,
  getHideLabel
} from "./labels";
import { safeCallbackData, stripHtmlTags, truncatePlainText } from "./ui-utils";

export const actionKeyboard = new InlineKeyboard().text("✅ 完成", "upload:commit").text("❌ 取消", "upload:cancel");

const addBackHomeRow = (keyboard: InlineKeyboard, backText: string, backCallback: string) => {
  return keyboard.text(backText, backCallback).text("🏠 首页", "home:back");
};

const addRefreshRow = (keyboard: InlineKeyboard, refreshCallback: string) => {
  return keyboard.row().text("🔄 刷新", refreshCallback);
};

export const buildMainKeyboard = (locale?: string | null) => {
  return new Keyboard()
    .text(getShareLabel({ locale }))
    .text(getListLabel({ locale }))
    .text(getSearchLabel({ locale }))
    .row()
    .text(getFootprintLabel({ locale }))
    .text(getMyLabel({ locale }))
    .text(getSettingsLabel({ locale }))
    .resized();
};

export const buildUserKeyboard = (locale?: string | null) => {
  return new Keyboard().text(getListLabel({ locale })).text(getSearchLabel({ locale })).row().text(getFootprintLabel({ locale })).text(getMyLabel({ locale })).resized();
};

export const buildOpenKeyboard = (assetId: string) => {
  return new InlineKeyboard().text(getOpenContentLabel(), safeCallbackData(`asset:open:${assetId}`, "asset:noop"));
};

export const buildManageKeyboard = (assetId: string, options?: { searchable: boolean; recycled?: boolean }) => {
  const searchable = options?.searchable ?? true;
  const recycled = options?.recycled ?? false;
  return new InlineKeyboard()
    .text(getEditLabel(), safeCallbackData(`asset:meta:${assetId}`, "asset:noop"))
    .text(searchable ? getHideLabel() : getShowLabel(), safeCallbackData(`asset:searchable:${assetId}:${searchable ? "0" : "1"}`, "asset:noop"))
    .row()
    .text(recycled ? getRestoreLabel() : getRecycleLabel(), safeCallbackData(recycled ? `asset:recycle:restore:${assetId}` : `asset:recycle:${assetId}`, "asset:noop"))
    .text(getOpenContentLabel(), safeCallbackData(`asset:open:${assetId}`, "asset:noop"))
    .row()
    .text(getRecycleBinLabel(), "asset:recycle:list:1");
};

export const buildManageRecycleConfirmKeyboard = (assetId: string) => {
  return new InlineKeyboard()
    .text("⬅️ 返回管理", safeCallbackData(`asset:manage:${assetId}`, "asset:noop"))
    .row()
    .text("⚠️ 确认回收", safeCallbackData(`asset:recycle:confirm:${assetId}`, "asset:noop"));
};

export const buildRecycleBinKeyboard = (items: { assetId: string; title: string }[], page: number, totalPages: number) => {
  const current = Math.min(Math.max(page, 1), Math.max(totalPages, 1));
  const keyboard = addBackHomeRow(new InlineKeyboard(), "⬅️ 返回管理", "help:show");
  if (items.length > 0) {
    keyboard.row().text("♻️ 恢复本页", `asset:recycle:restore_page:${current}`);
  }
  for (const item of items) {
    const title = truncatePlainText(stripHtmlTags(item.title), 16);
    keyboard.row().text(`♻️ 恢复 ${title}`, `asset:recycle:restore:${item.assetId}`);
  }
  if (totalPages > 1) {
    const prev = current > 1 ? current - 1 : 1;
    const next = current < totalPages ? current + 1 : totalPages;
    keyboard
      .row()
      .text("⬅️ 上一页", current > 1 ? `asset:recycle:list:${prev}` : "asset:noop")
      .text(`${current}/${totalPages}`, "asset:noop")
      .text("下一页 ➡️", current < totalPages ? `asset:recycle:list:${next}` : "asset:noop");
  }
  addRefreshRow(keyboard, `asset:recycle:list:${current}`);
  return keyboard;
};

export const buildHomeKeyboard = (locale?: string | null) => {
  return new InlineKeyboard()
    .text(getListLabel({ locale }), "help:list")
    .text(getSettingsLabel({ locale }), "help:settings")
    .row()
    .text(getStatsLabel({ locale }), "home:stats")
    .text(getRankingLabel({ locale }), "home:rank");
};

export const buildStartShortcutKeyboard = (locale?: string | null) => {
  return new InlineKeyboard()
    .text(getRankingLabel({ locale }), "home:rank")
    .text(getListLabel({ locale }), "help:list")
    .text(getFootprintLabel({ locale }), "user:history");
};

export const buildHomeDetailKeyboard = (active: "stats" | "rank", locale?: string | null) => {
  const keyboard = new InlineKeyboard().text("🏠 首页", "home:back");
  if (active === "stats") {
    keyboard.text(getRankingLabel({ locale }), "home:rank");
  } else {
    keyboard.text(getStatsLabel({ locale }), "home:stats");
  }
  return keyboard;
};

export const buildHelpKeyboard = (locale?: string | null) => {
  return new InlineKeyboard()
    .text(getListLabel({ locale }), "help:list")
    .text(getSettingsLabel({ locale }), "help:settings")
    .row()
    .text(getStatsLabel({ locale }), "home:stats")
    .text(getRankingLabel({ locale }), "home:rank")
    .text(getMyLabel({ locale }), "my:show")
    .row()
    .text(getNotifyLabel({ locale }), "notify:show");
};

export const buildFollowKeyboard = (options: { keywords: string[] }) => {
  const keyboard = addBackHomeRow(new InlineKeyboard(), "⬅️ 返回", "my:show");
  if (options.keywords.length >= 5) {
    keyboard.row().text("➕ 添加（已满）", "follow:noop");
  } else {
    keyboard.row().text("➕ 添加关键词", "follow:add");
  }
  options.keywords.forEach((k, index) => {
    const title = truncatePlainText(stripHtmlTags(k), 16);
    keyboard.row().text(`🗑 ${title}`, `follow:remove:${index}`);
  });
  if (options.keywords.length > 0) {
    keyboard.row().text("🧹 清空", "follow:clear");
  }
  addRefreshRow(keyboard, "follow:show");
  return keyboard;
};

export const buildFollowInputKeyboard = () => {
  return new InlineKeyboard().text("❌ 取消", "follow:cancel").text("⬅️ 返回", "follow:show");
};

export const buildNotifyKeyboard = (options: { followEnabled: boolean; commentEnabled: boolean }) => {
  return addBackHomeRow(new InlineKeyboard(), "⬅️ 返回", "my:show")
    .row()
    .text(`收藏通知：${options.followEnabled ? "开" : "关"}`, "notify:noop")
    .text(options.followEnabled ? "关闭" : "开启", options.followEnabled ? "notify:toggle:follow:0" : "notify:toggle:follow:1")
    .row()
    .text(`评论通知：${options.commentEnabled ? "开" : "关"}`, "notify:noop")
    .text(options.commentEnabled ? "关闭" : "开启", options.commentEnabled ? "notify:toggle:comment:0" : "notify:toggle:comment:1")
    .row()
    .text("🔄 刷新", "notify:show");
};

export const buildMyKeyboard = () => {
  return new InlineKeyboard()
    .text("👣 足迹", "user:history")
    .text("⭐ 收藏", "follow:show")
    .row()
    .text("🔕 通知", "notify:show")
    .text("🔄 刷新", "my:show")
    .row()
    .text("🏠 首页", "home:back");
};

export const buildSettingsKeyboard = (
  options: { canManageProjectAdmins: boolean; adminIds: string[]; canManageProjectCollections: boolean },
  showMoreActions = false
) => {
  const keyboard = addBackHomeRow(new InlineKeyboard(), "⬅️ 返回", "help:show");
  keyboard.row().text("🔎 搜索开放", "settings:search_mode").text("🙈 隐藏发布者", "settings:hide_publisher");
  keyboard.row().text("📁 分类", "settings:collections").text("📢 推送", "settings:broadcast");
  const sortedAdminIds = [...options.adminIds].sort((a, b) => {
    try {
      const left = BigInt(a);
      const right = BigInt(b);
      if (left === right) {
        return 0;
      }
      return left < right ? 1 : -1;
    } catch {
      return b.localeCompare(a);
    }
  });
  if (options.canManageProjectAdmins) {
    keyboard.row().text("👥 管理员列表", "settings:admin:list:1").text("➕ 添加管理员", "settings:admin:add");
  }
  if (showMoreActions) {
    keyboard
      .row()
      .text("🏆 排行开放", "settings:rank_public")
      .text("🔒 内容保护", "settings:protect")
      .row()
      .text("🤖 自动归类", "settings:auto_categorize")
      .text("👋 欢迎词", "settings:welcome")
      .text("📣 配置广告", "settings:ads")
      .row()
      .text("🗄 存储群", "settings:vault")
      .text("🔕 通知", "notify:show")
      .row()
      .text("📚 列表", "help:list")
      .text("📊 统计", "home:stats")
      .text("🏆 排行", "home:rank")
      .row()
      .text("🔄 刷新", "help:settings")
      .text("⬆️ 收起", "settings:less");
  } else {
    keyboard.row().text("🔄 刷新", "help:settings").text("⋯ 更多", "settings:more");
  }
  return keyboard;
};

export const buildAdminManageKeyboard = (options: { adminIds: string[]; page: number }) => {
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(options.adminIds.length / pageSize));
  const current = Math.min(Math.max(options.page, 1), totalPages);
  const offset = (current - 1) * pageSize;
  const sortedAdminIds = [...options.adminIds].sort((a, b) => {
    try {
      const left = BigInt(a);
      const right = BigInt(b);
      if (left === right) {
        return 0;
      }
      return left < right ? 1 : -1;
    } catch {
      return b.localeCompare(a);
    }
  });
  const visible = sortedAdminIds.slice(offset, offset + pageSize);
  const keyboard = addBackHomeRow(new InlineKeyboard(), "⬅️ 返回设置", "help:settings");
  keyboard.row().text("➕ 添加管理员", "settings:admin:add");
  for (const adminId of visible) {
    keyboard.row().text(`🗑 移除 ${adminId}`, `settings:admin:remove:${adminId}:${current}`);
  }
  if (totalPages > 1) {
    const prev = current > 1 ? current - 1 : 1;
    const next = current < totalPages ? current + 1 : totalPages;
    const prevAction = current > 1 ? `settings:admin:list:${prev}` : "settings:admin:noop";
    const nextAction = current < totalPages ? `settings:admin:list:${next}` : "settings:admin:noop";
    keyboard.row().text("⬅️ 上一页", prevAction).text(`${current}/${totalPages}`, "settings:admin:noop").text("下一页 ➡️", nextAction);
  }
  addRefreshRow(keyboard, `settings:admin:list:${current}`);
  return keyboard;
};

export const buildAdminRemoveConfirmKeyboard = (adminId: string, page: number) => {
  return new InlineKeyboard()
    .text("⬅️ 返回列表", `settings:admin:cancelremove:${page}`)
    .text("🏠 首页", "home:back")
    .row()
    .text("⚠️ 确认移除", `settings:admin:confirmremove:${adminId}:${page}`);
};

export const buildVaultKeyboard = (options: {
  canManage: boolean;
  primaryId: string | null;
  minReplicas: number;
  groups: Array<{
    vaultGroupId: string;
    role: "PRIMARY" | "BACKUP" | "COLD";
    status: "ACTIVE" | "DEGRADED" | "BANNED";
  }>;
}) => {
  const keyboard = addBackHomeRow(new InlineKeyboard(), "⬅️ 返回", "help:settings");
  if (options.canManage) {
    keyboard
      .row()
      .text(`min副本：${options.minReplicas}`, "vault:noop")
      .text(options.minReplicas === 1 ? "1 ✅" : "1", "vault:minreplicas:set:1")
      .text(options.minReplicas === 2 ? "2 ✅" : "2", "vault:minreplicas:set:2")
      .text(options.minReplicas === 3 ? "3 ✅" : "3", "vault:minreplicas:set:3");
    keyboard.row().text("➕ 添加备份群", "vault:add_backup");
    for (const group of options.groups) {
      const id = group.vaultGroupId;
      const isPrimary = options.primaryId === id;
      const statusLabel =
        group.status === "ACTIVE" ? "✅ 正常" : group.status === "DEGRADED" ? "⚠️ 降级" : "⛔ 封禁";
      const nextStatus = group.status === "BANNED" ? "ACTIVE" : "BANNED";
      keyboard.row().text(statusLabel, "vault:noop").text("切换状态", `vault:set_status:${id}:${nextStatus}`);
      if (!isPrimary) {
        keyboard.row().text("⭐ 设为主群", `vault:set_primary:${id}`);
      }
      if (group.role === "BACKUP") {
        keyboard.row().text("🗑 移除备份", `vault:remove_backup:${id}`);
      }
    }
  }
  addRefreshRow(keyboard, "settings:vault");
  return keyboard;
};

export const buildProtectKeyboard = (options: { canManage: boolean; enabled: boolean }) => {
  const keyboard = addBackHomeRow(new InlineKeyboard(), "⬅️ 返回", "help:settings");
  if (options.canManage) {
    keyboard
      .row()
      .text(options.enabled ? "✅ 已开启" : "❌ 未开启", "protect:noop")
      .text(options.enabled ? "关闭" : "开启", options.enabled ? "protect:set:0" : "protect:set:1");
  }
  addRefreshRow(keyboard, "settings:protect");
  return keyboard;
};

export const buildHidePublisherKeyboard = (options: { canManage: boolean; enabled: boolean }) => {
  const keyboard = addBackHomeRow(new InlineKeyboard(), "⬅️ 返回", "help:settings");
  if (options.canManage) {
    keyboard
      .row()
      .text(options.enabled ? "✅ 已开启" : "❌ 未开启", "hide_publisher:noop")
      .text(options.enabled ? "关闭" : "开启", options.enabled ? "hide_publisher:set:0" : "hide_publisher:set:1");
  }
  addRefreshRow(keyboard, "settings:hide_publisher");
  return keyboard;
};

export const buildAutoCategorizeKeyboard = (options: { canManage: boolean; enabled: boolean }) => {
  const keyboard = addBackHomeRow(new InlineKeyboard(), "⬅️ 返回", "help:settings");
  if (options.canManage) {
    keyboard
      .row()
      .text(options.enabled ? "✅ 已开启" : "❌ 未开启", "auto_categorize:noop")
      .text(options.enabled ? "关闭" : "开启", options.enabled ? "auto_categorize:set:0" : "auto_categorize:set:1");
    keyboard.row().text("✏️ 设置关键词", "auto_categorize:rules:edit");
    keyboard.row().text("🧹 清空关键词", "auto_categorize:rules:clear");
  }
  addRefreshRow(keyboard, "settings:auto_categorize");
  return keyboard;
};

export const buildRankPublicKeyboard = (options: { canManage: boolean; enabled: boolean }) => {
  const keyboard = addBackHomeRow(new InlineKeyboard(), "⬅️ 返回", "help:settings");
  if (options.canManage) {
    keyboard
      .row()
      .text(options.enabled ? "✅ 已开启" : "❌ 未开启", "rank_public:noop")
      .text(options.enabled ? "关闭" : "开启", options.enabled ? "rank_public:set:0" : "rank_public:set:1");
  }
  addRefreshRow(keyboard, "settings:rank_public");
  return keyboard;
};

export const buildSearchModeKeyboard = (options: { canManage: boolean; mode: "OFF" | "ENTITLED_ONLY" | "PUBLIC" }) => {
  const keyboard = addBackHomeRow(new InlineKeyboard(), "⬅️ 返回", "help:settings");
  if (options.canManage) {
    keyboard.row().text("当前模式", "search_mode:noop");
    keyboard
      .row()
      .text(options.mode === "PUBLIC" ? "✅ 对用户开放" : "对用户开放", "search_mode:set:PUBLIC")
      .text(options.mode === "ENTITLED_ONLY" ? "✅ 仅租户可见" : "仅租户可见", "search_mode:set:ENTITLED_ONLY")
      .text(options.mode === "OFF" ? "✅ 关闭" : "关闭", "search_mode:set:OFF");
  }
  addRefreshRow(keyboard, "settings:search_mode");
  return keyboard;
};

export const buildRankingKeyboard = (options: {
  range: "today" | "week" | "month";
  metric: "open" | "visit" | "like" | "comment";
  isTenant: boolean;
}, showMoreActions = false) => {
  const keyboard = new InlineKeyboard();
  keyboard
    .row()
    .text(options.metric === "open" ? "浏览 ✅" : "浏览", "rank:metric:open")
    .text(options.metric === "visit" ? "访问 ✅" : "访问", "rank:metric:visit");
  keyboard
    .row()
    .text(options.metric === "like" ? "收藏 ✅" : "收藏", "rank:metric:like")
    .text(options.metric === "comment" ? "评论 ✅" : "评论", "rank:metric:comment");
  keyboard
    .row()
    .text(options.range === "today" ? "今日 ✅" : "今日", "rank:range:today")
    .text(options.range === "week" ? "本周 ✅" : "本周", "rank:range:week")
    .text(options.range === "month" ? "本月 ✅" : "本月", "rank:range:month");
  if (showMoreActions) {
    keyboard
      .row()
      .text("🏠 首页", "home:back")
      .text("📚 列表", "help:list")
      .text(options.isTenant ? "📊 统计" : "👣 足迹", options.isTenant ? "home:stats" : "user:history")
      .row()
      .text("⬆️ 收起", `rank:less:${options.range}:${options.metric}`);
  } else {
    keyboard.row().text("⋯ 更多", `rank:more:${options.range}:${options.metric}`);
  }
  return keyboard;
};

export const buildBroadcastKeyboard = (options: {
  canManage: boolean;
  hasSelection: boolean;
  isDraft: boolean;
  canSend: boolean;
  isScheduled: boolean;
  showListEntry?: boolean;
}) => {
  const keyboard = addBackHomeRow(new InlineKeyboard(), "⬅️ 返回设置", "help:settings");
  if (!options.canManage) {
    addRefreshRow(keyboard, "settings:broadcast");
    return keyboard;
  }
  if (!options.hasSelection) {
    keyboard.row().text("➕ 新建草稿", "broadcast:create");
    keyboard.row().text("🗂 推送列表", "broadcast:list");
    addRefreshRow(keyboard, "settings:broadcast");
    return keyboard;
  }
  if (options.isDraft) {
    keyboard.row().text(getEditLabel(), "broadcast:edit:content").text("配置按钮", "broadcast:edit:buttons");
  }
  keyboard.row().text(getPreviewLabel(), "broadcast:preview");
  if (options.canSend) {
    keyboard.row().text("🚀 立即推送", "broadcast:send:now").text("⏰ 定时推送", "broadcast:send:schedule");
    keyboard.row().text("🔁 循环推送", "broadcast:send:repeat");
  }
  if (options.isScheduled) {
    keyboard.row().text("🛑 取消推送", "broadcast:cancel");
  }
  if (options.isDraft) {
    keyboard.row().text(getDeleteDraftLabel(), "broadcast:delete");
  }
  keyboard.row().text(getRecentReportLabel(), "broadcast:runs");
  if (options.showListEntry !== false) {
    keyboard.row().text("🗂 推送列表", "broadcast:list").text("➕ 新建草稿", "broadcast:create");
  }
  addRefreshRow(keyboard, "settings:broadcast");
  return keyboard;
};

export const buildBroadcastButtonsKeyboard = (options: { buttons: { text: string; url: string }[] }) => {
  const keyboard = addBackHomeRow(new InlineKeyboard(), "⬅️ 返回", "settings:broadcast");
  keyboard.row().text("➕ 添加按钮", "broadcast:buttons:add");
  options.buttons.forEach((b, index) => {
    const title = truncatePlainText(b.text, 16);
    keyboard.row().text(`🗑 ${title}`, `broadcast:buttons:remove:${index}`);
  });
  addRefreshRow(keyboard, "broadcast:edit:buttons");
  return keyboard;
};

export const buildBroadcastPreviewKeyboard = (options: { buttons: { text: string; url: string }[] }) => {
  const keyboard = addBackHomeRow(new InlineKeyboard(), "⬅️ 返回", "settings:broadcast");
  if (options.buttons.length > 0) {
    for (const b of options.buttons) {
      keyboard.row().url(b.text, b.url);
    }
  }
  return keyboard;
};

export const buildWelcomeKeyboard = (canManage: boolean) => {
  const keyboard = addBackHomeRow(new InlineKeyboard(), "⬅️ 返回", "help:settings");
  if (canManage) {
    keyboard.row().text("✏️ 修改", "welcome:edit").text("↩️ 重置", "welcome:reset");
  }
  addRefreshRow(keyboard, "settings:welcome");
  return keyboard;
};

export const buildAdKeyboard = (canManage: boolean, hasAdButton: boolean) => {
  const keyboard = addBackHomeRow(new InlineKeyboard(), "⬅️ 返回", "help:settings");
  if (canManage) {
    keyboard
      .row()
      .text("下一组文案", "ads:edit:next")
      .row()
      .text("广告按钮文案", "ads:edit:btn_text")
      .text("广告按钮链接", "ads:edit:btn_url");
    if (hasAdButton) {
      keyboard.row().text("🧹 清除广告按钮", "ads:clear_button");
    }
    keyboard.row().text("↩️ 重置默认", "ads:reset");
  }
  addRefreshRow(keyboard, "settings:ads");
  return keyboard;
};

export const buildAdminInputKeyboard = () => {
  return new InlineKeyboard().text("❌ 取消", "settings:admin:cancel");
};

export const buildSettingsInputKeyboard = () => {
  return new InlineKeyboard().text("❌ 取消", "settings:input:cancel").text("⬅️ 返回", "help:settings");
};

export const buildMetaInputKeyboard = () => {
  return new InlineKeyboard().text("❌ 取消", "meta:cancel");
};

export const buildCollectionsKeyboard = (options: {
  canManage: boolean;
  selectedId: string | null;
  collections: { id: string; title: string }[];
  page: number;
}) => {
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(options.collections.length / pageSize));
  const current = Math.min(Math.max(options.page, 1), totalPages);
  const offset = (current - 1) * pageSize;
  const visible = options.collections.slice(offset, offset + pageSize);
  const keyboard = addBackHomeRow(new InlineKeyboard(), "⬅️ 返回", "help:settings");
  if (options.canManage) {
    keyboard.row().text("➕ 新建分类", "collections:create");
  }
  keyboard.row().text(options.selectedId === null ? "✅ 未分类" : "▫️ 未分类", "collections:select:none");
  for (const collection of visible) {
    const title = truncatePlainText(stripHtmlTags(collection.title), 24);
    const prefix = collection.id === options.selectedId ? "✅ " : "▫️ ";
    if (options.canManage) {
      keyboard
        .row()
        .text(`${prefix}${title}`, `collections:select:${collection.id}`)
        .text("✏️", `collections:rename:${collection.id}`)
        .text("🗑", `collections:confirmdelete:${collection.id}`);
    } else {
      keyboard.row().text(`${prefix}${title}`, `collections:select:${collection.id}`);
    }
  }
  if (totalPages > 1) {
    const prev = current > 1 ? current - 1 : 1;
    const next = current < totalPages ? current + 1 : totalPages;
    const prevAction = current > 1 ? `collections:page:${prev}` : "collections:noop";
    const nextAction = current < totalPages ? `collections:page:${next}` : "collections:noop";
    keyboard.row().text("⬅️ 上一页", prevAction).text(`${current}/${totalPages}`, "collections:noop").text("下一页 ➡️", nextAction);
  }
  addRefreshRow(keyboard, `collections:page:${current}`);
  return keyboard;
};

export const buildCollectionInputKeyboard = () => {
  return new InlineKeyboard().text("❌ 取消", "collections:cancel");
};

export const buildCollectionDeleteConfirmKeyboard = (collectionId: string) => {
  return new InlineKeyboard()
    .text("⬅️ 返回", "settings:collections")
    .row()
    .text("✅ 确认删除", `collections:delete:${collectionId}`)
    .text("❌ 取消", "settings:collections");
};

export const buildHistoryFilterKeyboard = (collections: { id: string; title: string }[], current: string) => {
  const keyboard = new InlineKeyboard().text("⬅️ 返回列表", "history:back").row();
  keyboard.text(current === "all" ? "✅ 全部" : "全部", "history:setfilter:all");
  keyboard.text(current === "none" ? "✅ 未分类" : "未分类", "history:setfilter:none");
  for (const collection of collections) {
    const title = truncatePlainText(stripHtmlTags(collection.title), 24);
    const key = `c:${collection.id}`;
    keyboard.row().text(current === key ? `✅ ${title}` : title, `history:setfilter:collection:${collection.id}`);
  }
  return keyboard;
};

export const buildHistoryKeyboard = (
  page: number,
  totalPages: number,
  filterLabel: string,
  date: Date,
  scope: "community" | "mine",
  showMoreActions = false
) => {
  const current = page < 1 ? 1 : page;
  const maxPage = totalPages < 1 ? 1 : totalPages;
  const prev = current > 1 ? current - 1 : 1;
  const next = current < maxPage ? current + 1 : maxPage;
  const prevAction = current > 1 ? `history:page:${prev}` : "history:noop";
  const nextAction = current < maxPage ? `history:page:${next}` : "history:noop";
  const startOfLocalDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const pad2 = (value: number) => String(value).padStart(2, "0");
  const formatLocalDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const todayStart = startOfLocalDay(new Date());
  const dateStart = startOfLocalDay(date);
  const prevDayAction = "history:day:prev";
  const nextDayAction = dateStart.getTime() < todayStart.getTime() ? "history:day:next" : "history:noop";
  const keyboard = new InlineKeyboard()
    .text(scope === "community" ? "🌐 社区 ✅" : "🌐 社区", scope === "community" ? "history:noop" : "history:scope:community")
    .text(scope === "mine" ? "👤 我的 ✅" : "👤 我的", scope === "mine" ? "history:noop" : "history:scope:mine")
    .row()
    .text("前一天", prevDayAction)
    .text(formatLocalDate(dateStart), "history:noop")
    .text("后一天", nextDayAction)
    .row()
    .text("📅 今天", "history:day:today")
    .text("🔄 刷新", `history:refresh:${current}`)
    .row()
    .text("⬅️ 上一页", prevAction)
    .text(`${current}/${maxPage}`, "history:noop")
    .text("下一页 ➡️", nextAction);
  if (showMoreActions) {
    keyboard
      .row()
      .text("📁 筛选", "history:filter")
      .text(filterLabel, "history:noop")
      .row()
      .text("🏆 排行", "home:rank")
      .text("🏠 首页", "home:back")
      .row()
      .text("⬆️ 收起", `history:less:${current}`);
  } else {
    keyboard.row().text("⋯ 更多", `history:more:${current}`);
  }
  return keyboard;
};

export const buildUserHistoryKeyboard = (page: number, totalPages: number) => {
  const current = page < 1 ? 1 : page;
  const maxPage = totalPages < 1 ? 1 : totalPages;
  const prev = current > 1 ? current - 1 : 1;
  const next = current < maxPage ? current + 1 : maxPage;
  const prevAction = current > 1 ? `uh:page:${prev}` : "uh:noop";
  const nextAction = current < maxPage ? `uh:page:${next}` : "uh:noop";
  return new InlineKeyboard()
    .text("🔄 刷新", `uh:refresh:${current}`)
    .row()
    .text("⬅️ 上一页", prevAction)
    .text(`${current}/${maxPage}`, "uh:noop")
    .text("下一页 ➡️", nextAction)
    .row()
    .text("🏠 首页", "home:back");
};

export const buildFootprintKeyboard = (options: {
  tab: "open" | "like" | "comment" | "reply";
  range: "7d" | "30d" | "all";
  page: number;
  totalPages: number;
}, showMoreActions = false) => {
  const current = options.page < 1 ? 1 : options.page;
  const maxPage = options.totalPages < 1 ? 1 : options.totalPages;
  const prev = current > 1 ? current - 1 : 1;
  const next = current < maxPage ? current + 1 : maxPage;
  const range = options.range;
  const prevAction = current > 1 ? `foot:page:${options.tab}:${prev}:${range}` : "foot:noop";
  const nextAction = current < maxPage ? `foot:page:${options.tab}:${next}:${range}` : "foot:noop";
  const keyboard = new InlineKeyboard()
    .text(options.tab === "open" ? "最近浏览 ✅" : "最近浏览", "foot:tab:open")
    .text(options.tab === "like" ? "收藏 ✅" : "收藏", "foot:tab:like")
    .row()
    .text(options.tab === "comment" ? "评论 ✅" : "评论", "foot:tab:comment")
    .text(options.tab === "reply" ? "回复 ✅" : "回复", "foot:tab:reply");
  keyboard
    .row()
    .text("⬅️ 上一页", prevAction)
    .text(`${current}/${maxPage}`, "foot:noop")
    .text("下一页 ➡️", nextAction);
  if (showMoreActions) {
    const rangeLabel = range === "7d" ? "⏱ 近7天" : range === "30d" ? "⏱ 近30天" : "⏱ 全部";
    keyboard
      .row()
      .text("🔄 刷新", `foot:refresh:${options.tab}:${current}:${range}`)
      .text(rangeLabel, `foot:range:${options.tab}:${range}`)
      .text("🏠 首页", "home:back")
      .row()
      .text("⬆️ 收起", `foot:less:${options.tab}:${current}:${range}`);
  } else {
    keyboard.row().text("⋯ 更多", `foot:more:${options.tab}:${current}:${range}`);
  }
  return keyboard;
};

export const buildAssetPageKeyboard = (
  assetId: string,
  page: number,
  totalPages: number,
  options?: { prevText?: string; nextText?: string; adButtonText?: string | null; adButtonUrl?: string | null }
) => {
  const current = page < 1 ? 1 : page;
  const maxPage = totalPages < 1 ? 1 : totalPages;
  const next = current < maxPage ? current + 1 : maxPage;
  const nextAction = current < maxPage ? `asset:page:${assetId}:${next}` : "asset:noop";
  const nextText = options?.nextText?.trim() || "下一组 ➡️";
  const label = current < maxPage ? `${current}/${maxPage} ${nextText}` : `${current}/${maxPage} 已是最后一组`;
  const keyboard = new InlineKeyboard().text(label, nextAction);
  const adText = options?.adButtonText?.trim() || "";
  const adUrl = options?.adButtonUrl?.trim() || "";
  if (adText && adUrl) {
    keyboard.row().url(adText, adUrl);
  }
  return keyboard;
};

export const buildCommentKeyboard = (assetId: string, page: number, totalPages: number) => {
  const current = page < 1 ? 1 : page;
  const maxPage = totalPages < 1 ? 1 : totalPages;
  const prev = current > 1 ? current - 1 : 1;
  const next = current < maxPage ? current + 1 : maxPage;
  const prevAction = current > 1 ? `comment:list:${assetId}:${prev}` : "comment:noop";
  const nextAction = current < maxPage ? `comment:list:${assetId}:${next}` : "comment:noop";
  return new InlineKeyboard()
    .text("⬅️ 返回内容", `comment:back:${assetId}`)
    .text("🔄 刷新", `comment:list:${assetId}:${current}`)
    .row()
    .text("⬅️ 上一页", prevAction)
    .text(`${current}/${maxPage}`, "comment:noop")
    .text("下一页 ➡️", nextAction)
    .row()
    .text("🏠 首页", "home:back");
};
