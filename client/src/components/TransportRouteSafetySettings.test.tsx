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
});
