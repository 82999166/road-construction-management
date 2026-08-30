import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("移动端施工日报关联影像", () => {
  it("在主管审核对话框中读取并展示本日报的水印照片", () => {
    const source = readFileSync(new URL("./MobileConstructionPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("trpc.construction.reportEvidence.useQuery");
    expect(source).toContain("const reviewEvidence");
    expect(source).toContain("随日报提交的现场照片");
    expect(source).toContain("水印照片仅对当前项目的主管审核范围显示");
    expect(source).toContain("点击放大");
  });

  it("使用设备日期、中国时区与独立 A4 日报打印，且未知状态不回显内部枚举", () => {
    const source = readFileSync(new URL("./MobileConstructionPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("return toDeviceDateInput();");
    expect(source).toContain("return formatChinaDateTime(value);");
    expect(source).toContain("return labels[value] ?? { label: \"待处理\"");
    expect(source).toContain("function printCurrentReports()");
    expect(source).toContain("openA4LandscapePrintDocument");
    expect(source).toContain("onClick={printCurrentReports}");
    expect(source).not.toContain("onClick={() => window.print()}");
  });
});
