import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queries: [] as Array<{ input: unknown; options: { enabled?: boolean } }>,
  prints: [] as Array<{ title: string; rows: unknown[]; summaryLabel: string }>,
  data: {} as Record<string, unknown>,
  mutations: vi.fn(),
  section: "materials" as "materials" | "batches" | "review",
}));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) =>
      actual.useState(initial === "materials" ? mocks.section : initial),
  };
});
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ finance: { taxWorkspace: { invalidate: vi.fn() } } }),
    finance: new Proxy(
      {},
      {
        get: (_target, name) => ({
          useQuery: (input: unknown, options: { enabled?: boolean }) => {
            mocks.queries.push({ input, options });
            return {
              data: name === "taxWorkspace" ? mocks.data : undefined,
              isLoading: false,
              isFetching: false,
              error: null,
              refetch: vi.fn(),
            };
          },
          useMutation: () => ({ mutate: mocks.mutations, isPending: false }),
        }),
      }
    ),
  },
}));
vi.mock("@/components/FinancialLedgerPrintPreviewDialog", () => ({
  FinancialLedgerPrintPreviewDialog: (props: {
    title: string;
    rows: unknown[];
    summaryLabel: string;
  }) => {
    mocks.prints.push(props);
    return null;
  },
}));
import TaxAccountingHandoffManager from "./TaxAccountingHandoffManager";
import TaxComplianceControlPanel from "./TaxComplianceControlPanel";

beforeEach(() => {
  // Project Vitest uses classic JSX while application Vite uses the automatic runtime.
  vi.stubGlobal("React", React);
  mocks.queries = [];
  mocks.prints = [];
  mocks.mutations.mockClear();
  mocks.section = "materials";
  mocks.data = {
    projectProfile: null,
    entityOptions: [],
    entries: [],
    handoffBatches: [],
    workers: [],
    payrollTaxEntries: [],
    contracts: [],
    contractTaxEntries: [],
    crossRegionLedger: null,
  };
});

function profile() {
  mocks.data.projectProfile = {
    id: 1,
    taxEntityId: 4,
    status: "active",
    projectLocation: "测试项目所在地",
    taxMethod: "general",
    contractExTaxAmount: "100",
    crossRegionConstruction: false,
  };
}

