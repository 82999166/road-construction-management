import { escapePrintHtml, openA4LandscapePrintDocument } from "./a4Print";
import { toChinaDateInput } from "./businessTime";
import { amountToChineseUppercase } from "@shared/purchasingRules";
import { formatAmount, formatQuantity } from "@shared/numberFormat";
export const PURCHASING_TABS = [
  { value: "overview", label: "采购总览" },
  { value: "orders", label: "申请与订单" },
  { value: "receipts", label: "验收与入库" },
  { value: "inventory", label: "库存与收发" },
  { value: "settlements", label: "结算与票据" },
  { value: "suppliers", label: "供应商" },
] as const;
export type PurchasingTab = (typeof PURCHASING_TABS)[number]["value"];
export type PurchasingFilter = {
  search: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  categoryId: string;
  purchaser: string;
  uploader: string;
  invoice: string;
};
export function createPurchasingFilter(tab: PurchasingTab): PurchasingFilter {
  const today = toChinaDateInput(new Date());
  return {
    search: "",
    status: "all",
    dateFrom:
      tab === "suppliers"
        ? ""
        : tab === "settlements"
          ? `${today.slice(0, 7)}-01`
          : today,
    dateTo: tab === "suppliers" ? "" : today,
    categoryId: "all",
    purchaser: "",
    uploader: "",
    invoice: "all",
  };
}
export const purchasingStatusLabel = (status: string) =>
  (
    ({
      all: "全部",
      draft: "草稿",
      submitted: "待审批",
      approved: "已批准",
      ordered: "已下单",
      confirmed: "已审核",
      received: "已收货",
      stocked: "已入库",
      closed: "已关闭（不代表历史付清）",
      void: "已作废",
      rejected: "已退回",
      partial: "部分",
      paid: "已实付",
      unpaid: "未实付",
      pending: "待验收",
      legacy_unverified: "历史收货未核验",
      active: "启用",
      disabled: "停用",
      inbound: "入库",
      outbound: "领用",
      return: "退库",
    }) as Record<string, string>
  )[status] ?? status;
