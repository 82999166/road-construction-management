import React, { type HTMLAttributes, type ReactNode } from "react";
import { createRequire } from "node:module";
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VehicleSettlementSelectionProps } from "./VehicleSettlementSelection";
import type {
  VehicleSettlementPreview,
  VehicleSettlementMode,
} from "@/lib/vehicleSettlementSelection";

const { create, act } = createRequire(import.meta.url)(
  "react-test-renderer"
) as typeof import("react-test-renderer");
type PreviewInput = {
  projectId: number;
  vehicleId: number;
  periodStart: string;
  periodEnd: string;
  selectionMode: VehicleSettlementMode;
  tripCount?: number;
};
type CreateInput = Omit<PreviewInput, "selectionMode"> & {
  selectionMode?: VehicleSettlementMode;
  tripIds?: number[];
  payeeName: string;
  payeeAccount: string | null;
  paymentMethod: string;
  remarks: string | null;
  legacyTripIds: number[];
  legacyConfirmation?: string;
};
type CreateOptions = {
  onSuccess: (data: { settlementNo: string }) => Promise<void>;
  onError: (error: Error) => void;
};
type SettlementFixture = {
  id: number;
  vehicleId: number;
  settlementNo: string;
  periodStart: string;
  periodEnd: string;
  tripCount: number;
  grossFreightAmount: number;
  fuelDeductionAmount: number;
  assetDeductionAmount: number;
  carryForwardDeductionAmount: number;
  netPayableAmount: number;
  actualPaidAmount: number;
  actualReceivedAmount: number;
  remainingAmount: number;
  status: string;
  payeeName: string;
  payeeAccount: string;
  paymentMethod: string;
  paymentDate: null;
  vehicle: { plateNo: string };
};
const mocks = vi.hoisted(() => ({
  preview: undefined as VehicleSettlementPreview | undefined,
  fetching: false,
  previewError: null as Error | null,
  holdCreate: false,
  createOptions: undefined as CreateOptions | undefined,
  settlements: [] as SettlementFixture[],
  previewQuery:
    vi.fn<
      (
        input: PreviewInput,
        options: { enabled: boolean; retry: boolean }
      ) => void
    >(),
  dailyQuery: vi.fn(),
  settlementsQuery: vi.fn(),
  create: vi.fn<(input: CreateInput) => void>(),
  transition: vi.fn(),
  notify: vi.fn(),
  refetch: vi.fn(),
  confirm: vi.fn<(message: string) => boolean>(),
  success: vi.fn(),
  error: vi.fn(),
  invalidatePreview: vi.fn(),
  invalidateLedger: vi.fn(),
  invalidateTrips: vi.fn(),
  invalidateDaily: vi.fn(),
  invalidateSettlements: vi.fn(),
}));

// Only external hooks and DOM primitives are replaced; the Manager, form state,
// focus effects, permissions, dirty tracking, filters and request construction run for real.
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      transport: {
        previewVehicleSettlementSelection: {
          invalidate: mocks.invalidatePreview,
        },
        listTripLedger: { invalidate: mocks.invalidateLedger },
        listTrips: { invalidate: mocks.invalidateTrips },
        dailyVehicleSettlementSummary: { invalidate: mocks.invalidateDaily },
        listVehicleSettlements: { invalidate: mocks.invalidateSettlements },
      },
    }),
    transport: {
      dailyVehicleSettlementSummary: {
        useQuery: (...args: unknown[]) => {
          mocks.dailyQuery(...args);
          return { data: { vehicleSummaries: [] }, isLoading: false };
        },
      },
      listVehicleSettlements: {
        useQuery: (...args: unknown[]) => {
          mocks.settlementsQuery(...args);
          return { data: mocks.settlements, isLoading: false };
        },
      },
      previewVehicleSettlementSelection: {
        useQuery: (
          input: PreviewInput,
          options: { enabled: boolean; retry: boolean }
        ) => {
          mocks.previewQuery(input, options);
          return {
            data: mocks.preview,
            isFetching: mocks.fetching,
            isError: !!mocks.previewError,
            error: mocks.previewError,
            refetch: mocks.refetch,
          };
        },
      },
      createVehicleSettlement: {
        useMutation: (options: CreateOptions) => {
          const [isPending, setPending] = React.useState(false);
          mocks.createOptions = options;
          return {
            isPending,
            mutate: (input: CreateInput) => {
              mocks.create(input);
              if (mocks.holdCreate) setPending(true);
            },
          };
        },
      },
      transitionVehicleSettlement: {
        useMutation: () => ({ mutate: mocks.transition, isPending: false }),
      },
      sendDailyVehicleSettlementSummary: {
        useMutation: () => ({ mutate: mocks.notify, isPending: false }),
      },
    },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("@/components/ui/button", () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));
