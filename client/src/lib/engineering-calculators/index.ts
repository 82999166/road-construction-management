import type { EngineeringCalculatorSpec } from "./types";
import { categoryCalculatorSpecs as buildingSpecs } from "./generated/spec-1";
import { categoryCalculatorSpecs as materialSpecs } from "./generated/spec-2";
import { categoryCalculatorSpecs as geotechSpecs } from "./generated/spec-3";
import { categoryCalculatorSpecs as highwaySpecs } from "./generated/spec-4";
import { categoryCalculatorSpecs as railwaySpecs } from "./generated/spec-5";
import { categoryCalculatorSpecs as surveySpecs } from "./generated/spec-6";
import { categoryCalculatorSpecs as machinerySpecs } from "./generated/spec-7";
import { categoryCalculatorSpecs as settlementSpecs } from "./generated/spec-8";

/** 审校分卷中公式与示例完整、可执行的自动计算器集合。 */
export const ENGINEERING_CALCULATOR_SPECS: EngineeringCalculatorSpec[] = [
  ...buildingSpecs,
  ...materialSpecs,
  ...geotechSpecs,
  ...highwaySpecs,
  ...railwaySpecs,
  ...surveySpecs,
  ...machinerySpecs,
  ...settlementSpecs,
];

/**
 * 计算器和知识库共用的八个专业分卷。分组从上方已经统一类型的目录派生，
 * 避免生成规格中各自的局部类型影响工作台消费方。
 */
const inGroup = (source: readonly { id: string }[]) => {
  const ids = new Set(source.map(spec => spec.id));
  return ENGINEERING_CALCULATOR_SPECS.filter(spec => ids.has(spec.id));
};

export const ENGINEERING_CALCULATOR_GROUPS = [
  {
    id: "building",
    label: "建筑市政",
    short: "房建、结构与市政",
    knowledgeTab: "建筑市政",
    specs: inGroup(buildingSpecs),
  },
  {
    id: "material",
    label: "材料配比",
    short: "材料、配比与试验",
    knowledgeTab: "材料配比",
    specs: inGroup(materialSpecs),
  },
  {
    id: "geotech",
    label: "土工路基",
    short: "土工、路基与地基",
    knowledgeTab: "土工路基",
    specs: inGroup(geotechSpecs),
  },
  {
    id: "highway",
    label: "公路",
    short: "路线、桥涵与隧道",
    knowledgeTab: "公路",
    specs: inGroup(highwaySpecs),
  },
  {
    id: "railway",
    label: "铁路",
    short: "路基、轨道与站场",
    knowledgeTab: "铁路",
    specs: inGroup(railwaySpecs),
  },
  {
    id: "survey",
    label: "测量工程量",
    short: "测量、放样与工程量",
    knowledgeTab: "测量工程量",
    specs: inGroup(surveySpecs),
  },
  {
    id: "machinery",
    label: "机械运输",
    short: "机械、运输与成本",
    knowledgeTab: "机械运输",
    specs: inGroup(machinerySpecs),
  },
  {
    id: "settlement",
    label: "计量结算",
    short: "计量、合同与术语",
    knowledgeTab: "计量结算",
    specs: inGroup(settlementSpecs),
  },
] as const;

export type EngineeringCalculatorGroup =
  (typeof ENGINEERING_CALCULATOR_GROUPS)[number];

export const ENGINEERING_CALCULATOR_BY_ID = new Map(
  ENGINEERING_CALCULATOR_SPECS.map(spec => [spec.id, spec])
);

export function normalizeEngineeringCalculatorTitle(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/^[A-Za-z]+(?:[-_]\d+)*(?:[.、\s-]+)?/i, "")
    .replace(/^\d+(?:[.、\s-]+)?/, "")
    .replace(/[（(][^()（）]*[)）]/g, "")
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "")
    .toLocaleLowerCase();
}

export const ENGINEERING_CALCULATOR_BY_TITLE = new Map(
  ENGINEERING_CALCULATOR_SPECS.map(spec => [
    normalizeEngineeringCalculatorTitle(spec.title),
    spec,
  ])
);

export function getEngineeringCalculatorSpec(id: string, title: string) {
  const exact =
    ENGINEERING_CALCULATOR_BY_ID.get(id) ??
    ENGINEERING_CALCULATOR_BY_TITLE.get(
      normalizeEngineeringCalculatorTitle(title)
    );
  if (exact) return exact;
  const normalizedTitle = normalizeEngineeringCalculatorTitle(title);
  const candidates = ENGINEERING_CALCULATOR_SPECS.filter(spec => {
    const normalizedSpecTitle = normalizeEngineeringCalculatorTitle(spec.title);
    return (
      normalizedTitle.length >= 4 &&
      (normalizedTitle.includes(normalizedSpecTitle) ||
        normalizedSpecTitle.includes(normalizedTitle))
    );
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}
export { type EngineeringCalculatorSpec } from "./types";
