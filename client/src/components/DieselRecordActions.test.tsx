import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DieselCorrectionRecord } from "@/lib/dieselRecordCorrection";

const state = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  pending: false,
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    admin: {
      diesel: {
        deleteRefuelRecord: {
          useMutation: () => ({
            mutateAsync: state.mutateAsync,
            isPending: state.pending,
          }),
        },
      },
    },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: state.success, error: state.error, warning: state.warning },
}));
import { DieselRecordActions } from "./DieselRecordActions";

const record: DieselCorrectionRecord = {
  id: 12,
  projectId: 30003,
  recordNo: "DS30003-duplicate",
  assetType: "machine",
  vehicleId: null,
  machineId: 3,
  transportTripId: null,
  supplyMethod: "external_station",
  stationOrSupplierName: "中国石化淘沙加油站",
  liters: "179.80",
  actualUnitPrice: "8.64",
  amount: "1553.47",
  deductFromFreight: false,
  refueledAt: new Date("2026-11-12T10:51:00Z"),
  updatedAt: new Date("2026-11-12T10:52:00Z"),
  meterReading: null,
  receiptNo: null,
  evidenceId: 59,
  remarks: null,
  status: "approved",
  assetName: "中联375 · 03",
};
let view: ReturnType<typeof TestRenderer.create>;
const onEdit = vi.fn();
const onDeleted = vi.fn();
const confirm = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { confirm });
  vi.clearAllMocks();
  state.pending = false;
  state.mutateAsync.mockResolvedValue({ deleted: true });
  onDeleted.mockResolvedValue(undefined);
  confirm.mockReturnValue(true);
});
afterEach(async () => {
  if (view) await act(async () => view.unmount());
  vi.unstubAllGlobals();
});
async function mount(
  overrides: Partial<DieselCorrectionRecord> = {},
  disabled = false
) {
  await act(async () => {
    view = TestRenderer.create(
      <DieselRecordActions
        record={{ ...record, ...overrides }}
        onEdit={onEdit}
        onDeleted={onDeleted}
        disabled={disabled}
      />
    );
  });
  return view.root.findAllByType("button");
}

describe("柴油台账修改删除操作", () => {
  it("普通已审核登记提供修改和删除，修改不调用删除", async () => {
    const buttons = await mount();
    expect(buttons.map(button => button.children.join(""))).toEqual([
      "修改",
      "删除",
    ]);
    await act(async () => buttons[0].props.onClick());
    expect(onEdit).toHaveBeenCalledOnce();
    expect(state.mutateAsync).not.toHaveBeenCalled();
  });
  it("二次确认含精确记录摘要，取消不产生业务写入", async () => {
    confirm.mockReturnValue(false);
    const buttons = await mount();
    await act(async () => buttons[1].props.onClick());
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("DS30003-duplicate")
    );
    const text = confirm.mock.calls[0][0];
    for (const value of [
      "中联375",
      "179.80",
      "1553.47",
      "2026/11/12 18:51:00",
      "保留在后台",
    ])
      expect(text).toContain(value);
    expect(state.mutateAsync).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });
  it("确认仅提交记录身份与旧版本，成功刷新并锁定按钮", async () => {
    const buttons = await mount();
    await act(async () => buttons[1].props.onClick());
    expect(state.mutateAsync).toHaveBeenCalledWith({
      id: 12,
      projectId: 30003,
      expectedUpdatedAt: "2026-11-12T10:52:00.000Z",
    });
    expect(onDeleted).toHaveBeenCalledOnce();
    expect(state.success).toHaveBeenCalledOnce();
    expect(
      view.root.findAllByType("button").every(button => button.props.disabled)
    ).toBe(true);
  });
  it.each([
    { status: "settled" },
    { status: "void" },
    { recordNo: "DS-MC-12" },
    { readOnly: true },
  ])("终态或机械来源不能写入：%j", async overrides => {
    const buttons = await mount(overrides);
    expect(buttons.every(button => button.props.disabled)).toBe(true);
    await act(async () => {
      buttons[0].props.onClick();
      buttons[1].props.onClick();
    });
    expect(onEdit).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(state.mutateAsync).not.toHaveBeenCalled();
  });
  it("双击仅提交一次；全局忙状态也锁定纠错", async () => {
    let resolve!: (value: unknown) => void;
    state.mutateAsync.mockImplementation(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const buttons = await mount();
    await act(async () => {
      buttons[1].props.onClick();
      buttons[1].props.onClick();
    });
    expect(state.mutateAsync).toHaveBeenCalledOnce();
    await act(async () => resolve({ deleted: true }));
    await act(async () => view.unmount());
    await mount({}, true);
    expect(
      view.root.findAllByType("button").every(button => button.props.disabled)
    ).toBe(true);
  });
  it("服务端拒绝删除保留记录并允许重试，不误报成功", async () => {
    state.mutateAsync.mockRejectedValue(new Error("关联机械成本已结算"));
    const buttons = await mount();
    await act(async () => buttons[1].props.onClick());
    expect(state.error).toHaveBeenCalledOnce();
    expect(state.success).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(view.root.findAllByType("button")[1].props.disabled).toBe(false);
  });
  it("删除成功而刷新失败不误报删除失败", async () => {
    onDeleted.mockRejectedValue(new Error("offline"));
    const buttons = await mount();
    await act(async () => buttons[1].props.onClick());
    expect(state.success).toHaveBeenCalledOnce();
    expect(state.warning).toHaveBeenCalledOnce();
    expect(state.error).not.toHaveBeenCalled();
  });
});
