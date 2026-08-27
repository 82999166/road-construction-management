/** 将真实业务明细写入独立浏览器文档，避免组件弹窗与全局样式干扰 PDF 输出。 */
export function escapePrintHtml(value: unknown) {
  return String(value ?? "—").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

export function openA4LandscapePrintDocument({ title, bodyHtml }: { title: string; bodyHtml: string }) {
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
    @page { size:A4 landscape; margin:8mm; }
    * { box-sizing:border-box; } body { margin:0; color:#111; background:#fff; font-family:"Microsoft YaHei","PingFang SC",Arial,sans-serif; font-size:10px; }
    h1 { margin:0; font-size:20px; text-align:center; } .sub { margin:6px 0 0; text-align:center; font-size:10px; color:#433b35; } .rule { margin:10px 0; border:0; border-top:2px solid #3a2117; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:9px; } th, td { border:1px solid #222; padding:4px; vertical-align:middle; word-break:break-word; } th { background:#eee2d2; } thead { display:table-header-group; } tr { break-inside:avoid; } .right { text-align:right; } .center { text-align:center; } .summary { background:#f3e7d7; font-weight:700; } .footer { display:grid; grid-template-columns:1fr 1fr; gap:40px; margin-top:14px; font-size:10px; }
  </style></head><body>${bodyHtml}<script>window.onload=function(){setTimeout(function(){window.focus();window.print()},180)}</script></body></html>`);
  printWindow.document.close();
}

/** 当前筛选导出使用 UTF-8 BOM，避免中文表头在办公软件中出现乱码。 */
export function downloadCurrentFilteredCsv(fileName: string, headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  const toCell = (value: string | number | null | undefined) => `"${String(value ?? "").replace(/"/g, '""')}"`;
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
