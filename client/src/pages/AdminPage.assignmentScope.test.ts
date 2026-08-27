import { describe, expect, it } from "vitest";
import { getAssignmentScopeSaveInput } from "@/lib/assignmentScope";

describe("人员角色授权范围规范化", () => {
  it("具体项目优先于同时选择的部门，避免产生模糊双范围授权", () => {
    expect(getAssignmentScopeSaveInput({ organizationId: "31", projectId: "101" })).toEqual({ organizationId: null, projectId: 101 });
  });

  it("未选择具体项目时保留部门范围", () => {
    expect(getAssignmentScopeSaveInput({ organizationId: "31", projectId: "" })).toEqual({ organizationId: 31, projectId: null });
  });

  it("空范围不会被转换为零值或全项目范围", () => {
    expect(getAssignmentScopeSaveInput({ organizationId: "", projectId: "" })).toEqual({ organizationId: null, projectId: null });
  });
});
