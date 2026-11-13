import { escapePrintHtml } from "@/lib/a4Print";
import { formatChinaDate, formatChinaDateTime } from "@/lib/businessTime";
import { getBusinessStatusLabel } from "@/components/BusinessStatusBadge";
import type { ConstructionStatus } from "@shared/constructionWorkspace";
export interface ConstructionWorkspaceReport {
  id: number;
  projectId: number;
  reportDate: Date | string;
  workArea: string;
  weather: "sunny" | "cloudy" | "rainy" | "snowy" | "windy" | "other";
  workContent: string;
  constructionPlan: string | null;
  safetyNotes: string | null;
  issueNotes: string | null;
  progressPercent: string | number;
  status: ConstructionStatus;
  createdBy: number;
  createdByName: string;
  reviewReply: string | null;
  reviewedBy: number | null;
  reviewedByName?: string | null;
  reviewedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}
export const CONSTRUCTION_WEATHER = {
  sunny: "晴",
  cloudy: "多云",
  rainy: "雨",
  snowy: "雪",
  windy: "大风",
  other: "其他",
};
export const CONSTRUCTION_OUTPUT_HEADERS = [
  "序号",
  "日报日期",
  "提交管理员",
  "作业面",
  "天气",
  "累计进度(%)",
  "审核结果",
  "施工计划",
  "施工内容",
  "安全情况",
  "质量/协调问题",
  "审核回复",
  "审核人",
  "审核时间",
];
export interface ConstructionOutputManifest {
  total: number;
  batches: Array<{ batch: number; ids: number[]; from: number; to: number }>;
}
function outputConflict(): never {
  throw Object.assign(
    new Error(
      "施工输出清单总数或记录号已变化，请刷新清单后重新逐批输出；未生成不完整批次"
    ),
    { code: "CONFLICT" }
  );
}
/** 不以相同total冒充相同清单；重复号、缺失号和不连续范围都不能输出。 */
export function assertConstructionOutputManifest(
  manifest: ConstructionOutputManifest
) {
  if (!Number.isSafeInteger(manifest.total) || manifest.total < 0)
    outputConflict();
  const ids = manifest.batches.flatMap(batch => batch.ids);
  if (
    ids.length !== manifest.total ||
    new Set(ids).size !== ids.length ||
    ids.some(id => !Number.isSafeInteger(id) || id < 1)
  )
    outputConflict();
  let offset = 0;
  for (let index = 0; index < manifest.batches.length; index++) {
    const batch = manifest.batches[index];
    if (
      batch.batch !== index + 1 ||
      batch.ids.length < 1 ||
      batch.ids.length > 250 ||
      batch.from !== offset + 1 ||
      batch.to !== offset + batch.ids.length
    )
      outputConflict();
    offset = batch.to;
  }
  return ids;
}
/** 每次用户点击单批前再次鉴权读取全量清单，total或任一ID变化均明确CONFLICT。 */
export function assertConstructionOutputSnapshot(
  expected: ConstructionOutputManifest,
  current: ConstructionOutputManifest
) {
  const expectedIds = assertConstructionOutputManifest(expected);
  const currentIds = assertConstructionOutputManifest(current);
  if (
    expected.total !== current.total ||
    expectedIds.some((id, index) => id !== currentIds[index])
  )
    outputConflict();
}
/** 按清单顺序输出，拒绝同数量替换、重复号与其他项目记录。 */
export function constructionOutputBatchRows(
  rows: readonly ConstructionWorkspaceReport[],
  ids: readonly number[],
  projectId: number
) {
  const byId = new Map(rows.map(row => [row.id, row]));
  if (
    rows.length !== ids.length ||
    byId.size !== ids.length ||
    rows.some(row => row.projectId !== projectId) ||
    ids.some(id => !byId.has(id))
  )
    outputConflict();
  return ids.map(id => byId.get(id)!);
}
export function constructionOutputRows(
  reports: readonly ConstructionWorkspaceReport[],
  offset = 0
) {
  return reports.map((report, index) => [
    index + offset + 1,
    formatChinaDate(report.reportDate),
    report.createdByName,
    report.workArea,
    CONSTRUCTION_WEATHER[report.weather],
    Number(report.progressPercent).toFixed(2),
    getBusinessStatusLabel(report.status),
    report.constructionPlan || "—",
    report.workContent,
    report.safetyNotes || "—",
    report.issueNotes || "—",
    report.reviewReply || "—",
    report.reviewedByName ||
      (report.reviewedBy ? `管理员 #${report.reviewedBy}` : "未审核"),
    report.reviewedAt ? formatChinaDateTime(report.reviewedAt) : "—",
  ]);
}
export interface ConstructionPrintMetadata {
  projectName: string;
  filterText: string;
  total: number;
  offset?: number;
  batchLabel?: string;
}

