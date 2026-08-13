import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("项目指挥台后台壳层", () => {
  it("保留分组导航、深色控制台侧栏和项目上下文顶栏", () => {
    const source = readFileSync(new URL("./DashboardLayout.tsx", import.meta.url), "utf8");

    expect(source).toContain("section?: string");
    expect(source).toContain("const menuGroups = menuItems.reduce");
    expect(source).toContain("!bg-[#14242c]");
    expect(source).toContain("ROAD · COMMAND · OS");
    expect(source).toContain("项目指挥台");
    expect(source).toContain("admin-command-canvas");
  });

  it("管理画布持续使用浅色工作区和黄色强调线", () => {
    const stylesheet = readFileSync(new URL("../index.css", import.meta.url), "utf8");

    expect(stylesheet).toContain(".admin-command-canvas");
    expect(stylesheet).toContain("rgba(243, 198, 78, 0.12)");
    expect(stylesheet).toContain("#f5f5f0");
  });
});
