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

  it("提供移动月结打印页、完整费用录入与真实设备联系人摘要", () => {
    const source = readFileSync(new URL("./MobileMachineryPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("printMonthlySettlement");
    expect(source).toContain("机械月度结算预览表");
    expect(source).toContain("openCostDialog(machine.id)");
    expect(source).toContain(">费用录入</Button>");
    expect(source).toContain("createWatermarkedCostImage");
    expect(source).toContain("trpc.evidence.upload.useMutation");
    expect(source).toContain("费用水印照片");
    expect(source).toContain("费用说明");
    expect(source).toContain("evidenceId, remarks:");
    expect(source).toContain("operatorName");
    expect(source).toContain("驾驶员手机");
    expect(source).toContain("openMachineContactDialog(machine)");
    expect(source.match(/驾驶员姓名/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain('placeholder="加密保存"');
    expect(source).not.toContain('fixed bottom-[4.65rem]');
    expect(source).not.toContain('fixed bottom-[9.6rem]');
  });
});
