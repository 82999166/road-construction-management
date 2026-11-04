import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { financialRecords, purchaseOrders } from "../../drizzle/schema";
import { paymentSnapshot } from "../../shared/purchasingRules";
import { getDb } from "../db";

type Db = Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "select">;
/** Existing references are immutable; an unknown historical closed state is never payment evidence. */
export function isPurchaseDeductionEligible(
  order: {
    amount: string | number;
    status: string;
    assetDeductionReference?: string | null;
    actualPaidAmount?: number;
  },
  payments: Parameters<typeof paymentSnapshot>[1]
) {
  if (
    order.assetDeductionReference ||
    !["confirmed", "received", "closed"].includes(order.status)
  )
    return false;
  const amount = Number(order.amount);
  if (!Number.isFinite(amount) || amount <= 0) return false;
  return (
    paymentSnapshot(amount, payments).paymentStatus === "paid" ||
    (Number.isFinite(order.actualPaidAmount) &&
      Number(order.actualPaidAmount) >= amount)
  );
}
export async function getEligibleAssetPurchaseDeductions(
  db: Db,
  projectId: number,
  assetType: "machine" | "vehicle",
  assetId: number,
  start: Date,
  end: Date
) {
  const orders = await db
    .select()
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.projectId, projectId),
        eq(purchaseOrders.assetType, assetType),
        eq(purchaseOrders.assetId, assetId),
        isNull(purchaseOrders.assetDeductionReference),
        gte(purchaseOrders.orderedAt, start),
        lt(purchaseOrders.orderedAt, end)
      )
    );
  if (!orders.length) return [];
  const payments = await db
    .select()
    .from(financialRecords)
    .where(
      and(
        eq(financialRecords.projectId, projectId),
        eq(financialRecords.sourceType, "purchase_order_settlement"),
        inArray(
          financialRecords.sourceId,
          orders.map(order => String(order.id))
        )
      )
    );
  return orders.filter(order =>
    isPurchaseDeductionEligible(
      order,
      payments.filter(row => row.sourceId === String(order.id))
    )
  );
}