vi.mock("@/components/ui/label", () => ({
  Label: (props: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props} />
  ),
}));
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui/card", () => {
  const Block = (props: HTMLAttributes<HTMLDivElement>) => <div {...props} />;
  return {
    Card: Block,
    CardContent: Block,
    CardDescription: Block,
    CardHeader: Block,
    CardTitle: Block,
  };
});
vi.mock("@/components/ui/table", () => {
  const Block = (props: HTMLAttributes<HTMLDivElement>) => <div {...props} />;
  return {
    Table: Block,
    TableBody: Block,
    TableCell: Block,
    TableHead: Block,
    TableHeader: Block,
    TableRow: Block,
  };
});
vi.mock("@/components/ui/dialog", () => {
  const Block = (props: HTMLAttributes<HTMLDivElement>) => <div {...props} />;
  return {
    // DialogCompositionContext is the project's actual input/IME context boundary.
    useDialogComposition: () => ({
      isComposing: () => false,
      justEndedComposing: () => false,
      setComposing: () => {},
      markCompositionEnd: () => {},
    }),
    Dialog: ({
      open,
      children,
      onOpenChange,
    }: {
      open: boolean;
      children?: ReactNode;
      onOpenChange: (open: boolean) => void;
    }) =>
      open ? (
        <div data-test="create-dialog" onClick={() => onOpenChange(false)}>
          {children}
        </div>
      ) : null,
    DialogContent: Block,
    DialogDescription: Block,
    DialogFooter: Block,
    DialogHeader: Block,
    DialogTitle: Block,
  };
});
vi.mock("@/components/ui/select", () => {
  type Props = {
    value?: string;
    disabled?: boolean;
    children?: ReactNode;
    onValueChange?: (value: string) => void;
  };
  const Block = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Select: ({ value, disabled, children, onValueChange }: Props) => (
      <select
        data-test="primitive-select"
        value={value}
        disabled={disabled}
        onChange={event => onValueChange?.(event.target.value)}
      >
        {children}
      </select>
    ),
    SelectContent: Block,
    SelectTrigger: Block,
    SelectValue: () => null,
    SelectItem: ({
      value,
      children,
    }: {
      value: string;
      children?: ReactNode;
    }) => <option value={value}>{children}</option>,
  };
});
vi.mock("@/components/VehicleSettlementSelection", () => ({
  default: function SelectionBoundary(props: VehicleSettlementSelectionProps) {
    return <section data-test="selection-boundary" data-mode={props.mode} />;
  },
}));
vi.mock("@/components/SettlementPaymentDialog", () => ({
  SettlementPaymentDialog: function PaymentBoundary() {
    return <section data-test="payment-boundary" />;
  },
}));
vi.mock("@/components/VehicleSettlementProfileDialog", () => ({
  VehicleSettlementProfileDialog: () => null,
}));
vi.mock("@/components/CurrentFilterPrintActions", () => ({
  CurrentFilterPrintActions: () => null,
}));

import Manager from "./TransportVehicleSettlementManager";
import SelectionBoundary from "./VehicleSettlementSelection";
import { SettlementPaymentDialog } from "./SettlementPaymentDialog";

type ManagerProps = React.ComponentProps<typeof Manager>;
type PaymentProps = React.ComponentProps<typeof SettlementPaymentDialog>;
const vehicles: ManagerProps["vehicles"] = [
  {
    id: 7,
    plateNo: "湘A00007",
    ownership: "trip_settlement",
    ownerName: "车主甲",
  },
  {
    id: 8,
    plateNo: "湘A00008",
    profile: { settlementMode: "trip" },
    driverName: "司机乙",
  },
];
const focus = { id: 1, vehicleId: 7, date: "2026-11-04", requestId: 1 };
const account = "6222021234567890123";
let tree: ReactTestRenderer | undefined;
let mountedProps: ManagerProps;
const root = () => {
  if (!tree) throw new Error("Manager must be rendered first");
  return tree.root;
};
const text = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(text).join("");
const button = (label: string) =>
  root()
    .findAllByType("button")
    .find(node => text(node) === label) ??
  (() => {
    throw new Error(`Missing button: ${label}`);
  })();
