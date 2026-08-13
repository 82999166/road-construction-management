import { describe, expect, it } from "vitest";
import { INDUSTRY_ROLE_TEMPLATES, getIndustryRoleTemplate } from "../shared/industryRoleTemplates";

describe("道路施工行业岗位模板", () => {
  it("覆盖项目、现场、供应链、计量和财务审计的核心岗位", () => {
    const roleCodes = new Set(INDUSTRY_ROLE_TEMPLATES.map(template => template.code));

    ["PROJECT_MANAGER", "CONSTRUCTION_MANAGER", "PURCHASER", "MEASUREMENT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT", "CASHIER", "AUDIT_VIEWER"].forEach(code => {
      expect(roleCodes.has(code)).toBe(true);
    });
  });

  it("会计审查、出纳支付、财务负责人冲销和审计只读保持职责分离", () => {
    const accountant = getIndustryRoleTemplate("ACCOUNTANT");
    const cashier = getIndustryRoleTemplate("CASHIER");
    const financeManager = getIndustryRoleTemplate("FINANCE_MANAGER");
    const auditor = getIndustryRoleTemplate("AUDIT_VIEWER");

    expect(accountant?.allowedActions).toContain("会计审核");
    expect(accountant?.restrictedActions).toContain("不执行付款");
    expect(cashier?.allowedActions).toContain("采购结算");
    expect(cashier?.restrictedActions).toContain("不审核自己执行的支付");
    expect(financeManager?.allowedActions).toContain("凭证冲销");
    expect(auditor?.allowedActions).toContain("只读查看");
    expect(auditor?.restrictedActions).toContain("不支付");
  });
});
