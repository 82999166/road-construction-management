/** New writes only. Historical amounts are never repriced or rewritten. */
export const PURCHASING_COST_RULE = "moving_weighted_v2" as const;
export const moneyRound = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;
export const quantityRound = (n: number) => Math.round(n * 1000) / 1000;
export type StockRow = {
  id: number;
  transactionType: string;
  quantity: string | number;
  amount: string | number;
  unitCost: string | number;
  originalOutboundId?: number | null;
  costRuleVersion?: string | null;
};
export function stockSnapshot(rows: readonly StockRow[]) {
  return rows.reduce(
    (s, row) => {
      const sign = row.transactionType === "outbound" ? -1 : 1;
      return {
        quantity: quantityRound(s.quantity + sign * Number(row.quantity)),
        value: moneyRound(s.value + sign * Number(row.amount)),
        hasLegacy: s.hasLegacy || row.costRuleVersion !== PURCHASING_COST_RULE,
      };
    },
    { quantity: 0, value: 0, hasLegacy: false }
  );
}
export function calculateInventoryWrite(
  rows: readonly StockRow[],
  input: {
    type: "inbound" | "outbound" | "return";
    quantity: number;
    unitCost: number;
    originalOutboundId?: number | null;
    negativeRecoveryAuthorized?: boolean;
  }
) {
  const quantity = quantityRound(input.quantity);
  if (
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    Math.abs(quantity - input.quantity) > 0.0000001
  )
    throw new Error("数量须大于零，最多三位小数");
  if (!Number.isFinite(input.unitCost) || input.unitCost < 0)
    throw new Error("单价不合法");
  const snapshot = stockSnapshot(rows);
  if (
    (snapshot.quantity < 0 || snapshot.value < 0) &&
    !(input.type === "inbound" && input.negativeRecoveryAuthorized)
  )
    throw new Error(
      "存在历史负库存或负估值，须负责人授权、说明原因后入库纠正；禁止领用或退库"
    );
  let amount: number;
  if (input.type === "inbound")
    amount = moneyRound(quantity * moneyRound(input.unitCost));
  else if (input.type === "outbound") {
    if (quantity > snapshot.quantity) throw new Error("领用数量超过可用库存");
    amount =
      quantity === snapshot.quantity
        ? snapshot.value
        : moneyRound((snapshot.value * quantity) / snapshot.quantity);
  } else {
    const original = rows.find(
      row =>
        row.id === input.originalOutboundId &&
        row.transactionType === "outbound"
    );
    if (!original)
      throw new Error("退库必须引用当前项目、同物料同单位的原领用流水");
    const returns = rows.filter(
      row =>
        row.transactionType === "return" &&
        row.originalOutboundId === original.id
    );
    const returnedQuantity = quantityRound(
      returns.reduce((sum, row) => sum + Number(row.quantity), 0)
    );
    const remainingQuantity = quantityRound(
      Number(original.quantity) - returnedQuantity
    );
    if (quantity > remainingQuantity)
      throw new Error("退库数量超过原领用剩余可退数量，禁止重复退库");
    amount =
      quantity === remainingQuantity
        ? moneyRound(
            Number(original.amount) -
              returns.reduce((sum, row) => sum + Number(row.amount), 0)
          )
        : moneyRound(
            (Number(original.amount) * quantity) / Number(original.quantity)
          );
  }
  if (!Number.isFinite(amount) || Math.abs(amount) > 999999999999.99)
    throw new Error("库存金额超过允许范围");
  return {
    amount,
    unitCost: moneyRound(amount / quantity),
    costingUnitCost: Number((amount / quantity).toFixed(8)),
    ruleVersion: PURCHASING_COST_RULE,
    snapshot,
  };
}
export function assertReceiptCapacity(
  order: {
    status: string;
    quantity: string | number | null;
    inventoryItemName?: string | null;
    inventoryUnit?: string | null;
  },
  rows: readonly {
    transactionType: string;
    purchaseOrderId?: number | null;
    quantity: string | number;
  }[],
  input: { orderId: number; itemName: string; unit: string; quantity: number }
) {
  if (!["confirmed", "received"].includes(order.status))
    throw new Error("订单须已审核且未关闭或作废方可验收入库");
  if (!order.quantity || !order.inventoryItemName || !order.inventoryUnit)
    throw new Error(
      "订单尚未明确物料、单位和可收数量；请先登记验收依据，不猜测历史数量"
    );
  if (
    order.inventoryItemName !== input.itemName ||
    order.inventoryUnit !== input.unit
  )
    throw new Error("物料及单位须与订单验收依据一致");
  const received = quantityRound(
    rows
      .filter(
        row =>
          row.transactionType === "inbound" &&
          row.purchaseOrderId === input.orderId
      )
      .reduce((sum, row) => sum + Number(row.quantity), 0)
  );
  if (quantityRound(received + input.quantity) > Number(order.quantity))
    throw new Error("入库数量超过订单剩余可收数量");
  return {
    receivedQuantity: quantityRound(received + input.quantity),
    complete:
      quantityRound(received + input.quantity) === Number(order.quantity),
  };
}
export function paymentSnapshot(
  orderAmount: string | number,
  records: readonly {
    amount: string | number;
    settlementStatus: string;
    direction?: string;
  }[]
) {
  const settledAmount = moneyRound(
    records
      .filter(row => ["paid", "partial"].includes(row.settlementStatus))
      .reduce(
        (sum, row) =>
          sum + (row.direction === "income" ? -1 : 1) * Number(row.amount),
        0
      )
  );
  return {
    settledAmount,
    remainingAmount: moneyRound(
      Math.max(0, Number(orderAmount) - settledAmount)
    ),
    paymentStatus:
      settledAmount >= Number(orderAmount)
        ? "paid"
        : settledAmount > 0
          ? "partial"
          : "unpaid",
  };
}
export function assertOrderClosure(
  orderAmount: string | number,
  records: Parameters<typeof paymentSnapshot>[1]
) {
  const snapshot = paymentSnapshot(orderAmount, records);
  if (snapshot.remainingAmount > 0)
    throw new Error(
      "订单仍有未付余额，关闭不能代替实际付款；请先登记原采购结算"
    );
  return snapshot;
}
/** Reusable RMB uppercase formatter: uses integer cents and handles groups/zeroes. */
export function amountToChineseUppercase(value: string | number) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 999999999999.99) return "金额不合法";
  const cents = Math.round((n + Number.EPSILON) * 100);
  const digits = "零壹贰叁肆伍陆柒捌玖";
  const group = (v: number) => {
    let text = "",
      zero = false;
    ["仟", "佰", "拾", ""].forEach((unit, i) => {
      const d = Math.floor(v / 10 ** (3 - i)) % 10;
      if (d) {
        if (zero && text) text += "零";
        text += digits[d] + unit;
        zero = false;
      } else if (text) zero = true;
    });
    return text;
  };
  const yuan = Math.floor(cents / 100);
  const groups = [
    Math.floor(yuan / 100000000),
    Math.floor(yuan / 10000) % 10000,
    yuan % 10000,
  ];
  let text = "",
    gap = false;
  groups.forEach((part, i) => {
    if (!part) {
      if (text) gap = true;
      return;
    }
    if (text && (gap || part < 1000)) text += "零";
    text += group(part) + ["亿", "万", ""][i];
    gap = false;
  });
  text = (text || "零") + "元";
  const jiao = Math.floor(cents / 10) % 10,
    fen = cents % 10;
  if (!jiao && !fen) return text + "整";
  if (jiao) text += digits[jiao] + "角";
  if (fen) text += (jiao ? "" : "零") + digits[fen] + "分";
  return text;
}

/** Historic purchase documents predate attachmentKind; explicit invoice source remains compatible. */
export function purchasingEvidenceKind(evidence: {
  watermarkJson?: string | null;
  sourceId?: string | null;
}) {
  let metadata: { attachmentKind?: unknown } = {};
  try {
    metadata = JSON.parse(evidence.watermarkJson ?? "{}") ?? {};
  } catch {
    /* legacy */
  }
  return (
    metadata.attachmentKind ??
    (evidence.sourceId === "small_direct_invoice" ? "invoice" : "document")
  );
}
