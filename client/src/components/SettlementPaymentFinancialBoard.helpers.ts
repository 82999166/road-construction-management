import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { formatChinaDateTime } from "@/lib/businessTime";
import { formatAmount } from "@shared/numberFormat";

export type SettlementPaymentView =
  | "all"
  | "board"
  | "payable"
  | "receivable"
  | "records"
  | "reconciliation";
export type SettlementPaymentSourceType =
  | "transport_vehicle"
  | "machine"
  | "payroll"
  | "daily_wage"
  | "subcontract";
type Outputs = inferRouterOutputs<AppRouter>["settlementPayment"];
export type SettlementPaymentMonthlyData = Outputs["monthlyReconciliation"];
export type SettlementPaymentRecord =
  SettlementPaymentMonthlyData["records"][number];

/** 只定位原结算入口；不代表付款授权，不触发付款或凭证写入。 */
export interface SettlementPaymentNavigationRow {
  projectId: number;
  sourceType: SettlementPaymentSourceType;
  settlementId: number;
  settlementNo: string;
  periodLabel: string;
  direction: "expense" | "income";
  /** 仅 board DTO 提供，records DTO 无此字段；不能从付款记录推断新付款权限。 */
  canRegisterSettlementPayment?: boolean;
}

export interface SettlementPaymentBoardRow
  extends Omit<SettlementPaymentNavigationRow, "projectId"> {
  sourceLabel: string;
  lifecycle: string;
  businessStatus: string;
  originalAmount: number;
  paidOrRecoveredAmount: number;
  offsetAmount: number;
  remainingAmount: number;
  counterpartyDisplay: string;
  canRegisterSettlementPayment: boolean;
  legacyFinalized: boolean;
}

export const sourceTypeLabel: Record<
  "all" | SettlementPaymentSourceType,
  string
> = {
  all: "全部结算",
  transport_vehicle: "车辆结算",
  machine: "机械结算",
  payroll: "工资发放",
  daily_wage: "临时日结",
  subcontract: "分包结算",
};
export const lifecycleLabel: Record<string, string> = {
  all: "全部状态",
  approval_pending: "待审核",
  ready: "待收付",
  partial: "部分结清",
  completed: "已结清",
  void: "已作废",
};
export const reconciliationLabel = {
  matched: "已匹配",
  missing: "待核对（缺资金流水）",
  inconsistent: "待核对（金额/方向差异）",
};
export const paymentMethodLabel = {
  all: "全部方式",
  bank_transfer: "银行卡转账",
  corporate_account: "对公账户",
  cash: "现金",
  wechat: "微信收款",
  alipay: "支付宝收款",
  other: "其他方式",
};
export const directionLabel = (direction: "all" | "expense" | "income") =>
  direction === "all"
    ? "全部收付"
    : direction === "expense"
      ? "支出付款"
      : "收入补款";
export const money = (value: unknown) => `¥${formatAmount(value as number | string | null | undefined)}`;
export const validPeriod = (period: string) =>
  /^\d{4}-(0[1-9]|1[0-2])$/.test(period);

export function settlementPaymentQueryPlan(
  view: SettlementPaymentView,
  enabled: boolean,
  projectId: number,
  period: string,
  asOfDate: string
) {
  const active = enabled && projectId > 0;
  const boardView = ["all", "board", "payable", "receivable"].includes(view);
  return {
    board: active && boardView && /^\d{4}-\d{2}-\d{2}$/.test(asOfDate),
    monthly:
      active &&
      ["all", "records", "reconciliation"].includes(view) &&
      validPeriod(period),
  };
}

/** 待收付只显示已审核且尚有余额的真实单据，草稿/待审/作废/已结清不得混入。 */
export function outstandingSettlementRows(
  rows: SettlementPaymentBoardRow[],
  view: SettlementPaymentView
) {
  if (view !== "payable" && view !== "receivable") return rows;
  const direction = view === "payable" ? "expense" : "income";
  return rows.filter(
    row =>
      row.direction === direction &&
      ["ready", "partial"].includes(row.lifecycle) &&
      row.remainingAmount > 0 &&
      !row.legacyFinalized
  );
}

