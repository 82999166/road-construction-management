import { escapePrintHtml, openA4PrintDocument } from "./a4Print";

/** 与 getTakeoffDetail / getTakeoffPrint 的纯业务载荷兼容，不依赖后端运行时代码。 */
export type TakeoffMeasurementRow = {
  item: string;
  location: string;
  length: number | null;
  width: number | null;
  height: number | null;
  count: number | null;
  quantity: number;
  calculation: string;
  remarks: string;
};

export type TakeoffDetail = {
  record: {
    id: number;
    projectId: number;
    takeoffNo: string | null;
    measurementClaimId?: number | null;
    workItem: string | null;
    workLocation: string | null;
    unit: string | null;
    quantity: number | string | null;
    unitPrice: number | string | null;
    declaredAmount: number | string | null;
    takeoffDate: Date | string | null;
    status: string | null;
    submittedBy?: number | null;
    reviewedBy?: number | null;
    reviewedAt?: Date | string | null;
    reviewNote?: string | null;
    lockedAt?: Date | string | null;
    createdAt?: Date | string | null;
    updatedAt?: Date | string | null;
    workDescription?: string | null;
    measurementBasis?: string | null;
    measurementRows?: TakeoffMeasurementRow[] | null;
    version: string;
  };
  project: { id: number; name: string | null };
  submittedByName: string | null;
  reviewedByName: string | null;
  evidences: Array<{
    evidenceId: number;
    fileName: string;
    mimeType: string;
    url: string;
    capturedAt: Date | string | null;
    description: string | null;
  }>;
};

const TITLE = "项目部工程量收方记录表";
const HISTORICAL = "历史未填写";
const STATUS_LABELS: Record<string, string> = {
  draft: "草稿·未经复核",
  submitted: "已提交·待复核",
  reviewing: "复核中·尚未完成复核",
  approved: "已审核",
  rejected: "已退回·未经复核",
  locked: "已锁定",
  void: "已作废",
};
const UNIT_LABELS: Record<string, string> = {
  m3: "m³", m2: "m²", m: "m", t: "t", piece: "件", set: "套", other: "其他",
};

// 210 × 297mm A4，12mm 页边距内保留 184mm 安全宽度。只作用于此独立文档。
// 不设置整张表、正文、附件组或长图注的固定高度 / 不分页 / overflow:hidden。
const PRINT_CSS = `
@page { size: A4 portrait; margin: 12mm; }
.takeoff-print { width: 100%; max-width: 184mm; margin: 0 auto; color: #000; background: #fff; font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif; font-size: 12px; line-height: 1.55; }
.takeoff-print, .takeoff-print * { box-sizing: border-box; min-width: 0; }
.takeoff-print h1 { font-size: 20px; text-align: center; margin: 0 0 3mm; color: #000; }
.takeoff-print h2 { font-size: 12px; margin: 4mm 0 2mm; break-after: avoid; page-break-after: avoid; }
.takeoff-print section, .takeoff-print figure, .takeoff-print figcaption, .takeoff-print .takeoff-prose { break-inside: auto; page-break-inside: auto; }
.takeoff-print .takeoff-status { border: 2px solid #000; padding: 2mm; margin: 2mm 0 3mm; text-align: center; font-size: 14px; font-weight: 700; }
.takeoff-print .takeoff-prose, .takeoff-print .takeoff-photo-text { white-space: pre-wrap; overflow-wrap: anywhere; word-break: normal; margin: 0; }
.takeoff-print .takeoff-prose { border: 1px solid #000; padding: 2mm; }
.takeoff-print .takeoff-note { margin: 2mm 0; font-size: 9px; white-space: pre-wrap; overflow-wrap: anywhere; }
.a4-print-document .takeoff-print table { width: 100%; table-layout: fixed; border-collapse: collapse; color: #000; font-size: 11px; }
.a4-print-document .takeoff-print thead { display: table-header-group !important; }
.a4-print-document .takeoff-print tbody { display: table-row-group !important; }
.a4-print-document .takeoff-print table > :is(thead, tbody, tfoot) > tr { break-inside: auto !important; page-break-inside: auto !important; }
.a4-print-document .takeoff-print :is(th, td) { border: 1px solid #000 !important; padding: 1.4mm !important; vertical-align: top !important; white-space: pre-wrap !important; overflow-wrap: anywhere !important; word-break: normal !important; background: #fff !important; color: #000; }
.a4-print-document .takeoff-print th { font-weight: 700; }
.a4-print-document .takeoff-print .takeoff-rows { font-size: 11px; }
.takeoff-print .takeoff-signatures td { height: 14mm; }
.takeoff-print .takeoff-evidence-page { break-before: page; page-break-before: always; }
.takeoff-print .takeoff-evidence-page h2 { margin-top: 0; }
.takeoff-print .takeoff-photo { margin: 3mm 0 4mm; }
.takeoff-print .takeoff-photo-heading { font-weight: 700; margin: 0 0 1mm; white-space: pre-wrap; overflow-wrap: anywhere; break-after: avoid; }
.takeoff-print .takeoff-photo img { display: block; width: 100%; max-width: 100%; height: 95mm; object-fit: contain; object-position: center; border: 1px solid #000; break-inside: avoid; page-break-inside: avoid; }
.takeoff-print .takeoff-photo-text { font-size: 9px; margin-top: 1mm; }
`;

