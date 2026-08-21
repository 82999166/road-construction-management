import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("LaborCheckInLedger", () => {
  it("仅展示中文详细地址，并通过父级受控 CSV 导出当前日期记录", () => {
    const source = readFileSync(new URL("./LaborCheckInLedger.tsx", import.meta.url), "utf8");

    expect(source).toContain("上班打卡位置（中文地址）");
    expect(source).toContain("下班打卡位置（中文地址）");
    expect(source).toContain("onExportCsv");
    expect(source).toContain("getLocationReviewText");
    expect(source).toContain("原始坐标须走争议核验留痕流程");
    expect(source).not.toContain("longitude");
    expect(source).not.toContain("latitude");
  });
});
