import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  emptyVehicleFinanceSources,
  projectVehicleFinance,
} from "./services/vehicleFinance";

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
  )
    .replace(/\s+/g, "")
    .replace(/,([})\]])/g, "$1");
  // 列表和详情必须复用同一投影，不能只测试一个与真实调用脱节的 helper。
  expect(source).toContain(
    "projectVehicleFinance(vehicle,projectId,input.period,sources,profiles.find(p=>p.vehicleId===vehicle.id))"
  );
  expect(source).toContain(
    "projectVehicleFinance(vehicle,input.projectId,input.period,sources,profile)"
  );
  expect(source).toContain(
    "...analysis.summary,summary:analysis.summary,cumulative:analysis.cumulative"
  );
  expect(source).toContain("period:input.period,...analysis");
  const sources = emptyVehicleFinanceSources();
  const vehicle = { id: 7, projectId: 2, ownership: "owned" };
  const trip = {
    id: 1,
    vehicleId: 7,
    projectId: 2,
    status: "verified",
    startAt: "2026-08-02",
    tripNo: "TR-1",
    calculatedAmount: "1000",
    netSettlementAmount: "800",
    actualDistanceKm: "20",
  };
  sources.trips = [
    trip,
    {
      ...trip,
      id: 2,
      tripNo: "TR-2",
      calculatedAmount: "500",
      netSettlementAmount: "500",
      actualDistanceKm: "10",
      status: "settled",
    },
    { ...trip, id: 3, status: "pending_review", calculatedAmount: "900" },
    { ...trip, id: 4, status: "void", calculatedAmount: "999999" },
    { ...trip, id: 5, projectId: 99, calculatedAmount: "999999" },
    { ...trip, id: 6, vehicleId: 99 },
    {
      ...trip,
      id: 7,
      startAt: "2026-07-10",
      tripNo: "TR-OLD",
      calculatedAmount: "600",
      netSettlementAmount: "600",
      actualDistanceKm: "10",
    },
    { ...trip, id: 8, startAt: "2026-09-01" },
  ];
  const fuel = {
    id: 1,
    vehicleId: 7,
    projectId: 2,
    assetType: "vehicle",
    status: "approved",
    refueledAt: "2026-08-02",
    amount: "300",
    liters: "40",
  };
  sources.refuels = [
    fuel,
    { ...fuel, id: 2, status: "submitted", amount: "50" },
    { ...fuel, id: 3, status: "void", amount: "999999" },
    { ...fuel, id: 4, assetType: "machine" },
    { ...fuel, id: 5, refueledAt: "2026-07-10", amount: "100", liters: "10" },
  ];
  const maintenance = {
    id: 1,
    assetId: 7,
    projectId: 2,
    assetType: "vehicle",
    status: "approved",
    occurredAt: "2026-08-02",
    amount: "100",
    costCategory: "repair",
  };
  sources.maintenance = [
    maintenance,
    { ...maintenance, id: 2, amount: "20", costCategory: "maintenance" },
    { ...maintenance, id: 3, assetType: "machine", amount: "999999" },
  ];
  sources.purchases = [
    {
      id: 1,
      assetId: 7,
      projectId: 2,
      assetType: "vehicle",
      status: "received",
      orderedAt: "2026-08-02",
      amount: "30",
    },
  ];
  const result = projectVehicleFinance(vehicle, 2, "2026-08", sources);
  expect(result.summary).toMatchObject({
    tripCount: 3,
    confirmedTripCount: 2,
    pendingTripCount: 1,
    confirmedTransportAmount: 1500,
    pendingTransportAmount: 900,
    settlementIncome: 1300,
    fuelAmount: 300,
    fuelLiters: 40,
    repairAmount: 100,
    maintenanceAmount: 20,
    partsAmount: 30,
    pendingCostAmount: 50,
    coveredCostAmount: 450,
    operatingContributionAmount: 1050,
    fuelCostRatio: 20,
    fuelCostPerTrip: 150,
    fuelCostPerKm: 10,
    fuelLitersPerTrip: 20,
    grossIncomePerTrip: 750,
    grossIncomePerKm: 50,
    costCoverageComplete: false,
  });
  expect(result.cumulative).toMatchObject({
    tripCount: 4,
    confirmedTripCount: 3,
    confirmedTransportAmount: 2100,
    fuelAmount: 400,
    coveredCostAmount: 550,
    operatingContributionAmount: 1550,
  });
  expect(result.daily).toHaveLength(1);
  expect(result.daily[0]).toMatchObject({
    date: "2026-08-02",
    confirmedTransportAmount: 1500,
    coveredCostAmount: 450,
  });
  expect(
    result.monthly.map(row => [
      row.date,
      row.confirmedTransportAmount,
      row.coveredCostAmount,
    ])
  ).toEqual([
    ["2026-08", 1500, 450],
    ["2026-07", 600, 100],
  ]);
  expect(result.summary.costCoverageNote).toContain("不代表公司净利润");
  expect(result.summary.fuelMetricNote).toContain("不代表实际百公里耗油");
  const empty = projectVehicleFinance(
    vehicle,
    2,
    "2026-08",
    emptyVehicleFinanceSources()
  );
  expect(empty.summary).toMatchObject({
    tripCount: 0,
    fuelCostRatio: null,
    fuelCostPerTrip: null,
    fuelCostPerKm: null,
    grossIncomePerTrip: null,
  });
});

