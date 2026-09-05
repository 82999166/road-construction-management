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

  it("仅在车辆卡安全深链含 nfc 参数时自动进入统一现场扫描，不强制打开发票确认界面", () => {
    const source = readFileSync(new URL("./MobileTransportPage.tsx", import.meta.url), "utf8");

    expect(source).toContain('new URLSearchParams(window.location.search).get("nfc")');
    expect(source).toContain("nfcLinkScanStartedRef.current = true");
    expect(source).toContain("submitNfcLinkScan()");
    expect(source).toContain("scanNfcLink.mutate");
    expect(source).not.toContain("if (nfcLinkToken) setMobileNfcInvoiceOpen(true)");
    expect(source).not.toContain("if (!nfcLinkToken) setMobileNfcInvoiceOpen(true)");
  });

  it("将两类发票操作置于项目选择后和统计台账前，并使用统一中文术语", () => {
    const source = readFileSync(new URL("./MobileTransportPage.tsx", import.meta.url), "utf8");
    const projectSelector = source.indexOf('id="transport-project-select"');
    const quickActions = source.indexOf('aria-label="运输发票主操作"');
    const metrics = source.indexOf('<MetricCard label="当日发票"');
    const ledger = source.indexOf("<MobileTransportLedger");

    expect(projectSelector).toBeGreaterThan(-1);
    expect(quickActions).toBeGreaterThan(projectSelector);
    expect(quickActions).toBeLessThan(metrics);
    expect(quickActions).toBeLessThan(ledger);
    expect(source).toContain('aria-label="新建 NFC 刷卡发票"');
    expect(source).toContain('aria-label="新建拍照车牌发票"');
    expect(source).toContain("处理待刷 NFC 票据");
    expect(source).not.toContain('onClick={() => window.print()}');
  });

  it("将装卸土点与路线设置收敛到顶部图标，并从底部移除重复配置卡片", () => {
    const source = readFileSync(new URL("./MobileTransportPage.tsx", import.meta.url), "utf8");
    const header = source.indexOf("<header");
    const main = source.indexOf("<main");
    const topSettings = source.indexOf('triggerVariant="icon"');

    expect(header).toBeGreaterThan(-1);
    expect(topSettings).toBeGreaterThan(header);
    expect(topSettings).toBeLessThan(main);
    expect(source.match(/<MobileTransportSiteManager/g)).toHaveLength(1);
    expect(source).toContain("isSuperAdmin || Boolean(transportSiteManagementAccess.data?.canManage)");
    expect(source).toContain("onConfirmPlatePhotoUnload={openPlatePhotoUnloadDialog}");
  });

  it("提供换电脑恢复、手机 NFC 与键盘式读卡器备用操作说明", () => {
    const source = readFileSync(new URL("./MobileTransportPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("yx.transport.fieldReaderDeviceId");
    expect(source).toContain("Android Chrome 支持 Web NFC");
    expect(source).toContain("USB 键盘式读卡器接手机 OTG");
    expect(source).toContain("读卡器输出 UID 后粘贴/回车");
    expect(source).toContain("原始 UID 仅在本机生成 SHA-256 指纹后提交");
    expect(source).toContain("现场读卡器编号");
  });
});
