import type { PrismaClient } from "@prisma/client";
import type { UploadMessage } from "./upload";
import { createProjectAdmin } from "./delivery-admin";
import { createDeliveryCore } from "./delivery-core";
import { createProjectDiscovery } from "./delivery-discovery";
import type { ProjectContextInput } from "../../project-context";
import {
  buildDiscoveryService,
  buildIdentityService,
  buildSocialService,
  createGetProjectAssetAccess,
  createGetUserProfileSummary
} from "./delivery-factories";
import { createDeliveryPreferences } from "./delivery-preferences";
import { createProjectReplicaSelection } from "./delivery-replica-selection";
import { createDeliverySocial } from "./delivery-social";
import { createDeliveryStorage } from "./delivery-storage";
import { createDeliveryStats } from "./delivery-stats";
import { createDeliveryProjectVault } from "./delivery-tenant-vault";

export type TelegramUserInput = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type DeliveryMessage = {
  fromChatId: string;
  messageId: number;
  kind: UploadMessage["kind"];
  mediaGroupId?: string;
  fileId?: string;
};

export type DeliverySelection =
  | {
      status: "ready";
      projectId: string;
      messages: DeliveryMessage[];
      title: string;
      description: string | null;
      publisherUserId: string | null;
    }
  | { status: "pending"; message: string }
  | { status: "failed"; message: string }
  | { status: "missing"; message: string };

export type DeliveryProjectIdentityService = {
  selectReplicas: (userId: string, assetId: string) => Promise<DeliverySelection>;
  resolveShareCode: (shareCode: string) => Promise<string | null>;
  upsertProjectUserFromTelegram: (user: TelegramUserInput) => Promise<void>;
  upsertTenantUserFromTelegram: (user: TelegramUserInput) => Promise<void>;
  getProjectUserLabel: (userId: string) => Promise<string | null>;
  getUserProfileSummary: (userId: string) => Promise<{
    displayName: string | null;
    activatedAt: Date | null;
    lastSeenAt: Date | null;
    activeDays: number;
    visitCount: number;
    openCount: number;
    openedShares: number;
  }>;
  trackOpen: (projectId: string, userId: string, assetId: string) => Promise<void>;
  trackVisit: (
    userId: string,
    source: "start" | "start_payload" | "home" | "help" | "tag",
    metadata?: Record<string, unknown>
  ) => Promise<void>;
  isProjectMember: (userId: string) => Promise<boolean>;
  canManageProject: (userId: string) => Promise<boolean>;
  canManageProjectAdmins: (userId: string) => Promise<boolean>;
  canManageProjectCollections: (userId: string) => Promise<boolean>;
};

export type LegacyIdentityService = {
};

export type DeliveryIdentityCompatibilityService = LegacyIdentityService;
export type DeliveryIdentityService = DeliveryProjectIdentityService & LegacyIdentityService;

