import reportPrintTableCss from "./reportPrintTable.css?raw";

/** 将真实业务明细写入独立浏览器文档，避免组件弹窗与全局样式干扰 PDF 输出。 */
export function escapePrintHtml(value: unknown) {
  return String(value ?? "—").replace(
    /[&<>"']/g,
    character =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ] ?? character
  );
}

type A4PrintOptions = {
  title: string;
  bodyHtml: string;
  orientation?: "portrait" | "landscape";
  marginMm?: 8 | 12;
  /** 施工影像打印须等待全部图像，并在每个异步阶段重新核对当前上下文。 */
  waitForImages?: boolean;
  isCurrent?: () => boolean;
};
function printCancelled() {
  return Object.assign(
    new Error("项目、详情、筛选或权限已变化，照片打印已取消，请重新生成"),
    { code: "CANCELLED" }
  );
}

/** 所有图片成功解码才交给打印机；失败、失效或超时不能静默输出空照片。 */
async function printWithImages(
  frame: HTMLIFrameElement,
  printWindow: Window,
  isCurrent: () => boolean
) {
  const document = printWindow.document;
  const cleanups: Array<() => void> = [];
  const check = () => {
    if (!frame.isConnected || !isCurrent()) throw printCancelled();
  };
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let cancellation: ReturnType<typeof setInterval> | undefined;
  try {
    check();
    const images = Array.from(document.images);
    const imageTasks = images.map(async (image, index) => {
      const fail = () =>
        new Error(
          `第${index + 1}张现场照片加载失败或签名已失效，未生成缺图打印，请重新点击打印重试`
        );
      try {
        if (typeof image.decode === "function") await image.decode();
        else if (!image.complete)
          await new Promise<void>((resolve, reject) => {
            const loaded = () => resolve();
            const failed = () => reject(fail());
            image.addEventListener("load", loaded, { once: true });
            image.addEventListener("error", failed, { once: true });
            cleanups.push(() => {
              image.removeEventListener("load", loaded);
              image.removeEventListener("error", failed);
            });
          });
        if (
          !image.complete ||
          image.naturalWidth < 1 ||
          image.naturalHeight < 1
        )
          throw fail();
      } catch {
        throw fail();
      }
    });
    const ready = Promise.all(imageTasks).then(async () => {
      check();
      if (document.fonts?.ready) {
        let fontTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            document.fonts.ready,
            new Promise<void>(resolve => {
              fontTimer = setTimeout(resolve, 1500);
            }),
          ]);
        } finally {
          if (fontTimer !== undefined) clearTimeout(fontTimer);
        }
      }
      await new Promise<void>(resolve => setTimeout(resolve, 180));
      check();
    });
    await Promise.race([
      ready,
      new Promise<never>((_, reject) => {
        deadline = setTimeout(
          () =>
            reject(
              new Error(
                "现场照片加载超过60秒，未生成缺图打印，请检查网络后重新点击打印"
              )
            ),
          60_000
        );
        cancellation = setInterval(() => {
          try {
            check();
          } catch (error) {
            reject(error);
          }
        }, 100);
      }),
    ]);
    check();
    document.body.dataset.printReady = "true";
    printWindow.focus();
    // afterprint 优先清理，超时只作为浏览器未发出事件的兜底；不在图片等待期间销毁。
    window.setTimeout(() => frame.isConnected && frame.remove(), 120_000);
    printWindow.print();
  } catch (error) {
    frame.remove();
    throw error;
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
    if (cancellation !== undefined) clearInterval(cancellation);
    cleanups.forEach(cleanup => cleanup());
  }
}

/**
 * 隐藏 iframe 打印，不受弹窗拦截影响；施工严格模式返回交给浏览器打印后的 Promise。
 * 默认模式保留其他明细/凭证原有行为；调用方必须先安全转义业务文本。
 */
