export { registerAssetCallbacks, registerAssetManageCallbacks, registerUploadCallbacks } from "./assets";
export {
  registerAdsCallbacks,
  registerAdminAndInputCallbacks,
  registerBroadcastCallbacks,
  registerCollectionsCallbacks,
  registerSettingsCallbacks
} from "./admin";
export { registerHomeCallbacks, registerRankingCallbacks } from "./home";
export {
  registerCommentCallbacks,
  registerFollowCallbacks,
  registerNotifyCallbacks,
  registerFootprintCallbacks,
  registerHelpCallbacks,
  registerHistoryCallbacks,
  registerSearchCallbacks,
  registerTagCallbacks
} from "./social";
export type { TenantCallbackDeps } from "./types";
