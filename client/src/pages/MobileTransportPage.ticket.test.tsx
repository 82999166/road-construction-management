import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("移动端运输刷卡票据", () => {
  it("提供装土卸土票据入口、保存后刷卡指引与合规现场回执文案", () => {
    const source = readFileSync(new URL("./MobileTransportPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("刷卡票据");
    expect(source).toContain("运输刷卡票据");
    expect(source).toContain("新建装土票据");
    expect(source).toContain("开始装土刷卡");
    expect(source).toContain("开始卸土刷卡");
    expect(source).toContain("装土刷卡已确认，请向司机展示现场回执");
    expect(source).toContain("卸土刷卡已确认，请向司机展示现场回执");
    expect(source).toContain("服务号不会对运输持续状态自动外发");
    expect(source).toContain("recordLoadEvent.mutate");
    expect(source).toContain("recordUnloadEvent.mutate");
    expect(source).toContain("openTripDialog(true)");
    expect(source).toContain("装土点、卸土点按顺序完成两次 NFC 刷卡");
    expect(source).toContain("选择装土点");
    expect(source).toContain("选择卸土点");
    expect(source).toContain("本次刷卡地点：");
    expect(source).toContain("现场管理员：");
    expect(source).toContain("siteId: selectedTicketSiteId ?? null");
    expect(source).toContain("现场地点");
  });

  it("提供醒目的装卸地点设置、NFC 与车牌直拍双模式发票、按车日汇总与相机直拍防回归约束", () => {
    const source = readFileSync(new URL("./MobileTransportPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("装土点设置");
    expect(source).toContain("卸土点设置");
    expect(source).toContain("刷 NFC 卡发票");
    expect(source).toContain("拍照车牌发票");
    expect(source).toContain("拍清车牌后上传");
    expect(source).toContain("navigator.mediaDevices.getUserMedia");
    expect(source).toContain("不提供相册选择");
    expect(source).toContain('openTripDialog(false, "plate_photo")');
    expect(source).toContain("vehicleSummaries");
    expect(source).toContain("按车辆日汇总");
    expect(source).toContain("NFC 票据");
    expect(source).toContain("直拍票据");
  });

  it("签名 NFC 深链必须直达自动刷卡开票页，并保留车辆核验和路线确认", () => {
    const source = readFileSync(new URL("./MobileTransportPage.tsx", import.meta.url), "utf8");

    expect(source).toContain('get("nfc")');
    expect(source).toContain("MobileNfcTransportInvoice");
    expect(source).toContain("setMobileNfcInvoiceOpen(true)");
    expect(source).toContain("刷 NFC 卡发票");
    expect(source).toContain("自动读取车辆");
  });

  it("司机在运输页可直接进入站内消息，且台账位于现场操作卡之前", () => {
    const source = readFileSync(new URL("./MobileTransportPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("trpc.messages.unreadCount.useQuery");
    expect(source).toContain('aria-label="进入消息中心"');
    expect(source).toContain('navigate("/mobile/messages")');
    expect(source).toContain('aria-label="移动运输导航"');
    expect(source.indexOf("<MobileTransportLedger")).toBeLessThan(source.indexOf("运输日报"));
  });

  it("提供受项目与车辆范围约束的运费明细 PDF 打印入口", () => {
    const source = readFileSync(new URL("./MobileTransportPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("TransportFreightPrintDialog");
    expect(source).toContain("运费明细 PDF");
    expect(source).toContain("setFreightPrintOpen(true)");
    expect(source).toContain("projectName={selectedProject?.name");
  });
});
