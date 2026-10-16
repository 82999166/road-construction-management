import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readSource = (fileName: string) =>
  readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");

describe("PC 管理后台弹窗宽屏布局", () => {
  it("通用业务弹窗在桌面端使用大工作区宽度，并保留视口高度保护", () => {
    const source = readSource("dialog.tsx");

    expect(source).toContain("sm:max-w-[92vw]");
    expect(source).toContain("xl:max-w-[1280px]");
    expect(source).toContain("2xl:max-w-[1440px]");
    expect(source).toContain("max-h-[calc(100vh-2rem)]");
    expect(source).toContain("overflow-y-auto");
    expect(source).not.toContain("sm:max-w-lg");
  });

  it("确认窗口在PC端同步扩大，但不占用整屏", () => {
    const source = readSource("alert-dialog.tsx");

    expect(source).toContain("sm:max-w-xl");
    expect(source).toContain("lg:max-w-2xl");
    expect(source).toContain("max-h-[calc(100vh-2rem)]");
  });

  it("财务支出分类明细和后台存量表单不再维持窄窗", () => {
    const source = readFileSync(
      new URL("../../pages/AdminPage.tsx", import.meta.url),
      "utf8"
    );

    expect(source).toContain(
      'className="max-h-[90vh] w-[calc(100vw-3rem)] max-w-[1440px] overflow-y-auto"'
    );
    expect(source).not.toContain('className="max-h-[90vh] max-w-6xl overflow-y-auto"');
    expect(source).toContain("xl:max-w-5xl");
  });
});
