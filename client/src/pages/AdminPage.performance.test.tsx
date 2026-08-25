import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("超级管理后台首屏依赖", () => {
  it("将工具知识工作区与其子工具保留为独立的按需加载边界", () => {
    const adminPage = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");
    const toolsPanel = readFileSync(new URL("../components/AdminMeasurementToolsPanel.tsx", import.meta.url), "utf8");

    expect(adminPage).toContain('lazy(() => import("@/components/AdminMeasurementToolsPanel"))');
    expect(adminPage).toContain('activeSection === "measurement-tools" ? <AdminMeasurementToolsPanel />');
    expect(adminPage).not.toContain('lazy(() => import("@/components/ConstructionToolbox"))');
    expect(toolsPanel).toContain('lazy(() => import("@/components/ConstructionToolbox"))');
    expect(toolsPanel).toContain('lazy(() => import("@/components/SettlementTemplateCalculator"))');
    expect(toolsPanel).toContain('正在加载工程测算工具…');
  });
});
