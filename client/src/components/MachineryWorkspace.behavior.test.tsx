import React, { useState } from "react";
import { createRequire } from "node:module";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
// The renderer is a locked test-only development dependency; no external QA prefix is required.
const require = createRequire(import.meta.url);
const renderer = require("react-test-renderer");
const { create, act } = renderer;
const mock = vi.hoisted(() => ({
  machines: vi.fn(),
  capability: vi.fn(),
  summaries: vi.fn(),
  analysis: vi.fn(),
  statements: vi.fn(),
  payments: vi.fn(),
  costs: vi.fn(),
  overtime: vi.fn(),
  maintenance: vi.fn(),
  mutate: vi.fn(),
  print: vi.fn(),
  csv: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ machinery: {} }),
    machinery: {
      listMachines: { useQuery: mock.machines },
      workspaceCapabilities: { useQuery: mock.capability },
      listCostSummaries: { useQuery: mock.summaries },
      getMachineAnalysis: { useQuery: mock.analysis },
      listMonthlyStatements: { useQuery: mock.statements },
      listPaymentSettlements: { useQuery: mock.payments },
      printSummary: { useQuery: mock.costs },
      listDailyOperations: { useQuery: mock.overtime },
      transitionMonthlyStatement: {
        useMutation: () => ({ mutate: mock.mutate }),
      },
      createPaymentSettlement: { useMutation: () => ({ mutate: mock.mutate }) },
      transitionPaymentSettlement: {
        useMutation: () => ({ mutate: mock.mutate }),
      },
      transitionDailyOperation: {
        useMutation: () => ({ mutate: mock.mutate }),
      },
      transitionCost: { useMutation: () => ({ mutate: mock.mutate }) },
    },
    admin: { assetMaintenance: { list: { useQuery: mock.maintenance } } },
  },
}));
vi.mock("@/lib/a4Print", async original => ({
  ...(await original<typeof import("@/lib/a4Print")>()),
  openA4LandscapePrintDocument: mock.print,
}));
vi.mock("@/lib/machineryWorkspace", async original => ({
  ...(await original<typeof import("@/lib/machineryWorkspace")>()),
  downloadMachineryCsv: mock.csv,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: mock.warn },
}));
// Native substitutes only for Radix DOM/portal primitives; business components, hooks, pagination and handlers are real.
vi.mock("@/components/ui/dialog", () => {
  const Block = ({ children }: any) => <div>{children}</div>;
  return {
    useDialogComposition: () => ({
      isComposing: () => false,
      justEndedComposing: () => false,
      markCompositionEnd: () => {},
      setComposing: () => {},
    }),
    Dialog: ({ open, onOpenChange, children }: any) =>
      open ? (
        <div data-dialog>
          <button data-close onClick={() => onOpenChange(false)}>
            close primitive
          </button>
          {children}
        </div>
      ) : null,
    DialogContent: Block,
    DialogHeader: Block,
    DialogTitle: Block,
    DialogDescription: Block,
    DialogFooter: Block,
  };
});
vi.mock("@/components/ui/dropdown-menu", () => {
  const Block = ({ children }: any) => <div>{children}</div>;
  return {
    DropdownMenu: Block,
    DropdownMenuContent: Block,
    DropdownMenuItem: ({ onSelect, children }: any) => (
      <button onClick={onSelect}>{children}</button>
    ),
    DropdownMenuTrigger: Block,
  };
});
vi.mock("@/components/ui/select", () => {
  const Block = ({ children }: any) => <div>{children}</div>;
  return {
    Select: ({ value, onValueChange, children, disabled }: any) => (
      <div data-select={value} data-disabled={disabled}>
        <button data-select-change onClick={() => onValueChange("2")}>
          select-two
        </button>
        {children}
      </div>
    ),
    SelectContent: Block,
    SelectItem: Block,
    SelectTrigger: Block,
    SelectValue: Block,
  };
});
vi.mock("@/components/SettlementPaymentDialog", () => ({
  SettlementPaymentDialog: ({ open, onOpenChange, target }: any) =>
    open ? (
      <div data-payment-target={target?.id}>
        <button onClick={() => onOpenChange(false)}>关闭凭证</button>
      </div>
    ) : null,
}));
import MachineryWorkspace from "./MachineryWorkspace";
import MachinePaymentSettlementManager from "./MachinePaymentSettlementManager";
import MachineryOvertimeLedger from "./MachineryOvertimeLedger";
const result = (data: unknown) => ({
  data,
  isLoading: false,
  isFetching: false,
});
const machine = (id: number) => ({
  id,
  projectId: 10,
  name: `挖机${id}`,
  code: `M${id}`,
  ownership: "leased",
  status: "working",
  supplierName: "出租人",
  leaseTerms: {
    billingType: "monthly",
    rate: 3000,
    effectiveFrom: "2026-01-01",
  },
});
const settlement = (id: number, extra = {}) => ({
  id,
  machineId: 1,
  projectId: 10,
  monthlyStatementId: id,
  settlementNo: `PAY-${id}`,
  period: "2026-11",
  status: "approved",
  grossPayableAmount: 100,
  fuelCostAmount: 0,
  repairCostAmount: 0,
  manualDeductionAmount: 0,
  netPayableAmount: 100,
  actualPaidAmount: 30,
  remainingAmount: 70,
  payeeAccount: "SECRET-ACCOUNT",
  machine: machine(1),
  ...extra,
});
let tree: any;
const text = (node: any): string =>
  typeof node === "string" || typeof node === "number"
    ? String(node)
    : Array.isArray(node)
      ? node.map(text).join("")
      : node
        ? text(node.children)
        : "";
