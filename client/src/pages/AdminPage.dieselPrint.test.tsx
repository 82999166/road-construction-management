import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("后台柴油顶部筛选直接打印", () => {
  const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

  it("将车牌下拉、机械名称与当前筛选打印置于同一顶部筛选范围", () => {
    expect(source).toContain('data-diesel-current-print');
    expect(source).toContain('aria-label="柴油筛选车牌"');
    expect(source).toContain('aria-label="柴油顶部机械名称筛选"');
    expect(source).toContain('打印当前筛选明细与汇总');
  });

  it("保持打印记录、导出明细和页面台账共同使用服务端 dieselRefuelRecords 筛选结果", () => {
    expect(source).toContain('trpc.admin.diesel.listRefuelRecords.useQuery(dieselRefuelRecordsInput');
    expect(source).toContain('dieselPrintMode === "vehicle" ? (dieselRefuelRecords.data ?? []).filter(item => item.assetType === "vehicle")');
    expect(source).toContain('dieselPrintMode === "machine" ? (dieselRefuelRecords.data ?? []).filter(item => item.assetType === "machine")');
    expect(source).toContain('dieselRefuelRecords.data ?? []) as DieselPrintRecord[]');
    expect(source).toContain('导出当前筛选明细');
  });
});
