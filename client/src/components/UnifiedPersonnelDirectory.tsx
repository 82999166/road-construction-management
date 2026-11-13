import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertCircle,
  ArrowUpRight,
  Download,
  FileText,
  Loader2,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { ProtectedImagePreview } from "@/components/ProtectedImagePreview";
import { PersonnelInsuranceEditor } from "@/components/PersonnelInsuranceEditor";
import { getBusinessStatusLabel } from "@/components/BusinessStatusBadge";
import { escapePrintHtml, openA4PrintDocument } from "@/lib/a4Print";
import {
  affiliationLabels,
  employmentStatusLabels,
  positionCategoryLabels,
  salaryBasisLabels,
  documentTypeLabels,
  PERSONNEL_AFFILIATIONS,
  PERSONNEL_STATUSES,
  PERSONNEL_POSITION_CATEGORIES,
  PERSONNEL_DOCUMENT_TYPES,
  PERSONNEL_SALARY_BASES,
  type PersonnelAffiliation,
  type PersonnelPositionCategory,
  type PersonnelDocumentType,
} from "@shared/personnel";
import {
  buildPersonnelSave,
  chinaToday,
  dateInput,
  friendlyPersonnelError,
  newPersonnelDraft,
  personnelCsv,
  salaryChanged,
  sensitiveClearLabels,
  type PersonnelDraft,
} from "./UnifiedPersonnelDirectory.helpers";

