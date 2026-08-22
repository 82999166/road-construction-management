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

  it("禁止相册选择并在直拍开票后显示成功反馈", () => {
    expect(source).toContain("不提供相册选择");
    expect(source).toContain("发票成功！");
    expect(source).toContain(': "发票"}</Button>');
  });

  it("将直拍票据作为装土开票进入在途，并提供卸土现场确认入口", () => {
    expect(source).toContain("confirmPlatePhotoUnload");
    expect(source).toContain("车牌直拍已作为装土发票并进入在途");
    expect(source).toContain("到达卸土点并确认");
  });
});
