import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  filterMachineSettlements,
  filterMachineryOvertime,
  machineryCsv,
  overtimeNextActions,
  overtimeTotals,
  MACHINERY_WORKSPACE_TABS,
  MACHINERY_DETAIL_TABS,
  type MachineryOvertimeRow,
} from "../lib/machineryWorkspace";
import { paginateFinanceRows } from "../lib/financePagination";

const source = (name: string) =>
  readFileSync(new URL(`./${name}.tsx`, import.meta.url), "utf8");
const row = (
  id: number,
  overrides: Partial<MachineryOvertimeRow> = {}
): MachineryOvertimeRow => ({
  id,
  machineId: 1,
  projectId: 1,
  date: "2026-11-04",
  machineName: "挖机",
  machineCode: "M001",
  driverName: "司机",
  overtimeHours: 2,
  overtimeHourlyRate: 50,
  overtimeAmount: 100,
  status: "draft",
  remarks: null,
  legacyShiftCount: 0,
  ...overrides,
});

describe("机械统一工作区行为", () => {
  it("四栏目与五详情分区固定，不新建人员或工资入口", () => {
    expect(MACHINERY_WORKSPACE_TABS.map(tab => tab.label)).toEqual([
      "机械档案",
      "司机加班",
      "费用统计",
      "租金结算",
    ]);
    expect(MACHINERY_DETAIL_TABS.map(tab => tab.label)).toEqual([
      "基本",
      "加班",
      "费用",
      "维保采购",
      "结算",
    ]);
    const s = source("MachineryWorkspace");
    expect(s).toContain('label="机械工作区栏目"');
    expect(s).toContain('label="机械详情分区"');
    expect(s).toContain("DropdownMenu");
    expect(s).toContain("FinanceRetainedPanel");
    expect(s).not.toContain("savePayroll");
    expect(s).not.toContain("createPerson");
  });
  it("付款期与单机筛选唯一且不改变源数组，分页只影响屏幕", () => {
    const rows = Array.from({ length: 125 }, (_, index) => ({
      id: index + 1,
      machineId: index < 101 ? 1 : 2,
      period: index < 120 ? "2026-11" : "2026-10",
      netPayableAmount: 10,
    }));
    const filtered = filterMachineSettlements(rows, "2026-11", "1");
    expect(filtered).toHaveLength(101);
    for (const size of [20, 50, 100]) {
      expect(paginateFinanceRows(filtered, 1, size).pageRows).toHaveLength(
        size
      );
      expect(
        filtered.reduce((sum, item) => sum + item.netPayableAmount, 0)
      ).toBe(1010);
    }
    expect(rows).toHaveLength(125);
    expect(filterMachineSettlements(rows, "2026-10", "1")).toHaveLength(0);
    const s = source("MachinePaymentSettlementManager");
    expect(s).toContain("pagination.pageRows.map");
    expect(s).toContain("printableSettlements.map");
    expect(s).not.toContain("settlements.data.map");
    expect(s).toContain("filterMachineSettlements");
    expect(s).toContain("capabilities.data?.canPay");
  });
  it("加班日期、状态、机械筛选同口径，作废不计金额、零加班不展示（历史记录只读保留）", () => {
    const rows = [
      row(1),
      row(2, { status: "void" }),
      row(3, { date: "2026-11-03" }),
      row(4, { machineId: 2 }),
      row(5, { overtimeHours: 0, overtimeAmount: 0 }),
      row(6, { overtimeHours: 0, overtimeAmount: 0, legacyShiftCount: 1 }),
    ];
    const filtered = filterMachineryOvertime(rows, {
      date: "2026-11-04",
      status: "all",
      machineId: 1,
    });
    expect(filtered.map(item => item.id)).toEqual([1, 2, 6]);
    expect(overtimeTotals(filtered)).toEqual({
      count: 3,
      validCount: 2,
      hours: 2,
      amount: 100,
    });
    expect(
      filterMachineryOvertime(rows, { status: "void" }).map(item => item.id)
    ).toEqual([2]);
    expect(
      filterMachineryOvertime(rows, { date: "2026-11-03", status: "draft" })
    ).toHaveLength(1);
  });
  it("原状态链的前端动作对只读拒绝、提交/审核/结算分权、终态不可回退", () => {
    expect(overtimeNextActions("draft", {})).toEqual([]);
    expect(
      overtimeNextActions("draft", { canManage: true }).map(
        item => item.nextStatus
      )
    ).toEqual(["submitted", "void"]);
    expect(
      overtimeNextActions("submitted", {
        canManage: true,
        canApprove: false,
      }).map(item => item.nextStatus)
    ).toEqual(["void"]);
    expect(
      overtimeNextActions("submitted", { canApprove: true }).map(
        item => item.nextStatus
      )
    ).toEqual(["approved"]);
    expect(
      overtimeNextActions("approved", { canSettle: true }).map(
        item => item.nextStatus
      )
    ).toEqual(["settled"]);
    expect(
      overtimeNextActions("settled", {
        canManage: true,
        canApprove: true,
        canSettle: true,
      })
    ).toEqual([]);
    expect(overtimeNextActions("void", { canManage: true })).toEqual([]);
  });
  it("CSV防公式注入/双引号且全量导出；所有输出只传业务列不带账户或凭证URL", () => {
    const csv = machineryCsv(
      ["费用"],
      [['=WEBSERVICE("bad")'], ["@SUM(A1)"], ["备注,换行\n尾"]]
    );
    expect(csv).toContain("'=WEBSERVICE");
    expect(csv).toContain("'@SUM");
    expect(csv).toContain('"备注,换行\n尾"');
    for (const component of [
      "MachineryCostWorkspace",
      "MachineryOvertimeLedger",
    ]) {
      const s = source(component);
      expect(s).toContain("filteredRows.map");
      expect(s).toContain("pagination.pageRows.map");
      expect(s).not.toContain("payeeAccount");
      expect(s).not.toContain("storagePath");
      expect(s).not.toContain("signedUrl");
    }
  });
  it("当前栏目控制query enabled且切项目重置选机、弹窗，表单打开禁切项目", () => {
    const s = source("MachineryWorkspace");
    expect(s).toContain('tab === "archives"');
    expect(s).toContain('tab === "settlements"');
    expect(s).toContain("setDetailOpen(false)");
    expect(s).toContain('setFilterMachineId("all")');
    expect(s.replace(/\s+/g, "")).toContain(
      "Boolean(formOpen||workspacePaymentOpen||detailPaymentOpen)"
    );
    const mobile = readFileSync(
      new URL("../pages/MobileMachineryPage.tsx", import.meta.url),
      "utf8"
    );
    expect(mobile).toContain("请先保存或关闭机械表单再切换项目");
    expect(mobile).not.toContain("登记台班");
    const owner = readFileSync(
      new URL("../pages/MachineOwnerPortalPage.tsx", import.meta.url),
      "utf8"
    );
    expect(owner).toContain("最近100条内费用小计");
    expect(owner).toContain("非全历史累计");
    expect(owner).not.toContain('label: "累计费用"');
    expect(owner).not.toContain("useMutation");
  });
});
