import { describe, expect, it } from "vitest";
import { buildMonthlyCostStatistics } from "./monthlyCostStatistics";

function emptySource() {
  return {
    payrolls: [],
    dailyWages: [],
    settlementPayments: [],
    machineSettlements: [],
    transportSettlements: [],
    livingFinancialRecords: [],
  };
}

function item(result: ReturnType<typeof buildMonthlyCostStatistics>, code: "TOTAL" | "PAYROLL" | "MACHINE_RENT" | "TRANSPORT_FREIGHT" | "LIVING_EXPENSE") {
  const found = result.items.find(row => row.code === code);
  if (!found) throw new Error(`missing ${code}`);
  return found;
}

describe("月度费用统计只读聚合", () => {
  it("仅将工资、日结、外租机械和按趟车辆的已审核/部分付款/已付业务计入应付，并排除不合格状态", () => {
    const result = buildMonthlyCostStatistics({ projectId: 7, period: "2026-10" }, {
      ...emptySource(),
      payrolls: [
        { projectId: 7, period: "2026-10", actualAmount: "100", status: "approved" },
        { projectId: 7, period: "2026-10", actualAmount: "200", status: "draft" },
        { projectId: 7, period: "2026-10", actualAmount: "300", status: "void" },
        { projectId: 8, period: "2026-10", actualAmount: "400", status: "paid" },
      ],
      dailyWages: [
        { projectId: 7, settlementDate: new Date("2026-10-31T23:59:59.999Z"), actualAmount: "50", status: "partial" },
        { projectId: 7, settlementDate: new Date("2026-10-15T00:00:00.000Z"), actualAmount: "60", status: "reviewing" },
      ],
      machineSettlements: [
        { projectId: 7, period: "2026-10", ownership: "leased", netPayableAmount: "80", status: "paid" },
        { projectId: 7, period: "2026-10", ownership: "owned", netPayableAmount: "90", status: "approved" },
        { projectId: 7, period: "2026-10", ownership: "leased", netPayableAmount: "70", status: "submitted" },
      ],
      transportSettlements: [
        { projectId: 7, settlementKind: "trip", periodEnd: new Date("2026-10-20T00:00:00.000Z"), netPayableAmount: "30", status: "approved" },
        { projectId: 7, settlementKind: "lease", periodEnd: new Date("2026-10-20T00:00:00.000Z"), netPayableAmount: "40", status: "paid" },
        { projectId: 7, settlementKind: "trip", periodEnd: new Date("2026-10-20T00:00:00.000Z"), netPayableAmount: "50", status: "draft" },
      ],
    });

    expect(item(result, "PAYROLL")).toMatchObject({ accrualAmount: 150, accrualCount: 2 });
    expect(item(result, "MACHINE_RENT")).toMatchObject({ accrualAmount: 80, accrualCount: 1 });
    expect(item(result, "TRANSPORT_FREIGHT")).toMatchObject({ accrualAmount: 30, accrualCount: 1 });
  });

  it("实际付款只取 active expense 的结算付款明细，不把 financialRecords 的 settlement_payment 镜像再次相加", () => {
    const result = buildMonthlyCostStatistics({ projectId: 7, period: "2026-10" }, {
      ...emptySource(),
      settlementPayments: [
        { projectId: 7, settlementType: "payroll", direction: "expense", amount: "100", paymentDate: new Date("2026-10-10T00:00:00.000Z"), status: "active" },
        { projectId: 7, settlementType: "daily_wage", direction: "expense", amount: "20", paymentDate: new Date("2026-10-11T00:00:00.000Z"), status: "reversed" },
        { projectId: 7, settlementType: "machine", direction: "expense", amount: "50", paymentDate: new Date("2026-10-12T00:00:00.000Z"), status: "active" },
        { projectId: 7, settlementType: "transport_vehicle", direction: "income", amount: "30", paymentDate: new Date("2026-10-13T00:00:00.000Z"), status: "active" },
      ],
      livingFinancialRecords: [
        { projectId: 7, direction: "expense", category: "餐费", amount: "100", occurredAt: new Date("2026-10-10T00:00:00.000Z"), settlementStatus: "paid", sourceType: "settlement_payment" },
      ],
    });

    expect(item(result, "PAYROLL")).toMatchObject({ cashAmount: 100, cashCount: 1 });
    expect(item(result, "MACHINE_RENT")).toMatchObject({ cashAmount: 50, cashCount: 1 });
    expect(item(result, "TRANSPORT_FREIGHT")).toMatchObject({ cashAmount: 0, cashCount: 0 });
    expect(item(result, "LIVING_EXPENSE")).toMatchObject({ accrualAmount: 0, cashAmount: 0, accrualCount: 0, cashCount: 0 });
    expect(item(result, "TOTAL")).toMatchObject({ cashAmount: 150, cashCount: 2 });
  });

  it("车辆按趟净应付为负或零时不计入运费应付", () => {
    const result = buildMonthlyCostStatistics({ projectId: 7, period: "2026-10" }, {
      ...emptySource(),
      transportSettlements: [
        { projectId: 7, settlementKind: "trip", periodEnd: new Date("2026-10-01T00:00:00.000Z"), netPayableAmount: "-2", status: "approved" },
        { projectId: 7, settlementKind: "trip", periodEnd: new Date("2026-10-02T00:00:00.000Z"), netPayableAmount: "0", status: "paid" },
        { projectId: 7, settlementKind: "trip", periodEnd: new Date("2026-10-03T00:00:00.000Z"), netPayableAmount: "12.5", status: "partial" },
      ],
    });

    expect(item(result, "TRANSPORT_FREIGHT")).toMatchObject({ accrualAmount: 12.5, accrualCount: 1 });
  });

  it("空值金额稳定返回零并提供各类别和合计的空数据提示", () => {
    const result = buildMonthlyCostStatistics({ projectId: 7, period: "2026-10" }, {
      ...emptySource(),
      payrolls: [{ projectId: 7, period: "2026-10", actualAmount: null, status: "approved" }],
      dailyWages: [{ projectId: 7, settlementDate: new Date("2026-10-03T00:00:00.000Z"), actualAmount: undefined, status: "paid" }],
    });

    expect(item(result, "PAYROLL")).toMatchObject({ accrualAmount: 0, cashAmount: 0, accrualCount: 2, cashCount: 0 });
    expect(item(result, "MACHINE_RENT")).toMatchObject({ accrualAmount: 0, cashAmount: 0, accrualCount: 0, cashCount: 0, emptyHint: expect.any(String) });
    expect(item(result, "TOTAL")).toMatchObject({ accrualAmount: 0, cashAmount: 0, accrualCount: 2, cashCount: 0, emptyHint: null });
  });

  it("期间按 UTC 左闭右开边界分别归属业务日期和付款日期", () => {
    const result = buildMonthlyCostStatistics({ projectId: 7, period: "2026-10" }, {
      ...emptySource(),
      dailyWages: [
        { projectId: 7, settlementDate: new Date("2026-09-30T23:59:59.999Z"), actualAmount: "1", status: "approved" },
        { projectId: 7, settlementDate: new Date("2026-10-01T00:00:00.000Z"), actualAmount: "2", status: "approved" },
        { projectId: 7, settlementDate: new Date("2026-10-31T23:59:59.999Z"), actualAmount: "3", status: "approved" },
        { projectId: 7, settlementDate: new Date("2026-11-01T00:00:00.000Z"), actualAmount: "4", status: "approved" },
      ],
      settlementPayments: [
        { projectId: 7, settlementType: "payroll", direction: "expense", amount: "5", paymentDate: new Date("2026-09-30T23:59:59.999Z"), status: "active" },
        { projectId: 7, settlementType: "payroll", direction: "expense", amount: "6", paymentDate: new Date("2026-10-01T00:00:00.000Z"), status: "active" },
        { projectId: 7, settlementType: "payroll", direction: "expense", amount: "7", paymentDate: new Date("2026-10-31T23:59:59.999Z"), status: "active" },
        { projectId: 7, settlementType: "payroll", direction: "expense", amount: "8", paymentDate: new Date("2026-11-01T00:00:00.000Z"), status: "active" },
      ],
      transportSettlements: [
        { projectId: 7, settlementKind: "trip", periodEnd: new Date("2026-10-01T00:00:00.000Z"), netPayableAmount: "9", status: "approved" },
        { projectId: 7, settlementKind: "trip", periodEnd: new Date("2026-11-01T00:00:00.000Z"), netPayableAmount: "10", status: "approved" },
      ],
    });

    expect(item(result, "PAYROLL")).toMatchObject({ accrualAmount: 5, cashAmount: 13, accrualCount: 2, cashCount: 2 });
    expect(item(result, "TRANSPORT_FREIGHT")).toMatchObject({ accrualAmount: 9, accrualCount: 1 });
  });

  it("生活开支仅接受受控人工类别，partial 仅是应付而非实际现金", () => {
    const result = buildMonthlyCostStatistics({ projectId: 7, period: "2026-10" }, {
      ...emptySource(),
      livingFinancialRecords: [
        { projectId: 7, direction: "expense", category: "餐费", amount: "30", occurredAt: new Date("2026-10-04T00:00:00.000Z"), settlementStatus: "partial", sourceType: null },
        { projectId: 7, direction: "expense", category: "住宿费", amount: "40", occurredAt: new Date("2026-10-05T00:00:00.000Z"), settlementStatus: "paid", sourceType: "manual" },
        { projectId: 7, direction: "expense", category: "项目杂支", amount: "50", occurredAt: new Date("2026-10-06T00:00:00.000Z"), settlementStatus: "paid", sourceType: null },
        { projectId: 7, direction: "expense", category: "水电费", amount: "60", occurredAt: new Date("2026-10-07T00:00:00.000Z"), settlementStatus: "void", sourceType: null },
        { projectId: 7, direction: "income", category: "餐费", amount: "70", occurredAt: new Date("2026-10-08T00:00:00.000Z"), settlementStatus: "paid", sourceType: null },
      ],
    });

    expect(item(result, "LIVING_EXPENSE")).toMatchObject({ accrualAmount: 70, cashAmount: 40, accrualCount: 2, cashCount: 1 });
  });

  it("未指定期间时明确标识为跨期累计范围", () => {
    const result = buildMonthlyCostStatistics({ projectId: 7 }, emptySource());
    expect(result.scope).toMatchObject({ projectId: 7, period: null, periodMode: "all_periods" });
    expect(result.scope.hint).toContain("跨期累计");
  });
});
