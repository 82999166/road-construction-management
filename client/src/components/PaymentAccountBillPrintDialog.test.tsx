import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { chunkPaymentBillRecords } from "./PaymentAccountBillPrintDialog";

describe("支付账号账单批量打印", () => {
  it("固定每页三排，并随每排账单数量自动分页", () => {
    const records = Array.from({ length: 13 }, (_, index) => index + 1);
    expect(chunkPaymentBillRecords(records, 2)).toEqual([
      [1, 2, 3, 4, 5, 6],
      [7, 8, 9, 10, 11, 12],
      [13],
    ]);
    expect(chunkPaymentBillRecords(records, 4)).toEqual([
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      [13],
    ]);
  });

  it("沿用参考文件的图片导入、A4纵向批量排版和本地隐私边界", () => {
    const source = readFileSync(new URL("./PaymentAccountBillPrintDialog.tsx", import.meta.url), "utf8");
    expect(source).toContain("FIXED_ROWS = 3");
    expect(source).toContain("@page{size:A4 portrait;margin:0}");
    expect(source).toContain("FileReader");
    expect(source).toContain('file.type.startsWith("image/")');
    expect(source).toContain("不会上传、保存或写入项目财务流水");
    expect(source).not.toContain("trpc.");
  });

  it("限制单次会话图片数量和总大小，避免浏览器大批量打印失稳", () => {
    const source = readFileSync(new URL("./PaymentAccountBillPrintDialog.tsx", import.meta.url), "utf8");
    expect(source).toContain("MAX_RECORDS = 80");
    expect(source).toContain("MAX_TOTAL_BYTES = 100 * 1024 * 1024");
    expect(source).toContain("超过 100 MB");
  });
});
