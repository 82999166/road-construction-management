import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("柴油 A4 汇总打印模板", () => {
  it("只查询受控真实柴油汇总，并将明细和末行合计写入独立打印文档", () => {
    const source = readFileSync(new URL("./DieselSummaryPrintDialog.tsx", import.meta.url), "utf8");

    expect(source).toContain("trpc.diesel.printSummary.useQuery");
    expect(source).toContain("dateFrom");
    expect(source).toContain("dateTo");
    expect(source).toContain("meterReading");
    expect(source).toContain("deductibleAmount");
    expect(source).toContain("openA4LandscapePrintDocument");
    expect(source).toContain("合计：记录");
    expect(source).toContain('const statusDisplay = (status: string | null | undefined) => statusLabel[status ?? ""] ?? "待处理"');
    expect(source).toContain("statusDisplay(record.status)");
    expect(source).not.toContain("statusLabel[record.status] ?? record.status");
  });
});
