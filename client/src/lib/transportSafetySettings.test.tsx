import { describe, expect, it } from "vitest";
import {
  transportSafetySummary,
  validateTransportSafetyDraft,
} from "./transportSafetySettings";
const base = {
  minimumTransitMinutes: "2",
  minimumTransitEnabled: false,
  unloadGeofenceMeters: "300",
  unloadGeofenceEnabled: false,
};
describe("运输安全阈值输入与已保存摘要", () => {
  it.each(["49000", "5001", "29", "", " ", "NaN", "300.5", "Infinity"])(
    "定位%s不允许保存且不自动夹到最大值",
    value => {
      const result = validateTransportSafetyDraft({
        ...base,
        unloadGeofenceMeters: value,
      });
      expect(result.valid).toBe(false);
      expect(result.unloadGeofenceError).toContain("30～5000");
      expect(result.minimumTransitError).toBeNull();
    }
  );
  it.each(["30", "300", "5000"])(
    "有效定位%s在两个开关关闭时仍可保存",
    value => {
      expect(
        validateTransportSafetyDraft({ ...base, unloadGeofenceMeters: value })
          .valid
      ).toBe(true);
    }
  );
  it.each(["0", "1441", "", "2.5"])("最短时间%s给字段专属错误", value => {
    const result = validateTransportSafetyDraft({
      ...base,
      minimumTransitMinutes: value,
    });
    expect(result.valid).toBe(false);
    expect(result.minimumTransitError).toContain("分钟");
    expect(result.unloadGeofenceError).toBeNull();
  });
  it.each([
    [true, false],
    [false, true],
    [true, true],
    [false, false],
  ])("两个硬拦截开关%s/%s独立说明", (time, geo) => {
    const summary = transportSafetySummary({
      minimumTransitMinutes: 2,
      unloadGeofenceMeters: 500,
      minimumTransitEnabled: time,
      unloadGeofenceEnabled: geo,
    });
    expect(summary).toBe(
      `最短2分钟（${time ? "硬拦截" : "仅提示、不拦截"}）；定位允许偏差500米（${geo ? "硬拦截" : "仅提示、不拦截"}）`
    );
  });
});
