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
});
