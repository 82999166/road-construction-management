import { trpc } from "@/lib/trpc";

type QueryInputs = {
  enabled: boolean;
  workspaceProjectInput: { projectId: number };
  laborWorkspaceInput: { projectId: number; includeLeft: boolean };
  payrollWorkspaceInput: { projectId: number; period?: string };
  laborCheckInWorkspaceInput: { projectId?: number; businessDate?: string };
};

/**
 * 劳务工作区数据查询边界。
 * 仅接收父级已经按当前授权项目与劳务菜单计算好的输入和启用条件，不在此处放宽服务端权限或字段投影。
 */
export function useLaborWorkspaceQueries({ enabled, workspaceProjectInput, laborWorkspaceInput, payrollWorkspaceInput, laborCheckInWorkspaceInput }: QueryInputs) {
  const laborWorkers = trpc.labor.listWorkers.useQuery(laborWorkspaceInput, { enabled });
  const laborAttendance = trpc.labor.attendance.list.useQuery(workspaceProjectInput, { enabled });
  const laborCheckIns = trpc.labor.attendance.listCheckIns.useQuery(laborCheckInWorkspaceInput, { enabled });
  const payrollStatements = trpc.labor.payroll.list.useQuery(payrollWorkspaceInput, { enabled });
  const laborDailyWages = trpc.labor.dailyWage.list.useQuery(workspaceProjectInput, { enabled });
  const payrollWorkbookExport = trpc.labor.dailyWage.exportWorkbookData.useQuery(payrollWorkspaceInput, { enabled: false, retry: false });
  const payrollPaymentListExport = trpc.labor.dailyWage.exportPaymentList.useQuery(payrollWorkspaceInput, { enabled: false, retry: false });
  return { laborWorkers, laborAttendance, laborCheckIns, payrollStatements, laborDailyWages, payrollWorkbookExport, payrollPaymentListExport };
}
