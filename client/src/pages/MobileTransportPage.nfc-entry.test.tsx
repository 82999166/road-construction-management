import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("移动端运输 NFC 入口收敛", () => {
  it("不再展示手机首次发卡，保留已签发卡的自动读卡开票入口", () => {
    const source = readFileSync(new URL("./MobileTransportPage.tsx", import.meta.url), "utf8");
    expect(source).not.toContain('import { MobileNfcCardIssuer }');
    expect(source).not.toContain("<MobileNfcCardIssuer");
    expect(source).toContain("MobileNfcTransportInvoice");
    expect(source).toContain("MobileTransportSiteManager");
    expect(source).toContain("transport.siteManagementAccess.useQuery");
    expect(source).toContain("transportSiteManagementAccess.data?.canManage");
    expect(source).toContain("setMobileNfcInvoiceOpen(true)");
    expect(source).toContain("拍照车牌发票");
  });
});
