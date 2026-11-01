import { describe, expect, it } from "vitest";
import { MOBILE_LABOR_BOTTOM_NAVIGATION, canApprovePayrollFromMobile, canPayPayrollFromMobile, canSubmitPayrollFromMobile, canVoidPayrollFromMobile, getMobilePayrollActions } from "./MobileLaborPage";

/** 移动端操作按钮只做体验层收敛，后端仍执行岗位和工资状态机的最终校验。 */
describe("劳务工资移动端权限与导航", () => {
  it("将付款收口到PC凭证台账、限制作废岗位，并始终跳转至移动端个人中心", () => {
    expect(canSubmitPayrollFromMobile(["LABOR_MANAGER"])).toBe(true);
    expect(canSubmitPayrollFromMobile(["ACCOUNTANT"])).toBe(false);
    expect(canApprovePayrollFromMobile(["ACCOUNTANT"])).toBe(true);
    expect(canApprovePayrollFromMobile(["LABOR_MANAGER"])).toBe(false);
    expect(canPayPayrollFromMobile(["FINANCE_MANAGER"])).toBe(false);
    expect(canPayPayrollFromMobile(["ALL"])).toBe(false);
    expect(canVoidPayrollFromMobile(["ACCOUNTANT"])).toBe(true);
    expect(canVoidPayrollFromMobile(["LABOR_MANAGER"])).toBe(false);
    expect(MOBILE_LABOR_BOTTOM_NAVIGATION.profile).toBe("/mobile/profile");
  });

  it("按工资状态向普通劳资、会计和财务负责人仅投影其职责内的高影响操作", () => {
    expect(getMobilePayrollActions("draft", ["LABOR_MANAGER"])).toEqual({ submit: true, approve: false, pay: false, void: false });
    expect(getMobilePayrollActions("reviewing", ["LABOR_MANAGER"])).toEqual({ submit: false, approve: false, pay: false, void: false });
    expect(getMobilePayrollActions("reviewing", ["ACCOUNTANT"])).toEqual({ submit: false, approve: true, pay: false, void: true });
    expect(getMobilePayrollActions("approved", ["FINANCE_MANAGER"])).toEqual({ submit: false, approve: false, pay: false, void: true });
    expect(getMobilePayrollActions("partial", ["FINANCE_MANAGER"])).toEqual({ submit: false, approve: false, pay: false, void: false });
    expect(getMobilePayrollActions("paid", ["ALL"])).toEqual({ submit: false, approve: false, pay: false, void: false });
  });
});
