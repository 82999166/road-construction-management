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
    expect(source).toContain("该车还未卸土，不能开具新发票");
    expect(source).toContain("speechSynthesis");
    expect(source).toContain("text-3xl font-black");
    expect(source).toContain("已重新读取车辆卡，正在刷新车辆与在途状态");
    expect(source).toContain("utils.transport.previewMobileNfcInvoice.invalidate");
    expect(source).not.toContain("if (!open || initialToken) return");
  });
});
