import React from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";
const { create, act } = createRequire(import.meta.url)("react-test-renderer");
const mocks = vi.hoisted(() => ({ print: vi.fn(), trips: vi.fn(), dieselSummary: vi.fn() }));
vi.mock("@/lib/a4Print", async original => ({
  ...(await original<typeof import("@/lib/a4Print")>()),
  openA4LandscapePrintDocument: mocks.print,
}));
vi.mock("@/lib/trpc", () => ({ trpc: {
  transport: { listTrips: { useQuery: mocks.trips } },
  diesel: { printSummary: { useQuery: mocks.dieselSummary } },
} }));
// 只替换依赖 DOM/Portal 的原语，业务组件、数据投影和打印事件真实执行。
vi.mock("@/components/ui/dialog", () => {
  const Block = ({ children, ...props }: any) => <div {...props}>{children}</div>;
  return { Dialog: ({ open, children }: any) => open ? <div>{children}</div> : null,
    useDialogComposition: () => ({ isComposing: () => false, justEndedComposing: () => false, markCompositionEnd: () => {}, setComposing: () => {} }),
    DialogContent: Block, DialogHeader: Block, DialogTitle: Block, DialogDescription: Block, DialogFooter: Block };
});
vi.mock("@/components/ui/select", () => {
  const Block = ({ children }: any) => <div>{children}</div>;
  return { Select: Block, SelectContent: Block, SelectItem: Block, SelectTrigger: Block, SelectValue: Block };
});
import DieselRefuelPrintDialog, { type DieselPrintRecord } from "./DieselRefuelPrintDialog";
import { DieselSummaryPrintDialog } from "./DieselSummaryPrintDialog";
import { TransportFreightPrintDialog } from "./TransportFreightPrintDialog";
import { DIESEL_REFUEL_COLUMN_WIDTHS, DIESEL_SUMMARY_COLUMN_WIDTHS, TRANSPORT_FREIGHT_PRINT_COLUMN_WIDTHS, printColumnGroup } from "@/lib/reportPrintLayout";

let tree: ReactTestRenderer;
const longName = "项目部至连续施工区段的很长中文名称".repeat(8);
const longNumber = "YD20261110000000000000000000000000000000000000000000000001";
const record: DieselPrintRecord = {
  id: 1, recordNo: longNumber, assetName: longName, assetType: "vehicle", supplyMethod: "external_station",
  stationOrSupplierName: `${longName}<供油站>`, refuelerName: "李加油", liters: "123456.78", appliedUnitPrice: "6.50",
  amount: "802469.07", meterReading: "987654321098765432109876543210", deductFromFreight: true,
  refueledAt: "2026-11-10T01:30:00Z", status: "approved",
};
const result = (data: unknown) => ({ data, isLoading: false, error: null });
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === "string" ? child : text(child)).join("");
const table = () => tree.root.findByType("table");
const previewWidths = () => table().findAllByType("col").map(col => col.props.style.width);
const previewRows = () => table().findByType("tbody").findAllByType("tr");
function columns(row: ReactTestInstance) {
  let start = 1;
  return row.findAllByType("td").map(cell => {
    const column = start;
    start += cell.props.colSpan ?? 1;
    return { column, span: cell.props.colSpan ?? 1, value: text(cell), className: cell.props.className ?? "" };
  });
}
async function render(element: React.ReactElement) { await act(async () => { tree = create(element); }); }
async function print() {
  const button = tree.root.findAllByType("button").find(button => text(button).includes("打印 / 保存 PDF"));
  expect(button).toBeDefined();
  expect(button!.props.disabled).not.toBe(true);
  await act(async () => button!.props.onClick());
  return mocks.print.mock.calls.at(-1)![0].bodyHtml as string;
}
function expectSameColumns(html: string, widths: readonly number[]) {
  expect(previewWidths()).toEqual(widths.map(width => `${width}%`));
  expect(html).toContain(printColumnGroup(widths));
  expect(table().findAllByType("th")).toHaveLength(widths.length);
  for (const row of previewRows()) expect(columns(row).reduce((sum, cell) => sum + cell.span, 0)).toBe(widths.length);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.trips.mockReturnValue(result([]));
  mocks.dieselSummary.mockReturnValue(result({ records: [], summary: {} }));
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); vi.unstubAllGlobals(); });

