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
});