export type DeliveryProjectSettingsService = {
  getProjectSearchMode: () => Promise<"OFF" | "ENTITLED_ONLY" | "PUBLIC">;
  setProjectSearchMode: (
    actorUserId: string,
    mode: "OFF" | "ENTITLED_ONLY" | "PUBLIC"
  ) => Promise<{ ok: boolean; message: string }>;
  listVaultGroups: () => Promise<
    {
      vaultGroupId: string;
      chatId: string;
      role: "PRIMARY" | "BACKUP" | "COLD";
      status: "ACTIVE" | "DEGRADED" | "BANNED";
    }[]
  >;
  addBackupVaultGroup: (actorUserId: string, chatId: string) => Promise<{ ok: boolean; message: string }>;
  removeBackupVaultGroup: (actorUserId: string, vaultGroupId: string) => Promise<{ ok: boolean; message: string }>;
  setPrimaryVaultGroup: (actorUserId: string, vaultGroupId: string) => Promise<{ ok: boolean; message: string }>;
  setVaultGroupStatus: (
    actorUserId: string,
    vaultGroupId: string,
    status: "ACTIVE" | "DEGRADED" | "BANNED"
  ) => Promise<{ ok: boolean; message: string }>;
  getProjectMinReplicas: () => Promise<number>;
  setProjectMinReplicas: (actorUserId: string, value: number) => Promise<{ ok: boolean; message: string }>;
  markReplicaBad: (assetId: string, fromChatId: string, messageId: number) => Promise<void>;
  searchAssets: (
    userId: string,
    query: string,
    page: number,
    pageSize: number,
    options?: { collectionId?: string | null }
  ) => Promise<{
    total: number;
    items: {
      assetId: string;
      shareCode: string | null;
      title: string;
      description: string | null;
      publisherUserId: string | null;
    }[];
  }>;
  getTagById: (tagId: string) => Promise<{ tagId: string; name: string } | null>;
  getTagByName: (name: string) => Promise<{ tagId: string; name: string } | null>;
  listTopTags: {
    (limit: number, options?: { viewerUserId?: string }): Promise<{ tagId: string; name: string; count: number }[]>;
    (
      page: number,
      pageSize: number,
      options?: { viewerUserId?: string }
    ): Promise<{ total: number; items: { tagId: string; name: string; count: number }[] }>;
  };
  listAssetsByTagId: (
    userId: string,
    tagId: string,
    page: number,
    pageSize: number
  ) => Promise<{
    total: number;
    items: {
      assetId: string;
      shareCode: string | null;
      title: string;
      description: string | null;
      publisherUserId: string | null;
    }[];
  }>;
};

export type LegacySettingsService = {};

export type DeliveryTenantSettingsCompatibilityService = LegacySettingsService;
export type DeliverySettingsService = DeliveryProjectSettingsService & LegacySettingsService;
export type DeliveryTenantSettingsService = DeliverySettingsService;

