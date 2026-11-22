import { describe, expect, it } from "vitest";
import {
  CONSTRUCTION_REPORT_SHEET_CSS,
  CONSTRUCTION_PRINT_PHOTO_CSS,
  constructionCsv,
  constructionPrintBody,
  constructionPrintEvidencePhotos,
  type ConstructionWorkspaceReport,
  type ConstructionPrintPhoto,
} from "./constructionOutput";
const report = (id: number) =>
  ({
    id,
    projectId: 9,
    reportDate: "2026-11-16",
    workArea: "K10完整右侧作业面",
    weather: "sunny",
    workContent: "第一行\n完整施工正文-END",
    constructionPlan: "下一步计划-END",
    safetyNotes: null,
    issueNotes: "问题原文",
    issuePriority: "urgent",
    progressPercent: "15.50",
    status: "draft",
    createdBy: 1,
    createdByName: "登记人",
    reviewReply: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: "2026-11-16T02:00:00Z",
    updatedAt: "2026-11-16T02:00:00Z",
  }) as ConstructionWorkspaceReport;
const photo = (id: number, reportId = 11) => ({
  id,
  projectId: 9,
  reportId,
  fileName: `现场${id}.jpg`,
  capturedAt: "2026-11-16T02:00:00Z",
  description: `照片原说明${id}`,
  url: `https://signed.example/photo-${id}?signature=short&expires=123`,
});
const metadata = { projectName: "工程", filterText: "当前筛选", total: 2 };
describe("完整施工影像A4输出", () => {
  it("统一184mm安全页内上限，照片contain不截水印且附件每组两张起页", () => {
    expect(CONSTRUCTION_REPORT_SHEET_CSS).toContain("max-width: 184mm");
    expect(CONSTRUCTION_REPORT_SHEET_CSS).not.toContain("max-width: none");
    expect(CONSTRUCTION_PRINT_PHOTO_CSS).toContain("object-fit: contain");
    expect(CONSTRUCTION_PRINT_PHOTO_CSS).toContain("height: 95mm");
    expect(CONSTRUCTION_PRINT_PHOTO_CSS).toContain("break-before: page");
  });
  it("3张、2张、无照片日报准确分组，不串图不漏图保留全部正文和说明", () => {
    const photos = [photo(1), photo(2), photo(3), photo(4, 12), photo(5, 12)];
    const html = constructionPrintBody(
      [report(11), report(12), report(13)],
      metadata,
      photos
    );
    expect(html.match(/class="daily-report-photo"/g)).toHaveLength(5);
    expect(html.match(/class="daily-report-evidence-page"/g)).toHaveLength(3);
    expect(html).toContain('data-report-id="11" data-photo-id="3"');
    expect(html).toContain('data-report-id="12" data-photo-id="5"');
    expect(html).not.toContain('data-report-id="13" data-photo-id');
    expect(html.indexOf('data-photo-id="3"')).toBeLessThan(
      html.indexOf('aria-label="施工日志 12"')
    );
    expect(html).toContain("完整施工正文-END");
    expect(html).toContain("下一步计划-END");
    expect(html).toContain("照片 3 / 3");
  });
  it("只显式投影服务端已鉴权影像，隐藏fileKey原始URL和账户额外属性", () => {
    const raw = {
      ...photo(1),
      fileKey: "/private/file",
      originalUrl: "secret-original",
      email: "secret-account",
    };
    const photos = constructionPrintEvidencePhotos(
      { projectId: 9, reportIds: [11], photos: [raw] },
      [report(11)]
    );
    expect(photos[0]).not.toHaveProperty("fileKey");
    const html = constructionPrintBody([report(11)], metadata, photos);
    expect(html).not.toContain("/private/");
    expect(html).not.toContain("secret-original");
    expect(html).not.toContain("secret-account");
  });
  it.each([
    { projectId: 8, reportIds: [11], photos: [] },
    { projectId: 9, reportIds: [12], photos: [] },
    { projectId: 9, reportIds: [11, 11], photos: [] },
    { projectId: 9, reportIds: [11], photos: [photo(1, 12)] },
    { projectId: 9, reportIds: [11], photos: [{ ...photo(1), projectId: 8 }] },
    { projectId: 9, reportIds: [11], photos: [photo(1), photo(1)] },
    {
      projectId: 9,
      reportIds: [11],
      photos: [{ ...photo(1), url: "javascript:alert(1)" }],
    },
    {
      projectId: 9,
      reportIds: [11],
      photos: [{ ...photo(1), url: "data:image/png;base64,AAA" }],
    },
    {
      projectId: 9,
      reportIds: [11],
      photos: [{ ...photo(1), capturedAt: "invalid" }],
    },
  ])("项目/清单/影像/URL错误拒绝输出：%j", evidence => {
    expect(() =>
      constructionPrintEvidencePhotos(evidence, [report(11)])
    ).toThrow();
  });
  it("照片说明、文件名及签名属性XSS转义，图片主动加载且不泄露Referer", () => {
    const p: ConstructionPrintPhoto = {
      ...photo(1),
      fileName: "<script>alert(1)</script>",
      description: "<img src=x onerror=alert(1)>\n保留说明",
      url: 'https://signed.example/photo?token=a&quote=" onerror="bad',
    };
    const html = constructionPrintBody([report(11)], metadata, [p]);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&amp;quote=&quot;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain(' onerror="');
    expect(html).toContain('loading="eager"');
    expect(html).toContain('referrerpolicy="no-referrer"');
  });
  it("CSV仍无照片、签名URL和附页，旧详情任意URL属性不进入打印", () => {
    const item = {
      ...report(11),
      url: photo(1).url,
      imageUrls: [photo(2).url],
    };
    const csv = constructionCsv([item], metadata);
    const html = constructionPrintBody([item], metadata);
    expect(csv).not.toContain("signed.example");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("signed.example");
  });
  it("已鉴权的空影像清单明确允许仅正文，250日报和末份多图完整", () => {
    const reports = Array.from({ length: 250 }, (_, i) => report(i + 1));
    const photos = [
      photo(1, 1),
      ...Array.from({ length: 9 }, (_, i) => photo(i + 2, 250)),
    ];
    const accepted = constructionPrintEvidencePhotos(
      { projectId: 9, reportIds: reports.map(r => r.id), photos },
      reports
    );
    const html = constructionPrintBody(
      reports,
      { ...metadata, total: 501 },
      accepted
    );
    expect(html.match(/class="daily-report-sheet"/g)).toHaveLength(250);
    expect(html.match(/class="daily-report-photo"/g)).toHaveLength(10);
    expect(html).toContain('data-report-id="250" data-photo-id="10"');
    expect(
      constructionPrintEvidencePhotos(
        { projectId: 9, reportIds: [11], photos: [] },
        [report(11)]
      )
    ).toEqual([]);
  });
});
