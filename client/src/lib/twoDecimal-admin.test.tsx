import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as XLSX from "@e965/xlsx";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatAmount, formatQuantity } from "@shared/numberFormat";
import { documentNumberText } from "@/components/StoredDocumentNumber";

// Execute the actual AdminPage functions and output expressions without mounting
// its unrelated RPC workspaces; no copied formatter or source-string assertions.
const source = readFileSync(new URL("../pages/AdminPage.tsx", import.meta.url), "utf8");
const file = ts.createSourceFile("AdminPage.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes: ts.Node[] = [];
function collect(node: ts.Node) {
  nodes.push(node);
  ts.forEachChild(node, collect);
}
collect(file);
const common = {
  React, formatAmount, formatQuantity, documentNumberText, Number, String,
  displayDate: (value: unknown) => String(value),
  toBusinessDateInput: (value: unknown) => String(value),
  formatChinaDateTime: () => "2026-11-14 12:00",
  getBusinessStatusLabel: (value: unknown) => String(value),
  getPayrollWorkerCategoryLabel: (value: unknown) => String(value),
  getAttendanceSourceLabel: (value: unknown) => String(value),
  getInvoiceTypeLabel: (value: unknown) => String(value),
  expenseCategoryDisplay: (value: unknown) => String(value),
  expenseSourceDisplay: (value: unknown) => String(value),
  financeSourceTypeDisplay: (value: unknown) => String(value),
  financeSettlementStatusDisplay: (value: unknown) => String(value),
  getDieselRecordSourceLabel: () => "车辆录入",
};
function execute(code: string, context: Record<string, unknown> = {}) {
  const scope = { ...common, ...context };
  const compiled = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(scope), `${compiled}\nreturn __result;`)(...Object.values(scope));
}
function declaration(name: string) {
  const node = nodes.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!node) throw new Error(`Missing actual function: ${name}`);
  return execute(`${node.getText(file)}\nconst __result = ${name};`);
}
const displayMoney = declaration("displayMoney");
const displayUnitQuantity = declaration("displayUnitQuantity");
const exportMoney = declaration("exportMoney");
const exportQuantity = declaration("exportQuantity");
function expression(node: ts.Node, context: Record<string, unknown> = {}) {
  return execute(`const __result = (${node.getText(file)});`, { displayMoney, displayUnitQuantity, exportMoney, exportQuantity, ...context });
}
function csvCall(prefix: string) {
  const call = nodes.find(node => ts.isCallExpression(node)
    && node.expression.getText(file) === "downloadCsvFile"
    && node.arguments[0]?.getText(file).includes(prefix));
  if (!call || !ts.isCallExpression(call)) throw new Error(`Missing actual CSV export: ${prefix}`);
  return call;
}
function mappedRows(prefix: string, context: Record<string, unknown>) {
  return expression(csvCall(prefix).arguments[2], context) as Array<Array<string | number>>;
}
function csvHeaders(prefix: string) {
  return expression(csvCall(prefix).arguments[1]) as string[];
}
function cells(headers: string[], row: Array<string | number>, names: string[]) {
  expect(row).toHaveLength(headers.length);
  return names.map(name => {
    const index = headers.indexOf(name);
    expect(index, `真实导出缺少表头 ${name}`).toBeGreaterThan(-1);
    return row[index];
  });
}
function csvCells(prefix: string, rows: Array<Array<string | number>>, names: string[]) {
  return cells(csvHeaders(prefix), rows[0], names);
}
// 从真实mapper的词法祖先块读取配套header，避免从其他导出误取同名变量。
function headersInScope(anchor: ts.Node, name: string): string[] {
  for (let parent = anchor.parent; parent; parent = parent.parent) {
    if (!ts.isBlock(parent)) continue;
    for (const statement of parent.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      const declaration = statement.declarationList.declarations.find(node => node.name.getText(file) === name);
      if (declaration?.initializer) return expression(declaration.initializer) as string[];
    }
  }
  throw new Error(`Missing actual scoped headers: ${name}`);
}
function variable(name: string, context: Record<string, unknown>) {
  const node = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(file) === name);
  if (!node || !ts.isVariableDeclaration(node) || !node.initializer) throw new Error(`Missing actual variable: ${name}`);
  return expression(node.initializer, context);
}
function metricValue(title: string, context: Record<string, unknown>) {
  const metric = nodes.find(node => ts.isJsxSelfClosingElement(node)
    && node.tagName.getText(file) === "MetricCard"
    && node.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(file) === "title"
      && attr.initializer && ts.isStringLiteral(attr.initializer) && attr.initializer.text === title));
  if (!metric || !ts.isJsxSelfClosingElement(metric)) throw new Error(`Missing actual metric: ${title}`);
  const attr = metric.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(file) === "value");
  if (!attr || !ts.isJsxAttribute(attr) || !attr.initializer || !ts.isJsxExpression(attr.initializer) || !attr.initializer.expression) throw new Error("Missing metric value");
  return expression(attr.initializer.expression, context);
}
const numeric = Object.freeze({
  workerName: "人员3", teamName: "班组", period: "2026-11", settlementDate: "2026-11-14",
  payableAmount: 430.432, deductionAmount: 0, actualAmount: "3", paidAt: null,
  bankName: "银行", bankAccountMasked: "****430432", bankAccount: "622243043200000003",
  status: "approved", recordNo: "ID430432", occurredAt: "2026-11-14", direction: "income",
  category: "test", sourceType: "test", settlementStatus: "test", remarks: "备注3",
  label: "柴油", amount: 430.432, percentage: 3.123, recordCount: 3, sources: ["test"],
  parentCode: "test", source: "test", documentNo: "ID430432", subcategory: "test", details: "说明",
  invoiceNo: "43043200003", counterpartyName: "客户", issuedAt: "2026-11-14", invoiceType: "normal", taxAmount: 0,
  assetName: "车辆", assetType: "vehicle", liters: "430.432", appliedUnitPrice: "3", supplyMethod: "project_supply",
  deductFromFreight: false, refueledAt: "2026-11-14", workHours: "3", overtimeHours: 430.432, workerId: 3,
  attendanceDate: "2026-11-14", paymentReference: "43043200003",
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("admin business decimals — actual page output", () => {
  it("executes real money/unit formatters: fixed decimals, zero, missing and integer units", () => {
    expect([3, "430.432", 0, "1.005", "-1.005"].map(displayMoney)).toEqual(["3.00", "430.43", "0.00", "1.01", "-1.01"]);
    expect([null, undefined, "", "bad", Infinity].map(displayMoney)).toEqual(["—", "—", "—", "—", "—"]);
    expect(displayMoney("1234.567")).toBe("1,234.57");
    for (const unit of ["m3", "m2", "m", "t", "L", "小时"]) expect(displayUnitQuantity(3, unit)).toBe("3.00");
    for (const unit of ["piece", "set", "件", "台", "人", "趟", "天", "日"]) expect(displayUnitQuantity(3, unit)).toBe("3");
    expect(displayUnitQuantity(0, "L")).toBe("0.00");
    expect(displayUnitQuantity(null, "L")).toBe("—");
    expect(numeric.amount).toBe(430.432);
  });

  it("keeps unknown export cells blank while retaining real numeric zero", () => {
    for (const formatter of [exportMoney, exportQuantity]) {
      expect([null, undefined, ""].map(formatter)).toEqual(["", "", ""]);
      expect(formatter(0)).toBe("0.00");
      expect(formatter("0")).toBe("0.00");
    }
    const rows = mappedRows("劳务考勤-", { visibleAttendance: [{ ...numeric, workHours: null, overtimeHours: 0 }], workerById: new Map() });
    expect(csvCells("劳务考勤-", rows, ["正常工时", "加班工时"])).toEqual(["", "0.00"]);
    const invoices = mappedRows("发票台账-", { financeInvoiceRows: [{ ...numeric, amount: null, taxAmount: null }] });
    expect(csvCells("发票台账-", invoices, ["金额", "税额"])).toEqual(["", "0.00"]);
  });

  it("renders actual responsive MetricCard with formatted finance/risk values and unchanged counters", () => {
    const context = { financeSummary: { data: { incomeAmount: 3, expenseAmount: 430.432, receivableAmount: 0, payableAmount: 3, netCashFlowAmount: -3, profitAmount: 3 } }, financeInvoices: { data: { summary: { totalAmount: 3, pendingAmount: 0 } } }, riskFinanceAnalysis: { data: { expenseAmount: 430.432 } } };
    const metricNode = nodes.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "MetricCard")!;
    const Wrapper = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
    const MetricCard = execute(`${metricNode.getText(file)}\nconst __result = MetricCard;`, { Card: Wrapper, CardContent: Wrapper });
    for (const [title, expected] of [["确认收入（资金总账）", "3.00"], ["项目开支（资金总账）", "430.43"], ["应收余额", "0.00"], ["应付余额", "3.00"], ["本期现金净流", "-3.00"], ["本期收支差额（资金总账）", "3.00"], ["已开票金额", "3.00"], ["待认证发票", "0.00"], ["本期成本", "430.43"]]) {
      const html = renderToStaticMarkup(React.createElement(MetricCard, { title, value: metricValue(title, context), description: "真实金额", icon: () => null }));
      expect(html).toContain(expected);
    }
    expect(metricValue("确认收入（资金总账）", { financeSummary: { data: undefined } })).toBe("—");
    expect(renderToStaticMarkup(React.createElement(MetricCard, { title: "计数", value: 3, description: "3人", icon: () => null }))).not.toContain("3.00");
  });

  it("executes all explicit numeric CSV row mappers, preserving dates, IDs, accounts and percentages", () => {
    const payroll = mappedRows("工资条-", { visiblePayrolls: [numeric], workspaceProjectId: 3, laborPeriod: "2026-11" });
    expect(csvCells("工资条-", payroll, ["应发金额", "扣款", "实发金额"])).toEqual(["430.43", "0.00", "3.00"]);
    expect(csvCells("工资条-", payroll, ["正式单号"])).toEqual(["ID430432"]);
    expect(csvCells("工资条-", payroll, ["付款凭证"])).toEqual(["43043200003"]);
    const attendance = mappedRows("劳务考勤-", { visibleAttendance: [numeric], workerById: new Map() });
    expect(csvCells("劳务考勤-", attendance, ["正常工时", "加班工时"])).toEqual(["3.00", "430.43"]);
    expect(csvCells("劳务考勤-", attendance, ["考勤日期"])).toEqual(["2026-11-14"]);
    const finance = mappedRows("项目资金总账-", { financeLedgerRows: [numeric] });
    expect(csvCells("项目资金总账-", finance, ["金额"])).toEqual(["430.43"]);
    expect(csvCells("项目资金总账-", finance, ["单号"])).toEqual(["ID430432"]);
    for (const prefix of ["财务分类汇总-", "项目成本分类-"]) {
      const rows = mappedRows(prefix, { riskFinanceAnalysis: { data: { categories: [numeric] } } });
      expect(rows[0].slice(1, 4)).toEqual(["430.43", "3.123%", 3]);
    }
    const subcategory = mappedRows("财务小类目汇总-", { riskFinanceAnalysis: { data: { subcategories: [numeric] } } });
    expect(subcategory[0].slice(2, 5)).toEqual(["430.43", "3.123%", 3]);
    expect(mappedRows("项目支出分类明细-", { expenseCategoryDetails: { data: { records: [numeric] } } })[0][6]).toBe("430.43");
    const diesel = mappedRows("柴油领用明细-", { dieselRefuelRecords: { data: [numeric] } });
    expect(csvCells("柴油领用明细-", diesel, ["升数", "适用单价", "金额"])).toEqual(["430.43", "3.00", "430.43"]);
    const invoices = mappedRows("发票台账-", { financeInvoiceRows: [numeric] });
    expect(csvCells("发票台账-", invoices, ["金额", "税额"])).toEqual(["430.43", "0.00"]);
    expect(csvCells("发票台账-", invoices, ["发票号码"])).toEqual(["43043200003"]);
    expect(numeric.liters).toBe("430.432");
  });

  it("runs real CSV download serialization with fixed numeric output and untouched source rows", async () => {
    const rows = mappedRows("柴油领用明细-", { dieselRefuelRecords: { data: [numeric] } });
    let blob: Blob | undefined;
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal("document", { createElement: () => anchor, body: { appendChild: vi.fn() } });
    vi.spyOn(URL, "createObjectURL").mockImplementation(value => { blob = value as Blob; return "blob:admin"; });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    declaration("downloadCsvFile")("admin.csv", csvHeaders("柴油领用明细-"), rows, { module: "admin", filters: [["项目ID", 3]] });
    const csv = await blob!.text();
    expect(csv).toContain('"430.43","3.00","430.43"');
    expect(csv).toContain('"筛选条件 · 项目ID","3"');
    expect(csv).toContain('"导出记录数","1"');
    const workbook = XLSX.read(csv, { type: "string", raw: true });
    const parsed = XLSX.utils.sheet_to_json<Array<string | number>>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: true });
    const headerIndex = parsed.findIndex(row => row.includes("升数") && row.includes("适用单价"));
    expect(headerIndex).toBeGreaterThan(-1);
    expect(cells(parsed[headerIndex] as string[], parsed[headerIndex + 1], ["升数", "适用单价", "金额", "单号"])).toEqual(["430.43", "3.00", "430.43", "ID430432"]);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(numeric.liters).toBe("430.432");
  });

  it("runs real workbook exporter and reads generated Excel cells with fixed display strings", async () => {
    const payrollRows = variable("toPayrollRows", {})([numeric]);
    const dailyRows = variable("toDailyRows", {})([numeric]);
    const mapper = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(file) === "toPayrollRows")!;
    const standardHeaders = headersInScope(mapper, "standardHeaders");
    for (const rows of [payrollRows, dailyRows]) {
      expect(cells(standardHeaders, rows[0], ["应发", "扣款", "实发"])).toEqual(["430.43", "0.00", "3.00"]);
      expect(cells(standardHeaders, rows[0], ["正式单号", "银行卡"])).toEqual(["ID430432", "****430432"]);
    }
    const paymentPayroll = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(file) === "payrollRows" && node.initializer?.getText(file).startsWith("data.payrollRows.map"));
    const paymentDaily = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(file) === "dailyRows" && node.initializer?.getText(file).startsWith("data.dailyRows.map"));
    for (const node of [paymentPayroll, paymentDaily]) {
      if (!node || !ts.isVariableDeclaration(node) || !node.initializer) throw new Error("Missing payment mapper");
      const rows = expression(node.initializer, { data: { payrollRows: [numeric], dailyRows: [numeric] } });
      const paymentHeaders = headersInScope(node, "headers");
      expect(cells(paymentHeaders, rows[0], ["实发金额", "完整银行卡号", "正式单号"])).toEqual(["3.00", "622243043200000003", "ID430432"]);
    }
    let buffer: Uint8Array | undefined;
    const writeFile = vi.fn(workbook => { buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }); });
    const functionNode = nodes.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "downloadXlsxWorkbook")!;
    const exporter = execute(`${functionNode.getText(file)}\nconst __result = downloadXlsxWorkbook;`, {
      getActiveDailyWageWorkbookFilter: () => undefined,
      require: () => ({ ...XLSX, writeFile }),
    });
    await exporter("admin.xlsx", [{ name: "工资", headers: standardHeaders, rows: payrollRows }, { name: "临时日结", headers: standardHeaders, rows: dailyRows }], { module: "admin", filters: [["项目ID", 3]] });
    const workbook = XLSX.read(buffer!, { type: "array" });
    for (const name of ["工资", "临时日结"]) {
      const sheet = XLSX.utils.sheet_to_json<Array<string | number>>(workbook.Sheets[name], { header: 1, raw: true });
      expect(sheet[0]).toEqual(standardHeaders);
      expect(cells(sheet[0] as string[], sheet[1], ["应发", "扣款", "实发", "正式单号", "银行卡"])).toEqual(["430.43", "0.00", "3.00", "ID430432", "****430432"]);
    }
    expect(workbook.Sheets["汇总说明"].B6.v).toBe(1);
    expect(writeFile).toHaveBeenCalledOnce();
  });

  it("real daily-wage workbook filtering reads the original headers after adding the formal-number column", async () => {
    const filter = { dateFrom: "2026-11-14", dateTo: "2026-11-14", keyword: "人员3", team: "班组", status: "approved" };
    vi.stubGlobal("window", { __roadConstructionDailyWageExportFilter: filter });
    const records = [numeric, { ...numeric, workerName: "非筛选人员", documentNo: "OTHER-ID" }];
    const dailyRows = variable("toDailyRows", {})(records);
    const mapper = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(file) === "toDailyRows")!;
    const headers = headersInScope(mapper, "standardHeaders");
    const functionNode = nodes.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "downloadXlsxWorkbook")!;
    let buffer: Uint8Array | undefined;
    const writeFile = vi.fn(workbook => { buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }); });
    const exporter = execute(`${functionNode.getText(file)}\nconst __result = downloadXlsxWorkbook;`, {
      getActiveDailyWageWorkbookFilter: declaration("getActiveDailyWageWorkbookFilter"),
      require: () => ({ ...XLSX, writeFile }),
    });
    await exporter("daily.xlsx", [{ name: "临时日结", headers, rows: dailyRows }], { module: "admin", filters: [] });
    const workbook = XLSX.read(buffer!, { type: "array" });
    const sheet = XLSX.utils.sheet_to_json<Array<string | number>>(workbook.Sheets["临时日结"], { header: 1, raw: true });
    expect(sheet[0]).toEqual(headers);
    expect(sheet).toHaveLength(2); // 表头 + 唯一符合真实筛选的人员
    expect(cells(sheet[0] as string[], sheet[1], ["正式单号", "人员", "期间/日期", "应发", "扣款", "实发"])).toEqual(["ID430432", "人员3", "2026-11-14", "430.43", "0.00", "3.00"]);
    expect(dailyRows).toHaveLength(2);
    expect(numeric.amount).toBe(430.432);
  });

  it("executes actual governance and daily closure print paths using display-only snapshots", () => {
    const printed = vi.fn();
    const getPrintFunction = (name: string, context: Record<string, unknown>) => variable(name, { openA4LandscapePrintDocument: printed, escapePrintHtml: (value: unknown) => String(value), ...context });
    const dashboard = Object.freeze({ finance: { totalIncome: 3, invoiceAmount: 0, receivable: 430.432, payable: 3, totalExpense: 3, paidAmount: 0, settlementRatio: 3.123, paymentRatio: null, categories: [{ category: "柴油", amount: 430.432, unpaid: 0, paid: 3 }] }, measurement: { declaredAmount: 3, approvedAmount: 0, settledAmount: 430.432, pendingCount: 3 }, resources: { transportTripCount: 3 }, progress: { reportCount: 3 } });
    getPrintFunction("printBusinessGovernanceReport", { operatingDashboard: { data: dashboard }, businessStatistics: { data: [{ name: "柴油", recordCount: 3, code: "D3" }] }, selectedBusinessProject: { name: "项目" }, businessFilter: { period: "2026-11" } })();
    expect(printed).toHaveBeenCalledOnce();
    const html = printed.mock.calls[0][0].bodyHtml;
    expect(html).toContain("¥3.00");
    expect(html).toContain("¥430.43");
    expect(html).toContain("3.1%");
    expect(html).toContain(">3 趟</td>");
    const closure = Object.freeze({ closingNo: "C430432", revision: 3, status: "sealed", totalIncome: 3, totalExpense: 430.432, invoiceCount: 3, invoiceAmount: 0, snapshotHash: "hash430432" });
    getPrintFunction("printDailyAccountingSnapshot", { dailyAccountingReport: { data: { closure } }, selectedWorkspaceProject: { name: "项目" }, financeClosingDate: "2026-11-14" })();
    expect(printed).toHaveBeenCalledTimes(2);
    const closureHtml = printed.mock.calls[1][0].bodyHtml;
    expect(closureHtml).toContain('class="right">3.00</td>');
    expect(closureHtml).toContain('class="right">430.43</td>');
    expect(closureHtml).toContain('class="right">0.00</td>');
    expect(closureHtml).toContain("第 3 版");
    expect(closureHtml).toContain("hash430432");
    expect(closure.totalExpense).toBe(430.432);
  });

  it("executes actual diesel cash preview using unrounded draft operands for calculation", () => {
    const preview = nodes.find(node => ts.isConditionalExpression(node) && node.condition.getText(file) === "dieselRefuelForm.liters && dieselRefuelForm.actualUnitPrice");
    if (!preview) throw new Error("Missing actual cash preview");
    const dieselRefuelForm = Object.freeze({ liters: "430.432", actualUnitPrice: "3.001" });
    const text = expression(preview, { dieselRefuelForm });
    expect(text).toBe(`430.43 L × ¥3.00/L = ¥${formatAmount(430.432 * 3.001)}`);
    expect(dieselRefuelForm).toEqual({ liters: "430.432", actualUnitPrice: "3.001" });
    expect(expression(preview, { dieselRefuelForm: { liters: "0", actualUnitPrice: "0" } })).toBe("0.00 L × ¥0.00/L = ¥0.00");
  });
});
