/** 真实项目验收只使用聚合计数，不输出人员、考勤或工资明细。 */
export type RealDataReadinessCounts = {
  organizations: number;
  projects: number;
  roleAssignments: number;
  departmentScopes: number;
  laborWorkers: number;
  attendanceRecords: number;
  payrollStatements: number;
};

export type RealDataReadinessCheck = {
  key: "authorization" | "labor" | "attendance" | "payroll" | "print";
  label: string;
  ready: boolean;
  detail: string;
};

/**
 * 统一生成真实数据验收清单。仅在所有业务链路均有真实记录时允许标记为可复测；
 * 不会为了通过预检而生成任何模拟项目、人员、考勤或工资数据。
 */
export function evaluateRealDataReadiness(counts: RealDataReadinessCounts) {
  const authorizationReady = counts.organizations > 0 && counts.projects > 0 && counts.roleAssignments > 0 && counts.departmentScopes > 0;
  const laborReady = counts.laborWorkers > 0;
  const attendanceReady = laborReady && counts.attendanceRecords > 0;
  const payrollReady = laborReady && counts.payrollStatements > 0;
  const printReady = payrollReady;
  const checks: RealDataReadinessCheck[] = [
    { key: "authorization", label: "真实项目与部门授权", ready: authorizationReady, detail: `组织 ${counts.organizations}、项目 ${counts.projects}、岗位授权 ${counts.roleAssignments}、部门业务范围 ${counts.departmentScopes}` },
    { key: "labor", label: "劳务台账", ready: laborReady, detail: `真实劳务人员 ${counts.laborWorkers} 条` },
    { key: "attendance", label: "考勤记录", ready: attendanceReady, detail: `真实考勤记录 ${counts.attendanceRecords} 条` },
    { key: "payroll", label: "工资统计", ready: payrollReady, detail: `真实工资单 ${counts.payrollStatements} 条` },
    { key: "print", label: "工资打印视图", ready: printReady, detail: payrollReady ? "已有真实工资单，可进入打印视图人工核验。" : "需先具备真实工资单，才可进行打印视图人工核验。" },
  ];
  return { ready: checks.every(check => check.ready), counts, checks };
}
