/** 工程水印字段清单；顺序由超级管理员配置，实际值在取证时由受控现场元数据生成。 */
export const WATERMARK_TEMPLATE_SETTING_KEY = "EVIDENCE_WATERMARK_TEMPLATE";

export const WATERMARK_FIELD_OPTIONS = [
  { id: "capturedAt", label: "记录时间" },
  { id: "principal", label: "施工负责人" },
  { id: "weather", label: "天气" },
  { id: "location", label: "地点" },
  { id: "coordinates", label: "经纬度" },
  { id: "organization", label: "施工单位" },
  { id: "project", label: "项目名称" },
  { id: "antiCounterfeit", label: "防伪标识" },
] as const;

export type WatermarkTemplateField = (typeof WATERMARK_FIELD_OPTIONS)[number]["id"];

export type EvidenceWatermarkTemplate = {
  style: "engineering_card";
  title: string;
  organizationLabel: string;
  footerLabel: string;
  fields: WatermarkTemplateField[];
  position?: "bottom_left" | "bottom_right" | "top_left" | "top_right";
  size?: "compact" | "standard";
};

export const DEFAULT_EVIDENCE_WATERMARK_TEMPLATE: EvidenceWatermarkTemplate = {
  style: "engineering_card",
  title: "工程水印",
  organizationLabel: "悦信云智管",
  footerLabel: "工程影像 · 归档留痕",
  fields: ["capturedAt", "principal", "weather", "location", "coordinates", "organization", "project", "antiCounterfeit"],
  position: "bottom_left",
  size: "compact",
};

/** 损坏或历史配置统一降级为默认模板，避免现场采集因后台文案配置问题中断。 */
export function normalizeEvidenceWatermarkTemplate(value: unknown): EvidenceWatermarkTemplate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_EVIDENCE_WATERMARK_TEMPLATE, fields: [...DEFAULT_EVIDENCE_WATERMARK_TEMPLATE.fields] };
  const candidate = value as Partial<EvidenceWatermarkTemplate>;
  const knownFieldIds = new Set<string>(WATERMARK_FIELD_OPTIONS.map(item => item.id));
  const fields = Array.isArray(candidate.fields)
    ? Array.from(new Set(candidate.fields.filter((field): field is WatermarkTemplateField => typeof field === "string" && knownFieldIds.has(field)))).slice(0, WATERMARK_FIELD_OPTIONS.length)
    : [];
  return {
    style: "engineering_card",
    title: typeof candidate.title === "string" && candidate.title.trim() ? candidate.title.trim().slice(0, 24) : DEFAULT_EVIDENCE_WATERMARK_TEMPLATE.title,
    organizationLabel: typeof candidate.organizationLabel === "string" && candidate.organizationLabel.trim() ? candidate.organizationLabel.trim().slice(0, 48) : DEFAULT_EVIDENCE_WATERMARK_TEMPLATE.organizationLabel,
    footerLabel: typeof candidate.footerLabel === "string" && candidate.footerLabel.trim() ? candidate.footerLabel.trim().slice(0, 48) : DEFAULT_EVIDENCE_WATERMARK_TEMPLATE.footerLabel,
    fields: fields.length >= 2 ? fields : [...DEFAULT_EVIDENCE_WATERMARK_TEMPLATE.fields],
    position: candidate.position === "bottom_left" || candidate.position === "bottom_right" || candidate.position === "top_left" || candidate.position === "top_right" ? candidate.position : DEFAULT_EVIDENCE_WATERMARK_TEMPLATE.position,
    size: candidate.size === "compact" || candidate.size === "standard" ? candidate.size : DEFAULT_EVIDENCE_WATERMARK_TEMPLATE.size,
  };
}
