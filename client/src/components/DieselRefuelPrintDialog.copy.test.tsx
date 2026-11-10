import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./DieselRefuelPrintDialog.tsx", import.meta.url), "utf8");

describe("柴油 A4 明细打印中文状态", () => {
  it("打印状态列使用中文标签和安全回退，且继续复用中国时区格式化", () => {
    expect(source).toContain("const statusLabel = (status: string)");
    expect(source).toContain('?? "待处理"');
    expect(source).toContain("escapePrintHtml(statusLabel(item.status))");
    expect(source).not.toContain("escapePrintHtml(item.status)</td>");
    expect(source).toContain("formatChinaDateTime");
  });

  it("预览窗口接入统一工作区级宽度，标题和操作区固定且宽表不再要求横向拖动", () => {
    expect(source).toContain("PRINT_PREVIEW_DIALOG_CONTENT_CLASS");
    expect(source).toContain("PRINT_PREVIEW_DIALOG_BODY_CLASS");
    expect(source).toContain("PRINT_PREVIEW_DIALOG_FOOTER_CLASS");
    expect(source).toContain("PRINT_PREVIEW_TABLE_FIT_CLASS");
    expect(source).not.toContain("PRINT_PREVIEW_TABLE_SCROLL_CLASS");
  });

  it("预览和A4打印均使用固定列宽、真实加油员与对应跨列合计，避免表头和汇总错位", () => {
    expect(source).toContain("refuelerName: string | null");
    expect(source).toContain('const refuelerName = (value: string | null | undefined) => value?.trim() || "未登记"');
    expect(source).toContain("DIESEL_REFUEL_COLUMN_WIDTHS");
    expect(source).toContain("<colgroup>{DIESEL_REFUEL_COLUMN_WIDTHS.map");
    expect(source).toContain("printColumnGroup(DIESEL_REFUEL_COLUMN_WIDTHS)");
    expect(source).toContain("<th>加油员</th>");
    expect(source).toContain('colspan="12"');
    expect(source).toContain('colspan="6"');
    expect(source).toContain('colSpan={12}');
    expect(source).toContain('colSpan={6}');
    expect(source).toContain('colSpan={3}');
    expect(source).not.toContain('whitespace-nowrap');
    expect(source).toContain("PRINT_PREVIEW_TABLE_FIT_CLASS");
    expect(source).toContain("tabular-nums");
    expect(source).toContain("escapePrintHtml(refuelerName(item.refuelerName))");
  });
});
