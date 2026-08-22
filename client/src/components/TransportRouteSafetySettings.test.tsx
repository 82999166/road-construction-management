import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("运输路线安全开关", () => {
  it("将最短时间和定位范围分别作为可保存的硬拦截开关", () => {
    const source = readFileSync(new URL("./TransportRouteSafetySettings.tsx", import.meta.url), "utf8");
    expect(source).toContain("minimumTransitEnabled");
    expect(source).toContain("unloadGeofenceEnabled");
    expect(source).toContain("硬拦截");
    expect(source).toContain("仅提示");
  });

  it("将明细阈值设置收纳在摘要入口打开的弹窗内", () => {
    const source = readFileSync(new URL("./TransportRouteSafetySettings.tsx", import.meta.url), "utf8");
    expect(source).toContain("settingsOpen");
    expect(source).toContain("<Dialog open={settingsOpen}");
    expect(source).toContain("compact = false");
  });
});
