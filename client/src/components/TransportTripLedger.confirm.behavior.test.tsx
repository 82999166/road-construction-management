import React, { type HTMLAttributes, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { create, act } = createRequire(import.meta.url)(
  "react-test-renderer"
) as typeof import("react-test-renderer");

type CheckboxProps = {
  id?: string;
  className?: string;
  checked?: boolean | "indeterminate";
  disabled?: boolean;
  onCheckedChange?: (checked: boolean | "indeterminate") => void;
};

// Replace DOM/Radix boundaries only. The real ledger owns selection, confirmation,
// eligibility/permission checks, transition arguments, filters and pagination.
vi.mock("@/components/ui/button", () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }: CheckboxProps) => (
    <input
      {...props}
      type="checkbox"
      checked={checked === true}
      onChange={event => onCheckedChange?.(event.target.checked)}
    />
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
vi.mock("@/components/ui/table", () => ({
  Table: (props: React.TableHTMLAttributes<HTMLTableElement>) => (
    <table {...props} />
  ),
  TableBody: (props: HTMLAttributes<HTMLTableSectionElement>) => (
    <tbody {...props} />
  ),
  TableCell: (props: React.TdHTMLAttributes<HTMLTableCellElement>) => (
    <td {...props} />
  ),
  TableHead: (props: React.ThHTMLAttributes<HTMLTableCellElement>) => (
    <th {...props} />
  ),
  TableHeader: (props: HTMLAttributes<HTMLTableSectionElement>) => (
    <thead {...props} />
  ),
  TableRow: (props: HTMLAttributes<HTMLTableRowElement>) => <tr {...props} />,
}));
vi.mock("@/components/ui/dialog", () => {
  const Block = (props: HTMLAttributes<HTMLDivElement>) => <div {...props} />;
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      open ? <div data-test="ledger-dialog">{children}</div> : null,
    DialogContent: Block,
    DialogDescription: Block,
    DialogFooter: Block,
    DialogHeader: Block,
    DialogTitle: Block,
  };
});
vi.mock("@/components/ui/select", () => {
  const Block = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Select: ({
      value,
      children,
      onValueChange,
    }: {
      value?: string;
      children?: ReactNode;
      onValueChange?: (value: string) => void;
    }) => (
      <select
        value={value}
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
vi.mock("@/components/CurrentFilterPrintActions", () => ({
  CurrentFilterPrintActions: () => null,
}));
vi.mock("@/components/ProtectedImagePreview", () => ({
  ProtectedImagePreview: () => null,
}));

import TransportTripLedger from "./TransportTripLedger";
import { Checkbox } from "@/components/ui/checkbox";

type LedgerProps = React.ComponentProps<typeof TransportTripLedger>;
const confirmLabel = "确认核验放行";
const confirmationId = "transport-trip-review-confirmed";
const transition = vi.fn<LedgerProps["onTransition"]>();
const trip = (id = 1) => ({
  id,
  tripNo: `TRIP-CONFIRM-${id}`,
  vehicleId: 7,
  vehiclePlateNo: "湘A00007",
  vehicle: { driverName: "司机甲", ownership: "trip_settlement" },
  status: "submitted",
  settlementId: null,
  invoiceMode: "nfc_card",
  startAt: "2026-11-09T08:00:00+08:00",
  loadConfirmedAt: "2026-11-09T08:00:00+08:00",
  unloadConfirmedAt: "2026-11-09T09:00:00+08:00",
  endAt: "2026-11-09T09:00:00+08:00",
  loadLocation: { name: "装土场", address: "装土场中文地址" },
  unloadLocation: { name: "卸土场", address: "卸土场中文地址" },
  routeSnapshot: { routePresetId: 3 },
  calculatedAmount: 100,
  fuelDeductionAmount: 10,
  volumeCubicMeters: 10,
  reviewEligibility: { eligible: true, reasons: [] as string[] },
});
let tree: ReactTestRenderer | undefined;
let mountedProps: LedgerProps;
const root = () => {
  if (!tree) throw new Error("Ledger must be rendered first");
  return tree.root;
};
const text = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(text).join("");
const buttons = (label: string) =>
  root()
    .findAllByType("button")
    .filter(node => text(node) === label);
const button = (label: string, index = 0) => {
  const control = buttons(label)[index];
  if (!control) throw new Error(`Missing button: ${label} #${index}`);
  return control;
};
const dialog = () => root().findByProps({ "data-test": "ledger-dialog" });
const checkbox = () =>
  root().findByProps({ id: confirmationId, type: "checkbox" });
const render = async (props: Partial<LedgerProps> = {}) => {
  mountedProps = {
    filter: {
      periodMode: "all",
      date: "2026-11-09",
      month: "2026-11",
      dateFrom: "",
      dateTo: "",
      vehicleId: "all",
      status: "all",
      routePresetId: "all",
    },
    onFilterChange: vi.fn(),
    trips: [trip(), trip(2)],
    vehicles: [],
    routePresets: [],
    loading: false,
    projectName: "测试项目",
    onTransition: transition,
    active: true,
    canReview: true,
    transitionPending: false,
    onExport: vi.fn(),
    ...props,
  };
  await act(async () => {
    tree = create(<TransportTripLedger {...mountedProps} />);
  });
};
const rerender = async (props: Partial<LedgerProps>) => {
  mountedProps = { ...mountedProps, ...props };
  await act(async () =>
    tree?.update(<TransportTripLedger {...mountedProps} />)
  );
};
// Normal clicks respect disabled controls; forceHandler additionally tests the
// real component's defensive onClick guard without relying on the DOM mock.
const click = async (label: string, index = 0, forceHandler = false) => {
  const props = button(label, index)
    .props as React.ButtonHTMLAttributes<HTMLButtonElement>;
  await act(async () => {
    if (!props.disabled || forceHandler)
      props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
  });
};
const check = async (checked: boolean) => {
  const props = checkbox().props as React.InputHTMLAttributes<HTMLInputElement>;
  await act(async () => {
    if (!props.disabled)
      props.onChange?.({
        target: { checked },
      } as React.ChangeEvent<HTMLInputElement>);
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  if (tree) await act(async () => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});

describe("TransportTripLedger 勾选核验的真实组件行为", () => {
  it("选择详情后默认未勾选且不能提交；勾选只发送 true 和 undefined 意见，取消勾选再次禁用", async () => {
    await render();
    expect(
      root().findAllByProps({ "data-test": "ledger-dialog" })
    ).toHaveLength(0);
    expect(buttons(confirmLabel)).toHaveLength(0);
    await click("详情");
    expect(text(dialog())).toContain("完整运单详情 · TRIP-CONFIRM-1");
    expect(checkbox().props.checked).toBe(false);
    expect(button(confirmLabel).props.disabled).toBe(true);
    expect(dialog().findAllByType("input")).toHaveLength(1);
    expect(dialog().findAllByType("textarea")).toHaveLength(0);
    expect(dialog().findAllByType("input")[0].props.type).toBe("checkbox");
    expect(text(dialog())).toContain("无需填写意见");
    await click(confirmLabel);
    await click(confirmLabel, 0, true);
    expect(transition).not.toHaveBeenCalled();

    await check(true);
    expect(checkbox().props.checked).toBe(true);
    expect(button(confirmLabel).props.disabled).toBe(false);
    await click(confirmLabel);
    expect(transition.mock.calls).toEqual([[1, "verified", undefined, true]]);

    await check(false);
    expect(checkbox().props.checked).toBe(false);
    expect(button(confirmLabel).props.disabled).toBe(true);
    await click(confirmLabel);
    await click(confirmLabel, 0, true);
    expect(transition).toHaveBeenCalledTimes(1);
  });

  it.each(["详情", "核验"])(
    "通过%s切换运单会重置勾选，不复用上一单确认",
    async entry => {
      await render();
      await click("详情");
      await check(true);
      await click(entry, 1);
      expect(text(dialog())).toContain("完整运单详情 · TRIP-CONFIRM-2");
      expect(checkbox().props.checked).toBe(false);
      expect(button(confirmLabel).props.disabled).toBe(true);
      await click(confirmLabel, 0, true);
      expect(transition).not.toHaveBeenCalled();
      await check(true);
      await click(confirmLabel);
      expect(transition.mock.calls).toEqual([[2, "verified", undefined, true]]);
      await click(entry, 0);
      expect(text(dialog())).toContain("完整运单详情 · TRIP-CONFIRM-1");
      expect(checkbox().props.checked).toBe(false);
      expect(button(confirmLabel).props.disabled).toBe(true);
    }
  );

  it("关闭后重新选择同一运单也重新要求勾选", async () => {
    await render();
    await click("详情");
    await check(true);
    await click("关闭");
    expect(buttons(confirmLabel)).toHaveLength(0);
    await click("详情");
    expect(checkbox().props.checked).toBe(false);
    expect(button(confirmLabel).props.disabled).toBe(true);
    await click(confirmLabel, 0, true);
    expect(transition).not.toHaveBeenCalled();
  });

  it.each([
    ["请求 pending", { transitionPending: true }],
    ["工作区 inactive", { active: false }],
  ] as const)(
    "已有勾选时%s仍禁止提交，直接调用当前处理器也被拦截",
    async (_, blockedProps) => {
      await render();
      await click("详情");
      await check(true);
      await rerender(blockedProps);
      expect(checkbox().props.checked).toBe(true);
      expect(checkbox().props.disabled).toBe(true);
      expect(button(confirmLabel).props.disabled).toBe(true);
      await click(confirmLabel);
      await click(confirmLabel, 0, true);
      expect(transition).not.toHaveBeenCalled();
      await rerender({ transitionPending: false, active: true });
      expect(button(confirmLabel).props.disabled).toBe(false);
      await click(confirmLabel);
      expect(transition.mock.calls).toEqual([[1, "verified", undefined, true]]);
    }
  );

  it.each(["初始未授权", "勾选后撤销授权"])(
    "%s不能核验，详情中没有可提交入口",
    async permissionState => {
      await render({ canReview: permissionState !== "初始未授权" });
      await click("详情");
      if (permissionState === "勾选后撤销授权") {
        await check(true);
        await rerender({ canReview: false });
      }
      expect(text(dialog())).toContain("完整运单详情 · TRIP-CONFIRM-1");
      expect(buttons("核验")).toHaveLength(0);
      expect(buttons(confirmLabel)).toHaveLength(0);
      expect(root().findAllByType(Checkbox)).toHaveLength(0);
      expect(text(dialog())).not.toContain("核验放行依据");
      expect(transition).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["普通装卸", {}],
    ["发票单次刷卡闭环", { nfcSingleScanClosed: true }],
    ["卸土补刷卡闭环", { unloadOnlyCardClose: true }],
  ])(
    "%s但服务端 eligible=false 时，勾选也不能绕过闭环资格",
    async (_, routeFlags) => {
      const ineligibleTrip = {
        ...trip(),
        routeSnapshot: { routePresetId: 3, ...routeFlags },
        reviewEligibility: {
          eligible: false,
          reasons: ["真实闭环资格校验不通过"],
        },
      };
      await render({ trips: [ineligibleTrip] });
      await click("详情");
      expect(text(dialog())).toContain("真实闭环资格校验不通过");
      await check(true);
      expect(checkbox().props.checked).toBe(true);
      expect(button(confirmLabel).props.disabled).toBe(true);
      await click(confirmLabel);
      await click(confirmLabel, 0, true);
      expect(transition).not.toHaveBeenCalled();
    }
  );

  it("Radix indeterminate 不是明确确认，会恢复未勾选并拦截提交", async () => {
    await render();
    await click("详情");
    await check(true);
    await act(async () => {
      const props = root().findByType(Checkbox).props as CheckboxProps;
      props.onCheckedChange?.("indeterminate");
    });
    expect(checkbox().props.checked).toBe(false);
    expect(button(confirmLabel).props.disabled).toBe(true);
    await click(confirmLabel, 0, true);
    expect(transition).not.toHaveBeenCalled();
  });

  it.each([
    { status: "draft" },
    { status: "verified" },
    { status: "settled" },
    { settlementId: 99 },
  ])("不满足待核验状态或已关联结算单 %j 时没有核验确认入口", async patch => {
    await render({ trips: [{ ...trip(), ...patch }] });
    await click("详情");
    expect(buttons(confirmLabel)).toHaveLength(0);
    expect(root().findAllByType(Checkbox)).toHaveLength(0);
    expect(transition).not.toHaveBeenCalled();
  });
});

it("AdminPage 将真实组件第四个 reviewConfirmed 参数转发给运单状态 mutation", () => {
  const source = readFileSync(
    new URL("../pages/AdminPage.tsx", import.meta.url),
    "utf8"
  );
  const start = source.indexOf("<TransportTripLedger");
  expect(start).toBeGreaterThan(-1);
  const ledgerBinding = source.slice(start, source.indexOf("/>", start) + 2);
  const compact = ledgerBinding.replace(/\s+/g, "").replace(/,([})\]])/g, "$1");
  expect(compact).toContain(
    "onTransition={(id,nextStatus,reviewRemarks,reviewConfirmed)=>transitionTransportTrip.mutate({id,projectId:workspaceProjectId,nextStatus,reviewRemarks,reviewConfirmed})}"
  );
});
