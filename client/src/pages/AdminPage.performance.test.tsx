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

  it("仅在系统设置使用的通知通道配置不进入后台首屏静态依赖", () => {
    const adminPage = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(adminPage).toContain('lazy(() => import("@/components/NotificationChannelSettings"))');
    expect(adminPage).not.toContain('import NotificationChannelSettings from "@/components/NotificationChannelSettings"');
    expect(adminPage).toContain("正在加载短信与通知通道配置…");
  });

  it("低频财务与柴油打印预览不进入后台首屏静态依赖", () => {
    const adminPage = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(adminPage).toContain('lazy(() => import("@/components/DieselRefuelPrintDialog"))');
    expect(adminPage).toContain('lazy(() => import("@/components/PaymentAccountBillPrintDialog")');
    expect(adminPage).toContain('lazy(() => import("@/components/FinancialLedgerPrintPreviewDialogs")');
    expect(adminPage).not.toContain('import DieselRefuelPrintDialog, { type DieselPrintRecord } from "@/components/DieselRefuelPrintDialog"');
    expect(adminPage).not.toContain('import { PaymentAccountBillPrintDialog } from "@/components/PaymentAccountBillPrintDialog"');
    expect(adminPage).not.toContain('import { FinancialLedgerPrintPreviewDialogs } from "@/components/FinancialLedgerPrintPreviewDialogs"');
  });
});
