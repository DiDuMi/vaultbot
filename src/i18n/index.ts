import { enUSMessages } from "./messages/en-US";
import { zhCNMessages } from "./messages/zh-CN";

const messageCatalog = {
  "zh-CN": zhCNMessages,
  "en-US": enUSMessages
} as const;

export type SupportedLocale = keyof typeof messageCatalog;
export type MessageKey = keyof typeof zhCNMessages;

const DEFAULT_LOCALE: SupportedLocale = "zh-CN";

const languageCodeToLocale = (languageCode?: string | null): SupportedLocale => {
  const normalized = (languageCode || "").trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_LOCALE;
  }
  if (normalized.startsWith("zh")) {
    return "zh-CN";
  }
  return "en-US";
};

export const normalizeLocale = (input?: string | null): SupportedLocale => {
  const normalized = (input || "").trim();
  if (!normalized) {
    return DEFAULT_LOCALE;
  }
  if (normalized in messageCatalog) {
    return normalized as SupportedLocale;
  }
  return languageCodeToLocale(normalized);
};

export const getDefaultLocale = (): SupportedLocale => {
  return normalizeLocale(process.env.DEFAULT_LOCALE);
};

export const resolveLocaleFromTelegramLanguageCode = (languageCode?: string | null): SupportedLocale => {
  return languageCodeToLocale(languageCode);
};

const interpolate = (template: string, values?: Record<string, string | number>) => {
  if (!values) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name];
    return value === undefined ? `{${name}}` : String(value);
  });
};

export const t = (key: MessageKey, options?: { locale?: string | null; fallback?: string; values?: Record<string, string | number> }): string => {
  const locale = normalizeLocale(options?.locale ?? getDefaultLocale());
  const localized = messageCatalog[locale][key];
  if (typeof localized === "string") {
    return interpolate(localized, options?.values);
  }
  return interpolate(options?.fallback ?? zhCNMessages[key], options?.values);
};

export const createTranslator = (locale?: string | null) => {
  const normalizedLocale = normalizeLocale(locale);
  return (key: MessageKey, options?: { fallback?: string; values?: Record<string, string | number> }) =>
    t(key, { locale: normalizedLocale, fallback: options?.fallback, values: options?.values });
};

export const supportedLocales = Object.keys(messageCatalog) as SupportedLocale[];
