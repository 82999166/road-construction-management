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
    report.workContent,
    report.safetyNotes || "—",
    report.issueNotes || "—",
    report.reviewReply || "—",
    report.reviewedByName ||
      (report.reviewedBy ? `管理员 #${report.reviewedBy}` : "未审核"),
    report.reviewedAt ? formatChinaDateTime(report.reviewedAt) : "—",
  ]);
}
export function constructionPrintBody(
  reports: readonly ConstructionWorkspaceReport[],
  metadata: {
    projectName: string;
    filterText: string;
    total: number;
    offset?: number;
    batchLabel?: string;
  }
) {
  const rows = constructionOutputRows(reports, metadata.offset);
  const h = escapePrintHtml;
  return `<style>td{white-space:pre-wrap;overflow-wrap:anywhere;vertical-align:top}tbody tr{break-inside:auto}</style><h1>施工日报筛选明细表</h1><p class="sub">项目：${h(metadata.projectName)} | ${h(metadata.filterText)}</p><p class="sub">${h(metadata.batchLabel || "完整当前筛选")} | 全筛选 ${metadata.total} 份，本批 ${reports.length} 份 | 生成时间：${h(formatChinaDateTime(new Date()))}</p><hr class="rule"><table><thead><tr>${CONSTRUCTION_OUTPUT_HEADERS.map(label => `<th>${h(label)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${h(cell)}</td>`).join("")}</tr>`).join("") || '<tr><td colspan="13">当前筛选暂无日报</td></tr>'}</tbody></table><p>审核通过或归档不等同于问题已整改；本表保留原日报问题及审核回复，不推断闭环。</p><div class="footer"><span>制表人：________________</span><span>复核人：________________</span></div>`;
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
