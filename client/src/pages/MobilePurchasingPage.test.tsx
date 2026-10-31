import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("移动采购清单费用录入", () => {
  it("支持普通单据的相机相册双入口上传与自动/手动金额两种方式", () => {
    const source = readFileSync(new URL("./MobilePurchasingPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("uploadPurchaseDocument");
    expect(source).toContain("拍摄单据照片");
    expect(source).toContain("从手机相册选择");
    expect(source).toContain('accept="image/*"');
    expect(source).toContain("normalizeMobileImage(file, { maxEdge: 1920, quality: 0.82 })");
    expect(source).toContain("数量 × 单价自动计算");
    expect(source).toContain("手动填写金额");
    expect(source).toContain("amount: useManualAmount");
  });

  it("默认无发票，选择有发票后提供相机、相册和电子 PDF 归档入口", () => {
    const source = readFileSync(new URL("./MobilePurchasingPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("无发票（默认）");
    expect(source).toContain("有发票，需归档附件");
    expect(source).toContain("拍摄发票");
    expect(source).toContain("手机相册");
    expect(source).toContain("电子 PDF");
    expect(source).toContain('accept="application/pdf"');
    expect(source).toContain('capture="environment"');
    expect(source).toContain("最长边 1920px、JPEG 质量 0.82");
    expect(source).toContain('uploadPurchaseDocumentFile(event.target.files?.[0], "invoice")');
  });
});

describe("移动采购库存凭证与权限反馈", () => {
  it("库存入库提供相机直拍、相册选择、受控凭证关联和权限收敛", () => {
    const source = readFileSync(new URL("./MobilePurchasingPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("const canManageInventory = purchasingCapabilities.data?.canManageInventory === true");
    expect(source).toContain("当前账号可查看库存，但未获“仓储收发”写入权限");
    expect(source).toContain("入库验收凭证（建议上传）");
    expect(source).toContain("拍摄入库凭证");
    expect(source).toContain('uploadPurchaseDocumentFile(event.target.files?.[0], "inventory")');
    expect(source).toContain("evidenceId: inventoryDraft.evidenceId ? Number(inventoryDraft.evidenceId) : null");
    expect(source).toContain("查看凭证");
    expect(source).toContain("ProtectedImagePreview");
    expect(source).toContain("当前页面内预览，不会下载");
  });
});

describe("移动采购订单详情", () => {
  it("将订单明细与单据、发票受控入口收敛到订单详情", () => {
    const source = readFileSync(new URL("./MobilePurchasingPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("采购订单详情 · {selectedOrder?.orderNo}");
    expect(source).toContain("查看采购单据：{selectedOrder.documentAttachment.fileName}");
    expect(source).toContain("title=\"采购单据\"");
    expect(source).toContain("查看发票附件：{selectedOrder.invoiceAttachment.fileName}");
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

describe("采购仓储当前筛选导出与打印", () => {
  it("按当前项目、标签和订单状态筛选真实记录，并生成独立 A4 汇总", () => {
    const source = readFileSync(new URL("./MobilePurchasingPage.tsx", import.meta.url), "utf8");
    expect(source).toContain('const [orderPrintStatus, setOrderPrintStatus] = useState("all")');
    expect(source).toContain("filteredOrders");
    expect(source).toContain("CurrentFilterPrintActions");
    expect(source).toContain("downloadCurrentFilteredCsv");
    expect(source).toContain("openA4LandscapePrintDocument");
    expect(source).toContain("采购订单明细表");
    expect(source).toContain("库存余额明细表");
    expect(source).toContain("采购申请明细表");
  });

  it("未知状态不回显内部英文，订单时间使用中国时区且录入默认使用设备时间", () => {
    const source = readFileSync(new URL("./MobilePurchasingPage.tsx", import.meta.url), "utf8");

    expect(source).toContain('labels[status] ?? "待处理"');
    expect(source).toContain("formatChinaDateTime(order.orderedAt)");
    expect(source).toContain("formatChinaDateTime(selectedOrder.orderedAt)");
    expect(source).toContain("orderedAt: toDeviceDateTimeInput()");
    expect(source).toContain("settledAt: toDeviceDateTimeInput()");
  });
});

describe("采购订单上传人筛选与半A4票据打印", () => {
  it("按上传人筛选，并提供左侧信息右侧票据图片的半A4打印", () => {
    const source = readFileSync(new URL("./MobilePurchasingPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("orderUploaderId");
    expect(source).toContain("按上传人筛选");
    expect(source).toContain("打印半A4票据");
    expect(source).toContain("grid-template-columns:1fr 1fr");
    expect(source).toContain("width:92mm;height:128mm");
    expect(source).toContain("上传人：");
  });
});
