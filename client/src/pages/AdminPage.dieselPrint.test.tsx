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
    expect(source).toContain("const dieselCurrentSummary = useMemo(() => summarizeDieselLedgerRecords");
    expect(source).toContain("dateLabel={dieselCurrentFilterLabel}");
    expect(source).toContain('dieselRefuelRecords.data ?? []) as DieselPrintRecord[]');
    expect(source).toContain('导出当前筛选明细');
    expect(source).not.toContain('aria-label="柴油每日汇总日期"');
    expect(source).not.toContain("dieselDailySummary.data");
  });

  it("后台柴油台账和新建登记使用中国时区显示与设备当前时间", () => {
    expect(source).toContain('import { formatChinaDateTime, toChinaDateInput, toChinaMonthInput, toDeviceDateInput, toDeviceDateTimeInput } from "@/lib/businessTime"');
    expect(source).toContain("return formatChinaDateTime(value);");
    expect(source).toContain("refueledAt: toDeviceDateTimeInput()");
    expect(source).toContain("const recordDate = toChinaDateInput(record.refueledAt);");
  });
});