it("真实费用、实际付款和余额由各自有效凭证归集，历史已付状态不凭空生成付款", () => {
  const sources = emptyVehicleFinanceSources();
  const statement = {
    id: 1,
    settlementNo: "TS-1",
    vehicleId: 7,
    projectId: 2,
    status: "paid" as const,
    settlementKind: "trip",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-02",
    grossFreightAmount: "100",
    netPayableAmount: "100",
  };
  sources.settlements = [
    statement,
    {
      ...statement,
      id: 2,
      settlementNo: "TS-2",
      status: "receivable",
      netPayableAmount: "-50",
    },
    { ...statement, id: 3, status: "draft", netPayableAmount: "999" },
    { ...statement, id: 4, status: "void", netPayableAmount: "999" },
  ];
  const payment = {
    settlementId: 1,
    projectId: 2,
    settlementType: "transport_vehicle",
    status: "active",
    direction: "expense",
    amount: "30",
    paymentDate: "2026-08-03",
  };
  sources.payments = [
    payment,
    { ...payment, settlementId: 2, direction: "income", amount: "20" },
    { ...payment, status: "void", amount: "999" },
    { ...payment, projectId: 99, amount: "999" },
    { ...payment, settlementType: "machine", amount: "999" },
    { ...payment, settlementId: 4, amount: "999" },
    { ...payment, settlementId: 99, amount: "999" },
    { ...payment, paymentDate: "2026-09-01", amount: "70" },
  ];
  sources.refuels = [
    {
      id: 1,
      vehicleId: 7,
      projectId: 2,
      assetType: "vehicle",
      status: "approved",
      refueledAt: "2026-08-03",
      amount: "12.34",
      liters: "2",
    },
    {
      id: 2,
      vehicleId: 7,
      projectId: 2,
      assetType: "vehicle",
      status: "submitted",
      refueledAt: "2026-08-03",
      amount: "5.67",
      liters: "1",
    },
  ];
  const projection = projectVehicleFinance(
    { id: 7, projectId: 2, ownership: "trip_settlement" },
    2,
    "2026-08",
    sources
  );
  expect(projection.summary).toMatchObject({
    fuelAmount: 12.34,
    coveredCostAmount: 12.34,
    pendingCostAmount: 5.67,
    actualPaidAmount: 30,
    actualReceivedAmount: 20,
    remainingPayableAmount: 70,
    remainingReceivableAmount: 30,
    confirmedOwnerPayableAmount: 50,
  });
  expect(projection.cumulative.actualPaidAmount).toBe(30);
  expect(projection.daily.find(row => row.date === "2026-08-02")).toMatchObject(
    {
      actualPaidAmount: 0,
      remainingPayableAmount: 70,
      remainingReceivableAmount: 30,
    }
  );
  expect(projection.daily.find(row => row.date === "2026-08-03")).toMatchObject(
    { actualPaidAmount: 30, actualReceivedAmount: 20, coveredCostAmount: 12.34 }
  );
  expect(projection.monthly[0].actualPaidAmount).toBe(
    projection.summary.actualPaidAmount
  );
  const noProof = projectVehicleFinance(
    { id: 7, projectId: 2, ownership: "trip_settlement" },
    2,
    "2026-08",
    { ...sources, payments: [] }
  );
  expect(noProof.summary).toMatchObject({
    actualPaidAmount: 0,
    actualReceivedAmount: 0,
    remainingPayableAmount: 100,
    remainingReceivableAmount: 50,
  });
});

it("期间边界按中国业务日期划分，不能把北京时间次月的UTC当日金额算入本月", () => {
  const sources = emptyVehicleFinanceSources();
  const trip = {
    id: 1,
    vehicleId: 7,
    projectId: 2,
    status: "verified",
    startAt: "2026-08-31T15:59:59Z",
    tripNo: "TR-AUG",
    calculatedAmount: "0.1",
    netSettlementAmount: "0.1",
  };
  sources.trips = [
    trip,
    {
      ...trip,
      id: 2,
      tripNo: "TR-SEP",
      startAt: "2026-08-31T16:00:00Z",
      calculatedAmount: "999",
    },
  ];
  const result = projectVehicleFinance(
    { id: 7, projectId: 2, ownership: "owned" },
    2,
    "2026-08",
    sources
  );
  expect(result.summary).toMatchObject({
    tripCount: 1,
    confirmedTransportAmount: 0.1,
  });
  expect(result.daily.map(row => row.date)).toEqual(["2026-08-31"]);
  expect(result.cumulative.confirmedTransportAmount).toBe(0.1);
});
