import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("独立 A4 打印文档", () => {
  it("通过内嵌浏览器文档写入打印内容，不依赖弹窗层或浏览器弹窗权限", () => {
    const source = readFileSync(new URL("./a4Print.ts", import.meta.url), "utf8");

    expect(source).toContain('document.createElement("iframe")');
    expect(source).toContain("printWindow.document.write");
    expect(source).toContain("frame.contentWindow");
    expect(source).toContain("@page { size:A4 landscape");
    expect(source).toContain("window.print()");
    expect(source).toContain("escapePrintHtml");
  });
});
