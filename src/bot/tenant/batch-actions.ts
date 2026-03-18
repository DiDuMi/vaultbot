import type { UploadMessage, UploadService } from "../../services/use-cases";
import { createUploadBatchStore } from "../../services/use-cases";
import { logError } from "../../infra/logging";
import { escapeHtml } from "./ui-utils";

type UploadBatchStore = ReturnType<typeof createUploadBatchStore>;

const buildBatchSummary = (messages: UploadMessage[]) => {
  const counts = {
    photo: 0,
    video: 0,
    animation: 0,
    document: 0,
    audio: 0,
    voice: 0,
    other: 0
  };
  for (const message of messages) {
    if (message.kind === "photo") {
      counts.photo += 1;
    } else if (message.kind === "video") {
      counts.video += 1;
    } else if (message.kind === "animation") {
      counts.animation += 1;
    } else if (message.kind === "document") {
      counts.document += 1;
    } else if (message.kind === "audio") {
      counts.audio += 1;
    } else if (message.kind === "voice") {
      counts.voice += 1;
    } else {
      counts.other += 1;
    }
  }
  const total = messages.length;
  return `本次共 ${total} 条\n图片 ${counts.photo} · 视频 ${counts.video} · GIF ${counts.animation} · 文档 ${counts.document} · 音频 ${counts.audio} · 语音 ${counts.voice} · 其他 ${counts.other}`;
};

export const createBatchActions = (store: UploadBatchStore, service: UploadService) => {
  const commit = async (userId: number, chatId: number) => {
    const batch = store.getBatch(userId, chatId);
    if (!batch || batch.status !== "pending") {
      return { ok: false, message: "⚠️ 当前没有待保存的批次。" };
    }
    try {
      const result = await service.commitBatch(batch);
      store.commit(userId, chatId);
      const summary = buildBatchSummary(batch.messages);
      return {
        ok: true,
        assetId: result.assetId,
        message: `✅ 已完成保存\n批次：<code>${escapeHtml(batch.id)}</code>\n${escapeHtml(summary)}`
      };
    } catch (error) {
      logError({ component: "bot", op: "upload_commit", userId, chatId, batchId: batch.id }, error);
      return { ok: false, message: "❌ 保存失败，请稍后重试。" };
    }
  };

  const cancel = async (userId: number, chatId: number) => {
    const batch = store.cancel(userId, chatId);
    if (!batch) {
      return { ok: false, message: "⚠️ 当前没有待保存的批次。" };
    }
    return {
      ok: true,
      message: `🗑️ 已取消保存\n批次：<code>${escapeHtml(batch.id)}</code>\n共 <b>${batch.messages.length}</b> 条`
    };
  };

  return { commit, cancel };
};
