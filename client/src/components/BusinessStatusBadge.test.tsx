import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(import.meta.dirname, "BusinessStatusBadge.tsx"), "utf8");

describe("BusinessStatusBadge", () => {
  it("保留劳务审核、付款与终态的真实状态展示", () => {
    expect(source).toContain('approved: "已审核"');
    expect(source).toContain('paid: "已发放"');
    expect(source).toContain('void: "已作废"');
    expect(source).toContain("仅展示服务端真实状态");
  });
});
