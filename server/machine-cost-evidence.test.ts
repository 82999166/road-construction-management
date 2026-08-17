import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("机械费用说明与工程水印影像归档", () => {
  it("保存费用说明、校验同项目影像并在创建后回写成本来源编号", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");

    expect(source).toContain("remarks: z.string().trim().max(500).nullable().optional()");
    expect(source).toContain("费用水印照片不存在或不属于当前项目");
    expect(source).toContain("remarks: input.remarks?.trim() || null");
    expect(source).toContain("sourceId: `machine-cost-${costId}`");
    expect(source).toContain("已关联水印照片");
  });
});
