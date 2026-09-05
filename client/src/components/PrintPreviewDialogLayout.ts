/**
 * PC 端筛选打印/打印预览的统一容器契约。
 *
 * 此处只定义屏幕预览的可视区域；各业务模块仍保留自己的 A4 横向打印样式和
 * 受服务端权限约束的数据来源，不能用本布局改变实际纸张输出、筛选或统计口径。
 */
export const PRINT_PREVIEW_DIALOG_CONTENT_CLASS = [
  "w-[calc(100vw-2rem)]",
  "max-w-[1600px]",
  "sm:max-w-[1600px]",
  "h-[min(94vh,1024px)]",
  "grid-rows-[auto_minmax(0,1fr)_auto]",
  "gap-0",
  "overflow-hidden",
  "p-0",
  "print:h-auto",
  "print:max-w-none",
  "print:overflow-visible",
].join(" ");

export const PRINT_PREVIEW_DIALOG_HEADER_CLASS =
  "shrink-0 border-b border-slate-200 bg-white px-6 py-5 pr-12";

export const PRINT_PREVIEW_DIALOG_BODY_CLASS =
  "min-h-0 overflow-auto bg-slate-50/70 px-6 py-5";

export const PRINT_PREVIEW_DIALOG_FOOTER_CLASS =
  "shrink-0 border-t border-slate-200 bg-white px-6 py-4";

export const PRINT_PREVIEW_TABLE_SCROLL_CLASS =
  "overflow-x-auto rounded-xl border border-slate-200 bg-white print:overflow-visible";
