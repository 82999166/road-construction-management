import { escapePrintHtml } from "@/lib/a4Print";
import {
  formatChinaDate,
  formatChinaDateTime,
  formatChinaTime,
} from "@/lib/businessTime";

export const VEHICLE_MANAGEMENT_TABS = [
  { value: "overview", label: "车辆总览" },
  { value: "registry", label: "车辆档案" },
  { value: "assignments", label: "司机与进退场" },
  { value: "maintenance", label: "维修与保养" },
  { value: "compliance", label: "证照与安全" },
  { value: "finance", label: "费用与结算" },
] as const;
export type VehicleManagementTab =
  (typeof VEHICLE_MANAGEMENT_TABS)[number]["value"];
export const VEHICLE_DETAIL_TABS = [
  { value: "base", label: "基础资料" },
  { value: "assignments", label: "司机与交接" },
  { value: "operations", label: "作业记录" },
  { value: "costs", label: "费用" },
  { value: "maintenance", label: "维修" },
  { value: "documents", label: "证照" },
  { value: "settlements", label: "结算" },
  { value: "history", label: "历史" },
] as const;
export type VehicleDetailTab = (typeof VEHICLE_DETAIL_TABS)[number]["value"];
export const VEHICLE_TYPE_LABELS = {
  dump_truck: "渣土车",
  tractor: "牵引车",
  mixer: "搅拌车",
  flatbed: "平板车",
  pickup: "皮卡",
  suv: "越野车",
  trailer: "挂车",
  other: "其他",
} as const;
export const VEHICLE_LABELS: Record<string, string> = {
  reported: "待报修",
  repairing: "维修中",
  awaiting_acceptance: "待验收",
  draft: "草稿",
  submitted: "待审核",
  settled: "已结算",
  approved: "已核准",
  partial: "部分付款",
  paid: "已付款",
  void: "已作废",
  receivable: "待收补款",
  offset: "已抵扣",
  fault: "故障",
  not_configured: "未配置",
  ...VEHICLE_TYPE_LABELS,
  active: "启用",
  suspended: "暂停",
  disabled: "停用",
  owned: "公司自有",
  leased: "租入",
  trip_settlement: "旧按趟结算",
  company_owned: "公司自有",
  rented: "租入",
  partner: "外协合作",
  monthly: "按月",
  daily: "按天",
  hourly: "按小时",
  shift: "按台班",
  trip: "按趟",
  ton: "按吨",
  volume: "按方",
  none: "不计价",
  normal: "技术正常",
  repair: "维修中",
  safety_hold: "安全禁用",
  standby: "待命",
  working: "作业中",
  paused: "暂停调度",
  pending: "待进场",
  on_site: "在场",
  exited: "已退场",
  enter: "进场",
  transfer: "项目调配",
  exit: "退场",
  handover: "司机交接",
  verified: "已核验",
  rejected: "核验拒绝",
  not_applicable: "不适用",
  uploaded: "待核验",
  unverified: "待核验",
  pass: "通过",
  fail: "不通过",
  unknown: "未知",
  open: "待处理",
  in_progress: "处理中",
  pending_acceptance: "待验收",
  accepted: "已验收待放行",
  released: "已放行",
  vehicle_registration: "行驶证",
  transport_permit: "道路运输证",
  insurance: "保险",
  inspection: "检验",
  annual_review: "年度审验",
  earthwork: "渣土专项",
  monitoring: "监控档案",
  owner: "车主",
  driver: "司机",
  service_period: "服务期间",
  all_history: "全部历史",
  company: "公司",
  shared: "共同承担",
};
export function vehicleLabel(value: string | null | undefined) {
  return value ? (VEHICLE_LABELS[value] ?? "其他状态（请核实）") : "未配置";
}
export function vehicleMoney(value: number | string | null | undefined) {
  return value == null
    ? "未提供"
    : Number(value).toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
}
export function vehicleDate(value: Date | string | number | null | undefined) {
  return formatChinaDate(value, "未登记");
}
export function vehicleDateTime(
  value: Date | string | number | null | undefined
) {
  return formatChinaDateTime(value, "未登记");
}
export function optionalNumber(value: string) {
  if (!value.trim()) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0)
    throw new Error("数字必须为非负有效数值");
  return number;
}
export function requiredNumber(value: string, label: string) {
  const number = optionalNumber(value);
  if (number == null) throw new Error(`请填写${label}`);
  return number;
}
export function dateTimeEpoch(value: string) {
  const explicitZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  const result = new Date(explicitZone ? value : `${value}+08:00`).getTime();
  if (!Number.isFinite(result)) throw new Error("请填写有效发生时间");
  return result;
}
export function requireVehicleChoice<T extends string>(
  value: string,
  choices: readonly T[],
  label: string
): T {
  const choice = choices.find(item => item === value);
  if (!choice) throw new Error(`请选择有效${label}`);
  return choice;
}
export function confirmVehicleDiscard(
  dirty: boolean,
  discard: () => void,
  confirm: (message: string) => boolean = message => window.confirm(message)
) {
  if (dirty && !confirm("尚有未保存车辆草稿，确认放弃修改？此操作不是保存。"))
    return false;
  discard();
  return true;
}
export function vehicleDateReminder(
  dueOn: string | Date | null | undefined,
  today: string
) {
  if (!dueOn) return "日期未配置";
  const due = vehicleDate(dueOn);
  const delta = (Date.parse(due) - Date.parse(today)) / 86400000;
  if (!Number.isFinite(delta)) return "日期未知";
  return delta < 0
    ? "已到期"
    : delta <= 30
      ? `距到期${delta}天`
      : "未到日期条件";
}
export function vehicleMileageReminder(
  due: string | number | null | undefined,
  current: string | number | null | undefined
) {
  if (due == null) return "里程条件未配置";
  if (current == null || !Number.isFinite(Number(current)))
    return "当前里程未知";
  return Number(current) >= Number(due)
    ? "已到里程条件"
    : `剩余${Number(due) - Number(current)}公里`;
}
export type VehicleReportCell = string | number | null | undefined;
export type VehicleReport = {
  title: string;
  scope: string;
  headers: string[];
  rows: VehicleReportCell[][];
  summary?: string;
};
/** 接受全量筛选结果；调用方不能传 pageRows。元数据白名单不得包含存储key/预览URL。 */
export function buildVehicleReport(report: VehicleReport) {
  const e = escapePrintHtml;
  return `<h1>${e(report.title)}</h1><p class="sub">${e(report.scope)} · 全部筛选结果 ${report.rows.length} 条</p><hr class="rule"><table><thead><tr>${report.headers.map(header => `<th>${e(header)}</th>`).join("")}</tr></thead><tbody>${report.rows.length ? report.rows.map(row => `<tr>${row.map(cell => `<td>${e(cell)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${report.headers.length}">暂无符合当前筛选条件的记录</td></tr>`}</tbody></table><p class="sub">${e(report.summary ?? "本表仅为真实业务登记与核验记录，不等同监管平台联单或完整利润报表。")}</p><div class="footer"><span>制表：____________</span><span>核验：____________</span></div>`;
}
export interface VehicleFilter {
  projectId: string;
  search: string;
  type: string;
  status: string;
  property: string;
  technical: string;
  dispatch: string;
  projectStatus: string;
}
export const INITIAL_VEHICLE_FILTER: VehicleFilter = {
  projectId: "all",
  search: "",
  type: "all",
  status: "all",
  property: "all",
  technical: "all",
  dispatch: "all",
  projectStatus: "all",
};
export interface FilterableVehicle {
  id: number;
  projectId: number;
  plateNo: string;
  ownerName?: string | null;
  driverName?: string | null;
  vehicleType: string;
  status: string;
  profile?: {
    purpose?: string;
    propertyType: string;
    technicalStatus: string;
    dispatchStatus: string;
    projectStatus: string;
  } | null;
}
export function filterVehicleRows<T extends FilterableVehicle>(
  rows: readonly T[],
  filters: VehicleFilter
): T[] {
  const search = filters.search.trim().toLocaleLowerCase();
  return rows.filter(
    row =>
      (filters.projectId === "all" ||
        String(row.projectId) === filters.projectId) &&
      (!search ||
        [row.plateNo, row.ownerName, row.driverName].some(value =>
          value?.toLocaleLowerCase().includes(search)
        )) &&
      (filters.type === "all" ||
        (filters.type === "trailer"
          ? row.profile?.purpose === "trailer"
          : row.vehicleType === filters.type)) &&
      (filters.status === "all" || row.status === filters.status) &&
      (filters.property === "all" ||
        (row.profile?.propertyType ?? "unconfigured") === filters.property) &&
      (filters.technical === "all" ||
        (row.profile?.technicalStatus ?? "unconfigured") ===
          filters.technical) &&
      (filters.dispatch === "all" ||
        (row.profile?.dispatchStatus ?? "unconfigured") === filters.dispatch) &&
      (filters.projectStatus === "all" ||
        (row.profile?.projectStatus ?? "unconfigured") ===
          filters.projectStatus)
  );
}

export function vehicleDateTimeInput(
  value: Date | string | number = new Date()
) {
  const day = formatChinaDate(value, "");
  return day ? `${day}T${formatChinaTime(value, "")}` : "";
}
