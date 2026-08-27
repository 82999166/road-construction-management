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
    expect(source).toContain("trpc.machinery.listPaymentSettlements.useQuery");
    expect(source).toContain("机械付款状态");
    expect(source).toContain("请在PC付款台账生成结算并登记付款");
    expect(source).not.toContain('transitionMonthlyStatement.mutate({ id: item.id, projectId: selectedProjectId, nextStatus: "settled" })');
  });

  it("提供移动月结打印页、完整费用录入与真实设备联系人摘要", () => {
    const source = readFileSync(new URL("./MobileMachineryPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("printMonthlySettlement");
    expect(source).toContain("机械月度结算预览表");
    expect(source).toContain("openA4LandscapePrintDocument");
    expect(source).toContain("formatChinaDateTime(new Date())");
    expect(source).not.toContain('window.open("", "_blank")');
    expect(source).toContain("重新获取授权项目");
    expect(source).toContain("projectOptions.isError");
    expect(source).toContain("成本台账暂时无法读取，请检查网络后重新获取。");
    expect(source).toContain("月度结算预览暂时无法读取，请检查计价规则或稍后重新计算。");
    expect(source).toContain("会计月度明细暂时无法核算，请检查填写内容后重新计算。");
    expect(source).toContain("const costsQuery = trpc.machinery.listCosts.useQuery");
    expect(source).toContain("const settlementQuery = trpc.machinery.settlementPreview.useQuery");
    expect(source).toContain("const monthlyStatementPreviewQuery = trpc.machinery.previewMonthlyStatement.useQuery");
    expect(source).toContain("openCostDialog(machine.id)");
    expect(source).toContain(">费用录入</Button>");
    expect(source).toContain("fuelCostDefault.fetch");
    expect(source).toContain("已带入 ${defaultPrice.occurredOn} 有效柴油指导价");
    expect(source).toContain('occurredAt: toDeviceDateTimeInput()');
    expect(source).toContain(">成本记录</Button>");
    expect(source).not.toContain('<TabsTrigger value="costs"');
    expect(source).toContain("createWatermarkedCostImage");
    expect(source).toContain("trpc.evidence.upload.useMutation");
    expect(source).toContain("费用水印照片");
    expect(source).toContain("startCostCamera");
    expect(source).toContain("navigator.mediaDevices.getUserMedia");
    expect(source).toContain("captureCostPhoto");
    expect(source).toContain("costCameraVideoRef");
    expect(source).toContain("打开后置相机拍照");
    expect(source).toContain("仅支持现场直拍，不提供本地相册选择");
    expect(source).not.toContain('id="machine-cost-camera"');
    expect(source).not.toContain('capture="environment"');
    expect(source).toContain("操作员（责任人）");
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
