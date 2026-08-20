import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("运输台账历史表替换", () => {
  it("以稳定 Card 数据属性隐藏新版台账前的历史简版表，不依赖 Tailwind 类名", () => {
    const source = readFileSync(new URL("./index.css", import.meta.url), "utf8");
    expect(source).toContain('[data-slot="card"]:has(+ #transport-trip-ledger-upgrade)');
    expect(source).toContain("display: none !important");
  });
});
