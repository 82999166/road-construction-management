import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("运输趟次完整台账服务端投影", () => {
  it("按日期、月份、日期区间、车辆、状态和预设路线筛选", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    expect(source).toContain("dateFrom: businessDateSchema.optional()");
    expect(source).toContain("dateTo: businessDateSchema.optional()");
    expect(source).toContain("routePresetId: z.number().int().positive().optional()");
    expect(source).toContain("if (vehicleId) rows = rows.filter");
    expect(source).toContain("if (status) rows = rows.filter");
  });

  it("返回车辆、中文地点、刷卡轨迹和结算字段而不返回坐标", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    expect(source).toContain("loadLocation: { ...siteAddress");
    expect(source).toContain("unloadLocation: { ...siteAddress");
    expect(source).toContain("cardEvents: events");
    expect(source).toContain("operatorName");
    expect(source).toContain("fuelDeductionAmount");
    expect(source).not.toContain("latitude: transportCardEvents.latitude");
    expect(source).not.toContain("longitude: transportCardEvents.longitude");
  });
});


  it("仅为当前项目内已关联的装土和卸土影像生成短时受控地址", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    expect(source).toContain("storageGetSignedUrl(evidence.fileKey)");
    expect(source).not.toContain("storageGet(evidence.fileKey)");
    expect(source).toContain("inArray(evidenceRecords.id, evidenceIds)");
    expect(source).toContain("loadInvoiceEvidence: trip.evidenceId");
    expect(source).toContain("unloadSiteEvidence: unloadEvidenceId");
    expect(source).toContain("eq(evidenceRecords.projectId, input.projectId)");
  });

  it("返回单车期间与累计趟次、柴油占比及单位运营成本，且始终由真实聚合数据计算", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    expect(source).toContain("const cumulative = decorate");
    expect(source).toContain("fuelCostPerTrip");
    expect(source).toContain("fuelCostPerKm");
    expect(source).toContain("grossIncomePerTrip");
    expect(source).toContain("return { vehicle:");
    expect(source).toContain("cumulative, monthly");
  });
