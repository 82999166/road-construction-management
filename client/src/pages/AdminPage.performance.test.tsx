import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const readSource = (path: Parameters<typeof readFileSync>[0]) =>
  readFileSync(path, "utf8")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/,\s*}/g, " }");

describe("超级管理后台首屏依赖", () => {
  it("将工具知识工作区与其子工具保留为独立的按需加载边界", () => {
    const adminPage = readSource(new URL("./AdminPage.tsx", import.meta.url));
    const toolsPanel = readSource(
      new URL("../components/AdminMeasurementToolsPanel.tsx", import.meta.url)
    );

    expect(adminPage).toContain(
      'lazy(() => import("@/components/AdminMeasurementToolsPanel"))'
    );
    expect(adminPage).toContain('activeSection === "measurement-tools" ?');
    expect(adminPage).toContain("<AdminMeasurementToolsPanel />");
    expect(adminPage).not.toContain(
      'lazy(() => import("@/components/ConstructionToolbox"))'
    );
    expect(toolsPanel).toContain(
      '() => import("@/components/ToolKnowledgeWorkspace")'
    );
    expect(toolsPanel).toContain(
      "<ToolKnowledgeWorkspace includeSettlementTemplate />"
    );
    expect(toolsPanel).toContain("正在加载工程测算工具…");
  });

  it("仅在系统设置使用的通知通道配置不进入后台首屏静态依赖", () => {
    const adminPage = readSource(new URL("./AdminPage.tsx", import.meta.url));

    expect(adminPage).toContain(
      'lazy(() => import("@/components/NotificationChannelSettings"))'
    );
    expect(adminPage).not.toContain(
      'import NotificationChannelSettings from "@/components/NotificationChannelSettings"'
    );
    expect(adminPage).toContain("正在加载短信与通知通道配置…");
  });

  it("低频财务与柴油打印预览不进入后台首屏静态依赖", () => {
    const adminPage = readSource(new URL("./AdminPage.tsx", import.meta.url));

    expect(adminPage).toContain(
      'lazy(() => import("@/components/DieselRefuelPrintDialog"))'
    );
    expect(adminPage).toContain(
      'lazy(() => import("@/components/PaymentAccountBillPrintDialog")'
    );
    expect(adminPage).toContain(
      'lazy(() => import("@/components/FinancialLedgerPrintPreviewDialogs")'
    );
    expect(adminPage).not.toContain(
      'import DieselRefuelPrintDialog, { type DieselPrintRecord } from "@/components/DieselRefuelPrintDialog"'
    );
    expect(adminPage).not.toContain(
      'import { PaymentAccountBillPrintDialog } from "@/components/PaymentAccountBillPrintDialog"'
    );
    expect(adminPage).not.toContain(
      'import { FinancialLedgerPrintPreviewDialogs } from "@/components/FinancialLedgerPrintPreviewDialogs"'
    );
  });
});
