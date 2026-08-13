import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ADMIN_BUSINESS_ROUTE_BY_MODULE, getBusinessWorkspaceProjectState } from "./AdminPage";

describe("统一后台业务工作区范围保护", () => {
  it("仅接受正整数项目号作为真实业务台账查询范围", () => {
    expect(getBusinessWorkspaceProjectState("27")).toEqual({ projectId: 27, hasProject: true });
    expect(getBusinessWorkspaceProjectState("")).toEqual({ projectId: 0, hasProject: false });
    expect(getBusinessWorkspaceProjectState("0")).toEqual({ projectId: 0, hasProject: false });
    expect(getBusinessWorkspaceProjectState("2.5")).toEqual({ projectId: 0, hasProject: false });
    expect(getBusinessWorkspaceProjectState("abc")).toEqual({ projectId: 0, hasProject: false });
  });

  it("将施工、劳务、机械和运输治理入口定向到受控 PC 台账", () => {
    expect(ADMIN_BUSINESS_ROUTE_BY_MODULE).toMatchObject({
      CONSTRUCTION: "/admin/construction",
      LABOR: "/admin/labor",
      MACHINERY: "/admin/machinery",
      TRANSPORT: "/admin/transport",
    });
  });

  it("禁止 PC 台账的查看、编辑和维护操作直接跳转到移动端", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).not.toMatch(/setLocation\(["'`]\/mobile/);
    expect(source).toContain("施工日报查看与编辑");
    expect(source).toContain("劳务人员档案");
    expect(source).toContain("运输趟次明细");
  });

  it("在 PC 超级管理后台承载员工、车辆与机械的关键维护闭环", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("普通管理人员账号");
    expect(source).toContain("管理人员角色授权");
    expect(source).toContain("车辆统一台账");
    expect(source).toContain("RFID 写卡");
    expect(source).toContain("机械档案维护");
    expect(source).toContain("新建机械档案");
    expect(source).toContain("录入机械成本");
    expect(source).toContain("外租合同与租金");
    expect(source).toContain("外租车辆");
    expect(source).toContain("起租日期");
    expect(source).toContain("截止日期");
    expect(source).toContain("saveMachine.mutate");
    expect(source).toContain("saveMachineCost.mutate");
  });

  it("持续提供员工保险到期筛选、资源条件筛选、CSV 导出和车辆机械维修保养费用汇总", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("员工档案、薪资与保险");
    expect(source).toContain("30 天内到期");
    expect(source).toContain("employeeInsurance");
    expect(source).toContain("downloadCsvFile");
    expect(source).toContain("车辆维修保养费");
    expect(source).toContain("车辆/机械费用汇总");
    expect(source).toContain("登记维修保养");
    expect(source).toContain("saveAssetMaintenance.mutate");
  });

  it("在手机宽度将新增台账的动作区与筛选控件分区换行，保留完整文案和足够触控高度", () => {
    const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto");
    expect(source).toContain("grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4");
    expect(source).toContain("min-h-11 w-full text-sm sm:min-h-8 sm:w-auto");
    expect(source).toContain("grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_180px_180px_auto]");
    expect(source).toContain("min-h-11 w-full self-end text-sm xl:w-auto");
  });
});
