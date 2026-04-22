import type { Bot } from "grammy";
import { createUploadBatchStore, type DeliveryService, type UploadService } from "../../services/use-cases";
import { registerProjectBotCore } from "./register-core";

export { createProjectRenderers } from "./renderers";
export { registerProjectCommands } from "./commands";
export { registerProjectMessageHandlers } from "./messages";
export { registerProjectMiddlewares } from "./middlewares";
export { registerProjectCallbackRoutes } from "./callbacks";

type UploadBatchStore = ReturnType<typeof createUploadBatchStore>;

export const registerProjectBot = (
  bot: Bot,
  store: UploadBatchStore,
  service: UploadService,
  deliveryService: DeliveryService | null
) => {
  return registerProjectBotCore(bot, store, service, deliveryService);
};
