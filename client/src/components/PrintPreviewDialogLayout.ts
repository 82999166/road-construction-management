/**
 * PC 端筛选打印/打印预览的统一容器契约。
 *
 * 此处只定义屏幕预览的可视区域；各业务模块仍保留自己的 A4 横向打印样式和
 * 受服务端权限约束的数据来源，不能用本布局改变实际纸张输出、筛选或统计口径。
 */
export const PRINT_PREVIEW_DIALOG_CONTENT_CLASS = [
  "w-[calc(100vw-3rem)]",
  "max-w-[1680px]",
  "sm:max-w-[1680px]",
  "h-[min(82vh,820px)]",
  "max-h-[calc(100vh-4rem)]",
  "lg:left-24",
  "lg:right-6",
  "lg:w-auto",
  "lg:max-w-none",
  "lg:translate-x-0",
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

/** 桌面筛选打印的宽表在工作区宽度内分配列宽，不以左右拖动替代完整预览。 */
export const PRINT_PREVIEW_TABLE_FRAME_CLASS =
  "mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white";

export const PRINT_PREVIEW_TABLE_FIT_CLASS =
  "min-w-0 w-full table-fixed border-collapse [overflow-wrap:anywhere] print:min-w-0";
