import type { Bot } from "grammy";
import {
  registerAdsCallbacks,
  registerAdminAndInputCallbacks,
  registerAssetCallbacks,
  registerAssetManageCallbacks,
  registerBroadcastCallbacks,
  registerCollectionsCallbacks,
  registerCommentCallbacks,
  registerFollowCallbacks,
  registerNotifyCallbacks,
  registerFootprintCallbacks,
  registerHelpCallbacks,
  registerHistoryCallbacks,
  registerHomeCallbacks,
  registerRankingCallbacks,
  registerSearchCallbacks,
  registerTagCallbacks,
  registerSettingsCallbacks,
  registerUploadCallbacks
} from "./callbacks/index";
import type { TenantCallbackDeps } from "./callbacks/index";

export const registerTenantCallbackRoutes = (bot: Bot, deps: TenantCallbackDeps) => {
  registerAssetManageCallbacks(bot, deps);
  registerUploadCallbacks(bot, deps);
  registerAssetCallbacks(bot, deps);
  registerCommentCallbacks(bot, deps);
  registerFootprintCallbacks(bot, deps);
  registerHistoryCallbacks(bot, deps);
  registerHelpCallbacks(bot, deps);
  registerFollowCallbacks(bot, deps);
  registerNotifyCallbacks(bot, deps);
  registerSearchCallbacks(bot, deps);
  registerTagCallbacks(bot, deps);
  registerSettingsCallbacks(bot, deps);
  registerBroadcastCallbacks(bot, deps);
  registerAdsCallbacks(bot, deps);
  registerAdminAndInputCallbacks(bot, deps);
  registerCollectionsCallbacks(bot, deps);
  registerHomeCallbacks(bot, deps);
  registerRankingCallbacks(bot, deps);
};
