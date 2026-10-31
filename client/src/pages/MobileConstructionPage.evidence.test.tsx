import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("移动端施工日报关联影像", () => {
  it("在主管审核对话框中读取并展示本日报的水印照片", () => {
    const source = readFileSync(new URL("./MobileConstructionPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("trpc.construction.reportEvidence.useQuery");
    expect(source).toContain("const reviewEvidence");
    expect(source).toContain("随日报提交的现场照片");
    expect(source).toContain("水印照片仅对当前项目的主管审核范围显示");
    expect(source).toContain("点击预览");
    expect(source).toContain("ProtectedImagePreview");
    expect(source).toContain("站内预览");
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

  it("分别提供后置相机和手机相册入口，并将相册照片压缩后再生成水印", () => {
    const source = readFileSync(new URL("./MobileConstructionPage.tsx", import.meta.url), "utf8");

    expect(source).toContain('accept="image/*" capture="environment"');
    expect(source).toContain("拍摄现场照片");
    expect(source).toContain("从手机相册选择");
    expect(source).toContain("normalizeMobileImage(file, { maxEdge: 1920, quality: 0.84 })");
    expect(source).toContain("单次最多 12 张");
  });

  it("日报主体已保存但照片归档失败时保留编辑状态和已选照片，以便现场人员直接重试", () => {
    const source = readFileSync(new URL("./MobileConstructionPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("setEditingId(result.id);");
    expect(source).toContain("日报已保存，照片尚未归档");
    expect(source).toContain("removePendingEvidence");
  });
});
