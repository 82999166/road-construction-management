import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("手机端机械成本名称与备注", () => {
  it("要求填写费用名称，保存名称与备注，并在成本记录中显示", () => {
    const source = readFileSync(new URL("./MobileMachineryPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("费用名称（必填）");
    expect(source).toContain("请填写费用名称");
    expect(source).toContain("costName: costDraft.costName.trim()");
    expect(source).toContain("Label>备注</Label>");
    expect(source).toContain('cost.costName || "未命名费用"');
  });
});
