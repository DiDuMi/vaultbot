import type { Context, InlineKeyboard, Keyboard } from "grammy";
import type { DeliveryService, UploadService } from "../../../services/use-cases";
import type { KeyValueStore } from "../ui-utils";

export type SessionMode =
  | "idle"
  | "upload"
  | "meta"
  | "searchInput"
  | "followInput"
  | "settingsInput"
  | "adminInput"
  | "collectionInput"
  | "collectionPicker"
  | "broadcastInput"
  | "commentInput";

export type SettingsInputState =
  | { mode: "welcome" }
  | { mode: "adPrev" }
  | { mode: "adNext" }
  | { mode: "adButtonText" }
  | { mode: "adButtonUrl" }
  | { mode: "autoCategorizeRules" }
  | { mode: "vaultAddBackup" };

export type BroadcastInputState =
  | { mode: "broadcastContent"; draftId: string }
  | { mode: "broadcastButtonText"; draftId: string }
  | { mode: "broadcastButtonUrl"; draftId: string; text: string }
  | { mode: "broadcastScheduleAt"; draftId: string }
  | { mode: "broadcastRepeatEvery"; draftId: string };

export type CollectionInputState = { mode: "createCollection" } | { mode: "renameCollection"; collectionId: string };

export type CollectionPickerState = { returnTo: "settings" | "upload"; page: number };

export type CommentInputState = {
  assetId: string;
  replyToCommentId: string | null;
  replyToLabel: string | null;
  returnToAssetPage?: number;
};

export type RankingViewState = { range: "today" | "week" | "month"; metric: "open" | "visit" | "like" | "comment" };

export type UploadBatchActionResult = { ok: boolean; message: string; assetId?: string };

export type TenantCallbackDeps = {
  services: {
    deliveryService: DeliveryService | null;
    uploadService: UploadService;
    batchActions: {
      commit: (userId: number, chatId: number) => Promise<UploadBatchActionResult>;
      cancel: (userId: number, chatId: number) => Promise<UploadBatchActionResult>;
    };
  };
  session: {
    mainKeyboard: InlineKeyboard | Keyboard;
    historyPageSize: number;
    getSessionMode: (key: string) => SessionMode;
    setSessionMode: (key: string, mode: SessionMode) => void;
    isActive: (userId: number, chatId: number) => boolean;
    syncSessionForView: (ctx: Context) => void;
    hydrateUserPreferences: (ctx: Context) => Promise<void>;
    formatLocalDateTime: (date: Date) => string;
  };
  states: {
    settingsInputStates: KeyValueStore<SettingsInputState>;
    adminInputStates: KeyValueStore<{ mode: "addAdmin" }>;
    broadcastInputStates: KeyValueStore<BroadcastInputState>;
    broadcastDraftStates: KeyValueStore<{ draftId: string }>;
    collectionStates: KeyValueStore<string | null>;
    historyFilterStates: KeyValueStore<string | null | undefined>;
    historyDateStates: KeyValueStore<Date>;
    historyScopeStates: KeyValueStore<"community" | "mine">;
    collectionInputStates: KeyValueStore<CollectionInputState>;
    collectionPickerStates: KeyValueStore<CollectionPickerState>;
    searchStates: KeyValueStore<{ query: string }>;
    commentInputStates: KeyValueStore<CommentInputState>;
    rankingViewStates: KeyValueStore<RankingViewState>;
  };
  renderers: {
    renderUploadStatus: (ctx: Context) => Promise<void>;
    renderManagePanel: (ctx: Context, assetId: string) => Promise<void>;
    startMeta: (ctx: Context, assetId: string, mode: "create" | "edit") => Promise<void>;
    renderComments: (ctx: Context, assetId: string, page: number, mode: "reply" | "edit") => Promise<void>;
    openAsset: (ctx: Context, assetId: string, page: number) => Promise<void>;
    refreshAssetActions: (ctx: Context, assetId: string) => Promise<void>;
    renderFootprint: (
      ctx: Context,
      tab: "open" | "like" | "comment" | "reply",
      range: "7d" | "30d" | "all",
      page: number,
      mode: "reply" | "edit"
    ) => Promise<void>;
    renderHistory: (ctx: Context, page: number, scope?: "community" | "mine") => Promise<void>;
    renderSearch: (ctx: Context, query: string, page: number, mode: "reply" | "edit") => Promise<void>;
    renderTagIndex: (ctx: Context, mode: "reply" | "edit") => Promise<void>;
    renderTagAssets: (ctx: Context, tagId: string, page: number, mode: "reply" | "edit") => Promise<void>;
    renderCollections: (ctx: Context, options: { returnTo: "settings" | "upload"; page?: number }) => Promise<void>;
    renderHelp: (ctx: Context) => Promise<void>;
    renderMy: (ctx: Context) => Promise<void>;
    renderFollow: (ctx: Context) => Promise<void>;
    renderNotifySettings: (ctx: Context) => Promise<void>;
    renderSettings: (ctx: Context) => Promise<void>;
    renderWelcomeSettings: (ctx: Context) => Promise<void>;
    renderAdSettings: (ctx: Context) => Promise<void>;
    renderProtectSettings: (ctx: Context) => Promise<void>;
    renderHidePublisherSettings: (ctx: Context) => Promise<void>;
    renderAutoCategorizeSettings: (ctx: Context) => Promise<void>;
    renderRankPublicSettings: (ctx: Context) => Promise<void>;
    renderSearchModeSettings: (ctx: Context) => Promise<void>;
    renderVaultSettings: (ctx: Context) => Promise<void>;
    renderBroadcast: (ctx: Context) => Promise<void>;
    renderBroadcastButtons: (ctx: Context) => Promise<void>;
    renderStartHome: (ctx: Context) => Promise<void>;
    renderStats: (ctx: Context) => Promise<void>;
    renderRanking: (ctx: Context, range: "today" | "week" | "month", metric: "open" | "visit" | "like" | "comment") => Promise<void>;
  };
};
