/** 真实项目验收只使用聚合计数，不输出人员、考勤或工资明细。 */
export type RealDataReadinessCounts = {
  organizations: number;
  projects: number;
  roleAssignments: number;
  departmentScopes: number;
  laborWorkers: number;
  attendanceRecords: number;
  payrollStatements: number;
  constructionDailyReports?: number;
  evidenceRecords?: number;
  machines?: number;
  transportVehicles?: number;
  dieselRefuelRecords?: number;
  transportTrips?: number;
  purchaseOrders?: number;
  inventoryTransactions?: number;
  measurementClaims?: number;
  measurementTakeoffRecords?: number;
  outsourceContracts?: number;
  subcontractPackages?: number;
  financialRecords?: number;
  officialAccountBindings?: number;
  officialAccountNotifications?: number;
  officialAccountTemplateGaps?: number;
};

export type RealDataReadinessCheck = {
  key: "authorization" | "construction" | "resources" | "purchasing" | "measurement" | "subcontract" | "finance" | "labor" | "attendance" | "payroll" | "notification" | "print";
  label: string;
  ready: boolean;
  detail: string;
  ownerRole: string;
  actionPath: string;
  actionLabel: string;
};

export type RealDataReadinessFinding = {
  id: "daily_report_not_measured" | "resource_without_consumption" | "purchase_not_stocked" | "contract_not_subcontracted" | "business_not_financed" | "official_template_not_bound";
  severity: "critical" | "warning";
  title: string;
  summary: string;
  ownerRole: string;
  actionPath: string;
  actionLabel: string;
};

/**
 * 统一生成真实数据验收清单。仅在所有业务链路均有真实记录时允许标记为可复测；
 * 不会为了通过预检而生成任何模拟项目、人员、考勤或工资数据。
 */