const treeText = () => text(tree.toJSON());
function button(label: string, root = tree.root) {
  return (
    root
      .findAllByType("button")
      .find((node: any) => text(node.props.children) === label) ??
    root
      .findAllByType("button")
      .find((node: any) =>
        text(node.toJSON?.() ?? node.props.children).includes(label)
      )
  );
}
function findButton(label: string, root = tree.root) {
  return root.findAllByType("button").find((node: any) => {
    const collect = (n: any): string =>
      typeof n === "string" || typeof n === "number"
        ? String(n)
        : Array.isArray(n)
          ? n.map(collect).join("")
          : n?.props
            ? collect(n.props.children)
            : "";
    return collect(node.props.children).includes(label);
  });
}
async function click(label: string, root = tree.root) {
  const node = findButton(label, root);
  expect(node, `button ${label}`).toBeTruthy();
  await act(async () => node.props.onClick());
}
function Host({ formOpen = false, onPaymentFormOpenChange = vi.fn() }: any) {
  const [period, setPeriod] = useState("2026-11");
  const [selected, setSelected] = useState("1");
  return (
    <MachineryWorkspace
      projectId={10}
      period={period}
      onPeriodChange={setPeriod}
      selectedMachineId={selected}
      onSelectMachine={setSelected}
      formOpen={formOpen}
      onPaymentFormOpenChange={onPaymentFormOpenChange}
      onCreate={vi.fn()}
      onEdit={vi.fn()}
      onOvertime={vi.fn()}
      onCost={vi.fn()}
      onMonthly={vi.fn()}
      onMaintenance={vi.fn()}
    />
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { confirm: vi.fn(() => false) });
  mock.machines.mockReturnValue(result([machine(1), machine(2)]));
  mock.capability.mockReturnValue(
    result({
      canCreate: true,
      canEdit: true,
      canManage: true,
      canApprove: true,
      canPay: true,
    })
  );
  mock.summaries.mockReturnValue(result([]));
  mock.maintenance.mockReturnValue(
    result(
      Array.from({ length: 55 }, (_, i) => ({
        id: i + 1,
        projectId: 10,
        assetType: "machine",
        assetId: 1,
        occurredAt: "2026-11-04",
        amount: 10,
        status: "approved",
        serviceProvider: `维保单位${i + 1}`,
      }))
    )
  );
  mock.analysis.mockReturnValue(
    result({
      daily: Array.from({ length: 55 }, (_, i) => ({
        date: `历史日${i + 1}`,
        shiftCount: 1,
        shiftRate: 100,
        overtimeHours: 2,
        overtimeAmount: 30,
        outputAmount: 100,
        driverWageAmount: 10,
        fuelAmount: 20,
        fuelLiters: 3,
        repairAmount: 0,
        maintenanceAmount: 0,
        partsAmount: 0,
        otherExpenseAmount: 0,
        netIncome: 70,
        operationStatus: "settled",
        remarks: "旧快照",
      })),
      monthly: Array.from({ length: 55 }, (_, i) => ({
        id: i + 1,
        period: `历史月${i + 1}`,
        machineShareAmount: 10,
        status: "settled",
      })),
      partsPurchases: Array.from({ length: 55 }, (_, i) => ({
        id: i + 1,
        itemDescription: `采购配件${i + 1}`,
        amount: 10,
        orderedAt: "2026-11-04",
        orderNo: `PO${i + 1}`,
        status: "closed",
      })),
    })
  );
  mock.statements.mockReturnValue(
    result(
      Array.from({ length: 55 }, (_, i) => ({
        id: i + 1,
        machineId: 1,
        period: "2026-11",
        machineShareAmount: 100,
        totalOutput: 200,
        driverTotalWage: 30,
        fuelAmount: 10,
        repairAmount: 0,
        signatureName: `签字${i + 1}`,
        status: "approved",
      }))
    )
  );
  mock.payments.mockReturnValue(
    result([
      ...Array.from({ length: 55 }, (_, i) => settlement(i + 1)),
      settlement(100, { period: "2026-10" }),
      settlement(101, { machineId: 2, machine: machine(2) }),
    ])
  );
  mock.costs.mockReturnValue(result({ records: [], summary: { amount: 0 } }));
  mock.overtime.mockReturnValue(result([]));
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null;
  vi.unstubAllGlobals();
});
describe("机械真实React组件事件，不写数据库", () => {
  it("租金外层筛选唯一且同步付款列表/合计/打印/导出，55条分页只显示20条", async () => {
    await act(async () => {
      tree = create(<Host />);
    });
    await click("租金结算");
    const selects = tree.root.findAll(
      (n: any) =>
        n.type === "select" && n.props["aria-label"] === "机械工作区筛选机械"
    );
    await act(async () =>
      selects[0].props.onChange({ target: { value: "1" } })
    );
    expect(treeText()).toContain("共 55 条");
    expect(treeText()).toContain("PAY-20");
    expect(treeText()).not.toContain("PAY-21");
    expect(treeText()).not.toContain("PAY-100");
    expect(treeText()).not.toContain("筛选期间（列表 / 打印 / 导出一致）");
    const payments = tree.root.findByType(MachinePaymentSettlementManager);
    expect(payments.props.filter).toEqual({ period: "2026-11", machineId: 1 });
    await click("打印当前筛选", payments);
    expect(mock.print.mock.calls.at(-1)![0].bodyHtml).toContain("PAY-55");
    expect(mock.print.mock.calls.at(-1)![0].bodyHtml).not.toContain("PAY-100");
    expect(mock.print.mock.calls.at(-1)![0].bodyHtml).not.toContain(
      "SECRET-ACCOUNT"
    );
    await click("导出当前筛选", payments);
    const exported = mock.csv.mock.calls.at(-1)![2];
    expect(exported).toHaveLength(55);
    expect(exported[54][0]).toBe("PAY-55");
    await click(
      "打印当前筛选",
      tree.root.findByProps({ "aria-label": "租金结算", role: "tabpanel" })
    );
    expect(mock.print.mock.calls.at(-1)![0].bodyHtml).toContain("签字55");
    await click(
      "导出当前筛选",
      tree.root.findByProps({ "aria-label": "租金结算", role: "tabpanel" })
    );
    expect(mock.csv.mock.calls.at(-1)![2]).toHaveLength(55);
    await act(async () =>
      tree.root
        .findByProps({ "aria-label": "机械工作区期间" })
        .props.onChange({ target: { value: "2026-10" } })
    );
    expect(
      tree.root.findByType(MachinePaymentSettlementManager).props.filter.period
    ).toBe("2026-10");
    expect(treeText()).toContain("PAY-100");
    expect(treeText()).not.toContain("PAY-55");
  });
  it("历史paid无流水不声明实付或余额为0，屏幕/打印/导出明确待核实", async () => {
    mock.payments.mockReturnValue(
      result([
        settlement(1, {
          status: "paid",
          legacyFinalized: true,
          actualPaidAmount: 0,
          remainingAmount: 0,
        }),
      ])
    );
    await act(async () => {
      tree = create(
        <MachinePaymentSettlementManager
          projectId={10}
          filter={{ period: "2026-11", machineId: 1 }}
        />
      );
    });
    expect(treeText()).toContain("历史待核实");
    expect(treeText()).toContain("金额与余额待核实");
    await click("打印当前筛选");
    expect(mock.print.mock.calls[0][0].bodyHtml).toContain("历史待核实");
    await click("导出当前筛选");
    expect(mock.csv.mock.calls[0][2][0].slice(9, 11)).toEqual([
      "历史待核实",
      "历史待核实",
    ]);
  });
  it("切栏目保留加班日期/状态；付款草稿拒绝关闭保留输入并通知宿主禁止项目切换", async () => {
    const notify = vi.fn();
    await act(async () => {
      tree = create(<Host onPaymentFormOpenChange={notify} />);
    });
    await click("司机加班");
    await act(async () =>
      tree.root
        .findByProps({ "aria-label": "加班日期" })
        .props.onChange({ target: { value: "2026-11-02" } })
    );
    await click("费用统计");
    await click("司机加班");
    expect(
      tree.root.findByProps({ "aria-label": "加班日期" }).props.value
    ).toBe("2026-11-02");
    await click("租金结算");
    await click("生成机械付款结算");
    expect(notify).toHaveBeenLastCalledWith(true);
    expect(
      tree.root.findByProps({ "aria-label": "机械工作区期间" }).props.disabled
    ).toBe(true);
    const account = tree.root
      .findAllByType("input")
      .find((n: any) => n.props.placeholder === "银行卡/对公账号/收款账号");
    await act(async () =>
      account.props.onChange({ target: { value: "草稿账户" } })
    );
    await click("取消");
    expect(window.confirm).toHaveBeenCalled();
    expect(account.props.value).toBe("草稿账户");
    expect(treeText()).toContain("生成外租机械付款结算");
  });
  it("单机日凭证、历史月结、采购与维保均真实分页且旧快照不重算", async () => {
    await act(async () => {
      tree = create(<Host />);
    });
    await click("详情");
    expect(treeText()).toContain("历史日20");
    expect(treeText()).not.toContain("历史日21");
    expect(treeText()).toContain("只读保留");
    const nav = tree.root.findByProps({ "aria-label": "单机日费用凭证分页" });
    await click("下一页", nav);
    expect(treeText()).toContain("历史日21");
    const detail = tree.root.findByProps({ "aria-label": "机械详情分区" });
    await click("维保采购", detail);
    expect(treeText()).toContain("采购配件20");
    expect(treeText()).not.toContain("采购配件21");
    expect(treeText()).toContain("维保单位20");
    expect(treeText()).not.toContain("维保单位21");
    expect(treeText()).toContain("订单关闭（非付款证明）");
    await click("结算", detail);
    expect(treeText()).toContain("历史月20");
    expect(treeText()).not.toContain("历史月21");
  });
  it("inactive仅关query enabled；只读角色不渲染机械写入口", async () => {
    mock.capability.mockReturnValue(result({}));
    await act(async () => {
      tree = create(
        <MachinePaymentSettlementManager
          projectId={10}
          active={false}
          filter={{ period: "2026-11" }}
        />
      );
    });
    for (const query of [
      mock.payments,
      mock.machines,
      mock.capability,
      mock.statements,
    ])
      expect(query.mock.calls.at(-1)![1].enabled).toBe(false);
    expect(findButton("登记付款")).toBeUndefined();
    expect(findButton("会计审核")).toBeUndefined();
    expect(findButton("提交审核")).toBeUndefined();
  });
});
