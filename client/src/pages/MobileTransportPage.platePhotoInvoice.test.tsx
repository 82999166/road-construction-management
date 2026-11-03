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
    expect(source).toContain("value={tripVehicleId ? (vehicles.data?.find(vehicle => vehicle.id === tripVehicleId)?.plateNo || plateVehicleSearch) : plateVehicleSearch}");
    expect(source).toContain("if (tripVehicleId && value !==");
    expect(source).toContain("已选择车牌：");
  });

  it("拍照发票成功和直拍卸土成功后使用中文语音播报", () => {
    const speech = readFileSync(new URL("../lib/transportReceiptSpeech.ts", import.meta.url), "utf8");
    expect(source).toContain("useTransportReceiptSpeech()");
    expect(speech).toContain('utterance.lang = "zh-CN"');
    expect(source).toContain("拍照发票成功");
    expect(source).toContain("卸土成功");
    expect(source).toContain("speakTransportReceipt");
  });

  it("拍照提交和卸土确认在异步处理前解锁语音，提供无业务提交的测试与成功重播", () => {
    const submit = source.slice(source.indexOf("async function submitTrip()"), source.indexOf("function openTripDialog"));
    const unload = source.slice(source.indexOf("async function confirmPlatePhotoTripUnload"), source.indexOf("if (loading || !isAuthenticated"));
    expect(submit.indexOf("prepareSpeech()")).toBeLessThan(submit.indexOf("await createWatermarkedTransportImage"));
    expect(unload.indexOf("prepareSpeech()")).toBeLessThan(unload.indexOf("navigator.geolocation.getCurrentPosition"));
    expect(source).toContain('aria-label="运输成功语音回执"');
    expect(source).toContain("测试语音播报（不提交发票）");
    expect(source).toContain('onClick={replaySpeech}');
    expect(source).toContain("closePlatePhotoUnloadForm()");
    const hook = readFileSync(new URL("../hooks/useTransportReceiptSpeech.ts", import.meta.url), "utf8");
    expect(hook).not.toContain("trpc");
    expect(hook).not.toContain("mutate");
    expect(hook).toContain("controller.speakTransportReceipt(lastMessage, true)");
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
    expect(source).toContain("拍照卸土并确认");
    expect(source).toContain("拍摄卸土现场后上传");
    expect(source).toContain("上传照片并确认卸土");
  });
});
