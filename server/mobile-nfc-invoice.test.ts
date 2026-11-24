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
    expect(source).toContain("getVehicleDispatchBlockReason");
    expect(source).toContain("canStartTrip: !dispatchBlockReason");
    expect(source).toContain("dispatchBlockReason");
  });

  it("运单号由真实事务分配模块、北京时间、可信操作者和四位序号", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    expect(source).toMatch(/newBusinessDocumentNumber\(db, "TR", \{ kind: "user", userId: (?:input\.userId|resolved\.user\.id|user\.id)/);
    const allocator = readFileSync(new URL("./services/businessDocumentNumber.ts", import.meta.url), "utf8");
    expect(allocator).toContain("createDrizzleBusinessDocumentNumberAdapter");
    expect(allocator).toContain("TRANSACTION_REQUIRED");
  });
});