function text(value: unknown, empty = "未填写"): string {
  return escapePrintHtml(value == null ? HISTORICAL : value === "" ? empty : value);
}

function dateText(value: Date | string | null | undefined, dateOnly = false): string {
  if (value == null || value === "") return HISTORICAL;
  if (!(value instanceof Date)) return value; // 保留原字符串及其时区，不截断历史文本。
  if (!Number.isFinite(value.getTime())) return "日期格式异常";
  return dateOnly
    ? value.toISOString().split("T")[0]
    : value.toISOString().replace("T", " ").replace("Z", " UTC");
}

function unitText(unit: string | null): string {
  return unit == null ? HISTORICAL : UNIT_LABELS[unit] ?? unit;
}

function statusText(status: string | null): string {
  return status == null ? "历史状态未填写" : STATUS_LABELS[status] ?? status;
}

/** 仅使用当前受鉴权详情 / 打印载荷中的预览 URL；客户端不能验证签名的授权效力。 */
function safePhotoUrl(photo: TakeoffDetail["evidences"][number], index: number): string {
  const fail = () => new Error(`第${index + 1}张归档照片预览地址或格式无效，未生成缺图打印，请重新获取详情后重试`);
  if (photo.mimeType !== "image/jpeg" && photo.mimeType !== "image/png") throw fail();
  if (typeof photo.url !== "string" || !photo.url || /[\u0000-\u0020\u007f]/.test(photo.url)) throw fail();
  if (photo.url.startsWith("data:")) {
    const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo.url);
    if (!match || match[2].length % 4 !== 0 || photo.mimeType !== `image/${match[1]}`) throw fail();
    return photo.url;
  }
  // 后端的授权令牌接口使用站内路径。只接受此固定路径并转换为 HTTP(S)，
  // 不允许任意相对路径、协议相对地址或借助 <base> 改变来源。
  let url = photo.url;
  if (/^\/api\/measurement-takeoff\/preview\/[A-Za-z0-9_-]+$/.test(url)) {
    if (typeof window === "undefined" || !window.location?.origin) throw fail();
    url = new URL(url, window.location.origin).href;
  }
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw fail(); }
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw fail();
  // 使用原值并在 HTML 属性边界统一 escape，不能把地址拼成业务 HTML。
  return url;
}