export type DeliveryProjectAdminService = {
  listMyBroadcasts: (actorUserId: string, limit: number) => Promise<
    {
      id: string;
      status: "DRAFT" | "SCHEDULED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED";
      contentHtml: string;
      mediaKind: string | null;
      mediaFileId: string | null;
      buttons: { text: string; url: string }[];
      nextRunAt: Date | null;
      repeatEveryMs: number | null;
      createdAt: Date;
      updatedAt: Date;
    }[] 
  >;
  getBroadcastById: (
    actorUserId: string,
    broadcastId: string
  ) => Promise<{
    id: string;
    status: "DRAFT" | "SCHEDULED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED";
    contentHtml: string;
    mediaKind: string | null;
    mediaFileId: string | null;
    buttons: { text: string; url: string }[];
    nextRunAt: Date | null;
    repeatEveryMs: number | null;
    createdAt: Date;
    updatedAt: Date;
  } | null>;
  getProjectStartWelcomeHtml: () => Promise<string | null>;
  setProjectStartWelcomeHtml: (actorUserId: string, html: string | null) => Promise<{ ok: boolean; message: string }>;
  getProjectDeliveryAdConfig: () => Promise<{
    prevText: string;
    nextText: string;
    adButtonText: string | null;
    adButtonUrl: string | null;
  }>;
  setProjectDeliveryAdConfig: (
    actorUserId: string,
    config: { prevText: string; nextText: string; adButtonText: string | null; adButtonUrl: string | null }
  ) => Promise<{ ok: boolean; message: string }>;
  getProjectProtectContentEnabled: () => Promise<boolean>;
  setProjectProtectContentEnabled: (actorUserId: string, enabled: boolean) => Promise<{ ok: boolean; message: string }>;
  getProjectHidePublisherEnabled: () => Promise<boolean>;
  setProjectHidePublisherEnabled: (actorUserId: string, enabled: boolean) => Promise<{ ok: boolean; message: string }>;
  getProjectAutoCategorizeEnabled: () => Promise<boolean>;
  setProjectAutoCategorizeEnabled: (actorUserId: string, enabled: boolean) => Promise<{ ok: boolean; message: string }>;
  getProjectAutoCategorizeRules: () => Promise<{ collectionId: string; keywords: string[] }[]>;
  setProjectAutoCategorizeRules: (
    actorUserId: string,
    rules: { collectionId: string; keywords: string[] }[]
  ) => Promise<{ ok: boolean; message: string }>;
  getProjectPublicRankingEnabled: () => Promise<boolean>;
  setProjectPublicRankingEnabled: (actorUserId: string, enabled: boolean) => Promise<{ ok: boolean; message: string }>;
  createBroadcastDraft: (actorUserId: string, actorChatId: string) => Promise<{ ok: boolean; id?: string; message: string }>;
  getMyBroadcastDraft: (actorUserId: string) => Promise<{
    id: string;
    status: "DRAFT" | "SCHEDULED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED";
    contentHtml: string;
    mediaKind: string | null;
    mediaFileId: string | null;
    buttons: { text: string; url: string }[];
    nextRunAt: Date | null;
    repeatEveryMs: number | null;
    createdAt: Date;
    updatedAt: Date;
  } | null>;
  updateBroadcastDraftContent: (
    actorUserId: string,
    draftId: string,
    input: { contentHtml: string; mediaKind: string | null; mediaFileId: string | null }
  ) => Promise<{ ok: boolean; message: string }>;
  updateBroadcastDraftButtons: (
    actorUserId: string,
    draftId: string,
    buttons: { text: string; url: string }[]
  ) => Promise<{ ok: boolean; message: string }>;
  scheduleBroadcast: (
    actorUserId: string,
    draftId: string,
    schedule: { nextRunAt: Date; repeatEveryMs?: number | null }
  ) => Promise<{ ok: boolean; message: string }>;
  cancelBroadcast: (actorUserId: string, broadcastId: string) => Promise<{ ok: boolean; message: string }>;
  deleteBroadcastDraft: (actorUserId: string, draftId: string) => Promise<{ ok: boolean; message: string }>;
  listBroadcastRuns: (actorUserId: string, broadcastId: string, limit: number) => Promise<
    {
      id: string;
      targetCount: number;
      successCount: number;
      failedCount: number;
      blockedCount: number;
      startedAt: Date;
      finishedAt: Date | null;
    }[]
  >;
  getBroadcastTargetCount: (actorUserId: string) => Promise<number>;
  listProjectManagers: () => Promise<{ tgUserId: string; role: "OWNER" | "ADMIN" }[]>;
  addProjectManager: (actorUserId: string, tgUserId: string) => Promise<{ ok: boolean; message: string }>;
  removeProjectManager: (actorUserId: string, tgUserId: string) => Promise<{ ok: boolean; message: string }>;
  listCollections: () => Promise<{ id: string; title: string }[]>;
  createCollection: (actorUserId: string, title: string) => Promise<{ ok: boolean; message: string; id?: string }>;
  updateCollection: (
    actorUserId: string,
    collectionId: string,
    title: string
  ) => Promise<{ ok: boolean; message: string }>;
  deleteCollection: (actorUserId: string, collectionId: string) => Promise<{ ok: boolean; message: string }>;
  getCollectionImpactCounts: (actorUserId: string, collectionId: string) => Promise<{ assets: number; files: number }>;
  getPrimaryVaultChatId: () => Promise<string | null>;
  getCollectionTopic: (
    collectionId: string | null
  ) => Promise<{ threadId: number | null; indexMessageId: number | null } | null>;
  setCollectionTopicThreadId: (collectionId: string | null, threadId: number) => Promise<void>;
  setCollectionTopicIndexMessageId: (collectionId: string | null, messageId: number | null) => Promise<void>;
  listRecentAssetsInCollection: (
    collectionId: string | null,
    limit: number
  ) => Promise<{ assetId: string; title: string; description: string | null; shareCode: string | null; updatedAt: Date }[]>;
};

export type LegacyAdminService = {};

