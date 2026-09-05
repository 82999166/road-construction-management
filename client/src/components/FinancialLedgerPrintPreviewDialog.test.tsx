import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("财务账本打印预览", () => {
  it("只接收当前筛选后的真实数据投影，并使用统一的宽屏预览与 A4 横向打印工具", () => {
    const source = readFileSync(new URL("./FinancialLedgerPrintPreviewDialog.tsx", import.meta.url), "utf8");
    expect(source).toContain("FinancialPrintRow");
    expect(source).toContain("当前筛选后的真实数据投影");
    expect(source).toContain("PRINT_PREVIEW_DIALOG_CONTENT_CLASS");
    expect(source).toContain("PRINT_PREVIEW_TABLE_SCROLL_CLASS");
    expect(source).toContain("openA4LandscapePrintDocument");
    expect(source).toContain("summaryLabel");
    expect(source).toContain("print:min-w-0");
  });
});
