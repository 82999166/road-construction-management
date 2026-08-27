import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(import.meta.dirname, "LaborWorkspaceShell.tsx"), "utf8");
const adminSource = readFileSync(resolve(import.meta.dirname, "..", "pages", "AdminPage.tsx"), "utf8");

describe("LaborWorkspaceShell", () => {
  it("保留授权项目、受控刷新与各类查询状态提示", () => {
    expect(source).toContain("请先选择已授权项目");
    expect(source).toContain("正在读取实名制、上下班考勤、工资条和临时日结数据");
    expect(source).toContain("重新读取劳务台账");
    expect(source).toContain("hasError");
  });

  it("由后台页面以懒加载方式挂载，避免壳组件进入静态依赖", () => {
    expect(adminSource).toContain('lazy(() => import("@/components/LaborWorkspaceShell"))');
    expect(adminSource).toContain("<LaborWorkspaceShell");
  });
});
