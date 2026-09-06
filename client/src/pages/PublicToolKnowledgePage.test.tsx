import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("公开工具知识页面", () => {
  it("提供无需登录的公开路由和同一套工程计算器", () => {
    const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const pageSource = readFileSync(new URL("./PublicToolKnowledgePage.tsx", import.meta.url), "utf8");
    expect(appSource).toContain('path={"/public-tools"}');
    expect(pageSource).toContain("ConstructionToolbox");
    expect(pageSource).toContain("无需登录");
    expect(pageSource).not.toContain("useAuth");
    expect(pageSource).not.toContain("trpc.");
  });

  it("明确公开页面不读写企业业务数据", () => {
    const pageSource = readFileSync(new URL("./PublicToolKnowledgePage.tsx", import.meta.url), "utf8");
    expect(pageSource).toContain("不会读取、保存或修改企业项目数据");
    expect(pageSource).toContain("管理员入口");
  });
});
