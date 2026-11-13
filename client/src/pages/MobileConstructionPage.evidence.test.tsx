import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = readFileSync(
  new URL("./MobileConstructionPage.tsx", import.meta.url),
  "utf8"
);
const workspace = readFileSync(
  new URL("../components/ConstructionWorkspace.tsx", import.meta.url),
  "utf8"
);
describe("移动端施工日报关联影像与工作区集成", () => {
  it("主管审核仍按本日报ID读取原水印照片，不预取列表全部照片", () => {
    for (const text of [
      "trpc.construction.reportEvidence.useQuery",
      "const reviewEvidence",
      "随日报提交的现场照片",
      "水印照片仅对当前项目的主管审核范围显示",
      "reviewTarget ? [reviewTarget.id] : []",
      "reportEvidenceIds.length > 0",
      "ProtectedImagePreview",
      "照片读取失败",
    ])
      expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
        text.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
      );
  });
  it("四栏目复用独立工作区及集中详情，手机页不再重复加载全项目列表统计", () => {
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "<ConstructionWorkspace".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "active={isAuthenticated}".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "renderMobileActions={(report, capabilities)"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).not.toContain(
      "trpc.construction.listReports.useQuery"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).not.toContain(
      "trpc.construction.summary.useQuery"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    for (const text of [
      "<ConstructionReportDetail report={detail} active={active}",
      "详情不授予编辑或审核权限",
      "<ConstructionReportSheet",
    ])
      expect(
        workspace.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
      ).toContain(text.replace(/\s+/g, "").replace(/,([})\]])/g, "$1"));
  });
  it("PC手机共用的新日报表单保留审核时间和审核人", () => {
    const sheet = readFileSync(
      new URL("../lib/constructionOutput.ts", import.meta.url),
      "utf8"
    );
    expect(sheet).toContain("审核时间");
    expect(sheet).toContain("report.reviewedByName");
    expect(sheet).toContain("report.reviewedAt");
  });
  it("原设备日期/中国时区不变，打印导出使用完整当前筛选不截取施工内容", () => {
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "return toDeviceDateInput();"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "return formatChinaDateTime(value);"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    for (const text of [
      "utils.construction.outputManifest.fetch",
      "utils.construction.printReports.fetch",
      "utils.construction.exportReports.fetch",
      "openA4PrintDocument",
    ])
      expect(
        workspace.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
      ).toContain(text.replace(/\s+/g, "").replace(/,([})\]])/g, "$1"));
    expect(
      source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).not.toContain(
      "report.workContent.slice(0, 240)"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).not.toContain(
      "onClick={() => window.print()}"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });
  it("原后置相机、相册及压缩/水印/12张/来源绑定流程保留", () => {
    for (const text of [
      'accept="image/*" capture="environment"',
      "拍摄现场照片",
      "从手机相册选择",
      "normalizeMobileImage(file, { maxEdge: 1920, quality: 0.84 })",
      "单次最多 12 张",
      "createWatermarkedImage(file, watermarkLines, watermarkTemplate)",
      "sourceId: `construction-report-${result.id}`",
      'sourceType: "site_photo"',
    ])
      expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
        text.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
      );
  });
  it("照片失败仍保留编辑态和照片可重试，切项目确认并清空，切栏目不清空表单", () => {
    for (const text of [
      "setEditingId(result.id);",
      "日报已保存，照片尚未归档",
      "removePendingEvidence",
      "requestReportClose(() => {",
      "changeProject(Number(value))",
      "正在保存或处理施工日报，请完成后再切换项目",
      "onCreate={openCreate}",
    ])
      expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
        text.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
      );
    expect(
      source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).not.toContain(
      "const [tab,".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
  });
  it("主管审核入口按原项目能力收敛，保留原审核接口和字段", () => {
    for (const text of [
      "capabilities.canSupervisorReview",
      'decision: "confirm", reply: reviewReply',
      'decision: "return", reply: reviewReply',
      'isOwner && report.status === "draft"',
      "(isOwner || isSuperAdmin)",
      "日报已按统一主管审核设置自动归档",
    ])
      expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
        text.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
      );
  });
});
