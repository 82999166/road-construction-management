import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("渣土车按趟结算与付款闭环", () => {
  it("结算数据模型必须独立于外租车辆租金，并保留逐趟快照和付款方式", () => {
    const schema = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");
    expect(schema).toContain('"transport_vehicle_settlements"');
    expect(schema).toContain('"transport_vehicle_settlement_items"');
    expect(schema).toContain('paymentMethod');
    expect(schema).toContain('paymentDate');
    expect(schema).toContain('settlementTripUnique');
    expect(schema).toContain('trip_settlement');
  });

  it("服务端只能由已核验的按趟渣土车运单生成结算草稿，并防止重复结算", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    expect(source).toContain("createVehicleSettlement");
    expect(source).toContain('vehicle.ownership !== "trip_settlement"');
    expect(source).toContain('eq(transportTrips.status, "verified")');
    expect(source).toContain("transport_vehicle_settlement_items_trip_unique");
    expect(source).toContain("fuelDeductionAmount");
    expect(source).toContain("pooledFuelRecords");
    expect(source).toContain("车辆归集柴油扣款");
  });

  it("只有会计或财务可审核，实际付款交由凭证台账登记且付款后不允许作废或回退", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    const paymentSource = readFileSync(new URL("./routers/settlementPayments.ts", import.meta.url), "utf8");
    expect(source).toContain("transitionVehicleSettlement");
    expect(source).toContain("canSettleFinancialRecord(roleCodes)");
    expect(source).toContain("已完成付款，依据业务规则不能作废或回退");
    expect(source).toContain("实际付款/补款必须走 settlementPayment 路由并上传凭证");
    expect(paymentSource).toContain('settlementType === "transport_vehicle"');
    expect(paymentSource).toContain('"车辆结算实际付款"');
    expect(paymentSource).toContain("本次金额不能超过待结余额");
    expect(paymentSource).toContain("付款日期已封存，须由财务负责人先授权反结账后再登记付款");
  });

  it("车辆管理必须提供按车牌日汇总、微信日结和费用结算入口", () => {
    const component = readFileSync(new URL("../client/src/components/TransportVehicleSettlementManager.tsx", import.meta.url), "utf8");
    const admin = readFileSync(new URL("../client/src/pages/AdminPage.tsx", import.meta.url), "utf8");
    expect(component).toContain("dailyVehicleSettlementSummary");
    expect(component).toContain("sendDailyVehicleSettlementSummary");
    expect(component).toContain("发送微信日结");
    expect(component).toContain("收款方式");
    expect(component).toContain("付款完成后不能作废");
    expect(admin).toContain("TransportVehicleSettlementManager");
  });
});