/**
 * 详情与独立打印文档共用。所有普通选择器均限定到 daily-report-sheet；
 * named page 仅由该表单启用，不改变其他模块的 @page 或打印表格。
 * 有意高于 reportPrintTable.css 的 specificity，并覆盖其 !important：
 * 单元格保留换行；长正文可跨页；不设固定页面高度、裁切或正文省略。
 */
export const CONSTRUCTION_REPORT_SHEET_CSS = `
.daily-report-sheet {
  box-sizing: border-box;
  width: 100%;
  max-width: 186mm;
  min-width: 0;
  margin: 0 auto;
  padding: 0;
  color: #000;
  background: #fff;
  font-family: "SimSun", "Songti SC", "STSong", "Noto Serif CJK SC", serif;
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  word-break: normal;
}
.daily-report-sheet *, .daily-report-sheet *::before, .daily-report-sheet *::after {
  box-sizing: border-box;
}
.daily-report-sheet .daily-report-title {
  margin: 0 0 12px;
  color: #000;
  text-align: center;
  font-family: inherit;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: .3em;
  text-indent: .3em;
}
.daily-report-sheet .daily-report-heading {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 16px;
  margin: 0 0 8px;
  font-size: 13px;
}
.daily-report-sheet .daily-report-heading > span { min-width: 0; }
.daily-report-sheet .daily-report-number { margin-left: auto; text-align: right; }
.daily-report-sheet table.daily-report-table {
  display: table !important;
  width: 100% !important;
  min-width: 0 !important;
  max-width: 100% !important;
  margin: 0;
  border: 1px solid #000 !important;
  border-collapse: collapse !important;
  table-layout: fixed !important;
  font-family: inherit;
  font-size: inherit;
  break-inside:auto;
  page-break-inside: auto;
}
.daily-report-sheet .daily-report-table .daily-report-label-column { width: 56px; }
.daily-report-sheet .daily-report-table > tbody {
  display: table-row-group !important;
  break-inside: auto;
  page-break-inside: auto;
}
.daily-report-sheet .daily-report-table > tbody > tr {
  display: table-row !important;
  break-inside: auto;
  page-break-inside: auto;
}
.daily-report-sheet .daily-report-table > tbody > tr > :is(th, td) {
  display: table-cell !important;
  border: 1px solid #000 !important;
  padding: 7px 10px !important;
  min-width: 0 !important;
  max-height: none !important;
  color: #000 !important;
  background: #fff !important;
  vertical-align: middle !important;
  white-space: pre-wrap !important;
  overflow-wrap: anywhere !important;
  word-break: normal !important;
  overflow: visible !important;
  text-overflow: clip !important;
  line-height: 1.6;
  break-inside: auto;
  page-break-inside: auto;
}
.daily-report-sheet .daily-report-table > tbody > tr > th {
  text-align: center !important;
  font-size: 13px;
  font-weight: 400;
}
.daily-report-sheet .daily-report-table .daily-report-section-label {
  padding: 8px 4px !important;
}
.daily-report-sheet .daily-report-table .daily-report-vertical-label {
  display: inline-block;
  writing-mode: vertical-rl;
  text-orientation: upright;
  letter-spacing: .08em;
  white-space: normal !important;
  line-height: 1.2;
}
.daily-report-sheet .daily-report-table .daily-report-content {
  min-height: 82px;
  margin: 0;
  white-space: pre-wrap !important;
  overflow-wrap: anywhere !important;
  word-break: normal !important;
  max-height: none !important;
  overflow: visible !important;
  text-overflow: clip !important;
  -webkit-line-clamp: unset !important;
  break-inside: auto;
  page-break-inside: auto;
}
.daily-report-sheet .daily-report-table .daily-report-progress-content { min-height: 110px; }
.daily-report-sheet .daily-report-table .daily-report-plan-content { min-height: 94px; }
.daily-report-sheet .daily-report-table .daily-report-review-result {
  margin: 0 0 4px;
  font-weight: 700;
  white-space: pre-wrap !important;
}
.daily-report-sheet .daily-report-table .daily-report-time-row > :is(th, td) { font-size: 12px; }
.daily-report-sheet .daily-report-caution {
  margin: 8px 0 0;
  font-size: 11px;
  color: #000;
}
.daily-report-sheet .daily-report-output-metadata {
  margin: 8px 0 0;
  padding-top: 6px;
  border-top: 1px solid #000;
  font-size: 11px;
  line-height: 1.5;
  white-space: normal;
  overflow-wrap: anywhere;
}
.daily-report-sheet .daily-report-output-metadata p { margin: 0; white-space: pre-wrap; }
.daily-report-sheet .daily-report-empty { margin: 24px 0; text-align: center; }
@media screen and (max-width: 480px) {
  .daily-report-sheet { font-size: 13px; }
  .daily-report-sheet .daily-report-title { font-size: 24px; }
  .daily-report-sheet .daily-report-heading { font-size: 12px; }
  .daily-report-sheet .daily-report-table .daily-report-label-column { width: 38px; }
  .daily-report-sheet .daily-report-table > tbody > tr > :is(th, td) { padding: 6px !important; }
  .daily-report-sheet .daily-report-table > tbody > tr > th { font-size: 12px; }
  .daily-report-sheet .daily-report-table .daily-report-section-label { padding: 8px 3px !important; }
  .daily-report-sheet .daily-report-table .daily-report-time-row > :is(th, td) { font-size: 11px; }
}
@page daily-construction-report { size: A4 portrait; margin: 12mm; }
@media print {
  .daily-report-sheet {
    page: daily-construction-report;
    max-width: none;
    margin: 0;
    font-size: 11pt;
    break-inside: auto;
    page-break-inside: auto;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
  .daily-report-sheet + .daily-report-sheet {
    break-before: page;
    page-break-before: always;
  }
  .daily-report-sheet .daily-report-title { margin-bottom: 3mm; font-size: 22pt; }
  .daily-report-sheet .daily-report-heading { margin-bottom: 2mm; font-size: 10pt; }
  .daily-report-sheet .daily-report-table .daily-report-label-column { width: 18mm; }
  .daily-report-sheet .daily-report-table > tbody > tr > :is(th, td) { padding: 2mm 2.5mm !important; }
  .daily-report-sheet .daily-report-table > tbody > tr > th { padding: 2mm 1mm !important; font-size: 10pt; }
  .daily-report-sheet .daily-report-table .daily-report-section-label { padding: 2mm 1mm !important; }
  .daily-report-sheet .daily-report-table .daily-report-content { min-height: 18mm; }
  .daily-report-sheet .daily-report-table .daily-report-progress-content { min-height: 26mm; }
  .daily-report-sheet .daily-report-table .daily-report-plan-content { min-height: 22mm; }
  .daily-report-sheet .daily-report-table .daily-report-time-row > :is(th, td) { font-size: 9pt; }
  .daily-report-sheet .daily-report-caution { font-size: 8pt; margin-top: 2mm; }
  .daily-report-sheet .daily-report-output-metadata { font-size: 8pt; margin-top: 2mm; padding-top: 1.5mm; }
}
`;

