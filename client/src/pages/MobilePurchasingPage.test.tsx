import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = readFileSync(
  new URL("./MobilePurchasingPage.tsx", import.meta.url),
  "utf8"
);
const workspace = readFileSync(
  new URL("../components/PurchasingWorkspace.tsx", import.meta.url),
  "utf8"
);
const output = readFileSync(
  new URL("../lib/purchasingWorkspace.ts", import.meta.url),
  "utf8"
);

describe("移动采购清单费用录入", () => {
  it("支持普通单据的相机相册双入口上传与自动/手动金额两种方式", () => {
    expect(source).toContain("uploadPurchaseDocument");
    expect(source).toContain("拍摄单据照片");
    expect(source).toContain("从手机相册选择");
    expect(source).toContain('accept="image/*"');
    expect(source).toContain(
      "normalizeMobileImage(file, { maxEdge: 1920, quality: 0.82 })"
    );
    expect(source).toContain("数量 × 单价自动计算");
    expect(source).toContain("手动填写金额");
    expect(source).toContain("amount: useManualAmount");
  });
  it("默认无发票，选择有发票后提供相机、相册和电子 PDF 归档入口", () => {
    for (const copy of [
      "无发票（默认）",
      "有发票，需归档附件",
      "拍摄发票",
      "手机相册",
      "电子 PDF",
      'accept="application/pdf"',
      'capture="environment"',
      "最长边 1920px、JPEG 质量 0.82",
    ])
      expect(source).toContain(copy);
    expect(source).toMatch(
      /uploadPurchaseDocumentFile\(\s*event\.target\.files\?\.\[0\],\s*"invoice"\s*\)/
    );
  });
});

describe("移动采购库存凭证与权限反馈", () => {
  it("实际六栏目入口复用订单验收入库、领用、原领用退库和受控凭证UI", () => {
    expect(source).toContain("<PurchasingWorkspace");
    expect(workspace).toContain(
      "const canStock = capabilities.data?.canManageInventory === true"
    );
    expect(workspace).toContain("当前账号可查看库存，但未获“仓储收发”写入权限");
    expect(workspace).toContain("验收入库");
    expect(workspace).toContain("拍摄采购/入库凭证");
    expect(workspace).toContain('capture="environment"');
    expect(workspace).toContain("uploadPurchaseDocument.useMutation");
    expect(workspace).toContain(
      "evidenceId: draft.evidenceId ? Number(draft.evidenceId) : null"
    );
    expect(workspace).toContain("originalOutboundId:");
    expect(workspace).toContain("引用此领用退库");
    expect(workspace).toContain("PurchasingEvidencePreview");
    expect(workspace).toContain("当前项目授权的短时站内预览，不进入导出");
    expect(workspace).toContain("saveInventoryTransaction.useMutation");
  });
});

describe("移动采购订单详情", () => {
  it("真实工作区区分业务关闭、实物收货和实际付款并保留原站内详情", () => {
    expect(source).toContain("采购订单详情 · {selectedOrder?.orderNo}");
    expect(source).toContain(
      "查看采购单据：{selectedOrder.documentAttachment.fileName}"
    );
    expect(source).toContain('title="采购单据"');
    expect(source).toContain(
      "查看发票附件：{selectedOrder.invoiceAttachment.fileName}"
    );
    expect(source).toContain('pending_approval: "待审核"');
    expect(source).toContain('closed: "已关闭（非实付款状态）"');
    expect(source).not.toMatch(/closed:\s*"已(结算|付款)"/);
    expect(workspace).toContain("o.paidAmount");
    expect(workspace).toContain("o.remainingAmount");
    expect(workspace).toContain("o.receiptStatus");
    expect(workspace).toContain("recordSettlement.useMutation");
    expect(workspace).toContain("bindOrderEvidence.useMutation");
    expect(workspace).toContain("configureReceiptBasis.useMutation");
  });
});

describe("移动采购项目范围反馈", () => {
  it("区分授权失败与真实无授权项目，重试并阻断未保存工作区切项目", () => {
    for (const copy of [
      "retry: 2",
      'refetchOnMount: "always"',
      "项目授权加载失败",
      "这不等同于没有项目权限",
      "重新获取授权项目",
      "projects.refetch()",
    ])
      expect(source).toContain(copy);
    expect(source).toMatch(/workspaceDirty\s*\|\|\s*requestDirty/);
    expect(source).toContain("onDirtyChange={setWorkspaceDirty}");
    expect(source).toContain("key={workspaceRevision}");
    expect(workspace).toContain("draftProjectId !== projectId");
  });
});

describe("采购仓储当前筛选导出与打印", () => {
  it("现用工作区按项目、栏目、筛选打印和导出全部行而不是旧死代码", () => {
    expect(source).toContain("<PurchasingWorkspace");
    expect(workspace).toContain("downloadCurrentFilteredCsv");
    expect(workspace).toContain("filteredOrders.map");
    expect(workspace).toContain("filteredStock.map");
    expect(workspace).toContain("filteredSuppliers.map");
    expect(output).toContain("openA4LandscapePrintDocument");
    expect(output).toContain("全部筛选结果");
    expect(workspace).toContain("标准A4打印全部筛选");
    expect(workspace).toContain("库存余额为累计快照");
  });
  it("未知状态不回显内部英文，订单时间中国时区且录入默认设备时间", () => {
    expect(source).toContain('labels[status] ?? "待处理"');
    expect(workspace).toContain("formatChinaDateTime(o.orderedAt)");
    expect(source).toContain("formatChinaDateTime(selectedOrder.orderedAt)");
    expect(source).toContain("orderedAt: toDeviceDateTimeInput()");
    expect(source).toContain("settledAt: toDeviceDateTimeInput()");
  });
});

describe("采购订单上传人筛选与半A4票据打印", () => {
  it("现用工作区上传人筛选和原半A4保留姓名、备注、手贴区及四签字", () => {
    expect(workspace).toContain("上传管理员筛选");
    expect(workspace).toContain(
      "uploader: o.documentUploadedByName ?? o.createdByName"
    );
    expect(workspace).toContain("原半A4报销详单");
    expect(output).toContain("width:210mm;height:148.5mm");
    expect(output).toContain("height:62mm");
    expect(output).toContain("提交上传管理员");
    expect(output).toContain("现场管理员");
    expect(output).toContain("projectAdministratorName");
    expect(output).toContain("备注");
    expect(output).toContain("原始票据手贴空栏");
    for (const signature of ["报销人", "部门审批", "会计主管", "复核"])
      expect(output).toContain(signature);
    expect(output).toContain("amountToChineseUppercase(order.amount)");
    expect(output).not.toContain("合计金额：伍拾元整");
  });
});
