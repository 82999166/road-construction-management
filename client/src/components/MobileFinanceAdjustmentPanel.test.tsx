import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ finance: { listRecords: { invalidate: vi.fn() }, summary: { invalidate: vi.fn() } } }),
    finance: {
      voidRecord: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      reverseRecord: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

import { MobileFinanceAdjustmentPanel } from "./MobileFinanceAdjustmentPanel";
import { MOBILE_FINANCE_BACK_PATH } from "../pages/MobileFinancePage";

describe("移动端财务调整面板", () => {
  it("仅为财务岗位的可调整人工流水渲染作废或冲销操作，并隐藏自动来源和已作废记录", () => {
    const html = renderToStaticMarkup(<MobileFinanceAdjustmentPanel
      projectId={8}
      roleCodes={["ACCOUNTANT"]}
      records={[
        { id: 1, recordNo: "FIN-VOID-001", category: "材料预付款", settlementStatus: "unpaid", sourceType: null },
        { id: 2, recordNo: "FIN-REVERSE-002", category: "已付租金", settlementStatus: "paid", sourceType: null },
        { id: 3, recordNo: "FIN-SOURCE-003", category: "工程回款", settlementStatus: "paid", sourceType: "measurement_receipt" },
        { id: 4, recordNo: "FIN-VOIDED-004", category: "旧作废记录", settlementStatus: "void", sourceType: null },
      ]}
    />);

    expect(html).toContain("账务调整");
    expect(html).toContain("FIN-VOID-001");
    expect(html).toContain("FIN-REVERSE-002");
    expect(html).toContain("作废");
    expect(html).toContain("冲销");
    expect(html).not.toContain("FIN-SOURCE-003");
    expect(html).not.toContain("FIN-VOIDED-004");
  });

  it("无财务岗位或无可调整记录时不渲染调整区域，财务页返回路径固定为移动工作台", () => {
    const unauthorized = renderToStaticMarkup(<MobileFinanceAdjustmentPanel projectId={8} roleCodes={["LABOR_MANAGER"]} records={[{ id: 1, recordNo: "FIN-VOID-001", category: "材料预付款", settlementStatus: "unpaid" }]} />);
    const terminalOnly = renderToStaticMarkup(<MobileFinanceAdjustmentPanel projectId={8} roleCodes={["ACCOUNTANT"]} records={[{ id: 4, recordNo: "FIN-VOIDED-004", category: "旧作废记录", settlementStatus: "void" }]} />);

    expect(unauthorized).toBe("");
    expect(terminalOnly).toBe("");
    expect(MOBILE_FINANCE_BACK_PATH).toBe("/mobile");
  });
});
