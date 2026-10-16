/**
 * 施工承包业务的共享领域常量与纯计算函数。
 * 本文件不得依赖数据库、HTTP 或前端运行环境，便于在服务端、前端和测试中复用。
 */

/** 日常采购必须保持的 12 类固定分类。 */
export const PURCHASE_CATEGORY_CATALOG = [
  { code: "OFFICE", name: "办公用品", sortOrder: 10 },
  { code: "CANTEEN", name: "食堂食材与用品", sortOrder: 20 },
  { code: "LABOR_PROTECTION", name: "劳保与防暑物资", sortOrder: 30 },
  { code: "FUEL", name: "油料与润滑油", sortOrder: 40 },
  { code: "SPARE_PARTS", name: "机械零配件", sortOrder: 50 },
  { code: "TOOLS", name: "工器具与低值易耗品", sortOrder: 60 },
  { code: "WATER_ELECTRICITY", name: "水电气与网络", sortOrder: 70 },
  { code: "DORMITORY", name: "宿舍与营地用品", sortOrder: 80 },
  { code: "VEHICLE", name: "车辆零配件、保养与通勤费用", sortOrder: 90 },
  { code: "MAINTENANCE", name: "维修与临建维护", sortOrder: 100 },
  { code: "SAFETY", name: "安全文明施工物资", sortOrder: 110 },
  { code: "OTHER", name: "其他经审批零星采购", sortOrder: 120 },
] as const;

/**
 * 领域异常编码用于让接口层稳定识别业务失败原因，避免以英文运行时错误直接暴露给移动端。
 * 所有资金、审批、业务单据计算的校验失败均应优先使用该异常类型。
 */
export type DomainErrorCode = "INVALID_PARAMETER" | "INVALID_STATUS_TRANSITION" | "INSUFFICIENT_PERMISSION" | "CONFIGURATION_MISSING";

export class ConstructionDomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConstructionDomainError";
  }
}

/**
 * 所有可审批业务单据复用的基础状态机。
 * 采购、计量、工资、机械结算、运输趟次可在此基础上增加专业状态，禁止绕过审核直接结算。
 */
export const APPROVAL_STATUS_TRANSITIONS = {
  draft: ["submitted", "void"],
  submitted: ["reviewing", "rejected", "void"],
  reviewing: ["approved", "rejected", "void"],
  approved: ["settled", "void"],
  rejected: ["draft", "void"],
  settled: [],
  void: [],
} as const;

/** 施工日报从现场草稿到归档的受控状态机；已锁定日报不得回退或修改。 */
export const CONSTRUCTION_DAILY_REPORT_STATUS_TRANSITIONS = {
  draft: ["submitted"],
  submitted: ["approved", "rejected"],
  approved: ["locked"],
  rejected: ["draft"],
  locked: [],
} as const;

/** 校验施工日报的提交、审核、退回及锁定状态，避免绕过现场记录的追溯边界。 */
export function assertConstructionDailyReportStatusTransition(from: keyof typeof CONSTRUCTION_DAILY_REPORT_STATUS_TRANSITIONS, to: string): void {
  if (!CONSTRUCTION_DAILY_REPORT_STATUS_TRANSITIONS[from].includes(to as never)) {
    throw new ConstructionDomainError("INVALID_STATUS_TRANSITION", `施工日报不允许从“${from}”流转至“${to}”`);
  }
}

/** 校验单据状态是否允许流转，供审批、资金和业务单据计算的校验失败均应优先使用该异常类型。 */
export function assertApprovalTransition(from: keyof typeof APPROVAL_STATUS_TRANSITIONS, to: string): void {
  if (!APPROVAL_STATUS_TRANSITIONS[from].includes(to as never)) {
    throw new ConstructionDomainError("INVALID_STATUS_TRANSITION", `单据状态不允许从“${from}”流转至“${to}”`);
  }
}

