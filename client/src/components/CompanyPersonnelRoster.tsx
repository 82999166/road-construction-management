import { useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type CompanyPersonnelRosterRow = {
  id: string;
  profileId: number | null;
  userId: number | null;
  laborWorkerId: number | null;
  displayName: string;
  employeeType: "management" | "operator" | "construction_worker";
  workerCategory: "company_admin" | "labor_team" | "temporary_daily" | null;
  employmentStatus: "active" | "suspended" | "left" | "pending";
  projectId: number | null;
  projectName: string | null;
  teamName: string | null;
  joinedAt: Date | string | null;
  salaryBasis: "monthly" | "daily" | "hourly" | "piecework" | null;
  profileComplete: boolean;
  contactPhoneMasked: string | null;
  tradeName: string | null;
  baseSalary: string | number | null;
  attendanceDays: number;
  workHours: number;
  overtimeHours: number;
  confirmedAttendanceDays: number;
  mobileCheckInDays: number;
  latestAttendanceDate: Date | string | null;
  latestPayrollPeriod: string | null;
  latestPayableAmount: string | number | null;
  latestActualAmount: string | number | null;
  latestPayrollStatus: string | null;
  bankAccountMasked: string | null;
};

type Props = {
  rows: CompanyPersonnelRosterRow[];
  loading: boolean;
  hasError: boolean;
  onRetry: () => void;
  onSaved?: () => void | Promise<void>;
  displayDate: (value: Date | string) => string;
};

type PersonnelTypeFilter =
  | "all"
  | CompanyPersonnelRosterRow["employeeType"]
  | "temporary_daily";
type EmploymentStatusFilter =
  | "all"
  | CompanyPersonnelRosterRow["employmentStatus"];

function getPersonnelTypeLabel(row: CompanyPersonnelRosterRow) {
  if (row.workerCategory === "temporary_daily") return "临时日结人员";
  if (row.employeeType === "management") return "公司管理人员";
  if (row.employeeType === "operator") return "机械操作员";
  return "施工队工人";
}

function getEmploymentStatusLabel(
  status: CompanyPersonnelRosterRow["employmentStatus"]
) {
  if (status === "active") return "在职";
  if (status === "suspended") return "已停用";
  if (status === "left") return "已离职";
  return "待完善档案";
}

function getSalaryBasisLabel(
  salaryBasis: CompanyPersonnelRosterRow["salaryBasis"]
) {
  if (salaryBasis === "monthly") return "月薪";
  if (salaryBasis === "daily") return "日薪";
  if (salaryBasis === "hourly") return "时薪";
  if (salaryBasis === "piecework") return "计件";
  return "待维护";
}

/**
 * 公司全员基础名册：将公司账号、员工档案和实名制劳务档案去重汇总。
 * 不显示手机号、证件号、银行卡或登录账号；档案维护仍由权限管理工作区承载。
 */
export default function CompanyPersonnelRoster({
  rows,
  loading,
  hasError,
  onRetry,
  onSaved,
  displayDate,
}: Props) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState<PersonnelTypeFilter>("all");
  const [status, setStatus] = useState<EmploymentStatusFilter>("all");
  const [projectId, setProjectId] = useState("all");
  const [selectedRow, setSelectedRow] =
    useState<CompanyPersonnelRosterRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    teamName: "",
    projectId: "",
    employmentStatus: "active" as "active" | "suspended" | "left",
    joinedAt: "",
    salaryBasis: "monthly" as "monthly" | "daily" | "hourly" | "piecework",
    baseSalary: "",
    remarks: "",
  });
  const saveProfile = trpc.admin.employee.saveProfile.useMutation({
    onSuccess: async () => {
      toast.success("员工档案已保存");
      setEditing(false);
      await onSaved?.();
    },
    onError: error => toast.error(error.message || "员工档案保存失败"),
  });
  const beginEdit = (row: CompanyPersonnelRosterRow) => {
    setDraft({
      teamName: row.teamName ?? "",
      projectId: row.projectId ? String(row.projectId) : "",
      employmentStatus:
        row.employmentStatus === "pending" ? "active" : row.employmentStatus,
      joinedAt: row.joinedAt ? String(row.joinedAt).slice(0, 10) : "",
      salaryBasis: row.salaryBasis ?? "monthly",
      baseSalary: row.baseSalary == null ? "" : String(row.baseSalary),
      remarks: "",
    });
    setEditing(true);
  };

  const projectOptions = useMemo(
    () =>
      Array.from(
        new Map(
          rows
            .filter(row => row.projectId && row.projectName)
            .map(row => [row.projectId!, row.projectName!])
        ).entries()
      ).sort(([, left], [, right]) => left.localeCompare(right, "zh-CN")),
    [rows]
  );
  const visibleRows = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("zh-CN");
    return rows.filter(row => {
      const typeMatches =
        type === "all" ||
        (type === "temporary_daily"
          ? row.workerCategory === "temporary_daily"
          : row.employeeType === type &&
            row.workerCategory !== "temporary_daily");
      const statusMatches = status === "all" || row.employmentStatus === status;
      const projectMatches =
        projectId === "all" || String(row.projectId) === projectId;
      const textMatches =
        !keyword ||
        [
          row.displayName,
          row.teamName,
          row.projectName,
          getPersonnelTypeLabel(row),
        ].some(value => value?.toLocaleLowerCase("zh-CN").includes(keyword));
      return typeMatches && statusMatches && projectMatches && textMatches;
    });
  }, [projectId, rows, search, status, type]);

  return (
    <Card className="border-[#c9ded7] shadow-sm">
      <CardHeader className="gap-3 space-y-0 border-b border-[#e6efeb] bg-[linear-gradient(135deg,#f8fcfb_0%,#eff7f3_100%)] py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">
              人员总览 · 公司范围
            </p>
            <CardTitle className="mt-1 text-base text-[#203c48]">
              公司全员花名册
            </CardTitle>
            <CardDescription className="mt-1 max-w-3xl">
              汇总公司账号、员工档案和实名制人员，自动去重；不受当前劳务项目筛选限制。人员类型、在职状态、项目和班组均可组合查看。
            </CardDescription>
          </div>
          <Badge
            variant="secondary"
            className="w-fit bg-[#dcebe5] text-[#24564c]"
          >
            当前 {visibleRows.length} / {rows.length} 人
          </Badge>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.25fr)_180px_160px_190px]">
          <Input
            className="h-9 bg-white"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="搜索姓名、项目或班组"
            aria-label="搜索公司全员"
          />
          <Select
            value={type}
            onValueChange={value => setType(value as PersonnelTypeFilter)}
          >
            <SelectTrigger className="h-9 bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部人员类型</SelectItem>
              <SelectItem value="management">公司管理人员</SelectItem>
              <SelectItem value="operator">机械操作员</SelectItem>
              <SelectItem value="construction_worker">施工队工人</SelectItem>
              <SelectItem value="temporary_daily">临时日结人员</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={value => setStatus(value as EmploymentStatusFilter)}
          >
            <SelectTrigger className="h-9 bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部在职状态</SelectItem>
              <SelectItem value="active">在职</SelectItem>
              <SelectItem value="suspended">已停用</SelectItem>
              <SelectItem value="left">已离职</SelectItem>
              <SelectItem value="pending">待完善档案</SelectItem>
            </SelectContent>
          </Select>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="h-9 bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部归属项目</SelectItem>
              {projectOptions.map(([id, name]) => (
                <SelectItem key={id} value={String(id)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-3">
        {loading ? (
          <p className="py-5 text-center text-sm text-slate-500">
            正在读取公司全员花名册…
          </p>
        ) : hasError ? (
          <div className="flex flex-col items-center gap-3 py-5 text-center">
            <p className="text-sm text-slate-500">
              暂无法读取公司全员花名册，请确认当前账号的超级管理员授权后重试。
            </p>
            <Button size="sm" variant="outline" onClick={onRetry}>
              重新读取花名册
            </Button>
          </div>
        ) : visibleRows.length ? (
          <div className="overflow-x-auto rounded-xl border border-[#dce7e1]">
            <Table className="min-w-[1120px] text-xs">
              <TableHeader className="bg-[#f1f7f4]">
                <TableRow className="border-[#dce7e1] hover:bg-[#f1f7f4]">
                  <TableHead className="h-10 px-3 font-semibold text-[#46615a]">
                    姓名
                  </TableHead>
                  <TableHead className="h-10 px-3 font-semibold text-[#46615a]">
                    人员类型
                  </TableHead>
                  <TableHead className="h-10 px-3 font-semibold text-[#46615a]">
                    工种 / 班组
                  </TableHead>
                  <TableHead className="h-10 px-3 font-semibold text-[#46615a]">
                    联系方式
                  </TableHead>
                  <TableHead className="h-10 px-3 font-semibold text-[#46615a]">
                    入职日期
                  </TableHead>
                  <TableHead className="h-10 px-3 font-semibold text-[#46615a]">
                    考勤汇总
                  </TableHead>
                  <TableHead className="h-10 px-3 font-semibold text-[#46615a]">
                    计薪口径
                  </TableHead>
                  <TableHead className="h-10 px-3 text-right font-semibold text-[#46615a]">
                    操作
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map(row => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer border-[#edf0ee] hover:bg-[#fbfdfc]"
                    onClick={() => setSelectedRow(row)}
                  >
                    <TableCell className="px-3 py-2.5 font-semibold text-[#203c48]">
                      {row.displayName}
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge
                          variant="outline"
                          className="border-[#b8d3c8] text-[#2d665a]"
                        >
                          {getPersonnelTypeLabel(row)}
                        </Badge>
                        <Badge
                          variant={
                            row.employmentStatus === "active"
                              ? "secondary"
                              : "outline"
                          }
                          className={
                            row.employmentStatus === "active"
                              ? "bg-emerald-50 text-emerald-700"
                              : "text-slate-600"
                          }
                        >
                          {getEmploymentStatusLabel(row.employmentStatus)}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-slate-700">
                      <p>{row.tradeName || "未登记工种"}</p>
                      <p className="mt-0.5 text-slate-500">
                        {row.teamName || "未分配班组"}
                      </p>
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-slate-700">
                      {row.contactPhoneMasked || "未登记"}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-slate-700">
                      {row.joinedAt ? displayDate(row.joinedAt) : "未登记"}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-slate-700">
                      <p>
                        {row.attendanceDays} 天 · {row.workHours.toFixed(2)}{" "}
                        小时
                      </p>
                      <p className="mt-0.5 text-slate-500">
                        加班 {row.overtimeHours.toFixed(2)} 小时
                      </p>
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-slate-700">
                      <p>{getSalaryBasisLabel(row.salaryBasis)}</p>
                      <p className="mt-0.5 text-slate-500">
                        基础 ¥{row.baseSalary ?? "未维护"}
                      </p>
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={event => {
                          event.stopPropagation();
                          setSelectedRow(row);
                        }}
                      >
                        查看详情
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="py-7 text-center text-sm text-slate-500">
            当前筛选条件下暂无人员。可切换人员类型、在职状态或项目查看。
          </p>
        )}
      </CardContent>
      <Dialog
        open={Boolean(selectedRow)}
        onOpenChange={open => {
          if (!open) setSelectedRow(null);
        }}
      >
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
          {selectedRow ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {selectedRow.displayName} · 人员详细信息
                </DialogTitle>
                <DialogDescription>
                  仅向超级管理后台展示受控业务资料；联系方式已脱敏，银行卡、证件和密码不在此页面展示。
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">人员类型 / 状态</p>
                  <p className="mt-1 font-medium">
                    {getPersonnelTypeLabel(selectedRow)} ·{" "}
                    {getEmploymentStatusLabel(selectedRow.employmentStatus)}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">联系方式</p>
                  <p className="mt-1 font-medium">
                    {selectedRow.contactPhoneMasked || "未登记"}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">银行卡（脱敏）</p>
                  <p className="mt-1 font-medium">
                    {selectedRow.bankAccountMasked || "未登记"}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">工种 / 班组</p>
                  <p className="mt-1 font-medium">
                    {selectedRow.tradeName || "未登记工种"} ·{" "}
                    {selectedRow.teamName || "未分配班组"}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">项目 / 入职日期</p>
                  <p className="mt-1 font-medium">
                    {selectedRow.projectName || "未分配项目"} ·{" "}
                    {selectedRow.joinedAt
                      ? displayDate(selectedRow.joinedAt)
                      : "未登记"}
                  </p>
                </div>
              </div>
              <section className="rounded-xl border border-[#dce7e1] p-3">
                <h3 className="font-semibold text-[#203c48]">考勤与工时</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-slate-500">考勤天数</p>
                    <p className="mt-1 font-semibold">
                      {selectedRow.attendanceDays} 天
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">工作时长</p>
                    <p className="mt-1 font-semibold">
                      {selectedRow.workHours.toFixed(2)} 小时
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">加班时长</p>
                    <p className="mt-1 font-semibold">
                      {selectedRow.overtimeHours.toFixed(2)} 小时
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">最近考勤</p>
                    <p className="mt-1 font-semibold">
                      {selectedRow.latestAttendanceDate
                        ? displayDate(selectedRow.latestAttendanceDate)
                        : "暂无"}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  已确认考勤 {selectedRow.confirmedAttendanceDays}{" "}
                  天；移动端打卡 {selectedRow.mobileCheckInDays} 天。
                </p>
              </section>
              <section className="rounded-xl border border-[#dce7e1] p-3">
                <h3 className="font-semibold text-[#203c48]">薪资信息</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-slate-500">计薪口径</p>
                    <p className="mt-1 font-semibold">
                      {getSalaryBasisLabel(selectedRow.salaryBasis)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">基础工资 / 单价</p>
                    <p className="mt-1 font-semibold">
                      ¥ {selectedRow.baseSalary ?? "未维护"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">最近工资期间</p>
                    <p className="mt-1 font-semibold">
                      {selectedRow.latestPayrollPeriod || "暂无工资条"}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  最近应发 ¥{selectedRow.latestPayableAmount ?? "—"}，实发 ¥
                  {selectedRow.latestActualAmount ?? "—"}
                  ；金额以审核工资条为准。
                </p>
              </section>
              <div className="flex justify-end gap-2">
                {selectedRow.profileId ? (
                  <Button type="button" onClick={() => beginEdit(selectedRow)}>
                    修改员工资料
                  </Button>
                ) : (
                  <p className="text-xs text-slate-500">
                    该人员尚未建立统一员工档案，请先建档后修改。
                  </p>
                )}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>修改员工档案</DialogTitle>
            <DialogDescription>
              仅超级管理员可修改；银行卡和联系方式只显示脱敏信息。
            </DialogDescription>
          </DialogHeader>
          {selectedRow ? (
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={event => {
                event.preventDefault();
                if (!selectedRow.profileId) return;
                saveProfile.mutate({
                  id: selectedRow.profileId,
                  userId: selectedRow.userId,
                  laborWorkerId: selectedRow.laborWorkerId,
                  projectId: draft.projectId ? Number(draft.projectId) : null,
                  employeeType: selectedRow.employeeType,
                  teamName: draft.teamName.trim() || null,
                  employmentStatus: draft.employmentStatus,
                  joinedAt: draft.joinedAt || null,
                  leftAt: null,
                  salaryBasis: draft.salaryBasis,
                  baseSalary: draft.baseSalary
                    ? Number(draft.baseSalary)
                    : null,
                  remarks: draft.remarks.trim() || null,
                });
              }}
            >
              <div className="sm:col-span-2 rounded-lg bg-slate-50 p-3 text-sm font-medium">
                {selectedRow.displayName}
              </div>
              <label className="grid gap-1 text-sm">
                项目编号
                <Input
                  value={draft.projectId}
                  onChange={event =>
                    setDraft(current => ({
                      ...current,
                      projectId: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                班组
                <Input
                  value={draft.teamName}
                  onChange={event =>
                    setDraft(current => ({
                      ...current,
                      teamName: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                在职状态
                <Select
                  value={draft.employmentStatus}
                  onValueChange={value =>
                    setDraft(current => ({
                      ...current,
                      employmentStatus:
                        value as typeof current.employmentStatus,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">在职</SelectItem>
                    <SelectItem value="suspended">已停用</SelectItem>
                    <SelectItem value="left">已离职</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-1 text-sm">
                入职日期
                <Input
                  type="date"
                  value={draft.joinedAt}
                  onChange={event =>
                    setDraft(current => ({
                      ...current,
                      joinedAt: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                计薪口径
                <Select
                  value={draft.salaryBasis}
                  onValueChange={value =>
                    setDraft(current => ({
                      ...current,
                      salaryBasis: value as typeof current.salaryBasis,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">月薪</SelectItem>
                    <SelectItem value="daily">日薪</SelectItem>
                    <SelectItem value="hourly">时薪</SelectItem>
                    <SelectItem value="piecework">计件</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-1 text-sm">
                基础薪资 / 单价
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.baseSalary}
                  onChange={event =>
                    setDraft(current => ({
                      ...current,
                      baseSalary: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1 text-sm sm:col-span-2">
                备注
                <Input
                  value={draft.remarks}
                  onChange={event =>
                    setDraft(current => ({
                      ...current,
                      remarks: event.target.value,
                    }))
                  }
                />
              </label>
              <div className="flex justify-end gap-2 sm:col-span-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(false)}
                >
                  取消
                </Button>
                <Button type="submit" disabled={saveProfile.isPending}>
                  {saveProfile.isPending ? "正在保存…" : "保存员工档案"}
                </Button>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
