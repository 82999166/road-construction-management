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

export const ENGINEERING_CALCULATOR_BY_ID = new Map(ENGINEERING_CALCULATOR_SPECS.map(spec => [spec.id, spec]));

export function normalizeEngineeringCalculatorTitle(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/^[A-Za-z]+(?:[-_]\d+)*(?:[.、\s-]+)?/i, "")
    .replace(/^\d+(?:[.、\s-]+)?/, "")
    .replace(/[（(][^()（）]*[)）]/g, "")
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "")
    .toLocaleLowerCase();
}

export const ENGINEERING_CALCULATOR_BY_TITLE = new Map(ENGINEERING_CALCULATOR_SPECS.map(spec => [normalizeEngineeringCalculatorTitle(spec.title), spec]));

export function getEngineeringCalculatorSpec(id: string, title: string) {
  const exact = ENGINEERING_CALCULATOR_BY_ID.get(id) ?? ENGINEERING_CALCULATOR_BY_TITLE.get(normalizeEngineeringCalculatorTitle(title));
  if (exact) return exact;
  const normalizedTitle = normalizeEngineeringCalculatorTitle(title);
  const candidates = ENGINEERING_CALCULATOR_SPECS.filter(spec => {
    const normalizedSpecTitle = normalizeEngineeringCalculatorTitle(spec.title);
    return normalizedTitle.length >= 4 && (normalizedTitle.includes(normalizedSpecTitle) || normalizedSpecTitle.includes(normalizedTitle));
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}
export { type EngineeringCalculatorSpec } from "./types";
