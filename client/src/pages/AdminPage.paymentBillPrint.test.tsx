import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("后台支付账号账单批量打印入口", () => {
  const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

  it("在财务管理中提供独立入口和受控对话框状态", () => {
    expect(source).toContain('PaymentAccountBillPrintDialog');
    expect(source).toContain('const [paymentBillPrintOpen, setPaymentBillPrintOpen] = useState(false)');
    expect(source).toContain('支付账号账单打印');
    expect(source).toContain('onClick={() => setPaymentBillPrintOpen(true)}');
  });

  it("将账单打印保持为独立组件，而不是混入资金总账查询路径", () => {
    expect(source).toContain('<PaymentAccountBillPrintDialog open={paymentBillPrintOpen}');
    expect(source).not.toContain('trpc.admin.paymentBill');
  });
});
