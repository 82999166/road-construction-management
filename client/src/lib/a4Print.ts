import reportPrintTableCss from "./reportPrintTable.css?raw";

/** 将真实业务明细写入独立浏览器文档，避免组件弹窗与全局样式干扰 PDF 输出。 */
export function escapePrintHtml(value: unknown) {
  return String(value ?? "—").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

type A4PrintOptions = { title: string; bodyHtml: string; orientation?: "portrait" | "landscape" };

/**
 * 真实业务打印使用隐藏 iframe 而非浏览器新窗口：不受弹窗拦截影响，打印完成/超时后自动清理。
 * 横向用于宽明细，纵向用于逐笔付款凭证；调用方仍必须先对业务文本 escapePrintHtml。
 */
export function openA4PrintDocument({ title, bodyHtml, orientation = "landscape" }: A4PrintOptions) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const printWindow = frame.contentWindow;
  if (!printWindow) {
    frame.remove();
    throw new Error("无法创建打印文档，请刷新页面后重试");
  }
  const removeFrame = () => window.setTimeout(() => frame.remove(), 300);
  printWindow.addEventListener("afterprint", removeFrame, { once: true });
  window.setTimeout(() => frame.isConnected && frame.remove(), 60_000);
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapePrintHtml(title)}</title><style>
    @page { size:A4 ${orientation}; margin:8mm; }
    * { box-sizing:border-box; } body { margin:0; color:#111; background:#fff; font-family:"Microsoft YaHei","PingFang SC",Arial,sans-serif; font-size:10px; }
    h1 { margin:0; font-size:20px; text-align:center; } .sub { margin:6px 0 0; text-align:center; font-size:10px; color:#433b35; } .rule { margin:10px 0; border:0; border-top:2px solid #3a2117; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:9px; } th, td { border:1px solid #222; padding:4px; vertical-align:middle; word-break:break-word; } th { background:#eee2d2; } thead { display:table-header-group; } tr { break-inside:avoid; } .right { text-align:right; } .center { text-align:center; } .summary { background:#f3e7d7; font-weight:700; } .footer { display:grid; grid-template-columns:1fr 1fr; gap:40px; margin-top:14px; font-size:10px; }
    .voucher-page { break-after:page; min-height:274mm; display:flex; flex-direction:column; } .voucher-page:last-child { break-after:auto; } .voucher-grid { display:grid; grid-template-columns:110px 1fr; border-top:1px solid #222; border-left:1px solid #222; margin-top:10px; } .voucher-grid > div { border-right:1px solid #222; border-bottom:1px solid #222; padding:7px; min-height:28px; } .voucher-label { background:#f5f0e8; font-weight:700; } .signature-line { display:grid; grid-template-columns:repeat(3,1fr); gap:18px; margin-top:auto; padding-top:18px; font-size:11px; }
    ${reportPrintTableCss}
  </style></head><body class="a4-print-document">${bodyHtml}<script>window.onload=function(){setTimeout(function(){window.focus();window.print()},180)}</script></body></html>`);
  printWindow.document.close();
}

/** 兼容既有横向明细打印调用。 */
export function openA4LandscapePrintDocument(options: Omit<A4PrintOptions, "orientation">) {
  return openA4PrintDocument({ ...options, orientation: "landscape" });
}

/** 当前筛选导出使用 UTF-8 BOM，避免中文表头在办公软件中出现乱码，并阻止公式注入。 */
export function escapeSpreadsheetCell(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").replace(/[\r\n]+/g, " ");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}
export function downloadCurrentFilteredCsv(fileName: string, headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  const toCell = (value: string | number | null | undefined) => `"${String(escapeSpreadsheetCell(value)).replace(/"/g, '""')}"`;
  const content = "\uFEFF" + [headers, ...rows].map(row => row.map(toCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
