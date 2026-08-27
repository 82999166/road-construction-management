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

  it("按当前施工队和结算状态筛选导出，并生成独立 A4 汇总打印", () => {
    expect(component).toContain('const [keyword, setKeyword] = useState("")');
    expect(component).toContain('const [settlementStatus, setSettlementStatus] = useState("all")');
    expect(component).toContain("filteredSettlements");
    expect(component).toContain("CurrentFilterPrintActions");
    expect(component).toContain("downloadCurrentFilteredCsv");
    expect(component).toContain("openA4LandscapePrintDocument");
    expect(component).toContain("合计：结算单");
  });

  it("默认以设备日期登记付款，并在表格、导出和打印中使用中文状态与中国日期", () => {
    expect(component).toContain('const today = () => toDeviceDateInput();');
    expect(component).toContain("invoiceStatusDisplay(item.invoiceStatus)");
    expect(component).toContain("paymentMethodDisplay(item.paymentMethod)");
    expect(component).toContain("settlementStatusDisplay(item.status)");
    expect(component).toContain("formatChinaDate(item.paymentDate)");
    expect(component).toContain("formatChinaDateTime(new Date())");
    expect(component).not.toContain("new Date().toISOString().slice(0, 10)");
  });
});
