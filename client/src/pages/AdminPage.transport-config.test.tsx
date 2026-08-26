import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PC运输配置入口收敛", () => {
  it("仅保留统一的地点与路线配置组件，不再展示旧版一次配置卡", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("<TransportRouteConfigurationEditor projectId={workspaceProjectId} />");
    expect(source).toContain("正在加载装卸土点与运输路线配置…");
    expect(source.indexOf("<TransportRouteConfigurationEditor projectId={workspaceProjectId} />")).toBeLessThan(source.indexOf("transportVehicleLedger.isLoading || transportTrips.isLoading"));
    expect(source).not.toContain("运输路线一次配置");
    expect(source).not.toContain("一次配置运输路线");
  });
});
