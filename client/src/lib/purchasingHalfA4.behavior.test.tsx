import { afterEach, describe, expect, it, vi } from "vitest";
import { printPurchasingHalfA4 } from "./purchasingWorkspace";
afterEach(() => vi.unstubAllGlobals());
function print(order: Parameters<typeof printPurchasingHalfA4>[0]) {
  const write = vi.fn();
  vi.stubGlobal("window", {
    open: () => ({ document: { write, close: vi.fn() } }),
  });
  printPurchasingHalfA4(order);
  return write.mock.calls[0][0] as string;
}
const order = {
  orderNo: "PO-1",
  amount: "123.45",
  status: "closed",
  orderedAt: "2026-11-04T01:00:00Z",
};
describe("采购原半A4真实打印数据契约", () => {
  it("保留原尺寸、票据高度、四签字和手贴区，自动大写与真实姓名备注", () => {
    const html = print({
      ...order,
      purchaserName: "采购甲",
      createdByName: "录入乙",
      documentUploadedByName: "上传丙",
      projectAdministratorName: "现场丁",
      remarks: "原订单备注",
      paidAmount: 30,
      remainingAmount: 93.45,
    });
    for (const value of [
      "width:210mm;height:148.5mm",
      "height:62mm",
      "采购甲",
      "上传丙",
      "现场丁",
      "原订单备注",
      "原始票据手贴空栏",
      "壹佰贰拾叁元肆角伍分",
      "报销人",
      "部门审批",
      "会计主管",
      "复核",
      "实际付款：¥30",
      "未付余额：¥93.45",
      "不代表历史付清",
    ])
      expect(html).toContain(value);
    expect(html).not.toContain("订单金额：伍拾元整");
  });
  it("历史缺失现场管理员不推断为创建人，发票原件与采购单据标签不当付款凭证", () => {
    const html = print({
      ...order,
      createdByName: "真实创建人",
      documentAttachment: {
        url: "/controlled/document",
        mimeType: "image/jpeg",
        fileName: "采购单据.jpg",
      },
      invoiceAttachment: {
        url: "/controlled/invoice",
        mimeType: "application/pdf",
        fileName: "发票.pdf",
      },
    });
    expect(html).toContain("提交上传管理员：真实创建人");
    expect(html).toContain("现场管理员：未登记");
    expect(html).toContain("备注：未填写");
    expect(html).toContain('alt="原采购单据"');
    expect(html).toContain("发票原件");
    expect(html).toContain("PDF请站内预览后单独打印");
    expect(html).toContain("不是付款凭证");
    expect(html).not.toContain("现场管理员：真实创建人");
  });
  it("姓名、说明与备注均转义，不能通过打印单据注入HTML", () => {
    const html = print({
      ...order,
      purchaserName: "<script>alert(1)</script>",
      remarks: '<img src=x onerror="evil()">',
    });
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("<img src=x");
  });
});