type Outputs = inferRouterOutputs<AppRouter>["personnel"];
type PersonDetail = Outputs["detail"];
type Options = Outputs["options"];
type Person = PersonDetail["person"];
export type UnifiedPersonnelDirectoryProps = {
  displayDate?: (value: Date | string) => string;
  onSaved?: () => void | Promise<void>;
  initialCreateKey?: number;
  openCreateSignal?: number;
  initialProjectId?: number;
  initialAffiliation?: PersonnelAffiliation;
  openLegacySource?: PersonnelLegacySource;
  defaultAffiliation?: PersonnelAffiliation;
};
const QUERY_OPTIONS = { retry: false, refetchOnWindowFocus: false } as const;
const insuranceLabels = {
  none: "无保险记录",
  active: "有效",
  expiring: "30天内到期",
  expired: "已过期",
} as const;
const EMPTY_FILTERS = {
  search: "",
  affiliation: "",
  positionId: "",
  projectId: "",
  teamId: "",
  status: "",
};
const DETAIL_TABS = [
  ["basic", "基础资料"],
  ["assignment", "岗位归属"],
  ["salary", "薪资"],
  ["attendance", "考勤"],
  ["compensation", "工资结算"],
  ["resources", "车辆机械"],
  ["documents", "证照保险"],
  ["changes", "收款变更"],
] as const;
const defaultDisplayDate = (value: Date | string) => dateInput(value) || "—";
const money = (value: string | number | null | undefined) =>
  value == null
    ? "—"
    : `¥${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const optionClass =
  "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring";
function Picker({
  value,
  onChange,
  label,
  children,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label={label}
      className={optionClass}
      value={value}
      disabled={disabled}
      onChange={event => onChange(event.target.value)}
    >
      {children}
    </select>
  );
}
function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label
      className={`grid min-w-0 gap-1.5 text-xs font-medium text-slate-600 ${wide ? "sm:col-span-2" : ""}`}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-center text-xs text-slate-500">
      {children}
    </p>
  );
}
function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 text-xs leading-5 text-emerald-900">
      <ShieldCheck className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
function Failure({
  error,
  onRetry,
}: {
  error: { message: string };
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800"
    >
      <span className="flex items-center gap-2">
        <AlertCircle className="size-4 shrink-0" />
        {error.message || "读取失败，请重试"}
      </span>
      <Button size="sm" variant="outline" onClick={onRetry}>
        重新读取
      </Button>
    </div>
  );
}
function Loading({ label = "正在读取真实人员资料…" }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"
    >
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}
function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-5 gap-y-4 lg:grid-cols-4">
      {items.map(([label, value]) => (
        <div className="min-w-0" key={label}>
          <dt className="text-[11px] text-slate-500">{label}</dt>
          <dd className="mt-1 break-words text-xs font-medium text-slate-800">
            {value || "未登记"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
function Ledger({
  headers,
  rows,
  empty = "暂无已关联记录",
}: {
  headers: string[];
  rows: ReactNode[][];
  empty?: string;
}) {
  return rows.length ? (
    <div className="max-w-full overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            {headers.map(head => (
              <th
                key={head}
                className="whitespace-nowrap px-3 py-2 font-medium"
              >
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-slate-100">
              {row.map((cell, col) => (
                <td key={col} className="px-3 py-2 align-top">
                  {cell ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty>{empty}</Empty>
  );
}

function draftFromPerson(person: Person): PersonnelDraft {
  return {
    ...newPersonnelDraft(person.affiliation),
    name: person.name,
    employmentStatus: person.employmentStatus,
    primaryPositionId: person.primaryPositionId
      ? String(person.primaryPositionId)
      : "",
    secondaryPositionIds: person.secondaryPositionIds ?? [],
    projectId: person.projectId ? String(person.projectId) : "",
    teamId: person.teamId ? String(person.teamId) : "",
    userId: person.userId ? String(person.userId) : "",
    entryDate: dateInput(person.entryDate),
    exitDate: dateInput(person.exitDate),
    gender: person.gender ?? "unspecified",
    birthDate: dateInput(person.birthDate),
    address: person.address ?? "",
    emergencyContactName: person.emergencyContactName ?? "",
    emergencyContactPhone: "",
    remarks: person.remarks ?? "",
    payrollEnabled: person.payrollEnabled,
    bankName: person.bankName ?? "",
    salaryBasis: person.salaryBasis ?? "monthly",
    baseSalary: person.baseSalary == null ? "" : String(person.baseSalary),
    phoneNumber: "",
    identityNo: "",
    bankAccount: "",
    clearPhoneNumber: false,
    clearIdentityNo: false,
    clearBankAccount: false,
  };
}

export default function UnifiedPersonnelDirectory({
  displayDate = defaultDisplayDate,
  onSaved,
  initialCreateKey,
  openCreateSignal,
  initialProjectId,
  initialAffiliation,
  openLegacySource,
  defaultAffiliation = "company",
}: UnifiedPersonnelDirectoryProps) {
  const utils = trpc.useUtils();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [insuranceFilter, setInsuranceFilter] = useState("");
  const [personId, setPersonId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [legacyFocus, setLegacyFocus] = useState<PersonnelLegacySource>();
  const previousLegacyKey = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (
      openLegacySource &&
      openLegacySource.requestKey !== previousLegacyKey.current
    ) {
      setLegacyFocus(openLegacySource);
      setLegacyOpen(true);
      previousLegacyKey.current = openLegacySource.requestKey;
    }
  }, [openLegacySource]);
  const [draft, setDraft] = useState(() =>
    newPersonnelDraft(defaultAffiliation)
  );
  const [createError, setCreateError] = useState("");
  const createSignal = openCreateSignal ?? initialCreateKey;
  const previousCreateKey = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (createSignal && previousCreateKey.current !== createSignal) {
      setDraft({
        ...newPersonnelDraft(initialAffiliation ?? defaultAffiliation),
        projectId: initialProjectId ? String(initialProjectId) : "",
      });
      setCreateError("");
      setCreateOpen(true);
    }
    previousCreateKey.current = createSignal;
  }, [createSignal, defaultAffiliation, initialAffiliation, initialProjectId]);
  const filterInput = useMemo(
    () => ({
      search: filters.search.trim() || undefined,
      affiliation: filters.affiliation
        ? (filters.affiliation as PersonnelAffiliation)
        : undefined,
      positionId: filters.positionId ? Number(filters.positionId) : undefined,
      projectId: filters.projectId ? Number(filters.projectId) : undefined,
      teamId: filters.teamId ? Number(filters.teamId) : undefined,
      status: filters.status
        ? (filters.status as (typeof PERSONNEL_STATUSES)[number])
        : undefined,
    }),
    [filters]
  );
  const options = trpc.personnel.options.useQuery(undefined, QUERY_OPTIONS);
  const list = trpc.personnel.list.useQuery(filterInput, QUERY_OPTIONS);
  const refresh = async () => {
    await Promise.all([
      utils.personnel.list.invalidate(),
      utils.personnel.detail.invalidate(),
      utils.personnel.options.invalidate(),
    ]);
    await onSaved?.();
  };
  const create = trpc.personnel.save.useMutation({
    onSuccess: async result => {
      setCreateOpen(false);
      setPersonId(result.id);
      toast.success("人员已建档；未创建登录账号或分配权限");
      await refresh();
    },
    onError: error => setCreateError(friendlyPersonnelError(error)),
  });
  const setFilter = (key: keyof typeof filters, value: string) =>
    setFilters(current => ({ ...current, [key]: value }));
  const rows = useMemo(
    () =>
      list.data?.filter(
        row => !insuranceFilter || row.insuranceStatus === insuranceFilter
      ),
    [list.data, insuranceFilter]
  );
  const exportHeaders = [
    "人员编号",
    "姓名",
    "用工归属",
    "主要岗位",
    "兼任岗位",
    "项目",
    "施工队",
    "状态",
    "入职日期",
    "公司发薪",
    "计薪口径",
    "保险状态",
    "历史重复员工档案数",
  ];
  const exportRows = () =>
    (rows ?? []).map(row => [
      row.personNo,
      row.name,
      affiliationLabels[row.affiliation],
      row.positionName || "未设置",
      row.secondaryPositionNames.join(" / "),
      row.projectName || "未分配",
      row.teamName || "未分配",
      employmentStatusLabels[row.employmentStatus],
      row.entryDate ? displayDate(row.entryDate) : "",
      row.payrollEnabled ? "是" : "否",
      row.salaryBasis ? salaryBasisLabels[row.salaryBasis] : "未设置",
      insuranceLabels[row.insuranceStatus],
      row.historicalDuplicateProfileCount,
    ]);
  const exportCsv = () => {
    const url = URL.createObjectURL(
      new Blob([personnelCsv(exportHeaders, exportRows())], {
        type: "text/csv;charset=utf-8",
      })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `人员档案-${chinaToday()}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const print = () => {
    try {
      openA4PrintDocument({
        title: "人员档案 · 当前筛选",
        bodyHtml: `<h1>人员档案 · 当前筛选</h1><p class="sub">日期：${escapePrintHtml(chinaToday())}　共 ${rows?.length ?? 0} 人　不含完整电话、证件、银行卡及账号凭据</p><hr class="rule"><table><thead><tr>${exportHeaders.map(head => `<th>${escapePrintHtml(head)}</th>`).join("")}</tr></thead><tbody>${exportRows()
          .map(
            row =>
              `<tr>${row.map(cell => `<td>${escapePrintHtml(cell)}</td>`).join("")}</tr>`
          )
          .join("")}</tbody></table>`,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "打印失败");
    }
  };
  return (
    <div className="min-w-0 space-y-3 text-slate-800">
      <section className="overflow-hidden rounded-xl border border-emerald-100 bg-white shadow-sm">
        <header className="space-y-3 border-b border-emerald-100 bg-gradient-to-br from-emerald-50/70 to-slate-50 p-3 sm:p-4">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
            <div>
              <p className="text-[10px] font-semibold tracking-widest text-emerald-700">
                人员管理 / 统一主档
              </p>
              <h2 className="mt-1 flex items-center gap-2 text-base font-bold">
                <UsersRound className="size-5 text-emerald-700" />
                人员档案
                <Badge
                  variant="secondary"
                  className="bg-white text-emerald-800"
                >
                  {list.isSuccess ? `${rows?.length ?? 0} 人` : "待读取"}
                </Badge>
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                一人一档，统一维护管理人员、司机、操作员、施工队与临时工；手机号不要求开账号。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 bg-white text-xs"
                onClick={() => {
                  setLegacyFocus(undefined);
                  setLegacyOpen(true);
                }}
              >
                引入历史人员
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 bg-white text-xs"
                onClick={() => setDictionaryOpen(true)}
              >
                <Settings2 className="size-3.5" />
                岗位 / 施工队
              </Button>
              <Button
                size="sm"
                className="h-8 bg-emerald-700 text-xs hover:bg-emerald-800"
                disabled={!options.data}
                onClick={() => {
                  setDraft(newPersonnelDraft(defaultAffiliation));
                  setCreateError("");
                  setCreateOpen(true);
                }}
              >
                <Plus className="size-3.5" />
                新增人员
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-[minmax(180px,1.5fr)_repeat(5,minmax(110px,1fr))]">
            <div className="relative col-span-2 sm:col-span-3 xl:col-span-1">
              <Search className="absolute left-2.5 top-2.5 size-4 text-slate-400" />
              <Input
                aria-label="搜索人员"
                placeholder="搜索姓名或人员编号"
                className="h-9 bg-white pl-8 text-xs"
                value={filters.search}
                onChange={event => setFilter("search", event.target.value)}
              />
            </div>
            <Picker
              label="筛选用工归属"
              value={filters.affiliation}
              onChange={value => setFilter("affiliation", value)}
            >
              <option value="">全部用工归属</option>
              {PERSONNEL_AFFILIATIONS.map(value => (
                <option key={value} value={value}>
                  {affiliationLabels[value]}
                </option>
              ))}
            </Picker>
            <Picker
              label="筛选岗位"
              value={filters.positionId}
              onChange={value => setFilter("positionId", value)}
            >
              <option value="">全部岗位（含兼任）</option>
              {options.data?.positions.map(item => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Picker>
            <Picker
              label="筛选项目"
              value={filters.projectId}
              onChange={value => setFilter("projectId", value)}
            >
              <option value="">全部项目</option>
              {options.data?.projects.map(item => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Picker>
            <Picker
              label="筛选施工队"
              value={filters.teamId}
              onChange={value => setFilter("teamId", value)}
            >
              <option value="">全部施工队</option>
              {options.data?.teams.map(item => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Picker>
            <Picker
              label="筛选在职状态"
              value={filters.status}
              onChange={value => setFilter("status", value)}
            >
              <option value="">全部状态</option>
              {PERSONNEL_STATUSES.map(value => (
                <option key={value} value={value}>
                  {employmentStatusLabels[value]}
                </option>
              ))}
            </Picker>
          </div>
        </header>
        <div className="space-y-3 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-slate-500">
              列表与导出均按当前筛选 · 历史来源档案不按姓名猜测合并
            </p>
            <div className="flex flex-wrap items-center gap-1">
              <div className="w-36">
                <Picker
                  label="筛选保险状态"
                  value={insuranceFilter}
                  onChange={setInsuranceFilter}
                >
                  <option value="">全部保险状态</option>
                  {Object.entries(insuranceLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Picker>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  setInsuranceFilter("");
                }}
              >
                重置筛选
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={!list.isSuccess || !rows?.length}
                onClick={exportCsv}
              >
                <Download className="size-3" />
                CSV
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={!list.isSuccess || !rows?.length}
                onClick={print}
              >
                <Printer className="size-3" />
                A4打印
              </Button>
              <Button
                aria-label="刷新人员目录"
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                disabled={list.isFetching}
                onClick={() => void list.refetch()}
              >
                <RefreshCw
                  className={`size-3.5 ${list.isFetching ? "animate-spin" : ""}`}
                />
              </Button>
            </div>
          </div>
          {options.error && (
            <Failure
              error={options.error}
              onRetry={() => void options.refetch()}
            />
          )}
          {list.isLoading ? (
            <Loading />
          ) : list.error ? (
            <Failure error={list.error} onRetry={() => void list.refetch()} />
          ) : !rows?.length ? (
            <Empty>
              当前筛选下暂无人员。可重置筛选、新增人员，或按真实来源 ID
              引入历史档案。
            </Empty>
          ) : (
            <div className="max-w-full overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[900px] text-left text-xs">
                <thead className="bg-slate-50 text-[11px] text-slate-500">
                  <tr>
                    {[
                      "姓名 / 编号",
                      "用工归属",
                      "岗位 / 兼任",
                      "项目 / 施工队",
                      "联系方式",
                      "入职 / 状态",
                      "工资主体",
                      "操作",
                    ].map(head => (
                      <th key={head} className="px-3 py-2.5 font-medium">
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr
                      key={row.id}
                      className="border-t border-slate-100 hover:bg-emerald-50/30"
                    >
                      <td className="px-3 py-2.5">
                        <button
                          className="text-left font-semibold text-emerald-800 hover:underline"
                          onClick={() => setPersonId(row.id)}
                        >
                          {row.name}
                        </button>
                        <p className="mt-0.5 text-[10px] text-slate-400">
                          {row.personNo}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        {affiliationLabels[row.affiliation]}
                      </td>
                      <td className="max-w-[210px] px-3 py-2.5">
                        <p>{row.positionName || "未设置岗位"}</p>
                        {row.secondaryPositionNames.length > 0 && (
                          <p className="mt-1 text-[10px] text-slate-500">
                            兼任：{row.secondaryPositionNames.join("、")}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <p>{row.projectName || "未分配项目"}</p>
                        <p className="mt-0.5 text-[10px] text-slate-500">
                          {row.teamName || "未分配施工队"}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-slate-500">
                        {row.phoneMasked || "未登记"}
                      </td>
                      <td className="px-3 py-2.5">
                        <p>
                          {row.entryDate
                            ? displayDate(row.entryDate)
                            : "未登记"}
                        </p>
                        <Badge
                          variant="outline"
                          className={`mt-1 text-[10px] ${row.employmentStatus === "active" ? "border-emerald-100 text-emerald-700" : "text-slate-500"}`}
                        >
                          {employmentStatusLabels[row.employmentStatus]}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5">
                        <p>
                          {row.payrollEnabled ? "公司发薪" : "不由公司发薪"}
                        </p>
                        <p className="mt-0.5 text-[10px] text-slate-500">
                          {row.payrollEnabled && row.salaryBasis
                            ? salaryBasisLabels[row.salaryBasis]
                            : "独立业务结算"}{" "}
                          · {insuranceLabels[row.insuranceStatus]}
                          {row.historicalDuplicateProfileCount > 0
                            ? ` · 历史重复档案 ${row.historicalDuplicateProfileCount} 份`
                            : ""}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-emerald-800"
                          onClick={() => setPersonId(row.id)}
                        >
                          详情
                          <ArrowUpRight className="size-3" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      <Dialog
        open={createOpen}
        onOpenChange={open => {
          if (!create.isPending) setCreateOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle>新增人员 · 统一建档</DialogTitle>
            <DialogDescription>
              可新增任意人员。账号可选；关联已有账号只链接身份，不创建账号、不授予权限。
            </DialogDescription>
          </DialogHeader>
          {options.isLoading ? (
            <Loading />
          ) : options.error ? (
            <Failure
              error={options.error}
              onRetry={() => void options.refetch()}
            />
          ) : (
            options.data && (
              <PersonnelForm
                draft={draft}
                setDraft={setDraft}
                options={options.data}
                error={createError}
                pending={create.isPending}
                onCancel={() => setCreateOpen(false)}
                onSubmit={() => {
                  setCreateError("");
                  if (draft.payrollEnabled && !draft.baseSalary) {
                    setCreateError(
                      "请填写公司发薪人员的基础工资 / 单价；暂不发薪可取消公司发薪。"
                    );
                    return;
                  }
                  create.mutate(buildPersonnelSave(draft));
                }}
              />
            )
          )}
        </DialogContent>
      </Dialog>
      {personId != null && (
        <PersonnelDetail
          personId={personId}
          displayDate={displayDate}
          options={options.data}
          onClose={() => setPersonId(null)}
          onSaved={refresh}
        />
      )}
      {dictionaryOpen && (
        <PersonnelDictionaries
          options={options.data}
          onClose={() => setDictionaryOpen(false)}
          onSaved={refresh}
        />
      )}
      {legacyOpen && (
        <LegacyPersonnelAdoption
          focusSource={legacyFocus}
          onClose={() => setLegacyOpen(false)}
          onSaved={async id => {
            setLegacyOpen(false);
            setPersonId(id);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function PersonnelForm({
  draft,
  setDraft,
  options,
  original,
  error,
  pending,
  onSubmit,
  onCancel,
  onReload,
}: {
  draft: PersonnelDraft;
  setDraft: (draft: PersonnelDraft) => void;
  options: Options;
  original?: PersonnelDraft;
  error: string;
  pending: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  onReload?: () => void;
}) {
  const update = <K extends keyof PersonnelDraft>(
    key: K,
    value: PersonnelDraft[K]
  ) => setDraft({ ...draft, [key]: value });
  const text = (
    key: keyof PersonnelDraft,
    label: string,
    type = "text",
    placeholder?: string
  ) => (
    <Field label={label}>
      <Input
        className="h-9 text-xs"
        type={type}
        value={String(draft[key])}
        placeholder={placeholder}
        onChange={event => setDraft({ ...draft, [key]: event.target.value })}
      />
    </Field>
  );
  return (
    <form
      className="space-y-4"
      onSubmit={event => {
        event.preventDefault();
        const clears = sensitiveClearLabels(draft);
        if (
          clears &&
          !window.confirm(
            `确认清空已登记的${clears}吗？保存后将移除这些资料，不能通过本页面恢复。`
          )
        )
          return;
        onSubmit();
      }}
    >
      <Note>
        录入人员不等于开通账号，手机号不强制开账号。外部人员默认不由公司发薪；外部运费不是人员工资，机械租金不是操作员工资。
      </Note>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="基础资料">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="姓名 *">
              <Input
                className="h-9 text-xs"
                required
                maxLength={128}
                value={draft.name}
                onChange={event => update("name", event.target.value)}
              />
            </Field>
            <Field label="在职状态">
              <Picker
                label="在职状态"
                value={draft.employmentStatus}
                onChange={value =>
                  update(
                    "employmentStatus",
                    value as PersonnelDraft["employmentStatus"]
                  )
                }
              >
                {PERSONNEL_STATUSES.map(value => (
                  <option key={value} value={value}>
                    {employmentStatusLabels[value]}
                  </option>
                ))}
              </Picker>
            </Field>
            {text("entryDate", "入职 / 进场日期", "date")}
            {text("exitDate", "离职 / 退场日期", "date")}
            <Field label="性别">
              <Picker
                label="性别"
                value={draft.gender}
                onChange={value =>
                  update("gender", value as PersonnelDraft["gender"])
                }
              >
                <option value="unspecified">未指定</option>
                <option value="male">男</option>
                <option value="female">女</option>
              </Picker>
            </Field>
            {text("birthDate", "出生日期", "date")}
            {text("address", "联系地址")}
            {text("emergencyContactName", "紧急联系人")}
            {text("emergencyContactPhone", "紧急联系电话（留空保留）", "tel")}
            {text("remarks", "档案备注")}
          </div>
        </Section>
        <Section title="岗位与用工归属">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="用工归属 *">
              <Picker
                label="用工归属"
                value={draft.affiliation}
                onChange={value => {
                  const affiliation = value as PersonnelAffiliation;
                  setDraft({
                    ...draft,
                    affiliation,
                    payrollEnabled:
                      affiliation === "external" ? false : draft.payrollEnabled,
                    salaryBasis:
                      affiliation === "temporary" &&
                      draft.salaryBasis === "monthly"
                        ? "daily"
                        : draft.salaryBasis,
                  });
                }}
              >
                {PERSONNEL_AFFILIATIONS.map(value => (
                  <option key={value} value={value}>
                    {affiliationLabels[value]}
                  </option>
                ))}
              </Picker>
            </Field>
            <Field label="主要岗位">
              <Picker
                label="主要岗位"
                value={draft.primaryPositionId}
                onChange={value =>
                  setDraft({
                    ...draft,
                    primaryPositionId: value,
                    secondaryPositionIds: draft.secondaryPositionIds.filter(
                      id => id !== Number(value)
                    ),
                  })
                }
              >
                <option value="">暂不设置</option>
                {options.positions
                  .filter(
                    item =>
                      item.status !== "disabled" ||
                      String(item.id) === draft.primaryPositionId
                  )
                  .map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.status === "disabled" ? "（已停用）" : ""}
                    </option>
                  ))}
              </Picker>
            </Field>
            <Field label="所属项目">
              <Picker
                label="所属项目"
                value={draft.projectId}
                onChange={value =>
                  setDraft({ ...draft, projectId: value, teamId: "" })
                }
              >
                <option value="">未分配项目</option>
                {options.projects.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Picker>
            </Field>
            <Field label="施工队">
              <Picker
                label="施工队"
                value={draft.teamId}
                onChange={value => update("teamId", value)}
              >
                <option value="">未分配施工队</option>
                {options.teams
                  .filter(
                    item =>
                      item.status !== "disabled" ||
                      String(item.id) === draft.teamId
                  )
                  .filter(
                    item =>
                      !draft.projectId ||
                      item.projectId === Number(draft.projectId) ||
                      String(item.id) === draft.teamId
                  )
                  .map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </Picker>
            </Field>
            <div className="sm:col-span-2">
              <p className="mb-2 text-xs font-medium text-slate-600">
                兼任岗位（可多选）
              </p>
              <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto rounded-md border bg-slate-50 p-2">
                {options.positions
                  .filter(
                    item =>
                      item.id !== Number(draft.primaryPositionId) &&
                      (item.status !== "disabled" ||
                        draft.secondaryPositionIds.includes(item.id))
                  )
                  .map(item => (
                    <label
                      key={item.id}
                      className="flex items-center gap-1.5 rounded bg-white px-2 py-1 text-[11px]"
                    >
                      <input
                        type="checkbox"
                        checked={draft.secondaryPositionIds.includes(item.id)}
                        onChange={event =>
                          update(
                            "secondaryPositionIds",
                            event.target.checked
                              ? [...draft.secondaryPositionIds, item.id]
                              : draft.secondaryPositionIds.filter(
                                  id => id !== item.id
                                )
                          )
                        }
                      />
                      {item.name}
                    </label>
                  ))}
              </div>
            </div>
            <Field wide label="关联已有账号（可选，不改变账号权限）">
              <Picker
                label="关联已有账号"
                value={draft.userId}
                onChange={value => update("userId", value)}
              >
                <option value="">不关联账号 · 无账号也能建档</option>
                {options.users.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name || "未命名账号"} · ID {item.id}
                  </option>
                ))}
              </Picker>
            </Field>
          </div>
        </Section>
        <Section title="薪资设置 · 生效版本">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.payrollEnabled}
              disabled={draft.affiliation === "external"}
              onChange={event => update("payrollEnabled", event.target.checked)}
            />
            由公司发薪（仅控制工资主体，不授予权限）
          </label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="计薪口径">
              <Picker
                label="计薪口径"
                value={draft.salaryBasis}
                onChange={value =>
                  update("salaryBasis", value as PersonnelDraft["salaryBasis"])
                }
              >
                {PERSONNEL_SALARY_BASES.map(value => (
                  <option
                    key={value}
                    value={value}
                    disabled={
                      draft.affiliation === "temporary" && value === "monthly"
                    }
                  >
                    {salaryBasisLabels[value]}
                  </option>
                ))}
              </Picker>
            </Field>
            <Field label="基础工资 / 单价（元）">
              <Input
                className="h-9 text-xs"
                type="number"
                min="0"
                max="999999999999"
                step="0.01"
                value={draft.baseSalary}
                onChange={event => update("baseSalary", event.target.value)}
              />
            </Field>
            <Field wide label="工资生效日期（变更薪资时必填）">
              <Input
                className="h-9 text-xs"
                type="date"
                required={salaryChanged(draft, original)}
                value={draft.salaryEffectiveFrom}
                onChange={event =>
                  update("salaryEffectiveFrom", event.target.value)
                }
              />
            </Field>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-slate-500">
            工资变更新增生效版本，不覆盖历史。已核定、已付款金额不能直接修改；临时工通过现有日结流程，不能重复生成月薪。
          </p>
        </Section>
        <Section title="联系与收款 · 安全维护">
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["phoneNumber", "clearPhoneNumber", "手机号（新增或替换）"],
                ["identityNo", "clearIdentityNo", "证件号（新增或替换）"],
                ["bankAccount", "clearBankAccount", "银行卡（新增或替换）"],
              ] as const
            ).map(([key, clear, label]) => (
              <div key={key} className="min-w-0">
                <Field label={label}>
                  <Input
                    className="h-9 text-xs"
                    autoComplete="off"
                    type={key === "phoneNumber" ? "tel" : "password"}
                    disabled={draft[clear]}
                    value={draft[key]}
                    placeholder={
                      original ? "留空保留，不回显原值" : "可暂不登记"
                    }
                    onChange={event => update(key, event.target.value)}
                  />
                </Field>
                {original && (
                  <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-rose-700">
                    <input
                      type="checkbox"
                      checked={draft[clear]}
                      onChange={event =>
                        setDraft({
                          ...draft,
                          [clear]: event.target.checked,
                          [key]: "",
                        })
                      }
                    />
                    明确清空已登记资料
                  </label>
                )}
              </div>
            ))}
            {text("bankName", "开户行")}
          </div>
          <p className="mt-3 text-[11px] leading-5 text-slate-500">
            手机号、证件、银行卡默认不回显；留空保持原值。勾选清空后仍需二次确认，操作留安全变更记录。
          </p>
        </Section>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800"
        >
          {error}
          {onReload && (
            <Button
              type="button"
              className="ml-2 h-7 text-xs"
              size="sm"
              variant="outline"
              onClick={onReload}
            >
              重新读取最新档案
            </Button>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2 border-t pt-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={onCancel}
        >
          取消
        </Button>
        <Button
          type="submit"
          size="sm"
          className="bg-emerald-700 hover:bg-emerald-800"
          disabled={pending || !draft.name.trim()}
        >
          {pending ? "正在保存…" : original ? "保存人员变更" : "保存人员档案"}
        </Button>
      </div>
    </form>
  );
}

function PersonnelDetail({
  personId,
  displayDate,
  options,
  onClose,
  onSaved,
}: {
  personId: number;
  displayDate: (value: Date | string) => string;
  options?: Options;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [period, setPeriod] = useState(() => chinaToday().slice(0, 7));
  const [tab, setTab] = useState("basic");
  const [documentIntent, setDocumentIntent] =
    useState<PersonnelDocumentType>("other");
  const input = useMemo(() => ({ personId, period }), [personId, period]);
  const query = trpc.personnel.detail.useQuery(input, QUERY_OPTIONS);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => newPersonnelDraft());
  const [original, setOriginal] = useState<PersonnelDraft>();
  const [editVersion, setEditVersion] = useState<number>();
  const [saveError, setSaveError] = useState("");
  const [legacyOpen, setLegacyOpen] = useState(false);
  const saved = async () => {
    await query.refetch();
    await onSaved();
  };
  const save = trpc.personnel.save.useMutation({
    onSuccess: async () => {
      setEditing(false);
      setSaveError("");
      toast.success("档案变更已保存，历史记录保留");
      await saved();
    },
    onError: error => setSaveError(friendlyPersonnelError(error)),
  });
  const detail = query.data;
  const person = detail?.person;
  const beginEdit = (latest: Person) => {
    const value = draftFromPerson(latest);
    setDraft(value);
    setOriginal(value);
    setEditVersion(latest.version);
    setSaveError("");
    setEditing(true);
  };
  const reloadEdit = async () => {
    if (
      !window.confirm(
        "重新读取将用最新档案替换当前编辑输入。确认已记下需要重新提交的变更吗？"
      )
    )
      return;
    const latest = await query.refetch();
    if (latest.data) beginEdit(latest.data.person);
  };
  const editButton = (
    <Button
      className="h-7 text-xs"
      size="sm"
      variant="outline"
      disabled={!options || !person}
      onClick={() => person && beginEdit(person)}
    >
      修改资料
    </Button>
  );
  return (
    <>
      <Dialog
        open
        onOpenChange={open => {
          if (!open) onClose();
        }}
      >
        <DialogContent className="flex max-h-[94dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl sm:p-0 xl:max-w-7xl">
          <DialogHeader className="shrink-0 space-y-2 border-b bg-gradient-to-r from-emerald-50/80 to-slate-50 px-4 py-4 pr-12 text-left sm:px-5">
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle className="text-base">
                {person?.name ?? "人员档案"}
              </DialogTitle>
              {person && (
                <>
                  <Badge variant="outline" className="bg-white text-[10px]">
                    {person.personNo}
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="bg-emerald-100/70 text-[10px] text-emerald-800"
                  >
                    {affiliationLabels[person.affiliation]} ·{" "}
                    {employmentStatusLabels[person.employmentStatus]}
                  </Badge>
                </>
              )}
            </div>
            <DialogDescription className="text-xs">
              {person
                ? `${person.positionName || "未设置岗位"} · ${person.projectName || "未分配项目"} · ${person.teamName || "未分配施工队"} · 版本 ${person.version}`
                : "正在读取统一主档"}
              。敏感字段不回显；关联账号不授权限。
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto overscroll-contain">
            <div className="p-3 sm:p-4">
              {query.isLoading ? (
                <Loading />
              ) : query.error ? (
                <Failure
                  error={query.error}
                  onRetry={() => void query.refetch()}
                />
              ) : detail && person ? (
                <Tabs
                  value={tab}
                  onValueChange={setTab}
                  className="min-w-0 gap-3"
                >
                  <TabsList className="grid h-auto w-full grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1 lg:grid-cols-8">
                    {DETAIL_TABS.map(([key, label]) => (
                      <TabsTrigger
                        key={key}
                        value={key}
                        className="min-w-0 px-1 py-2 text-[11px] data-[state=active]:text-emerald-800"
                      >
                        {label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  <TabsContent value="basic" className="space-y-3">
                    <Section
                      title="人员照片"
                      action={
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            setDocumentIntent("portrait");
                            setTab("documents");
                          }}
                        >
                          上传 / 更换照片
                        </Button>
                      }
                    >
                      {person.avatarDocumentId ? (
                        <DocumentPreview
                          personId={personId}
                          documentId={person.avatarDocumentId}
                          name={`${person.name} · 人员照片`}
                        />
                      ) : (
                        <p className="text-xs text-slate-500">
                          尚未登记人员照片。照片加密保存，仅获授权管理员可站内预览。
                        </p>
                      )}
                    </Section>
                    <Section title="基础资料" action={editButton}>
                      <Facts
                        items={[
                          ["姓名", person.name],
                          ["手机号", person.phoneMasked],
                          ["证件号", person.identityMasked],
                          [
                            "性别",
                            person.gender === "male"
                              ? "男"
                              : person.gender === "female"
                                ? "女"
                                : "未指定",
                          ],
                          [
                            "入职 / 进场",
                            person.entryDate
                              ? displayDate(person.entryDate)
                              : null,
                          ],
                          [
                            "离职 / 退场",
                            person.exitDate
                              ? displayDate(person.exitDate)
                              : null,
                          ],
                          [
                            "出生日期",
                            person.birthDate
                              ? displayDate(person.birthDate)
                              : null,
                          ],
                          [
                            "关联账号",
                            person.userId
                              ? `已关联 ID ${person.userId}（不改变权限）`
                              : "未关联 · 无账号人员",
                          ],
                          ["联系地址", person.address],
                          ["紧急联系人", person.emergencyContactName],
                          ["紧急电话", person.emergencyContactPhoneMasked],
                          ["备注", person.remarks],
                        ]}
                      />
                    </Section>
                    <Note>
                      所有用工归属使用同一详情维护。人员、登录身份、岗位权限与公司发薪是四件独立的事，不会因为建档自动开账号。
                    </Note>
                  </TabsContent>
                  <TabsContent value="assignment" className="space-y-3">
                    <Section title="当前岗位归属" action={editButton}>
                      <Facts
                        items={[
                          ["用工归属", affiliationLabels[person.affiliation]],
                          ["主要岗位", person.positionName],
                          [
                            "兼任岗位",
                            person.secondaryPositionNames.join("、") || "无",
                          ],
                          ["所属项目", person.projectName],
                          ["施工队", person.teamName],
                          [
                            "状态",
                            employmentStatusLabels[person.employmentStatus],
                          ],
                        ]}
                      />
                    </Section>
                    <Section title="任职与归属历史">
                      <Ledger
                        headers={[
                          "生效日期",
                          "版本",
                          "用工归属",
                          "岗位",
                          "项目 / 施工队",
                          "状态",
                        ]}
                        rows={detail.assignments.map(item => [
                          displayDate(item.effectiveFrom),
                          `v${item.version}`,
                          affiliationLabels[item.affiliation],
                          options?.positions.find(
                            position => position.id === item.primaryPositionId
                          )?.name ??
                            (item.primaryPositionId
                              ? `岗位 ID ${item.primaryPositionId}`
                              : "未设置"),
                          `${options?.projects.find(project => project.id === item.projectId)?.name ?? "未分配项目"} / ${options?.teams.find(team => team.id === item.teamId)?.name ?? "未分配施工队"}`,
                          employmentStatusLabels[item.employmentStatus],
                        ])}
                      />
                    </Section>
                    <Section
                      title="历史身份来源"
                      action={
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setLegacyOpen(true)}
                        >
                          查看候选 / 补全档案
                        </Button>
                      }
                    >
                      <Ledger
                        headers={["来源", "真实来源 ID", "关联日期"]}
                        rows={detail.sourceLinks.map(item => [
                          item.sourceType === "user"
                            ? "账号"
                            : item.sourceType === "profile"
                              ? "员工档案"
                              : "劳务实名",
                          item.sourceId,
                          displayDate(item.createdAt),
                        ])}
                      />
                      <p className="text-[11px] leading-5 text-slate-500">
                        按真实来源 ID
                        引入，只对已知明确身份关联；不会根据相同姓名或手机号猜测合并，不重建历史工资。
                      </p>
                    </Section>
                  </TabsContent>
                  <TabsContent value="salary" className="space-y-3">
                    <Section title="当前生效薪资" action={editButton}>
                      <Facts
                        items={[
                          [
                            "公司发薪",
                            person.payrollEnabled
                              ? "是"
                              : "否 · 业务费用单独结算",
                          ],
                          [
                            "计薪口径",
                            person.salaryBasis
                              ? salaryBasisLabels[person.salaryBasis]
                              : "未维护",
                          ],
                          ["基础工资 / 单价", money(person.baseSalary)],
                          [
                            "工资主体",
                            person.legacyProfileId
                              ? `员工档案 #${person.legacyProfileId}`
                              : "未关联工资主体",
                          ],
                        ]}
                      />
                    </Section>
                    <Note>
                      这里维护薪资生效版本，不能直接修改历史工资结算金额。未到生效日的设置不会覆盖当前工资；运费与机械租金不是司机、操作员工资。
                    </Note>
                    <Section title="薪资版本历史">
                      <Ledger
                        headers={[
                          "生效日期",
                          "归属",
                          "公司发薪",
                          "计薪口径",
                          "基础工资 / 单价",
                        ]}
                        rows={detail.salaryHistory.map(item => [
                          displayDate(item.effectiveFrom),
                          affiliationLabels[item.affiliation],
                          item.payrollEnabled ? "是" : "否",
                          salaryBasisLabels[item.salaryBasis],
                          money(item.baseSalary),
                        ])}
                      />
                    </Section>
                  </TabsContent>
                  <TabsContent value="attendance" className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-slate-500">
                        按真实历史来源汇总当前月份
                      </p>
                      <PeriodInput period={period} onChange={setPeriod} />
                    </div>
                    <Section title="考勤汇总">
                      <Facts
                        items={[
                          ["出勤天数", `${detail.attendance.days} 天`],
                          ["工作工时", `${detail.attendance.workHours} 小时`],
                          [
                            "加班工时",
                            `${detail.attendance.overtimeHours} 小时`,
                          ],
                          [
                            "录入与审核",
                            <a
                              href="/admin/labor?tab=operations"
                              className="text-emerald-700 hover:underline"
                            >
                              前往劳务工作区 · 切换考勤工资 ↗
                            </a>,
                          ],
                        ]}
                      />
                      <AttendanceRecords
                        rows={detail.attendance.rows}
                        displayDate={displayDate}
                      />
                    </Section>
                  </TabsContent>
                  <TabsContent value="compensation" className="space-y-3">
                    <PersonnelCompensation
                      detail={detail}
                      personId={personId}
                      period={period}
                      onPeriodChange={setPeriod}
                      displayDate={displayDate}
                      onSaved={saved}
                    />
                  </TabsContent>
                  <TabsContent value="resources" className="space-y-3">
                    <PersonnelResources
                      personId={personId}
                      detail={detail}
                      options={options}
                      displayDate={displayDate}
                      onSaved={saved}
                    />
                  </TabsContent>
                  <TabsContent value="documents" className="space-y-3">
                    <PersonnelDocuments
                      initialDocumentType={documentIntent}
                      personId={personId}
                      detail={detail}
                      displayDate={displayDate}
                      onSaved={saved}
                    />
                  </TabsContent>
                  <TabsContent value="changes" className="space-y-3">
                    <Section title="收款信息" action={editButton}>
                      <Facts
                        items={[
                          ["银行卡", person.bankMasked],
                          ["开户行", person.bankName],
                          ["手机号", person.phoneMasked],
                          ["账户维护", "替换 / 清空均留安全记录"],
                        ]}
                      />
                    </Section>
                    <Section title="人员变更记录">
                      <Ledger
                        headers={["时间", "版本", "操作", "变更字段", "操作人"]}
                        rows={detail.changes.map(item => [
                          displayDate(item.createdAt),
                          `v${item.version}`,
                          changeActionLabel(item.action),
                          Object.keys(item.changes ?? {})
                            .map(changeFieldLabel)
                            .join("、") || "无字段变更",
                          `ID ${item.createdBy}`,
                        ])}
                      />
                      <p className="text-[11px] leading-5 text-slate-500">
                        变更记录按当前授权展示手机号、证件和银行卡原值。
                      </p>
                    </Section>
                  </TabsContent>
                </Tabs>
              ) : (
                <Empty>
                  人员档案不存在或已不可访问，请关闭后重新读取目录。
                </Empty>
              )}
            </div>
          </div>
          <footer className="flex shrink-0 items-center justify-between gap-2 border-t bg-slate-50 px-4 py-2">
            <span className="text-[10px] text-slate-500">
              实际付款以财务流水为准 · 详情不代替审批与付款流程
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={onClose}
            >
              关闭详情
            </Button>
          </footer>
        </DialogContent>
      </Dialog>
      <Dialog
        open={editing}
        onOpenChange={open => {
          if (!save.isPending) setEditing(open);
        }}
      >
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle>维护人员 · {person?.name}</DialogTitle>
            <DialogDescription>
              提交基于版本 {editVersion}
              。未修改字段保留；所有人员均通过同一表单维护基础、归属、薪资与收款。
            </DialogDescription>
          </DialogHeader>
          {options && (
            <PersonnelForm
              draft={draft}
              setDraft={setDraft}
              options={options}
              original={original}
              error={saveError}
              pending={save.isPending}
              onCancel={() => setEditing(false)}
              onReload={() => void reloadEdit()}
              onSubmit={() => {
                if (!editVersion) return;
                if (
                  salaryChanged(draft, original) &&
                  !draft.salaryEffectiveFrom
                ) {
                  setSaveError("修改薪资必须选择生效日期");
                  return;
                }
                save.mutate(
                  buildPersonnelSave(draft, original, {
                    id: personId,
                    version: editVersion,
                  })
                );
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      {legacyOpen && (
        <LegacyPersonnelAdoption
          onClose={() => setLegacyOpen(false)}
          onSaved={async id => {
            setLegacyOpen(false);
            if (id !== personId)
              toast.info(
                "历史来源已进入其明确关联的人员档案；未按姓名合并当前人员。请在目录查看。"
              );
            await saved();
          }}
        />
      )}
    </>
  );
}
function PeriodInput({
  period,
  onChange,
}: {
  period: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      type="month"
      aria-label="人员台账期间"
      className="h-8 w-36 bg-white text-xs"
      value={period}
      onChange={event => {
        if (event.target.value) onChange(event.target.value);
      }}
    />
  );
}
function changeFieldLabel(key: string) {
  const labels: Record<string, string> = {
    name: "姓名",
    affiliation: "用工归属",
    employmentStatus: "状态",
    primaryPositionId: "主要岗位",
    secondaryPositionIds: "兼任岗位",
    projectId: "项目",
    teamId: "施工队",
    entryDate: "入职日期",
    exitDate: "离职日期",
    phoneNumber: "手机号",
    phoneMasked: "手机号",
    identityNo: "证件号",
    identityMasked: "证件号",
    bankAccount: "银行卡",
    bankMasked: "银行卡",
    bankName: "开户行",
    userId: "关联账号",
    salaryBasis: "计薪口径",
    baseSalary: "基础工资",
    salaryEffectiveFrom: "工资生效日",
    payrollEnabled: "公司发薪",
    address: "地址",
    gender: "性别",
    birthDate: "出生日期",
    emergencyContactName: "紧急联系人",
    emergencyContactPhone: "紧急电话",
    remarks: "备注",
  };
  return labels[key] ?? "其他档案字段";
}
function changeActionLabel(action: string) {
  const labels: Record<string, string> = {
    create: "新建档案",
    update: "维护档案",
    adopt: "引入历史",
    adopt_legacy: "引入历史",
    resource_binding: "资源绑定",
    upload_document: "上传附件",
    save: "保存资料",
  };
  return labels[action] ?? "档案操作";
}
function AttendanceRecords({
  rows,
  displayDate,
}: {
  rows: PersonDetail["attendance"]["rows"];
  displayDate: (value: Date | string) => string;
}) {
  return (
    <Ledger
      headers={["日期", "状态", "工时", "加班", "备注"]}
      rows={rows.map(item => [
        displayDate(item.attendanceDate),
        getBusinessStatusLabel(item.status),
        item.workHours,
        item.overtimeHours,
        item.note || "—",
      ])}
      empty="所选月份暂无已关联考勤，不代表缺勤。请按实际人员来源核验。"
    />
  );
}
function PersonnelCompensation({
  detail,
  personId,
  period,
  onPeriodChange,
  displayDate,
  onSaved,
}: {
  detail: PersonDetail;
  personId: number;
  period: string;
  onPeriodChange: (value: string) => void;
  displayDate: (value: Date | string) => string;
  onSaved: () => Promise<void>;
}) {
  const [advance, setAdvance] = useState(() => ({
    advanceDate: chinaToday(),
    amount: "",
    remarks: "",
  }));
  const [error, setError] = useState("");
  const [payrollProfileId, setPayrollProfileId] = useState("");
  const generate = trpc.personnel.generatePayrollDraft.useMutation({
    onSuccess: async result => {
      toast.success(
        result.status === "created"
          ? "工资草稿已生成，仍需原会计审核和财务付款流程"
          : "该期间已有工资记录，未重复生成"
      );
      await onSaved();
    },
    onError: error => setError(friendlyPersonnelError(error)),
  });
  const saveAdvance = trpc.personnel.saveAdvance.useMutation({
    onSuccess: async () => {
      toast.success("预支草稿已保存，尚未批准或付款");
      setAdvance(current => ({ ...current, amount: "", remarks: "" }));
      await onSaved();
    },
    onError: error => setError(friendlyPersonnelError(error)),
  });
  const { person, compensation } = detail;
  const selectedSubject = payrollProfileId
    ? detail.payrollSubjects.find(
        item => String(item.employeeProfileId) === payrollProfileId
      )
    : detail.payrollSubjects.length === 1
      ? detail.payrollSubjects[0]
      : undefined;
  const start = `${period}-01`;
  const end = `${period}-31`;
  const historicalEligible = detail.salaryHistory.some((item, index, rows) => {
    const ordered = [...rows].sort((a, b) =>
      a.effectiveFrom.localeCompare(b.effectiveFrom)
    );
    const next = ordered.find(
      row => row.effectiveFrom > item.effectiveFrom
    )?.effectiveFrom;
    return (
      item.payrollEnabled &&
      item.affiliation !== "temporary" &&
      item.affiliation !== "external" &&
      item.effectiveFrom <= end &&
      (!next || next > start)
    );
  });
  const existing = compensation.payroll.some(
    item =>
      item.period === period &&
      (!selectedSubject || item.projectId === selectedSubject.projectId)
  );
  const canGenerate =
    historicalEligible && Boolean(selectedSubject?.workerId) && !existing;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PeriodInput period={period} onChange={onPeriodChange} />
        <select
          aria-label="工资项目主体"
          className="h-8 min-w-0 max-w-full rounded-md border bg-white px-2 text-xs"
          value={
            payrollProfileId ||
            (detail.payrollSubjects.length === 1
              ? String(detail.payrollSubjects[0].employeeProfileId)
              : "")
          }
          onChange={event => setPayrollProfileId(event.target.value)}
        >
          <option value="">选择当期真实项目工资主体</option>
          {detail.payrollSubjects.map(item => (
            <option key={item.employeeProfileId} value={item.employeeProfileId}>
              {item.projectName || "未登记项目"} · 档案 #
              {item.employeeProfileId}
              {item.joinedAt ? ` · ${displayDate(item.joinedAt)}` : ""}
              {item.leftAt ? ` 至 ${displayDate(item.leftAt)}` : ""}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          className="h-8 text-xs"
          variant="outline"
          disabled={!canGenerate || generate.isPending}
          onClick={() => {
            setError("");
            generate.mutate({
              personId,
              period,
              employeeProfileId: selectedSubject?.employeeProfileId,
              projectId: selectedSubject?.projectId ?? undefined,
            });
          }}
        >
          {generate.isPending ? "正在生成…" : "生成月度工资草稿"}
        </Button>
      </div>
      <Note>
        仅生成草稿，不自动核定、扣预支或付款。临时工沿现有日结流程；按所选月份的历史发薪资格校验，不以今天的用工归属覆盖过去。跨项目时须选择对应真实工资主体。已核定、已付款不可在详情直接改金额。
        {existing ? "当前期间已有工资记录，禁止重复生成。" : ""}
      </Note>
      {error && (
        <div
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-xs text-red-800"
        >
          {error}
        </div>
      )}
      <Section
        title="工资核定明细（月薪 / 日结）"
        action={
          <a
            href="/admin/labor?tab=operations"
            className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline"
          >
            劳务工作区 · 切换考勤工资
            <ArrowUpRight className="size-3" />
          </a>
        }
      >
        <Ledger
          headers={[
            "期间 / 日期",
            "类型",
            "应发",
            "核定实发（非实付）",
            "状态",
            "发放标记",
          ]}
          rows={[
            ...compensation.payroll.map(item => [
              item.period,
              "工资条",
              money(item.payableAmount),
              money(item.actualAmount),
              getBusinessStatusLabel(item.status),
              item.paidAt ? displayDate(item.paidAt) : "未标记",
            ]),
            ...compensation.dailyWage.map(item => [
              displayDate(item.settlementDate),
              "临时日结",
              money(item.payableAmount),
              money(item.actualAmount),
              getBusinessStatusLabel(item.status),
              item.paidAt ? displayDate(item.paidAt) : "未标记",
            ]),
          ]}
        />
      </Section>
      <Section title="实际付款流水（与核定实发分开）">
        <PersonnelPaymentRecords
          rows={compensation.payments}
          displayDate={displayDate}
        />
      </Section>
      <MonthlyPayrollSchedule />
      <Section title="工资预支 · 草稿登记">
        <Ledger
          headers={["日期", "金额", "状态", "备注"]}
          rows={compensation.advances.map(item => [
            displayDate(item.advanceDate),
            money(item.amount),
            getBusinessStatusLabel(item.status),
            item.remarks || "—",
          ])}
        />
        {person.payrollEnabled && person.legacyProfileId ? (
          <form
            className="grid gap-2 sm:grid-cols-[140px_140px_minmax(0,1fr)_auto]"
            onSubmit={event => {
              event.preventDefault();
              setError("");
              const amount = Number(advance.amount);
              if (!Number.isFinite(amount) || amount <= 0) {
                setError("请输入大于零的有效预支金额");
                return;
              }
              saveAdvance.mutate({
                personId,
                advanceDate: advance.advanceDate,
                amount,
                remarks: advance.remarks.trim() || undefined,
              });
            }}
          >
            <Input
              aria-label="预支日期"
              type="date"
              required
              className="h-8 text-xs"
              value={advance.advanceDate}
              onChange={event =>
                setAdvance({ ...advance, advanceDate: event.target.value })
              }
            />
            <Input
              aria-label="预支金额"
              type="number"
              required
              min="0.01"
              step="0.01"
              placeholder="预支金额（元）"
              className="h-8 text-xs"
              value={advance.amount}
              onChange={event =>
                setAdvance({ ...advance, amount: event.target.value })
              }
            />
            <Input
              aria-label="预支备注"
              placeholder="备注"
              className="h-8 text-xs"
              value={advance.remarks}
              onChange={event =>
                setAdvance({ ...advance, remarks: event.target.value })
              }
            />
            <Button
              type="submit"
              size="sm"
              className="h-8 text-xs"
              disabled={saveAdvance.isPending || !advance.amount}
            >
              {saveAdvance.isPending ? "保存中…" : "新增预支草稿"}
            </Button>
          </form>
        ) : (
          <p className="text-[11px] text-slate-500">
            该人员当前未启用公司发薪或缺少工资主体，不能登记工资预支。
          </p>
        )}
        <p className="text-[11px] leading-5 text-slate-500">
          预支沿旧审核付款流程处理，不自动扣减工资，不将批准金额视作已付款。
        </p>
      </Section>
    </>
  );
}
function PersonnelPaymentRecords({
  rows,
  displayDate,
}: {
  rows: PersonDetail["compensation"]["payments"];
  displayDate: (value: Date | string) => string;
}) {
  return (
    <Ledger
      headers={["实际付款日期", "付款金额", "关联类型", "流水 / 状态"]}
      rows={rows.map(item => [
        displayDate(item.paymentDate),
        money(item.amount),
        item.settlementType === "payroll"
          ? "月度工资"
          : item.settlementType === "daily_wage"
            ? "临时日结"
            : "其他结算",
        `流水 #${item.id} · ${item.status === "reversed" ? "已冲销（不计实付）" : "有效付款"}`,
      ])}
      empty="暂无已关联的实际付款流水。工资条核定实发或已发放标记不替代付款流水。"
    />
  );
}
function PersonnelResources({
  personId,
  detail,
  options,
  displayDate,
  onSaved,
}: {
  personId: number;
  detail: PersonDetail;
  options?: Options;
  displayDate: (value: Date | string) => string;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => ({
    assetType: "vehicle" as "vehicle" | "machine",
    assetId: "",
    effectiveFrom: chinaToday(),
    effectiveTo: "",
  }));
  const [error, setError] = useState("");
  const save = trpc.personnel.saveResourceBinding.useMutation({
    onSuccess: async () => {
      toast.success("资源绑定已保存并保留历史，不改变账号权限");
      setDraft(current => ({ ...current, assetId: "" }));
      await onSaved();
    },
    onError: error => setError(friendlyPersonnelError(error)),
  });
  const assetLabel = (type: "vehicle" | "machine", id: number) =>
    type === "vehicle"
      ? options?.vehicles.find(item => item.id === id)?.plateNo || `车辆 #${id}`
      : (() => {
          const item = options?.machines.find(item => item.id === id);
          return item ? `${item.code} · ${item.name}` : `机械 #${id}`;
        })();
  return (
    <>
      <Note>
        资源绑定只表示业务驾驶 /
        操作身份，不开账号、不授予资源权限，不覆盖既有账号授权。运费、机械租金仍沿原业务结算流程。当前仅支持今日即时换人，不能回填过去或预设未来绑定，服务端复核同项目与岗位。
      </Note>
      <Section title="当前车辆机械（含真实旧账号绑定）">
        <Ledger
          headers={["资源类型", "车辆 / 机械", "项目"]}
          rows={[
            ...detail.resources.vehicles.map(item => [
              "车辆",
              item.plateNo,
              options?.projects.find(project => project.id === item.projectId)
                ?.name ?? `项目 #${item.projectId}`,
            ]),
            ...detail.resources.machines.map(item => [
              "机械",
              `${item.code} · ${item.name}`,
              options?.projects.find(project => project.id === item.projectId)
                ?.name ?? `项目 #${item.projectId}`,
            ]),
          ]}
        />
      </Section>
      <Section title="车辆机械绑定历史">
        <Ledger
          headers={["资源类型", "车辆 / 机械", "生效日期", "结束日期"]}
          rows={detail.resources.history.map(item => [
            item.assetType === "vehicle" ? "车辆" : "机械",
            assetLabel(item.assetType, item.assetId),
            displayDate(item.effectiveFrom),
            item.effectiveTo ? displayDate(item.effectiveTo) : "持续有效",
          ])}
        />
      </Section>
      <Section title="资源换人 · 今日即时生效">
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={event => {
            event.preventDefault();
            if (!draft.assetId) return;
            setError("");
            save.mutate({
              personId,
              assetType: draft.assetType,
              assetId: Number(draft.assetId),
              effectiveFrom: chinaToday(),
            });
          }}
        >
          <Field label="资源类型">
            <Picker
              label="资源类型"
              value={draft.assetType}
              onChange={value =>
                setDraft({
                  ...draft,
                  assetType: value as "vehicle" | "machine",
                  assetId: "",
                })
              }
            >
              <option value="vehicle">车辆</option>
              <option value="machine">机械</option>
            </Picker>
          </Field>
          <Field label="车辆 / 机械">
            <Picker
              label="选择资源"
              value={draft.assetId}
              onChange={value => setDraft({ ...draft, assetId: value })}
            >
              <option value="">请选择</option>
              {draft.assetType === "vehicle"
                ? options?.vehicles
                    .filter(item => item.projectId === detail.person.projectId)
                    .map(item => (
                      <option key={item.id} value={item.id}>
                        {item.plateNo}
                      </option>
                    ))
                : options?.machines
                    .filter(item => item.projectId === detail.person.projectId)
                    .map(item => (
                      <option key={item.id} value={item.id}>
                        {item.code} · {item.name}
                      </option>
                    ))}
            </Picker>
          </Field>
          <Field label="今日生效（仅支持即时换人）">
            <Input
              required
              type="date"
              className="h-9 text-xs"
              value={draft.effectiveFrom}
              disabled
              onChange={event =>
                setDraft({ ...draft, effectiveFrom: event.target.value })
              }
            />
          </Field>
          {error && (
            <p
              role="alert"
              className="text-xs text-red-700 sm:col-span-2 lg:col-span-4"
            >
              {error}
            </p>
          )}
          <div className="flex justify-end sm:col-span-2 lg:col-span-4">
            <Button
              size="sm"
              className="text-xs"
              type="submit"
              disabled={save.isPending || !draft.assetId || !options}
            >
              {save.isPending ? "正在保存…" : "保存资源绑定"}
            </Button>
          </div>
        </form>
      </Section>
    </>
  );
}

function PersonnelDocuments({
  personId,
  detail,
  displayDate,
  onSaved,
  initialDocumentType = "other",
}: {
  personId: number;
  detail: PersonDetail;
  displayDate: (value: Date | string) => string;
  onSaved: () => Promise<void>;
  initialDocumentType?: PersonnelDocumentType;
}) {
  const [draft, setDraft] = useState({
    documentType: initialDocumentType as PersonnelDocumentType,
    name: "",
    expiresAt: "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [fileKey, setFileKey] = useState(0);
  const [error, setError] = useState("");
  const upload = trpc.personnel.uploadDocument.useMutation({
    onSuccess: async () => {
      toast.success("附件已受控保存");
      setFile(null);
      setFileKey(key => key + 1);
      setDraft(current => ({ ...current, name: "", expiresAt: "" }));
      await onSaved();
    },
    onError: error => setError(friendlyPersonnelError(error)),
  });
  const uploadFile = async () => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type)) {
      setError("仅支持 JPEG、PNG 图片或 PDF 文件");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("附件不能超过 8MB，请先压缩后再上传");
      return;
    }
    setReading(true);
    setError("");
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("文件读取失败，请重新选择"));
        reader.onload = () => {
          if (typeof reader.result !== "string")
            reject(new Error("文件读取失败"));
          else resolve(reader.result.split(",")[1]);
        };
        reader.readAsDataURL(file);
      });
      await upload.mutateAsync({
        personId,
        documentType: draft.documentType,
        name: draft.name.trim() || file.name,
        expiresAt: draft.expiresAt || undefined,
        fileName: file.name,
        mimeType: file.type as "image/jpeg" | "image/png" | "application/pdf",
        base64Data,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "上传未成功");
    } finally {
      setReading(false);
    }
  };
  const today = chinaToday();
  const reminder = (date: Date | string | null) => {
    if (!date) return "未设置有效期";
    const value = dateInput(date);
    const remaining = Math.ceil(
      (Date.parse(`${value}T00:00:00+08:00`) -
        Date.parse(`${today}T00:00:00+08:00`)) /
        86400000
    );
    return remaining < 0
      ? "已过期"
      : remaining <= 30
        ? `距到期 ${remaining} 天`
        : "有效";
  };
  return (
    <>
      <Note>
        普通人员无需提交所有证照，按岗位与实际业务上传。原件通过受控 API
        读取；图片站内预览，不强制下载。
      </Note>
      <Section title="人员证照 / 合同 / 附件">
        <Ledger
          headers={["名称", "类别", "有效期", "提醒", "查看"]}
          rows={detail.documents.map(item => [
            item.name,
            documentTypeLabels[item.documentType],
            item.expiresAt ? displayDate(item.expiresAt) : "未设置",
            <span
              className={
                item.expiresAt && dateInput(item.expiresAt) <= today
                  ? "text-rose-700"
                  : "text-slate-500"
              }
            >
              {reminder(item.expiresAt)}
            </span>,
            <DocumentPreview
              personId={personId}
              documentId={item.id}
              name={item.name}
            />,
          ])}
          empty="暂无人员附件。无需为了建档上传无关证照。"
        />
      </Section>
      <Section title="上传受控附件">
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={event => {
            event.preventDefault();
            void uploadFile();
          }}
        >
          <Field label="附件类别">
            <Picker
              label="附件类别"
              value={draft.documentType}
              onChange={value =>
                setDraft({
                  ...draft,
                  documentType: value as PersonnelDocumentType,
                })
              }
            >
              {PERSONNEL_DOCUMENT_TYPES.map(value => (
                <option key={value} value={value}>
                  {documentTypeLabels[value]}
                </option>
              ))}
            </Picker>
          </Field>
          <Field label="附件名称">
            <Input
              className="h-9 text-xs"
              placeholder="留空使用文件名"
              value={draft.name}
              onChange={event =>
                setDraft({ ...draft, name: event.target.value })
              }
            />
          </Field>
          <Field label="到期日期（可选）">
            <Input
              type="date"
              className="h-9 text-xs"
              value={draft.expiresAt}
              onChange={event =>
                setDraft({ ...draft, expiresAt: event.target.value })
              }
            />
          </Field>
          <Field label="JPEG / PNG / PDF，最大 8MB">
            <Input
              key={fileKey}
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              className="h-9 text-xs"
              onChange={event => setFile(event.target.files?.[0] ?? null)}
            />
          </Field>
          {error && (
            <p
              role="alert"
              className="text-xs text-red-700 sm:col-span-2 lg:col-span-4"
            >
              {error}
            </p>
          )}
          <div className="flex justify-end sm:col-span-2 lg:col-span-4">
            <Button
              type="submit"
              size="sm"
              className="text-xs"
              disabled={!file || upload.isPending || reading}
            >
              {upload.isPending || reading ? "正在受控上传…" : "上传附件"}
            </Button>
          </div>
        </form>
      </Section>
      <Section title="员工保险台账（真实历史保单）">
        <InsuranceRecords
          personId={personId}
          version={detail.person.version}
          onSaved={onSaved}
          rows={detail.insurance}
          displayDate={displayDate}
        />
      </Section>
    </>
  );
}
function DocumentPreview({
  personId,
  documentId,
  name,
}: {
  personId: number;
  documentId: number;
  name: string;
}) {
  const [requested, setRequested] = useState(false);
  const input = useMemo(
    () => ({ personId, documentId }),
    [personId, documentId]
  );
  const preview = trpc.personnel.previewDocument.useQuery(input, {
    ...QUERY_OPTIONS,
    enabled: requested,
    staleTime: 0,
    gcTime: 0,
  });
  return (
    <div className="space-y-1">
      {preview.isFetching ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
          <Loader2 className="size-3 animate-spin" />
          正在获取授权预览
        </span>
      ) : preview.data ? (
        <ProtectedImagePreview
          file={preview.data}
          title={name}
          description="受控原件 · 短时授权链接，仅限当前获授权账号"
          className="text-emerald-700 hover:underline"
        >
          <FileText className="size-3" />
          {preview.data.mimeType?.startsWith("image/")
            ? "站内预览图片"
            : "打开PDF"}
        </ProtectedImagePreview>
      ) : (
        <button
          type="button"
          className="text-emerald-700 hover:underline"
          onClick={() => setRequested(true)}
        >
          受控预览
        </button>
      )}
      {preview.error && (
        <p role="alert" className="text-[10px] text-red-700">
          {preview.error.message}
        </p>
      )}
      {requested && (
        <button
          className="block text-[10px] text-slate-500 hover:underline"
          type="button"
          onClick={() => void preview.refetch()}
        >
          刷新预览授权
        </button>
      )}
    </div>
  );
}
function InsuranceDocumentPreview({
  personId,
  policyId,
}: {
  personId: number;
  policyId: number;
}) {
  const [requested, setRequested] = useState(false);
  const input = useMemo(() => ({ personId, policyId }), [personId, policyId]);
  const preview = trpc.personnel.previewInsuranceDocument.useQuery(input, {
    ...QUERY_OPTIONS,
    enabled: requested,
    staleTime: 0,
    gcTime: 0,
  });
  return (
    <div className="space-y-1 text-xs">
      {preview.isFetching ? (
        <span className="text-slate-500">正在获取授权预览…</span>
      ) : preview.data ? (
        <ProtectedImagePreview
          file={preview.data}
          title="保单附件"
          description="历史保单 · 当前人员授权范围 · 短时预览"
          className="text-emerald-700 hover:underline"
        >
          查看保单附件
        </ProtectedImagePreview>
      ) : (
        <button
          type="button"
          className="text-emerald-700 hover:underline"
          onClick={() => setRequested(true)}
        >
          查看保单附件
        </button>
      )}
      {preview.error ? (
        <p role="alert" className="text-[10px] text-red-700">
          {friendlyPersonnelError(preview.error)}
        </p>
      ) : null}
      {requested ? (
        <button
          type="button"
          className="block text-[10px] text-slate-500"
          onClick={() => void preview.refetch()}
        >
          刷新预览授权
        </button>
      ) : null}
    </div>
  );
}

function InsuranceRecords({
  rows,
  displayDate,
  personId,
  version,
  onSaved,
}: {
  rows: PersonDetail["insurance"];
  displayDate: (value: Date | string) => string;
  personId: number;
  version: number;
  onSaved: () => Promise<void>;
}) {
  const [editingPolicy, setEditingPolicy] = useState<
    PersonDetail["insurance"][number] | null | undefined
  >();
  const today = chinaToday();
  const expirationStatus = (date: Date) => {
    const day = dateInput(date);
    const remain = Math.ceil(
      (Date.parse(`${day}T00:00:00+08:00`) -
        Date.parse(`${today}T00:00:00+08:00`)) /
        86400000
    );
    return remain < 0
      ? "已过期"
      : remain <= 30
        ? `30天内到期（${remain}天）`
        : "有效期内";
  };
  const insuranceLabels: Record<string, string> = {
    accident: "意外险",
    employer_liability: "雇主责任险",
    work_injury: "工伤保险",
    medical: "医疗保险",
    other: "其他保险",
  };
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setEditingPolicy(null)}
        >
          登记人员保险
        </Button>
      </div>
      <Ledger
        headers={[
          "险种 / 公司",
          "台账来源",
          "保费 / 保额",
          "购买日期",
          "到期日期",
          "状态",
          "维护 / 附件",
        ]}
        rows={rows.map(item => [
          <span>
            {insuranceLabels[item.insuranceType] ?? "员工保险"}
            <br />
            {item.providerName || "未登记公司"}
          </span>,
          `保险台账 #${item.id} · 档案 #${item.employeeProfileId}`,
          `${money(item.premiumAmount)} / ${money(item.coverageAmount)}`,
          displayDate(item.purchasedAt),
          displayDate(item.expiresAt),
          `${getBusinessStatusLabel(item.status)} · ${expirationStatus(item.expiresAt)}`,
          <div className="space-y-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setEditingPolicy(item)}
            >
              修改保险信息
            </Button>
            {item.hasAttachment ? (
              <InsuranceDocumentPreview
                personId={personId}
                policyId={item.id}
              />
            ) : (
              <span className="text-[10px] text-slate-500">
                未关联历史保单附件 · 可在本人员文档中上传
              </span>
            )}
          </div>,
        ])}
        empty="暂无已关联保险台账。上传保险附件不等于新增或修改历史保单，保险购买和费用仍沿原台账处理。"
      />
      {editingPolicy !== undefined ? (
        <PersonnelInsuranceEditor
          personId={personId}
          version={version}
          policy={editingPolicy ?? undefined}
          onClose={() => setEditingPolicy(undefined)}
          onSaved={onSaved}
        />
      ) : null}
    </>
  );
}
function PersonnelDictionaries({
  options,
  onClose,
  onSaved,
}: {
  options?: Options;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [tab, setTab] = useState("positions");
  const [position, setPosition] = useState({
    id: undefined as number | undefined,
    name: "",
    category: "other" as PersonnelPositionCategory,
    status: "active" as "active" | "disabled",
  });
  const [team, setTeam] = useState({
    id: undefined as number | undefined,
    name: "",
    projectId: "",
    leaderName: "",
    remarks: "",
    status: "active" as "active" | "disabled",
  });
  const [error, setError] = useState("");
  const savePosition = trpc.personnel.savePosition.useMutation({
    onSuccess: async () => {
      toast.success("岗位字典已保存");
      setPosition({
        id: undefined,
        name: "",
        category: "other",
        status: "active",
      });
      await onSaved();
    },
    onError: error => setError(friendlyPersonnelError(error)),
  });
  const saveTeam = trpc.personnel.saveTeam.useMutation({
    onSuccess: async () => {
      toast.success("施工队已保存");
      setTeam({
        id: undefined,
        name: "",
        projectId: "",
        leaderName: "",
        remarks: "",
        status: "active",
      });
      await onSaved();
    },
    onError: error => setError(friendlyPersonnelError(error)),
  });
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>岗位与施工队字典</DialogTitle>
          <DialogDescription>
            新增、修改或停用字典，不改变人员历史任职、历史工资或账号权限。
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={value => {
            setTab(value);
            setError("");
          }}
        >
          <TabsList>
            <TabsTrigger value="positions" className="text-xs">
              岗位字典
            </TabsTrigger>
            <TabsTrigger value="teams" className="text-xs">
              施工队
            </TabsTrigger>
          </TabsList>
          <TabsContent value="positions" className="space-y-3">
            <form
              className="grid items-end gap-2 sm:grid-cols-[1fr_140px_100px_auto]"
              onSubmit={event => {
                event.preventDefault();
                setError("");
                savePosition.mutate(position);
              }}
            >
              <Field
                label={
                  position.id ? `修改岗位 #${position.id}` : "新增岗位名称"
                }
              >
                <Input
                  required
                  maxLength={128}
                  className="h-9 text-xs"
                  value={position.name}
                  onChange={event =>
                    setPosition({ ...position, name: event.target.value })
                  }
                />
              </Field>
              <Field label="岗位类别">
                <Picker
                  label="岗位类别"
                  value={position.category}
                  onChange={value =>
                    setPosition({
                      ...position,
                      category: value as PersonnelPositionCategory,
                    })
                  }
                >
                  {PERSONNEL_POSITION_CATEGORIES.map(value => (
                    <option key={value} value={value}>
                      {positionCategoryLabels[value]}
                    </option>
                  ))}
                </Picker>
              </Field>
              <Field label="状态">
                <Picker
                  label="岗位字典状态"
                  value={position.status}
                  onChange={value =>
                    setPosition({
                      ...position,
                      status: value as "active" | "disabled",
                    })
                  }
                >
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                </Picker>
              </Field>
              <Button
                type="submit"
                size="sm"
                className="h-9 text-xs"
                disabled={savePosition.isPending || !position.name.trim()}
              >
                {savePosition.isPending ? "保存中…" : "保存岗位"}
              </Button>
            </form>
            {position.id && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() =>
                  setPosition({
                    id: undefined,
                    name: "",
                    category: "other",
                    status: "active",
                  })
                }
              >
                取消修改 / 新增岗位
              </Button>
            )}
            <Ledger
              headers={["岗位名称", "类别", "状态", "维护"]}
              rows={(options?.positions ?? []).map(item => [
                item.name,
                positionCategoryLabels[item.category],
                item.status === "active" ? "启用" : "停用",
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={() =>
                    setPosition({
                      id: item.id,
                      name: item.name,
                      category: item.category,
                      status: item.status,
                    })
                  }
                >
                  修改 / 停用
                </Button>,
              ])}
            />
          </TabsContent>
          <TabsContent value="teams" className="space-y-3">
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={event => {
                event.preventDefault();
                setError("");
                if (!team.projectId) {
                  setError("施工队必须选择所属项目");
                  return;
                }
                saveTeam.mutate({
                  id: team.id,
                  name: team.name.trim(),
                  projectId: Number(team.projectId),
                  leaderName: team.leaderName.trim() || null,
                  remarks: team.remarks.trim() || (team.id ? null : undefined),
                  status: team.status,
                });
              }}
            >
              <Field label={team.id ? `修改施工队 #${team.id}` : "施工队名称"}>
                <Input
                  required
                  maxLength={128}
                  className="h-9 text-xs"
                  value={team.name}
                  onChange={event =>
                    setTeam({ ...team, name: event.target.value })
                  }
                />
              </Field>
              <Field label="所属项目 *">
                <Picker
                  label="施工队所属项目"
                  disabled={Boolean(team.id)}
                  value={team.projectId}
                  onChange={value => setTeam({ ...team, projectId: value })}
                >
                  <option value="">请选择项目</option>
                  {options?.projects.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Picker>
              </Field>
              <Field label="负责人（选填）">
                <Input
                  className="h-9 text-xs"
                  value={team.leaderName}
                  onChange={event =>
                    setTeam({ ...team, leaderName: event.target.value })
                  }
                />
              </Field>
              <Field label="施工队状态">
                <Picker
                  label="施工队字典状态"
                  value={team.status}
                  onChange={value =>
                    setTeam({ ...team, status: value as "active" | "disabled" })
                  }
                >
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                </Picker>
              </Field>
              <Field wide label="施工队备注">
                <Input
                  className="h-9 text-xs"
                  value={team.remarks}
                  onChange={event =>
                    setTeam({ ...team, remarks: event.target.value })
                  }
                />
              </Field>
              <div className="flex justify-end gap-2 sm:col-span-2">
                {team.id && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-xs"
                    onClick={() =>
                      setTeam({
                        id: undefined,
                        name: "",
                        projectId: "",
                        leaderName: "",
                        remarks: "",
                        status: "active",
                      })
                    }
                  >
                    取消修改 / 新建
                  </Button>
                )}
                <Button
                  type="submit"
                  size="sm"
                  className="text-xs"
                  disabled={
                    saveTeam.isPending || !team.name.trim() || !team.projectId
                  }
                >
                  {saveTeam.isPending ? "保存中…" : "保存施工队"}
                </Button>
              </div>
            </form>
            <Ledger
              headers={["施工队", "项目", "负责人", "维护"]}
              rows={(options?.teams ?? []).map(item => [
                item.name,
                options?.projects.find(project => project.id === item.projectId)
                  ?.name ?? `项目 #${item.projectId}`,
                item.leaderName || "未登记",
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={() =>
                    setTeam({
                      id: item.id,
                      name: item.name,
                      projectId: String(item.projectId),
                      leaderName: item.leaderName ?? "",
                      remarks: item.remarks ?? "",
                      status: item.status,
                    })
                  }
                >
                  修改 / 停用
                </Button>,
              ])}
            />
          </TabsContent>
        </Tabs>
        {error && (
          <p
            role="alert"
            className="rounded-md bg-rose-50 p-3 text-xs text-rose-700"
          >
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
export type PersonnelLegacySource = {
  sourceType: "user" | "profile" | "worker";
  sourceId: number;
  requestKey: number;
};
function LegacyPersonnelAdoption({
  onClose,
  onSaved,
  focusSource,
}: {
  onClose: () => void;
  onSaved: (id: number) => Promise<void>;
  focusSource?: PersonnelLegacySource;
}) {
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const query = trpc.personnel.listLegacyCandidates.useQuery(
    undefined,
    QUERY_OPTIONS
  );
  const adopt = trpc.personnel.adoptLegacy.useMutation({
    onSuccess: async result => {
      toast.success("已按真实历史来源关联人员，未重建历史金额或权限");
      await onSaved(result.id);
    },
    onError: error => setError(friendlyPersonnelError(error)),
  });
  const matches = useMemo(
    () =>
      query.data?.filter(
        item =>
          (!focusSource ||
            (item.sourceType === focusSource.sourceType &&
              item.sourceId === focusSource.sourceId)) &&
          (!search.trim() ||
            item.name?.includes(search.trim()) ||
            String(item.sourceId).includes(search.trim()))
      ),
    [query.data, search, focusSource]
  );
  const openedSource = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!focusSource || !query.data) return;
    const candidate = query.data.find(
      item =>
        item.sourceType === focusSource.sourceType &&
        item.sourceId === focusSource.sourceId
    );
    const key = `${focusSource.sourceType}:${focusSource.sourceId}:${focusSource.requestKey}`;
    if (candidate?.linkedPersonId && openedSource.current !== key) {
      openedSource.current = key;
      void onSaved(candidate.linkedPersonId);
    }
  }, [focusSource, query.data, onSaved]);
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !adopt.isPending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>引入真实历史人员</DialogTitle>
          <DialogDescription>
            只按真实来源 ID
            引入，不按姓名或手机号自动合并；不自动创建账号，不改变工资历史和权限。
          </DialogDescription>
        </DialogHeader>
        <Note>
          {focusSource
            ? `已定位${focusSource.sourceType === "worker" ? "劳务实名" : focusSource.sourceType === "profile" ? "员工档案" : "账号"} ID ${focusSource.sourceId}。请核对后明确点击引入，不会静默创建人员。`
            : "同名不表示同一人；请选择已确认身份的历史来源。已存在明确身份映射时返回同一人员主档。"}
        </Note>
        <Input
          aria-label="搜索历史候选"
          placeholder="搜索历史姓名或真实来源 ID"
          className="h-9 text-xs"
          value={search}
          onChange={event => setSearch(event.target.value)}
        />
        {query.isLoading ? (
          <Loading label="正在读取真实来源候选…" />
        ) : query.error ? (
          <Failure error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <Ledger
            headers={["历史姓名", "来源类型", "真实 ID", "操作"]}
            rows={(matches ?? []).map(item => [
              item.name || "未命名人员",
              item.sourceType === "user"
                ? "账号"
                : item.sourceType === "profile"
                  ? "员工档案"
                  : "劳务实名",
              item.sourceId,
              <Button
                className="h-7 text-xs"
                size="sm"
                variant="outline"
                disabled={adopt.isPending}
                onClick={() => {
                  if (item.linkedPersonId) {
                    void onSaved(item.linkedPersonId);
                    return;
                  }
                  if (
                    !window.confirm(
                      `确认按${item.sourceType}来源 ID ${item.sourceId} 引入“${item.name || "未命名人员"}”吗？不会按同名猜测合并其他人员。`
                    )
                  )
                    return;
                  setError("");
                  adopt.mutate({
                    sourceType: item.sourceType,
                    sourceId: item.sourceId,
                  });
                }}
              >
                {item.linkedPersonId ? "打开已关联人员" : "核对后引入"}
              </Button>,
            ])}
            empty={
              focusSource
                ? "该来源不在待引入候选中，可能已建档或当前无权限。请返回目录检索；不会按姓名静默重建。"
                : "暂无待引入的真实历史人员，或当前搜索没有匹配。"
            }
          />
        )}
        {error && (
          <p
            role="alert"
            className="rounded-md bg-red-50 p-3 text-xs text-red-800"
          >
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MonthlyPayrollSchedule() {
  const schedule = trpc.admin.employee.getPayrollGenerationSchedule.useQuery(
    undefined,
    QUERY_OPTIONS
  );
  const [error, setError] = useState("");
  const save = trpc.admin.employee.savePayrollGenerationSchedule.useMutation({
    onSuccess: async () => {
      toast.success("月度自动工资草稿设置已保存，不自动审核或付款");
      await schedule.refetch();
    },
    onError: error => setError(friendlyPersonnelError(error)),
  });
  return (
    <Section title="每月自动工资草稿 · 公司统一设置">
      {schedule.isLoading ? (
        <Loading label="正在读取既有自动工资配置…" />
      ) : schedule.error ? (
        <Failure
          error={schedule.error}
          onRetry={() => void schedule.refetch()}
        />
      ) : schedule.data ? (
        <>
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <p className="text-xs leading-5 text-slate-600">
              当前{schedule.data.enabled ? "已启用" : "未启用"}：每月{" "}
              {schedule.data.generationDay} 日{" "}
              {String(schedule.data.generationHour).padStart(2, "0")}:
              {String(schedule.data.generationMinute).padStart(2, "0")}
              （中国标准时间）为上月符合条件人员生成工资草稿。
            </p>
            <Button
              type="button"
              variant={schedule.data.enabled ? "outline" : "default"}
              size="sm"
              className="shrink-0 text-xs"
              disabled={save.isPending}
              onClick={() => {
                if (!schedule.data) return;
                if (
                  !window.confirm(
                    `${schedule.data.enabled ? "停用" : "启用"}公司范围每月自动生成工资草稿？此设置影响符合条件人员，不自动审核、扣预支或付款。`
                  )
                )
                  return;
                setError("");
                save.mutate({
                  enabled: !schedule.data.enabled,
                  generationDay: schedule.data.generationDay,
                  generationHour: schedule.data.generationHour,
                  generationMinute: schedule.data.generationMinute,
                });
              }}
            >
              {save.isPending
                ? "正在设置…"
                : schedule.data.enabled
                  ? "停用自动生成"
                  : "启用每月自动生成"}
            </Button>
          </div>
          <p className="text-[11px] leading-5 text-slate-500">
            沿用原自动月薪流程及当前时间配置；不会重复生成已存在工资，不处理临时日结和外部业务费用。测试环境如不支持启用，服务端会明确提示，不伪装成功。
          </p>
        </>
      ) : (
        <Empty>暂未读取到公司自动工资配置，请确认数据库与授权后重试。</Empty>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md bg-red-50 p-3 text-xs text-red-700"
        >
          {error}
        </p>
      )}
    </Section>
  );
}
