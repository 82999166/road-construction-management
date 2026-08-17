import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("移动端机械会计月度明细", () => {
  it("提供与后台同源的会计明细查询、预览、草稿保存和状态流转入口", () => {
    const source = readFileSync(new URL("./MobileMachineryPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("trpc.machinery.listMonthlyStatements.useQuery");
    expect(source).toContain("trpc.machinery.previewMonthlyStatement.useQuery");
    expect(source).toContain("trpc.machinery.saveMonthlyStatement.useMutation");
    expect(source).toContain("trpc.machinery.transitionMonthlyStatement.useMutation");
    expect(source).toContain(">会计明细</TabsTrigger>");
    expect(source).toContain("会计机械月度明细");
    expect(source).toContain("机械总产值");
    expect(source).toContain("司机总工资");
    expect(source).toContain("机械分成");
    expect(source).toContain("提交会计审核");
  });
});
