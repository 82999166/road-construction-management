import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Vitest 默认将 CSS 导入清空；读取实际资源验证 A4 注入内容，不改生产 CSS 构建配置。
vi.mock("./reportPrintTable.css?raw", async () => {
  const { readFileSync } = await import("node:fs");
  return { default: readFileSync(new URL("./reportPrintTable.css", import.meta.url), "utf8") };
});
import { openA4PrintDocument, openA4LandscapePrintDocument } from "./a4Print";
import { printColumnGroup, TRANSPORT_FREIGHT_PRINT_COLUMN_WIDTHS } from "./reportPrintLayout";

let frame: any;
let write: ReturnType<typeof vi.fn>;
let afterprint: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  write = vi.fn();
  afterprint = vi.fn();
  frame = {
    setAttribute: vi.fn(), style: { cssText: "" }, remove: vi.fn(), isConnected: true,
    contentWindow: { addEventListener: afterprint, document: { open: vi.fn(), write, close: vi.fn() } },
  };
  vi.stubGlobal("document", { createElement: vi.fn(() => frame), body: { appendChild: vi.fn() } });
  vi.stubGlobal("window", { setTimeout });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("独立 A4 打印共享布局与凭证保护", () => {
  it("真实写入横向 A4 文档，注入与预览一致的 CSS，完整保留长单号和跨列合计", () => {
    const number = "YD" + "0123456789".repeat(10);
    const bodyHtml = `<table>${printColumnGroup(TRANSPORT_FREIGHT_PRINT_COLUMN_WIDTHS)}<thead><tr><th>运单号</th></tr></thead><tbody><tr><td>${number}</td></tr><tr class="summary"><td colspan="5">合计</td><td class="right">1234567890.12</td></tr></tbody></table>`;
    openA4LandscapePrintDocument({ title: "运输<明细>", bodyHtml });
    const html = write.mock.calls[0][0] as string;
    expect(html).toContain("@page { size:A4 landscape; margin:8mm; }");
    expect(html).toContain("<title>运输&lt;明细&gt;</title>");
    expect(html).toContain('<body class="a4-print-document">');
    expect(html).toContain(bodyHtml);
    expect(html).toContain("display: table-cell !important;");
    expect(html).toContain("overflow-wrap: anywhere !important;");
    expect(html).toContain("border: 1px solid #334155 !important;");
    expect(html).toContain("text-align: right !important;");
    expect(html).toContain("window.print()");
    expect(afterprint).toHaveBeenCalledWith("afterprint", expect.any(Function), { once: true });
    afterprint.mock.calls[0][1]();
    vi.advanceTimersByTime(300);
    expect(frame.remove).toHaveBeenCalledOnce();
  });

  it("纵向逐笔凭证页面、网格、图片和签字结构原样保留，无 table 样式侵入图片结构", () => {
    const bodyHtml = '<section class="voucher-page"><h1>凭证</h1><div class="voucher-grid"><div>凭证</div><div><img src="https://example.com/proof.jpg" style="max-height:180mm;object-fit:contain"></div></div><div class="signature-line">制单：____</div></section>';
    openA4PrintDocument({ title: "图片凭证", bodyHtml, orientation: "portrait" });
    const html = write.mock.calls[0][0] as string;
    expect(html).toContain("@page { size:A4 portrait; margin:8mm; }");
    expect(html).toContain(bodyHtml);
    expect(html).toContain(".voucher-grid { display:grid;");
    expect(html).toContain(".voucher-page { break-after:page;");
    expect(html).toContain(".signature-line { display:grid;");
    expect(frame.style.cssText).toContain("visibility:hidden");
  });
});