export type DeliveryAdminCompatibilityService = LegacyAdminService;
export type AdminService = DeliveryProjectAdminService & LegacyAdminService;
export type DeliveryAdminService = AdminService;

export type DeliveryPreferencesService = {
  getUserDefaultCollectionId: (userId: string) => Promise<string | null>;
  setUserDefaultCollectionId: (userId: string, collectionId: string | null) => Promise<void>;
  getUserHistoryCollectionFilter: (userId: string) => Promise<string | null | undefined>;
  setUserHistoryCollectionFilter: (userId: string, value: string | null | undefined) => Promise<void>;
  getUserHistoryListDate: (userId: string) => Promise<Date | undefined>;
  setUserHistoryListDate: (userId: string, date: Date | undefined) => Promise<void>;
  getUserFollowKeywords: (userId: string) => Promise<string[]>;
  setUserFollowKeywords: (userId: string, keywords: string[]) => Promise<{ ok: boolean; message: string }>;
  listFollowKeywordSubscriptions: () => Promise<{ userId: string; keywords: string[] }[]>;
  getUserNotifySettings: (userId: string) => Promise<{ followEnabled: boolean; commentEnabled: boolean }>;
  setUserNotifySettings: (
    userId: string,
    input: { followEnabled?: boolean; commentEnabled?: boolean }
  ) => Promise<{ ok: boolean; message: string; settings: { followEnabled: boolean; commentEnabled: boolean } }>;
  checkAndRecordUserNotification: (
    userId: string,
    input: { type: "follow" | "comment"; uniqueId: string; minIntervalMs: number }
  ) => Promise<boolean>;
};

type DeliveryHomeStats = {
  asOfDate: string;
  daysRunning: number;
  totalUsers: number;
  newUsersYesterday: number;
  visitUsersYesterday: number;
  storedFiles: number;
  deliveriesTotal: number;
  deliveriesYesterday: number;
};

type DeliveryProjectStats = {
  visitors: number;
  visits: number;
  opens: number;
  openUsers: number;
  assets: number;
  batches: number;
  files: number;
  visits7d: number;
  opens7d: number;
};

type DeliveryOpenRankingItem = {
  assetId: string;
  title: string;
  shareCode: string | null;
  opens: number;
  publisherUserId: string | null;
};

type DeliveryLikeRankingItem = {
  assetId: string;
  title: string;
  shareCode: string | null;
  likes: number;
  publisherUserId: string | null;
};

type DeliveryVisitRankingItem = {
  assetId: string;
  title: string;
  shareCode: string | null;
  visits: number;
  publisherUserId: string | null;
};

type DeliveryCommentRankingItem = {
  assetId: string;
  title: string;
  shareCode: string | null;
  comments: number;
  publisherUserId: string | null;
};

export type DeliveryProjectStatsService = {
  getProjectHomeStats: () => Promise<DeliveryHomeStats>;
  getProjectStats: () => Promise<DeliveryProjectStats>;
  getProjectRanking: (range: "today" | "week" | "month", limit: number, viewerUserId?: string) => Promise<DeliveryOpenRankingItem[]>;
  getProjectLikeRanking: (
    range: "today" | "week" | "month",
    limit: number,
    viewerUserId?: string
  ) => Promise<DeliveryLikeRankingItem[]>;
  getProjectVisitRanking: (
    range: "today" | "week" | "month",
    limit: number,
    viewerUserId?: string
  ) => Promise<DeliveryVisitRankingItem[]>;
  getProjectCommentRanking: (
    range: "today" | "week" | "month",
    limit: number,
    viewerUserId?: string
  ) => Promise<DeliveryCommentRankingItem[]>;
};

export type DeliveryStatsService = DeliveryProjectStatsService;

