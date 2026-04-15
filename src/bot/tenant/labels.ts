import { isSingleOwnerModeEnabled } from "../../infra/runtime-mode";
import { t } from "../../i18n";

type LabelOptions = {
  locale?: string | null;
};

export const getManagerLabel = (options?: LabelOptions) =>
  isSingleOwnerModeEnabled() ? t("role.project_owner", options) : t("role.admin", options);

export const getMemberLabel = (options?: LabelOptions) =>
  isSingleOwnerModeEnabled() ? t("role.project_member", options) : t("role.tenant_member", options);

export const getMemberScopeLabel = (options?: LabelOptions) =>
  isSingleOwnerModeEnabled() ? t("scope.project_member", options) : t("scope.tenant", options);

export const getStorageGroupLabel = (options?: LabelOptions) => t("resource.storage_group", options);

export const getBroadcastLabel = (options?: LabelOptions) => t("resource.broadcast", options);

export const getBackLabel = (options?: LabelOptions) => t("nav.back", options);

export const getHomeLabel = (options?: LabelOptions) => t("nav.home", options);

export const getRefreshLabel = (options?: LabelOptions) => t("nav.refresh", options);

export const getMoreLabel = (options?: LabelOptions) => t("nav.more", options);

export const getCollapseLabel = (options?: LabelOptions) => t("nav.collapse", options);

export const getShareLabel = (options?: LabelOptions) => t("nav.share", options);

export const getListLabel = (options?: LabelOptions) => t("nav.list", options);

export const getSearchLabel = (options?: LabelOptions) => t("nav.search", options);

export const getFootprintLabel = (options?: LabelOptions) => t("nav.footprint", options);

export const getMyLabel = (options?: LabelOptions) => t("nav.my", options);

export const getSettingsLabel = (options?: LabelOptions) => t("nav.settings", options);

export const getStatsLabel = (options?: LabelOptions) => t("nav.stats", options);

export const getRankingLabel = (options?: LabelOptions) => t("nav.ranking", options);

export const getNotifyLabel = (options?: LabelOptions) => t("nav.notify", options);

export const getOpenContentLabel = (options?: LabelOptions) => t("action.open_content", options);

export const getEditLabel = (options?: LabelOptions) => t("action.edit", options);

export const getHideLabel = (options?: LabelOptions) => t("action.hide", options);

export const getShowLabel = (options?: LabelOptions) => t("action.show", options);

export const getRecycleLabel = (options?: LabelOptions) => t("action.recycle", options);

export const getRecycleBinLabel = (options?: LabelOptions) => t("action.recycle_bin", options);

export const getRestoreLabel = (options?: LabelOptions) => t("action.restore", options);

export const getPreviewLabel = (options?: LabelOptions) => t("action.preview", options);

export const getDeleteDraftLabel = (options?: LabelOptions) => t("action.delete_draft", options);

export const getRecentReportLabel = (options?: LabelOptions) => t("action.recent_report", options);
