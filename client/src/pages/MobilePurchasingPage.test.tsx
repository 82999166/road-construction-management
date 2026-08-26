import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("移动采购清单费用录入", () => {
  it("支持普通单据照片上传与自动/手动金额两种方式", () => {
    const source = readFileSync(new URL("./MobilePurchasingPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("uploadPurchaseDocument");
    expect(source).toContain("拍摄并上传单据照片");
    expect(source).toContain("仅用手机后置相机拍摄并上传");
    expect(source).toContain("数量 × 单价自动计算");
    expect(source).toContain("手动填写金额");
    expect(source).toContain("amount: useManualAmount");
  });

  it("默认无发票，选择有发票后提供后置相机照片与电子发票 PDF 归档入口", () => {
    const source = readFileSync(new URL("./MobilePurchasingPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("无发票（默认）");
    expect(source).toContain("有发票，需归档附件");
    expect(source).toContain("拍摄发票照片");
    expect(source).toContain("选择电子发票 PDF");
    expect(source).toContain('accept="application/pdf"');
    expect(source).toContain('capture="environment"');
    expect(source).toContain("最长边 1920px、JPEG 质量 0.82");
    expect(source).toContain('uploadPurchaseDocumentFile(event.target.files?.[0], "invoice")');
  });
});


describe("移动采购订单详情", () => {
  it("将订单明细与单据、发票受控入口收敛到订单详情", () => {
    const source = readFileSync(new URL("./MobilePurchasingPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("采购订单详情 · {selectedOrder?.orderNo}");
    expect(source).toContain("查看/下载采购单据：{selectedOrder.documentAttachment.fileName}");
    expect(source).toContain("查看/下载发票附件：{selectedOrder.invoiceAttachment.fileName}");
    expect(source).toContain("pending_approval: \"待审核\"");
    expect(source).toContain("closed: \"已结算\"");
  });
});

describe("移动采购项目范围反馈", () => {
  it("区分项目授权请求失败与真实无授权项目，并允许重新获取服务端范围", () => {
    const source = readFileSync(new URL("./MobilePurchasingPage.tsx", import.meta.url), "utf8");
    expect(source).toContain('retry: 2');
    expect(source).toContain('refetchOnMount: "always"');
    expect(source).toContain("项目授权加载失败");
    expect(source).toContain("这不等同于没有项目权限");
    expect(source).toContain("重新获取授权项目");
    expect(source).toContain("projects.refetch()");
  });
});