export type DeliveryProjectDiscoveryService = {
  getUserAssetMeta: (
    userId: string,
    assetId: string
  ) => Promise<{
    assetId: string;
    shareCode: string | null;
    title: string;
    description: string | null;
    collectionId: string | null;
    searchable: boolean;
    visibility: "PUBLIC" | "PROTECTED" | "RESTRICTED";
  } | null>;
  setUserAssetSearchable: (userId: string, assetId: string, searchable: boolean) => Promise<{ ok: boolean; message: string }>;
  deleteUserAsset: (userId: string, assetId: string) => Promise<{ ok: boolean; message: string }>;
  recycleUserAsset: (userId: string, assetId: string) => Promise<{ ok: boolean; message: string }>;
  restoreUserAsset: (userId: string, assetId: string) => Promise<{ ok: boolean; message: string }>;
  listUserRecycledAssets: (
    userId: string,
    page: number,
    pageSize: number
  ) => Promise<{
    total: number;
    items: {
      assetId: string;
      title: string;
      description: string | null;
      shareCode: string | null;
      updatedAt: Date;
    }[];
  }>;
  restoreUserAssets: (userId: string, assetIds: string[]) => Promise<{ ok: boolean; message: string; restored: number }>;
  listUserBatches: (
    userId: string,
    page: number,
    pageSize: number,
    options?: { collectionId?: string | null; date?: Date }
  ) => Promise<{
    total: number;
    items: {
      assetId: string;
      shareCode: string | null;
      title: string;
      description: string | null;
      count: number;
      publisherUserId: string | null;
    }[];
  }>;
  listProjectBatches: (
    viewerUserId: string,
    page: number,
    pageSize: number,
    options?: { collectionId?: string | null; date?: Date }
  ) => Promise<{
    total: number;
    items: {
      assetId: string;
      shareCode: string | null;
      title: string;
      description: string | null;
      count: number;
      publisherUserId: string | null;
    }[];
  }>;
  listUserOpenHistory: (
    userId: string,
    page: number,
    pageSize: number,
    options?: { since?: Date }
  ) => Promise<{
    total: number;
    items: {
      assetId: string;
      shareCode: string | null;
      title: string;
      description: string | null;
      openedAt: Date;
      publisherUserId: string | null;
    }[];
  }>;
  listUserLikedAssets: (
    userId: string,
    page: number,
    pageSize: number,
    options?: { since?: Date }
  ) => Promise<{
    total: number;
    items: {
      assetId: string;
      shareCode: string | null;
      title: string;
      description: string | null;
      likedAt: Date;
      publisherUserId: string | null;
    }[];
  }>;
};

export type LegacyDiscoveryService = {};

export type DeliveryDiscoveryCompatibilityService = LegacyDiscoveryService;
export type DiscoveryService = DeliveryProjectDiscoveryService & LegacyDiscoveryService;
export type DeliveryDiscoveryService = DiscoveryService;

