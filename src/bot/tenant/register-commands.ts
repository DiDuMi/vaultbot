import type { Bot, Context } from "grammy";
import { logErrorThrottled } from "../../infra/logging";
import type { DeliveryService } from "../../services/use-cases";

export const registerTenantCommands = (
  bot: Bot,
  deps: {
    deliveryService: DeliveryService | null;
    resetSessionForCommand: (ctx: Context) => Promise<void>;
    trackStartPayloadVisit: (
      ctx: Context,
      payload: string,
      entry: "command" | "text_link",
      status: "received" | "routed_social" | "opened" | "failed",
      reason?: string
    ) => Promise<void>;
    handleStartPayloadEntry: (ctx: Context, payload: string, entry: "command" | "text_link") => Promise<boolean>;
    renderStartHome: (ctx: Context) => Promise<void>;
    renderHelp: (ctx: Context) => Promise<void>;
    exitCurrentInputState: (ctx: Context) => Promise<boolean>;
    renderTagIndex: (ctx: Context, mode: "reply" | "edit", page?: number) => Promise<void>;
    renderFootprint: (ctx: Context, tab: "open" | "like" | "comment" | "reply", range: "7d" | "30d" | "all", page: number, mode: "reply" | "edit") => Promise<void>;
  }
) => {
  bot.command("start", async (ctx) => {
    await deps.resetSessionForCommand(ctx);
    const payload = ctx.match?.trim();
    if (payload) {
      await deps.trackStartPayloadVisit(ctx, payload, "command", "received");
      await deps.handleStartPayloadEntry(ctx, payload, "command");
      return;
    }
    if (deps.deliveryService && ctx.from) {
        await deps.deliveryService
        .trackVisit(String(ctx.from.id), "start")
        .catch((error) =>
          logErrorThrottled({ component: "project_bot", op: "track_visit", scope: "start" }, error, { intervalMs: 30_000 })
        );
    }
    await deps.renderStartHome(ctx);
  });

  bot.command("help", async (ctx) => {
    await deps.resetSessionForCommand(ctx);
    if (deps.deliveryService && ctx.from) {
        await deps.deliveryService
        .trackVisit(String(ctx.from.id), "help")
        .catch((error) =>
          logErrorThrottled({ component: "project_bot", op: "track_visit", scope: "help" }, error, { intervalMs: 30_000 })
        );
    }
    await deps.renderHelp(ctx);
  });

  bot.command("cancel", async (ctx) => {
    await deps.exitCurrentInputState(ctx);
  });

  bot.command("history", async (ctx) => {
    await deps.renderFootprint(ctx, "open", "30d", 1, "reply");
  });

  bot.command("tag", async (ctx) => {
    await deps.resetSessionForCommand(ctx);
    if (deps.deliveryService && ctx.from) {
        await deps.deliveryService
        .trackVisit(String(ctx.from.id), "tag")
        .catch((error) =>
          logErrorThrottled({ component: "project_bot", op: "track_visit", scope: "tag" }, error, { intervalMs: 30_000 })
        );
    }
    await deps.renderTagIndex(ctx, "reply");
  });
};
