export const isSingleOwnerModeEnabled = () => {
  const raw = (process.env.SINGLE_OWNER_MODE || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
};
