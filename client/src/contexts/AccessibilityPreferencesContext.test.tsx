import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  parseAccessibilityPreferences,
  STORAGE_KEY,
} from "./AccessibilityPreferencesContext";

describe("个人显示与辅助偏好", () => {
  it("使用无业务数据的独立本地存储键和安全默认值", () => {
    expect(STORAGE_KEY).toBe("yx.ui-accessibility.v1");
    expect(DEFAULT_PREFERENCES).toEqual({ version: 1, textWeight: "normal", layoutScale: "normal" });
    expect(parseAccessibilityPreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(parseAccessibilityPreferences("not-json")).toEqual(DEFAULT_PREFERENCES);
  });

  it("只接受当前版本的两项合法显示偏好，未知值安全回退", () => {
    expect(parseAccessibilityPreferences(JSON.stringify({ version: 1, textWeight: "bold", layoutScale: "large" }))).toEqual({ version: 1, textWeight: "bold", layoutScale: "large" });
    expect(parseAccessibilityPreferences(JSON.stringify({ version: 2, textWeight: "bold", layoutScale: "large" }))).toEqual(DEFAULT_PREFERENCES);
    expect(parseAccessibilityPreferences(JSON.stringify({ version: 1, textWeight: "heavy", layoutScale: "zoom" }))).toEqual(DEFAULT_PREFERENCES);
  });
});