const selection = (): VehicleSettlementSelectionProps =>
  root().findByType(SelectionBoundary).props as VehicleSettlementSelectionProps;
const payment = (): PaymentProps =>
  root().findByType(SettlementPaymentDialog).props as PaymentProps;
const dialogs = () => root().findAllByProps({ "data-test": "create-dialog" });
const previewRequest = () => {
  const last = mocks.previewQuery.mock.calls.at(-1);
  if (!last) throw new Error("Missing preview query");
  return last;
};
// A disabled HTML control does not dispatch its click handler in the browser.
const click = async (label: string) => {
  const control = button(label);
  const props = control.props as React.ButtonHTMLAttributes<HTMLButtonElement>;
  await act(async () => {
    if (!props.disabled)
      props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
  });
};
const change = async (placeholder: string, value: string) => {
  const input = root()
    .findAllByType("input")
    .find(node => node.props.placeholder === placeholder);
  if (!input) throw new Error(`Missing input: ${placeholder}`);
  const props = input.props as React.InputHTMLAttributes<HTMLInputElement>;
  await act(async () => {
    props.onChange?.({
      target: { value },
    } as React.ChangeEvent<HTMLInputElement>);
  });
};
const payee = () => change("银行卡/对公账号/收款账号", account);
const render = async (props: Partial<ManagerProps> = {}) => {
  mountedProps = { projectId: 42, vehicles, focusTrip: focus, ...props };
  await act(async () => {
    tree = create(<Manager {...mountedProps} />);
  });
};
const rerender = async (props: Partial<ManagerProps> = {}) => {
  mountedProps = { ...mountedProps, ...props };
  await act(async () => tree?.update(<Manager {...mountedProps} />));
};
function preview(
  ids: number[] = [1, 2],
  mode: VehicleSettlementMode = "day",
  dates: string[] = [focus.date]
): VehicleSettlementPreview {
  const rows = ids.map((id, index) => ({
    id,
    tripNo: `TRIP-${id}`,
    startAt: `${dates[index % dates.length]}T08:00:00+08:00`,
    quantity: 1,
    unitPrice: 100,
    grossAmount: 100,
  }));
  return {
    tripIds: ids,
    rows,
    availableCount: ids.length,
    selectedCount: ids.length,
    grossFreightAmount: rows.reduce((sum, row) => sum + row.grossAmount, 0),
    eligible: ids.length > 0,
    reason: null,
    selectionMode: mode,
    dailyGroups: dates.map(date => {
      const count = rows.filter(row => row.startAt.startsWith(date)).length;
      return { date, tripCount: count, grossFreightAmount: count * 100 };
    }),
  };
}
const assertNoWrites = () => {
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.transition).not.toHaveBeenCalled();
  expect(mocks.notify).not.toHaveBeenCalled();
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.preview = preview();
  mocks.fetching = false;
  mocks.previewError = null;
  mocks.holdCreate = false;
  mocks.createOptions = undefined;
  mocks.settlements = [];
  mocks.confirm.mockReturnValue(false);
  for (const invalidate of [
    mocks.invalidatePreview,
    mocks.invalidateLedger,
    mocks.invalidateTrips,
    mocks.invalidateDaily,
    mocks.invalidateSettlements,
  ])
    invalidate.mockResolvedValue(undefined);
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { confirm: mocks.confirm });
});
afterEach(async () => {
  if (tree) await act(async () => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});

describe("TransportVehicleSettlementManager 合并结算真实行为（无数据库）", () => {
  it("普通 focusTrip 只预填同车当天，创建使用当天全部服务端预览 IDs，而非只用 focusTrip.id", async () => {
    await render();
    expect(selection()).toMatchObject({
      mode: "day",
      periodStart: focus.date,
      periodEnd: focus.date,
      plateNo: "湘A00007",
      preview: mocks.preview,
    });
    expect(previewRequest()).toEqual([
      {
        projectId: 42,
        vehicleId: 7,
        periodStart: focus.date,
        periodEnd: focus.date,
        selectionMode: "day",
        tripCount: undefined,
      },
      { enabled: true, retry: false },
    ]);
    expect(button("生成结算草稿").props.disabled).toBe(true);
    assertNoWrites();
    await payee();
    await click("生成结算草稿");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 42,
        vehicleId: 7,
        periodStart: focus.date,
        periodEnd: focus.date,
        selectionMode: "day",
        tripIds: [1, 2],
        payeeName: "车主甲",
        payeeAccount: account,
        legacyTripIds: [],
      })
    );
    expect(mocks.transition).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("切换 period 并设置跨月连续七天，发送整个期间的全部预览 IDs；切回 day 同步结束日期", async () => {
    await render();
    await act(async () => selection().onModeChange("period"));
    await act(async () =>
      selection().onPeriodChange("2026-01-29", "2026-02-04")
    );
    mocks.preview = preview([11, 12, 18, 21], "period", [
      "2026-01-29",
      "2026-01-31",
      "2026-02-04",
    ]);
    await rerender();
    expect(previewRequest()[0]).toMatchObject({
      periodStart: "2026-01-29",
      periodEnd: "2026-02-04",
      selectionMode: "period",
    });
    assertNoWrites();
    await payee();
    await click("生成结算草稿");
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        periodStart: "2026-01-29",
        periodEnd: "2026-02-04",
        selectionMode: "period",
        tripIds: [11, 12, 18, 21],
        tripCount: undefined,
      })
    );
    await act(async () => selection().onModeChange("day"));
    expect(selection()).toMatchObject({
      mode: "day",
      periodStart: "2026-01-29",
      periodEnd: "2026-01-29",
    });
  });

  it.each([1, 2, 1000])(
    "指定合法 %i 趟发送 mode、数量和服务端返回 IDs",
    async count => {
      await render();
      await act(async () => selection().onModeChange("trip_count"));
      await act(async () => selection().onTripCountChange(String(count)));
      await act(async () =>
        selection().onPeriodChange("2026-11-01", "2026-11-07")
      );
      const ids = Array.from({ length: count }, (_, index) => 101 + index);
      mocks.preview = preview(ids, "trip_count", ["2026-11-01", "2026-11-07"]);
      await rerender();
      expect(previewRequest()[0]).toMatchObject({
        selectionMode: "trip_count",
        tripCount: count,
      });
      expect(previewRequest()[1].enabled).toBe(true);
      await payee();
      await click("生成结算草稿");
      expect(mocks.create).toHaveBeenCalledTimes(1);
      expect(mocks.create.mock.calls[0][0]).toMatchObject({
        selectionMode: "trip_count",
        tripCount: count,
        tripIds: ids,
        periodStart: "2026-11-01",
        periodEnd: "2026-11-07",
      });
    }
  );

  it.each(["0", "1001", "-1", "1.5", "", " 2", "abc"])(
    "非法指定趟数 %j 不启用预览，也不能创建",
    async count => {
      await render();
      await payee();
      await act(async () => selection().onModeChange("trip_count"));
      await act(async () => selection().onTripCountChange(count));
      expect(previewRequest()[1].enabled).toBe(false);
      expect(button("生成结算草稿").props.disabled).toBe(true);
      await click("生成结算草稿");
      assertNoWrites();
    }
  );

  it.each(["insufficient", "fetching", "error", "missing"] as const)(
    "预览 %s 时，即使已有合法账户或陈旧数据也不能生成",
    async state => {
      await render();
      await payee();
      if (state === "insufficient") {
        await act(async () => selection().onModeChange("trip_count"));
        await act(async () => selection().onTripCountChange("3"));
        mocks.preview = {
          ...preview([1, 2], "trip_count"),
          eligible: false,
          reason: "可结算趟数不足",
        };
      }
      if (state === "fetching") mocks.fetching = true;
      if (state === "error") mocks.previewError = new Error("预览读取失败");
      if (state === "missing") mocks.preview = undefined;
      await rerender();
      expect(button("生成结算草稿").props.disabled).toBe(true);
      if (state === "fetching") expect(selection().loading).toBe(true);
      if (state === "error") expect(selection().error).toBeTruthy();
      if (state === "insufficient")
        expect(selection().preview?.reason).toBe("可结算趟数不足");
      await click("生成结算草稿");
      assertNoWrites();
    }
  );

  it("历史未关联 settled 运单只补历史单 ID，须财务确认，不渲染新 Selection、不发送新 mode", async () => {
    await render({ focusTrip: { ...focus, legacyUnlinkedSettled: true } });
    expect(root().findAllByType(SelectionBoundary)).toHaveLength(0);
    expect(previewRequest()[1].enabled).toBe(false);
    const dateInputs = root()
      .findAllByType("input")
      .filter(node => node.props.type === "date" && node.props.disabled);
    expect(dateInputs.map(node => node.props.value)).toEqual([
      focus.date,
      focus.date,
    ]);
    expect(
      root().findAllByProps({ "data-test": "primitive-select" })[0].props
        .disabled
    ).toBe(true);
    await payee();
    await click("生成结算草稿");
    assertNoWrites();
    const checkbox = root()
      .findAllByType("input")
      .find(node => node.props.type === "checkbox");
    if (!checkbox) throw new Error("Missing legacy acknowledgement");
    await act(async () =>
      (
        checkbox.props as React.InputHTMLAttributes<HTMLInputElement>
      ).onChange?.({
        target: { checked: true },
      } as React.ChangeEvent<HTMLInputElement>)
    );
    await change("填写原始资料核对依据（至少4字）", "凭据");
    expect(button("生成结算草稿").props.disabled).toBe(true);
    await change("填写原始资料核对依据（至少4字）", "已核对原始付款凭据");
    await click("生成结算草稿");
    const input = mocks.create.mock.calls[0][0];
    expect(input).toMatchObject({
      tripIds: [1],
      legacyTripIds: [1],
      legacyConfirmation: "已核对原始付款凭据",
      periodStart: focus.date,
      periodEnd: focus.date,
    });
    expect(input.selectionMode).toBeUndefined();
    expect(input.tripCount).toBeUndefined();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("无财务审核权限不能补历史 settled 单，普通创建权限也不能绕过财务确认", async () => {
    await render({
      canApprove: false,
      focusTrip: { ...focus, legacyUnlinkedSettled: true },
    });
    await payee();
    const checkbox = root()
      .findAllByType("input")
      .find(node => node.props.type === "checkbox");
    if (!checkbox) throw new Error("Missing legacy acknowledgement");
    await act(async () =>
      (
        checkbox.props as React.InputHTMLAttributes<HTMLInputElement>
      ).onChange?.({
        target: { checked: true },
      } as React.ChangeEvent<HTMLInputElement>)
    );
    await change("填写原始资料核对依据（至少4字）", "已核对原始付款凭据");
    await click("生成结算草稿");
    expect(button("生成结算草稿").props.disabled).toBe(true);
    assertNoWrites();
  });

  it("scopeVehicleId 默认当前车，车辆选择锁定且没有其他车选项", async () => {
    await render({ scopeVehicleId: 8, focusTrip: null });
    await click("生成合并结算");
    expect(selection().plateNo).toBe("湘A00008");
    const vehicleSelect = root().findAllByProps({
      "data-test": "primitive-select",
    })[0];
    expect(vehicleSelect.props.value).toBe("8");
    expect(vehicleSelect.props.disabled).toBe(true);
    expect(
      vehicleSelect.findAllByType("option").map(node => node.props.value)
    ).toEqual(["8"]);
    expect(
      root().findByProps({ "aria-label": "结算车辆筛选" }).props.disabled
    ).toBe(true);
    expect(button("发送微信日结").props.disabled).toBe(true);
    await payee();
    await click("生成结算草稿");
    expect(mocks.create.mock.calls[0][0].vehicleId).toBe(8);
  });

  it("取消及关闭拒绝确认时保留草稿，同一 focus 请求不重置；确认关闭后仅清草稿，不写入", async () => {
    const onDirtyChange = vi.fn();
    await render({ onDirtyChange });
    await payee();
    await rerender({ focusTrip: { ...focus } });
    expect(
      root()
        .findAllByType("input")
        .find(node => node.props.placeholder === "银行卡/对公账号/收款账号")
        ?.props.value
    ).toBe(account);
    await click("取消");
    expect(dialogs()).toHaveLength(1);
    await act(async () =>
      (dialogs()[0].props as HTMLAttributes<HTMLDivElement>).onClick?.(
        {} as React.MouseEvent<HTMLDivElement>
      )
    );
    expect(dialogs()).toHaveLength(1);
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
    expect(onDirtyChange.mock.calls.at(-1)).toEqual([true]);
    mocks.confirm.mockReturnValue(true);
    await click("取消");
    expect(dialogs()).toHaveLength(0);
    expect(onDirtyChange.mock.calls.at(-1)).toEqual([false]);
    await rerender({ focusTrip: { ...focus } });
    expect(dialogs()).toHaveLength(0);
    await click("生成合并结算");
    expect(selection().mode).toBe("day");
    expect(
      root()
        .findAllByType("input")
        .find(node => node.props.placeholder === "银行卡/对公账号/收款账号")
        ?.props.value
    ).toBe("");
    assertNoWrites();
  });

  it("创建 pending 锁取消、弹窗关闭、范围选择和重复生成；成功刷新当前生产缓存", async () => {
    mocks.holdCreate = true;
    await render();
    await payee();
    await click("生成结算草稿");
    expect(button("生成中…").props.disabled).toBe(true);
    expect(button("取消").props.disabled).toBe(true);
    expect(selection().disabled).toBe(true);
    expect(
      root().findAllByProps({ "data-test": "primitive-select" })[0].props
        .disabled
    ).toBe(true);
    await click("生成中…");
    await click("取消");
    await act(async () =>
      (dialogs()[0].props as HTMLAttributes<HTMLDivElement>).onClick?.(
        {} as React.MouseEvent<HTMLDivElement>
      )
    );
    expect(dialogs()).toHaveLength(1);
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    if (!mocks.createOptions) throw new Error("Missing create callbacks");
    await act(async () =>
      mocks.createOptions?.onSuccess({ settlementNo: "SET-BATCH-001" })
    );
    expect(dialogs()).toHaveLength(0);
    // listTripLedger was removed from production refresh during parallel work;
    // it remains mocked above, but its missing invalidation is reported separately.
    for (const invalidate of [
      mocks.invalidatePreview,
      mocks.invalidateTrips,
      mocks.invalidateDaily,
      mocks.invalidateSettlements,
    ])
      expect(invalidate).toHaveBeenCalledTimes(1);
    expect(mocks.transition).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("原登记付款仍委托旧 PaymentDialog：不额外创建、变更状态、通知或启用合并预览请求", async () => {
    mocks.settlements = [
      {
        id: 55,
        vehicleId: 7,
        settlementNo: "OLD-SET-055",
        periodStart: focus.date,
        periodEnd: focus.date,
        tripCount: 2,
        grossFreightAmount: 200,
        fuelDeductionAmount: 0,
        assetDeductionAmount: 0,
        carryForwardDeductionAmount: 0,
        netPayableAmount: 200,
        actualPaidAmount: 0,
        actualReceivedAmount: 0,
        remainingAmount: 200,
        status: "approved",
        payeeName: "车主甲",
        payeeAccount: account,
        paymentMethod: "bank_transfer",
        paymentDate: null,
        vehicle: { plateNo: "湘A00007" },
      },
    ];
    await render({ focusTrip: null });
    await click("全部期间");
    await click("登记付款");
    expect(payment()).toMatchObject({
      open: true,
      projectId: 42,
      settlementType: "transport_vehicle",
      target: {
        id: 55,
        label: "OLD-SET-055 · 湘A00007",
        payeeName: "车主甲",
        payeeAccount: account,
      },
    });
    expect(
      mocks.previewQuery.mock.calls.every(
        ([, options]) => options.enabled === false
      )
    ).toBe(true);
    assertNoWrites();
    mocks.confirm.mockReturnValue(true);
    await act(async () => payment().onOpenChange(false));
    expect(payment().open).toBe(false);
    await act(async () => {
      await payment().onCompleted?.();
    });
    for (const invalidate of [
      mocks.invalidatePreview,
      mocks.invalidateTrips,
      mocks.invalidateDaily,
      mocks.invalidateSettlements,
    ])
      expect(invalidate).toHaveBeenCalledTimes(1);
    assertNoWrites();
  });
});
