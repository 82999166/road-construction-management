import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import * as XLSX from "@e965/xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatAmount } from "../../../shared/numberFormat";
import { formatChinaDateTime, toDeviceDateInput } from "../lib/businessTime";
import { documentNumberText } from "./StoredDocumentNumber";
import { getBusinessStatusLabel } from "./BusinessStatusBadge";

// Execute the real AdminPage functions and the entire DailyWageLedger export
// callback. Only the refetch result, browser globals, toast and download filename
// are adapted; neither the mapper, filter, exporter nor XLSX is mocked.
const source = readFileSync(new URL("../pages/AdminPage.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("AdminPage.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findOne<T extends ts.Node>(predicate: (node: ts.Node) => node is T): T {
  const found: T[] = [];
  function visit(node: ts.Node) {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (found.length !== 1) throw new Error(`Expected one real source node, found ${found.length}`);
  return found[0];
}
function functionText(name: string) {
  return findOne((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === name
  ).getText(tree);
}
const exportAttribute = findOne((node): node is ts.JsxAttribute =>
  ts.isJsxAttribute(node) && node.name.getText(tree) === "onExportWorkbook" &&
  ts.isJsxSelfClosingElement(node.parent.parent) &&
  node.parent.parent.tagName.getText(tree) === "DailyWageLedger"
);
if (!exportAttribute.initializer || !ts.isJsxExpression(exportAttribute.initializer) ||
    !exportAttribute.initializer.expression) throw new Error("Missing actual export callback");
const callbackText = exportAttribute.initializer.expression.getText(tree);
const functionNames = [
  "getActiveCsvExportScope", "getActiveDailyWageWorkbookFilter", "downloadXlsxWorkbook",
  "exportMoney", "toBusinessDateInput", "toLocalDateInput", "displayDate",
];
const realDependencies = { formatAmount, formatChinaDateTime, toDeviceDateInput, documentNumberText, getBusinessStatusLabel };
function evaluate(code: string, dependencies: Record<string, unknown>) {
  const javascript = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function("require", ...Object.keys(dependencies), javascript)(
    createRequire(import.meta.url), ...Object.values(dependencies)
  );
}
type Cell = string | number | null | undefined;
type Sheet = { name: string; headers: string[]; rows: Cell[][] };
type Filter = { dateFrom: string; dateTo: string; keyword: string; team: string; status: string };
type RealHelpers = {
  downloadXlsxWorkbook: (filename: string, sheets: Sheet[], scope?: { module: string; filters: Array<[string, Cell]> }) => Promise<void>;
  getActiveDailyWageWorkbookFilter: () => Filter | undefined;
};
const helpers: RealHelpers = evaluate(
  functionNames.map(functionText).join("\n") + `\nreturn { ${functionNames.join(", ")} };`,
  realDependencies
);
const all: Filter = { dateFrom: "", dateTo: "", keyword: "", team: "all", status: "all" };
const targetNo = "DW2026112420443012345678900001";
const expectedHeaders = ["正式单号", "人员", "班组", "期间/日期", "应发", "扣款", "实发", "开户行", "银行卡", "状态", "实际付款日期"];
const row = (id: number, workerName: string, settlementDate: string, teamName: string | null, status: string, extra: Record<string, unknown> = {}) => ({
  id, documentNo: `DW202611242044300000${id}`, workerName, settlementDate, teamName, status,
  payableAmount: "100.005", deductionAmount: "0.005", actualAmount: "100.000",
  bankName: "项目开户行", bankAccountMasked: "6222000000000000001", paidAt: null,
  ...extra,
});
const dailyRows = [
  row(101, "新增合法人员", "2026-11-24T00:00:00+08:00", "新建班组", "approved", { documentNo: targetNo }),
  row(102, "其他人员", "2026-11-24", "新建班组", "approved"),
  row(103, "新增合法人员·旧日期", "2026-11-23", "新建班组", "approved"),
  row(104, "新增合法人员·另班组", "2026-11-24", "路基组", "approved"),
  row(105, "新增合法人员·草稿", "2026-11-24", "新建班组", "draft"),
  row(106, "王班长", "2026-11-24", "路基组", "reviewing", { documentNo: null }),
  row(107, "旧历史员工", "2026-11-25", null, "paid", { documentNo: undefined, payableAmount: null, deductionAmount: undefined, actualAmount: "", bankName: null, bankAccountMasked: null, paidAt: "2026-11-25T08:30:00+08:00" }),
  row(108, "NewWorker", "2026-11-26", null, "partial", { id: 9007199254740991, documentNo: null, payableAmount: 0, deductionAmount: "-1.005", actualAmount: "1.005" }),
  row(109, "边界员工", "2026-11-22", "新建班组", "approved"),
  row(110, "终点员工", "2026-11-26", "新建班组", "approved"),
  row(111, "新增合法人员·未来日期", "2026-11-25", "新建班组", "approved"),
];
const companyNo = "PY2026112420443098765432100001";
const data = {
  dailyRows,
  payrollRows: [
    { ...row(201, "公司管理员", "2026-11-24", null, "paid"), documentNo: companyNo, workerCategory: "company_admin", period: "2026-11" },
    { ...row(202, "劳务员工", "2026-11-24", "路基组", "draft"), documentNo: null, workerCategory: "labor_team", period: "2026-11" },
  ],
};
const originalData = structuredClone(data);
let directory: string;
let capturedSheets: Sheet[];
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "daily-wage-export-integrity-"));
  capturedSheets = [];
  vi.stubGlobal("window", {
    __roadConstructionExportScope: { module: "当前授权工资分类报表", filters: [["项目", "测试授权项目"]] },
  });
});
afterEach(() => {
  expect(data).toEqual(originalData);
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllGlobals();
});
async function exportRealWorkbook(filter?: Partial<Filter>) {
  const active = filter === undefined ? undefined : { ...all, ...filter };
  const target = window as unknown as { __roadConstructionDailyWageExportFilter?: Filter };
  if (active) target.__roadConstructionDailyWageExportFilter = active;
  expect(helpers.getActiveDailyWageWorkbookFilter()).toBe(active);
  let pending: Promise<void> | undefined;
  let output = "";
  const callback: () => Promise<void> = evaluate(`return (${callbackText});`, {
    ...realDependencies, ...helpers,
    // These are real source helpers, needed by the callback's real mappers.
    ...evaluate(functionNames.filter(name => name !== "downloadXlsxWorkbook").map(functionText).join("\n") +
      `\nreturn { ${functionNames.filter(name => name !== "downloadXlsxWorkbook").join(", ")} };`, realDependencies),
    payrollWorkbookExport: { refetch: async () => ({ data }) },
    laborPeriod: "2026-11", toast: { error: vi.fn(), success: vi.fn() },
    downloadXlsxWorkbook: (filename: string, sheets: Sheet[]) => {
      output = join(directory, filename);
      capturedSheets = structuredClone(sheets);
      pending = helpers.downloadXlsxWorkbook(output, sheets);
      return pending;
    },
  });
  await callback();
  expect(pending).toBeDefined();
  await pending;
  const bytes = readFileSync(output);
  expect(bytes.subarray(0, 2).toString()).toBe("PK");
  const workbook = XLSX.read(bytes, { type: "buffer" });
  expect(workbook.SheetNames).toEqual(["汇总说明", "公司管理人员", "临时日结", "劳务队-路基组"]);
  for (const name of workbook.SheetNames.slice(1)) {
    expect(readRows(workbook, name)[0]).toEqual(expectedHeaders);
  }
  // A daily-only filter must not delete authorized payroll sheet rows.
  expect(readRows(workbook, "公司管理人员")[1][0]).toBe(companyNo);
  expect(readRows(workbook, "劳务队-路基组")[1][1]).toBe("劳务员工");
  return workbook;
}
function readRows(workbook: XLSX.WorkBook, name = "临时日结"): Cell[][] {
  return XLSX.utils.sheet_to_json<Cell[]>(workbook.Sheets[name], { header: 1, defval: "", raw: true });
}
function expectDaily(workbook: XLSX.WorkBook, names: string[]) {
  const rows = readRows(workbook);
  expect(rows.slice(1).map(record => record[expectedHeaders.indexOf("人员")])).toEqual(names);
  expect(rows).toHaveLength(names.length + 1);
  expect(readRows(workbook, "汇总说明")).toContainEqual(["临时日结", names.length]);
}

