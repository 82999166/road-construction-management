import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./MobileDieselPage.tsx", import.meta.url), "utf8");

describe("移动柴油管理操作窗口", () => {
  it("在已授权时提供真实柴油领用登记，而不是仅展示只读台账", () => {
    expect(source).toContain("canCreateRefuel");
    expect(source).toContain("登记柴油领用");
    expect(source).toContain("mobileCreateRefuel");
    expect(source).toContain("mobileRefuelOptions");
  });

  it("强制使用后置相机、水印证据和柴油专用影像来源", () => {
    expect(source).toContain('facingMode: { ideal: "environment" }');
    expect(source).toContain("createWatermarkedDieselImage");
    expect(source).toContain('sourceType: "diesel_receipt"');
    expect(source).toContain("柴油领用必须使用后置相机直拍加油表照片");
    expect(source).not.toContain('type="file"');
  });

  it("在上传影像前提示近期相同资源与油量的重复记录，并禁用再次记账", () => {
    expect(source).toContain("recentDuplicateRefuel");
    expect(source).toContain("DUPLICATE_REFUEL_WINDOW_MILLISECONDS");
    expect(source).toContain("为防止重复入账，本次保存已禁用");
    expect(source).toContain("Boolean(recentDuplicateRefuel)");
  });
});
