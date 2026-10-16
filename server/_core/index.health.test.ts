import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("应用健康检查接口", () => {
  it("在 SPA 静态回退之前返回不可缓存的 JSON 健康结果", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

    expect(source).toContain('app.get("/api/health"');
    expect(source).toContain('res.setHeader("Cache-Control", "no-store")');
    expect(source).toContain('res.status(200).json({ ok: true, service: "yx-cloud-management" })');
    expect(source.indexOf('app.get("/api/health"')).toBeLessThan(source.indexOf("serveStatic(app)"));
  });
});