describe("财税交接界面读取与分页", () => {
  it("专业复核子页只由复核面板启用读取，主层资料query关闭", () => {
    mocks.section = "review";
    renderToStaticMarkup(
      <TaxAccountingHandoffManager projectId={7} period="2026-11" />
    );
    const queries = mocks.queries.filter(
      query => "period" in (query.input as object)
    );
    expect(queries.map(query => query.options.enabled)).toEqual([false, true]);
    expect(mocks.mutations).not.toHaveBeenCalled();
  });
  it("交接批次仅分页展示20行，但全量打印保留25条历史记录", () => {
    mocks.section = "batches";
    mocks.data.handoffBatches = Array.from({ length: 25 }, (_, index) => ({
      id: index + 1,
      batchNo: `唯一批次-${index + 1}`,
      handoffType: "combined",
      recordCount: 2,
      generatedAt: new Date("2026-11-01T00:00:00Z"),
      status: "generated",
      snapshotHash: "a".repeat(64),
      receiptReference: null,
    }));
    const html = renderToStaticMarkup(
      <TaxAccountingHandoffManager projectId={7} period="2026-11" />
    );
    expect(html).toContain("唯一批次-20");
    expect(html).not.toContain("唯一批次-21");
    expect(
      mocks.prints.find(item => item.title === "财税资料交接批次明细与汇总表")
        ?.rows
    ).toHaveLength(25);
    expect(mocks.queries[0].options.enabled).toBe(true);
    expect(mocks.mutations).not.toHaveBeenCalled();
  });
  it("默认保持兼容的enabled=true，无档案仍读取基础选项并展示三子页与明确范围", () => {
    const html = renderToStaticMarkup(
      <TaxAccountingHandoffManager
        projectId={7}
        period="2026-11"
        projectLabel="道路工程"
      />
    );
    expect(mocks.queries[0]).toEqual({
      input: { projectId: 7, period: "2026-11" },
      options: { enabled: true },
    });
    expect(html).toContain("内部资料");
    expect(html).toContain("交接批次");
    expect(html).toContain("专业复核");
    expect(html).toContain("道路工程");
    expect(html).toContain("2026-11");
    expect(html).toContain("低频配置");
    expect(html).toContain("待配置，请先维护");
    expect(html).not.toContain("<details open");
    expect(mocks.mutations).not.toHaveBeenCalled();
  });
  it("主财税栏目隐藏不启用工作区或敏感快照查询", () => {
    renderToStaticMarkup(
      <TaxAccountingHandoffManager
        projectId={7}
        period="2026-11"
        enabled={false}
      />
    );
    expect(mocks.queries.every(query => query.options.enabled === false)).toBe(
      true
    );
    expect(mocks.mutations).not.toHaveBeenCalled();
  });
  it("内部辅助事项仅渲染20行，但打印和汇总始终包含全部25行", () => {
    profile();
    mocks.data.entries = Array.from({ length: 25 }, (_, index) => ({
      id: index + 1,
      subject: `唯一辅助事项-${index + 1}`,
      entryType: "other",
      period: "2026-11",
      amount: "10",
      reportedTaxAmount: null,
      status: "pending",
      sourceType: null,
      sourceId: null,
      documentReference: null,
      notes: null,
    }));
    const html = renderToStaticMarkup(
      <TaxAccountingHandoffManager projectId={7} period="2026-11" />
    );
    expect(html).toContain("唯一辅助事项-20");
    expect(html).not.toContain("唯一辅助事项-21");
    const print = mocks.prints.find(
      item => item.title === "财税辅助事项明细与汇总表"
    );
    expect(print?.rows).toHaveLength(25);
    expect(print?.summaryLabel).toContain("25 项");
    expect(print?.summaryLabel).toContain("¥250.00");
  });
  it("专业面板独立enabled控制且无档案仍读取，不因空配置禁用query", () => {
    let html = renderToStaticMarkup(
      <TaxComplianceControlPanel
        projectId={7}
        period="2026-11"
        onConfigure={() => {}}
      />
    );
    expect(mocks.queries[0].options.enabled).toBe(true);
    expect(html).toContain("前往内部资料配置");
    expect(html).toContain("当前月份：");
    mocks.queries = [];
    html = renderToStaticMarkup(
      <TaxComplianceControlPanel
        projectId={7}
        period="2026-11"
        enabled={false}
      />
    );
    expect(mocks.queries[0].options.enabled).toBe(false);
    expect(html).not.toContain('data-state="open"');
    expect(mocks.mutations).not.toHaveBeenCalled();
  });
  it("薪税和合同长表本地分页，全量打印及原金额汇总不受分页影响", () => {
    profile();
    mocks.data.payrollTaxEntries = Array.from({ length: 25 }, (_, index) => ({
      id: index + 1,
      workerId: index + 1,
      incomeType: "resident_wage_salary",
      sourceGrossIncome: "1000",
      cumulativeTaxableIncome: "100",
      calculatedCurrentWithholding: "10",
      externallyWithheldThisPeriod: null,
      applicableRate: "0.03",
      sourceDocumentCount: 1,
      status: "draft",
    }));
    mocks.data.contractTaxEntries = Array.from({ length: 25 }, (_, index) => ({
      id: index + 1,
      contractId: index + 1,
      contractNoSnapshot: `唯一合同-${index + 1}`,
      counterpartyNameSnapshot: "真实往来方",
      contractAmountSnapshot: "1000",
      professionallyConfirmedTaxAmount: "3",
      taxItem: null,
      taxBaseAmount: null,
      status: "pending_review",
    }));
    const html = renderToStaticMarkup(
      <TaxComplianceControlPanel projectId={7} period="2026-11" />
    );
    expect(html).toContain("人员#20");
    expect(html).not.toContain("人员#21");
    expect(html).toContain("唯一合同-20");
    expect(html).not.toContain("唯一合同-21");
    const payroll = mocks.prints.find(
      item => item.title === "薪税辅助台账明细与汇总表"
    );
    const contract = mocks.prints.find(
      item => item.title === "合同税费资料明细与汇总表"
    );
    expect(payroll?.rows).toHaveLength(25);
    expect(payroll?.summaryLabel).toContain("¥250.00");
    expect(contract?.rows).toHaveLength(25);
    expect(contract?.summaryLabel).toContain("¥75.00");
    expect(mocks.mutations).not.toHaveBeenCalled();
  });
});
