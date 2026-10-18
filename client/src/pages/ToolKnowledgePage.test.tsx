import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getAuthorizedManagementModules,
  getManagementModulePath,
} from "@/lib/managementPortal";
import { DEPARTMENT_AGNOSTIC_MOBILE_MENUS } from "../../../shared/department";

describe("工具知识中心管理入口", () => {
  it("为工具知识提供独立路由，不把它视作业务数据模块", () => {
    expect(getManagementModulePath("TOOL_KNOWLEDGE")).toBe("/tools");
    expect(
      getAuthorizedManagementModules([
        { code: "TOOL_KNOWLEDGE", title: "工具知识" },
      ])
    ).toHaveLength(1);
    expect(DEPARTMENT_AGNOSTIC_MOBILE_MENUS).toContain("TOOL_KNOWLEDGE");
  });

  it("使用统一的分类工具工作台，而不是纵向堆叠所有工具", () => {
    const pageSource = readFileSync(
      new URL("./ToolKnowledgePage.tsx", import.meta.url),
      "utf8"
    );
    expect(pageSource).toContain("ToolKnowledgeWorkspace");
    expect(pageSource).not.toContain("<EngineeringCalculatorDirectory />");
    expect(pageSource).not.toContain("<EngineeringKnowledgeLibrary />");
  });
});
