import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PRINT_PREVIEW_DIALOG_BODY_CLASS,
  PRINT_PREVIEW_DIALOG_CONTENT_CLASS,
  PRINT_PREVIEW_DIALOG_FOOTER_CLASS,
  PRINT_PREVIEW_DIALOG_HEADER_CLASS,
  PRINT_PREVIEW_TABLE_FIT_CLASS,
  PRINT_PREVIEW_TABLE_FRAME_CLASS,
} from "./PrintPreviewDialogLayout";

const printPreviewComponents = [
  "DieselRefuelPrintDialog.tsx",
  "DieselSummaryPrintDialog.tsx",
  "MachinerySummaryPrintDialog.tsx",
  "TransportFreightPrintDialog.tsx",
  "FinancialLedgerPrintPreviewDialog.tsx",
];

describe("PC 筛选打印预览宽屏布局契约", () => {
  it("定义与柴油同款的工作区级宽屏容器、固定首尾区域及无横向拖动表格边界", () => {
    expect(PRINT_PREVIEW_DIALOG_CONTENT_CLASS).toContain("w-[calc(100vw-3rem)]");
    expect(PRINT_PREVIEW_DIALOG_CONTENT_CLASS).toContain("max-w-[1680px]");
    expect(PRINT_PREVIEW_DIALOG_CONTENT_CLASS).toContain("h-[min(82vh,820px)]");
    expect(PRINT_PREVIEW_DIALOG_CONTENT_CLASS).toContain("lg:left-[calc(50%+5rem)]");
    expect(PRINT_PREVIEW_DIALOG_CONTENT_CLASS).toContain("grid-rows-[auto_minmax(0,1fr)_auto]");
    expect(PRINT_PREVIEW_DIALOG_HEADER_CLASS).toContain("shrink-0");
    expect(PRINT_PREVIEW_DIALOG_BODY_CLASS).toContain("min-h-0");
    expect(PRINT_PREVIEW_DIALOG_BODY_CLASS).toContain("overflow-auto");
    expect(PRINT_PREVIEW_DIALOG_FOOTER_CLASS).toContain("shrink-0");
    expect(PRINT_PREVIEW_TABLE_FRAME_CLASS).toContain("overflow-hidden");
    expect(PRINT_PREVIEW_TABLE_FIT_CLASS).toContain("min-w-0");
    expect(PRINT_PREVIEW_TABLE_FIT_CLASS).toContain("table-fixed");
  });

  it("将当前所有带筛选的业务打印预览弹窗接入同一布局契约", () => {
    for (const fileName of printPreviewComponents) {
      const source = readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");
      expect(source).toContain('from "@/components/PrintPreviewDialogLayout"');
      expect(source).toContain("PRINT_PREVIEW_DIALOG_CONTENT_CLASS");
      expect(source).toContain("PRINT_PREVIEW_DIALOG_HEADER_CLASS");
      expect(source).toContain("PRINT_PREVIEW_DIALOG_BODY_CLASS");
      expect(source).toContain("PRINT_PREVIEW_DIALOG_FOOTER_CLASS");
      expect(source).toContain("PRINT_PREVIEW_TABLE_FRAME_CLASS");
      expect(source).toContain("PRINT_PREVIEW_TABLE_FIT_CLASS");
      expect(source).not.toContain("PRINT_PREVIEW_TABLE_SCROLL_CLASS");
    }
  });
});
