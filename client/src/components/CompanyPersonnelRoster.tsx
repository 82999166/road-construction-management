import { useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  /** 花名册展示类别由服务端根据资源绑定、劳务实名类别派生，不回写员工档案原始类型。 */
  rosterCategory:
    | "company_admin"
    | "machine_driver"
    | "dump_truck_driver"
    | "labor_team_worker"
    | "temporary_worker";
  /** 同一账号可兼任机械司机、渣土车司机；花名册必须明确展示，不能误归为管理人员。 */
  roleSources: Array<
    | "company_admin"
    | "machine_driver"
    | "dump_truck_driver"
    | "labor_team_worker"
    | "temporary_worker"
  >;
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
  bankName?: string | null;
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
  | CompanyPersonnelRosterRow["rosterCategory"];
type EmploymentStatusFilter =
  | "all"
  | CompanyPersonnelRosterRow["employmentStatus"];

function getRosterCategoryLabel(
  category: CompanyPersonnelRosterRow["rosterCategory"]
) {
  if (category === "dump_truck_driver") return "渣土车司机";
  if (category === "machine_driver") return "机械司机";
  if (category === "labor_team_worker") return "劳务队工人";
  if (category === "temporary_worker") return "临时工";
  return "公司管理员";
}

function getPersonnelTypeLabel(row: CompanyPersonnelRosterRow) {
  return getRosterCategoryLabel(row.rosterCategory);
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
  const [payrollPeriod, setPayrollPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [draft, setDraft] = useState({
    teamName: "",
    tradeName: "",
    projectId: "",
    employmentStatus: "active" as "active" | "suspended" | "left",
    joinedAt: "",
    salaryBasis: "monthly" as "monthly" | "daily" | "hourly" | "piecework",
    baseSalary: "",
    phoneNumber: "",
    clearPhoneNumber: false,
    bankAccount: "",
    bankName: "",
    remarks: "",
  });
  const [advanceDraft, setAdvanceDraft] = useState({ advanceDate: new Date().toISOString().slice(0, 10), amount: "", remarks: "" });
  const saveProfile = trpc.admin.employee.saveProfile.useMutation({
    onSuccess: async () => {
      toast.success("员工档案已保存");
      setEditing(false);
      await onSaved?.();
    },
    onError: error => toast.error(error.message || "员工档案保存失败"),
  });
  const compensationQuery = trpc.admin.employee.compensationDetails.useQuery(
    { employeeProfileId: selectedRow?.profileId ?? 0, period: payrollPeriod },
    { enabled: Boolean(selectedRow?.profileId) }
  );
  const payrollScheduleQuery = trpc.admin.employee.getPayrollGenerationSchedule.useQuery();
  const generatePayrollDraft = trpc.admin.employee.generatePayrollDraft.useMutation({
    onSuccess: async result => {
      toast.success(result.status === "created" ? "工资草稿已生成，待会计审核和财务发放确认" : "该期间已有工资条，未重复生成");
      await compensationQuery.refetch();
      await onSaved?.();
    },
    onError: error => toast.error(error.message || "工资草稿生成失败"),
  });
  const savePayrollSchedule = trpc.admin.employee.savePayrollGenerationSchedule.useMutation({
    onSuccess: async () => {
      toast.success("每月自动工资草稿设置已保存");
      await payrollScheduleQuery.refetch();
    },
    onError: error => toast.error(error.message || "自动工资草稿设置失败"),
  });
  const saveAdvance = trpc.admin.employee.saveAdvance.useMutation({
    onSuccess: async () => {
      toast.success("工资预支已保存");
      setAdvanceDraft(current => ({ ...current, amount: "", remarks: "" }));
      await compensationQuery.refetch();
    },
    onError: error => toast.error(error.message || "工资预支保存失败"),
  });
  const beginEdit = (row: CompanyPersonnelRosterRow) => {
    setDraft({
      teamName: row.teamName ?? "",
      tradeName: row.tradeName ?? "",
      projectId: row.projectId ? String(row.projectId) : "",
      employmentStatus:
        row.employmentStatus === "pending" ? "active" : row.employmentStatus,
      joinedAt: row.joinedAt ? String(row.joinedAt).slice(0, 10) : "",
      salaryBasis: row.salaryBasis ?? "monthly",
      baseSalary: row.baseSalary == null ? "" : String(row.baseSalary),
      phoneNumber: "",
      clearPhoneNumber: false,
      bankAccount: "",
      bankName: row.bankName ?? "",
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
        type === "all" || row.rosterCategory === type;
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
              汇总公司账号、员工档案和实名制人员，自动去重；不受当前劳务项目筛选限制。花名册按真实车辆、机械绑定及劳务实名类别显示业务身份；员工档案类型不改变账号权限、工资或考勤归属。
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
              <SelectItem value="company_admin">公司管理员</SelectItem>
              <SelectItem value="machine_driver">机械司机</SelectItem>
              <SelectItem value="dump_truck_driver">渣土车司机</SelectItem>
              <SelectItem value="labor_team_worker">劳务队工人</SelectItem>
              <SelectItem value="temporary_worker">临时工</SelectItem>
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
                        {row.roleSources
                          .filter(category => category !== row.rosterCategory)
                          .map(category => (
                            <Badge
                              key={category}
                              variant="outline"
                              className="border-sky-200 bg-sky-50 text-sky-700"
                            >
                              兼任{getRosterCategoryLabel(category)}
                            </Badge>
                          ))}
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
                  <p className="text-xs text-slate-500">业务身份 / 状态</p>
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
                    {selectedRow.bankAccountMasked || "未登记"}{selectedRow.bankName ? ` · ${selectedRow.bankName}` : ""}
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
              <section className="rounded-xl border border-[#c9ded7] bg-[#f8fcfb] p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="font-semibold text-[#203c48]">截至当日工资费用</h3>
                    <p className="mt-1 text-xs text-slate-500">只按已确认/已锁定的考勤预估，不等同发放金额。</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input aria-label="工资核算期间" type="month" className="h-8 w-[142px] bg-white text-xs" value={payrollPeriod} onChange={event => setPayrollPeriod(event.target.value)} />
                    {selectedRow.profileId ? <Button size="sm" variant="outline" disabled={generatePayrollDraft.isPending || !compensationQuery.data?.accrual?.calculable || Boolean(compensationQuery.data?.accrual?.existingPayroll)} onClick={() => generatePayrollDraft.mutate({ employeeProfileId: selectedRow.profileId!, period: payrollPeriod })}>{generatePayrollDraft.isPending ? "生成中…" : "生成工资草稿"}</Button> : null}
                  </div>
                </div>
                {compensationQuery.isLoading ? <p className="mt-3 text-sm text-slate-500">正在按期间核算考勤与工资…</p> : compensationQuery.data?.accrual ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-4">
                    <div className="rounded-lg bg-white p-2.5"><p className="text-xs text-slate-500">入职 / 参与区间</p><p className="mt-1 text-sm font-semibold">{selectedRow.joinedAt ? displayDate(selectedRow.joinedAt) : "未登记"}</p><p className="mt-0.5 text-xs text-slate-500">{compensationQuery.data.accrual.eligibleStartDate ?? "—"} 至 {compensationQuery.data.accrual.eligibleEndDate ?? "—"}</p></div>
                    <div className="rounded-lg bg-white p-2.5"><p className="text-xs text-slate-500">已确认打卡 / 考勤</p><p className="mt-1 text-lg font-semibold">{compensationQuery.data.accrual.confirmedAttendanceDays} 天</p><p className="mt-0.5 text-xs text-slate-500">其中锁定 {compensationQuery.data.accrual.lockedAttendanceDays} 天</p></div>
                    <div className="rounded-lg bg-white p-2.5"><p className="text-xs text-slate-500">截至核算日应发</p><p className="mt-1 text-lg font-semibold text-[#205d4e]">{compensationQuery.data.accrual.payableAmount == null ? "待补全" : `¥${compensationQuery.data.accrual.payableAmount.toFixed(2)}`}</p><p className="mt-0.5 text-xs text-slate-500">截至 {compensationQuery.data.accrual.asOfDate}</p></div>
                    <div className="rounded-lg bg-white p-2.5"><p className="text-xs text-slate-500">已批准预支（提示）</p><p className="mt-1 text-lg font-semibold text-amber-700">¥{compensationQuery.data.accrual.approvedAdvanceAmount.toFixed(2)}</p><p className="mt-0.5 text-xs text-slate-500">不自动扣减，需复核后录入</p></div>
                  </div>
                ) : <p className="mt-3 text-sm text-slate-500">请先关联统一员工档案后核算。</p>}
                {compensationQuery.data?.accrual ? <p className="mt-3 text-xs text-slate-600">{compensationQuery.data.accrual.blockedReason || compensationQuery.data.accrual.calculationLabel}{compensationQuery.data.accrual.existingPayroll ? `；当前期间已有${compensationQuery.data.accrual.existingPayroll.status}工资条，禁止重复生成。` : ""}</p> : null}
                <div className="mt-3 flex flex-col gap-2 border-t border-[#dce7e1] pt-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-slate-500">月度自动草稿：每月 {payrollScheduleQuery.data?.generationDay ?? 1} 日 {String(payrollScheduleQuery.data?.generationHour ?? 9).padStart(2, "0")}:{String(payrollScheduleQuery.data?.generationMinute ?? 5).padStart(2, "0")}（中国标准时间）为上月生成草稿；不会自动审核、扣预支或付款。</p>
                  <Button type="button" size="sm" variant={payrollScheduleQuery.data?.enabled ? "outline" : "default"} disabled={savePayrollSchedule.isPending} onClick={() => savePayrollSchedule.mutate({ enabled: !payrollScheduleQuery.data?.enabled, generationDay: payrollScheduleQuery.data?.generationDay ?? 1, generationHour: payrollScheduleQuery.data?.generationHour ?? 9, generationMinute: payrollScheduleQuery.data?.generationMinute ?? 5 })}>{savePayrollSchedule.isPending ? "正在设置…" : payrollScheduleQuery.data?.enabled ? "停用自动生成" : "启用每月自动生成"}</Button>
                </div>
              </section>
              <section className="rounded-xl border border-[#dce7e1] p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-[#203c48]">工资结算明细与工资预支</h3>
                  <Badge variant="outline">仅超级管理员可维护</Badge>
                </div>
                {compensationQuery.isLoading ? <p className="mt-3 text-sm text-slate-500">正在读取工资台账…</p> : (
                  <div className="mt-3 space-y-3 text-sm">
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="font-medium">工资结算明细</p>
                      {compensationQuery.data?.payroll.length || compensationQuery.data?.dailyWage.length ? (
                        <div className="mt-2 space-y-1 text-xs text-slate-600">
                          {[...(compensationQuery.data?.payroll ?? []).map(item => ({ key: `p${item.id}`, date: item.period, label: "工资条", amount: item.actualAmount, status: item.status })), ...(compensationQuery.data?.dailyWage ?? []).map(item => ({ key: `d${item.id}`, date: String(item.settlementDate), label: "临时日结", amount: item.actualAmount, status: item.status }))].slice(0, 8).map(item => <div key={item.key} className="flex justify-between gap-2"><span>{item.date} · {item.label}</span><span>实发 ¥{item.amount} · {item.status}</span></div>)}
                        </div>
                      ) : <p className="mt-2 text-xs text-slate-500">暂无已关联工资结算记录</p>}
                    </div>
                    <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3">
                      <p className="font-medium text-amber-900">工资预支</p>
                      <div className="mt-2 space-y-1 text-xs text-slate-600">{(compensationQuery.data?.advances ?? []).slice(0, 6).map(item => <div key={item.id} className="flex justify-between gap-2"><span>{String(item.advanceDate)} · {item.status}</span><span>¥{item.amount}</span></div>)}{!compensationQuery.data?.advances.length && <p>暂无预支记录</p>}</div>
                      {selectedRow.profileId ? <div className="mt-3 grid gap-2 sm:grid-cols-[150px_150px_1fr_auto]"><Input type="date" value={advanceDraft.advanceDate} onChange={event => setAdvanceDraft(current => ({ ...current, advanceDate: event.target.value }))} /><Input type="number" min="0.01" step="0.01" placeholder="预支金额" value={advanceDraft.amount} onChange={event => setAdvanceDraft(current => ({ ...current, amount: event.target.value }))} /><Input placeholder="备注" value={advanceDraft.remarks} onChange={event => setAdvanceDraft(current => ({ ...current, remarks: event.target.value }))} /><Button type="button" size="sm" disabled={!advanceDraft.amount || saveAdvance.isPending} onClick={() => saveAdvance.mutate({ employeeProfileId: selectedRow.profileId!, advanceDate: advanceDraft.advanceDate, amount: Number(advanceDraft.amount), status: "draft", remarks: advanceDraft.remarks.trim() || null })}>新增预支</Button></div> : null}
                    </div>
                  </div>
                )}
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
              仅超级管理员可修改；已登记手机号不会回显，输入新号码后将加密保存，详情只显示脱敏号码。
            </DialogDescription>
          </DialogHeader>
          {selectedRow ? (
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={event => {
                event.preventDefault();
                if (!selectedRow.profileId) return;
                if (draft.clearPhoneNumber && !window.confirm("确认清空该员工已登记的手机号吗？此操作将移除该员工的联系方式。")) return;
                saveProfile.mutate({
                  id: selectedRow.profileId,
                  userId: selectedRow.userId,
                  laborWorkerId: selectedRow.laborWorkerId,
                  projectId: draft.projectId ? Number(draft.projectId) : null,
                  employeeType: selectedRow.employeeType,
                  tradeName: draft.tradeName.trim() || null,
                  teamName: draft.teamName.trim() || null,
                  employmentStatus: draft.employmentStatus,
                  joinedAt: draft.joinedAt || null,
                  leftAt: null,
                  salaryBasis: draft.salaryBasis,
                  baseSalary: draft.baseSalary
                    ? Number(draft.baseSalary)
                    : null,
                  phoneNumber: draft.clearPhoneNumber
                    ? null
                    : draft.phoneNumber.trim() || undefined,
                  bankAccount: draft.bankAccount.trim() || undefined,
                  bankName: draft.bankName.trim() || null,
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
                工种
                <Input value={draft.tradeName} onChange={event => setDraft(current => ({ ...current, tradeName: event.target.value }))} placeholder="如：测量员、挖机司机" />
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
              <label className="grid gap-1 text-sm">
                手机号（新增或修改）
                <Input
                  inputMode="tel"
                  autoComplete="off"
                  value={draft.phoneNumber}
                  disabled={draft.clearPhoneNumber}
                  onChange={event =>
                    setDraft(current => ({
                      ...current,
                      phoneNumber: event.target.value,
                    }))
                  }
                  placeholder="请输入手机号"
                />
                {selectedRow.contactPhoneMasked ? (
                  <label className="mt-1 flex items-center gap-2 text-xs text-rose-700">
                    <Checkbox
                      checked={draft.clearPhoneNumber}
                      onCheckedChange={checked =>
                        setDraft(current => ({
                          ...current,
                          clearPhoneNumber: Boolean(checked),
                          phoneNumber: checked ? "" : current.phoneNumber,
                        }))
                      }
                    />
                    清空当前已登记手机号（保存时二次确认）
                  </label>
                ) : null}
              </label>
              <label className="grid gap-1 text-sm">
                银行卡号（新增或修改）
                <Input inputMode="numeric" autoComplete="off" value={draft.bankAccount} onChange={event => setDraft(current => ({ ...current, bankAccount: event.target.value }))} placeholder="请输入银行卡号" />
              </label>
              <label className="grid gap-1 text-sm">
                开户行
                <Input value={draft.bankName} onChange={event => setDraft(current => ({ ...current, bankName: event.target.value }))} placeholder="如：中国建设银行" />
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
