import React from "react";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { create, act } = createRequire(import.meta.url)("react-test-renderer");
const mock = vi.hoisted(() => ({
  save: vi.fn(),
  invalidate: vi.fn(),
  print: vi.fn(),
  csv: vi.fn(),
  error: vi.fn(),
  list: vi.fn(),
  records: vi.fn(),
  finance: vi.fn(),
}));
const utils = {
  admin: { vehicle: { list: { invalidate: mock.invalidate } } },
  vehicleManagement: { invalidate: mock.invalidate },
  transport: { listVehicleSummaries: { invalidate: mock.invalidate } },
};
vi.mock("@/lib/trpc", () => ({
  trpc: {
    admin: {
      vehicle: {
        save: {
          useMutation: () => ({ mutateAsync: mock.save, isPending: false }),
        },
      },
    },
    vehicleManagement: {
      list: { useQuery: mock.list },
      records: { useQuery: mock.records },
    },
    transport: { listVehicleSummaries: { useQuery: mock.finance } },
    useUtils: () => utils,
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: mock.error } }));
vi.mock("@/components/PersonnelResourceSelect", () => ({
  PersonnelResourceSelect: () => <span>受控人员选择</span>,
}));
// 只替代依赖 DOM 的弹窗 primitive 和浏览器输出边界，表单、校验、分页和报告均为真实实现。
vi.mock("@/components/ui/dialog", () => {
  const Block = ({ children }: any) => <div>{children}</div>;
  return {
    useDialogComposition: () => ({
      isComposing: () => false,
      justEndedComposing: () => false,
      markCompositionEnd: () => {},
      setComposing: () => {},
    }),
    Dialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
    DialogContent: Block,
    DialogHeader: Block,
    DialogTitle: Block,
    DialogDescription: Block,
    DialogFooter: Block,
  };
});
vi.mock("@/lib/a4Print", async original => ({
  ...(await original<typeof import("@/lib/a4Print")>()),
  downloadCurrentFilteredCsv: mock.csv,
  openA4PrintDocument: mock.print,
}));
import { VehicleRegistryForm } from "@/components/VehicleManagementForms";
import { VehicleManagementReport } from "@/components/VehicleManagementReport";
import { buildVehicleReport } from "@/lib/vehicleManagementWorkspace";
import VehicleManagementWorkspace from "@/components/VehicleManagementWorkspace";
const readSource = (url: URL) => readFileSync(url, "utf8").replace(/\s+/g, " ");
const projects = [{ id: 2, name: "授权项目" }];
let tree: any;
const text = (node: any): string =>
  typeof node === "string" ? node : (node.children ?? []).map(text).join("");
const button = (label: string) =>
  tree.root.findAllByType("button").find((node: any) => text(node) === label);
const change = async (label: string, value: string) =>
  act(async () =>
    tree.root
      .findAll((node: any) => node.type === "input" || node.type === "select")
      .find((node: any) => node.props["aria-label"] === label)
      .props.onChange({ target: { value } })
  );
