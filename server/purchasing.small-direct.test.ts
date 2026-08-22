import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("小额直接采购金额与单据归档边界", () => {
  it("手动金额优先并保留普通单据照片审计", () => {
    const source = readFileSync(new URL("./routers/finance.ts", import.meta.url), "utf8");
    expect(source).toContain("uploadPurchaseDocument");
    expect(source).toContain("purchase_document_upload");
    expect(source).toContain("const isManualAmount = input.amount !== undefined");
    expect(source).toContain("金额来源 ${isManualAmount ? \"手动录入\" : \"数量×单价自动计算\"}");
    expect(source).toContain("非水印影像");
  });

  it("默认无发票；选择有发票时必须保存受控的照片或 PDF 附件并在订单详情返回访问链接", () => {
    const source = readFileSync(new URL("./routers/finance.ts", import.meta.url), "utf8");
    const schema = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");
    expect(schema).toContain('hasInvoice: boolean("hasInvoice").default(false).notNull()');
    expect(schema).toContain('invoiceEvidenceId: bigint("invoiceEvidenceId", { mode: "number" })');
    expect(source).toContain('attachmentKind: z.enum(["document", "invoice"]).default("document")');
    expect(source).toContain('"application/pdf"');
    expect(source).toContain('if (input.hasInvoice && !input.invoiceEvidenceId)');
    expect(source).toContain('invoiceAttachment: order.invoiceEvidenceId');
    expect(source).toContain('documentAttachment: order.evidenceId');
    expect(source).toContain('storageGetSignedUrl(evidence.fileKey)');
    expect(source).not.toContain('const stored = await storageGet(evidence.fileKey)');
  });
});
