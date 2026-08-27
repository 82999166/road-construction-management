import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("悦信云智管品牌名称", () => {
  it("在网页标题、后台、移动工作台、入口页和默认水印中统一展示新名称", () => {
    const files = [
      "client/index.html",
      "client/src/pages/Home.tsx",
      "client/src/pages/AdminPage.tsx",
      "client/src/pages/ManagementPortal.tsx",
      "client/src/pages/MobileWorkbench.tsx",
      "shared/watermarkTemplate.ts",
    ];
    for (const relativePath of files) {
      const source = readFileSync(new URL(`../../../${relativePath}`, import.meta.url), "utf8");
      expect(source).toContain("悦信云智管");
    }
  });
});