function reportSection(label: string, value: unknown, contentClass = "") {
  const text =
    value === null || value === undefined || value === "" ? "未填写" : value;
  return `<tr><th scope="row" class="daily-report-section-label"><span class="daily-report-vertical-label">${escapePrintHtml(label)}</span></th><td colspan="3"><div class="daily-report-content ${contentClass}">${escapePrintHtml(text)}</div></td></tr>`;
}

/** 只显式投影已有日报业务字段，绝不序列化附件、URL 或额外的账户属性。 */
function renderConstructionReportSheet(
  report: ConstructionWorkspaceReport,
  projectName: string,
  outputMetadataHtml = ""
) {
  const h = escapePrintHtml;
  const reviewer =
    report.reviewedByName ||
    (report.reviewedBy ? `管理员 #${report.reviewedBy}` : "未审核");
  const status = getBusinessStatusLabel(report.status);
  return `<section class="daily-report-sheet" aria-label="施工日志 ${h(report.id)}">
<h1 class="daily-report-title">施工日志</h1>
<div class="daily-report-heading"><span>日期：${h(formatChinaDate(report.reportDate))}</span><span class="daily-report-number">日报编号：${h(report.id)}</span></div>
<table class="daily-report-table" aria-label="施工日志明细"><colgroup><col class="daily-report-label-column"><col><col class="daily-report-label-column"><col></colgroup><tbody>
<tr><th scope="row">工程名称</th><td colspan="3">${h(projectName || "未填写")}</td></tr>
<tr><th scope="row">作业面</th><td>${h(report.workArea)}</td><th scope="row">天气</th><td>${h(CONSTRUCTION_WEATHER[report.weather])}</td></tr>
<tr><th scope="row">累计进度</th><td>${h(Number(report.progressPercent).toFixed(2))}%</td><th scope="row">状态</th><td>${h(status)}</td></tr>
${reportSection("施工进度情况", report.workContent, "daily-report-progress-content")}
${reportSection("施工计划", report.constructionPlan, "daily-report-plan-content")}
${reportSection("安全情况", report.safetyNotes)}
${reportSection("质量/协调问题", report.issueNotes)}
<tr><th scope="row" class="daily-report-section-label"><span class="daily-report-vertical-label">审核结果与回复</span></th><td colspan="3"><div class="daily-report-content"><p class="daily-report-review-result">审核结果：${h(status)}</p>${h(report.reviewReply || "未填写")}</div></td></tr>
<tr><th scope="row">记录人</th><td>${h(report.createdByName)}</td><th scope="row">审核人</th><td>${h(reviewer)}</td></tr>
<tr class="daily-report-time-row"><th scope="row">审核时间</th><td colspan="3">${h(report.reviewedAt ? formatChinaDateTime(report.reviewedAt) : "未审核")}</td></tr>
<tr class="daily-report-time-row"><th scope="row">创建时间</th><td>${h(formatChinaDateTime(report.createdAt))}</td><th scope="row">更新时间</th><td>${h(formatChinaDateTime(report.updatedAt))}</td></tr>
</tbody></table>
<p class="daily-report-caution">审核通过或归档不等同于问题已整改。</p>
${outputMetadataHtml}</section>`;
}