describe("表头、长文本明细与跨列合计的真实打印行为", () => {
  it("柴油加油预览与 A4 共用十二列，油量在第 7 列、金额在第 9 列，作废不改变汇总口径", async () => {
    const records = [record, { ...record, id: 2, liters: 999, amount: 999, status: "void" }];
    await render(<DieselRefuelPrintDialog open onOpenChange={() => {}} mode="current" projectName="测试项目" dateLabel="当日" records={records} />);
    const html = await print();
    expectSameColumns(html, DIESEL_REFUEL_COLUMN_WIDTHS);
    const details = columns(previewRows()[0]);
    expect(details.find(cell => cell.column === 3)?.value).toBe(longName);
    expect(details.find(cell => cell.column === 5)?.value).toBe(`${longName}<供油站>`);
    expect(details.find(cell => cell.column === 10)?.value).toBe(`${record.meterReading}.00`);
    const summary = columns(previewRows().at(-1)!);
    expect(summary.find(cell => cell.column === 7)).toMatchObject({ value: "123456.78", className: "text-right" });
    expect(summary.find(cell => cell.column === 9)).toMatchObject({ value: "¥802469.07", className: "text-right" });
    expect(summary[0].span).toBe(6);
    expect(summary.at(-1)?.span).toBe(3);
    expect(html).toContain(`${longName}&lt;供油站&gt;`);
    expect(html).toContain('<td class="right">123456.78</td>');
    expect(html).toContain('<td class="right">¥802469.07</td>');
    expect(html).toContain("已作废");
    expect(records[1].amount).toBe(999);
  });

  it("柴油空表预览与 A4 保留十二列的 colspan 占位和对应合计", async () => {
    await render(<DieselRefuelPrintDialog open onOpenChange={() => {}} mode="daily" projectName="测试项目" dateLabel="当日" records={[]} />);
    const html = await print();
    expectSameColumns(html, DIESEL_REFUEL_COLUMN_WIDTHS);
    expect(columns(previewRows()[0])[0].span).toBe(12);
    expect(html).toContain('colspan="12"');
  });

  it("运输长运单号与长路线完整保留，金额合计从第 9 列起右对齐，预览与 A4 列宽相同", async () => {
    mocks.trips.mockReturnValue(result([{
      id: 1, vehicleId: 3, startAt: record.refueledAt, vehiclePlateNo: "赣A12345", tripNo: longNumber,
      loadLocation: { name: longName }, unloadLocation: { name: `${longName}<终点>` },
      volumeCubicMeters: "12345.67", actualDistanceKm: "98765.43", calculatedUnitPrice: "23.45",
      calculatedAmount: "9876543.21", fuelDeductionAmount: "100.50", netSettlementAmount: "9876442.71", status: "verified",
    }]));
    await render(<TransportFreightPrintDialog open onOpenChange={() => {}} projectId={1} projectName="测试项目" initialDate="2026-11-10" vehicles={[]} />);
    const html = await print();
    expectSameColumns(html, TRANSPORT_FREIGHT_PRINT_COLUMN_WIDTHS);
    const details = columns(previewRows()[0]);
    expect(details.find(cell => cell.column === 4)?.value).toBe(longNumber);
    expect(details.find(cell => cell.column === 5)?.value).toBe(`${longName} → ${longName}<终点>`);
    const summary = columns(previewRows().at(-1)!);
    expect(summary[0].span).toBe(5);
    for (const column of [6, 9, 10, 11]) expect(summary.find(cell => cell.column === column)?.className).toContain("text-right");
    expect(summary.find(cell => cell.column === 9)?.value).toBe("¥9,876,543.21");
    expect(html).toContain(longNumber);
    expect(html).toContain(`${longName} → ${longName}&lt;终点&gt;`);
    expect(html).toContain('colspan="5"');
    expect(mocks.trips.mock.calls[0][0]).toEqual({ projectId: 1, dateFrom: "2026-11-10", dateTo: "2026-11-10" });
  });

  it("柴油汇总长单据号完整展示，列宽和第 7、9、11 列合计在两条打印路径一致", async () => {
    mocks.dieselSummary.mockReturnValue(result({ records: [{
      ...record, liters: 123456.78, appliedUnitPrice: 6.5, amount: 802469.07, meterReading: null, assetLabel: longName,
    }], summary: { recordCount: 1, vehicleCount: 1, machineCount: 0, liters: 123456.78, amount: 802469.07, deductibleAmount: 802469.07 } }));
    await render(<DieselSummaryPrintDialog open onOpenChange={() => {}} projectId={1} projectName="测试项目" />);
    const html = await print();
    expectSameColumns(html, DIESEL_SUMMARY_COLUMN_WIDTHS);
    expect(columns(previewRows()[0]).find(cell => cell.column === 3)?.value).toBe(longNumber);
    const summary = columns(previewRows().at(-1)!);
    expect(summary[0].span).toBe(6);
    for (const column of [7, 9, 11]) expect(summary.find(cell => cell.column === column)?.className).toContain("text-right");
    expect(html).toContain(longNumber);
    expect(html).toContain('colspan="6"');
  });
});
