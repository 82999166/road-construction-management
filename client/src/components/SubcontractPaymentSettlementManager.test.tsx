import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const component = readFileSync(resolve(process.cwd(), "client/src/components/SubcontractPaymentSettlementManager.tsx"), "utf8");

describe("SubcontractPaymentSettlementManager", () => {
  it("keeps confirmed packages on the payable settlement workflow instead of direct package settlement", () => {
    expect(component).toContain("已确认分包包件");
    expect(component).toContain("建立应付草稿");
    expect(component).toContain("提交审核");
    expect(component).toContain("会计审核");
    expect(component).toContain("登记付款");
    expect(component).toContain("付款完成后不可作废");
  });

  it("captures payment method, invoice evidence and a traceable payment reference", () => {
    expect(component).toContain("paymentMethod");
    expect(component).toContain("invoiceEvidenceId");
    expect(component).toContain("paymentReference");
    expect(component).toContain("同步项目财务支出");
  });
});
