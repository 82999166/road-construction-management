import { describe, expect, it } from "vitest";
const readSource = (path: Parameters<typeof readFileSync>[0]) =>
  readFileSync(path, "utf8")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/,\s*}/g, " }");

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readSource(
  resolve(import.meta.dirname, "LaborWorkspaceShell.tsx")
).replace(/\s+/g, " ");
const adminSource = readSource(
  resolve(import.meta.dirname, "..", "pages", "AdminPage.tsx")
).replace(/\s+/g, " ");

describe("LaborWorkspaceShell", () => {
  it("保留授权项目、受控刷新与各类查询状态提示", () => {
    expect(source).toContain("请先选择已授权项目");
    expect(source).toContain(
      "正在读取实名制、上下班考勤、工资条和临时日结数据"
    );
    expect(source).toContain("重新读取劳务台账");
    expect(source).toContain("hasError");
  });

  it("由后台页面以懒加载方式挂载，避免壳组件进入静态依赖", () => {
    expect(adminSource).toContain(
      'lazy(() => import("@/components/LaborWorkspaceShell"))'
    );
    expect(adminSource).toContain("<LaborWorkspaceShell");
  });
});
