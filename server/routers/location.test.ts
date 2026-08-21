import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("中文详细地址解析服务", () => {
  it("仅返回中文详细地址，不向业务页面返回经纬度", () => {
    const source = readFileSync(new URL("./location.ts", import.meta.url), "utf8");
    expect(source).toContain('"/maps/api/geocode/json"');
    expect(source).toContain('language: "zh-CN"');
    expect(source).toContain("return { address: first.formatted_address }");
    expect(source).not.toContain("return { address: first.formatted_address, latitude");
  });
});
