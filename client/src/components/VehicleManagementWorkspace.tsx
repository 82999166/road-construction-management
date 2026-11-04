import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BusinessWorkspaceNavigation } from "./BusinessWorkspaceNavigation";
import { VehicleManagementReport } from "./VehicleManagementReport";
import VehicleManagementDetail from "./VehicleManagementDetail";
import {
  VehicleRegistryForm,
  VehicleSelectField,
  type VehicleNode,
} from "./VehicleManagementForms";
import {
  VEHICLE_MANAGEMENT_TABS,
  VEHICLE_TYPE_LABELS,
  INITIAL_VEHICLE_FILTER,
  filterVehicleRows,
  vehicleDate,
  vehicleDateTime,
  vehicleLabel,
  vehicleMoney,
  vehicleDateReminder,
  vehicleMileageReminder,
  confirmVehicleDiscard,
  type VehicleManagementTab,
  type VehicleDetailTab,
  type VehicleFilter,
} from "@/lib/vehicleManagementWorkspace";
import { toChinaDateInput as toDeviceDateInput } from "@/lib/businessTime";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
export default function VehicleManagementWorkspace({
  projects,
  organizations,
  createRequest,
  onDirtyChange,
}: {
  projects: readonly VehicleNode[];
  organizations: readonly VehicleNode[];
  createRequest?: { projectId: number; requestId: number };
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [tab, setTab] = useState<VehicleManagementTab>("overview"),
    [filters, setFilters] = useState<VehicleFilter>(INITIAL_VEHICLE_FILTER),
    [create, setCreate] = useState(false),
    [detail, setDetail] = useState<{
      id: number;
      tab: VehicleDetailTab;
    } | null>(null),
    [detailDirty, setDetailDirty] = useState(false),
    [period, setPeriod] = useState(() => toDeviceDateInput().slice(0, 7)),
    [from, setFrom] = useState(toDeviceDateInput),
    [to, setTo] = useState(toDeviceDateInput),
    [history, setHistory] = useState(false);
  const lastRequest = useRef<number | null>(null),
    utils = trpc.useUtils();
  const list = trpc.vehicleManagement.list.useQuery(
    { all: true },
    { retry: false }
  );
  const filtered = useMemo(
    () => filterVehicleRows(list.data?.items ?? [], filters),
    [list.data, filters]
  );
  const ids = useMemo(() => new Set(filtered.map(v => v.id)), [filtered]);
  const projectId =
    filters.projectId === "all" ? undefined : Number(filters.projectId);
  const records = trpc.vehicleManagement.records.useQuery(
    {
      category:
        tab === "assignments"
          ? "assignments"
          : tab === "maintenance"
            ? "maintenance"
            : "compliance",
      projectId,
    },
    {
      enabled: ["assignments", "maintenance", "compliance"].includes(tab),
      retry: false,
    }
  );
  const finance = trpc.transport.listVehicleSummaries.useQuery(
    { projectId, period },
    { enabled: tab === "finance" || tab === "overview", retry: false }
  );
  const dirty = create || detailDirty;
  const recordDetailDirty = useCallback(
    (value: boolean) => setDetailDirty(value),
    []
  );
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  useEffect(() => {
    if (createRequest && lastRequest.current !== createRequest.requestId) {
      lastRequest.current = createRequest.requestId;
      setFilters(prev => ({
        ...prev,
        projectId: String(createRequest.projectId),
      }));
      setTab("registry");
      setCreate(true);
    }
  }, [createRequest]);
  const update = (key: keyof VehicleFilter, value: string) => {
    if (dirty && !confirmVehicleDiscard(true, () => {})) return;
    setFilters(prev => ({ ...prev, [key]: value }));
  };
  const open = (id: number, next: VehicleDetailTab = "base") =>
    setDetail({ id, tab: next });
  const changed = useCallback(() => {
    void utils.vehicleManagement.invalidate();
    void utils.transport.listVehicleSummaries.invalidate();
  }, [utils]);
  const scope = `项目：${projectId ? (projects.find(p => p.id === projectId)?.name ?? "所选项目") : "全部授权项目"} · 车牌/所属人/司机：${filters.search || "全部"} · 车型：${filters.type === "all" ? "全部" : vehicleLabel(filters.type)} · 产权：${filters.property === "all" ? "全部" : vehicleLabel(filters.property)} · 状态：${filters.status === "all" ? "全部" : vehicleLabel(filters.status)}`;
  const financeIds = new Set(
    filterVehicleRows(list.data?.items ?? [], {
      ...filters,
      projectId: "all",
    }).map(v => v.id)
  );
  const summaryRows = (finance.data ?? []).filter(r =>
    financeIds.has(r.vehicleId)
  );
  const today = toDeviceDateInput();
  const available = filtered.filter(
    v =>
      v.status === "active" &&
      (!v.profile ||
        (v.profile.purpose !== "trailer" &&
          !v.profile.archived &&
          v.profile.technicalStatus === "normal" &&
          v.profile.dispatchStatus !== "paused" &&
          v.profile.projectStatus === "on_site"))
  ).length;
  const sums = (key: "remainingPayableAmount" | "remainingReceivableAmount") =>
    summaryRows.reduce((n, r) => n + r.cumulative[key], 0);
  const plate = (id: number) =>
    (list.data?.items ?? []).find(v => v.id === id)?.plateNo ?? `车辆 ${id}`;
  const dateScope = history ? "全部责任历史" : `${from} 至 ${to}`;
  const within = (at: Date | string) =>
    history || (vehicleDate(at) >= from && vehicleDate(at) <= to);
  const r = records.data;
  const assignments = (r?.assignments ?? []).filter(
    row => ids.has(row.vehicleId) && within(row.effectiveFrom)
  );
  const orders = (r?.workOrders ?? []).filter(row => ids.has(row.vehicleId));
  const plans = (r?.maintenancePlans ?? []).filter(row =>
    ids.has(row.vehicleId)
  );
  const docs = (r?.documents ?? []).filter(row => ids.has(row.vehicleId));
  const inspections = (r?.inspections ?? []).filter(
    row => ids.has(row.vehicleId) && within(row.occurredAt)
  );
  return (
    <section
      data-vehicle-management-workspace="six-columns"
      className="min-w-0 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">车辆管理</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            一车一档 · 驾驶责任 · 技术与调度状态 · 同口径费用 · 结算付款
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void changed()}>
            刷新资料
          </Button>
          <Button
            onClick={() => {
              setTab("registry");
              setCreate(true);
            }}
          >
            新建车辆
          </Button>
        </div>
      </div>
      <div className="grid min-w-0 gap-3 rounded-xl border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
        <VehicleSelectField
          label="车辆项目范围"
          value={filters.projectId}
          onChange={value => update("projectId", value)}
          options={[
            ["all", "全部授权项目"],
            ...projects.map(p => [String(p.id), p.name] as const),
          ]}
        />
        <label className="text-sm">
          车牌 / 所属人 / 驾驶员
          <Input
            aria-label="车辆关键词"
            value={filters.search}
            onChange={e => update("search", e.target.value)}
            placeholder="输入关键词搜索车辆"
          />
        </label>
        <VehicleSelectField
          label="车型筛选"
          value={filters.type}
          onChange={value => update("type", value)}
          options={[
            ["all", "全部车型"],
            ...Object.entries(VEHICLE_TYPE_LABELS),
          ]}
        />
        <VehicleSelectField
          label="产权筛选"
          value={filters.property}
          onChange={value => update("property", value)}
          options={[
            ["all", "全部产权"],
            ["company_owned", "公司自有"],
            ["rented", "租入"],
            ["partner", "外协合作"],
            ["unconfigured", "历史未完善分类"],
          ]}
        />
        <details className="sm:col-span-2 lg:col-span-4">
          <summary className="cursor-pointer text-xs font-medium">
            更多状态筛选
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <VehicleSelectField
              label="车辆启停"
              value={filters.status}
              onChange={v => update("status", v)}
              options={[
                ["all", "全部"],
                ["active", "启用"],
                ["suspended", "暂停"],
                ["disabled", "停用"],
              ]}
            />
            <VehicleSelectField
              label="技术状态"
              value={filters.technical}
              onChange={v => update("technical", v)}
              options={[
                ["all", "全部"],
                ["normal", "正常"],
                ["repair", "维修中"],
                ["safety_hold", "安全禁用"],
                ["unconfigured", "历史未配置"],
              ]}
            />
            <VehicleSelectField
              label="调度状态"
              value={filters.dispatch}
              onChange={v => update("dispatch", v)}
              options={[
                ["all", "全部"],
                ["standby", "待命"],
                ["working", "作业"],
                ["paused", "暂停调度"],
                ["unconfigured", "历史未配置"],
              ]}
            />
            <VehicleSelectField
              label="项目状态"
              value={filters.projectStatus}
              onChange={v => update("projectStatus", v)}
              options={[
                ["all", "全部"],
                ["pending", "待进场"],
                ["on_site", "在场"],
                ["exited", "已退场"],
                ["unconfigured", "历史未配置"],
              ]}
            />
          </div>
        </details>
      </div>
      <BusinessWorkspaceNavigation
        tabs={VEHICLE_MANAGEMENT_TABS}
        value={tab}
        onValueChange={setTab}
        label="车辆管理栏目"
      />
      <p className="text-xs leading-5 text-muted-foreground">
        {scope}
        。资产档案不受当日运单限制；分页仅影响屏幕，导出与打印覆盖全部筛选。
      </p>
      {list.isError ? (
        <p role="alert">
          {getUserFacingErrorMessage(list.error, "车辆读取失败")}
        </p>
      ) : list.isLoading ? (
        <p>正在加载车辆档案…</p>
      ) : (
        <>
          {tab === "overview" && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  {
                    title: "筛选车辆",
                    value: filtered.length,
                    next: "registry",
                  },
                  { title: "可调度车辆", value: available, next: "registry" },
                  {
                    title: "维修 / 安全禁用",
                    value: filtered.filter(
                      v => v.profile && v.profile.technicalStatus !== "normal"
                    ).length,
                    next: "maintenance",
                  },
                  {
                    title: "已归档车辆",
                    value: filtered.filter(v => v.profile?.archived).length,
                    next: "registry",
                  },
                ].map(card => (
                  <button
                    key={card.title}
                    className="rounded-xl border bg-card p-4 text-left"
                    onClick={() => setTab(card.next as VehicleManagementTab)}
                  >
                    <p className="text-xs text-muted-foreground">
                      {card.title}
                    </p>
                    <p className="mt-2 text-2xl font-semibold">{card.value}</p>
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  className="rounded-xl border bg-card p-4 text-left"
                  onClick={() => setTab("finance")}
                >
                  <p className="text-xs text-muted-foreground">
                    截至 {period} 月末待付款（真实有效凭证余额）
                  </p>
                  <p className="mt-2 text-xl font-semibold">
                    {finance.isError
                      ? "读取失败"
                      : finance.isLoading
                        ? "正在核算…"
                        : `¥${vehicleMoney(sums("remainingPayableAmount"))}`}
                  </p>
                </button>
                <button
                  className="rounded-xl border bg-card p-4 text-left"
                  onClick={() => setTab("finance")}
                >
                  <p className="text-xs text-muted-foreground">
                    截至 {period} 月末待收补款
                  </p>
                  <p className="mt-2 text-xl font-semibold">
                    {finance.isError
                      ? "读取失败"
                      : finance.isLoading
                        ? "正在核算…"
                        : `¥${vehicleMoney(sums("remainingReceivableAmount"))}`}
                  </p>
                </button>
              </div>
              <div className="rounded-xl border bg-muted/30 p-4 text-sm">
                <h3 className="font-semibold">现场办理入口</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTab("assignments")}
                  >
                    司机交接与进退场
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTab("maintenance")}
                  >
                    维修与保养提醒
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTab("compliance")}
                  >
                    证照有效期与出车安全
                  </Button>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  历史未建行业档案的车辆保持原办理能力，完善资料后采用明确技术、调度与项目状态。退场不等于结清，不因停用而隐藏旧账。
                </p>
              </div>
            </>
          )}
          {tab === "registry" && (
            <VehicleManagementReport
              report={{
                title: "车辆档案台账",
                scope,
                headers: [
                  "车牌",
                  "车型",
                  "项目",
                  "产权 / 合作方式",
                  "结算方式",
                  "所属人 / 出租方",
                  "司机",
                  "技术",
                  "调度",
                  "项目状态",
                  "车辆启停",
                ],
                rows: filtered.map(v => [
                  v.plateNo,
                  v.profile?.purpose === "trailer"
                    ? "挂车"
                    : vehicleLabel(v.vehicleType),
                  projects.find(p => p.id === v.projectId)?.name ??
                    `项目 ${v.projectId}`,
                  vehicleLabel(v.profile?.propertyType),
                  vehicleLabel(v.profile?.settlementMode),
                  v.ownerName,
                  v.driverName,
                  vehicleLabel(v.profile?.technicalStatus),
                  vehicleLabel(v.profile?.dispatchStatus),
                  vehicleLabel(v.profile?.projectStatus),
                  vehicleLabel(v.status),
                ]),
              }}
              actions={i => (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => open(filtered[i].id)}
                >
                  统一车辆详情
                </Button>
              )}
            />
          )}
          {tab === "assignments" && (
            <>
              <div className="flex flex-wrap gap-3">
                <label className="text-xs">
                  发生日期开始
                  <Input
                    type="date"
                    value={from}
                    onChange={e => setFrom(e.target.value)}
                  />
                </label>
                <label className="text-xs">
                  发生日期结束
                  <Input
                    type="date"
                    value={to}
                    onChange={e => setTo(e.target.value)}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={history}
                    onChange={e => setHistory(e.target.checked)}
                  />
                  查看全部责任历史
                </label>
              </div>
              <VehicleManagementReport
                report={{
                  title: "当前驾驶员与进退场办理",
                  scope,
                  headers: ["车牌", "当前司机", "项目状态", "调度状态", "归档"],
                  rows: filtered.map(v => [
                    v.plateNo,
                    v.driverName,
                    vehicleLabel(v.profile?.projectStatus),
                    vehicleLabel(v.profile?.dispatchStatus),
                    v.profile?.archived ? "已归档" : "未归档",
                  ]),
                  summary:
                    "常用司机并非历史每趟的责任人；交接保存真实生效时间，前任责任和历史费用不覆盖。",
                }}
                actions={i => (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => open(filtered[i].id, "assignments")}
                  >
                    办理 / 详情
                  </Button>
                )}
              />
              {records.isError ? (
                <p role="alert">交接记录读取失败，请刷新</p>
              ) : records.isLoading ? (
                <p>正在读取驾驶责任记录…</p>
              ) : (
                <VehicleManagementReport
                  report={{
                    title: "车辆进退场与司机交接历史",
                    scope: `${scope} · ${dateScope}`,
                    headers: [
                      "车牌",
                      "动作",
                      "项目",
                      "发生时间",
                      "责任截止",
                      "司机编号",
                      "里程",
                      "车况",
                      "依据",
                    ],
                    rows: assignments.map(r => [
                      plate(r.vehicleId),
                      r.action === "baseline"
                        ? "历史基线（未推定责任）"
                        : vehicleLabel(r.action),
                      projects.find(p => p.id === r.projectId)?.name ??
                        r.projectId,
                      vehicleDateTime(r.effectiveFrom),
                      vehicleDateTime(r.effectiveTo),
                      r.driverPersonId,
                      r.meterReading,
                      r.condition,
                      r.reason,
                    ]),
                  }}
                  actions={i => (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        open(assignments[i].vehicleId, "assignments")
                      }
                    >
                      统一详情
                    </Button>
                  )}
                />
              )}
            </>
          )}
          {tab === "maintenance" && (
            <>
              {records.isError ? (
                <p role="alert">维修保养读取失败，请刷新</p>
              ) : records.isLoading ? (
                <p>正在读取维修与保养…</p>
              ) : (
                <>
                  <VehicleManagementReport
                    report={{
                      title: "车辆故障与维修工单",
                      scope,
                      headers: [
                        "车牌",
                        "工单",
                        "故障",
                        "状态",
                        "服务商",
                        "停驶时间",
                        "修复",
                        "验收",
                        "放行",
                      ],
                      rows: orders.map(r => [
                        plate(r.vehicleId),
                        r.id,
                        r.fault,
                        vehicleLabel(r.status),
                        r.serviceProvider,
                        vehicleDateTime(r.stoppedAt),
                        vehicleDateTime(r.repairedAt),
                        vehicleDateTime(r.acceptedAt),
                        vehicleDateTime(r.releasedAt),
                      ]),
                    }}
                    actions={i => (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => open(orders[i].vehicleId, "maintenance")}
                      >
                        维修办理
                      </Button>
                    )}
                  />
                  <VehicleManagementReport
                    report={{
                      title: "车辆保养提醒",
                      scope,
                      headers: [
                        "车牌",
                        "计划",
                        "日期条件",
                        "日期判断",
                        "里程条件",
                        "真实当前里程",
                        "里程判断",
                        "周期依据",
                        "完成时间",
                      ],
                      rows: plans.map(r => [
                        plate(r.vehicleId),
                        r.title,
                        vehicleDate(r.dueOn),
                        r.completedAt
                          ? "已完成"
                          : vehicleDateReminder(r.dueOn, today),
                        r.dueMileage,
                        r.lastMileage,
                        r.completedAt
                          ? "已完成"
                          : vehicleMileageReminder(r.dueMileage, r.lastMileage),
                        r.source,
                        vehicleDateTime(r.completedAt),
                      ]),
                    }}
                    actions={i => (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => open(plans[i].vehicleId, "maintenance")}
                      >
                        保养办理
                      </Button>
                    )}
                  />
                </>
              )}
              <VehicleManagementReport
                report={{
                  title: "车辆检查与报修入口",
                  scope,
                  headers: ["车牌", "技术状态", "调度状态"],
                  rows: filtered.map(v => [
                    v.plateNo,
                    vehicleLabel(v.profile?.technicalStatus),
                    vehicleLabel(v.profile?.dispatchStatus),
                  ]),
                }}
                actions={i => (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => open(filtered[i].id, "maintenance")}
                  >
                    检查 / 报修
                  </Button>
                )}
              />
            </>
          )}
          {tab === "compliance" && (
            <>
              {records.isError ? (
                <p role="alert">证照安全记录读取失败，请刷新</p>
              ) : records.isLoading ? (
                <p>正在读取证照资料…</p>
              ) : (
                <>
                  <VehicleManagementReport
                    report={{
                      title: "车辆证照有效期与核验",
                      scope,
                      headers: [
                        "车牌",
                        "名称",
                        "类型",
                        "有效期开始",
                        "截止",
                        "核验状态",
                        "到期提示",
                        "核验说明",
                      ],
                      rows: docs.map(r => [
                        plate(r.vehicleId),
                        r.title,
                        vehicleLabel(r.kind),
                        vehicleDate(r.validFrom),
                        vehicleDate(r.validTo),
                        r.verificationStatus === "pending"
                          ? "待核验"
                          : vehicleLabel(r.verificationStatus),
                        r.verificationStatus === "not_applicable"
                          ? "不适用"
                          : vehicleDateReminder(r.validTo, today),
                        r.verificationNote,
                      ]),
                      summary:
                        "车辆运输证属于车辆，经营许可属于主体，驾驶员资格在人员档案；是否适用按用途核实。",
                    }}
                    actions={i => (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => open(docs[i].vehicleId, "documents")}
                      >
                        预览 / 核验
                      </Button>
                    )}
                  />
                  <VehicleManagementReport
                    report={{
                      title: "车辆安全检查记录",
                      scope: `${scope} · ${dateScope}`,
                      headers: [
                        "车牌",
                        "检查时间",
                        "实际里程",
                        "安全故障",
                        "说明",
                      ],
                      rows: inspections.map(r => [
                        plate(r.vehicleId),
                        vehicleDateTime(r.occurredAt),
                        r.meterReading,
                        r.safetyFault ? "存在，已停调" : "未认定",
                        r.notes,
                      ]),
                    }}
                    actions={i => (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          open(inspections[i].vehicleId, "documents")
                        }
                      >
                        安全详情
                      </Button>
                    )}
                  />
                </>
              )}
              <VehicleManagementReport
                report={{
                  title: "车辆证照与专项维护入口",
                  scope,
                  headers: ["车牌", "车型", "当前状态"],
                  rows: filtered.map(v => [
                    v.plateNo,
                    vehicleLabel(v.vehicleType),
                    vehicleLabel(v.profile?.technicalStatus),
                  ]),
                }}
                actions={i => (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => open(filtered[i].id, "documents")}
                  >
                    上传 / 续办 / 专项
                  </Button>
                )}
              />
            </>
          )}
          {tab === "finance" && (
            <>
              <label className="block max-w-xs text-xs">
                本期月份
                <Input
                  aria-label="车辆费用月份"
                  type="month"
                  value={period}
                  onChange={e => setPeriod(e.target.value)}
                />
              </label>
              <p className="text-xs leading-5 text-muted-foreground">
                本期与截至月末累计独立显示。自有经营、租入成本和外协车主应付不混称公司净利润；代付油料和配件按真实抵扣事实计算。
              </p>
              {finance.isError ? (
                <p role="alert">
                  {getUserFacingErrorMessage(finance.error, "车辆费用读取失败")}
                </p>
              ) : finance.isLoading ? (
                <p>正在读取结算与付款事实…</p>
              ) : (
                <VehicleManagementReport
                  report={{
                    title: "车辆本期费用与截至月末余额",
                    scope: `${scope} · ${period}`,
                    headers: [
                      "车牌",
                      "账务项目",
                      "性质",
                      "本期已核定运费",
                      "待核验",
                      "油料",
                      "维修保养",
                      "配件",
                      "已核定租赁",
                      "未核定租赁估算",
                      "本期实付",
                      "累计待付",
                      "累计待收补款",
                    ],
                    rows: summaryRows.map(r => [
                      plate(r.vehicleId),
                      projects.find(p => p.id === r.projectId)?.name ??
                        r.projectId,
                      r.financialNature === "owned"
                        ? "自有经营参考"
                        : r.financialNature === "leased"
                          ? "租入成本"
                          : "外协应付",
                      r.confirmedTransportAmount,
                      r.pendingTransportAmount,
                      r.fuelAmount,
                      r.repairAmount + r.maintenanceAmount,
                      r.partsAmount,
                      r.confirmedLeaseAmount,
                      r.unconfirmedLeaseEstimateAmount,
                      r.actualPaidAmount,
                      r.cumulative.remainingPayableAmount,
                      r.cumulative.remainingReceivableAmount,
                    ]),
                    summary:
                      "全部筛选结果使用统一服务端投影；合同估算不计作已核定费用，状态已付但缺凭证的历史账不推定已付。",
                  }}
                  actions={i => (
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => open(summaryRows[i].vehicleId, "costs")}
                      >
                        费用明细
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          open(summaryRows[i].vehicleId, "settlements")
                        }
                      >
                        结算付款
                      </Button>
                    </div>
                  )}
                />
              )}
            </>
          )}
        </>
      )}
      {create && (
        <VehicleRegistryForm
          projects={projects}
          organizations={organizations}
          projectId={projectId}
          onClose={() => confirmVehicleDiscard(true, () => setCreate(false))}
          onSaved={id => {
            setCreate(false);
            changed();
            open(id);
          }}
        />
      )}
      {detail && (
        <VehicleManagementDetail
          key={detail.id}
          vehicleId={detail.id}
          initialTab={detail.tab}
          projects={projects}
          organizations={organizations}
          vehicles={(list.data?.items ?? []).map(v => ({
            id: v.id,
            plateNo: v.plateNo,
          }))}
          onClose={() => {
            setDetail(null);
            setDetailDirty(false);
          }}
          onDirtyChange={recordDetailDirty}
          onChanged={changed}
        />
      )}
    </section>
  );
}
