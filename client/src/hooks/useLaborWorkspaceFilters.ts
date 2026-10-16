import { useState } from "react";
import { toChinaMonthInput } from "@/lib/businessTime";

export type LaborAttendanceFilter = { workerName: string; team: string; category: string; status: string };

/**
 * 劳务工作区本地筛选状态。
 * 仅承载界面筛选条件，不改变服务端的项目范围、字段投影或审核状态机。
 */
export function useLaborWorkspaceFilters(initialAttendanceDate: string) {
  // 工资条是按月度处理的台账；首次进入仅查询当前中国业务月份，避免无筛选加载所有历史工资记录。
  const [laborPeriod, setLaborPeriod] = useState(() => toChinaMonthInput());
  const [laborAttendanceDate, setLaborAttendanceDate] = useState(initialAttendanceDate);
  const [laborPayrollSearch, setLaborPayrollSearch] = useState("");
  const [laborPayrollTeam, setLaborPayrollTeam] = useState("all");
  const [laborPayrollStatus, setLaborPayrollStatus] = useState("all");
  const [laborAttendanceFilter, setLaborAttendanceFilter] = useState<LaborAttendanceFilter>({ workerName: "", team: "all", category: "all", status: "all" });

  return { laborPeriod, setLaborPeriod, laborAttendanceDate, setLaborAttendanceDate, laborPayrollSearch, setLaborPayrollSearch, laborPayrollTeam, setLaborPayrollTeam, laborPayrollStatus, setLaborPayrollStatus, laborAttendanceFilter, setLaborAttendanceFilter };
}
