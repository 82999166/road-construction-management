import { describe, expect, it } from "vitest";
import { getAuthorizedManagementModules, getManagementModulePath } from "@/lib/managementPortal";
import { DEPARTMENT_AGNOSTIC_MOBILE_MENUS } from "../../../shared/department";

describe("工具知识中心管理入口", () => {
  it("为工具知识提供独立路由，不把它视作业务数据模块", () => {
    expect(getManagementModulePath("TOOL_KNOWLEDGE")).toBe("/tools");
    expect(getAuthorizedManagementModules([{ code: "TOOL_KNOWLEDGE", title: "工具知识" }])).toHaveLength(1);
    expect(DEPARTMENT_AGNOSTIC_MOBILE_MENUS).toContain("TOOL_KNOWLEDGE");
  });
});
