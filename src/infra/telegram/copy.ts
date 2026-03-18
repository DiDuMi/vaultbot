import type { Bot } from "grammy";
import { withTelegramRetry } from "./retry";

type CopyToVaultInput = {
  fromChatId: string | number;
  messageId: number;
  toChatId: string | number;
  threadId?: number;
};

export const copyToVault = async (bot: Bot, input: CopyToVaultInput) => {
  const run = () => {
    if (input.threadId !== undefined) {
      return bot.api.copyMessage(input.toChatId, input.fromChatId, input.messageId, {
        message_thread_id: input.threadId
      });
    }
    return bot.api.copyMessage(input.toChatId, input.fromChatId, input.messageId);
  };
  return withTelegramRetry(run);
};