/** 采购申请从申请到库存归集的专用状态机，关闭后的单据只读，禁止回退重算。 */
export const PURCHASE_REQUEST_STATUS_TRANSITIONS = {
  draft: ["submitted"],
  submitted: ["approved", "rejected"],
  approved: ["ordered"],
  ordered: ["received"],
  received: ["stocked"],
  stocked: ["closed"],
  closed: [],
  rejected: ["draft"],
} as const;

/** 校验采购申请的状态变更，确保采购、收货、入库和关闭顺序可追溯。 */
export function assertPurchaseRequestStatusTransition(from: keyof typeof PURCHASE_REQUEST_STATUS_TRANSITIONS, to: string): void {
  if (!PURCHASE_REQUEST_STATUS_TRANSITIONS[from].includes(to as never)) {
    throw new ConstructionDomainError("INVALID_STATUS_TRANSITION", `采购申请状态不允许从“${from}”流转至“${to}”`);
  }
}

/** 采购订单独立于申请流转，收货和关闭均不能由已关闭订单回退。 */
export const PURCHASE_ORDER_STATUS_TRANSITIONS = {
  draft: ["confirmed", "void"],
  confirmed: ["received", "void"],
  received: ["closed"],
  closed: [],
  void: [],
} as const;

/** 校验采购订单的确认、收货和关闭状态，避免修改已归档订单。 */
export function assertPurchaseOrderStatusTransition(from: keyof typeof PURCHASE_ORDER_STATUS_TRANSITIONS, to: string): void {
  if (!PURCHASE_ORDER_STATUS_TRANSITIONS[from].includes(to as never)) {
    throw new ConstructionDomainError("INVALID_STATUS_TRANSITION", `采购订单状态不允许从“${from}”流转至“${to}”`);
  }
}

/** 工资条状态机与通用单据不同：会计退回后回到草稿，支付和作废后不可再次编辑。 */
export const PAYROLL_STATUS_TRANSITIONS = {
  draft: ["reviewing", "void"],
  reviewing: ["approved", "draft", "void"],
  approved: ["paid", "void"],
  paid: [],
  void: [],
} as const;

/** 校验工资条提交、会计审核、支付和作废是否属于允许的业务状态流转。 */
export function assertPayrollStatusTransition(from: keyof typeof PAYROLL_STATUS_TRANSITIONS, to: string): void {
  if (!PAYROLL_STATUS_TRANSITIONS[from].includes(to as never)) {
    throw new ConstructionDomainError("INVALID_STATUS_TRANSITION", `工资条状态不允许从“${from}”流转至“${to}”`);
  }
}

/** 机械成本从录入、审核到结算的专用状态机，结算完成后只读以确保成本可追溯。 */
export const MACHINE_COST_STATUS_TRANSITIONS = {
  draft: ["approved", "void"],
  approved: ["settled", "void"],
  settled: [],
  void: [],
} as const;

/** 校验机械成本记录的审核与结算状态流转。 */
export function assertMachineCostStatusTransition(from: keyof typeof MACHINE_COST_STATUS_TRANSITIONS, to: string): void {
  if (!MACHINE_COST_STATUS_TRANSITIONS[from].includes(to as never)) {
    throw new ConstructionDomainError("INVALID_STATUS_TRANSITION", `机械成本状态不允许从“${from}”流转至“${to}”`);
  }
}

/** 运输趟次从草稿、提交、核验到结算的专用状态机，禁止已结算趟次重算或回退。 */
export const TRANSPORT_TRIP_STATUS_TRANSITIONS = {
  draft: ["submitted", "void"],
  submitted: ["verified", "void"],
  verified: ["settled", "void"],
  settled: [],
  void: [],
} as const;

/** 校验运输趟次的提交、核验、结算或作废状态流转。 */
export function assertTransportTripStatusTransition(from: keyof typeof TRANSPORT_TRIP_STATUS_TRANSITIONS, to: string): void {
  if (!TRANSPORT_TRIP_STATUS_TRANSITIONS[from].includes(to as never)) {
    throw new ConstructionDomainError("INVALID_STATUS_TRANSITION", `运输趟次状态不允许从“${from}”流转至“${to}”`);
  }
}

