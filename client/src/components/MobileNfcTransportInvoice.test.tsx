import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("手机刷 NFC 卡发票", () => {
  it("页面打开即监听车辆卡，读取后选择路线并保存开票", () => {
    const source = readFileSync(new URL("./MobileNfcTransportInvoice.tsx", import.meta.url), "utf8");
    expect(source).toContain("reader.scan({ signal: controller.signal })");
    expect(source).toContain("请将已启用的车辆卡贴近手机");
    expect(source).toContain("previewMobileNfcInvoice");
    expect(source).toContain("confirmMobileNfcInvoice");
    expect(source).toContain("保存并开具发票");
  });
});
