import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("移动运输页首屏依赖", () => {
  it("仅在用户主动打开刷卡发票时加载 NFC 模块，并提供弱网加载与失败提示", () => {
    const source = readFileSync(new URL("./MobileTransportPage.tsx", import.meta.url), "utf8");

    expect(source).toContain('lazy(() => import("@/components/MobileNfcTransportInvoice")');
    expect(source).toContain("mobileNfcInvoiceOpen ? <NfcInvoiceLoadBoundary");
    expect(source).toContain("<Suspense fallback={<NfcInvoiceLoadingDialog");
    expect(source).toContain("刷卡发票页面加载失败");
    expect(source).not.toContain('import { TransportRouteSafetySettings }');
    expect(source).not.toContain("<TransportRouteSafetySettings");
  });
});
