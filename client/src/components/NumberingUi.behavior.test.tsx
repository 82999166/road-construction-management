import React from "react";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { documentNumberText, StoredDocumentNumber, storedDocumentNumber } from "./StoredDocumentNumber";

const mocks = vi.hoisted(() => ({ print: vi.fn() }));
vi.mock("./PayrollCorrectionActions", () => ({ PayrollCorrectionActions: () => null }));
vi.mock("./DailyWageCorrectionActions", () => ({ DailyWageCorrectionActions: () => null }));
vi.mock("@/lib/a4Print", async () => {
  const real = await vi.importActual<typeof import("@/lib/a4Print")>("@/lib/a4Print");
  return { ...real, openA4LandscapePrintDocument: mocks.print };
});
import PayrollStatementLedger from "./PayrollStatementLedger";
import DailyWageLedger from "./DailyWageLedger";

let tree: ReactTestRenderer | undefined;
const text = (node: ReactTestInstance | string): string => typeof node === "string" ? node : node.children.map(text).join("");
const mount = async (element: React.ReactElement) => { await act(async () => { tree = create(element); }); };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { setTimeout, clearTimeout });
});
afterEach(async () => { if (tree) await act(async () => tree?.unmount()); tree = undefined; vi.unstubAllGlobals(); });

describe("持久统一号只读展示", () => {
  it.each(["MC", "MD", "MM", "PY", "DW", "PA", "PM", "AM", "CR"])("%s 原号全文不截断不重组", async prefix => {
    const no = `${prefix}2026112420443000001234567890120001`;
    await mount(<StoredDocumentNumber record={{ id: 888, documentNo: no }} />);
    expect(text(tree!.root)).toBe(`单号：${no}`);
    expect(tree!.root.findByType("p").props.className).toContain("break-all");
    expect(tree!.root.findByType("p").props.className).toContain("min-w-0");
    expect(tree!.root.findByType("p").props.className).toContain("font-mono");
  });
  it("NULL/missing只说明历史未编统一号，绝不由id生成号", () => {
    expect(documentNumberText({ id: 123, documentNo: null })).toBe("历史未编统一号");
    expect(documentNumberText({ id: 456 })).toBe("历史未编统一号");
    expect(storedDocumentNumber({ documentNo: 12 })).toBeNull();
  });
  it("不trim、slice或把外部reference当正式号", () => {
    expect(documentNumberText({ documentNo: "  持久原值  ", reference: "外部" })).toBe("  持久原值  ");
    expect(documentNumberText({ documentNo: "" })).toBe("");
    expect(documentNumberText({ reference: "PR-外部", invoiceNo: "发票", id: 7 })).toBe("历史未编统一号");
  });
  it("工资真实号与旧NULL同时展示，打印转义全文且金额和外部凭证保留", async () => {
    const no = "PY2026112420443012345678900001<&>";
    await mount(<PayrollStatementLedger period="2026-11" onPeriodChange={vi.fn()} search="" onSearchChange={vi.fn()} team="all" onTeamChange={vi.fn()} status="all" onStatusChange={vi.fn()} teams={[]} rows={[
      { id: 1, documentNo: no, workerName: "甲", teamName: null, period: "2026-11", payableAmount: 100, deductionAmount: 3, actualAmount: 97, paymentReference: "银行外部凭证", status: "paid" },
      { id: 2, documentNo: null, workerName: "乙", teamName: null, period: "2026-11", payableAmount: 50, deductionAmount: 0, actualAmount: 50, paymentReference: null, status: "draft" },
    ]} formatMoney={value => Number(value).toFixed(2)} onExport={vi.fn()} onOpenDetail={vi.fn()} onRegisterPayment={vi.fn()} roleCodes={[]} />);
    expect(text(tree!.root)).toContain(no);
    expect(text(tree!.root)).toContain("历史未编统一号");
    expect(text(tree!.root)).toContain("银行外部凭证");
    const print = tree!.root.findAllByType("button").find(node => text(node).includes("打印"))!;
    await act(async () => print.props.onClick());
    expect(mocks.print).toHaveBeenCalledTimes(1);
    const html = mocks.print.mock.calls[0][0].bodyHtml as string;
    expect(html).toContain("PY2026112420443012345678900001&lt;&amp;&gt;");
    expect(html).toContain("¥97.00");
    expect(html).toContain("银行外部凭证");
    expect(html).toContain('colspan="4"');
  });
  it("临工真实号展示且受控纠错路径不退回旧回调", async () => {
    const submit = vi.fn();
    await mount(<DailyWageLedger summary={{ actual: 97, reviewing: 0, approved: 0, paid: 0 }} rows={[{ id: 7, documentNo: "DW2026112420443012340001", workerName: "日结甲", teamName: null, settlementDate: "2026-11-24", payableAmount: 100, deductionAmount: 3, actualAmount: 97, status: "draft", reviewedAt: null, paidAt: null }]} refreshing={false} workbookPending={false} paymentListPending={false} submitPending={false} reviewPending={false} formatMoney={value => Number(value).toFixed(2)} displayDate={value => String(value)} toBusinessDateInput={() => "2026-11-24"} onRefresh={vi.fn()} onExportWorkbook={vi.fn()} onExportPaymentList={vi.fn()} onSubmit={submit} onReturnDraft={vi.fn()} onApprove={vi.fn()} onRegisterPayment={vi.fn()} roleCodes={[]} />);
    expect(text(tree!.root)).toContain("DW2026112420443012340001");
    expect(text(tree!.root)).toContain("¥97.00");
    expect(text(tree!.root)).not.toContain("提交审核");
    expect(submit).not.toHaveBeenCalled();
  });
});
