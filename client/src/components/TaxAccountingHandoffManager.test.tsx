import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PC财税辅助台账与资料交接", () => {
  it("仅归集真实业务资料，支持受控CSV快照与外部回执引用，不伪造税额或申报结果", () => {
    const component = readFileSync(new URL("./TaxAccountingHandoffManager.tsx", import.meta.url), "utf8");
    const router = readFileSync(new URL("../../../server/routers/finance.ts", import.meta.url), "utf8");
    const schema = readFileSync(new URL("../../../drizzle/schema.ts", import.meta.url), "utf8");

    expect(component).toContain("纳税主体、税务辅助台账与受控导出");
    expect(component).toContain("createTaxHandoffBatch");
    expect(component).toContain("downloadTaxHandoffBatch");
    expect(component).toContain("登记真实回执");
    expect(component).toContain("系统不会自动补算");
    expect(router).toContain("buildTaxHandoffManifest");
    expect(router).toContain("本函数不计算个人所得税、增值税、印花税或预缴税额");
    expect(router).toContain("transitionTaxHandoffBatch:");
    expect(router).toContain("snapshotHash");
    expect(schema).toContain("export const taxEntityProfiles");
    expect(schema).toContain("export const projectTaxProfiles");
    expect(schema).toContain("export const taxAuxiliaryEntries");
    expect(schema).toContain("export const taxHandoffBatches");
  });

  it("将来源枚举投影为中文，并固定批次生成时间的中国时区口径", () => {
    const component = readFileSync(new URL("./TaxAccountingHandoffManager.tsx", import.meta.url), "utf8");

    expect(component).toContain("function sourceDocumentLabel");
    expect(component).toContain('financial_record: "资金流水"');
    expect(component).toContain("sourceDocumentLabel(entry.sourceType, entry.sourceId)");
    expect(component).toContain("formatChinaDateTime(batch.generatedAt)");
    expect(component).not.toContain("`${entry.sourceType}:${entry.sourceId ?? \"\"}`");
  });
});
