import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PC机械付款结算台账", () => {
  it("提供已审核外租机械月结的收款方式、会计审核、付款登记和不可作废提示", () => {
    const source = readFileSync(new URL("./MachinePaymentSettlementManager.tsx", import.meta.url), "utf8");

    expect(source).toContain("trpc.machinery.listPaymentSettlements.useQuery");
    expect(source).toContain("trpc.machinery.createPaymentSettlement.useMutation");
    expect(source).toContain("trpc.machinery.transitionPaymentSettlement.useMutation");
    expect(source).toContain("外租机械月结与付款台账");
    expect(source).toContain("银行卡转账");
    expect(source).toContain("会计审核");
    expect(source).toContain("确认已付款");
    expect(source).toContain("付款完成后不可作废");
    expect(source).toContain('const [machineId, setMachineId] = useState("all")');
    expect(source).toContain("printableSettlements");
    expect(source).toContain("CurrentFilterPrintActions");
    expect(source).toContain("openA4LandscapePrintDocument");
    expect(source).toContain("合计：结算单");
  });
});
