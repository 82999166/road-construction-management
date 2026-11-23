import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVIDENCE_WATERMARK_TEMPLATE,
  WATERMARK_FIELD_OPTIONS,
  normalizeEvidenceWatermarkTemplate,
  type EvidenceWatermarkTemplate,
} from "@shared/watermarkTemplate";

const historicalTemplate: EvidenceWatermarkTemplate = {
  style: "engineering_card",
  title: "道路施工取证",
  organizationLabel: "南丰高速项目部",
  footerLabel: "工程影像 · 防伪归档",
  fields: ["project", "capturedAt", "coordinates"],
};

describe("工程水印模板布局归一化", () => {
  it("默认完整对象为左下紧凑，旧模板不需要新增必填属性", () => {
    expect(WATERMARK_FIELD_OPTIONS.find(field => field.id === "capturedAt")).toEqual({ id: "capturedAt", label: "记录时间" });
    // 严格默认对象断言保留；新增布局是默认模板契约的一部分，不改为部分匹配。
    expect(DEFAULT_EVIDENCE_WATERMARK_TEMPLATE).toEqual({
      style: "engineering_card",
      title: "工程水印",
      organizationLabel: "悦信云智管",
      footerLabel: "工程影像 · 归档留痕",
      fields: ["capturedAt", "principal", "weather", "location", "coordinates", "organization", "project", "antiCounterfeit"],
      position: "bottom_left",
      size: "compact",
    });
    expect(normalizeEvidenceWatermarkTemplate(historicalTemplate)).toEqual({
      ...historicalTemplate,
      position: "bottom_left",
      size: "compact",
    });
    expect(normalizeEvidenceWatermarkTemplate({ ...historicalTemplate, footerLabel: "防伪水印 · 真实时间" }).footerLabel).toBe("防伪水印 · 真实时间");
  });

  it.each([null, undefined, false, "bad-json", [], 42])("非模板输入 %j 安全降级，返回独立字段数组", value => {
    const normalized = normalizeEvidenceWatermarkTemplate(value);
    expect(normalized).toEqual(DEFAULT_EVIDENCE_WATERMARK_TEMPLATE);
    expect(normalized.fields).not.toBe(DEFAULT_EVIDENCE_WATERMARK_TEMPLATE.fields);
  });

  it.each(["bottom_left", "bottom_right", "top_left", "top_right"] as const)("保留合法水印位置 %s 及原字段顺序", position => {
    expect(normalizeEvidenceWatermarkTemplate({ ...historicalTemplate, position })).toEqual({
      ...historicalTemplate,
      position,
      size: "compact",
    });
  });

  it.each(["compact", "standard"] as const)("保留合法大小 %s", size => {
    expect(normalizeEvidenceWatermarkTemplate({ ...historicalTemplate, position: "top_right", size })).toEqual({
      ...historicalTemplate,
      position: "top_right",
      size,
    });
  });

  it.each(["center", "BOTTOM_LEFT", "", null, 1, {}, ["bottom_left"]])("无效位置 %j 默认左下且不覆盖合法大小", position => {
    expect(normalizeEvidenceWatermarkTemplate({ ...historicalTemplate, position, size: "standard" })).toEqual({
      ...historicalTemplate,
      position: "bottom_left",
      size: "standard",
    });
  });

  it.each(["large", "COMPACT", "", null, 1, {}, ["compact"]])("无效大小 %j 默认紧凑且不覆盖合法位置", size => {
    expect(normalizeEvidenceWatermarkTemplate({ ...historicalTemplate, position: "top_left", size })).toEqual({
      ...historicalTemplate,
      position: "top_left",
      size: "compact",
    });
  });

  it("布局扩展仍保留原有文案修剪、字段去重及排序规则，不修改历史对象", () => {
    const candidate = {
      ...historicalTemplate,
      title: "  道路取证  ",
      organizationLabel: "  项目施工单位  ",
      footerLabel: "  防伪归档  ",
      fields: ["project", "unknown", "capturedAt", "project", "coordinates", 2],
      position: "invalid",
      size: "invalid",
    };
    const original = JSON.stringify(candidate);
    expect(normalizeEvidenceWatermarkTemplate(candidate)).toEqual({
      style: "engineering_card",
      title: "道路取证",
      organizationLabel: "项目施工单位",
      footerLabel: "防伪归档",
      fields: ["project", "capturedAt", "coordinates"],
      position: "bottom_left",
      size: "compact",
    });
    expect(JSON.stringify(candidate)).toBe(original);
    expect(normalizeEvidenceWatermarkTemplate({ fields: ["capturedAt"], position: "top_left", size: "standard" })).toEqual({
      ...DEFAULT_EVIDENCE_WATERMARK_TEMPLATE,
      position: "top_left",
      size: "standard",
    });
  });
});

