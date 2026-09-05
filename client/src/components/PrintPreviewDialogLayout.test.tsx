import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PRINT_PREVIEW_DIALOG_BODY_CLASS,
  PRINT_PREVIEW_DIALOG_CONTENT_CLASS,
  PRINT_PREVIEW_DIALOG_FOOTER_CLASS,
  PRINT_PREVIEW_DIALOG_HEADER_CLASS,
  PRINT_PREVIEW_TABLE_SCROLL_CLASS,
} from "./PrintPreviewDialogLayout";

const printPreviewComponents = [
  "DieselRefuelPrintDialog.tsx",
  "DieselSummaryPrintDialog.tsx",
  "MachinerySummaryPrintDialog.tsx",
  "TransportFreightPrintDialog.tsx",
];

describe("PC 筛选打印预览宽屏布局契约", () => {
  it("定义宽屏容器、固定首尾区域以及独立的纵向和横向滚动边界", () => {
    expect(PRINT_PREVIEW_DIALOG_CONTENT_CLASS).toContain("w-[calc(100vw-2rem)]");
    expect(PRINT_PREVIEW_DIALOG_CONTENT_CLASS).toContain("max-w-[1600px]");
    expect(PRINT_PREVIEW_DIALOG_CONTENT_CLASS).toContain("h-[min(94vh,1024px)]");
    expect(PRINT_PREVIEW_DIALOG_CONTENT_CLASS).toContain("grid-rows-[auto_minmax(0,1fr)_auto]");
    expect(PRINT_PREVIEW_DIALOG_CONTENT_CLASS).toContain("print:h-auto");
    expect(PRINT_PREVIEW_DIALOG_HEADER_CLASS).toContain("shrink-0");
    expect(PRINT_PREVIEW_DIALOG_BODY_CLASS).toContain("min-h-0");
    expect(PRINT_PREVIEW_DIALOG_BODY_CLASS).toContain("overflow-auto");
    expect(PRINT_PREVIEW_DIALOG_FOOTER_CLASS).toContain("shrink-0");
    expect(PRINT_PREVIEW_TABLE_SCROLL_CLASS).toContain("overflow-x-auto");
  });

  it("将当前所有带筛选的业务打印预览弹窗接入同一布局契约", () => {
    for (const fileName of printPreviewComponents) {
      const source = readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");
      expect(source).toContain('from "@/components/PrintPreviewDialogLayout"');
      expect(source).toContain("PRINT_PREVIEW_DIALOG_CONTENT_CLASS");
      expect(source).toContain("PRINT_PREVIEW_DIALOG_HEADER_CLASS");
      expect(source).toContain("PRINT_PREVIEW_DIALOG_BODY_CLASS");
      expect(source).toContain("PRINT_PREVIEW_DIALOG_FOOTER_CLASS");
      expect(source).toContain("PRINT_PREVIEW_TABLE_SCROLL_CLASS");
    }
  });
});
