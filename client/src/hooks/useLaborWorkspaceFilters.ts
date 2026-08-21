import { useState } from "react";

export type LaborAttendanceFilter = { workerName: string; team: string; category: string; status: string };

/**
 * 劳务工作区本地筛选状态。
 * 仅承载界面筛选条件，不改变服务端的项目范围、字段投影或审核状态机。
 */
export function useLaborWorkspaceFilters(initialAttendanceDate: string) {
  const [laborPeriod, setLaborPeriod] = useState("");
  const [laborAttendanceDate, setLaborAttendanceDate] = useState(initialAttendanceDate);
  const [laborPayrollSearch, setLaborPayrollSearch] = useState("");
  const [laborPayrollTeam, setLaborPayrollTeam] = useState("all");
  const [laborPayrollStatus, setLaborPayrollStatus] = useState("all");
  const [laborAttendanceFilter, setLaborAttendanceFilter] = useState<LaborAttendanceFilter>({ workerName: "", team: "all", category: "all", status: "all" });

  return { laborPeriod, setLaborPeriod, laborAttendanceDate, setLaborAttendanceDate, laborPayrollSearch, setLaborPayrollSearch, laborPayrollTeam, setLaborPayrollTeam, laborPayrollStatus, setLaborPayrollStatus, laborAttendanceFilter, setLaborAttendanceFilter };
}
