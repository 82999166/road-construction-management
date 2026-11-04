import { describe, expect, it } from "vitest";
import {
  amountToChineseUppercase,
  assertOrderClosure,
  assertReceiptCapacity,
  calculateInventoryWrite,
  paymentSnapshot,
  stockSnapshot,
} from "@shared/purchasingRules";
import {
  createPurchasingFilter,
  matchesPurchasingFilter,
  purchasingStatusLabel,
  PURCHASING_TABS,
} from "./purchasingWorkspace";
import { paginateFinanceRows } from "./financePagination";
const inbound = {
  id: 1,
  transactionType: "inbound",
  quantity: "10",
  amount: "100",
  unitCost: "10",
  costRuleVersion: "legacy_v1",
};
describe("采购金额与历史状态", () => {
  it.each([
    [0, "零元整"],
    [50, "伍拾元整"],
    [123.45, "壹佰贰拾叁元肆角伍分"],
    [10001.01, "壹万零壹元零壹分"],
    [100000001, "壹亿零壹元整"],
    [100010001, "壹亿零壹万零壹元整"],
    [0.09, "零元零玖分"],
    [-1, "金额不合法"],
    [NaN, "金额不合法"],
  ])("金额%j自动转为%j", (n, expected) => {
    expect(amountToChineseUppercase(n)).toBe(expected);
  });
  it("订单关闭不等于实付款，未支付流水不抵余额", () => {
    expect(purchasingStatusLabel("closed")).toContain("不代表历史付清");
    expect(
      paymentSnapshot(100, [{ amount: 100, settlementStatus: "unpaid" }])
        .remainingAmount
    ).toBe(100);
    expect(() =>
      assertOrderClosure(100, [{ amount: 90, settlementStatus: "paid" }])
    ).toThrow("未付余额");
    expect(
      assertOrderClosure(100, [
        { amount: 40, settlementStatus: "partial" },
        { amount: 60, settlementStatus: "paid" },
      ]).paymentStatus
    ).toBe("paid");
  });
});
describe("版本化库存计价", () => {
  it("同物料单位移动加权，新领用不使用客户端成本，历史不变", () => {
    const rows = [
      inbound,
      {
        ...inbound,
        id: 2,
        quantity: "10",
        amount: "300",
        costRuleVersion: "moving_weighted_v2",
      },
    ];
    const copy = JSON.stringify(rows);
    const out = calculateInventoryWrite(rows, {
      type: "outbound",
      quantity: 5,
      unitCost: 999,
    });
    expect(out.amount).toBe(100);
    expect(out.ruleVersion).toBe("moving_weighted_v2");
    expect(JSON.stringify(rows)).toBe(copy);
    expect(stockSnapshot(rows).hasLegacy).toBe(true);
  });
  it("清空数量时结清金额尾差，精确成本和显示单价分离", () => {
    const rows = [{ ...inbound, quantity: "3", amount: "10" }];
    const first = calculateInventoryWrite(rows, {
      type: "outbound",
      quantity: 1,
      unitCost: 0,
    });
    expect(first.amount).toBe(3.33);
    const last = calculateInventoryWrite(
      [
        ...rows,
        {
          ...inbound,
          id: 2,
          transactionType: "outbound",
          quantity: "1",
          amount: String(first.amount),
        },
      ],
      { type: "outbound", quantity: 2, unitCost: 0 }
    );
    expect(last.amount).toBe(6.67);
    expect(last.costingUnitCost).toBe(3.335);
  });
  it("不足库存、空库存、超精度数量和负历史禁止无授权消化", () => {
    expect(() =>
      calculateInventoryWrite([inbound], {
        type: "outbound",
        quantity: 11,
        unitCost: 0,
      })
    ).toThrow("超过可用");
    expect(() =>
      calculateInventoryWrite([], {
        type: "outbound",
        quantity: 1,
        unitCost: 0,
      })
    ).toThrow("超过可用");
    expect(() =>
      calculateInventoryWrite([], {
        type: "inbound",
        quantity: 0.0001,
        unitCost: 1,
      })
    ).toThrow("最多三位");
    const negative = [{ ...inbound, transactionType: "outbound" }];
    expect(() =>
      calculateInventoryWrite(negative, {
        type: "inbound",
        quantity: 10,
        unitCost: 10,
      })
    ).toThrow("历史负库存");
    expect(
      calculateInventoryWrite(negative, {
        type: "inbound",
        quantity: 10,
        unitCost: 10,
        negativeRecoveryAuthorized: true,
      }).amount
    ).toBe(100);
  });
  it("原领用退库保留比例成本与末次尾差，并限制已退数量", () => {
    const original = {
      ...inbound,
      id: 2,
      transactionType: "outbound",
      quantity: "3",
      amount: "10",
    };
    const first = calculateInventoryWrite([inbound, original], {
      type: "return",
      quantity: 1,
      unitCost: 999,
      originalOutboundId: 2,
    });
    expect(first.amount).toBe(3.33);
    const returns = {
      ...inbound,
      id: 3,
      transactionType: "return",
      quantity: "1",
      amount: "3.33",
      originalOutboundId: 2,
    };
    expect(
      calculateInventoryWrite([inbound, original, returns], {
        type: "return",
        quantity: 2,
        unitCost: 0,
        originalOutboundId: 2,
      }).amount
    ).toBe(6.67);
    expect(() =>
      calculateInventoryWrite([inbound, original, returns], {
        type: "return",
        quantity: 3,
        unitCost: 0,
        originalOutboundId: 2,
      })
    ).toThrow("重复退库");
  });
  it("订单收货数量只计入关联入库，退库不恢复可收数量", () => {
    const order = {
      status: "confirmed",
      quantity: "10",
      inventoryItemName: "水泥",
      inventoryUnit: "袋",
    };
    const rows = [
      { transactionType: "inbound", quantity: "8", purchaseOrderId: 1 },
      { transactionType: "return", quantity: "3", purchaseOrderId: 1 },
    ];
    expect(
      assertReceiptCapacity(order, rows, {
        orderId: 1,
        itemName: "水泥",
        unit: "袋",
        quantity: 2,
      }).complete
    ).toBe(true);
    expect(() =>
      assertReceiptCapacity(order, rows, {
        orderId: 1,
        itemName: "水泥",
        unit: "袋",
        quantity: 3,
      })
    ).toThrow("超过订单剩余");
    expect(() =>
      assertReceiptCapacity({ ...order, quantity: null }, [], {
        orderId: 1,
        itemName: "水泥",
        unit: "袋",
        quantity: 1,
      })
    ).toThrow("不猜测历史数量");
    expect(() =>
      assertReceiptCapacity(order, [], {
        orderId: 1,
        itemName: "水泥",
        unit: "吨",
        quantity: 1,
      })
    ).toThrow("单位");
  });
});
describe("采购全部筛选与分页同口径", () => {
  it("六栏目不是订单状态Tab，默认日/月/档案范围独立", () => {
    expect(PURCHASING_TABS).toHaveLength(6);
    expect(createPurchasingFilter("orders").dateFrom).toBe(
      createPurchasingFilter("orders").dateTo
    );
    expect(createPurchasingFilter("settlements").dateFrom).toMatch(/-01$/);
    expect(createPurchasingFilter("suppliers").dateFrom).toBe("");
  });
  it("中国日期边界、类别采购者上传人发票筛选共同生效", () => {
    const f = {
      ...createPurchasingFilter("orders"),
      search: "水泥",
      dateFrom: "2026-11-04",
      dateTo: "2026-11-04",
      categoryId: "2",
      purchaser: "张",
      uploader: "李",
      invoice: "yes",
      status: "confirmed",
    };
    const row = {
      text: "PO 水泥",
      status: "confirmed",
      date: "2026-11-03T16:00:00Z",
      categoryId: 2,
      purchaser: "张三",
      uploader: "李四",
      hasInvoice: true,
    };
    expect(matchesPurchasingFilter(row, f)).toBe(true);
    expect(
      matchesPurchasingFilter({ ...row, date: "2026-11-03T15:59:59Z" }, f)
    ).toBe(false);
    expect(matchesPurchasingFilter({ ...row, uploader: "王" }, f)).toBe(false);
    expect(matchesPurchasingFilter({ ...row, hasInvoice: false }, f)).toBe(
      false
    );
  });
  it("分页20/50/100只改变屏幕，全部151条仍用于输出和合计", () => {
    const rows = Array.from({ length: 151 }, (_, i) => i + 1);
    for (const pageSize of [20, 50, 100]) {
      const page = paginateFinanceRows(rows, 1, pageSize);
      expect(page.pageRows).toHaveLength(pageSize);
      expect(page.total).toBe(151);
      expect(rows.reduce((a, b) => a + b, 0)).toBe(11476);
    }
  });
});
