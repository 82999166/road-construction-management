import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (name: string) => readFileSync(resolve(process.cwd(), "client/src/components/ui", name), "utf8");

describe("通用控件中文化", () => {
  it("将弹窗、抽屉与侧边栏的关闭和导航提示中文化", () => {
    expect(source("dialog.tsx")).toContain('<span className="sr-only">关闭</span>');
    expect(source("sheet.tsx")).toContain('<span className="sr-only">关闭</span>');
    expect(source("sidebar.tsx")).toContain("展开或收起侧边栏");
    expect(source("sidebar.tsx")).toContain("显示移动端侧边栏。");
  });

  it("将分页、轮播和面包屑的用户提示中文化", () => {
    const pagination = source("pagination.tsx");
    expect(pagination).toContain("上一页");
    expect(pagination).toContain("下一页");
    expect(pagination).toContain("更多页码");
    expect(source("carousel.tsx")).toContain("上一项");
    expect(source("carousel.tsx")).toContain("下一项");
    expect(source("breadcrumb.tsx")).toContain("面包屑导航");
    expect(source("breadcrumb.tsx")).toContain('<span className="sr-only">更多</span>');
  });
});
