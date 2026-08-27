import { describe, expect, it } from "vitest";
import { canVoidMeasurementClaim, claimStatus } from "./MobileMeasurementPage";

/**
 * 移动端仅展示服务端允许的作废入口；最终权限和状态校验仍由 measurement.transitionClaim 执行。
 */
describe("工程计量移动端终态展示", () => {
  it("为作废状态提供明确标签，并且不为已确认收入记录显示作废入口", () => {
    expect(claimStatus("void")).toBe("已作废");
    expect(canVoidMeasurementClaim("approved")).toBe(true);
    expect(canVoidMeasurementClaim("settled")).toBe(false);
    expect(canVoidMeasurementClaim("void")).toBe(false);
  });

  it("按服务端能力投影而不是超级管理员身份显示申报动作，并支持收方关联计量申报", async () => {
    const source = await import("node:fs/promises").then(fs => fs.readFile(new URL("./MobileMeasurementPage.tsx", import.meta.url), "utf8"));
    expect(source).toContain("trpc.measurement.claimCapabilities.useQuery");
    expect(source).toContain("claimCapabilities.data?.canReview");
    expect(source).toContain("关联计量申报（可选）");
    expect(source).toContain("measurementClaimId: takeoffDraft.measurementClaimId");
  });

  it("使用设备日期、中文状态和独立 A4 汇总打印", async () => {
    const source = await import("node:fs/promises").then(fs => fs.readFile(new URL("./MobileMeasurementPage.tsx", import.meta.url), "utf8"));

    expect(claimStatus("unknown_internal_state")).toBe("待处理");
    expect(source).toContain("function getCurrentPeriod() { return toChinaMonthInput(); }");
    expect(source).toContain("function asDateInput(value: Date | string | null | undefined) { return toDeviceDateInput(value ?? new Date()); }");
    expect(source).toContain("function printMeasurementSummary()");
    expect(source).toContain("openA4LandscapePrintDocument");
    expect(source).not.toContain("onClick={() => window.print()}");
  });
});
