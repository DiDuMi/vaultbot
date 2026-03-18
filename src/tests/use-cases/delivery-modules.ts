import assert from "node:assert/strict";
import { createDeliveryCore } from "../../services/use-cases/delivery-core";
import { createDeliveryPreferences } from "../../services/use-cases/delivery-preferences";

type TestFn = (name: string, run: () => Promise<void> | void) => void;

const createPreferencesForTest = () => {
  const pref = new Map<string, string | null>();
  return createDeliveryPreferences({
    prisma: {} as never,
    preferenceKeys: {
      defaultCollectionId: "a",
      historyCollectionFilter: "b",
      historyListDate: "c",
      followKeywords: "d",
      notifyFollowEnabled: "e",
      notifyCommentEnabled: "f",
      notifyState: "g"
    },
    getTenantId: async () => "tenant1",
    getPreference: async (userId, key) => pref.get(`${userId}:${key}`) ?? null,
    upsertPreference: async (userId, key, value) => {
      pref.set(`${userId}:${key}`, value);
    },
    deletePreference: async (userId, key) => {
      pref.delete(`${userId}:${key}`);
    },
    startOfLocalDay: (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()),
    formatLocalDate: (date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
  });
};

export const registerDeliveryModuleTests = (test: TestFn) => {
  test("delivery-core: 本地时间工具按预期工作", () => {
    const core = createDeliveryCore({
      prisma: {} as never,
      config: { tenantCode: "t1", tenantName: "T1" }
    });
    const d = new Date(2026, 2, 18, 15, 22, 10);
    assert.equal(core.formatLocalDate(d), "2026-03-18");
    const day = core.startOfLocalDay(d);
    assert.equal(day.getHours(), 0);
    assert.equal(day.getMinutes(), 0);
    const weekFromSunday = core.startOfLocalWeek(new Date(2026, 2, 22));
    assert.equal(weekFromSunday.getDay(), 1);
    const month = core.startOfLocalMonth(d);
    assert.equal(month.getDate(), 1);
  });

  test("delivery-preferences: 关键词去重并限制最多5个", async () => {
    const prefs = createPreferencesForTest();
    const result = await prefs.setUserFollowKeywords("u1", [" A ", "a", "b", "c", "d", "e", "f"]);
    assert.equal(result.ok, true);
    const list = await prefs.getUserFollowKeywords("u1");
    assert.deepEqual(list, ["A", "b", "c", "d", "e"]);
  });

  test("delivery-preferences: 通知去重与节流生效", async () => {
    const prefs = createPreferencesForTest();
    const first = await prefs.checkAndRecordUserNotification("u1", {
      type: "follow",
      uniqueId: "n1",
      minIntervalMs: 60_000
    });
    const duplicate = await prefs.checkAndRecordUserNotification("u1", {
      type: "follow",
      uniqueId: "n1",
      minIntervalMs: 60_000
    });
    const throttled = await prefs.checkAndRecordUserNotification("u1", {
      type: "follow",
      uniqueId: "n2",
      minIntervalMs: 60_000
    });
    assert.equal(first, true);
    assert.equal(duplicate, false);
    assert.equal(throttled, false);
  });
};
