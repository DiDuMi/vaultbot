import type { Bot, Context } from "grammy";
import { logErrorThrottled } from "../../infra/logging";
import type { DeliveryService } from "../../services/use-cases";
import { type KeyValueStore, toMetaKey } from "./ui-utils";

export const registerTenantMiddlewares = (
  bot: Bot,
  deps: {
    deliveryService: DeliveryService | null;
    collectionStates: KeyValueStore<string | null>;
    historyFilterStates: KeyValueStore<string | null | undefined>;
    historyDateStates: KeyValueStore<Date>;
  }
) => {
  bot.use(async (ctx, next) => {
    if (deps.deliveryService && ctx.from) {
      await deps.deliveryService
        .upsertTenantUserFromTelegram({
          id: ctx.from.id,
          is_bot: ctx.from.is_bot,
          first_name: ctx.from.first_name,
          last_name: ctx.from.last_name,
          username: ctx.from.username,
          language_code: ctx.from.language_code
        })
        .catch((error) =>
          logErrorThrottled({ component: "tenant", op: "upsert_tenant_user" }, error, { intervalMs: 30_000 })
        );
    }
    await next();
  });

  const hydrateUserPreferences = async (ctx: Context) => {
    if (!deps.deliveryService || !ctx.from) {
      return;
    }
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    if (!chatId) {
      return;
    }
    const key = toMetaKey(ctx.from.id, chatId);
    const userId = String(ctx.from.id);
    const tasks: Promise<void>[] = [];
    if (!deps.collectionStates.has(key)) {
      tasks.push(
        deps.deliveryService
          .getUserDefaultCollectionId(userId)
          .then((value) => {
            deps.collectionStates.set(key, value);
          })
          .catch((error) =>
            logErrorThrottled(
              { component: "tenant", op: "hydrate_user_default_collection", userId },
              error,
              { intervalMs: 30_000 }
            )
          )
      );
    }
    if (!deps.historyFilterStates.has(key)) {
      tasks.push(
        deps.deliveryService
          .getUserHistoryCollectionFilter(userId)
          .then((value) => {
            deps.historyFilterStates.set(key, value);
          })
          .catch((error) =>
            logErrorThrottled({ component: "tenant", op: "hydrate_user_history_filter", userId }, error, { intervalMs: 30_000 })
          )
      );
    }
    if (!deps.historyDateStates.has(key)) {
      tasks.push(
        deps.deliveryService
          .getUserHistoryListDate(userId)
          .then((value) => {
            if (value) {
              deps.historyDateStates.set(key, value);
            }
          })
          .catch((error) =>
            logErrorThrottled({ component: "tenant", op: "hydrate_user_history_date", userId }, error, { intervalMs: 30_000 })
          )
      );
    }
    if (tasks.length > 0) {
      await Promise.all(tasks);
    }
  };

  return { hydrateUserPreferences };
};
