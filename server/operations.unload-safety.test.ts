import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("运输卸土时长与地点安全校验", () => {
  it("路线保存输入和模型必须包含最短运输分钟数与卸土定位容差", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    const schema = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");
    expect(source).toContain("minimumTransitMinutes");
    expect(source).toContain("unloadGeofenceMeters");
    expect(schema).toContain("minimumTransitMinutes");
    expect(schema).toContain("unloadGeofenceMeters");
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

  it("手机确认卸土必须申请真实定位并提交给服务端", () => {
    const component = readFileSync(new URL("../client/src/components/MobileNfcTransportInvoice.tsx", import.meta.url), "utf8");
    expect(component).toContain("navigator.geolocation.getCurrentPosition");
    expect(component).toContain("不能确认已到达卸土点");
    expect(component).toContain("latitude, longitude");
  });
});
