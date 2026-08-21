import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("薪税、合同税费与跨地区预缴辅助控制", () => {
  it("从真实工资与合同来源建立辅助台账，保留复核和外部回执状态机而不伪造申报", () => {
    const component = readFileSync(new URL("./TaxComplianceControlPanel.tsx", import.meta.url), "utf8");
    const router = readFileSync(new URL("../../../server/routers/finance.ts", import.meta.url), "utf8");
    const schema = readFileSync(new URL("../../../drizzle/schema.ts", import.meta.url), "utf8");

    expect(component).toContain("工资薪金累计预扣辅助测算");
    expect(component).toContain("合同印花税资料");
    expect(component).toContain("跨地区建筑服务预缴资料");
    expect(component).toContain("本系统不会以历史公式自动计算预缴税额");
    expect(router).toContain("RESIDENT_WAGE_WITHHOLDING_BRACKETS");
    expect(router).toContain("国家税务总局公告2018年第56号");
    expect(router).toContain("savePayrollTaxWithholdingEntry:");
    expect(router).toContain("saveContractTaxRegistration:");
    expect(router).toContain("saveCrossRegionConstructionTaxLedger:");
    expect(router).toContain("登记外部扣缴/申报回执时至少填写外部引用或关联受控证据");
    expect(schema).toContain("export const payrollTaxWithholdingEntries");
    expect(schema).toContain("export const contractTaxRegistrations");
    expect(schema).toContain("export const crossRegionConstructionTaxLedgers");
  });
});