/** 校验现场影像的二进制文件头，阻止只伪造 MIME 类型的非图片文件进入对象存储。 */
export function assertEvidenceImageSignature(bytes: Uint8Array, mimeType: "image/jpeg" | "image/png"): void {
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  if ((mimeType === "image/jpeg" && !isJpeg) || (mimeType === "image/png" && !isPng)) {
    throw new ConstructionDomainError("INVALID_PARAMETER", "影像内容与声明格式不一致");
  }
}

/** 业务移动端菜单目录，由服务端根据岗位/角色进行动态过滤。 */
export const MOBILE_MENU_CATALOG = [
  { code: "WORKBENCH", title: "工作台", icon: "LayoutDashboard", roles: ["ALL"] },
  { code: "TOOL_KNOWLEDGE", title: "工具知识", icon: "Calculator", roles: ["ALL"] },
  { code: "CONSTRUCTION", title: "施工现场", icon: "HardHat", roles: ["PROJECT_MANAGER", "CONSTRUCTION_MANAGER", "SAFETY_MANAGER"] },
  { code: "LABOR", title: "劳务工资", icon: "ContactRound", roles: ["LABOR_MANAGER", "ACCOUNTANT", "FINANCE_MANAGER", "PROJECT_MANAGER"] },
  { code: "MACHINERY", title: "机械管理", icon: "Tractor", roles: ["MACHINERY_MANAGER", "PROJECT_MANAGER", "FINANCE_MANAGER"] },
  { code: "TRANSPORT", title: "运输管理", icon: "Truck", roles: ["TRANSPORT_MANAGER", "DRIVER", "PROJECT_MANAGER", "FINANCE_MANAGER"] },
  { code: "PURCHASING", title: "采购仓储", icon: "PackageSearch", roles: ["PURCHASER", "WAREHOUSE_MANAGER", "LOGISTICS_MANAGER", "FINANCE_MANAGER"] },
  { code: "MEASUREMENT", title: "计量结算", icon: "Ruler", roles: ["MEASUREMENT_MANAGER", "FINANCE_MANAGER", "PROJECT_MANAGER"] },
  { code: "CONTRACT", title: "外包合同", icon: "FileText", roles: ["PROJECT_MANAGER", "CONSTRUCTION_MANAGER", "TRANSPORT_MANAGER", "FINANCE_MANAGER", "ACCOUNTANT"] },
  { code: "FINANCE", title: "财务成本", icon: "WalletCards", roles: ["FINANCE_MANAGER", "ACCOUNTANT", "CASHIER", "PROJECT_MANAGER", "AUDIT_VIEWER"] },
  { code: "DIESEL", title: "柴油管理", icon: "Fuel", roles: ["FINANCE_MANAGER", "ACCOUNTANT", "MACHINERY_MANAGER", "TRANSPORT_MANAGER", "PROJECT_MANAGER"] },
  { code: "EVIDENCE", title: "水印取证", icon: "Camera", roles: ["ALL"] },
  { code: "MESSAGES", title: "消息中心", icon: "Bell", roles: ["ALL"] },
] as const;

/** 将金额统一保留至两位小数，避免浮点展示误差。 */
function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * 计算渣土车货厢理论方量。
 * @param lengthMeters 货厢内部长度（米）
 * @param widthMeters 货厢内部宽度（米）
 * @param heightMeters 货厢内部高度（米）
 * @param loadFactor 装载系数，范围为 0~1，用于扣除不能满载或堆尖等实际因素
 */
export function calculateTheoreticalVolume(
  lengthMeters: number,
  widthMeters: number,
  heightMeters: number,
  loadFactor = 1,
): number {
  if (lengthMeters <= 0 || widthMeters <= 0 || heightMeters <= 0) {
    throw new ConstructionDomainError("INVALID_PARAMETER", "货厢长、宽、高必须大于 0");
  }
  if (loadFactor <= 0 || loadFactor > 1.5) {
    throw new ConstructionDomainError("INVALID_PARAMETER", "装载系数必须大于 0 且不超过 1.5");
  }
  return Math.round(lengthMeters * widthMeters * heightMeters * loadFactor * 1000) / 1000;
}