/** 安全的纯报告 HTML（不含筛选、批次等输出元数据）；搭配共享 CSS 使用。 */
export function constructionReportSheetHtml(
  report: ConstructionWorkspaceReport,
  projectName: string
) {
  return renderConstructionReportSheet(report, projectName);
}

/** 完整打印 body：共享样式 + 每份独立日志 + 原有筛选/数量/批次/生成时间说明。 */
export function constructionPrintBody(
  reports: readonly ConstructionWorkspaceReport[],
  metadata: ConstructionPrintMetadata
) {
  const h = escapePrintHtml;
  const generatedAt = formatChinaDateTime(new Date());
  const outputMetadata = (
    index?: number
  ) => `<footer class="daily-report-output-metadata">
<p>项目：${h(metadata.projectName)}　筛选：${h(metadata.filterText)}</p>
<p>全筛选记录数：${h(metadata.total)}　本批记录数：${h(reports.length)}　输出范围：${h(metadata.batchLabel || "完整当前筛选")}${index === undefined ? "" : `　第${h((metadata.offset ?? 0) + index + 1)}份 / 共${h(metadata.total)}份`}</p>
<p>生成时间：${h(generatedAt)}</p></footer>`;
  const sheets = reports.length
    ? reports
        .map((report, index) =>
          renderConstructionReportSheet(
            report,
            metadata.projectName,
            outputMetadata(index)
          )
        )
        .join("\n")
    : `<section class="daily-report-sheet"><h1 class="daily-report-title">施工日志</h1><p class="daily-report-empty">当前筛选暂无日报</p>${outputMetadata()}</section>`;
  return `<style>${CONSTRUCTION_REPORT_SHEET_CSS}</style>\n${sheets}`;
}
function csvCell(value: unknown) {
  const text = String(value ?? "");
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
/** 只投影明确业务字段，保持所有换行与完整文字并拦截公式注入。 */
export function constructionCsv(
  reports: readonly ConstructionWorkspaceReport[],
  metadata: {
    projectName: string;
    filterText: string;
    total: number;
    offset?: number;
    batchLabel?: string;
  }
) {
  const rows = [
    ["导出模块", "施工管理"],
    ["当前项目", metadata.projectName],
    ["筛选条件", metadata.filterText],
    ["全筛选记录数", metadata.total],
    ["本批记录数", reports.length],
    ["输出范围", metadata.batchLabel || "完整当前筛选"],
    ["生成时间", formatChinaDateTime(new Date())],
    CONSTRUCTION_OUTPUT_HEADERS,
    ...constructionOutputRows(reports, metadata.offset),
  ];
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
}
export function downloadConstructionCsv(fileName: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
