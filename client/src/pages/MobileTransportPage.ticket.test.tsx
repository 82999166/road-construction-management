import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("移动端运输刷卡票据", () => {
  it("提供装土卸土票据入口、保存后刷卡指引与自动计费通知文案", () => {
    const source = readFileSync(new URL("./MobileTransportPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("刷卡票据");
    expect(source).toContain("运输刷卡票据");
    expect(source).toContain("新建装土票据");
    expect(source).toContain("开始装土刷卡");
    expect(source).toContain("开始卸土刷卡");
    expect(source).toContain("装土票据确认成功");
    expect(source).toContain("卸土票据确认成功，已自动核算运费并通知司机和主管");
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
    expect(source).toContain("打开后置相机直拍车牌");
    expect(source).toContain("navigator.mediaDevices.getUserMedia");
    expect(source).toContain("仅支持现场直拍，不提供本地相册选择");
    expect(source).toContain('openTripDialog(false, "plate_photo")');
    expect(source).toContain("vehicleSummaries");
    expect(source).toContain("按车辆日汇总");
    expect(source).toContain("NFC 票据");
    expect(source).toContain("直拍票据");
  });
});
