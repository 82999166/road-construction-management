import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const harness = vi.hoisted(() => {
  let cursor = 0;
  const state: unknown[] = [];
  let effects: (() => void)[] = [];
  const mutationCalls: Record<string, any[]> = {};
  const queryCalls: Record<string, any[]> = {};
  const data: Record<string, any> = {};
  return {
    data,
    mutationCalls,
    queryCalls,
    reset() {
      cursor = 0;
      state.length = 0;
      effects = [];
      Object.keys(mutationCalls).forEach(k => delete mutationCalls[k]);
      Object.keys(queryCalls).forEach(k => delete queryCalls[k]);
    },
    render<T>(fn: () => T): T {
      cursor = 0;
      return fn();
    },
    commit() {
      const list = effects;
      effects = [];
      list.forEach(f => f());
    },
    useState(initial: unknown) {
      const i = cursor++;
      if (!(i in state))
        state[i] = typeof initial === "function" ? initial() : initial;
      return [
        state[i],
        (v: unknown) => {
          state[i] = typeof v === "function" ? v(state[i]) : v;
        },
      ];
    },
    useRef(initial: unknown) {
      const i = cursor++;
      if (!(i in state)) state[i] = { current: initial };
      return state[i];
    },
    useEffect(fn: () => void) {
      effects.push(fn);
    },
    query(name: string, input: unknown, options: any) {
      (queryCalls[name] ??= []).push({ input, ...options });
      return { data: data[name], isLoading: false, isError: false };
    },
    mutation(name: string) {
      return {
        isPending: false,
        mutate: (input: unknown) => {
          (mutationCalls[name] ??= []).push(input);
        },
        mutateAsync: async (input: unknown) => {
          (mutationCalls[name] ??= []).push(input);
          return { id: 99 };
        },
      };
    },
  };
});
vi.mock("react", async original => ({
  ...(await original<typeof import("react")>()),
  useState: harness.useState,
  useRef: harness.useRef,
  useEffect: harness.useEffect,
  useMemo: (fn: () => unknown) => fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      purchasing: new Proxy(
        {},
        { get: () => ({ invalidate: async () => {} }) }
      ),
    }),
    purchasing: new Proxy(
      {},
      {
        get: (_target, name: string) => ({
          useQuery: (input: unknown, options: any) =>
            harness.query(name, input, options),
          useMutation: () => harness.mutation(name),
        }),
      }
    ),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("./FinanceWorkspaceNavigation", () => ({
  FinancePagination: (props: any) => props,
  useFinancePagination: (rows: unknown[]) => ({
    pageRows: rows.slice(0, 20),
    total: rows.length,
    page: 1,
    pageSize: 20,
    setPage: vi.fn(),
    setPageSize: vi.fn(),
  }),
}));
import {
  PurchasingWorkspace,
  type PurchasingWorkspaceProps,
} from "./PurchasingWorkspace";
import { BusinessWorkspaceNavigation } from "./BusinessWorkspaceNavigation";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { downloadCurrentFilteredCsv } from "@/lib/a4Print";
vi.mock("@/lib/a4Print", async original => ({
  ...(await original<typeof import("@/lib/a4Print")>()),
  downloadCurrentFilteredCsv: vi.fn(),
  openA4LandscapePrintDocument: vi.fn(),
}));
type Node = ReactElement<any>;
function walk(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(walk);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...walk(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "props" in value)
    return text((value as Node).props.children);
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}
const order = {
  id: 1,
  projectId: 1,
  orderNo: "PO-1",
  itemDescription: "水泥",
  amount: "100",
  status: "received",
  paidAmount: 20,
  remainingAmount: 80,
  receiptStatus: "received",
  receivedQuantity: 10,
  receiptExpectedQuantity: "10",
  inventoryItemName: "水泥",
  inventoryUnit: "袋",
  quantity: "10",
  unitPrice: "10",
  orderedAt: new Date(),
  procurementMode: "imported",
  purchaserName: "张三",
  createdByName: "李四",
  categoryName: "材料",
  documentAttachment: null,
  invoiceAttachment: null,
};
let props: PurchasingWorkspaceProps = {
  projectId: 1,
  projectName: "项目A",
  active: true,
  isSuperAdmin: false,
};
const render = () => harness.render(() => PurchasingWorkspace(props));
function tab(tree: Node, value: string) {
  const nav = walk(tree).find(n => n.type === BusinessWorkspaceNavigation);
  nav!.props.onValueChange(value);
}
function click(tree: Node, label: string) {
  const button = walk(tree).find(
    n => n.type === Button && text(n.props.children) === label
  );
  expect(button, label).toBeTruthy();
  button!.props.onClick();
}
function fill(tree: Node, label: string, value: string) {
  const input = walk(tree).find(
    n =>
      (n.type === Input || n.type === "select") &&
      n.props["aria-label"] === label
  );
  expect(input, label).toBeTruthy();
  input!.props.onChange({ target: { value } });
}
beforeEach(() => {
  harness.reset();
  props = {
    projectId: 1,
    projectName: "项目A",
    active: true,
    isSuperAdmin: false,
  };
  Object.assign(harness.data, {
    capabilities: {
      canApprove: true,
      canManageInventory: true,
      canRecordPayment: true,
    },
    categories: [],
    listOrders: [order],
    listRequests: [],
    listInventory: { transactions: [], balances: [] },
    listSettlements: { records: [], totalsByOrder: {} },
    listSuppliers: [{ id: 1, name: "正确供应商", status: "active" }],
    listPurchaseEvidences: [],
  });
  vi.clearAllMocks();
  vi.stubGlobal("window", {
    confirm: () => true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    location: { assign: vi.fn() },
  });
});
describe("采购六栏目组件真实事件行为（不浏览器、不实际DB）", () => {
  it("Tab按需加载，供应商权限不以其他列表代替", () => {
    let tree = render();
    tab(tree, "inventory");
    tree = render();
    expect(harness.queryCalls.listInventory.at(-1).enabled).toBe(true);
    expect(harness.queryCalls.listRequests.at(-1).enabled).toBe(false);
    expect(harness.queryCalls.listSettlements.at(-1).enabled).toBe(false);
    tab(tree, "suppliers");
    tree = render();
    expect(harness.queryCalls.listSuppliers.at(-1).enabled).toBe(false);
    expect(text(tree)).toContain("仅限超级管理员");
    props.isSuperAdmin = true;
    tree = render();
    expect(harness.queryCalls.listSuppliers.at(-1).enabled).toBe(true);
    click(tree, "导出全部筛选");
    expect(downloadCurrentFilteredCsv).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["供应商名称"]),
      expect.arrayContaining([expect.arrayContaining(["正确供应商"])])
    );
  });
  it("订单收货不当付款：余额非零隐藏可用关闭且付款复用原recordSettlement", () => {
    let tree = render();
    tab(tree, "orders");
    tree = render();
    const close = walk(tree).find(
      n => n.type === Button && text(n.props.children) === "余额为零后关闭"
    );
    expect(close?.props.disabled).toBe(true);
    click(tree, "登记实际付款");
    tree = render();
    fill(tree, "本次实际付款金额", "30");
    tree = render();
    click(tree, "保存并完成业务绑定");
    expect(harness.mutationCalls.recordSettlement).toHaveLength(1);
    expect(harness.mutationCalls.recordSettlement[0]).toMatchObject({
      projectId: 1,
      orderId: 1,
      amount: 30,
    });
    expect(harness.mutationCalls.saveInventoryTransaction).toBeUndefined();
  });
  it("切栏目保留未保存表单；切项目阻断原草稿误写", () => {
    let tree = render();
    tab(tree, "orders");
    tree = render();
    click(tree, "新建采购申请");
    tree = render();
    fill(tree, "采购说明", "草稿材料申请");
    tree = render();
    tab(tree, "inventory");
    tree = render();
    expect(
      walk(tree).find(
        n => n.type === Input && n.props["aria-label"] === "采购说明"
      )?.props.value
    ).toBe("草稿材料申请");
    props.projectId = 2;
    props.projectName = "项目B";
    tree = render();
    expect(text(tree)).toContain("此表单属于项目 #1");
    const submit = walk(tree).find(
      n => n.type === Button && text(n.props.children) === "保存并完成业务绑定"
    );
    expect(submit?.props.disabled).toBe(true);
    submit!.props.onClick();
    expect(harness.mutationCalls.saveRequest).toBeUndefined();
  });
  it("票据补传必须绑定原订单、保留原因，不另建采购记录", () => {
    let tree = render();
    tab(tree, "orders");
    tree = render();
    click(tree, "上传绑定发票");
    tree = render();
    fill(tree, "已有采购归档附件（服务端校验类型和项目）", "99");
    tree = render();
    fill(tree, "依据/补传原因（至少5字）", "历史发票原件补传");
    tree = render();
    click(tree, "保存并完成业务绑定");
    expect(harness.mutationCalls.bindOrderEvidence[0]).toMatchObject({
      orderId: 1,
      projectId: 1,
      evidenceId: 99,
      attachmentKind: "invoice",
      reason: "历史发票原件补传",
    });
    expect(harness.mutationCalls.createOrder).toBeUndefined();
  });
  it("关闭工作区不请求业务数据", () => {
    props.active = false;
    render();
    for (const calls of Object.values(harness.queryCalls))
      expect(calls.at(-1).enabled).toBe(false);
  });
  it("供应商编辑回填全部原字段，启停复用saveSupplier且非super无维护入口", () => {
    harness.data.listSuppliers = [
      {
        id: 8,
        organizationId: 4,
        name: "原供应商",
        unifiedSocialCreditCode: "91440000",
        contactName: "张工",
        contactPhoneMasked: "***1234",
        status: "active",
      },
    ];
    props.isSuperAdmin = true;
    let tree = render();
    tab(tree, "suppliers");
    tree = render();
    click(tree, "编辑供应商 / 启停维护");
    tree = render();
    expect(
      walk(tree).find(n => n.props["aria-label"] === "统一社会信用代码")?.props
        .value
    ).toBe("91440000");
    fill(tree, "供应商档案状态", "disabled");
    tree = render();
    click(tree, "保存并完成业务绑定");
    expect(harness.mutationCalls.saveSupplier[0]).toEqual({
      id: 8,
      organizationId: 4,
      name: "原供应商",
      unifiedSocialCreditCode: "91440000",
      contactName: "张工",
      contactPhoneMasked: "***1234",
      status: "disabled",
    });
    props.isSuperAdmin = false;
    tree = render();
    click(tree, "保存并完成业务绑定");
    expect(harness.mutationCalls.saveSupplier).toHaveLength(1);
  });
  it("旧退回申请编辑复用原ID，不是新申请；重转草稿和已入库关闭入口保留", () => {
    harness.data.listRequests = [
      {
        id: 11,
        requestNo: "PR-11",
        projectId: 1,
        categoryId: 2,
        description: "旧申请说明",
        amount: "50",
        status: "rejected",
        createdAt: new Date(),
      },
      {
        id: 12,
        requestNo: "PR-12",
        projectId: 1,
        categoryId: 2,
        description: "已入库申请",
        amount: "50",
        status: "stocked",
        createdAt: new Date(),
      },
    ];
    let tree = render();
    tab(tree, "orders");
    tree = render();
    click(tree, "退回申请转草稿");
    expect(harness.mutationCalls.transitionRequest[0]).toMatchObject({
      id: 11,
      targetStatus: "draft",
      projectId: 1,
    });
    click(tree, "关闭原申请");
    expect(harness.mutationCalls.transitionRequest[1]).toMatchObject({
      id: 12,
      targetStatus: "closed",
    });
    click(tree, "编辑原申请");
    tree = render();
    fill(tree, "采购说明", "原ID修改说明");
    tree = render();
    click(tree, "保存并完成业务绑定");
    expect(harness.mutationCalls.saveRequest[0]).toEqual({
      id: 11,
      projectId: 1,
      categoryId: 2,
      amount: 50,
      description: "原ID修改说明",
    });
  });
  it("新订单登记独立实物依据，切Tab保留并继续调用configureReceiptBasis", () => {
    harness.data.listOrders = [
      {
        ...order,
        status: "confirmed",
        receivedQuantity: 0,
        receiptExpectedQuantity: null,
        inventoryItemName: null,
        inventoryUnit: null,
      },
    ];
    let tree = render();
    tab(tree, "orders");
    tree = render();
    click(tree, "登记实物验收依据");
    tree = render();
    fill(tree, "物料名称", "水泥");
    tree = render();
    fill(tree, "计量单位", "袋");
    tree = render();
    fill(tree, "订单允许验收总数量", "20");
    tree = render();
    fill(tree, "依据/补传原因（至少5字）", "按现场实物验收清单");
    tree = render();
    tab(tree, "inventory");
    tree = render();
    click(tree, "保存并完成业务绑定");
    expect(harness.mutationCalls.configureReceiptBasis[0]).toEqual({
      projectId: 1,
      orderId: 1,
      itemName: "水泥",
      unit: "袋",
      expectedQuantity: 20,
      reason: "按现场实物验收清单",
    });
  });
  it("上传PDF后必须显式保存绑定原订单，同项目类型过滤不混用原件", async () => {
    harness.data.listPurchaseEvidences = [
      { id: 1, attachmentKind: "document", fileName: "原采购单" },
      { id: 2, attachmentKind: "invoice", fileName: "发票原件" },
    ];
    vi.stubGlobal(
      "FileReader",
      class {
        result = "data:application/pdf;base64,JVBERi0=";
        onload?: () => void;
        readAsDataURL() {
          this.onload?.();
        }
      }
    );
    let tree = render();
    tab(tree, "orders");
    tree = render();
    click(tree, "上传绑定发票");
    tree = render();
    const select = walk(tree).find(
      n => n.props["aria-label"] === "已有采购归档附件（服务端校验类型和项目）"
    );
    expect(text(select)).toContain("发票原件");
    expect(text(select)).not.toContain("原采购单");
    const fileInput = walk(tree).find(
      n => n.props["aria-label"] === "采购附件上传"
    );
    fileInput!.props.onChange({
      target: {
        files: [{ name: "invoice.pdf", type: "application/pdf", size: 100 }],
      },
      currentTarget: { value: "" },
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(harness.mutationCalls.uploadPurchaseDocument[0]).toMatchObject({
      projectId: 1,
      attachmentKind: "invoice",
      fileName: "invoice.pdf",
    });
    expect(harness.mutationCalls.bindOrderEvidence).toBeUndefined();
    tree = render();
    fill(tree, "依据/补传原因（至少5字）", "纸质原发票PDF补传");
    tree = render();
    click(tree, "保存并完成业务绑定");
    expect(harness.mutationCalls.bindOrderEvidence[0]).toMatchObject({
      projectId: 1,
      orderId: 1,
      evidenceId: 99,
      attachmentKind: "invoice",
    });
    expect(harness.mutationCalls.createOrder).toBeUndefined();
  });
  it.each([
    ["orders", "新建采购申请", "采购类别", "2"],
    ["orders", "登记实际付款", "备注", "付款说明"],
    ["orders", "补传原采购证据", "依据/补传原因（至少5字）", "原件补传原因"],
    ["orders", "从申请创建订单", "下单时间", "2026-11-05T12:00"],
    ["orders", "登记实物验收依据", "订单允许验收总数量", "30"],
    ["orders", "上传绑定发票", "依据/补传原因（至少5字）", "补传原因五字"],
    ["inventory", "登记领用出库", "计量单位", "吨"],
    ["inventory", "登记入库", "入库记账单价", "12"],
    ["inventory", "引用原领用退库", "原领用流水（必须同物料同单位）", "4"],
    ["suppliers", "新增供应商", "联系电话", "13800138000"],
  ])(
    "%s表单%s任一字段更改均通知父dirty并跨项目禁止提交",
    (section, entry, fieldName, value) => {
      props.isSuperAdmin = true;
      const onDirtyChange = vi.fn();
      props.onDirtyChange = onDirtyChange;
      if (entry === "从申请创建订单")
        harness.data.listRequests = [
          {
            id: 11,
            requestNo: "PR-11",
            projectId: 1,
            categoryId: 2,
            description: "已批准申请",
            amount: "50",
            status: "approved",
            createdAt: new Date(),
          },
        ];
      if (entry === "登记实物验收依据")
        harness.data.listOrders = [
          { ...order, status: "confirmed", receivedQuantity: 0 },
        ];
      let tree = render();
      tab(tree, section);
      tree = render();
      click(tree, entry);
      tree = render();
      fill(tree, fieldName, value);
      tree = render();
      harness.commit();
      expect(onDirtyChange).toHaveBeenCalledWith(true);
      props.projectId = 2;
      tree = render();
      const save = walk(tree).find(
        n =>
          n.type === Button && text(n.props.children) === "保存并完成业务绑定"
      );
      expect(save?.props.disabled).toBe(true);
      save!.props.onClick();
      for (const name of [
        "saveRequest",
        "createOrder",
        "configureReceiptBasis",
        "saveInventoryTransaction",
        "saveSupplier",
        "recordSettlement",
        "bindOrderEvidence",
      ])
        expect(harness.mutationCalls[name]).toBeUndefined();
    }
  );
  it("放弃确认被拒绝时点击其他行入口不覆盖当前草稿", () => {
    vi.stubGlobal("window", {
      confirm: () => false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    let tree = render();
    tab(tree, "orders");
    tree = render();
    click(tree, "新建采购申请");
    tree = render();
    fill(tree, "采购说明", "必须保留此草稿");
    tree = render();
    click(tree, "上传绑定发票");
    tree = render();
    expect(
      walk(tree).find(n => n.props["aria-label"] === "采购说明")?.props.value
    ).toBe("必须保留此草稿");
    expect(text(tree)).not.toContain("上传并绑定发票");
  });
});