describe("后台工程水印设置卡 source wiring contract", () => {
  const source = readFileSync(new URL("../pages/AdminPage.tsx", import.meta.url), "utf8");
  const titleIndex = source.indexOf("工程水印信息模板");
  const cardStart = source.lastIndexOf('{settingsCategory === "media" ? (', titleIndex);
  const card = source.slice(cardStart, source.indexOf('{settingsCategory === "governance" ? (', titleIndex));

  it("两个 Select 修改同一模板状态，完整布局随保存提交", () => {
    expect(card.match(/<Select\s/g)).toHaveLength(2);
    expect(card).toContain('value={watermarkTemplateForm.position ?? "bottom_left"}');
    expect(card).toContain('value={watermarkTemplateForm.size ?? "compact"}');
    expect(card).toContain('position: value as EvidenceWatermarkTemplate["position"]');
    expect(card).toContain('size: value as EvidenceWatermarkTemplate["size"]');
    for (const position of ["bottom_left", "bottom_right", "top_left", "top_right"]) {
      expect(card).toContain(`<SelectItem value="${position}">`);
    }
    for (const size of ["compact", "standard"]) {
      expect(card).toContain(`<SelectItem value="${size}">`);
    }
    const saving = card.slice(card.indexOf("saveEvidenceWatermarkTemplate.mutate({"));
    expect(saving).toContain('position: watermarkTemplateForm.position ?? "bottom_left"');
    expect(saving).toContain('size: watermarkTemplateForm.size ?? "compact"');
  });

  it("移除厚蓝条 DOM 示意，完整字段顺序直接传入统一 Canvas 组件", () => {
    expect(source).toContain('import { EngineeringWatermarkPreview } from "@/components/EngineeringWatermarkPreview"');
    expect(card).toContain("<EngineeringWatermarkPreview");
    expect(card).toContain("template={watermarkTemplateForm}");
    expect(card).toContain("lines={watermarkTemplateForm.fields.map(field =>");
    expect(card).not.toContain(".slice(");
    expect(card).not.toContain("mt-24 max-w-[280px]");
    expect(card).not.toContain("bg-[#2177d3] px-3 py-2");
    const preview = card.slice(card.indexOf("<EngineeringWatermarkPreview"), card.indexOf("className=\"w-full rounded-xl\""));
    for (const field of DEFAULT_EVIDENCE_WATERMARK_TEMPLATE.fields) {
      expect(preview).toContain(`${field}:`);
    }
    expect(preview.match(/详细地点：/g)).toHaveLength(1);
    expect(preview).toContain('coordinates: "经纬度：115.123456, 28.123456"');
    expect(preview).toContain('capturedAt: "记录时间：2026/08/16 13:31:00（示例）"');
    expect(card).toContain("文字自动换行并保留边距");
    expect(card).toContain("预览仅为示例，不代表拍摄地点");
    expect(card).toContain("记录时间为归档记录时刻，相册照片不读取原始拍摄时间");
    expect(card).toContain("保存后仅对新照片生效，历史照片不重写");
  });
});
