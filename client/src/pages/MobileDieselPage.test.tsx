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

  it("默认使用手机系统时间，并通过共享中国时区工具展示已保存的柴油记录", () => {
    expect(source).toContain('import { formatChinaDateTime, toDeviceDateTimeInput } from "@/lib/businessTime"');
    expect(source).toContain("refueledAt: toDeviceDateTimeInput()");
    expect(source).toContain("formatChinaDateTime(record.refueledAt)");
    expect(source).not.toContain("refueledAt: new Date().toISOString().slice(0, 16)");
  });

  it("未知柴油领用状态使用中文安全回退，不将内部枚举展示给用户", () => {
    expect(source).toContain('} as Record<string, string>)[status] ?? "待处理"');
  });

  it("台账查询、凭证归档和记账失败均不回显原始服务端错误", () => {
    expect(source).toContain("暂时无法加载当前项目柴油台账，请稍后重新加载。");
    expect(source).toContain("柴油领用登记未完成，请检查现场照片、定位和填写内容后重试");
    expect(source).not.toContain("{overview.error.message}");
    expect(source).not.toContain("toast.error(error.message)");
    expect(source).not.toContain("error instanceof Error ? error.message");
  });
});
