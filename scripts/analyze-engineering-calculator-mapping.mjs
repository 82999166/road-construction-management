import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = "/home/ubuntu/road-construction-management";
const docsDir = join(root, "docs/proposals/工程工具知识全量清单");
const specsDir = join(root, "client/src/lib/engineering-calculators/generated");
const norm = value => String(value ?? "").replace(/<[^>]+>/g, "").replace(/^[A-Za-z]+(?:[-_]\d+)*(?:[.、\s-]+)?/i, "").replace(/^\d+(?:[.、\s-]+)?/, "").replace(/[（(][^()（）]*[)）]/g, "").replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "").toLowerCase();
const field = (block, label) => (block.match(new RegExp(`(?:^|\\n)(?:-\\s*)?(?:\\*\\*)?${label}(?:\\*\\*)?[:：]\\s*([^\\n]+)`, "m"))?.[1] ?? "").trim();
const sourceFiles = readdirSync(docsDir).filter(name => /^0[1-8]_/.test(name));
const items = sourceFiles.flatMap(file => readFileSync(join(docsDir, file), "utf8").split(/(?=^#{2,3}\s+)/m).filter(block => /二级分类/.test(block)).map((block, index) => ({ file, index, id: field(block, "编号"), title: field(block, "名称") || block.match(/^#{2,3}\s+(.+)$/m)?.[1] || "", formula: field(block, "公式或操作步骤"), auto: field(block, "是否适合自动计算") })));
const specs = readdirSync(specsDir).filter(name => name.endsWith(".ts")).flatMap(file => {
  const text = readFileSync(join(specsDir, file), "utf8");
  return [...text.matchAll(/id:\s*["']([^"']+)["'][\s\S]{0,120}?title:\s*["']([^"']+)["']/g)].map((match, index) => ({ file, index, id: match[1], title: match[2] }));
});
const score = (a, b) => {
  const x = norm(a); const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 100;
  if (x.includes(y) || y.includes(x)) return 90;
  const chars = new Set(x); const common = [...new Set(y)].filter(char => chars.has(char)).length;
  return Math.round((2 * common * 100) / (new Set(x).size + new Set(y).size));
};
const matched = new Map();
for (const spec of specs) {
  let candidates = items.filter(item => item.id === spec.id);
  if (!candidates.length) candidates = items.map(item => ({ item, score: score(item.title, spec.title) })).filter(candidate => candidate.score >= 62).sort((a, b) => b.score - a.score).slice(0, 1).map(candidate => candidate.item);
  if (candidates[0] && !matched.has(candidates[0].id || `${candidates[0].file}:${candidates[0].index}`)) matched.set(candidates[0].id || `${candidates[0].file}:${candidates[0].index}`, { spec, item: candidates[0] });
}
const unmatchedSpecs = specs.filter(spec => ![...matched.values()].some(value => value.spec === spec));
const unmatchedItems = items.filter(item => !matched.has(item.id || `${item.file}:${item.index}`));
const result = { itemCount: items.length, specCount: specs.length, matchedCount: matched.size, unmatchedSpecCount: unmatchedSpecs.length, unmatchedItemCount: unmatchedItems.length, unmatchedSpecs: unmatchedSpecs.slice(0, 80), unmatchedItems: unmatchedItems.slice(0, 100) };
writeFileSync(join(root, "docs/diagnostics/engineering-calculator-mapping.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