beforeEach(() => {
  vi.clearAllMocks();
  mock.save.mockResolvedValue({ vehicleId: 7 });
  mock.invalidate.mockResolvedValue(undefined);
  mock.list.mockReturnValue({ data: { items: [] }, isLoading: false });
  mock.records.mockReturnValue({ data: {}, isLoading: false });
  mock.finance.mockReturnValue({ data: [], isLoading: false });
  vi.stubGlobal("React", React);
  vi.stubGlobal("window", {
    confirm: vi.fn(() => false),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});

describe("渣土车按趟结算车辆档案", () => {
  it("PC独立表单和移动端保留按趟兼容入口，独立结算方式与原日期口径仍可用", () => {
    const adminPage = readSource(new URL("./AdminPage.tsx", import.meta.url));
    const forms = readSource(
      new URL("../components/VehicleManagementForms.tsx", import.meta.url)
    );
    const lifecycle = readSource(
      new URL(
        "../components/VehicleManagementFormsLifecycle.tsx",
        import.meta.url
      )
    );
    const mobilePage = readSource(
      new URL("./MobileTransportPage.tsx", import.meta.url)
    );
    const settlementManager = readSource(
      new URL(
        "../components/TransportVehicleSettlementManager.tsx",
        import.meta.url
      )
    );
    expect(adminPage.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain("<VehicleManagementWorkspace".replace(/\s+/g, "").replace(/,([})\]])/g, "$1"));
    expect(forms.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain('["trip_settlement", "旧按趟结算"]'.replace(/\s+/g, "").replace(/,([})\]])/g, "$1"));
    expect(forms.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain('label="所属人 / 出租方"'.replace(/\s+/g, "").replace(/,([})\]])/g, "$1"));
    expect(lifecycle.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain('["trip", "按趟"]'.replace(/\s+/g, "").replace(/,([})\]])/g, "$1"));
    expect(lifecycle.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'settlementMode: requireVehicleChoice(form.settlementMode, ["monthly", "daily", "hourly", "shift", "trip", "ton", "volume", "none"]'.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(mobilePage.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain('ownership: "trip_settlement"'.replace(/\s+/g, "").replace(/,([})\]])/g, "$1"));
    expect(mobilePage.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "按趟结算渣土车不建立租赁日期、租金或租赁成本".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(settlementManager.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'import { formatChinaDate, toChinaDateInput } from "@/lib/businessTime"'.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(settlementManager.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "const today = () => toChinaDateInput()".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(settlementManager.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).not.toContain(
      "new Date().toISOString().slice(0, 10)".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
  });

  it.each(["pickup", "suv"])(
    "真实新表单可保存%s且不强制虚填货厢，按趟不会提交租赁资料",
    async type => {
      const onSaved = vi.fn();
      await act(async () => {
        tree = create(
          <VehicleRegistryForm
            projectId={2}
            projects={projects}
            organizations={[]}
            onClose={vi.fn()}
            onSaved={onSaved}
          />
        );
      });
      const choices = tree.root
        .findByProps({ "aria-label": "车型" })
        .findAllByType("option")
        .map((node: any) => [node.props.value, text(node)]);
      expect(choices).toContainEqual(["pickup", "皮卡"]);
      expect(choices).toContainEqual(["suv", "越野车"]);
      await change("车型", type);
      await change("兼容资源性质", "trip_settlement");
      await change("车牌号", "湘a12345");
      expect(
        tree.root.findAllByProps({ "aria-label": "货厢长（米）" })
      ).toHaveLength(0);
      expect(
        tree.root.findAllByProps({ "aria-label": "租金单价（元）" })
      ).toHaveLength(0);
      expect(
        tree.root.findAllByProps({ "aria-label": "合同起租日期" })
      ).toHaveLength(0);
      await act(async () =>
        tree.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() })
      );
      expect(mock.error).not.toHaveBeenCalled();
      expect(mock.save).toHaveBeenCalledTimes(1);
      expect(mock.save.mock.calls[0][0]).toMatchObject({
        projectId: 2,
        plateNo: "湘A12345",
        vehicleType: type,
        ownership: "trip_settlement",
        leaseTerms: null,
        boxLengthMeters: 0,
        boxWidthMeters: 0,
        boxHeightMeters: 0,
      });
      expect(mock.invalidate).toHaveBeenCalledTimes(1);
      expect(onSaved).toHaveBeenCalledWith(7);
    }
  );

  it("切换租入后保留合同单价与起止日期，切回按趟不泄漏租赁金额", async () => {
    await act(async () => {
      tree = create(
        <VehicleRegistryForm
          projectId={2}
          projects={projects}
          organizations={[]}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );
    });
    await change("车型", "pickup");
    await change("车牌号", "湘A12345");
    await change("兼容资源性质", "leased");
    await change("所属人 / 出租方", "出租单位");
    await change("租金单价（元）", "300");
    await change("合同起租日期", "2026-08-01");
    await change("合同截止日期", "2026-08-02");
    await act(async () =>
      tree.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() })
    );
    expect(mock.save.mock.calls[0][0].leaseTerms).toEqual({
      billingType: "daily",
      rate: 300,
      effectiveFrom: "2026-08-01",
      effectiveTo: "2026-08-02",
    });
    await change("兼容资源性质", "trip_settlement");
    await act(async () =>
      tree.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() })
    );
    expect(mock.save.mock.calls[1][0].leaseTerms).toBeNull();
    expect(mock.error).not.toHaveBeenCalled();
  });

  it("真实报表分页仅影响屏幕，导出、预览与横向A4打印包含全部筛选记录", async () => {
    const report = {
      title: "车辆筛选台账",
      scope: "授权项目 · 仅启用皮卡",
      headers: ["车牌", "真实费用"],
      rows: Array.from({ length: 55 }, (_, i) => [
        `湘A${String(i).padStart(5, "0")}`,
        i + 0.25,
      ]),
    };
    const actions = vi.fn((index: number) => (
      <button data-row={index}>详情</button>
    ));
    await act(async () => {
      tree = create(
        <VehicleManagementReport report={report} actions={actions} />
      );
    });
    expect(
      tree.root.findAllByType("tbody")[0].findAllByType("tr")
    ).toHaveLength(20);
    expect(actions.mock.calls[0]).toEqual([0]);
    actions.mockClear();
    await act(async () => button("下一页").props.onClick());
    expect(actions.mock.calls[0]).toEqual([20]);
    expect(
      tree.root.findAllByType("tbody")[0].findAllByType("tr")
    ).toHaveLength(20);
    await act(async () => button("导出全部筛选").props.onClick());
    expect(mock.csv).toHaveBeenCalledWith(
      "车辆筛选台账.csv",
      report.headers,
      report.rows
    );
    await act(async () => button("筛选打印预览").props.onClick());
    const preview = tree.root.find((node: any) =>
      Boolean(node.props.dangerouslySetInnerHTML)
    );
    expect(preview.props.dangerouslySetInnerHTML.__html).toBe(
      buildVehicleReport(report)
    );
    expect(preview.props.dangerouslySetInnerHTML.__html).toContain("湘A00054");
    expect(preview.props.dangerouslySetInnerHTML.__html).toContain(
      "全部筛选结果 55 条"
    );
    await act(async () => button("打印全部筛选").props.onClick());
    expect(mock.print).toHaveBeenCalledWith({
      title: report.title,
      bodyHtml: buildVehicleReport(report),
      orientation: "landscape",
    });
    expect(actions.mock.calls[0]).toEqual([20]);
  });

  it("真实车辆工作区同一新建请求不重复重置草稿，拒绝项目切换或关闭时保留输入，卸载解除父锁", async () => {
    const onDirtyChange = vi.fn(),
      organizations: [] = [],
      request = { projectId: 2, requestId: 1 };
    const props = {
      projects: [...projects, { id: 3, name: "另一授权项目" }],
      organizations,
      createRequest: request,
      onDirtyChange,
    };
    await act(async () => {
      tree = create(<VehicleManagementWorkspace {...props} />);
    });
    expect(onDirtyChange.mock.calls.at(-1)).toEqual([true]);
    await change("车牌号", "湘A草稿");
    const count = onDirtyChange.mock.calls.length;
    await act(async () =>
      tree.update(
        <VehicleManagementWorkspace {...props} createRequest={{ ...request }} />
      )
    );
    expect(onDirtyChange).toHaveBeenCalledTimes(count);
    expect(
      tree.root
        .findAllByType("input")
        .find((node: any) => node.props["aria-label"] === "车牌号").props.value
    ).toBe("湘A草稿");
    expect(
      tree.root.findByProps({ "aria-label": "车辆项目范围" }).props.value
    ).toBe("2");
    await change("车辆项目范围", "3");
    expect(
      tree.root.findByProps({ "aria-label": "车辆项目范围" }).props.value
    ).toBe("2");
    await act(async () => button("取消").props.onClick());
    expect(tree.root.findAllByType("form")).toHaveLength(1);
    expect(mock.save).not.toHaveBeenCalled();
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("此操作不是保存")
    );
    const registered = vi
      .mocked(window.addEventListener)
      .mock.calls.find(call => call[0] === "beforeunload");
    expect(registered).toBeDefined();
    const event = { preventDefault: vi.fn(), returnValue: undefined };
    (registered?.[1] as (event: any) => void)(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.returnValue).toBe("");
    vi.mocked(window.confirm).mockReturnValue(true);
    await act(async () => button("取消").props.onClick());
    expect(tree.root.findAllByType("form")).toHaveLength(0);
    expect(onDirtyChange.mock.calls.at(-1)).toEqual([false]);
    expect(mock.save).not.toHaveBeenCalled();
    onDirtyChange.mockClear();
    await act(async () =>
      tree.update(
        <VehicleManagementWorkspace {...props} createRequest={{ ...request }} />
      )
    );
    expect(tree.root.findAllByType("form")).toHaveLength(0);
    expect(onDirtyChange).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
    tree = undefined;
    expect(onDirtyChange.mock.calls).toEqual([[false]]);
    expect(window.removeEventListener).toHaveBeenCalledWith(
      "beforeunload",
      registered?.[1]
    );
  });
});
