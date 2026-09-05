import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./DieselRefuelPrintDialog.tsx", import.meta.url), "utf8");

describe("柴油 A4 明细打印中文状态", () => {
  it("打印状态列使用中文标签和安全回退，且继续复用中国时区格式化", () => {
    expect(source).toContain("const statusLabel = (status: string)");
    expect(source).toContain('?? "待处理"');
    expect(source).toContain("escapePrintHtml(statusLabel(item.status))");
    expect(source).not.toContain("escapePrintHtml(item.status)</td>");
    expect(source).toContain("formatChinaDateTime");
  });

  it("预览窗口按业务工作区级宽高展开，标题和操作区固定，宽表继续可滚动查看", () => {
    expect(source).toContain("DIESEL_PRINT_PREVIEW_DIALOG_CONTENT_CLASS");
    expect(source).toContain("w-[calc(100vw-3rem)]");
    expect(source).toContain("max-w-[1680px]");
    expect(source).toContain("h-[min(82vh,820px)]");
    expect(source).toContain("PRINT_PREVIEW_DIALOG_BODY_CLASS");
    expect(source).toContain("PRINT_PREVIEW_DIALOG_FOOTER_CLASS");
    expect(source).toContain("min-w-[1320px]");
  });
});
