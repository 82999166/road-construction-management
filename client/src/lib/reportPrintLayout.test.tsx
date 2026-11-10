import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TRANSPORT_FREIGHT_PRINT_COLUMN_WIDTHS,
  DIESEL_REFUEL_COLUMN_WIDTHS,
  DIESEL_SUMMARY_COLUMN_WIDTHS,
  printColumnGroup,
} from "./reportPrintLayout";
import { PRINT_PREVIEW_TABLE_FIT_CLASS } from "../components/PrintPreviewDialogLayout";

const widths = [TRANSPORT_FREIGHT_PRINT_COLUMN_WIDTHS, DIESEL_REFUEL_COLUMN_WIDTHS, DIESEL_SUMMARY_COLUMN_WIDTHS];
const reportPrintTableCss = readFileSync(new URL("./reportPrintTable.css", import.meta.url), "utf8");

describe("共享打印表格布局", () => {
  it.each(widths.map((columns, index) => ({ columns, index })))("第 $index 份十二列宽度为 100%，colgroup 保留每列百分比", ({ columns }) => {
    expect(columns).toHaveLength(12);
    expect(columns.reduce((sum, width) => sum + width, 0)).toBe(100);
    const markup = printColumnGroup(columns);
    expect(markup).toBe(`<colgroup>${columns.map(width => `<col style="width:${width}%">`).join("")}</colgroup>`);
    expect(markup.match(/<col style=/g)).toHaveLength(12);
  });

  it.each([[], [20, 20], [100, 0], [101, -1], [Number.NaN, 100], [Infinity]].map(columns => ({ columns })))("拒绝无效列宽 $columns", ({ columns }) => {
    expect(() => printColumnGroup(columns)).toThrow("打印列宽必须为正数");
  });

  it("标准预览与独立 A4 从同一份 CSS 获取 table 语义，不受窄屏卡片布局污染", () => {
    expect(PRINT_PREVIEW_TABLE_FIT_CLASS).toContain("print-preview-table-fit");
    expect(readFileSync(new URL("../index.css", import.meta.url), "utf8")).toContain('@import "./lib/reportPrintTable.css"');
    expect(readFileSync(new URL("./a4Print.ts", import.meta.url), "utf8")).toContain('${reportPrintTableCss}');
    for (const display of ["table", "table-column-group", "table-column", "table-header-group", "table-row-group", "table-footer-group", "table-row", "table-cell"]) {
      expect(reportPrintTableCss).toContain(`display: ${display} !important;`);
    }
    expect(reportPrintTableCss).toContain("table-layout: fixed !important;");
    expect(reportPrintTableCss).not.toMatch(/display:\s*(?:grid|flex|block)/);
  });

  it("长单号、长路线与大金额换行不截断，实体边框清楚，数字依显式语义右对齐", () => {
    expect(reportPrintTableCss).toContain("border: 1px solid #334155 !important;");
    expect(reportPrintTableCss).toContain("white-space: normal !important;");
    expect(reportPrintTableCss).toContain("overflow-wrap: anywhere !important;");
    expect(reportPrintTableCss).toContain("overflow: visible !important;");
    expect(reportPrintTableCss).toContain("-webkit-line-clamp: unset !important;");
    expect(reportPrintTableCss).toContain(":is(td.right, td.text-right)");
    expect(reportPrintTableCss).toContain("text-align: right !important;");
    expect(reportPrintTableCss).toContain("font-variant-numeric: tabular-nums;");
    expect(reportPrintTableCss).not.toContain("nth-child");
    expect(reportPrintTableCss).not.toMatch(/(?:colspan|img|voucher-grid)[^{]*\{/);
  });

  it.each([
    ["TransportFreightPrintDialog.tsx", "TRANSPORT_FREIGHT_PRINT_COLUMN_WIDTHS"],
    ["DieselRefuelPrintDialog.tsx", "DIESEL_REFUEL_COLUMN_WIDTHS"],
    ["DieselSummaryPrintDialog.tsx", "DIESEL_SUMMARY_COLUMN_WIDTHS"],
  ])("%s 的两条打印路径只读取同一列宽定义", (file, columns) => {
    const source = readFileSync(new URL(`../components/${file}`, import.meta.url), "utf8");
    expect(source).toContain(`printColumnGroup(${columns})`);
    expect(source).toContain(`<colgroup>{${columns}.map`);
    expect(source).not.toMatch(/<th (?:style="width:|className="w-\[)/);
  });
});
