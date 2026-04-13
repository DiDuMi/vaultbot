import type { Bot, Context } from "grammy";
import type { Message } from "grammy/types";
import type { UploadMessage } from "../../services/use-cases";
import { actionKeyboard, buildMainKeyboard } from "./keyboards";
import { replyHtml } from "./ui-utils";

type ReplyMarkup = NonNullable<Parameters<Context["reply"]>[1]>["reply_markup"];

type UploadBatchStore = {
  addMessage: (userId: number, chatId: number, message: UploadMessage) => { messages: UploadMessage[] };
};

const formatReceivedHint = (count: number) => {
  if (count < 10) {
    return String(count);
  }
  const base = Math.floor(count / 10) * 10;
  return `${base}+`;
};

const toUploadMessage = (message: Message, kind: UploadMessage["kind"]): UploadMessage => {
  const fileId =
    kind === "photo"
      ? message.photo?.[message.photo.length - 1]?.file_id
      : kind === "video"
        ? message.video?.file_id
        : kind === "document"
          ? message.document?.file_id
          : kind === "audio"
            ? message.audio?.file_id
            : kind === "voice"
              ? message.voice?.file_id
              : message.animation?.file_id;
  return {
    messageId: message.message_id,
    chatId: message.chat.id,
    kind,
    mediaGroupId: message.media_group_id ?? undefined,
    fileId: fileId ?? undefined
  };
};

export const registerMediaHandlers = (
  bot: Bot,
  store: UploadBatchStore,
  isActive: (userId: number, chatId: number) => boolean,
  options?: {
    shouldSkipInactiveHint?: (userId: number, chatId: number, kind: UploadMessage["kind"]) => boolean;
    getInactiveHint?: (userId: number, chatId: number, kind: UploadMessage["kind"]) => string | null;
    getInactiveReplyKeyboard?: (ctx: Context) => Promise<ReplyMarkup | undefined> | ReplyMarkup | undefined;
  }
) => {
  const handle =
    (kind: UploadMessage["kind"]) =>
    async (ctx: Context, next: () => Promise<void>) => {
      if (!ctx.message || !ctx.from || !ctx.chat) {
        return;
      }
      if (!isActive(ctx.from.id, ctx.chat.id)) {
        if (options?.shouldSkipInactiveHint?.(ctx.from.id, ctx.chat.id, kind)) {
          await next();
          return;
        }
        const hint = options?.getInactiveHint?.(ctx.from.id, ctx.chat.id, kind) ?? "请点击<b>分享</b>开始接收媒体。";
        const replyKeyboard = options?.getInactiveReplyKeyboard ? await options.getInactiveReplyKeyboard(ctx) : buildMainKeyboard();
        await replyHtml(ctx, hint, {
          reply_markup: replyKeyboard ?? buildMainKeyboard()
        });
        return;
      }
      const batch = store.addMessage(ctx.from.id, ctx.chat.id, toUploadMessage(ctx.message, kind));
      if (batch.messages.length === 1) {
        await replyHtml(ctx, "已接收第 <b>1</b> 个文件。继续发送，发送完点击 <b>✅ 完成</b> 保存。", {
          reply_markup: actionKeyboard
        });
        return;
      }
      if (batch.messages.length % 10 === 0) {
        const hint = formatReceivedHint(batch.messages.length);
        await replyHtml(ctx, `已接收 <b>${hint}</b> 个文件。继续发送，发送完点击 <b>✅ 完成</b> 保存。`, {
          reply_markup: actionKeyboard
        });
      }
    };

  bot.on("message:photo", handle("photo"));
  bot.on("message:video", handle("video"));
  bot.on("message:document", handle("document"));
  bot.on("message:audio", handle("audio"));
  bot.on("message:voice", handle("voice"));
  bot.on("message:animation", handle("animation"));
};