export function openA4PrintDocument(
  options: A4PrintOptions & { waitForImages: true }
): Promise<void>;
export function openA4PrintDocument(
  options: A4PrintOptions
): void | Promise<void>;
export function openA4PrintDocument({
  title,
  bodyHtml,
  orientation = "landscape",
  marginMm = 8,
  waitForImages = false,
  isCurrent = () => true,
}: A4PrintOptions) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  // 给严格模式真实纸张预布局宽度，避免零宽iframe导致固定标签列把表格撑出纸边。
  const width = waitForImages
    ? orientation === "portrait"
      ? "794px"
      : "1123px"
    : "0";
  const height = waitForImages
    ? orientation === "portrait"
      ? "1123px"
      : "794px"
    : "0";
  frame.style.cssText = `position:fixed;right:0;bottom:0;width:${width};height:${height};border:0;visibility:hidden`;
  document.body.appendChild(frame);
  const printWindow = frame.contentWindow;
  if (!printWindow) {
    frame.remove();
    throw new Error("无法创建打印文档，请刷新页面后重试");
  }
  const removeFrame = () => window.setTimeout(() => frame.remove(), 300);
  printWindow.addEventListener("afterprint", removeFrame, { once: true });
  if (!waitForImages)
    window.setTimeout(() => frame.isConnected && frame.remove(), 60_000);
  printWindow.document.open();
  printWindow.document
    .write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapePrintHtml(title)}</title><style>
    @page { size:A4 ${orientation}; margin:${marginMm}mm; }
    * { box-sizing:border-box; } body { margin:0; color:#111; background:#fff; font-family:"Microsoft YaHei","PingFang SC",Arial,sans-serif; font-size:10px; }
    h1 { margin:0; font-size:20px; text-align:center; } .sub { margin:6px 0 0; text-align:center; font-size:10px; color:#433b35; } .rule { margin:10px 0; border:0; border-top:2px solid #3a2117; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:9px; } th, td { border:1px solid #222; padding:4px; vertical-align:middle; word-break:break-word; } th { background:#eee2d2; } thead { display:table-header-group; } tr { break-inside:avoid; } .right { text-align:right; } .center { text-align:center; } .summary { background:#f3e7d7; font-weight:700; } .footer { display:grid; grid-template-columns:1fr 1fr; gap:40px; margin-top:14px; font-size:10px; }
    .voucher-page { break-after:page; min-height:274mm; display:flex; flex-direction:column; } .voucher-page:last-child { break-after:auto; } .voucher-grid { display:grid; grid-template-columns:110px 1fr; border-top:1px solid #222; border-left:1px solid #222; margin-top:10px; } .voucher-grid > div { border-right:1px solid #222; border-bottom:1px solid #222; padding:7px; min-height:28px; } .voucher-label { background:#f5f0e8; font-weight:700; } .signature-line { display:grid; grid-template-columns:repeat(3,1fr); gap:18px; margin-top:auto; padding-top:18px; font-size:11px; }
    ${reportPrintTableCss}
  </style></head><body class="a4-print-document">${bodyHtml}${waitForImages ? "" : "<script>window.onload=function(){setTimeout(function(){window.focus();window.print()},180)}</script>"}</body></html>`);
  printWindow.document.close();
  if (waitForImages) return printWithImages(frame, printWindow, isCurrent);
}

/** 兼容既有横向明细打印调用。 */
export function openA4LandscapePrintDocument(
  options: Omit<A4PrintOptions, "orientation">
) {
  return openA4PrintDocument({ ...options, orientation: "landscape" });
}

/** 当前筛选导出使用 UTF-8 BOM，避免中文表头在办公软件中出现乱码，并阻止公式注入。 */
export function escapeSpreadsheetCell(
  value: string | number | null | undefined
) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").replace(/[\r\n]+/g, " ");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}
export function downloadCurrentFilteredCsv(
  fileName: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>
) {
  const toCell = (value: string | number | null | undefined) =>
    `"${String(escapeSpreadsheetCell(value)).replace(/"/g, '""')}"`;
  const content =
    "\uFEFF" +
    [headers, ...rows].map(row => row.map(toCell).join(",")).join("\n");
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
