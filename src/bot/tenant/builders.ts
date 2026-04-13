import { escapeHtml, buildStartLink, stripHtmlTags } from "./ui-utils";

const ASSET_ACTION_LABEL = "操作";
const ASSET_ACTION_SEPARATOR = " ｜ ";

export const buildPreviewLinkLine = (openLink?: string) => {
  return openLink ? `打开链接：<a href="${escapeHtml(openLink)}">点击预览</a>` : "";
};

export const buildPreviewCopyLines = (openLink?: string, title?: string) => {
  if (!openLink) {
    return [];
  }
  const safeOpenLink = escapeHtml(openLink);
  const plainTitle = stripHtmlTags(title ?? "").trim() || "未命名";
  const safeTitle = escapeHtml(plainTitle);
  return [
    "预览链接（可复制）",
    `<code>预览 - ${safeOpenLink}</code>`,
    "分享文案（可复制）",
    `<code>${safeTitle}\n\n预览 - ${safeOpenLink}</code>`
  ];
};

export const buildAssetActionLine = (options: {
  username?: string;
  shareCode?: string | null;
  assetId: string;
  canManage: boolean;
}) => {
  const manageCode = `m_${options.assetId}`;
  const manageLink = options.canManage && options.username ? buildStartLink(options.username, manageCode) : undefined;
  const openLink =
    options.shareCode && options.username ? buildStartLink(options.username, `p_${options.shareCode}`) : undefined;
  const line = [
    manageLink ? `<a href="${escapeHtml(manageLink)}">管理</a>` : "",
    openLink ? `<a href="${escapeHtml(openLink)}">点击查看</a>` : ""
  ]
    .filter(Boolean)
    .join(ASSET_ACTION_SEPARATOR);
  return line ? `${ASSET_ACTION_LABEL}：${line}` : "";
};
