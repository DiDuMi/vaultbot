import type { Context } from "grammy";
import type { KeyValueStore } from "./ui-utils";
import { toMetaKey } from "./ui-utils";

export type MetaState = {
  assetId: string;
  mode: "create" | "edit";
};

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

type SessionState = {
  mode: SessionMode;
  active: boolean;
  lastAccessAt: number;
  meta?: MetaState;
  adminInput?: { mode: "addAdmin" };
  settingsInput?:
    | { mode: "welcome" }
    | { mode: "adPrev" }
    | { mode: "adNext" }
    | { mode: "adButtonText" }
    | { mode: "adButtonUrl" }
    | { mode: "autoCategorizeRules" }
    | { mode: "vaultAddBackup" };
  broadcastDraft?: { draftId: string };
  broadcastInput?:
    | { mode: "broadcastContent"; draftId: string }
    | { mode: "broadcastButtonText"; draftId: string }
    | { mode: "broadcastButtonUrl"; draftId: string; text: string }
    | { mode: "broadcastScheduleAt"; draftId: string }
    | { mode: "broadcastRepeatEvery"; draftId: string };
  collectionId?: string | null;
  historyFilterSet?: boolean;
  historyFilter?: string | null | undefined;
  historyDate?: Date;
  historyScope?: "community" | "mine";
  collectionInput?: { mode: "createCollection" } | { mode: "renameCollection"; collectionId: string };
  collectionPicker?: { returnTo: "settings" | "upload"; page: number };
  search?: { query: string };
  commentInput?: { assetId: string; replyToCommentId: string | null; replyToLabel: string | null };
  rankingView?: { range: "today" | "week" | "month"; metric: "open" | "visit" | "like" | "comment" };
};

