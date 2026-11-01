import { describe, expect, it } from "vitest";

import { getDepartmentScopePickerState } from "@/lib/adminWorkspaceState";

describe("权限页项目或部门业务范围选择器", () => {
  it("在项目和组织节点加载期间禁用选择并显示加载提示", () => {
    expect(getDepartmentScopePickerState(true, 0, 0)).toEqual({
      disabled: true,
      placeholder: "正在加载项目与组织节点…",
      needsScopeSetup: false,
    });
  });

  it("没有项目和部门节点时提供明确的建立范围状态", () => {
    expect(getDepartmentScopePickerState(false, 0, 0)).toEqual({
      disabled: true,
      placeholder: "暂无项目或部门范围",
      needsScopeSetup: true,
    });
  });

  it("已有项目时无需建立组织节点也可直接配置业务菜单", () => {
    expect(getDepartmentScopePickerState(false, 0, 1)).toEqual({
      disabled: false,
      placeholder: "选择已有项目或部门/项目部",
      needsScopeSetup: false,
    });
  });

  it("存在部门节点时仍保留既有配置方式", () => {
    expect(getDepartmentScopePickerState(false, 1, 0)).toEqual({
      disabled: false,
      placeholder: "选择已有项目或部门/项目部",
      needsScopeSetup: false,
    });
  });
});
