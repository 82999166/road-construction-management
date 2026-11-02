export type MonthlyCostFilter = {
  projectId?: number;
  period?: string;
};

export type MonthlyCostWindow = {
  start: Date;
  endExclusive: Date;
};

type MoneyValue = string | number | null | undefined;
type DateValue = Date | string | null | undefined;
type ProjectScopedRow = { projectId?: number | null };

type PayrollRow = ProjectScopedRow & { period: string; actualAmount: MoneyValue; status: string };
type DailyWageRow = ProjectScopedRow & { settlementDate: DateValue; actualAmount: MoneyValue; status: string };
type SettlementPaymentRow = ProjectScopedRow & {
  settlementType: string;
  direction: string;
  amount: MoneyValue;
  paymentDate: DateValue;
  status: string;
};
type MachineSettlementRow = ProjectScopedRow & {
  period: string;
  ownership: string | null | undefined;
  netPayableAmount: MoneyValue;
  status: string;
};
type TransportSettlementRow = ProjectScopedRow & {
  settlementKind: string;
  periodEnd: DateValue;
  netPayableAmount: MoneyValue;
  status: string;
};
type LivingFinancialRecord = ProjectScopedRow & {
  direction: string;
  category: string;
  amount: MoneyValue;
  occurredAt: DateValue;
  settlementStatus: string;
  sourceType: string | null | undefined;
};

export type MonthlyCostStatisticsSource = {
  payrolls: readonly PayrollRow[];
  dailyWages: readonly DailyWageRow[];
  settlementPayments: readonly SettlementPaymentRow[];
  machineSettlements: readonly MachineSettlementRow[];
  transportSettlements: readonly TransportSettlementRow[];
  livingFinancialRecords: readonly LivingFinancialRecord[];
};

export type MonthlyCostItem = {
  code: "TOTAL" | "PAYROLL" | "MACHINE_RENT" | "TRANSPORT_FREIGHT" | "LIVING_EXPENSE";
  name: string;
  accrualAmount: number;
  cashAmount: number;
  accrualCount: number;
  cashCount: number;
  sourceHint: string;
  emptyHint: string | null;
};

const APPROVED_PAYMENT_STATUSES = new Set(["approved", "partial", "paid"]);
const ACTIVE_EXPENSE_PAYMENT = (row: SettlementPaymentRow) => row.status === "active" && row.direction === "expense";

/**
 * 人工财务流水可归入生活开支的受控类别。这里只允许完整匹配，绝不从备注或任意文字猜测类别。
 */
export const LIVING_EXPENSE_CATEGORIES = new Set([
  "生活",
  "生活费",
  "生活用品",
  "餐费",
  "餐饮",
  "餐饮费",
  "伙食",
  "伙食费",
  "住宿",
  "住宿费",
  "后勤",
  "后勤费",
  "后勤保障",
  "后勤物资",
  "办公",
  "办公费",
  "办公用品",
  "办公物资",
  "水电",
  "水电费",
  "水费",
  "电费",
]);

/** 月份采用 UTC 左闭右开边界，避免月末 23:59:59 和下月 00:00:00 发生重叠。 */
export function getMonthlyCostWindow(period?: string): MonthlyCostWindow | null {
  if (!period) return null;
  const [year, month] = period.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("统计期间格式无效");
  }
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    endExclusive: new Date(Date.UTC(year, month, 1)),
  };
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** 缺失、空字符串或不可解析金额一律按 0 处理，统计不会输出 NaN。 */
function moneyOf(value: MoneyValue) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function matchesProject(row: ProjectScopedRow, projectId?: number) {
  return projectId === undefined || row.projectId === projectId;
}

function isInWindow(value: DateValue, window: MonthlyCostWindow | null) {
  if (!window) return true;
  if (!value) return false;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) && time >= window.start.getTime() && time < window.endExclusive.getTime();
}

/**
 * 业务自动流水均带来源；人工生活费用只接受空来源或显式 manual，借此排除 settlement_payment
 * 和 financial_reversal 等镜像/冲销来源，避免和 settlement_payment_records 双算。
 */
function isManualFinancialSource(sourceType: string | null | undefined) {
  const normalized = sourceType?.trim();
  return !normalized || normalized === "manual";
}

function createItem(
  code: MonthlyCostItem["code"],
  name: string,
  sourceHint: string,
  emptyHint: string,
  accrualRows: readonly MoneyValue[],
  cashRows: readonly MoneyValue[],
): MonthlyCostItem {
  const accrualAmount = roundMoney(accrualRows.reduce<number>((total, amount) => total + moneyOf(amount), 0));
  const cashAmount = roundMoney(cashRows.reduce<number>((total, amount) => total + moneyOf(amount), 0));
  return {
    code,
    name,
    accrualAmount,
    cashAmount,
    accrualCount: accrualRows.length,
    cashCount: cashRows.length,
    sourceHint,
    emptyHint: accrualRows.length || cashRows.length ? null : emptyHint,
  };
}

/**
 * 对已经在查询层按项目/期间收敛的真实台账再做一遍防御性口径过滤。
 * 该函数没有写库行为，也不会引入任何模拟数据。
 */
