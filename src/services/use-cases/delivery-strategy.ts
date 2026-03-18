export const normalizePage = (page: number) => (page < 1 ? 1 : page);

export const normalizePageSize = (pageSize: number, options?: { defaultSize?: number; maxSize?: number }) => {
  const safeDefault = options?.defaultSize ?? 20;
  const maxSize = options?.maxSize;
  const size = pageSize < 1 ? safeDefault : pageSize;
  return typeof maxSize === "number" ? Math.min(size, maxSize) : size;
};

export const normalizeLimit = (limit: number, options?: { defaultLimit?: number; maxLimit?: number }) => {
  const safeDefault = options?.defaultLimit ?? 10;
  const maxLimit = options?.maxLimit;
  const value = limit < 1 ? safeDefault : limit;
  return typeof maxLimit === "number" ? Math.min(value, maxLimit) : value;
};

export const normalizeMinReplicas = (value: number) => {
  if (!Number.isFinite(value)) {
    return 1;
  }
  const rounded = Math.trunc(value);
  if (rounded < 1) {
    return 1;
  }
  if (rounded > 3) {
    return 3;
  }
  return rounded;
};
