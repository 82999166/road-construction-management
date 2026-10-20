import { useMemo, useState } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type CompanyPersonnelRosterRow = {
  id: string;
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
};

type Props = {
  rows: CompanyPersonnelRosterRow[];
  loading: boolean;
  hasError: boolean;
  onRetry: () => void;
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
  displayDate,
}: Props) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState<PersonnelTypeFilter>("all");
  const [status, setStatus] = useState<EmploymentStatusFilter>("all");
  const [projectId, setProjectId] = useState("all");

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
          <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
            {visibleRows.map(row => (
              <div
                key={row.id}
                className="rounded-xl border border-[#e1e8e4] bg-white px-3 py-2.5 transition-colors hover:border-[#bcd4cb] hover:bg-[#fbfdfc]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-[#203c48]">
                    {row.displayName}
                  </p>
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
                <p className="mt-2 text-xs text-slate-600">
                  项目：{row.projectName || "未分配项目"} · 班组：
                  {row.teamName || "未分配班组"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  入职：{row.joinedAt ? displayDate(row.joinedAt) : "未登记"} ·
                  计薪：{getSalaryBasisLabel(row.salaryBasis)}
                  {row.profileComplete ? "" : " · 待补充员工档案"}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-7 text-center text-sm text-slate-500">
            当前筛选条件下暂无人员。可切换人员类型、在职状态或项目查看。
          </p>
        )}
      </CardContent>
    </Card>
  );
}