export function buildMonthlyCostStatistics(filter: MonthlyCostFilter, source: MonthlyCostStatisticsSource) {
  const window = getMonthlyCostWindow(filter.period);
  const payrollAccruals = source.payrolls
    .filter(row => matchesProject(row, filter.projectId) && (!filter.period || row.period === filter.period) && APPROVED_PAYMENT_STATUSES.has(row.status))
    .map(row => row.actualAmount);
  const dailyWageAccruals = source.dailyWages
    .filter(row => matchesProject(row, filter.projectId) && isInWindow(row.settlementDate, window) && APPROVED_PAYMENT_STATUSES.has(row.status))
    .map(row => row.actualAmount);
  const payrollCash = source.settlementPayments
    .filter(row => matchesProject(row, filter.projectId) && isInWindow(row.paymentDate, window) && ACTIVE_EXPENSE_PAYMENT(row) && ["payroll", "daily_wage"].includes(row.settlementType))
    .map(row => row.amount);

  const machineAccruals = source.machineSettlements
    .filter(row => matchesProject(row, filter.projectId) && (!filter.period || row.period === filter.period) && row.ownership === "leased" && APPROVED_PAYMENT_STATUSES.has(row.status))
    .map(row => row.netPayableAmount);
  const machineCash = source.settlementPayments
    .filter(row => matchesProject(row, filter.projectId) && isInWindow(row.paymentDate, window) && ACTIVE_EXPENSE_PAYMENT(row) && row.settlementType === "machine")
    .map(row => row.amount);

  const transportAccruals = source.transportSettlements
    .filter(row => matchesProject(row, filter.projectId) && isInWindow(row.periodEnd, window) && row.settlementKind === "trip" && APPROVED_PAYMENT_STATUSES.has(row.status) && moneyOf(row.netPayableAmount) > 0)
    .map(row => row.netPayableAmount);
  const transportCash = source.settlementPayments
    .filter(row => matchesProject(row, filter.projectId) && isInWindow(row.paymentDate, window) && ACTIVE_EXPENSE_PAYMENT(row) && row.settlementType === "transport_vehicle")
    .map(row => row.amount);

  const livingRows = source.livingFinancialRecords
    .filter(row => matchesProject(row, filter.projectId)
      && isInWindow(row.occurredAt, window)
      && row.direction === "expense"
      && row.settlementStatus !== "void"
      && isManualFinancialSource(row.sourceType)
      && LIVING_EXPENSE_CATEGORIES.has(row.category));
  const livingAccruals = livingRows.map(row => row.amount);
  /** 人工流水没有分笔结算明细，partial 不能视为实际付款。 */
  const livingCash = livingRows.filter(row => row.settlementStatus === "paid").map(row => row.amount);

  const payroll = createItem(
    "PAYROLL",
    "人员工资",
    "应付取已审核、部分付款或已付的工资条 actualAmount（按 period）及临时日结 actualAmount（按 settlementDate）；实付仅取 settlement_payment_records 中 payroll、daily_wage 的 active expense，并按 paymentDate 归属。",
    "本统计范围内没有符合状态的工资/日结业务或实际付款记录。",
    [...payrollAccruals, ...dailyWageAccruals],
    payrollCash,
  );
  const machineRent = createItem(
    "MACHINE_RENT",
    "机械租金",
    "应付仅取已审核、部分付款或已付的外租（machines.ownership=leased）机械付款结算净应付；实付仅取 settlement_payment_records 中 machine 的 active expense，按 paymentDate 归属。",
    "本统计范围内没有符合口径的外租机械结算或实际付款记录。",
    machineAccruals,
    machineCash,
  );
  const transportFreight = createItem(
    "TRANSPORT_FREIGHT",
    "车辆运费",
    "应付仅取按趟结算（settlementKind=trip）、净应付为正且已审核/部分付款/已付的车辆结算，按 periodEnd 归属；实付仅取 settlement_payment_records 中 transport_vehicle 的 active expense，按 paymentDate 归属。",
    "本统计范围内没有符合口径的车辆按趟结算或实际付款记录。",
    transportAccruals,
    transportCash,
  );
  const livingExpense = createItem(
    "LIVING_EXPENSE",
    "生活开支",
    "应付取人工 expense 财务流水（非 void、无业务镜像来源、类别严格限定为生活/餐费/住宿/后勤/办公/水电等受控集合），按 occurredAt 归属；实付仅取其中 settlementStatus=paid，partial 不计现金。",
    "本统计范围内没有符合受控生活类别的人工财务流水。",
    livingAccruals,
    livingCash,
  );
  const detailedItems = [payroll, machineRent, transportFreight, livingExpense];
  const total: MonthlyCostItem = {
    code: "TOTAL",
    name: "月度费用统计（五类合计）",
    accrualAmount: roundMoney(detailedItems.reduce((sum, item) => sum + item.accrualAmount, 0)),
    cashAmount: roundMoney(detailedItems.reduce((sum, item) => sum + item.cashAmount, 0)),
    accrualCount: detailedItems.reduce((sum, item) => sum + item.accrualCount, 0),
    cashCount: detailedItems.reduce((sum, item) => sum + item.cashCount, 0),
    sourceHint: "汇总人员工资、机械租金、车辆运费和生活开支四个明确类别；结算付款财务镜像不重复加入现金。",
    emptyHint: detailedItems.some(item => item.accrualCount || item.cashCount) ? null : "本统计范围内没有符合口径的月度费用数据。",
  };

  return {
    scope: {
      projectId: filter.projectId ?? null,
      period: filter.period ?? null,
      periodMode: filter.period ? "month" as const : "all_periods" as const,
      hint: filter.period
        ? "按所选自然月的 UTC 左闭右开边界统计；应付与实付分别按其权威业务日期归属。"
        : "未传 period，返回跨期累计而非单月数据；应付与实付仍分别按其权威业务日期归属。",
    },
    items: [total, ...detailedItems],
  };
}
