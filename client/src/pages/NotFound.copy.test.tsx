import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("中文 404 页面", () => {
  it("向最终用户展示中文错误说明和返回入口", () => {
    const source = readFileSync(new URL("./NotFound.tsx", import.meta.url), "utf8");

    expect(source).toContain("页面未找到");
    expect(source).toContain("您访问的页面不存在");
    expect(source).toContain("返回首页");
    expect(source).not.toContain("Page Not Found");
    expect(source).not.toContain("Go Home");
  });
});
