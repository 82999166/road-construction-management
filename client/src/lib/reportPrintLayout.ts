/** 打印预览与独立 A4 共用百分比列宽，不受弹窗宽度或长单号影响。 */
export const TRANSPORT_FREIGHT_PRINT_COLUMN_WIDTHS = [
  3, 10, 8, 13, 17, 5, 5, 7, 9, 8, 8, 7,
] as const;
export const DIESEL_REFUEL_COLUMN_WIDTHS = [
  3, 11, 10, 5, 12, 9, 8, 8, 9, 9, 8, 8,
] as const;
export const DIESEL_SUMMARY_COLUMN_WIDTHS = [
  3, 10, 12, 9, 8, 12, 7, 7, 8, 8, 10, 6,
] as const;

/** 只生成布局标记；业务文案仍必须由调用方 escapePrintHtml。 */
export function printColumnGroup(widths: readonly number[]) {
  if (
    !widths.length ||
    widths.some(width => !Number.isFinite(width) || width <= 0) ||
    Math.abs(widths.reduce((sum, width) => sum + width, 0) - 100) > 0.001
  ) {
    throw new Error("打印列宽必须为正数，且总和为 100%");
  }
  return `<colgroup>${widths.map(width => `<col style="width:${width}%">`).join("")}</colgroup>`;
}
