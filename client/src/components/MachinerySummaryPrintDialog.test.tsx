import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("机械 A4 汇总打印模板", () => {
  it("按项目、期间、机械和状态读取真实成本台账并输出末行合计", () => {
    const source = readFileSync(new URL("./MachinerySummaryPrintDialog.tsx", import.meta.url), "utf8");

    expect(source).toContain("trpc.machinery.printSummary.useQuery");
    expect(source).toContain("machineId");
    expect(source).toContain("period");
    expect(source).toContain("costTypeLabel");
    expect(source).toContain("const getCostTypeLabel");
    expect(source).toContain('getBusinessStatusLabel(record.status)');
    expect(source).toContain('getCostTypeLabel(record.costType)');
    expect(source).toContain('record.costName || "未命名费用"');
    expect(source).toContain("费用名称 / 类别");
    expect(source).not.toContain('statusLabel[record.status] ?? record.status');
    expect(source).not.toContain('costTypeLabel[record.costType] ?? record.costType');
    expect(source).toContain("openA4LandscapePrintDocument");
    expect(source).toContain("合计：记录");
  });
});
