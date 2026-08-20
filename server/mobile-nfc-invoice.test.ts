import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("移动 NFC 自动开票服务端", () => {
  it("先预览签名车辆卡和路线，再受控创建或闭合运单", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    expect(source).toContain("resolveMobileNfcInvoice");
    expect(source).toContain("confirmMobileNfcInvoice");
    expect(source).toContain("previewMobileNfcInvoice");
    expect(source).toContain("confirmMobileNfcInvoice:");
    expect(source).toContain("mobile_nfc_invoice_created");
    expect(source).toContain("transport_mobile_nfc_invoice_departed");
  });

  it("运单号以日期、时间、秒为主体，同秒才追加序号", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    expect(source).toContain("secondKey");
    expect(source).toContain("String(latestTripSecondSequence).padStart(2, \"0\")");
  });
});