/** safeBoardRow 的后端类型为 Record<string, unknown>；验证已核实的 DTO，绝不重新计算余额或授权。 */
export function settlementPaymentBoardRows(
  rows: Outputs["board"]["rows"]
): SettlementPaymentBoardRow[] {
  const candidates: Record<string, unknown>[] = rows;
  return candidates.filter(
    (row): row is SettlementPaymentBoardRow & Record<string, unknown> =>
      typeof row.sourceType === "string" &&
      row.sourceType !== "all" &&
      Object.hasOwn(sourceTypeLabel, row.sourceType) &&
      typeof row.settlementId === "number" &&
      typeof row.settlementNo === "string" &&
      typeof row.sourceLabel === "string" &&
      typeof row.periodLabel === "string" &&
      (row.direction === "expense" || row.direction === "income") &&
      typeof row.lifecycle === "string" &&
      typeof row.businessStatus === "string" &&
      typeof row.counterpartyDisplay === "string" &&
      typeof row.originalAmount === "number" &&
      typeof row.paidOrRecoveredAmount === "number" &&
      typeof row.offsetAmount === "number" &&
      typeof row.remainingAmount === "number" &&
      typeof row.canRegisterSettlementPayment === "boolean" &&
      typeof row.legacyFinalized === "boolean"
  );
}

export function paymentRecordNavigationRow(
  projectId: number,
  row: SettlementPaymentRecord
): SettlementPaymentNavigationRow {
  return {
    projectId,
    sourceType: row.settlementType,
    settlementId: row.settlementId,
    settlementNo: row.settlementNo,
    periodLabel: row.periodLabel,
    direction: row.direction,
  };
}

/** Excel 只使用完整服务端 records 和 summary；分页绝不进入此接口。 */
export function buildSettlementPaymentWorkbook(
  data: SettlementPaymentMonthlyData,
  projectText: string
) {
  const { records, summary, meta } = data;
  const typeText = meta.sourceTypes
    .map(type => sourceTypeLabel[type])
    .join("、");
  return {
    filename: `${meta.period}-付款台账月度内部对账单.xlsx`,
    overview: [
      ["报表名称", "付款台账月度内部对账单（非银行账单自动对账）"],
      ["项目", projectText],
      ["会计月份（实际付款日期）", meta.period],
      ["结算类型", typeText],
      ["收付方向", directionLabel(meta.direction)],
      [
        "付款状态",
        meta.status === "active"
          ? "有效"
          : meta.status === "reversed"
            ? "已冲正"
            : "全部",
      ],
      ["付款方式", paymentMethodLabel[meta.paymentMethod]],
      ["关键词", meta.keyword || "全部"],
      ["生成时间", formatChinaDateTime(new Date())],
      ["付款记录数", records.length],
      ["有效支出", money(summary.activeExpenseAmount)],
      ["有效补款收入", money(summary.activeIncomeAmount)],
      ["冲正金额（不计入有效实收付）", money(summary.reversedAmount)],
      [
        "资金流水匹配",
        `已匹配 ${summary.matching.matched} 笔；待核对 ${summary.matching.missing + summary.matching.inconsistent} 笔`,
      ],
      ["数据保护", "默认不含完整收款账户、支付参考号、签名链接或存储路径"],
    ] as Array<[string, string | number]>,
    sheets: [
      {
        name: "月度汇总",
        twoDecimalColumns: [2, 3, 4],
        headers: [
          "结算类型",
          "记录数",
          "有效支出",
          "有效补款收入",
          "冲正金额",
          "已匹配",
          "缺资金流水",
          "金额/方向差异",
        ],
        rows: summary.byType.map(item => [
          item.label,
          item.count,
          item.activeExpenseAmount,
          item.activeIncomeAmount,
          item.reversedAmount,
          item.matched,
          item.missing,
          item.inconsistent,
        ]),
        widths: [16, 12, 16, 16, 14, 12, 14, 16],
      },
      {
        name: "付款明细",
        twoDecimalColumns: [6],
        headers: [
          "凭证编号",
          "结算类型",
          "结算单号",
          "业务归属",
          "收付方向",
          "付款状态",
          "本次金额",
          "付款日期",
          "付款方式",
          "收款人/补款人",
          "经办人",
          "原始凭证文件",
          "凭证摘要",
          "资金流水核对",
        ],
        rows: records.map(item => [
          item.voucherNo,
          item.settlementTypeLabel,
          item.settlementNo,
          item.periodLabel,
          directionLabel(item.direction),
          item.status === "active" ? "有效" : "已冲正",
          item.amount,
          item.paymentDate,
          item.paymentMethodLabel,
          item.payeeName,
          item.operatorName,
          item.proof?.fileName ?? "未关联",
          item.proof?.sha256Prefix ?? "—",
          reconciliationLabel[item.reconciliationStatus],
        ]),
        widths: [23, 14, 22, 18, 12, 12, 14, 14, 16, 18, 14, 24, 16, 22],
      },
    ],
  };
}
