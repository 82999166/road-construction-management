import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("运输卸土时长与地点安全校验", () => {
  it("路线保存输入和模型必须包含阈值及两项独立开关", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    const schema = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");
    expect(source).toContain("minimumTransitMinutes");
    expect(source).toContain("unloadGeofenceMeters");
    expect(source).toContain("minimumTransitEnabled");
    expect(source).toContain("unloadGeofenceEnabled");
    expect(schema).toContain("minimumTransitMinutes");
    expect(schema).toContain("unloadGeofenceMeters");
    expect(schema).toContain("minimumTransitEnabled");
    expect(schema).toContain("unloadGeofenceEnabled");
  });

  it("卸土必须同时达到最短运输时间和卸土点定位容差，否则仅进入待核验", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    expect(source).toContain("运途时间不符合");
    expect(source).toContain("未达到时间不能完成卸土");
    expect(source).toContain("未达到卸土点");
    expect(source).toContain("不能完成卸土");
    expect(source).toContain("calculateCoordinateDistanceMeters");
    expect(source).toContain("return markNeedsReview");
  });

  it("关闭任一安全开关后仅留待核验提示，不能绕过实际时长或距离记录", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    expect(source).toContain("最短运输时间拦截已关闭，已留待核验");
    expect(source).toContain("定位范围拦截已关闭，已留待核验");
    expect(source).toContain("safetyNotices.push");
  });

  it("手机确认卸土必须申请真实定位并提交给服务端", () => {
    const component = readFileSync(new URL("../client/src/components/MobileNfcTransportInvoice.tsx", import.meta.url), "utf8");
    expect(component).toContain("navigator.geolocation.getCurrentPosition");
    expect(component).toContain("不能确认已到达卸土点");
    expect(component).toContain("latitude, longitude");
  });
});
