import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("移动端拍照车牌发票", () => {
  const source = readFileSync(new URL("./MobileTransportPage.tsx", import.meta.url), "utf8");

  it("支持车牌尾号搜索选车、自动单号、路线选择和后置相机直拍", () => {
    expect(source).toContain("plateVehicleSearch");
    expect(source).toContain("输入车牌后两位");
    expect(source).toContain("系统将在发票成功后自动生成");
    expect(source).toContain("拍清车牌后上传");
    expect(source).toContain('facingMode: { ideal: "environment" }');
  });

  it("拍照发票使用独立车牌选择状态，不会被台账车辆筛选状态覆盖", () => {
    expect(source).toContain("const [tripVehicleId, setTripVehicleId]");
    expect(source).toContain("setTripVehicleId(vehicle.id); setPlateVehicleSearch(vehicle.plateNo)");
    expect(source).toContain("vehicleId: tripVehicleId");
    expect(source).toContain("!tripVehicleId");
    expect(source).not.toContain("onClick={() => setVehicleId(vehicle.id)}");
  });

  it("选择车牌后在搜索栏保留完整车牌并显示已选择状态", () => {
    expect(source).toContain('aria-label="拍照发票车牌搜索"');
    expect(source).toContain("maxLength={32}");
    expect(source).toContain("已选择车牌：");
  });

  it("拍照发票成功和直拍卸土成功后使用中文语音播报", () => {
    expect(source).toContain("function speakTransportReceipt");
    expect(source).toContain('utterance.lang = "zh-CN"');
    expect(source).toContain("拍照发票成功");
    expect(source).toContain("卸土成功");
    expect(source).toContain("speakTransportReceipt");
  });

  it("禁止相册选择并在直拍开票后显示成功反馈", () => {
    expect(source).toContain("不提供相册选择");
    expect(source).toContain('formatVehicleStageReceipt(data.vehiclePlateNo, data.dailyVehicleTripOrdinal, "load")');
    expect(source).toContain("发票成功");
    expect(source).toContain(': "发票"}</Button>');
  });

  it("将直拍票据作为装土开票进入在途，并提供卸土现场确认入口", () => {
    expect(source).toContain("confirmPlatePhotoUnload");
    expect(source).toContain("车牌直拍已作为装土发票并进入在途");
    expect(source).toContain("到达卸土点并确认");
    expect(source).toContain("拍摄卸土现场后上传");
    expect(source).toContain("上传照片并确认卸土");
  });
});