export type DeliverySocialService = {
  listUserComments: (
    userId: string,
    kind: "comment" | "reply",
    page: number,
    pageSize: number,
    options?: { since?: Date }
  ) => Promise<{
    total: number;
    items: {
      id: string;
      assetId: string;
      shareCode: string | null;
      title: string;
      description: string | null;
      content: string;
      replyToCommentId: string | null;
      replyTo: { authorUserId: string; authorName: string | null } | null;
      createdAt: Date;
      publisherUserId: string | null;
    }[];
  }>;
  listAssetComments: (
    userId: string,
    assetId: string,
    page: number,
    pageSize: number
  ) => Promise<{
    total: number;
    items: {
      id: string;
      authorUserId: string;
      authorName: string | null;
      content: string;
      replyToCommentId: string | null;
      replyTo: { authorUserId: string; authorName: string | null } | null;
      createdAt: Date;
    }[];
  }>;
  getAssetCommentCount: (userId: string, assetId: string) => Promise<number>;
  getAssetCommentContext: (
    userId: string,
    commentId: string
  ) => Promise<{ assetId: string; authorUserId: string; authorName: string | null } | null>;
  toggleAssetCommentLike: (
    userId: string,
    commentId: string
  ) => Promise<{ ok: boolean; message: string; liked?: boolean; count?: number; assetId?: string }>;
  getAssetLikeCount: (userId: string, assetId: string) => Promise<number>;
  hasAssetLiked: (userId: string, assetId: string) => Promise<boolean>;
  toggleAssetLike: (userId: string, assetId: string) => Promise<{ ok: boolean; message: string; liked?: boolean; count?: number }>;
  locateAssetComment: (
    userId: string,
    commentId: string,
    pageSize: number
  ) => Promise<{ assetId: string; page: number } | null>;
  getCommentThread: (
    userId: string,
    rootCommentId: string
  ) => Promise<{
    assetId: string;
    assetTitle: string;
    shareCode: string | null;
    root: {
      id: string;
      authorUserId: string | null;
      authorName: string | null;
      content: string;
      createdAt: Date;
    };
    replies: Array<{
      id: string;
      authorUserId: string | null;
      authorName: string | null;
      content: string;
      createdAt: Date;
    }>;
  } | null>;
  addAssetComment: (
    userId: string,
    assetId: string,
    input: { authorName: string | null; content: string; replyToCommentId?: string | null }
  ) => Promise<{
    ok: boolean;
    message: string;
    commentId?: string;
    notify?: {
      assetTitle: string;
      shareCode: string;
      publisherUserId: string | null;
      replyToAuthorUserId: string | null;
      replyToCommentId: string | null;
    };
  }>;
};

export type DeliveryService = DeliveryIdentityService &
  DeliverySettingsService &
  AdminService &
  DeliveryPreferencesService &
  DeliveryStatsService &
  DiscoveryService &
  DeliverySocialService;

