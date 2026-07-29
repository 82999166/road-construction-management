import { describe, expect, it } from "vitest";

import { getDepartmentScopePickerState } from "./AdminPage";

describe("权限页部门或项目部选择器", () => {
  it("在组织节点加载期间禁用选择并显示加载提示", () => {
    expect(getDepartmentScopePickerState(true, 0)).toEqual({
      disabled: true,
      placeholder: "正在加载组织节点…",
      needsOrganizationSetup: false,
    });
  });

  it("没有部门或项目部时提供建立组织节点的明确状态", () => {
    expect(getDepartmentScopePickerState(false, 0)).toEqual({
      disabled: true,
      placeholder: "暂无部门或项目部",
      needsOrganizationSetup: true,
    });
  });

  it("存在可选节点时恢复选择器", () => {
    expect(getDepartmentScopePickerState(false, 1)).toEqual({
      disabled: false,
      placeholder: "选择部门或项目部",
      needsOrganizationSetup: false,
    });
  });
});