/**
 * 按“起步里程 + 每增加 500 米递增”规则计算单趟运费。
 * 增距档次按向上取整处理，例如超出起步里程 1 米即进入第一档，避免出现未计价区间。
 */
export function calculateTieredFreightAmount(params: {
  actualDistanceKm: number;
  startDistanceKm: number;
  basePricePerUnit: number;
  stepMeters: number;
  stepIncreasePerUnit: number;
  settlementQuantity: number;
}): { billableSteps: number; unitPrice: number; totalAmount: number } {
  const {
    actualDistanceKm,
    startDistanceKm,
    basePricePerUnit,
    stepMeters,
    stepIncreasePerUnit,
    settlementQuantity,
  } = params;

  if (actualDistanceKm < 0 || startDistanceKm < 0 || basePricePerUnit < 0 || settlementQuantity < 0) {
    throw new ConstructionDomainError("INVALID_PARAMETER", "运价计算参数不能为负数");
  }
  if (stepMeters <= 0) {
    throw new ConstructionDomainError("INVALID_PARAMETER", "递增里程单位必须大于 0 米");
  }

  const excessMeters = Math.max(0, (actualDistanceKm - startDistanceKm) * 1000);
  const billableSteps = excessMeters === 0 ? 0 : Math.ceil(excessMeters / stepMeters);
  const unitPrice = roundMoney(basePricePerUnit + billableSteps * stepIncreasePerUnit);
  return {
    billableSteps,
    unitPrice,
    totalAmount: roundMoney(unitPrice * settlementQuantity),
  };
}

/**
 * 汇总外租机械结算金额。不同合同可按月/日/小时/台班任一方式计租，
 * 油料、加班、维修、进退场等费用均独立入账，避免混入租金而无法追溯。
 */
export function calculateMachineSettlement(params: {
  leaseAmount: number;
  dieselLiters: number;
  dieselUnitPrice: number;
  overtimeHours: number;
  overtimeHourlyRate: number;
  repairAmount: number;
  mobilizationAmount: number;
  deductionAmount: number;
  /** 其他经批准的机械成本，例如临时场地、辅材或非例行服务费。 */
  otherAmount?: number;
}): { fuelAmount: number; overtimeAmount: number; totalAmount: number } {
  const values = Object.values(params);
  if (values.some(value => value < 0 || !Number.isFinite(value))) {
    throw new ConstructionDomainError("INVALID_PARAMETER", "机械结算参数必须为有效的非负数");
  }

  const fuelAmount = roundMoney(params.dieselLiters * params.dieselUnitPrice);
  const overtimeAmount = roundMoney(params.overtimeHours * params.overtimeHourlyRate);
  const totalAmount = roundMoney(
    params.leaseAmount + fuelAmount + overtimeAmount + params.repairAmount + params.mobilizationAmount + (params.otherAmount ?? 0) - params.deductionAmount,
  );
  return { fuelAmount, overtimeAmount, totalAmount };
}

/**
 * 计算工资条的应发、扣款与实发金额。
 * 实发金额只能由服务端按统一规则生成，前端不得直接提交或覆盖，避免工资条金额被绕过核算逻辑篡改。
 */
export function calculatePayrollAmounts(params: { payableAmount: number; deductionAmount: number }): {
  payableAmount: number;
  deductionAmount: number;
  actualAmount: number;
} {
  const { payableAmount, deductionAmount } = params;
  if (![payableAmount, deductionAmount].every(value => Number.isFinite(value) && value >= 0)) {
    throw new ConstructionDomainError("INVALID_PARAMETER", "工资应发金额与扣款金额必须为有效的非负数");
  }
  if (deductionAmount > payableAmount) {
    throw new ConstructionDomainError("INVALID_PARAMETER", "工资扣款金额不得大于应发金额");
  }
  return {
    payableAmount: roundMoney(payableAmount),
    deductionAmount: roundMoney(deductionAmount),
    actualAmount: roundMoney(payableAmount - deductionAmount),
  };
}