export function evaluateRealDataReadiness(counts: RealDataReadinessCounts) {
  const authorizationReady = counts.organizations > 0 && counts.projects > 0 && counts.roleAssignments > 0 && counts.departmentScopes > 0;
  const constructionDailyReports = counts.constructionDailyReports ?? 0;
  const evidenceRecords = counts.evidenceRecords ?? 0;
  const machines = counts.machines ?? 0;
  const transportVehicles = counts.transportVehicles ?? 0;
  const dieselRefuelRecords = counts.dieselRefuelRecords ?? 0;
  const transportTrips = counts.transportTrips ?? 0;
  const purchaseOrders = counts.purchaseOrders ?? 0;
  const inventoryTransactions = counts.inventoryTransactions ?? 0;
  const measurementClaims = counts.measurementClaims ?? 0;
  const measurementTakeoffRecords = counts.measurementTakeoffRecords ?? 0;
  const outsourceContracts = counts.outsourceContracts ?? 0;
  const subcontractPackages = counts.subcontractPackages ?? 0;
  const financialRecords = counts.financialRecords ?? 0;
  const officialAccountBindings = counts.officialAccountBindings ?? 0;
  const officialAccountNotifications = counts.officialAccountNotifications ?? 0;
  const officialAccountTemplateGaps = counts.officialAccountTemplateGaps ?? 0;
  const constructionReady = constructionDailyReports > 0 && evidenceRecords > 0;
  const resourcesReady = machines + transportVehicles > 0 && dieselRefuelRecords > 0 && transportTrips > 0;
  const purchasingReady = purchaseOrders > 0 && inventoryTransactions > 0;
  const measurementReady = measurementClaims + measurementTakeoffRecords > 0;
  const subcontractReady = outsourceContracts > 0 && subcontractPackages > 0;
  const financeReady = financialRecords > 0;
  const laborReady = counts.laborWorkers > 0;
  const attendanceReady = laborReady && counts.attendanceRecords > 0;
  const payrollReady = laborReady && counts.payrollStatements > 0;
  const notificationReady = officialAccountBindings > 0 && officialAccountNotifications > 0;
  const printReady = payrollReady;
  const checks: RealDataReadinessCheck[] = [
    { key: "authorization", label: "真实项目与部门授权", ready: authorizationReady, detail: `组织 ${counts.organizations}、项目 ${counts.projects}、岗位授权 ${counts.roleAssignments}、部门业务范围 ${counts.departmentScopes}`, ownerRole: "项目经理 / 系统管理员", actionPath: "/admin/organization", actionLabel: "配置项目与授权" },
    { key: "construction", label: "施工日报与影像", ready: constructionReady, detail: `施工日报 ${constructionDailyReports} 条、现场影像 ${evidenceRecords} 条；日报需关联工程部位、资源消耗与影像后才可进入经营统计。`, ownerRole: "项目生产经理", actionPath: "/admin/construction", actionLabel: "检查施工日报" },
    { key: "resources", label: "资源消耗与运输", ready: resourcesReady, detail: `机械 ${machines} 台、运输车辆 ${transportVehicles} 台、柴油领用 ${dieselRefuelRecords} 条、运输趟次 ${transportTrips} 条。`, ownerRole: "机务 / 运输负责人", actionPath: "/admin/diesel", actionLabel: "补齐资源消耗" },
    { key: "purchasing", label: "采购与库存收发", ready: purchasingReady, detail: `采购订单 ${purchaseOrders} 条、库存收发 ${inventoryTransactions} 条；订单需进入入库、领用、退库或合理关闭状态。`, ownerRole: "物资负责人", actionPath: "/admin/purchasing", actionLabel: "处理采购库存" },
    { key: "measurement", label: "收方与工程计量", ready: measurementReady, detail: `项目部收方 ${measurementTakeoffRecords} 条、工程计量 ${measurementClaims} 条。`, ownerRole: "商务合约负责人", actionPath: "/admin/settlement", actionLabel: "录入收方计量" },
    { key: "subcontract", label: "合同与分包执行", ready: subcontractReady, detail: `外包合同 ${outsourceContracts} 条、分包包件 ${subcontractPackages} 条；需关联收方、结算与应付。`, ownerRole: "商务合约 / 项目经理", actionPath: "/admin/subcontract", actionLabel: "维护分包包件" },
    { key: "finance", label: "财务确认与资金流水", ready: financeReady, detail: `正式财务流水 ${financialRecords} 条；经营看板应区分业务暂估与财务确认。`, ownerRole: "财务负责人", actionPath: "/admin/finance", actionLabel: "进入财务确认" },
    { key: "labor", label: "劳务台账", ready: laborReady, detail: `真实劳务人员 ${counts.laborWorkers} 条`, ownerRole: "劳务负责人", actionPath: "/admin/labor", actionLabel: "维护劳务台账" },
    { key: "attendance", label: "考勤记录", ready: attendanceReady, detail: `真实考勤记录 ${counts.attendanceRecords} 条`, ownerRole: "班组长 / 劳务负责人", actionPath: "/admin/labor", actionLabel: "核验考勤" },
    { key: "payroll", label: "工资统计", ready: payrollReady, detail: `真实工资单 ${counts.payrollStatements} 条`, ownerRole: "会计 / 财务负责人", actionPath: "/admin/labor", actionLabel: "处理工资台账" },
    { key: "notification", label: "服务号通知与投递审计", ready: notificationReady, detail: `服务号绑定 ${officialAccountBindings} 人、服务号投递记录 ${officialAccountNotifications} 条；模板是否真实可下发仍以模块绑定和微信回执为准。`, ownerRole: "数字化运维负责人", actionPath: "/admin/settings", actionLabel: "检查模板投递" },
    { key: "print", label: "工资打印视图", ready: printReady, detail: payrollReady ? "已有真实工资单，可进入打印视图人工核验。" : "需先具备真实工资单，才可进行打印视图人工核验。", ownerRole: "会计 / 财务负责人", actionPath: "/admin/labor", actionLabel: "打开工资打印" },
  ];
  const findings: RealDataReadinessFinding[] = [];
  if (constructionDailyReports > 0 && measurementClaims + measurementTakeoffRecords === 0) findings.push({ id: "daily_report_not_measured", severity: "warning", title: "施工日报尚未进入收方或计量", summary: `已有施工日报 ${constructionDailyReports} 条，但收方与工程计量均为 0；进度产值和计量收入暂不能形成可审计对照。`, ownerRole: "项目生产经理 / 商务合约负责人", actionPath: "/admin/settlement", actionLabel: "补齐收方计量" });
  if (machines + transportVehicles > 0 && (dieselRefuelRecords === 0 || transportTrips === 0)) findings.push({ id: "resource_without_consumption", severity: "critical", title: "资源台账未形成完整油耗或趟次", summary: `已有机械与车辆台账 ${machines + transportVehicles} 台，柴油领用 ${dieselRefuelRecords} 条、运输趟次 ${transportTrips} 条；资源成本无法形成完整作业面归集。`, ownerRole: "机务 / 运输负责人", actionPath: "/admin/diesel", actionLabel: "补录资源消耗" });
  if (purchaseOrders > 0 && inventoryTransactions === 0) findings.push({ id: "purchase_not_stocked", severity: "critical", title: "采购订单尚未形成库存收发", summary: `已有采购订单 ${purchaseOrders} 条，但库存收发为 0；不得以订单金额替代实际入库和领用成本。`, ownerRole: "物资负责人", actionPath: "/admin/purchasing", actionLabel: "处理采购库存" });
  if (outsourceContracts > 0 && subcontractPackages === 0) findings.push({ id: "contract_not_subcontracted", severity: "warning", title: "外包合同尚未形成分包包件", summary: `已有外包合同 ${outsourceContracts} 条，但分包包件为 0；合同、工程量、结算和应付尚未建立映射。`, ownerRole: "商务合约负责人", actionPath: "/admin/subcontract", actionLabel: "维护分包包件" });
  if ((constructionDailyReports + purchaseOrders + outsourceContracts + counts.payrollStatements) > 0 && financialRecords === 0) findings.push({ id: "business_not_financed", severity: "critical", title: "业务记录尚未形成财务确认", summary: "已存在施工、采购、合同或工资业务记录，但正式财务流水为 0；经营看板只能展示业务暂估，不能作为付款或利润结论。", ownerRole: "财务负责人", actionPath: "/admin/finance", actionLabel: "进入财务确认" });
  if (officialAccountTemplateGaps > 0) findings.push({ id: "official_template_not_bound", severity: "warning", title: "服务号业务模板尚未完整绑定", summary: `发现 ${officialAccountTemplateGaps} 条投递记录因模块模板未绑定而跳过；需在新服务号获批后按模块绑定真实模板并验证微信回执。`, ownerRole: "数字化运维负责人", actionPath: "/admin/settings", actionLabel: "检查模板投递" });
  return { ready: checks.every(check => check.ready), counts, checks, findings };
}
