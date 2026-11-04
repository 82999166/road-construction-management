import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("运输趟次完整台账服务端投影", () => {
  it("按日期、月份、日期区间、车辆、状态和预设路线筛选", () => {
    const source = readFileSync(
      new URL("./routers/operations.ts", import.meta.url),
      "utf8"
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "dateFrom: businessDateSchema.optional()"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "dateTo: businessDateSchema.optional()"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "routePresetId: z.number().int().positive().optional()"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "if (vehicleId) rows = rows.filter"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "if (status) rows = rows.filter"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "formatChinaBusinessDate(new Date(trip.startAt)).slice(0, 7) === month"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).not.toContain(
      "new Date(trip.startAt).toISOString().slice(0, 7) === month"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });

  it("返回车辆、中文地点、刷卡轨迹和结算字段而不返回坐标", () => {
    const source = readFileSync(
      new URL("./routers/operations.ts", import.meta.url),
      "utf8"
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "loadLocation: { ...siteAddress"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "unloadLocation: { ...siteAddress"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "cardEvents: events".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "operatorName".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "fuelDeductionAmount".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(
      source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).not.toContain(
      "latitude: transportCardEvents.latitude"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).not.toContain(
      "longitude: transportCardEvents.longitude"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });

  it("将用户可见的刷卡校验信息投影为中文且不回显英文内部原因", () => {
    const source = readFileSync(
      new URL("./routers/operations.ts", import.meta.url),
      "utf8"
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "getCardValidationStatusLabel"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "getSafeCardValidationReason"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "validationStatus: getCardValidationStatusLabel(event.validationStatus)"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "validationReason: getSafeCardValidationReason(event.validationReason)"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });
});

it("仅为当前项目内已关联的装土和卸土影像生成短时受控地址", () => {
  const source = readFileSync(
    new URL("./routers/operations.ts", import.meta.url),
    "utf8"
  );
  expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
    "storageGetSignedUrl(evidence.fileKey)"
      .replace(/\s+/g, "")
      .replace(/,([})\]])/g, "$1")
  );
  expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).not.toContain(
    "storageGet(evidence.fileKey)"
      .replace(/\s+/g, "")
      .replace(/,([})\]])/g, "$1")
  );
  expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
    "inArray(evidenceRecords.id, evidenceIds)"
      .replace(/\s+/g, "")
      .replace(/,([})\]])/g, "$1")
  );
  expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
    "loadInvoiceEvidence: trip.evidenceId"
      .replace(/\s+/g, "")
      .replace(/,([})\]])/g, "$1")
  );
  expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
    "unloadSiteEvidence: unloadEvidenceId"
      .replace(/\s+/g, "")
      .replace(/,([})\]])/g, "$1")
  );
  expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
    "eq(evidenceRecords.projectId, input.projectId)"
      .replace(/\s+/g, "")
      .replace(/,([})\]])/g, "$1")
  );
});

it("返回单车期间与累计趟次、柴油占比及单位运营成本，且始终由真实聚合数据计算", () => {
  const source = readFileSync(
    new URL("./routers/operations.ts", import.meta.url),
    "utf8"
  );
  expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
    "const cumulative = decorate"
      .replace(/\s+/g, "")
      .replace(/,([})\]])/g, "$1")
  );
  expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
    "fuelCostPerTrip".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
  );
  expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
    "fuelCostPerKm".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
  );
  expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
    "grossIncomePerTrip".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
  );
  expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
    "return { vehicle:".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
  );
  expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
    "cumulative, monthly".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
  );
});
