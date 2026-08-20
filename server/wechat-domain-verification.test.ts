import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("微信业务域名校验文件", () => {
  it("在 SPA 静态回退前按原文件名和原始 16 字节正文返回最新校验文件", () => {
    const source = readFileSync(new URL("./_core/index.ts", import.meta.url), "utf8");

    expect(source).toContain('app.get("/MP_verify_ovXYyaGy5gpoUjxo.txt"');
    expect(source).toContain('res.type("text/plain").send("ovXYyaGy5gpoUjxo")');
    expect(source.indexOf('app.get("/MP_verify_ovXYyaGy5gpoUjxo.txt"')).toBeLessThan(source.indexOf('// tRPC API'));
  });
});
