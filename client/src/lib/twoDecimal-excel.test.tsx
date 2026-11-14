import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({writeFile: vi.fn()}));
vi.mock("@e965/xlsx", async importOriginal => ({
  ...await importOriginal<typeof import("@e965/xlsx")>(), writeFile: mocks.writeFile,
}));
import { downloadSettlementPaymentWorkbook } from "./settlementPaymentExport";

describe("actual Excel business amounts show 2 decimals but remain numbers", () => {
  it("styles numeric columns without rounding or coercing raw amounts, preserves counts and text safety", async () => {
    const XLSX = await import("@e965/xlsx");
    const rows = [["合成记录", 3, 3], ["=2+2", 4, 430.432], ["零值", 0, 0]];
    const before = JSON.stringify(rows);
    await downloadSettlementPaymentWorkbook({filename:"合成.xlsx", overview:[["说明", "合成，无正式业务"]], sheets:[{name:"明细", headers:["名称", "笔数", "金额"], rows, twoDecimalColumns:[2]}]});
    const workbook = mocks.writeFile.mock.calls.at(-1)?.[0];
    const bytes = XLSX.write(workbook, {type:"buffer", bookType:"xlsx"});
    const read = XLSX.read(bytes, {type:"buffer", cellNF:true});
    const sheet = read.Sheets["明细"];
    expect(sheet.C2.t).toBe("n");
    expect(sheet.C2.v).toBe(3);
    expect(XLSX.utils.format_cell(sheet.C2)).toBe("3.00");
    expect(sheet.C3.v).toBe(430.432);
    expect(sheet.C3.t).toBe("n");
    expect(XLSX.utils.format_cell(sheet.C3)).toBe("430.43");
    expect(sheet.C4.v).toBe(0);
    expect(XLSX.utils.format_cell(sheet.C4)).toBe("0.00");
    expect(sheet.B2.v).toBe(3);
    expect(sheet.B2.z).not.toBe("#,##0.00");
    expect(sheet.A3.v).toBe("'=2+2");
    expect(sheet.A3.f).toBeUndefined();
    expect(JSON.stringify(rows)).toBe(before);
  });
});
