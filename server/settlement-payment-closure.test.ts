import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("车辆、机械与人员实际付款闭环", () => {
  it("为车辆建立可追溯的收款资料、使用依据、补款抵扣和分笔付款数据底座", () => {
    const schema = read("../drizzle/schema.ts");
    expect(schema).toContain('"transport_vehicle_payee_accounts"');
    expect(schema).toContain('"transport_vehicle_usage_records"');
    expect(schema).toContain('"settlement_payment_records"');
    expect(schema).toContain('"transport_vehicle_carry_forward_offsets"');
    expect(schema).toContain('settlementKind: mysqlEnum("settlementKind", ["trip", "lease", "adjustment"])');
    expect(schema).toContain('"receivable", "offset"');
  });

  it("无运输车辆只能按外租合同使用依据或有依据调整生成草稿，扣款倒挂进入待收补款", () => {
    const source = read("./routers/operations.ts");
    expect(source).toContain("createNonTripVehicleSettlement");
    expect(source).toContain('input.settlementKind === "lease"');
    expect(source).toContain("车辆按");
    expect(source).toContain("实际使用依据");
    expect(source).toContain("getOutstandingVehicleRecoveries");
    expect(source).toContain("transportVehicleCarryForwardOffsets");
    expect(source).toContain('nextStatus === "receivable"');
  });

  it("实际资金必须逐笔上传当前结算单凭证，并由服务端校验余额、封账和凭证归属", () => {
    const source = read("./routers/settlementPayments.ts");
    expect(source).toContain("settlementPaymentRecords");
    expect(source).toContain("请先上传本次付款凭证");
    expect(source).toContain("本次金额不能超过待结余额");
    expect(source).toContain("付款日期已封存");
    expect(source).toContain("settlement_payment_proof");
    expect(source).toContain('status: input.final ? "paid" : "partial"');
    expect(source).toContain('settlement.direction === "income"');
  });

  it("单车详情提供结算和收款资料直达入口，工资台账和手机端不绕过PC凭证流程", () => {
    const admin = read("../client/src/pages/AdminPage.tsx");
    const vehicleDialog = read("../client/src/components/VehicleSettlementProfileDialog.tsx");
    const payroll = read("../client/src/components/PayrollStatementLedger.tsx");
    const mobileLabor = read("../client/src/pages/MobileLaborPage.tsx");
    expect(admin).toContain("结算 / 收款资料");
    expect(vehicleDialog).toContain("外租合同结算");
    expect(vehicleDialog).toContain("有依据调整结算");
    expect(vehicleDialog).toContain("登记实际使用依据");
    expect(payroll).toContain("部分发放");
    expect(payroll).toContain("登记付款");
    expect(mobileLabor).toContain("pay: false");
    expect(mobileLabor).toContain("请在 PC 财务台账上传凭证后分笔登记付款");
  });

  it("员工保险只能归档合法保单附件，并向授权后台提供受控预览而非存储路径", () => {
    const adminRoute = read("./routers/admin.ts");
    const adminPage = read("../client/src/pages/AdminPage.tsx");
    const schema = read("../drizzle/schema.ts");
    expect(schema).toContain("evidenceId: bigint(\"evidenceId\"");
    expect(schema).toContain("premiumAmount");
    expect(schema).toContain("coverageAmount");
    expect(adminRoute).toContain("uploadInsurancePolicy");
    expect(adminRoute).toContain("assertCertificateFileSignature");
    expect(adminRoute).toContain("employee_insurance_policy");
    expect(adminRoute).toContain("保单附件不存在、已失效或不属于当前员工档案");
    expect(adminPage).toContain("保单附件（JPG / PNG / PDF，可选）");
    expect(adminPage).toContain("查看保单附件");
  });
});
