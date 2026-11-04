import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("车辆、机械与人员实际付款闭环", () => {
  it("为车辆建立可追溯的收款资料、使用依据、补款抵扣和分笔付款数据底座", () => {
    const schema = read("../drizzle/schema.ts");
    expect(schema.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      '"transport_vehicle_payee_accounts"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(schema.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      '"transport_vehicle_usage_records"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(schema.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      '"settlement_payment_records"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(schema.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      '"transport_vehicle_carry_forward_offsets"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(schema.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'settlementKind: mysqlEnum("settlementKind", ["trip", "lease", "adjustment"])'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(schema.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      '"receivable", "offset"'.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
  });

  it("无运输车辆只能按外租合同使用依据或有依据调整生成草稿，扣款倒挂进入待收补款", () => {
    const source = read("./routers/operations.ts");
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "createNonTripVehicleSettlement"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'input.settlementKind === "lease"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "车辆按".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "实际使用依据".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "getOutstandingVehicleRecoveries"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "transportVehicleCarryForwardOffsets"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'nextStatus === "receivable"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });

  it("实际资金必须逐笔上传当前结算单凭证，并由服务端校验余额、封账和凭证归属", () => {
    const source = read("./routers/settlementPayments.ts");
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "settlementPaymentRecords".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "请先上传本次付款凭证".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "本次金额不能超过待结余额".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "付款日期已封存".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "settlement_payment_proof".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'status: input.final ? "paid" : "partial"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'settlement.direction === "income"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });

  it("单车详情提供结算和收款资料直达入口，工资台账和手机端不绕过PC凭证流程", () => {
    const admin = read("../client/src/pages/AdminPage.tsx");
    const vehicleDetail = read(
      "../client/src/components/VehicleManagementDetail.tsx"
    ).replace(/\s+/g, "");
    const vehicleDialog = read(
      "../client/src/components/VehicleSettlementProfileDialog.tsx"
    );
    const payroll = read("../client/src/components/PayrollStatementLedger.tsx");
    const mobileLabor = read("../client/src/pages/MobileLaborPage.tsx");
    expect(admin.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "<VehicleManagementWorkspace"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      vehicleDetail.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      'onClick={()=>setTab("settlements")}>费用结算/付款凭证'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      vehicleDetail.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "onClick={()=>setPayeeOpen(true)}>收款资料/使用依据"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      vehicleDetail.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      '<TransportVehicleSettlementManagerprojectId={d.vehicle.projectId}vehicles={[d.vehicle]}scopeVehicleId={vehicleId}active={tab==="settlements"}onDirtyChange={setPaymentDirty}'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      vehicleDetail.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "<VehicleSettlementProfileDialogopen={payeeOpen}"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      vehicleDetail.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "projectId={d.vehicle.projectId}vehicles={[d.vehicle]}initialVehicleId={vehicleId}onRefresh={refresh}"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      vehicleDialog.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain("外租合同结算".replace(/\s+/g, "").replace(/,([})\]])/g, "$1"));
    expect(
      vehicleDialog.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "有依据调整结算".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(
      vehicleDialog.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "登记实际使用依据".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(payroll.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "部分发放".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(payroll.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "登记付款".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(
      mobileLabor.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain("pay: false".replace(/\s+/g, "").replace(/,([})\]])/g, "$1"));
    expect(
      mobileLabor.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "请在 PC 财务台账上传凭证后分笔登记付款"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });

  it("员工保险只能归档合法保单附件，并向授权后台提供受控预览而非存储路径", () => {
    const adminRoute = read("./routers/admin.ts");
    const adminPage = read("../client/src/pages/AdminPage.tsx");
    const schema = read("../drizzle/schema.ts");
    expect(schema.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'evidenceId: bigint("evidenceId"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(schema.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "premiumAmount".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(schema.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "coverageAmount".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(
      adminRoute.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "uploadInsurancePolicy".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(
      adminRoute.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "assertCertificateFileSignature"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      adminRoute.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "employee_insurance_policy"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      adminRoute.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "保单附件不存在、已失效或不属于当前员工档案"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(adminPage.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "保单附件（JPG / PNG / PDF，可选）"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    const personnelPage = read(
      "../client/src/components/UnifiedPersonnelDirectory.tsx"
    );
    expect(
      personnelPage.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain("查看保单附件".replace(/\s+/g, "").replace(/,([})\]])/g, "$1"));
    expect(
      personnelPage.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      "trpc.personnel.previewInsuranceDocument.useQuery"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });
});
