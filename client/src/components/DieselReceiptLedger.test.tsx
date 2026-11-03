import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  DieselReceiptLedger,
  buildDieselReceiptBook,
  paginateDieselReceipts,
  projectDieselReceipt,
  type DieselReceiptRecord,
} from "./DieselReceiptLedger";

// 项目Vitest使用经典JSX，既有共享预览组件由Vite自动JSX处理；测试提供等价运行时。
vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

function record(
  overrides: Partial<DieselReceiptRecord> = {}
): DieselReceiptRecord {
  return {
    id: 1,
    projectId: 8,
    recordNo: "DS-REAL-1",
    assetType: "vehicle",
    assetName: "粤A12345",
    supplyMethod: "external_station",
    stationOrSupplierName: "真实加油站",
    refueledAt: "2026-11-03T23:00:00Z",
    liters: "10.000",
    amount: "70.00",
    appliedUnitPrice: "7.00",
    status: "approved",
    receiptNo: "小票001",
    evidenceId: 91,
    receiptEvidence: {
      id: 91,
      fileName: "加油表.png",
      mimeType: "image/png",
      url: "/controlled/image-91",
    },
    ...overrides,
  };
}
const props = { projectName: "项目八", filterLabel: "2026-11-04 · 加油站加油" };

describe("柴油票据只读栏目", () => {
  it("只投影真实小票和受控影像，明确formalInvoice=null而非按供应商金额关联", () => {
    const input = {
      ...record(),
      fileKey: "private-key",
      remarks: "发票号FAKE-001",
      category: "柴油发票",
      formalInvoice: { invoiceNo: "FAKE-001" },
      receiptEvidence: {
        ...record().receiptEvidence!,
        fileKey: "evidence/private/key",
      },
    };
    const projected = projectDieselReceipt(input);
    expect(projected.formalInvoice).toBeNull();
    expect(projected.invoiceLinkage).toBe("no_linkage");
    expect(projected.hasReceipt).toBe(true);
    expect(projected.receiptEvidence).toEqual({
      id: 91,
      fileName: "加油表.png",
      mimeType: "image/png",
      url: "/controlled/image-91",
    });
    expect(projected.refueledAt).toBe("2026/11/4 07:00:00");
    expect(JSON.stringify(projected)).not.toContain("private");
    expect(JSON.stringify(projected)).not.toContain("FAKE-001");
  });
  it("未提供有效影像时不以evidenceId冒充可预览凭证，凭证号单独存在仍如实展示", () => {
    expect(
      projectDieselReceipt(
        record({ receiptNo: null, receiptEvidence: null, evidenceId: 100 })
      ).hasReceipt
    ).toBe(false);
    expect(
      projectDieselReceipt(
        record({
          receiptNo: "  ",
          receiptEvidence: {
            fileName: "旧图片",
            mimeType: "image/png",
            url: null,
          },
        })
      ).receiptEvidence
    ).toBeNull();
    expect(
      projectDieselReceipt(record({ receiptEvidence: null })).hasReceipt
    ).toBe(true);
    expect(projectDieselReceipt(record({ receiptNo: null })).hasReceipt).toBe(
      true
    );
  });
  it("分页只切片浏览，打印与导出行包含全部当前筛选而非第一页；作废不计有效金额", () => {
    const records = Array.from({ length: 21 }, (_, index) =>
      record({
        id: index + 1,
        recordNo: `DS-${index + 1}`,
        status: index === 20 ? "void" : "approved",
      })
    );
    const first = paginateDieselReceipts(records, 1, 20);
    const last = paginateDieselReceipts(records, 9, 20);
    expect(first.rows).toHaveLength(20);
    expect(last).toMatchObject({ page: 2, pageCount: 2 });
    expect(last.rows).toHaveLength(1);
    const book = buildDieselReceiptBook(records, props.filterLabel);
    expect(book.rows).toHaveLength(21);
    expect(book.rows[20].cells).toContain("已作废");
    expect(book.summaryLabel).toContain("有效升数 200.000 L");
    expect(book.summaryLabel).toContain("有效金额 ¥1400.00");
    expect(book.summaryLabel).toContain("不含作废 1 条");
    expect(JSON.stringify(book)).not.toContain("/controlled");
    expect(JSON.stringify(book)).not.toContain("fileKey");
  });
  it("默认每页20条且渲染正式发票未知说明、预览按钮和统一打印组件", () => {
    const html = renderToStaticMarkup(
      <DieselReceiptLedger
        {...props}
        records={Array.from({ length: 21 }, (_, index) =>
          record({ id: index + 1, recordNo: `DS-ROW-${index + 1}-END` })
        )}
      />
    );
    expect(html).toContain("DS-ROW-20-END");
    expect(html).not.toContain("DS-ROW-21-END");
    expect(html).toContain("查看加油凭证");
    expect(html).toContain("未建立正式发票关联");
    expect(html).toContain("不代表已开票或未开票");
    expect(html).toContain("导出全部当前筛选");
    expect(html).toContain("打印全部当前筛选");
    const source = readFileSync(
      new URL("./DieselReceiptLedger.tsx", import.meta.url),
      "utf8"
    );
    expect(source).toContain("FinancialLedgerPrintPreviewDialogs");
    expect(source).toContain("book.rows.map(row => row.cells)");
    expect(source).not.toContain("useQuery");
    expect(source).not.toContain("useMutation");
  });
  it.each([{ enabled: false }, { loading: true }, { error: true }])(
    "停用、加载或失败不展示旧数据且禁用导出打印：%s",
    state => {
      const html = renderToStaticMarkup(
        <DieselReceiptLedger {...props} {...state} records={[record()]} />
      );
      expect(html).not.toContain("DS-REAL-1");
      expect(html).toContain("disabled");
      if ("error" in state) {
        expect(html).toContain("加载失败");
        expect(html).not.toContain("暂无柴油记录");
      }
    }
  );
  it("空筛选提供清晰空态，不填充其他业务发票", () => {
    const html = renderToStaticMarkup(
      <DieselReceiptLedger {...props} records={[]} />
    );
    expect(html).toContain("当前筛选范围内暂无柴油记录");
    expect(html).toContain("不加载全项目或其他业务的发票填充");
    expect(paginateDieselReceipts([], -1, 0)).toEqual({
      page: 1,
      pageCount: 1,
      rows: [],
    });
  });
});