export const createDeliveryService = (
  prisma: PrismaClient,
  config: ProjectContextInput
): DeliveryService => {
  const preferenceKeys = {
    defaultCollectionId: "default_collection_id",
    historyCollectionFilter: "history_collection_filter",
    historyListDate: "history_list_date",
    followKeywords: "follow_keywords",
    notifyFollowEnabled: "notify_follow_enabled",
    notifyCommentEnabled: "notify_comment_enabled",
    notifyState: "notify_state"
  } as const;

  const settingKeys = {
    startWelcomeHtml: "start_welcome_html",
    deliveryAdConfig: "delivery_ad_config",
    protectContentEnabled: "protect_content_enabled",
    hidePublisherEnabled: "hide_publisher_enabled",
    publicRankingEnabled: "public_ranking_enabled",
    autoCategorizeEnabled: "auto_categorize_enabled",
    autoCategorizeRules: "auto_categorize_rules",
    minReplicas: "min_replicas"
  } as const;

  const {
    formatLocalDate,
    startOfLocalDay,
    startOfLocalWeek,
    startOfLocalMonth,
    getRuntimeProjectContext,
    getRuntimeProjectId,
    getTenantId,
    ensureInitialOwner,
    isTenantAdmin,
    canManageProject,
    getProjectSearchMode,
    setProjectSearchMode,
    getProjectMinReplicas,
    setProjectMinReplicas,
    resolveShareCode,
    trackOpen,
    trackVisit
  } = createDeliveryCore({
    prisma,
    config
  });

  const { getPreference, upsertPreference, deletePreference, getSetting, upsertSetting, deleteSetting } = createDeliveryStorage(
    prisma,
    getRuntimeProjectId
  );

  const { upsertProjectUserFromTelegram, upsertTenantUserFromTelegram, getProjectUserLabel, isProjectMember, listProjectManagers, addProjectManager, removeProjectManager, listVaultGroups, addBackupVaultGroup, removeBackupVaultGroup, setPrimaryVaultGroup, setVaultGroupStatus, markReplicaBad, listCollections, createCollection, updateCollection, deleteCollection, getCollectionImpactCounts, getPrimaryVaultChatId, getCollectionTopic, setCollectionTopicThreadId, setCollectionTopicIndexMessageId, listRecentAssetsInCollection } =
    createDeliveryProjectVault({
      prisma,
      getRuntimeProjectId,
      canManageProject,
      ensureInitialOwner
    });

  const isProjectMemberSafe = async (userId: string) => isProjectMember(userId).catch(() => false);
  const canManageProjectSafe = async (userId: string) => canManageProject(userId).catch(() => false);

  const getUserProfileSummary = createGetUserProfileSummary({ prisma, getRuntimeProjectId });
  const getProjectAssetAccess = createGetProjectAssetAccess({ prisma, isProjectMemberSafe, canManageProjectSafe });


  const {
    getUserDefaultCollectionId,
    setUserDefaultCollectionId,
    getUserHistoryCollectionFilter,
    setUserHistoryCollectionFilter,
    getUserHistoryListDate,
    setUserHistoryListDate,
    getUserFollowKeywords,
    setUserFollowKeywords,
    listFollowKeywordSubscriptions,
    getUserNotifySettings,
    setUserNotifySettings,
    checkAndRecordUserNotification
  } = createDeliveryPreferences({
    prisma,
    preferenceKeys,
    getRuntimeProjectId,
    getPreference,
    upsertPreference,
    deletePreference,
    startOfLocalDay,
    formatLocalDate
  });

  const {
    listMyBroadcasts,
    getBroadcastById,
    getProjectStartWelcomeHtml,
    setProjectStartWelcomeHtml,
    getProjectDeliveryAdConfig,
    setProjectDeliveryAdConfig,
    getProjectProtectContentEnabled,
    setProjectProtectContentEnabled,
    getProjectHidePublisherEnabled,
    setProjectHidePublisherEnabled,
    getProjectAutoCategorizeEnabled,
    setProjectAutoCategorizeEnabled,
    getProjectAutoCategorizeRules,
    setProjectAutoCategorizeRules,
    getProjectPublicRankingEnabled,
    setProjectPublicRankingEnabled,
    getBroadcastTargetCount,
    createBroadcastDraft,
    getMyBroadcastDraft,
    updateBroadcastDraftContent,
    updateBroadcastDraftButtons,
    scheduleBroadcast,
    cancelBroadcast,
    deleteBroadcastDraft,
    listBroadcastRuns
  } = createProjectAdmin({
    prisma,
    settingKeys,
    getRuntimeProjectId,
    canManageProject,
    getSetting,
    upsertSetting,
    deleteSetting
  });

  const { selectReplicas } = createProjectReplicaSelection({
    prisma,
    getRuntimeProjectId,
    isProjectMemberSafe,
    getProjectMinReplicas,
    getSetting
  });

  const {
    searchAssets,
    getTagById,
    getTagByName,
    listTopTags,
    listAssetsByTagId,
    getUserAssetMeta,
    setUserAssetSearchable,
    deleteUserAsset,
    recycleUserAsset,
    restoreUserAsset,
    listUserRecycledAssets,
    restoreUserAssets,
    listUserBatches,
    listProjectBatches,
    listUserOpenHistory,
    listUserLikedAssets
  } =
    createProjectDiscovery({
      prisma,
      getRuntimeProjectId,
      isProjectMemberSafe,
      startOfLocalDay
    });

  const {
    getProjectHomeStats,
    getProjectStats,
    getProjectRanking,
    getProjectLikeRanking,
    getProjectVisitRanking,
    getProjectCommentRanking
  } = createDeliveryStats({
    prisma,
    getRuntimeProjectId,
    isProjectMemberSafe,
    formatLocalDate,
    startOfLocalDay,
    startOfLocalWeek,
    startOfLocalMonth
  });


  const {
    listUserComments,
    listAssetComments,
    getAssetCommentCount,
    getAssetCommentContext,
    locateAssetComment,
    getCommentThread,
    toggleAssetCommentLike,
    getAssetLikeCount,
    hasAssetLiked,
    toggleAssetLike,
    addAssetComment
  } = createDeliverySocial({
    prisma,
    getRuntimeProjectId,
    isProjectMemberSafe,
    getProjectAssetAccess
  });

  const identityService = buildIdentityService({
    selectReplicas,
    resolveShareCode,
    upsertProjectUserFromTelegram,
    upsertTenantUserFromTelegram,
    getProjectUserLabel,
    getUserProfileSummary,
    trackOpen,
    trackVisit,
    isProjectMember,
    canManageProject
  });

  const settingsService: DeliverySettingsService = {
    getProjectSearchMode,
    setProjectSearchMode,
    getProjectMinReplicas,
    setProjectMinReplicas,
    listVaultGroups,
    addBackupVaultGroup,
    removeBackupVaultGroup,
    setPrimaryVaultGroup,
    setVaultGroupStatus,
    markReplicaBad,
    searchAssets,
    getTagById,
    getTagByName,
    listTopTags,
    listAssetsByTagId,
  };

  const adminService: AdminService = {
    listMyBroadcasts,
    getBroadcastById,
    getProjectStartWelcomeHtml,
    setProjectStartWelcomeHtml,
    getProjectDeliveryAdConfig,
    setProjectDeliveryAdConfig,
    getProjectProtectContentEnabled,
    setProjectProtectContentEnabled,
    getProjectHidePublisherEnabled,
    setProjectHidePublisherEnabled,
    getProjectAutoCategorizeEnabled,
    setProjectAutoCategorizeEnabled,
    getProjectAutoCategorizeRules,
    setProjectAutoCategorizeRules,
    getProjectPublicRankingEnabled,
    setProjectPublicRankingEnabled,
    createBroadcastDraft,
    getMyBroadcastDraft,
    updateBroadcastDraftContent,
    updateBroadcastDraftButtons,
    scheduleBroadcast,
    cancelBroadcast,
    deleteBroadcastDraft,
    listBroadcastRuns,
    getBroadcastTargetCount,
    listProjectManagers,
    addProjectManager,
    removeProjectManager,
    listCollections,
    createCollection,
    updateCollection,
    deleteCollection,
    getCollectionImpactCounts,
    getPrimaryVaultChatId,
    getCollectionTopic,
    setCollectionTopicThreadId,
    setCollectionTopicIndexMessageId,
    listRecentAssetsInCollection
  };

  const preferencesService: DeliveryPreferencesService = {
    getUserDefaultCollectionId,
    setUserDefaultCollectionId,
    getUserHistoryCollectionFilter,
    setUserHistoryCollectionFilter,
    getUserHistoryListDate,
    setUserHistoryListDate,
    getUserFollowKeywords,
    setUserFollowKeywords,
    listFollowKeywordSubscriptions,
    getUserNotifySettings,
    setUserNotifySettings,
    checkAndRecordUserNotification
  };

  const statsService: DeliveryStatsService = {
    getProjectHomeStats,
    getProjectStats,
    getProjectRanking,
    getProjectLikeRanking,
    getProjectVisitRanking,
    getProjectCommentRanking
  };

  const discoveryService: DiscoveryService = buildDiscoveryService({
    getUserAssetMeta,
    setUserAssetSearchable,
    deleteUserAsset,
    recycleUserAsset,
    restoreUserAsset,
    listUserRecycledAssets,
    restoreUserAssets,
    listUserBatches,
    listProjectBatches,
    listUserOpenHistory,
    listUserLikedAssets
  });

  const socialService = buildSocialService({
    listUserComments,
    listAssetComments,
    getAssetCommentCount,
    getAssetCommentContext,
    toggleAssetCommentLike,
    getAssetLikeCount,
    hasAssetLiked,
    toggleAssetLike,
    locateAssetComment,
    getCommentThread,
    addAssetComment
  });

  return {
    ...identityService,
    ...settingsService,
    ...adminService,
    ...preferencesService,
    ...statsService,
    ...discoveryService,
    ...socialService
  };
};
