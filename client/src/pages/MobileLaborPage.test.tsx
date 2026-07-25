import { describe, expect, it } from "vitest";
import { MOBILE_LABOR_BOTTOM_NAVIGATION, canPayPayrollFromMobile, canVoidPayrollFromMobile } from "./MobileLaborPage";

/** 移动端操作按钮只做体验层收敛，后端仍执行岗位和工资状态机的最终校验。 */
describe("劳务工资移动端权限与导航", () => {
  it("将支付、作废按钮限制到相应岗位，并始终跳转至移动端个人中心", () => {
    expect(canPayPayrollFromMobile(["FINANCE_MANAGER"])).toBe(true);
    expect(canPayPayrollFromMobile(["ACCOUNTANT"])).toBe(false);
    expect(canVoidPayrollFromMobile(["ACCOUNTANT"])).toBe(true);
    expect(canVoidPayrollFromMobile(["LABOR_MANAGER"])).toBe(false);
    expect(MOBILE_LABOR_BOTTOM_NAVIGATION.profile).toBe("/mobile/profile");
  });
});