export const createTenantSession = () => {
  const sessionTtlMs = (() => {
    const raw = Number(process.env.SESSION_TTL_MS ?? "3600000");
    if (!Number.isFinite(raw)) {
      return 3600000;
    }
    return Math.max(60000, Math.trunc(raw));
  })();
  const sessionSweepIntervalMs = (() => {
    const raw = Number(process.env.SESSION_SWEEP_INTERVAL_MS ?? "60000");
    if (!Number.isFinite(raw)) {
      return 60000;
    }
    return Math.max(5000, Math.trunc(raw));
  })();
  const sessionStates = new Map<string, SessionState>();
  let lastSweepAt = 0;

  const hasAttachedState = (state: SessionState) => {
    return (
      state.meta !== undefined ||
      state.adminInput !== undefined ||
      state.settingsInput !== undefined ||
      state.broadcastDraft !== undefined ||
      state.broadcastInput !== undefined ||
      state.collectionId !== undefined ||
      state.historyFilterSet === true ||
      state.historyDate !== undefined ||
      state.historyScope !== undefined ||
      state.collectionInput !== undefined ||
      state.collectionPicker !== undefined ||
      state.search !== undefined ||
      state.commentInput !== undefined ||
      state.rankingView !== undefined
    );
  };

  const shouldDeleteSession = (state: SessionState) => {
    return state.mode === "idle" && state.active !== true && !hasAttachedState(state);
  };

  const sweepExpiredSessions = (now: number) => {
    if (now - lastSweepAt < sessionSweepIntervalMs) {
      return;
    }
    lastSweepAt = now;
    for (const [key, state] of sessionStates) {
      if (now - state.lastAccessAt >= sessionTtlMs) {
        sessionStates.delete(key);
      }
    }
  };

  const upsertTouchedState = (key: string, state: SessionState, now: number) => {
    state.lastAccessAt = now;
    sessionStates.set(key, state);
    sweepExpiredSessions(now);
  };

  const deleteIfIdle = (key: string, state: SessionState) => {
    if (shouldDeleteSession(state)) {
      sessionStates.delete(key);
      return true;
    }
    return false;
  };

  const ensureSessionState = (key: string): SessionState => {
    const now = Date.now();
    const existing = sessionStates.get(key);
    if (existing) {
      upsertTouchedState(key, existing, now);
      return existing;
    }
    const created: SessionState = { mode: "idle", active: false, lastAccessAt: now };
    upsertTouchedState(key, created, now);
    return created;
  };

  const createOptionalStore = <T>(
    read: (state: SessionState) => T | undefined,
    write: (state: SessionState, value: T) => void,
    clear: (state: SessionState) => void,
    isPresent?: (state: SessionState) => boolean
  ): KeyValueStore<T> => {
    return {
      get: (key) => {
        const state = sessionStates.get(key);
        if (!state) {
          return undefined;
        }
        upsertTouchedState(key, state, Date.now());
        if (isPresent && !isPresent(state)) {
          return undefined;
        }
        return read(state);
      },
      has: (key) => {
        const state = sessionStates.get(key);
        if (!state) {
          return false;
        }
        upsertTouchedState(key, state, Date.now());
        if (isPresent) {
          return isPresent(state);
        }
        return read(state) !== undefined;
      },
      set: (key, value) => {
        const state = ensureSessionState(key);
        write(state, value);
        upsertTouchedState(key, state, Date.now());
      },
      delete: (key) => {
        const state = sessionStates.get(key);
        if (!state) {
          return false;
        }
        const existed = isPresent ? isPresent(state) : read(state) !== undefined;
        if (!existed) {
          return false;
        }
        clear(state);
        if (!deleteIfIdle(key, state)) {
          upsertTouchedState(key, state, Date.now());
        }
        return true;
      }
    };
  };

  const metaStates = createOptionalStore<MetaState>(
    (state) => state.meta,
    (state, value) => {
      state.meta = value;
    },
    (state) => {
      state.meta = undefined;
    }
  );
  const adminInputStates = createOptionalStore<{ mode: "addAdmin" }>(
    (state) => state.adminInput,
    (state, value) => {
      state.adminInput = value;
    },
    (state) => {
      state.adminInput = undefined;
    }
  );
  const settingsInputStates = createOptionalStore<NonNullable<SessionState["settingsInput"]>>(
    (state) => state.settingsInput,
    (state, value) => {
      state.settingsInput = value;
    },
    (state) => {
      state.settingsInput = undefined;
    }
  );
  const broadcastDraftStates = createOptionalStore<{ draftId: string }>(
    (state) => state.broadcastDraft,
    (state, value) => {
      state.broadcastDraft = value;
    },
    (state) => {
      state.broadcastDraft = undefined;
    }
  );
  const broadcastInputStates = createOptionalStore<NonNullable<SessionState["broadcastInput"]>>(
    (state) => state.broadcastInput,
    (state, value) => {
      state.broadcastInput = value;
    },
    (state) => {
      state.broadcastInput = undefined;
    }
  );
  const collectionStates = createOptionalStore<string | null>(
    (state) => state.collectionId,
    (state, value) => {
      state.collectionId = value;
    },
    (state) => {
      state.collectionId = undefined;
    }
  );
  const historyFilterStates: KeyValueStore<string | null | undefined> = createOptionalStore<string | null | undefined>(
    (state) => state.historyFilter,
    (state, value) => {
      state.historyFilter = value;
      state.historyFilterSet = true;
    },
    (state) => {
      state.historyFilter = undefined;
      state.historyFilterSet = false;
    },
    (state) => state.historyFilterSet === true
  );
  const historyDateStates = createOptionalStore<Date>(
    (state) => state.historyDate,
    (state, value) => {
      state.historyDate = value;
    },
    (state) => {
      state.historyDate = undefined;
    }
  );
  const historyScopeStates = createOptionalStore<"community" | "mine">(
    (state) => state.historyScope,
    (state, value) => {
      state.historyScope = value;
    },
    (state) => {
      state.historyScope = undefined;
    }
  );
  const collectionInputStates = createOptionalStore<NonNullable<SessionState["collectionInput"]>>(
    (state) => state.collectionInput,
    (state, value) => {
      state.collectionInput = value;
    },
    (state) => {
      state.collectionInput = undefined;
    }
  );
  const collectionPickerStates = createOptionalStore<NonNullable<SessionState["collectionPicker"]>>(
    (state) => state.collectionPicker,
    (state, value) => {
      state.collectionPicker = value;
    },
    (state) => {
      state.collectionPicker = undefined;
    }
  );
  const searchStates = createOptionalStore<NonNullable<SessionState["search"]>>(
    (state) => state.search,
    (state, value) => {
      state.search = value;
    },
    (state) => {
      state.search = undefined;
    }
  );
  const commentInputStates = createOptionalStore<NonNullable<SessionState["commentInput"]>>(
    (state) => state.commentInput,
    (state, value) => {
      state.commentInput = value;
    },
    (state) => {
      state.commentInput = undefined;
    }
  );
  const rankingViewStates = createOptionalStore<NonNullable<SessionState["rankingView"]>>(
    (state) => state.rankingView,
    (state, value) => {
      state.rankingView = value;
    },
    (state) => {
      state.rankingView = undefined;
    }
  );

  const getSessionMode = (key: string): SessionMode => {
    const state = sessionStates.get(key);
    if (!state) {
      return "idle";
    }
    upsertTouchedState(key, state, Date.now());
    return state.mode;
  };

  const getSessionLabel = (mode: SessionMode) => {
    if (mode === "upload") {
      return "分享";
    }
    if (mode === "meta") {
      return "编辑标题/描述";
    }
    if (mode === "searchInput") {
      return "搜索";
    }
    if (mode === "settingsInput") {
      return "配置设置";
    }
    if (mode === "adminInput") {
      return "添加管理员";
    }
    if (mode === "collectionInput") {
      return "编辑分类";
    }
    if (mode === "collectionPicker") {
      return "选择分类";
    }
    if (mode === "broadcastInput") {
      return "配置推送";
    }
    if (mode === "commentInput") {
      return "写评论";
    }
    return "操作";
  };

  const setSessionMode = (key: string, mode: SessionMode) => {
    const state = ensureSessionState(key);
    state.mode = mode;
    if (mode !== "meta") {
      metaStates.delete(key);
    }
    if (mode !== "settingsInput") {
      settingsInputStates.delete(key);
    }
    if (mode !== "adminInput") {
      adminInputStates.delete(key);
    }
    if (mode !== "collectionInput") {
      collectionInputStates.delete(key);
    }
    if (mode !== "collectionPicker") {
      collectionPickerStates.delete(key);
    }
    if (mode !== "broadcastInput") {
      broadcastInputStates.delete(key);
    }
    if (mode !== "commentInput") {
      commentInputStates.delete(key);
    }
    const nextState = sessionStates.get(key);
    if (!nextState) {
      return;
    }
    if (mode !== "upload" && nextState.active === true) {
      nextState.active = false;
    }
    if (!deleteIfIdle(key, nextState)) {
      upsertTouchedState(key, nextState, Date.now());
    }
  };

  const ensureSessionMode = (key: string): SessionMode => {
    const mode = getSessionMode(key);
    if (mode === "upload") {
      if (sessionStates.get(key)?.active === true) {
        return mode;
      }
      setSessionMode(key, "idle");
      return "idle";
    }
    if (mode === "meta" && !metaStates.has(key)) {
      setSessionMode(key, "idle");
      return "idle";
    }
    if (mode === "settingsInput" && !settingsInputStates.has(key)) {
      setSessionMode(key, "idle");
      return "idle";
    }
    if (mode === "adminInput" && !adminInputStates.has(key)) {
      setSessionMode(key, "idle");
      return "idle";
    }
    if (mode === "collectionInput" && !collectionInputStates.has(key)) {
      setSessionMode(key, "idle");
      return "idle";
    }
    if (mode === "collectionPicker" && !collectionPickerStates.has(key)) {
      setSessionMode(key, "idle");
      return "idle";
    }
    if (mode === "broadcastInput" && !broadcastInputStates.has(key)) {
      setSessionMode(key, "idle");
      return "idle";
    }
    if (mode === "commentInput" && !commentInputStates.has(key)) {
      setSessionMode(key, "idle");
      return "idle";
    }
    return mode;
  };

  const syncSessionForView = (ctx: Context) => {
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!ctx.from || !chatId) {
      return;
    }
    const key = toMetaKey(ctx.from.id, chatId);
    const active = sessionStates.get(key)?.active === true;
    setSessionMode(key, active ? "upload" : "idle");
  };

  const setActive = (userId: number, chatId: number, value: boolean) => {
    const key = toMetaKey(userId, chatId);
    const state = ensureSessionState(key);
    state.active = value;
    upsertTouchedState(key, state, Date.now());
    setSessionMode(key, value ? "upload" : "idle");
  };

  const isActive = (userId: number, chatId: number) => {
    const key = toMetaKey(userId, chatId);
    const state = sessionStates.get(key);
    if (!state) {
      return false;
    }
    upsertTouchedState(key, state, Date.now());
    return state.active === true;
  };

  return {
    metaStates,
    adminInputStates,
    settingsInputStates,
    broadcastDraftStates,
    broadcastInputStates,
    collectionStates,
    historyFilterStates,
    historyDateStates,
    historyScopeStates,
    collectionInputStates,
    collectionPickerStates,
    searchStates,
    commentInputStates,
    rankingViewStates,
    getSessionMode,
    getSessionLabel,
    setSessionMode,
    ensureSessionMode,
    syncSessionForView,
    setActive,
    isActive
  };
};
