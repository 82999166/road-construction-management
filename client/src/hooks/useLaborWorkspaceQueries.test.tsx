import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("useLaborWorkspaceQueries", () => {
  it("统一承接劳务台账查询，并保留父级受控启用条件与按需导出", () => {
    const source = readFileSync(new URL("./useLaborWorkspaceQueries.ts", import.meta.url), "utf8");
    expect(source).toContain("listWorkers.useQuery");
    expect(source).toContain("listCheckIns.useQuery");
    expect(source).toContain("payroll.list.useQuery");
    expect(source).toContain("dailyWage.list.useQuery");
    expect(source).toContain("exportWorkbookData.useQuery");
    expect(source).toContain("exportPaymentList.useQuery");
    expect(source).toContain("{ enabled }");
    expect(source).toContain("enabled: false");
  });
});
