import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("全局 DOM 安全边界", () => {
  it("阻止浏览器自动翻译修改 React 管理端节点", () => {
    const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const boundary = readFileSync(new URL("./components/ErrorBoundary.tsx", import.meta.url), "utf8");
    expect(app).toContain('className="notranslate" translate="no"');
    expect(boundary).toContain('translate="no"');
  });
});
