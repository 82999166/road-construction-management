import { escapeSpreadsheetCell } from "@/lib/a4Print";

type Cell = string | number | null | undefined;
type ExportSheet = { name: string; headers: string[]; rows: Cell[][]; widths?: number[]; twoDecimalColumns?: number[] };

/** 月度内部对账只导出服务器已鉴权的当前筛选记录；不接受或生成签名URL、完整账户或文件键。 */
export async function downloadSettlementPaymentWorkbook({
  filename,
  overview,
  sheets,
}: {
  filename: string;
  overview: Array<[string, Cell]>;
  sheets: ExportSheet[];
}) {
  const XLSX = await import("@e965/xlsx");
  const workbook = XLSX.utils.book_new();
  const overviewSheet = XLSX.utils.aoa_to_sheet(overview.map(([label, value]) => [escapeSpreadsheetCell(label), escapeSpreadsheetCell(value)]));
  overviewSheet["!cols"] = [{ wch: 24 }, { wch: 52 }];
  XLSX.utils.book_append_sheet(workbook, overviewSheet, "汇总说明");
  for (const sheet of sheets) {
    const safeRows = sheet.rows.map(row => row.map(escapeSpreadsheetCell));
    const worksheet = XLSX.utils.aoa_to_sheet([sheet.headers.map(escapeSpreadsheetCell), ...safeRows]);
    for (const col of sheet.twoDecimalColumns ?? []) {
      for (let row = 1; row <= safeRows.length; row++) {
        const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: col })];
        if (cell?.t === "n") cell.z = "#,##0.00";
      }
    }
    worksheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(safeRows.length, 1), c: Math.max(sheet.headers.length - 1, 0) } }) };
    worksheet["!cols"] = sheet.headers.map((header, index) => ({ wch: sheet.widths?.[index] ?? Math.min(Math.max(header.length + 4, 12), 28) }));
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  }
  XLSX.writeFile(workbook, filename, { compression: true });
}
