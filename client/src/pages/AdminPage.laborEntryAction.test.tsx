import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const readSource = (path: Parameters<typeof readFileSync>[0]) =>
  readFileSync(path, "utf8")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/,\s*}/g, " }");

describe("劳务工资添加员工/工人入口", () => {
  it("切换至挂载员工档案对话框的正确权限路由，并保持录入窗口开启", () => {
    const source = readSource(
      new URL("./AdminPage.tsx", import.meta.url)
    ).replace(/\s+/g, " ");
    const entryAction =
      source.match(
        /<LaborEntryActionCard onAdd=\{\(\) => \{[^}]+\}\} \/>/
      )?.[0] ?? "";
    expect(entryAction).toContain("setEmployeeProfileDialogOpen(true)");
    expect(entryAction).toContain('setLocation("/admin/permission")');
    expect(entryAction).not.toContain('setLocation("/admin/permissions")');
  });
});