/**
 * 工资审核属于会计职责。ALL 仅代表经过系统级管理员认证的应急管理身份，
 * 不能被普通财务负责人或劳资管理员角色替代。
 */
export function canApprovePayroll(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.includes("ACCOUNTANT");
}

/**
 * 工资发放确认属于资金执行动作，只允许财务负责人或系统级应急管理身份操作。
 * 会计审核和实际发放拆分，避免单一岗位同时完成审核与支付确认。
 */
export function canPayPayroll(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.includes("FINANCE_MANAGER");
}

/**
 * 工资条作废仅能发生在发放确认前，由会计或财务负责人办理并留下原因审计。
 * 已支付工资条不在此权限判断中放行，最终状态机仍会拒绝任何回退。
 */
export function canVoidPayroll(roleCodes: readonly string[]) {
  return roleCodes.includes("ALL") || roleCodes.includes("ACCOUNTANT") || roleCodes.includes("FINANCE_MANAGER");
}

/**
 * 校验单日考勤工时。正常工时和加班工时分别保留，是为了工资核算能区分班次与加班；
 * 但二者合计不能超过自然日 24 小时。
 */
export function assertAttendanceWorkHours(workHours: number, overtimeHours: number) {
  if (![workHours, overtimeHours].every(value => Number.isFinite(value) && value >= 0 && value <= 24)) {
    throw new ConstructionDomainError("INVALID_PARAMETER", "正常工时和加班工时必须为 0 至 24 之间的有效数值");
  }
  if (workHours + overtimeHours > 24) {
    throw new ConstructionDomainError("INVALID_PARAMETER", "正常工时与加班工时合计不得超过 24 小时");
  }
}

/**
 * 汇总工资条金额和审批状态。数据库 decimal 字段在运行时可能是字符串，
 * 因此在业务层统一转换并四舍五入，确保移动端统计、打印报表与后续导出使用同一口径。
 */
export function summarizePayrollStatements(items: ReadonlyArray<{
  payableAmount: string | number;
  deductionAmount: string | number;
  actualAmount: string | number;
  status: string;
}>) {
  return {
    payableAmount: roundMoney(items.reduce((sum, item) => sum + Number(item.payableAmount), 0)),
    deductionAmount: roundMoney(items.reduce((sum, item) => sum + Number(item.deductionAmount), 0)),
    actualAmount: roundMoney(items.reduce((sum, item) => sum + Number(item.actualAmount), 0)),
    awaitingReviewCount: items.filter(item => item.status === "reviewing").length,
    awaitingReviewAmount: roundMoney(items.filter(item => item.status === "reviewing").reduce((sum, item) => sum + Number(item.actualAmount), 0)),
    approvedCount: items.filter(item => item.status === "approved").length,
  };
}

/**
 * 校验实名制证照的文件头与声明 MIME 类型一致。
 * 浏览器传入的 MIME 值并不可信，因此服务端还需检查 JPEG、PNG 与 PDF 的固定签名。
 */
export function assertCertificateFileSignature(bytes: Uint8Array, mimeType: "image/jpeg" | "image/png" | "application/pdf") {
  const hasPrefix = (...prefix: number[]) => prefix.every((value, index) => bytes[index] === value);
  const valid = mimeType === "image/jpeg"
    ? hasPrefix(0xff, 0xd8, 0xff)
    : mimeType === "image/png"
      ? hasPrefix(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
      : hasPrefix(0x25, 0x50, 0x44, 0x46, 0x2d);
  if (!valid) {
    throw new ConstructionDomainError("INVALID_PARAMETER", "证照文件内容与声明格式不一致");
  }
}