export type FilterablePurchasingRow = {
  text: string;
  status?: string;
  date?: Date | string | null;
  categoryId?: number | null;
  purchaser?: string | null;
  uploader?: string | null;
  hasInvoice?: boolean;
};
export function matchesPurchasingFilter(
  row: FilterablePurchasingRow,
  f: PurchasingFilter,
  ignoreDate = false
) {
  const date = row.date ? toChinaDateInput(row.date) : "";
  return (
    (!f.search ||
      row.text.toLowerCase().includes(f.search.trim().toLowerCase())) &&
    (f.status === "all" || row.status === f.status) &&
    (ignoreDate ||
      ((!f.dateFrom || date >= f.dateFrom) &&
        (!f.dateTo || date <= f.dateTo))) &&
    (f.categoryId === "all" ||
      String(row.categoryId ?? "unassigned") === f.categoryId) &&
    (!f.purchaser || (row.purchaser ?? "").includes(f.purchaser)) &&
    (!f.uploader || (row.uploader ?? "").includes(f.uploader)) &&
    (f.invoice === "all" ||
      (f.invoice === "yes" ? row.hasInvoice === true : row.hasInvoice !== true))
  );
}
export function printPurchasingRows(
  title: string,
  scope: string,
  headers: string[],
  rows: (string | number | null | undefined)[][]
) {
  const e = (v: unknown) => escapePrintHtml(String(v ?? ""));
  openA4LandscapePrintDocument({
    title,
    bodyHtml: `<h1>${e(title)}</h1><p class="sub">${e(scope)} · 全部筛选结果 ${rows.length} 条（不受分页影响）</p><hr class="rule"><table><thead><tr>${headers.map(h => `<th>${e(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${e(cell)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${headers.length}">当前范围暂无记录</td></tr>`}</tbody></table><div class="footer"><span>制表：________</span><span>复核：________</span></div>`,
  });
}
export function printPurchasingHalfA4(order: {
  orderNo: string;
  amount: string | number;
  status: string;
  orderedAt: Date | string;
  itemDescription?: string | null;
  purchaserName?: string | null;
  createdByName?: string | null;
  documentUploadedByName?: string | null;
  projectAdministratorName?: string | null;
  remarks?: string | null;
  ocrSummary?: string | null;
  quantity?: string | number | null;
  unitPrice?: string | number | null;
  documentAttachment?: {
    url: string;
    mimeType?: string;
    fileName?: string | null;
  } | null;
  invoiceAttachment?: {
    url: string;
    mimeType?: string;
    fileName?: string | null;
  } | null;
  paidAmount?: string | number | null;
  remainingAmount?: string | number | null;
}) {
  const popup = window.open("", "_blank");
  if (!popup) throw new Error("请允许打印弹窗");
  const e = (v: unknown) => escapePrintHtml(String(v ?? "—"));
  const attachment = (label: string, file: typeof order.documentAttachment) =>
    `<div class="voucher-box"><b>${label}</b>${file?.mimeType?.startsWith("image/") ? `<img src="${e(file.url)}" alt="${label}">` : `<span>${file ? `已归档${e(file.fileName)}，PDF请站内预览后单独打印` : "未上传 · 原件粘贴处"}</span>`}</div>`;
  popup.document.write(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>采购费用票据报销详单</title><style>*{box-sizing:border-box}body{margin:0;color:#273337;font-family:"Microsoft YaHei",sans-serif}.receipt-page{width:210mm;height:148.5mm;padding:6mm 7mm;background:#fff}.receipt-title{text-align:center;margin:0 0 5mm;font-size:20px;letter-spacing:3px;text-decoration:underline}.receipt-main{display:grid;grid-template-columns:minmax(0,1fr) 84mm;gap:7mm}.expense-table{width:100%;border-collapse:collapse;font-size:10px}.expense-table td{border-bottom:1px dashed #aebabc;padding:3mm 2mm;word-break:break-word}.total-line{border-bottom:1px solid #273337;padding:4mm 0;font-size:12px;font-weight:700}.note{font-size:10px;color:#596a6e}.voucher-panel{display:grid;grid-template-columns:1fr 1fr;gap:4mm}.original-caption{grid-column:1 / -1;min-height:10mm;border:1px dashed #8d9b9e;padding:2mm;text-align:center;font-size:10px}.voucher-box{height:62mm;border:1px dashed #8d9b9e;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:10px;text-align:center;overflow:hidden}.voucher-box img{max-width:90%;height:85%;object-fit:contain}.signatures{display:grid;grid-template-columns:repeat(4,1fr);margin-top:7mm;border-top:1px solid #273337;padding-top:5mm;font-size:10px}@media print{@page{size:A4 portrait;margin:0}.receipt-page{break-inside:avoid}}</style></head><body><section class="receipt-page"><h1 class="receipt-title">采购费用票据报销详单</h1><div class="receipt-main"><div><p class="note">单据编号：${e(order.orderNo)} · 日期：${e(toChinaDateInput(order.orderedAt))}</p><table class="expense-table"><tr><td>采购者：${e(order.purchaserName)}</td><td>业务状态：${e(purchasingStatusLabel(order.status))}</td></tr><tr><td colspan="2">物资：${e(order.itemDescription)}</td></tr><tr><td>数量：${e(order.quantity == null ? null : formatQuantity(order.quantity))}</td><td>单价：${e(order.unitPrice == null ? null : formatAmount(order.unitPrice))}</td></tr><tr><td>提交上传管理员：${e(order.documentUploadedByName || order.createdByName || "未登记")}</td><td>现场管理员：${e(order.projectAdministratorName || "未登记")}</td></tr><tr><td colspan="2">备注：${e(order.remarks || order.ocrSummary || "未填写")}</td></tr><tr><td>实际付款：¥${e(formatAmount(order.paidAmount ?? 0))}</td><td>未付余额：¥${e(formatAmount(order.remainingAmount ?? order.amount))}</td></tr></table><div class="total-line">订单金额：${e(amountToChineseUppercase(order.amount))}（¥${e(formatAmount(order.amount))}）</div><p class="note">来源说明：右侧为原采购单据及发票，不是付款凭证。付款事实仅来自采购结算 financial_records；历史关闭不证明已付清。</p></div><div class="voucher-panel">${attachment("原采购单据", order.documentAttachment)}${attachment("发票原件", order.invoiceAttachment)}<div class="original-caption">原采购原件 / 原始票据手贴空栏（粘贴处）</div></div></div><div class="signatures"><div>报销人：________</div><div>部门审批：________</div><div>会计主管：________</div><div>复核：________</div></div></section><script>window.onload=function(){setTimeout(function(){window.focus();window.print()},180)}</script></body></html>`
  );
  popup.document.close();
}
