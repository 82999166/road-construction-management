import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { constructionCsv, constructionPrintBody, constructionReportSheetHtml, CONSTRUCTION_OUTPUT_HEADERS, CONSTRUCTION_PRINT_PHOTO_CSS, constructionOutputRows, type ConstructionWorkspaceReport } from "@/lib/constructionOutput";
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const report: ConstructionWorkspaceReport = { id: 7, documentNo: "CR20261124204430123456780001<&>", projectId: 9, reportDate: "2026-11-24", workArea: "作业面", weather: "sunny", workContent: "正文", constructionPlan: null, safetyNotes: null, issueNotes: null, progressPercent: 20, status: "draft", createdBy: 1, createdByName: "管理员", reviewReply: null, reviewedBy: null, reviewedAt: null, createdAt: "2026-11-24", updatedAt: "2026-11-24" };

describe("编号 UI 最小接线契约与真实输出", () => {
  it.each([
    ["./MachineryCostWorkspace.tsx", "row"],
    ["./PayrollStatementLedger.tsx", "item"],
    ["./DailyWageLedger.tsx", "item"],
    ["./CompanyPersonnelRoster.tsx", "item"],
    ["./UnifiedPersonnelDirectory.tsx", "item"],
  ])("%s 实际台账原对象传入真实号，不改写正式号", (path, variable) => {
    const s = source(path);
    expect(s).toContain(`<StoredDocumentNumber record={${variable}} />`);
    expect(s).not.toMatch(/documentNo\s*=\s*.*(?:Date\.now|Math\.random)/);
  });
  it("移动机械费用、月结及施工PC/移动共同列表显示真值", () => {
    const machine = source("../pages/MobileMachineryPage.tsx");
    expect(machine).toContain("<StoredDocumentNumber record={cost} />");
    expect(machine).toContain("<StoredDocumentNumber record={item} />");
    const construction = source("./ConstructionWorkspace.tsx");
    expect(construction.match(/<StoredDocumentNumber record=\{report\} \/>/g)).toHaveLength(2);
    expect(source("../pages/MobileConstructionPage.tsx")).toContain("<ConstructionWorkspace");
  });
  it("工资CSV/详情和机械费用CSV/打印使用相同真号文本", () => {
    const admin = source("../pages/AdminPage.tsx");
    expect(admin).toContain("documentNumberText(item)");
    expect(admin).toContain('label: "正式单号", value: <StoredDocumentNumber record={item} />');
    const cost = source("./MachineryCostWorkspace.tsx");
    expect(cost).toContain('"正式单号"');
    expect(cost).toContain("documentNumberText(row)");
    expect(cost).toContain('downloadMachineryCsv(`机械费用-${period}.csv`, headers, exportRows)');
    expect(cost).toContain("${exportRows.map(row =>");
  });
  it("四处既有工资/日结Excel行与两表头对应，真实No来自explicit投影", () => {
    const admin = source("../pages/AdminPage.tsx");
    expect(admin.match(/documentNumberText\(row\)/g)).toHaveLength(4);
    const labor = source("../../../server/routers/labor.ts");
    expect(labor.match(/documentNo: payrollStatements\.documentNo/g)).toHaveLength(3);
    expect(labor.match(/documentNo: temporaryDailyWageSettlements\.documentNo/g)).toHaveLength(3);
    expect(labor).toContain("documentNo: string | null;");
  });
  it("原治理、nullable归属、角色能力与柴油source ID四参数仍保留", () => {
    const admin = source("../pages/AdminPage.tsx");
    expect(admin).toContain("payrollCorrectionRoleCodes");
    expect(admin).toContain("financeCorrectionRoleCodes");
    expect(admin).toContain("IdentityDeletionImpactPreview");
    expect(admin).toContain("ScopeReactivationDialog");
    expect(admin).toContain("confirmRestore");
    expect(admin.match(/getDieselRecordSourceLabel\([\s\S]*?item\.recordNo,\s*item\.machineCostSourceId/g)).toHaveLength(4);
    expect(admin).toContain("record.projectId > 0");
    expect(admin).toContain("record={{ ...record, projectId: record.projectId }}");
    expect(source("./DailyWageLedger.tsx")).toContain("roleCodes ? <DailyWageCorrectionActions");
    expect(source("./PayrollStatementLedger.tsx")).toContain("<PayrollCorrectionActions row={item} roleCodes={roleCodes}");
  });
  it("限定客户端业务号不再预生成，照片防伪/内部requestId不当正式单号", () => {
    const admin = source("../pages/AdminPage.tsx");
    expect(admin).toContain("保存成功后由服务器分配正式单号");
    expect(admin).not.toMatch(/(?:requestNo|orderNo|claimNo|tripNo|documentNo)\s*[:=].*(?:Date\.now|Math\.random)/);
    expect(admin).toContain("const antiCounterfeitNo = `DIESEL-");
    expect(admin).toContain("requestId: Date.now()");
    expect(source("./StoredDocumentNumber.tsx")).not.toMatch(/\.slice\(|\.trim\(|Date\.now|Math\.random/);
  });
  it("施工正文/CSV/照片页使用持久原号且明确保留旧ID历史fallback", () => {
    const sheet = constructionReportSheetHtml(report, "工程");
    expect(sheet).toContain("CR20261124204430123456780001&lt;&amp;&gt;");
    expect(sheet).not.toContain("日报编号：7</span>");
    expect(constructionCsv([report], { projectName: "工程", filterText: "当前", total: 1 })).toContain(report.documentNo);
    expect(constructionOutputRows([report])[0]).toHaveLength(CONSTRUCTION_OUTPUT_HEADERS.length);
    const old = { ...report, documentNo: null };
    expect(constructionReportSheetHtml(old, "工程")).toContain("日报编号：7（历史未编统一号）");
    expect(constructionCsv([old], { projectName: "工程", filterText: "当前", total: 1 })).toContain("历史未编统一号");
    const body = constructionPrintBody([report], { projectName: "工程", filterText: "当前", total: 1 }, [{ id: 3, projectId: 9, reportId: 7, fileName: "现场.jpg", capturedAt: "2026-11-24", description: "现场", url: "https://example.com/photo.jpg" }]);
    expect(body).toContain("日报编号：CR20261124204430123456780001&lt;&amp;&gt;");
    expect(body).toContain('data-report-id="7" data-photo-id="3"');
    expect(CONSTRUCTION_PRINT_PHOTO_CSS).toContain("height: 95mm; object-fit: contain");
    expect(CONSTRUCTION_PRINT_PHOTO_CSS).toContain("break-before: page");
  });
  it("实付款voucherNo优先真documentNo的既有server投影、金额与来源保持", () => {
    const server = source("../../../server/routers/settlementPayments.ts");
    expect(server).toContain("voucherNo: payment.documentNo ?? `SPV-${input.projectId}-${payment.id}`");
    const board = source("./SettlementPaymentFinancialBoard.tsx");
    expect(board).toContain("{record.voucherNo}");
    expect(board).toContain("{record.settlementNo}");
    expect(board).toContain("{money(record.amount)}");
  });
});
