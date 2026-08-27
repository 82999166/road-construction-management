import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getScopedPcAdminSection } from "./scopedManagementWorkspace";

describe("普通管理员 PC 业务工作区映射", () => {
  it("将六类核心业务映射到与超级管理员一致的 PC 台账分区", () => {
    expect(getScopedPcAdminSection("CONSTRUCTION")).toBe("construction");
    expect(getScopedPcAdminSection("LABOR")).toBe("labor");
    expect(getScopedPcAdminSection("MACHINERY")).toBe("machinery");
    expect(getScopedPcAdminSection("TRANSPORT")).toBe("transport");
    expect(getScopedPcAdminSection("PURCHASING")).toBe("purchasing");
    expect(getScopedPcAdminSection("MEASUREMENT")).toBe("subcontract");
  });

  it("不将柴油、财务和现场取证错误映射为全局治理 PC 分区", () => {
    expect(getScopedPcAdminSection("DIESEL")).toBeNull();
    expect(getScopedPcAdminSection("FINANCE")).toBeNull();
    expect(getScopedPcAdminSection("EVIDENCE")).toBeNull();
  });

  it("核心模块路由将复用统一 PC 后台，而不会回退为独立移动端页面", () => {
    const source = readFileSync(new URL("../../pages/ScopedManagementModulePage.tsx", import.meta.url), "utf8");

    expect(source).toContain("const scopedAdminSection = getScopedPcAdminSection(module.code)");
    expect(source).toContain("<AdminPage scopedSection={scopedAdminSection} />");
    expect(source).toContain('subcontract: { code: "MEASUREMENT"');
    expect(source).toContain('contracts: { code: "CONTRACT"');
  });
});