describe("日结导出筛选完整性：真实 getter + Admin 回调/mapper + exporter + XLSX", () => {
  it("新增正式单号后，日期/人员/班组/状态交集仍仅导出一个新增合法人员", async () => {
    const workbook = await exportRealWorkbook({ dateFrom: "2026-11-24", dateTo: "2026-11-24", keyword: "  新增合法人员  ", team: "新建班组", status: "approved" });
    expectDaily(workbook, ["新增合法人员"]);
    expect(readRows(workbook)[1]).toEqual([targetNo, "新增合法人员", "新建班组", "2026-11-24", "100.01", "0.01", "100.00", "项目开户行", "6222000000000000001", getBusinessStatusLabel("approved"), ""]);
    expect(workbook.Sheets["临时日结"]["!autofilter"]?.ref).toBe("A1:K2");
    const overview = readRows(workbook, "汇总说明");
    expect(overview).toContainEqual(["筛选条件 · 日结日期起", "2026-11-24"]);
    expect(overview).toContainEqual(["筛选条件 · 日结班组", "新建班组"]);
    expect(overview).toContainEqual(["筛选条件 · 日结状态", "approved"]);
  });

  it.each<{ label: string; filter: Partial<Filter>; names: string[] }>([
    { label: "仅人员关键词", filter: { keyword: "新增合法人员" }, names: ["新增合法人员", "新增合法人员·旧日期", "新增合法人员·另班组", "新增合法人员·草稿", "新增合法人员·未来日期"] },
    { label: "人员+日期", filter: { keyword: "新增合法人员", dateFrom: "2026-11-24", dateTo: "2026-11-24" }, names: ["新增合法人员", "新增合法人员·另班组", "新增合法人员·草稿"] },
    { label: "人员+班组+状态", filter: { keyword: "新增合法人员", team: "新建班组", status: "approved" }, names: ["新增合法人员", "新增合法人员·旧日期", "新增合法人员·未来日期"] },
    { label: "人员+日期+班组+草稿", filter: { keyword: "新增合法人员", dateFrom: "2026-11-24", dateTo: "2026-11-24", team: "新建班组", status: "draft" }, names: ["新增合法人员·草稿"] },
    { label: "班组关键词大小写无关", filter: { keyword: "  nEwWoRkEr  " }, names: ["NewWorker"] },
    { label: "班组名字也可作关键词", filter: { keyword: "路基组", status: "reviewing" }, names: ["王班长"] },
    { label: "空班组归未设置班组", filter: { team: "未设置班组" }, names: ["旧历史员工", "NewWorker"] },
    { label: "空班组+日期+已发放", filter: { team: "未设置班组", dateFrom: "2026-11-25", dateTo: "2026-11-25", status: "paid" }, names: ["旧历史员工"] },
    { label: "部分状态真实中文映射", filter: { status: "partial" }, names: ["NewWorker"] },
    { label: "日期起止均包含边界", filter: { dateFrom: "2026-11-22", dateTo: "2026-11-26", team: "新建班组", status: "approved" }, names: ["新增合法人员", "其他人员", "新增合法人员·旧日期", "边界员工", "终点员工", "新增合法人员·未来日期"] },
    { label: "仅日期起", filter: { dateFrom: "2026-11-26" }, names: ["NewWorker", "终点员工"] },
    { label: "仅日期止", filter: { dateTo: "2026-11-23" }, names: ["新增合法人员·旧日期", "边界员工"] },
    { label: "空白关键词等于未筛人员", filter: { keyword: "   ", status: "reviewing" }, names: ["王班长"] },
    { label: "不匹配结果不能回退全量", filter: { keyword: "不存在的人员" }, names: [] },
    { label: "正式单号不能冒充人员", filter: { keyword: targetNo }, names: [] },
    { label: "银行卡不能冒充人员", filter: { keyword: "6222000000000000001" }, names: [] },
    { label: "人员ID不能冒充人员", filter: { keyword: "9007199254740991" }, names: [] },
    { label: "交集冲突为零而非条件并集", filter: { keyword: "新增合法人员", team: "未设置班组", status: "approved", dateFrom: "2026-11-24", dateTo: "2026-11-24" }, names: [] },
  ])("$label", async ({ filter, names }) => {
    expectDaily(await exportRealWorkbook(filter), names);
  });

  it.each([undefined, {}])("无活动筛选/全部筛选保留全量、历史号、空值、两位金额且不导出ID：%j", async filter => {
    const workbook = await exportRealWorkbook(filter);
    expectDaily(workbook, dailyRows.map(record => record.workerName));
    const historical = readRows(workbook).find(record => record[1] === "旧历史员工")!;
    expect(historical).toEqual(["历史未编统一号", "旧历史员工", "", "2026-11-25", "", "", "", "", "", getBusinessStatusLabel("paid"), formatChinaDateTime("2026-11-25T08:30:00+08:00")]);
    const zero = readRows(workbook).find(record => record[1] === "NewWorker")!;
    expect(zero.slice(4, 7)).toEqual(["0.00", "-1.01", "1.01"]);
    expect(zero[0]).toBe("历史未编统一号");
    expect(expectedHeaders).not.toContain("ID");
    expect(readRows(workbook).flat()).not.toContain(9007199254740991);
    expect(dailyRows[7].id).toBe(9007199254740991);
    for (const record of readRows(workbook).slice(1)) {
      for (const amount of record.slice(4, 7)) {
        expect(amount === "" || /^-?\d+\.\d{2}$/.test(String(amount))).toBe(true);
      }
    }
  });

  it("字段整体重排后仍按当前 sheet.headers 定位，而非仅把旧下标整体加一", async () => {
    await exportRealWorkbook();
    const daily = capturedSheets.find(sheet => sheet.name === "临时日结")!;
    const permutation = [9, 0, 8, 2, 6, 3, 10, 4, 1, 7, 5];
    const reordered: Sheet = { name: daily.name, headers: permutation.map(index => daily.headers[index]), rows: daily.rows.map(record => permutation.map(index => record[index])) };
    (window as unknown as { __roadConstructionDailyWageExportFilter: Filter }).__roadConstructionDailyWageExportFilter = { ...all, dateFrom: "2026-11-24", dateTo: "2026-11-24", keyword: "新增合法人员", team: "新建班组", status: "approved" };
    const filename = join(directory, "reordered.xlsx");
    await helpers.downloadXlsxWorkbook(filename, [reordered]);
    const workbook = XLSX.read(readFileSync(filename), { type: "buffer" });
    const exported = readRows(workbook);
    expect(exported).toHaveLength(2);
    expect(exported[0]).toEqual(reordered.headers);
    expect(exported[1][reordered.headers.indexOf("人员")]).toBe("新增合法人员");
    expect(exported[1][reordered.headers.indexOf("正式单号")]).toBe(targetNo);
    expect(exported[1]).toEqual(permutation.map(index => daily.rows[0][index]));
    expect(readRows(workbook, "汇总说明")).toContainEqual(["临时日结", 1]);
  });
});
