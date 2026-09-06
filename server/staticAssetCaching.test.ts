import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("生产静态资源缓存与单页应用回退", () => {
  it("哈希分包长期缓存，入口 HTML 强制重新校验", () => {
    const source = readFileSync(new URL("./_core/vite.ts", import.meta.url), "utf8");
    expect(source).toContain('app.use("/assets", express.static');
    expect(source).toContain('maxAge: "1y"');
    expect(source).toContain('"public, max-age=31536000, immutable"');
    expect(source).toContain('res.setHeader("Cache-Control", "no-cache")');
  });

  it("不存在的动态分包返回 404，不能被 SPA 回退伪装成 HTML 成功响应", () => {
    const source = readFileSync(new URL("./_core/vite.ts", import.meta.url), "utf8");
    expect(source).toContain('if (req.path.startsWith("/assets/"))');
    expect(source).toContain('res.status(404).setHeader("Cache-Control", "no-store").end()');
  });
});
