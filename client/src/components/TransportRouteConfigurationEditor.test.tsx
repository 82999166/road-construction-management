import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("装卸土点与路线编辑", () => {
  it("为既有装卸土点提供坐标补录和编辑入口", () => {
    const source = readFileSync(new URL("./TransportRouteConfigurationEditor.tsx", import.meta.url), "utf8");
    expect(source).toContain("补录坐标");
    expect(source).toContain("编辑装土点");
    expect(source).toContain("编辑卸土点");
    expect(source).toContain("saveSite.mutate");
  });

  it("为既有路线提供线路与安全参数编辑入口", () => {
    const source = readFileSync(new URL("./TransportRouteConfigurationEditor.tsx", import.meta.url), "utf8");
    expect(source).toContain("编辑路线");
    expect(source).toContain("saveRoute.mutate");
    expect(source).toContain("minimumTransitEnabled");
    expect(source).toContain("unloadGeofenceEnabled");
  });
});
