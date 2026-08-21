import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("劳务工资添加员工/工人入口", () => {
  it("直接打开员工档案录入窗口，不跳转至权限页面", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");
    const entryAction = source.match(/<LaborEntryActionCard onAdd=\{\(\) => \{[^}]+\}\} \/>/)?.[0] ?? "";
    expect(entryAction).toContain("setEmployeeProfileDialogOpen(true)");
    expect(entryAction).not.toContain('setLocation("/admin/permissions")');
  });
});
