import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PC机械付款结算台账", () => {
  it("提供已审核外租机械月结的收款方式、会计审核、凭证付款登记和不可作废提示", () => {
    const source = readFileSync(
      new URL("./MachinePaymentSettlementManager.tsx", import.meta.url),
      "utf8"
    );

    expect(source).toContain("trpc.machinery.listPaymentSettlements.useQuery");
    expect(source).toContain(
      "trpc.machinery.createPaymentSettlement.useMutation"
    );
    expect(source).toContain(
      "trpc.machinery.transitionPaymentSettlement.useMutation"
    );
    expect(source).toContain("外租机械月结与付款台账");
    expect(source).toContain("银行卡转账");
    expect(source).toContain("会计审核");
    expect(source).toContain("SettlementPaymentDialog");
    expect(source).toContain("上传凭证并分笔登记实际付款");
    expect(source).toContain("登记付款");
    expect(source).toContain("付款完成后不可作废");
    expect(source).toContain(
      'const [localMachineId, setMachineId] = useState("all")'
    );
    expect(source).toContain("printableSettlements");
    expect(source).toContain("CurrentFilterPrintActions");
    expect(source).toContain("openA4LandscapePrintDocument");
    expect(source).toContain("合计：结算单");
  });

  it("在列表、导出和打印中以中文展示计费、支付与状态信息，并统一付款日期格式", () => {
    const source = readFileSync(
      new URL("./MachinePaymentSettlementManager.tsx", import.meta.url),
      "utf8"
    );

    expect(source).toContain('monthly: "按月计费"');
    expect(source).toMatch(
      /leaseBillingTypeDisplay\(\s*item.statement\?\.leaseBillingType\s*\)/
    );
    expect(source).toContain("paymentMethodLabel[item.paymentMethod]");
    expect(source).toContain("formatChinaDate(item.paymentDate)");
    expect(source).not.toContain("statusLabel[item.status] ?? item.status");
    expect(source).not.toContain("String(item.paymentDate).slice(0, 10)");
  });
});