function measurementRowsHtml(detail: TakeoffDetail): string {
  const rows = detail.record.measurementRows;
  if (rows == null) return `<p class="takeoff-prose">${HISTORICAL}</p>`;
  if (!Array.isArray(rows) || rows.length > 100) {
    throw new Error("测量明细数据异常（最多100行），未生成截断打印，请重新获取详情");
  }
  if (rows.length === 0) return '<p class="takeoff-prose">未填写测量明细</p>';
  return `<table class="takeoff-rows" aria-label="测量原始明细"><colgroup>
    <col style="width:4%"><col style="width:10%"><col style="width:12%"><col style="width:6%"><col style="width:6%"><col style="width:6%"><col style="width:6%"><col style="width:10%"><col style="width:20%"><col style="width:20%">
    </colgroup><thead><tr>${["序号", "测量项目", "部位 / 里程", "原始长", "原始宽", "原始高", "数量 / 次数", `工程量（${unitText(detail.record.unit)}）`, "计算式（原文）", "备注"].map(label => `<th scope="col">${escapePrintHtml(label)}</th>`).join("")}</tr></thead><tbody>${rows.map((row, index) => `<tr data-measurement-row="${index + 1}">${[index + 1, row.item, row.location, row.length, row.width, row.height, row.count, row.quantity, row.calculation, row.remarks].map(value => `<td>${value == null ? "—" : text(value, "—")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function evidenceHtml(detail: TakeoffDetail): string {
  if (!Array.isArray(detail.evidences)) {
    throw new Error("归档照片清单缺失，未生成缺图打印，请重新获取详情后重试");
  }
  if (detail.evidences.length === 0) return '<section class="takeoff-evidence-page"><h2>现场照片附件</h2><p class="takeoff-prose">未归档照片</p></section>';
  let html = "";
  // 不截取照片；每两张新建一组。超长说明自然续页，下一组仍从新页开始。
  for (let index = 0; index < detail.evidences.length; index += 1) {
    const photo = detail.evidences[index];
    const url = safePhotoUrl(photo, index);
    if (index % 2 === 0) {
      html += `<section class="takeoff-evidence-page" data-attachment-group="${Math.floor(index / 2) + 1}"><h2>现场照片附件 · 第${Math.floor(index / 2) + 1}组</h2><p class="takeoff-note">项目：${text(detail.project.name)}\n正式单号：${text(detail.record.takeoffNo)}\n状态：${escapePrintHtml(statusText(detail.record.status))}</p>`;
    }
    html += `<figure class="takeoff-photo" data-photo-id="${escapePrintHtml(photo.evidenceId)}"><p class="takeoff-photo-heading">照片 ${index + 1} / ${detail.evidences.length} · 文件名：${text(photo.fileName)}</p><img src="${escapePrintHtml(url)}" alt="${escapePrintHtml(`归档现场照片 ${index + 1}`)}" loading="eager" decoding="sync" referrerpolicy="no-referrer"><figcaption class="takeoff-photo-text">归档记录时间：${escapePrintHtml(dateText(photo.capturedAt))}\n说明：${text(photo.description)}</figcaption></figure>`;
    if (index % 2 === 1 || index === detail.evidences.length - 1) html += "</section>";
  }
  return html;
}

/** 返回供 openA4PrintDocument 使用的安全 bodyHtml（包含本模块局部样式）。 */
export function buildTakeoffPrintHtml(detail: TakeoffDetail): string {
  const record = detail.record;
  const metadata = [
    ["项目", detail.project.name, "正式单号（统一编号）", record.takeoffNo],
    ["收方日期", dateText(record.takeoffDate, true), "记录状态", statusText(record.status)],
    ["工程名称 / 工程部位", record.workItem, "里程 / 位置", record.workLocation],
    ["录入人员（系统记录）", detail.submittedByName, "复核人员（系统记录）", detail.reviewedByName],
  ];
  const disclaimer = record.status === "draft"
    ? "草稿未经复核，不作为结算或付款依据。"
    : record.status === "void"
      ? "已作废记录，不作为结算或付款依据。"
      : "本表为收方记录；未完成复核及签认的记录不作为结算或付款依据，结算以合同约定及有效审核、签认资料为准。";
  return `<style>${PRINT_CSS}</style><main class="takeoff-print"><section class="takeoff-record"><h1>${TITLE}</h1><p class="takeoff-status">${escapePrintHtml(statusText(record.status))}</p><table class="takeoff-metadata" aria-label="收方基本信息"><colgroup><col style="width:18%"><col style="width:32%"><col style="width:18%"><col style="width:32%"></colgroup><tbody>${metadata.map(([leftLabel, leftValue, rightLabel, rightValue]) => `<tr><th scope="row">${escapePrintHtml(leftLabel)}</th><td>${text(leftValue)}</td><th scope="row">${escapePrintHtml(rightLabel)}</th><td>${text(rightValue)}</td></tr>`).join("")}</tbody></table>
    <p class="takeoff-note">${escapePrintHtml(disclaimer)}\n人员姓名仅为系统录入 / 复核信息，不代表手写签名或电子签章。</p>
    <h2>详细工作说明 / 收方内容</h2><div class="takeoff-prose">${text(record.workDescription)}</div>
    <h2>计量依据 / 测量依据</h2><div class="takeoff-prose">${text(record.measurementBasis)}</div>
    <h2>测量原始明细</h2>${measurementRowsHtml(detail)}
    <p class="takeoff-note">各行工程量单位继承本单单位（${escapePrintHtml(unitText(record.unit))}）；原始尺寸为辅助记录，计算式按录入原文展示，不执行计算或自动替换本单工程量。</p>
    <h2>申报工程量与金额核对</h2><table class="takeoff-totals" aria-label="服务端记录的工程量与申报金额"><thead><tr><th scope="col">本单工程量</th><th scope="col">单位</th><th scope="col">业主单价（元 / 单位）</th><th scope="col">服务端申报金额（元）</th></tr></thead><tbody><tr><td>${text(record.quantity)}</td><td>${escapePrintHtml(unitText(record.unit))}</td><td>${text(record.unitPrice)}</td><td>${text(record.declaredAmount)}</td></tr></tbody></table>
    <p class="takeoff-note">工程量、业主单价和申报金额均取服务端本单记录；本打印不重新计算金额，不将明细合计或照片替代审核、结算依据。</p>
    <h2>现场签认（手写空白栏）</h2><table class="takeoff-signatures" aria-label="待现场手写签名及日期"><tbody>${["测量人", "复核人", "项目负责人", "监理或业主代表"].map(role => `<tr><th scope="row" style="width:22%">${role}</th><td>签字：________________________</td><td style="width:34%">日期：______年____月____日</td></tr>`).join("")}</tbody></table>
    <p class="takeoff-note">本表为项目部业务记录表，不声称国家统一法定表式；特定业主的表式与签认要求以合同约定为准。照片在独立附件页完整列示，图内水印保留原样。</p></section>${evidenceHtml(detail)}</main>`;
}

/** 失败原样抛给 UI 显示并重试；始终等待全部图片解码，不静默缺图。 */
export async function printTakeoffDetail(
  detail: TakeoffDetail,
  isCurrent?: () => boolean
): Promise<void> {
  if (isCurrent && !isCurrent()) {
    throw Object.assign(new Error("项目或详情已变化，收方打印已取消，请重新生成"), { code: "CANCELLED" });
  }
  await openA4PrintDocument({
    title: TITLE,
    bodyHtml: buildTakeoffPrintHtml(detail),
    orientation: "portrait",
    marginMm: 12,
    waitForImages: true,
    isCurrent,
  });
}
