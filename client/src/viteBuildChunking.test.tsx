import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("生产构建分包策略", () => {
  it("将框架、数据、UI 和图表依赖拆为可缓存的独立包，不合并业务页面源码", () => {
    const source = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
    expect(source).toContain('return "framework-react"');
    expect(source).toContain('return "framework-data"');
    expect(source).toContain('return "framework-ui"');
    expect(source).toContain('return "framework-charts"');
    expect(source).toContain("output: { manualChunks }");
  });
});
