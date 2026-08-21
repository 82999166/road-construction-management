import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout, { type DashboardMenuItem } from "@/components/DashboardLayout";
import type { TransportLedgerFilter } from "@/components/TransportTripLedger";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import * as XLSX from "xlsx";
import { DEFAULT_EVIDENCE_WATERMARK_TEMPLATE, WATERMARK_FIELD_OPTIONS, type EvidenceWatermarkTemplate } from "@shared/watermarkTemplate";
import {
  Building2,
  BarChart3,
  Calculator,
  DatabaseBackup,
  ExternalLink,
  FileText,
  FolderKanban,
  Fuel,
  KeyRound,
  LayoutDashboard,
  Megaphone,
  Printer,
  Camera,
  ScrollText,
  ShoppingCart,
  Settings2,
  ShieldCheck,
  Sparkles,
  Truck,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { lazy, Suspense, type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

/** 仅在相应后台菜单进入时加载独立工作区，避免财税、结算和工具模块膨胀管理端首屏包。 */
const SettlementTemplateCalculator = lazy(() => import("@/components/SettlementTemplateCalculator"));
const ConstructionToolbox = lazy(() => import("@/components/ConstructionToolbox"));
const ContractManagementPanel = lazy(() => import("@/components/ContractManagementPanel"));
const RoadRailKnowledgeBase = lazy(() => import("@/components/RoadRailKnowledgeBase"));
const RfidLocalWriterPanel = lazy(() => import("@/components/RfidLocalWriterPanel"));
const TransportTripLedger = lazy(() => import("@/components/TransportTripLedger"));
const TransportRouteSafetySettings = lazy(() => import("@/components/TransportRouteSafetySettings").then(module => ({ default: module.TransportRouteSafetySettings })));
const TransportRouteConfigurationEditor = lazy(() => import("@/components/TransportRouteConfigurationEditor").then(module => ({ default: module.TransportRouteConfigurationEditor })));
const TransportVehicleSettlementManager = lazy(() => import("@/components/TransportVehicleSettlementManager"));
const MachinePaymentSettlementManager = lazy(() => import("@/components/MachinePaymentSettlementManager"));
const SubcontractPaymentSettlementManager = lazy(() => import("@/components/SubcontractPaymentSettlementManager"));
const TaxAccountingHandoffManager = lazy(() => import("@/components/TaxAccountingHandoffManager"));

/**
 * PC 端为统一管理入口中的全局治理工作台。菜单只负责界面导航，服务端仍会对每个全局治理接口执行超级管理员校验。
 */
const ADMIN_MENU: DashboardMenuItem[] = [
  { icon: LayoutDashboard, label: "运营概览", path: "/admin", section: "决策总览" },
  { icon: Building2, label: "组织与项目", path: "/admin/organization", section: "项目执行" },
  { icon: FolderKanban, label: "施工管理", path: "/admin/construction", section: "项目执行" },
  { icon: Truck, label: "车辆管理", path: "/admin/vehicles", section: "资源协同" },
  { icon: Settings2, label: "机械管理", path: "/admin/machinery", section: "资源协同" },
  { icon: Truck, label: "运输管理", path: "/admin/transport", section: "资源协同" },
  { icon: UsersRound, label: "劳务工资", path: "/admin/labor", section: "资源协同" },
  { icon: UsersRound, label: "权限管理", path: "/admin/permission", section: "资源协同" },
  { icon: BarChart3, label: "财务管理", path: "/admin/finance", section: "业财与控制" },
  { icon: ShoppingCart, label: "采购与仓储", path: "/admin/purchasing", section: "业财与控制" },
  { icon: Calculator, label: "计量工具", path: "/admin/measurement-tools", section: "业财与控制" },
  { icon: FolderKanban, label: "工程结算与分包", path: "/admin/subcontract", section: "业财与控制" },
  { icon: FileText, label: "合同管理", path: "/admin/contracts", section: "业财与控制" },
  { icon: ShieldCheck, label: "AI 项目风控", path: "/admin/risk", section: "业财与控制" },
  { icon: Fuel, label: "柴油管理", path: "/admin/diesel", section: "业财与控制" },
  { icon: Megaphone, label: "范围通知", path: "/admin/broadcast", section: "业财与控制" },
  { icon: KeyRound, label: "微信登录管理", path: "/admin/wechat-login", section: "平台治理" },
  { icon: BarChart3, label: "业务治理与备份", path: "/admin/business", section: "平台治理" },
  { icon: Settings2, label: "系统设置", path: "/admin/settings", section: "平台治理" },
  { icon: ScrollText, label: "发布与审计", path: "/admin/audit", section: "平台治理" },
];

/** 超级管理员从业务治理页进入时，优先落在 PC 端受控台账；其他模块仍使用已部署的既有工作台。 */
export const ADMIN_BUSINESS_ROUTE_BY_MODULE: Record<string, string> = {
  CONSTRUCTION: "/admin/construction",
  LABOR: "/admin/labor",
  MACHINERY: "/admin/machinery",
  TRANSPORT: "/admin/transport",
};

type OrganizationType = "group" | "company" | "project_department" | "department" | "team";
type DepartmentModuleCode = "CONSTRUCTION" | "LABOR" | "MACHINERY" | "TRANSPORT" | "PURCHASING" | "MEASUREMENT" | "FINANCE" | "EVIDENCE";
type OrganizationStatus = "active" | "disabled";
type ProjectType = "highway" | "railway" | "municipal" | "other";
type ProjectStatus = "planning" | "active" | "suspended" | "completed" | "archived";

type OrganizationForm = { id?: number; parentId: string; code: string; name: string; type: OrganizationType; managerUserId: string; costCenterCode: string; sortOrder: string; status: OrganizationStatus };
type ProjectForm = { id?: number; parentId: string; organizationId: string; code: string; name: string; nodeType: string; projectType: ProjectType; status: ProjectStatus; startDate: string; endDate: string; costCenterCode: string; sortOrder: string };
type PositionForm = { id?: number; code: string; name: string; category: string; description: string; status: OrganizationStatus };
type VehicleType = "dump_truck" | "tractor" | "mixer" | "flatbed" | "pickup" | "suv" | "other";
type VehicleStatus = "active" | "suspended" | "disabled";
type LeaseBillingType = "monthly" | "daily" | "hourly" | "shift";
type VehicleForm = { id?: number; projectId: string; organizationId: string; plateNo: string; vehicleType: VehicleType; ownership: "owned" | "leased" | "trip_settlement"; ownerName: string; driverUserId: string; driverName: string; driverPhone: string; boxLengthMeters: string; boxWidthMeters: string; boxHeightMeters: string; loadFactor: string; payloadTons: string; fuelTankCapacityLiters: string; status: VehicleStatus; leaseBillingType: LeaseBillingType; leaseRate: string; leaseStartDate: string; leaseEndDate: string };
type MachineOwnership = "owned" | "leased";
type MachineStatus = "idle" | "working" | "repairing" | "offsite" | "retired";
type MachineCostType = "fuel" | "repair" | "overtime" | "mobilization" | "other";
type MachineForm = { id?: number; projectId: string; operatorUserId: string; code: string; name: string; model: string; ownership: MachineOwnership; supplierName: string; plateOrAssetNo: string; driverName: string; driverPhone: string; fuelTankCapacityLiters: string; status: MachineStatus; leaseBillingType: LeaseBillingType; leaseRate: string; leaseStartDate: string; leaseEndDate: string };
type MachineCostForm = { machineId: string; projectId: string; costType: MachineCostType; quantity: string; unitPrice: string; occurredAt: string };
type MachineMonthlyStatementForm = { machineId: string; projectId: string; period: string; driverUserId: string; machineWorkDays: string; machineOvertimeHours: string; driverMonthlyWage: string; driverWorkDays: string; driverOvertimeHours: string; signatureName: string; remarks: string };
type EmployeeType = "management" | "operator" | "construction_worker";
type EmployeeProfileForm = { id?: number; userId: string; laborWorkerId: string; projectId: string; employeeType: EmployeeType; teamName: string; employmentStatus: "active" | "suspended" | "left"; joinedAt: string; leftAt: string; salaryBasis: "monthly" | "daily" | "hourly" | "piecework"; baseSalary: string; remarks: string };
type EmployeeInsuranceForm = { id?: number; employeeProfileId: string; insuranceType: "work_injury" | "accident" | "medical" | "employer_liability" | "other"; providerName: string; policyReference: string; purchasedAt: string; expiresAt: string; status: "active" | "expired" | "cancelled"; remarks: string };
type AssetMaintenanceForm = { id?: number; assetType: "vehicle" | "machine"; assetId: string; projectId: string; costCategory: "maintenance" | "repair"; amount: string; occurredAt: string; serviceProvider: string; meterReading: string; nextDueAt: string; remarks: string; status: "draft" | "approved" | "settled" | "void" };
type DieselPriceForm = { id?: number; projectId: string; pricePerLiter: string; effectiveFrom: string; effectiveTo: string; status: "draft" | "active" | "disabled"; remarks: string };
type DieselRefuelForm = { id?: number; projectId: string; assetType: "vehicle" | "machine"; vehicleId: string; machineId: string; transportTripId: string; supplyMethod: "project_supply" | "external_station"; stationOrSupplierName: string; liters: string; actualUnitPrice: string; deductFromFreight: boolean; refueledAt: string; meterReading: string; receiptNo: string; remarks: string; status: "draft" | "approved" | "void" };
type RiskRuleForm = { enabled: boolean; maxFuelFillRatio: string; maxTransportSpeedKmh: string; maxTransportDurationMinutes: string; maxOpenCheckInHours: string; maxPendingReportHours: string; overdueEscalationEnabled: boolean; overdueEscalationHourChina: string };
type RfidWriterDeviceForm = { id?: number; deviceCode: string; displayName: string; model: string; connectionMode: "manual_placeholder" | "usb" | "serial" | "network"; status: "active" | "disabled" | "maintenance"; remarks: string };
type RfidCardForm = { id?: number; vehicleId: string; writerDeviceId: string; cardUid: string; driverPhone: string; status: "active" | "suspended" | "revoked" };
type LocalAccountStatus = "active" | "disabled";
type LocalLoginMode = "pc" | "mobile" | "both";
type LocalAccountEditForm = { userId: number; username: string; displayName: string; status: LocalAccountStatus; loginMode: LocalLoginMode };
type LocalAccountActionTarget = { id: number; name: string; username: string };
type AssignmentForm = { id?: number; userId: string; roleId: string; organizationId: string; projectId: string; validFrom: string; validTo: string };
type RoleForm = { id?: number; code: string; name: string; category: "system" | "business"; description: string; status: OrganizationStatus; isSystem: boolean };
type SettingForm = { id?: number; expectedVersion?: number; category: string; settingKey: string; displayName: string; value: string; isSensitive: boolean; remarks: string };
type OfficialAccountConfigurationForm = { appId: string; appSecret: string; appUrl: string; egressUrl: string; egressSigningSecret: string };
type ExternalAiApiConfigurationForm = { baseUrl: string; apiKey: string; model: string; enabled: boolean };
type SettingDeleteTarget = { id: number; displayName: string; settingKey: string; version: number; isSensitive: boolean };
type DailyDigestForm = { enabled: boolean; deliveryHour: string; deliveryMinute: string; includeEmptyProjects: boolean };
type BroadcastAudienceType = "project" | "organization" | "role";
type BroadcastForm = { id?: number; title: string; content: string; deepLink: string; audienceType: BroadcastAudienceType; scopeValue: string };
type MasterDataResource = "organization" | "position" | "project" | "vehicle" | "role" | "department_scope" | "role_assignment";
type MasterDataDeleteTarget = { resource: MasterDataResource; id: number; label: string; description: string };
type PayrollPaymentTarget = { id: number; workerName: string; period: string };
type WechatBindingActionTarget = { userId: number; displayName: string };
type ConstructionWeather = "sunny" | "cloudy" | "rainy" | "snowy" | "windy" | "other";
type ConstructionReportEditor = { id?: number; projectId: number; status: "draft" | "submitted" | "approved" | "rejected" | "locked"; reportDate: string; workArea: string; weather: ConstructionWeather; workContent: string; safetyNotes: string; issueNotes: string; progressPercent: string };
type SubcontractTeamForm = { id?: number; projectId: string; teamName: string; contactName: string; contactPhone: string; status: "active" | "suspended" | "closed"; remarks: string };
type SubcontractPackageForm = { id?: number; projectId: string; measurementTakeoffId: string; subcontractTeamId: string; workItem: string; workLocation: string; unit: "m3" | "m2" | "m" | "t" | "piece" | "set" | "other"; quantity: string; upstreamUnitPrice: string; subcontractUnitPrice: string; priceExceptionReason: string; remarks: string };
type MeasurementTakeoffForm = { id?: number; projectId: string; workItem: string; workLocation: string; unit: "m3" | "m2" | "m" | "t" | "piece" | "set" | "other"; quantity: string; unitPrice: string; takeoffDate: string };
type InventoryTransactionForm = { projectId: string; transactionType: "inbound" | "outbound" | "return"; itemName: string; unit: string; quantity: string; unitCost: string; occurredAt: string; remarks: string };
type DesktopRecordDetail = { title: string; description: string; fields: Array<{ label: string; value: ReactNode }>; note?: string };

const EMPTY_ORGANIZATION_FORM: OrganizationForm = { parentId: "", code: "", name: "", type: "department", managerUserId: "", costCenterCode: "", sortOrder: "0", status: "active" };
const EMPTY_PROJECT_FORM: ProjectForm = { parentId: "", organizationId: "", code: "", name: "", nodeType: "项目", projectType: "highway", status: "planning", startDate: "", endDate: "", costCenterCode: "", sortOrder: "0" };
const EMPTY_POSITION_FORM: PositionForm = { code: "", name: "", category: "业务岗位", description: "", status: "active" };
const EMPTY_VEHICLE_FORM: VehicleForm = { projectId: "", organizationId: "", plateNo: "", vehicleType: "dump_truck", ownership: "owned", ownerName: "", driverUserId: "", driverName: "", driverPhone: "", boxLengthMeters: "", boxWidthMeters: "", boxHeightMeters: "", loadFactor: "1", payloadTons: "", fuelTankCapacityLiters: "", status: "active", leaseBillingType: "monthly", leaseRate: "", leaseStartDate: "", leaseEndDate: "" };
const EMPTY_MACHINE_FORM: MachineForm = { projectId: "", operatorUserId: "", code: "", name: "", model: "", ownership: "owned", supplierName: "", plateOrAssetNo: "", driverName: "", driverPhone: "", fuelTankCapacityLiters: "", status: "idle", leaseBillingType: "monthly", leaseRate: "", leaseStartDate: "", leaseEndDate: "" };
/** 稳定的模块级字段包装组件，禁止在页面渲染函数内定义，避免受控输入在每次状态更新时失焦。 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><Label>{label}</Label><div className="mt-1">{children}</div></div>;
}
const EMPTY_RISK_RULE_FORM: RiskRuleForm = { enabled: true, maxFuelFillRatio: "1.1", maxTransportSpeedKmh: "80", maxTransportDurationMinutes: "360", maxOpenCheckInHours: "14", maxPendingReportHours: "24", overdueEscalationEnabled: false, overdueEscalationHourChina: "9" };
const EMPTY_MACHINE_COST_FORM: MachineCostForm = { machineId: "", projectId: "", costType: "fuel", quantity: "", unitPrice: "", occurredAt: "" };
const EMPTY_MACHINE_MONTHLY_STATEMENT_FORM: MachineMonthlyStatementForm = { machineId: "", projectId: "", period: "", driverUserId: "", machineWorkDays: "0", machineOvertimeHours: "0", driverMonthlyWage: "0", driverWorkDays: "0", driverOvertimeHours: "0", signatureName: "", remarks: "" };
const EMPTY_EMPLOYEE_PROFILE_FORM: EmployeeProfileForm = { userId: "", laborWorkerId: "", projectId: "", employeeType: "management", teamName: "", employmentStatus: "active", joinedAt: "", leftAt: "", salaryBasis: "monthly", baseSalary: "", remarks: "" };
const EMPTY_EMPLOYEE_INSURANCE_FORM: EmployeeInsuranceForm = { employeeProfileId: "", insuranceType: "work_injury", providerName: "", policyReference: "", purchasedAt: "", expiresAt: "", status: "active", remarks: "" };
const EMPTY_ASSET_MAINTENANCE_FORM: AssetMaintenanceForm = { assetType: "vehicle", assetId: "", projectId: "", costCategory: "maintenance", amount: "", occurredAt: "", serviceProvider: "", meterReading: "", nextDueAt: "", remarks: "", status: "draft" };
const EMPTY_DIESEL_PRICE_FORM: DieselPriceForm = { projectId: "", pricePerLiter: "", effectiveFrom: toLocalDateInput(), effectiveTo: "", status: "active", remarks: "" };
const EMPTY_DIESEL_REFUEL_FORM: DieselRefuelForm = { projectId: "", assetType: "vehicle", vehicleId: "", machineId: "", transportTripId: "", supplyMethod: "project_supply", stationOrSupplierName: "", liters: "", actualUnitPrice: "", deductFromFreight: false, refueledAt: toLocalDateTimeInput(new Date()), meterReading: "", receiptNo: "", remarks: "", status: "approved" };
const EMPTY_RFID_WRITER_DEVICE_FORM: RfidWriterDeviceForm = { deviceCode: "", displayName: "", model: "", connectionMode: "manual_placeholder", status: "active", remarks: "" };
const EMPTY_RFID_CARD_FORM: RfidCardForm = { vehicleId: "", writerDeviceId: "", cardUid: "", driverPhone: "", status: "active" };
const EMPTY_ROLE_FORM: RoleForm = { code: "", name: "", category: "business", description: "", status: "active", isSystem: false };
const EMPTY_ASSIGNMENT_FORM: AssignmentForm = { userId: "", roleId: "", organizationId: "", projectId: "", validFrom: "", validTo: "" };
const EMPTY_SETTING_FORM: SettingForm = { category: "微信公众号服务号", settingKey: "", displayName: "", value: "", isSensitive: false, remarks: "" };
const EMPTY_OFFICIAL_ACCOUNT_CONFIGURATION_FORM: OfficialAccountConfigurationForm = { appId: "", appSecret: "", appUrl: "https://roadmanage-xjifzbue.manus.space", egressUrl: "https://wechat-egress.maomaoyx.com", egressSigningSecret: "" };
const EMPTY_EXTERNAL_AI_API_CONFIGURATION_FORM: ExternalAiApiConfigurationForm = { baseUrl: "", apiKey: "", model: "", enabled: false };
const EMPTY_DAILY_DIGEST_FORM: DailyDigestForm = { enabled: false, deliveryHour: "17", deliveryMinute: "30", includeEmptyProjects: false };
const EMPTY_BROADCAST_FORM: BroadcastForm = { title: "", content: "", deepLink: "/mobile/messages", audienceType: "project", scopeValue: "" };
const EMPTY_SUBCONTRACT_TEAM_FORM: SubcontractTeamForm = { projectId: "", teamName: "", contactName: "", contactPhone: "", status: "active", remarks: "" };
const EMPTY_SUBCONTRACT_PACKAGE_FORM: SubcontractPackageForm = { projectId: "", measurementTakeoffId: "", subcontractTeamId: "", workItem: "", workLocation: "", unit: "m3", quantity: "", upstreamUnitPrice: "", subcontractUnitPrice: "", priceExceptionReason: "", remarks: "" };
const EMPTY_MEASUREMENT_TAKEOFF_FORM: MeasurementTakeoffForm = { projectId: "", workItem: "", workLocation: "", unit: "m3", quantity: "", unitPrice: "", takeoffDate: toLocalDateInput() };
const EMPTY_INVENTORY_TRANSACTION_FORM: InventoryTransactionForm = { projectId: "", transactionType: "inbound", itemName: "", unit: "件", quantity: "", unitCost: "0", occurredAt: toLocalDateTimeInput(new Date()), remarks: "" };
const CONSTRUCTION_WEATHER_LABELS: Record<ConstructionWeather, string> = { sunny: "晴", cloudy: "多云", rainy: "雨", snowy: "雪", windy: "大风", other: "其他" };
const OFFICIAL_ACCOUNT_BASE_SETTING_KEYS = new Set([
  "WECHAT_OFFICIAL_APP_ID",
  "WECHAT_OFFICIAL_APP_SECRET",
  "WECHAT_OFFICIAL_APP_URL",
  "WECHAT_OFFICIAL_EGRESS_URL",
  "WECHAT_OFFICIAL_EGRESS_SHARED_SECRET",
]);
/** 服务号配置的敏感等级由后端契约决定，避免管理员手动误将 AppID 等运行参数保存为密文。 */
function resolveOfficialAccountSensitivity(settingKey: string, fallback: boolean) {
  if (settingKey === "WECHAT_OFFICIAL_APP_SECRET") return true;
  if (settingKey === "WECHAT_OFFICIAL_EGRESS_SHARED_SECRET") return true;
  if (settingKey.startsWith("WECHAT_OFFICIAL_")) return false;
  return fallback;
}

/** 将同一安全测试按新版服务号配置阶段呈现为管理员可理解的操作标签。 */
function getOfficialAccountTestLabel(settingKey: string) {
  if (settingKey === "WECHAT_OFFICIAL_APP_ID" || settingKey === "WECHAT_OFFICIAL_APP_SECRET") return "校验开发密钥";
  if (settingKey === "WECHAT_OFFICIAL_TEMPLATE_ID" || settingKey === "WECHAT_OFFICIAL_TEMPLATE_FIELDS") return "检查通知就绪";
  if (settingKey === "WECHAT_OFFICIAL_APP_URL") return "校验绑定前置";
  return "校验服务号";
}

/** 兼容 API 返回 Date 或字符串的时间展示方法。 */
function displayDate(value: Date | string | null | undefined) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
}

/** 考勤业务台账只显示中文详细地址；坐标仅可在有用途说明的争议核验接口中受控读取。 */
function formatAttendanceLocation(address: string | null | undefined, status: "normal" | "location_missing" | null | undefined) {
  if (status !== "normal") return "未上传定位";
  return address?.trim() || "定位已采集，中文详细地址待解析";
}

/** 本地日期筛选以用户浏览器日历为准，避免将 UTC 日期偏移带入运输日结算口径。 */
function toLocalDateInput(value = new Date()) {
  const localValue = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return localValue.toISOString().slice(0, 10);
}

function readImageAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("现金小票读取失败"));
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ""));
    reader.readAsDataURL(file);
  });
}

/** 将浏览器定位转换为可写入工程水印的最小现场坐标；拒绝定位时不归档无定位的加油表照片。 */
function captureWatermarkLocation() {
  return new Promise<{ longitude: number; latitude: number; accuracyMeters: number }>((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("当前浏览器不支持定位，无法生成含定位的加油表工程水印"));
    navigator.geolocation.getCurrentPosition(
      position => resolve({ longitude: position.coords.longitude, latitude: position.coords.latitude, accuracyMeters: position.coords.accuracy }),
      () => reject(new Error("请允许浏览器获取现场定位后，再保存加油表工程水印照片")),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  });
}

/** 后台柴油影像与移动端现场取证使用同一像素级工程水印样式。 */
function createWatermarkedImage(file: File, watermarkLines: string[], template: EvidenceWatermarkTemplate) {
  return new Promise<File>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("加油表工程水印生成失败")); };
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("当前浏览器不支持工程水印绘制");
        context.drawImage(image, 0, 0);
        const fontSize = Math.max(15, Math.round(Math.min(canvas.width, canvas.height) / 34));
        const lineHeight = Math.round(fontSize * 1.46);
        const padding = Math.round(fontSize * 0.72);
        const visibleLines = watermarkLines.filter(Boolean).slice(0, 8);
        context.font = `600 ${fontSize}px sans-serif`;
        const textWidth = Math.min(canvas.width - padding * 2, Math.max(...visibleLines.map(line => context.measureText(line).width), canvas.width * 0.42));
        const headerHeight = Math.round(lineHeight * 1.35);
        const footerHeight = Math.round(lineHeight * 1.1);
        const boxHeight = headerHeight + visibleLines.length * lineHeight + footerHeight + padding * 2;
        const boxY = Math.max(padding, canvas.height - boxHeight - padding);
        context.fillStyle = "rgba(255, 255, 255, .88)";
        context.fillRect(padding, boxY, textWidth + padding * 2, boxHeight);
        context.fillStyle = "rgba(33, 119, 211, .9)";
        context.fillRect(padding, boxY, textWidth + padding * 2, headerHeight + padding);
        context.fillStyle = "#ffffff";
        context.font = `700 ${Math.round(fontSize * 1.08)}px sans-serif`;
        context.fillText(template.title, padding * 2, boxY + Math.round(padding * .55));
        context.fillStyle = "#26333d";
        context.font = `600 ${fontSize}px sans-serif`;
        context.textBaseline = "top";
        visibleLines.forEach((line, index) => context.fillText(line, padding * 2, boxY + headerHeight + padding + index * lineHeight));
        context.fillStyle = "rgba(33, 119, 211, .92)";
        context.fillRect(padding, boxY + boxHeight - footerHeight - padding, textWidth + padding * 2, footerHeight + padding);
        context.fillStyle = "#ffffff";
        context.font = `600 ${Math.round(fontSize * .78)}px sans-serif`;
        context.fillText(template.footerLabel, padding * 2, boxY + boxHeight - footerHeight - Math.round(padding * .1));
        canvas.toBlob(blob => {
          URL.revokeObjectURL(objectUrl);
          if (!blob) return reject(new Error("加油表工程水印生成失败"));
          const name = file.name.replace(/\.(jpe?g|png)$/i, "") || "diesel-meter";
          resolve(new File([blob], `${name}-watermark.jpg`, { type: "image/jpeg", lastModified: Date.now() }));
        }, "image/jpeg", 0.9);
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        reject(error instanceof Error ? error : new Error("加油表工程水印生成失败"));
      }
    };
    image.src = objectUrl;
  });
}

/** 导出范围由每个业务工作区显式传入，避免浏览器端下载误把“当前筛选结果”写成全量数据。 */
type CsvExportScope = {
  module: string;
  filters: Array<[label: string, value: string | number | null | undefined]>;
};

type ExportScopeWindow = Window & { __roadConstructionExportScope?: CsvExportScope };

function getActiveCsvExportScope(): CsvExportScope {
  if (typeof window === "undefined") return { module: "后台台账", filters: [["页面范围", "当前已授权数据"]] };
  return (window as ExportScopeWindow).__roadConstructionExportScope ?? { module: "后台台账", filters: [["页面范围", "当前已授权数据"]] };
}

/** 浏览器端仅导出当前已授权且已筛选的台账数据；CSV 可直接由 Excel 打开，不额外暴露下载接口。 */
function downloadCsvFile(filename: string, headers: string[], rows: Array<Array<string | number | null | undefined>>, scope = getActiveCsvExportScope()) {
  const escapeCell = (value: string | number | null | undefined) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const scopeRows: Array<Array<string | number | null | undefined>> = [
    ["导出模块", scope.module],
    ...scope.filters.map(([label, value]) => [`筛选条件 · ${label}`, value ?? "未设置"]),
    ["导出记录数", rows.length],
    ["生成时间", new Date().toLocaleString("zh-CN", { hour12: false })],
    [],
  ];
  const content = `\uFEFF${[...scopeRows, headers, ...rows].map(row => row.map(escapeCell).join(",")).join("\n")}`;
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

/** 多工作表 Excel 统一写入授权范围、筛选条件和生成时间，避免分类工资报表脱离项目与期间语境。 */
function downloadXlsxWorkbook(filename: string, sheets: Array<{ name: string; headers: string[]; rows: Array<Array<string | number | null | undefined>> }>, scope = getActiveCsvExportScope()) {
  const workbook = XLSX.utils.book_new();
  const overviewRows: Array<Array<string | number | null | undefined>> = [["导出模块", scope.module], ...scope.filters.map(([label, value]) => [`筛选条件 · ${label}`, value ?? "未设置"]), ["生成时间", new Date().toLocaleString("zh-CN", { hour12: false })], [], ["工作表", "记录数"], ...sheets.map(sheet => [sheet.name, sheet.rows.length])];
  const overview = XLSX.utils.aoa_to_sheet(overviewRows);
  overview["!cols"] = [{ wch: 22 }, { wch: 48 }];
  XLSX.utils.book_append_sheet(workbook, overview, "汇总说明");
  sheets.forEach(sheet => {
    const worksheet = XLSX.utils.aoa_to_sheet([sheet.headers, ...sheet.rows]);
    worksheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(sheet.rows.length, 1), c: Math.max(sheet.headers.length - 1, 0) } }) };
    worksheet["!cols"] = sheet.headers.map(header => ({ wch: Math.min(Math.max(header.length + 4, 12), 28) }));
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  });
  XLSX.writeFile(workbook, filename, { compression: true });
}

/** 日期字段优先保留接口返回的自然日，避免桌面端编辑日报时发生时区偏移。 */
function toBusinessDateInput(value: Date | string | null | undefined) {
  if (!value) return toLocalDateInput();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return toLocalDateInput(new Date(value));
}

/** 只有草稿或退回日报可在桌面端提交编辑；类型守卫同时避免只读详情误用空表单。 */
function isEditableConstructionReport(input: ConstructionReportEditor | null): input is ConstructionReportEditor {
  return input !== null && (!input.id || ["draft", "rejected"].includes(input.status));
}

/** 将服务端 UTC 时间转换为 datetime-local 控件可编辑的本地值，避免维护授权有效期时出现时区偏移。 */
function toLocalDateTimeInput(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** 后台仅展示推导状态；服务端仍以授权记录、角色状态和当前时间作为最终访问边界。 */
function getAssignmentLifecycle(input: { status: string; roleStatus: string; validFrom: Date | string | null; validTo: Date | string | null }) {
  if (input.status === "revoked") return { label: "已撤销", tone: "outline" as const };
  if (input.roleStatus !== "active") return { label: "角色已停用", tone: "destructive" as const };
  const now = Date.now();
  if (input.validFrom && new Date(input.validFrom).getTime() > now) return { label: "尚未生效", tone: "outline" as const };
  if (input.validTo && new Date(input.validTo).getTime() <= now) return { label: "已过期", tone: "outline" as const };
  return { label: "有效", tone: "secondary" as const };
}

/** 空、非整数或非正项目号一律不作为业务查询范围，避免前端误把缺省条件视为全项目。 */
export function getBusinessWorkspaceProjectState(value: string) {
  const projectId = Number(value);
  return {
    projectId: Number.isSafeInteger(projectId) && projectId > 0 ? projectId : 0,
    hasProject: Number.isSafeInteger(projectId) && projectId > 0,
  };
}

/** 投递审计仅在当前被点击的通知卡片内展开，避免跳转至页面下方的独立区域。 */
export function isInlineBroadcastDeliveryExpanded(selectedBroadcastId: number | undefined, broadcastId: number) {
  return selectedBroadcastId === broadcastId;
}

/**
 * 人员角色授权只能按“部门范围”或“具体项目范围”二选一保存。
 * 若选择具体项目，项目范围始终优先，以防历史双范围组合被误投影为部门授权。
 */
export function getAssignmentScopeSaveInput(input: { organizationId: string; projectId: string }) {
  const projectId = Number(input.projectId);
  if (Number.isSafeInteger(projectId) && projectId > 0) {
    return { organizationId: null, projectId };
  }
  const organizationId = Number(input.organizationId);
  return {
    organizationId: Number.isSafeInteger(organizationId) && organizationId > 0 ? organizationId : null,
    projectId: null,
  };
}

function displayMoney(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
}

/** 将后台表单转换为群发接口的三选一范围契约，避免浏览器同时提交项目、组织和岗位而扩大收件人。 */
function getBroadcastAudienceInput(form: BroadcastForm) {
  if (form.audienceType === "project") return { audienceType: "project" as const, projectId: Number(form.scopeValue) };
  if (form.audienceType === "organization") return { audienceType: "organization" as const, organizationId: Number(form.scopeValue) };
  return { audienceType: "role" as const, roleCode: form.scopeValue.trim() };
}

/** 只用于展示服务端返回的真实状态，按钮是否可操作仍由后端状态机二次判定。 */
function BusinessStatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    pending: "待进场", active: "可用", left: "已退场", idle: "闲置", working: "作业中", repairing: "维修中", offsite: "场外", retired: "已退役",
    draft: "草稿", submitted: "待审核", reviewing: "审核中", approved: "已审核", verified: "已核验", paid: "已发放", settled: "已结算", rejected: "已退回", locked: "已归档", void: "已作废", suspended: "已暂停", disabled: "已停用", publishing: "发布中", published: "已发布", partial: "部分失败", failed: "发布失败", cancelled: "已取消", sent: "已投递", skipped: "已跳过",
  };
  const tone = ["approved", "verified", "paid", "settled", "active", "working"].includes(status)
    ? "bg-emerald-50 text-emerald-700"
    : ["rejected", "void", "disabled", "retired"].includes(status)
      ? "bg-rose-50 text-rose-700"
      : ["submitted", "reviewing", "pending", "repairing", "suspended"].includes(status)
        ? "bg-amber-50 text-amber-700"
        : "bg-slate-100 text-slate-600";
  return <Badge className={tone}>{labels[status] ?? status}</Badge>;
}

/** 用于治理概览的统一统计卡片，不展示任何虚构项目业务数据。 */
function MetricCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: ReactNode;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <Card className="overflow-hidden border-[#dce3de] shadow-[0_8px_24px_rgba(21,38,45,0.05)]">
      <CardContent className="relative flex items-start justify-between p-5 before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-[#f3c64e]">
        <div>
          <p className="text-xs font-semibold tracking-[0.1em] text-[#6d8179]">{title}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-[#172a32]">{value ?? "—"}</p>
          <p className="mt-2 text-xs text-[#71817b]">{description}</p>
        </div>
        <div className="rounded-xl bg-[#f7f4e7] p-2.5 text-[#203c48]">
          <Icon className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
  );
}

/** 没有真实数据时使用明确空状态，避免用演示数据误导管理人员。 */
function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}

type LedgerTableRow = {
  id: string | number;
  cells: ReactNode[];
  onOpen?: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
};

/**
 * 后台台账统一采用表格式主视图；仅传入 onRemove 的记录才允许选择并进入批量删除。
 * 批量执行委托给模块自身 mutation，确保每条记录仍独立通过关联保护、状态机和审计校验。
 */
function LedgerTable({ title, description, columns, rows, loading, titleActions, onBulkRemove, removeLabel = "删除", bulkRemoveLabel = "批量受控删除" }: { title: string; description: string; columns: string[]; rows: LedgerTableRow[]; loading?: boolean; titleActions?: ReactNode; onBulkRemove?: (rows: LedgerTableRow[]) => void; removeLabel?: string; bulkRemoveLabel?: string }) {
  const removableRows = rows.filter(row => Boolean(row.onRemove));
  const [selectedIds, setSelectedIds] = useState<Array<string | number>>([]);
  const selectedRows = rows.filter(row => selectedIds.includes(row.id) && row.onRemove);
  const toggleRow = (id: string | number, checked: boolean) => setSelectedIds(current => checked ? Array.from(new Set([...current, id])) : current.filter(item => item !== id));
  const toggleAll = (checked: boolean) => setSelectedIds(checked ? removableRows.map(row => row.id) : []);
  return (
    <Card className="ledger-table-shell overflow-hidden border-[#d8e3e0] shadow-sm">
      <CardHeader className="border-b border-[#e1e8e4] pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">台账列表 · 可筛选 / 可导出</p><CardTitle className="mt-1 text-base">{title}</CardTitle><CardDescription className="mt-1">{description}</CardDescription></div>{titleActions || onBulkRemove ? <div className="flex flex-wrap gap-2">{titleActions}{onBulkRemove ? <Button size="sm" variant="outline" className="min-h-10 sm:min-h-8" disabled={!selectedRows.length} onClick={() => onBulkRemove(selectedRows)}>{bulkRemoveLabel}（{selectedRows.length}）</Button> : null}</div> : null}</div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <Table className="min-w-[780px] text-xs">
          <TableHeader className="sticky top-0 z-10 bg-[#edf1ed]"><TableRow className="border-[#dce3de] hover:bg-[#edf1ed]">{onBulkRemove ? <TableHead className="h-11 w-11 px-3"><input aria-label="全选可受控删除记录" type="checkbox" checked={Boolean(removableRows.length) && selectedIds.length === removableRows.length} onChange={event => toggleAll(event.target.checked)} /></TableHead> : null}{columns.map(column => <TableHead className="h-11 px-4 font-semibold text-[#46615a]" key={column}>{column}</TableHead>)}<TableHead className="h-11 px-4 text-right font-semibold text-[#46615a]">操作</TableHead></TableRow></TableHeader>
          <TableBody>{loading ? <TableRow><TableCell className="px-4 py-8 text-center text-slate-500" colSpan={columns.length + 1 + (onBulkRemove ? 1 : 0)}>正在读取已授权台账记录…</TableCell></TableRow> : rows.length ? rows.map((row, index) => <TableRow className="border-[#edf0ee] hover:bg-[#fbfaf1]" key={row.id}>{onBulkRemove ? <TableCell className="w-11 px-3">{row.onRemove ? <input aria-label={`选择第 ${index + 1} 条记录`} type="checkbox" checked={selectedIds.includes(row.id)} onChange={event => toggleRow(row.id, event.target.checked)} /> : <span className="text-slate-300">—</span>}</TableCell> : null}{row.cells.map((cell, cellIndex) => <TableCell className={`px-4 py-3 text-slate-700 ${cellIndex === 0 ? "font-medium text-[#203c48]" : ""}`} key={`${row.id}-${cellIndex}`}>{cell}</TableCell>)}<TableCell className="px-4 py-3 text-right"><div className="flex justify-end gap-1">{row.onOpen ? <Button size="sm" variant="outline" onClick={row.onOpen}>详情</Button> : null}{row.onEdit ? <Button size="sm" variant="outline" onClick={row.onEdit}>编辑</Button> : null}{row.onRemove ? <Button size="sm" variant={removeLabel === "删除" ? "destructive" : "outline"} onClick={row.onRemove}>{removeLabel}</Button> : !row.onOpen && !row.onEdit ? <span className="text-slate-400">第 {index + 1} 条</span> : null}</div></TableCell></TableRow>) : <TableRow><TableCell className="px-4 py-8 text-center text-slate-500" colSpan={columns.length + 1 + (onBulkRemove ? 1 : 0)}>暂无匹配记录。可调整筛选条件，或通过本模块录入真实业务数据。</TableCell></TableRow>}</TableBody>
        </Table>
        <p className="border-t border-[#edf0ee] px-4 py-3 text-xs text-slate-500">手机端可左右滑动查看完整字段；编辑、删除和批量处理仍由服务端逐条校验关联、权限、项目范围和审计要求。</p>
      </CardContent>
    </Card>
  );
}

/** 权限页的组织范围选择必须区分加载中、尚未建节点和可正常选择三种状态，避免空下拉让管理员误以为页面失效。 */
export function getDepartmentScopePickerState(isLoading: boolean, nodeCount: number) {
  if (isLoading) return { disabled: true, placeholder: "正在加载组织节点…", needsOrganizationSetup: false };
  if (nodeCount === 0) return { disabled: true, placeholder: "暂无部门或项目部", needsOrganizationSetup: true };
  return { disabled: false, placeholder: "选择部门或项目部", needsOrganizationSetup: false };
}

export default function AdminPage() {
  const { isAuthenticated, user } = useAuth();
  const [location, setLocation] = useLocation();
  const activeSection = location.split("/")[2] || "overview";

  /**
   * tRPC 会将同一渲染周期内的查询合并为一个批次。后台全部 17 个数据域若在首屏同时请求，任何慢查询都会阻塞运营概览。
   * 因此只为当前分区和该分区实际依赖的数据源发起查询；服务端权限校验仍是最终边界。
   */
  const canQuery = isAuthenticated;
  const isOverview = activeSection === "overview";
  const isOrganization = activeSection === "organization";
  const isVehicle = activeSection === "vehicles";
  const isConstruction = activeSection === "construction";
  const isLabor = activeSection === "labor";
  const isMachinery = activeSection === "machinery";
  const isTransport = activeSection === "transport";
  const isPurchasing = activeSection === "purchasing";
  const isMeasurementTools = activeSection === "measurement-tools";
  const isSubcontract = activeSection === "subcontract";
  const isContracts = activeSection === "contracts";
  const isDiesel = activeSection === "diesel";
  const isRisk = activeSection === "risk";
  const isFinance = activeSection === "finance" || isDiesel;
  const isBroadcast = activeSection === "broadcast";
  const isWechatLogin = activeSection === "wechat-login";
  const isBusinessWorkspace = isConstruction || isLabor || isMachinery || isTransport || isPurchasing || isSubcontract || isContracts;
  const isPermission = activeSection === "permission";
  const isBusiness = activeSection === "business";
  const isSettings = activeSection === "settings";
  const isAudit = activeSection === "audit";
  const needsOrganizations = isOrganization || isVehicle || isPermission;
  const needsProjects = isOrganization || isVehicle || isPermission || isBusiness || isBusinessWorkspace || isFinance || isRisk || isSettings;
  const needsUsers = isOrganization || isVehicle || isPermission || isMachinery;

  const overview = trpc.admin.overview.useQuery(undefined, { enabled: canQuery && isOverview });
  const organizations = trpc.admin.organization.list.useQuery(undefined, { enabled: canQuery && needsOrganizations });
  const positions = trpc.admin.position.list.useQuery(undefined, { enabled: canQuery && isOrganization });
  const projects = trpc.admin.project.list.useQuery(undefined, { enabled: canQuery && needsProjects });
  const roles = trpc.admin.role.list.useQuery(undefined, { enabled: canQuery && isPermission });
  const roleTemplates = trpc.admin.role.templates.useQuery(undefined, { enabled: canQuery && isPermission });
  const permissions = trpc.admin.role.permissions.useQuery(undefined, { enabled: canQuery && isPermission });
  const users = trpc.admin.personnel.listUsers.useQuery(undefined, { enabled: canQuery && needsUsers });
  const assignments = trpc.admin.personnel.listAssignments.useQuery(undefined, { enabled: canQuery && isPermission });
  const departmentScopes = trpc.admin.department.listScopes.useQuery(undefined, { enabled: canQuery && isPermission });
  const departmentModules = trpc.admin.department.modules.useQuery(undefined, { enabled: canQuery && isPermission });
  const settings = trpc.admin.settings.list.useQuery(undefined, { enabled: canQuery && isSettings });
  const externalAiConfiguration = trpc.admin.settings.getExternalAiConfiguration.useQuery(undefined, { enabled: canQuery && isSettings });
  const evidenceWatermarkTemplate = trpc.admin.settings.evidenceWatermarkTemplate.useQuery(undefined, { enabled: canQuery && (isSettings || isDiesel) });
  const officialTemplateCoverage = trpc.admin.settings.officialAccountTemplateCoverage.useQuery(undefined, { enabled: canQuery && isSettings });
  const dailyDigestSettings = trpc.dailyDigest.getSettings.useQuery(undefined, { enabled: canQuery && isSettings });
  const audits = trpc.admin.audit.list.useQuery(undefined, { enabled: canQuery && isAudit });
  const auditIntegrity = trpc.admin.audit.integrity.useQuery(undefined, { enabled: canQuery && isAudit, retry: false });
  const sensitiveAccesses = trpc.admin.audit.sensitiveAccesses.useQuery({ limit: 50 }, { enabled: canQuery && isAudit, retry: false });
  const broadcastOptions = trpc.broadcast.formOptions.useQuery(undefined, { enabled: canQuery && isBroadcast });
  const broadcasts = trpc.broadcast.list.useQuery(undefined, { enabled: canQuery && isBroadcast });
  const wechatLogins = trpc.admin.wechatLogin.list.useQuery(undefined, { enabled: canQuery && isWechatLogin });
  const realDataReadiness = trpc.admin.acceptance.realDataReadiness.useQuery(undefined, { enabled: canQuery && isOverview });
  const vehicles = trpc.admin.vehicle.list.useQuery(undefined, { enabled: canQuery && isVehicle });
  const employeeProfiles = trpc.admin.employee.listProfiles.useQuery(undefined, { enabled: canQuery && isPermission });
  const employeeOptions = trpc.admin.employee.options.useQuery(undefined, { enabled: canQuery && isPermission });
  const assetMaintenanceRecords = trpc.admin.assetMaintenance.list.useQuery(undefined, { enabled: canQuery && (isVehicle || isMachinery) });
  const assetMaintenanceSummary = trpc.admin.assetMaintenance.summary.useQuery(undefined, { enabled: canQuery && (isVehicle || isMachinery) });
  const [businessFilter, setBusinessFilter] = useState({ projectId: "all", period: "" });
  const [businessWorkspaceProjectId, setBusinessWorkspaceProjectId] = useState("");
  const [selectedMachineId, setSelectedMachineId] = useState("");
  const [machineDetailOpen, setMachineDetailOpen] = useState(false);
  const [transportLedgerFilter, setTransportLedgerFilter] = useState<TransportLedgerFilter>({ periodMode: "day", date: toLocalDateInput(), month: new Date().toISOString().slice(0, 7), dateFrom: "", dateTo: "", vehicleId: "all", status: "all", routePresetId: "all" });
  /** 旧简版运输表仅作兼容渲染，完整筛选由 transportLedgerFilter 接管。 */
  const [transportDate, setTransportDate] = useState(() => toLocalDateInput());
  const [laborPeriod, setLaborPeriod] = useState("");
  const [laborAttendanceDate, setLaborAttendanceDate] = useState(() => toLocalDateInput(new Date()));
  const [laborPayrollSearch, setLaborPayrollSearch] = useState("");
  const [laborPayrollTeam, setLaborPayrollTeam] = useState("all");
  const [laborPayrollStatus, setLaborPayrollStatus] = useState("all");
  const [laborAttendanceFilter, setLaborAttendanceFilter] = useState({ workerName: "", team: "all", category: "all", status: "all" });
  const [dailyWagePaymentTarget, setDailyWagePaymentTarget] = useState<{ id: number; workerName: string } | null>(null);
  const [dailyWagePaymentForm, setDailyWagePaymentForm] = useState({ paidAt: toLocalDateInput(), paymentReference: "" });
  const [subcontractTeamFilter, setSubcontractTeamFilter] = useState("all");
  const [subcontractStatusFilter, setSubcontractStatusFilter] = useState("all");
  const [subcontractTeamForm, setSubcontractTeamForm] = useState<SubcontractTeamForm>(EMPTY_SUBCONTRACT_TEAM_FORM);
  const [subcontractPackageForm, setSubcontractPackageForm] = useState<SubcontractPackageForm>(EMPTY_SUBCONTRACT_PACKAGE_FORM);
  const [subcontractTeamDialogOpen, setSubcontractTeamDialogOpen] = useState(false);
  const [subcontractPackageDialogOpen, setSubcontractPackageDialogOpen] = useState(false);
  const [measurementTakeoffForm, setMeasurementTakeoffForm] = useState<MeasurementTakeoffForm>(EMPTY_MEASUREMENT_TAKEOFF_FORM);
  const [measurementTakeoffDialogOpen, setMeasurementTakeoffDialogOpen] = useState(false);
  const [financeProjectId, setFinanceProjectId] = useState("");
  const [financePeriod, setFinancePeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [financeLedgerFilter, setFinanceLedgerFilter] = useState({ direction: "all", category: "all", settlementStatus: "all", sourceType: "all", keyword: "" });
  const [riskScanDate, setRiskScanDate] = useState(() => toLocalDateInput());
  const [riskAlertStatus, setRiskAlertStatus] = useState<"all" | "open" | "acknowledged" | "in_rectification" | "resolved" | "ignored">("all");
  const [riskRuleForm, setRiskRuleForm] = useState<RiskRuleForm>(EMPTY_RISK_RULE_FORM);
  const [riskRectificationTarget, setRiskRectificationTarget] = useState<{ id: number; title: string; assigneeUserId: string; dueAt: string; rectificationNote: string } | null>(null);
  const [riskBriefing, setRiskBriefing] = useState<{ executiveSummary: string; priorityActions: string[]; watchItems: string[]; disclaimer: string; source: "external" | "builtin" | "fallback"; model: string; externalFallback?: string | null } | null>(null);
  const [machineStatementPeriod, setMachineStatementPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [vehicleAnalysisPeriod, setVehicleAnalysisPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [vehicleAnalysisTarget, setVehicleAnalysisTarget] = useState<{ vehicleId: number; projectId: number; plateNo: string } | null>(null);
  const [machineStatementForm, setMachineStatementForm] = useState<MachineMonthlyStatementForm>(EMPTY_MACHINE_MONTHLY_STATEMENT_FORM);
  const [machineStatementDialogOpen, setMachineStatementDialogOpen] = useState(false);
  const [financeClosingDate, setFinanceClosingDate] = useState(() => toLocalDateInput());
  const [financeReopenReason, setFinanceReopenReason] = useState("");
  const [dieselDate, setDieselDate] = useState(() => toLocalDateInput());
  const [dieselLedgerFilter, setDieselLedgerFilter] = useState({ plateNo: "", dateFrom: "", dateTo: "", month: "", supplyMethod: "all", assetType: "all", supplierName: "" });
  const [watermarkTemplateForm, setWatermarkTemplateForm] = useState<EvidenceWatermarkTemplate>({ ...DEFAULT_EVIDENCE_WATERMARK_TEMPLATE, fields: [...DEFAULT_EVIDENCE_WATERMARK_TEMPLATE.fields] });
  const [broadcastForm, setBroadcastForm] = useState<BroadcastForm>(EMPTY_BROADCAST_FORM);
  const [selectedBroadcastId, setSelectedBroadcastId] = useState<number>();
  const [payrollPaymentTarget, setPayrollPaymentTarget] = useState<PayrollPaymentTarget | null>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const [constructionReportEditor, setConstructionReportEditor] = useState<ConstructionReportEditor | null>(null);
  const [desktopRecordDetail, setDesktopRecordDetail] = useState<DesktopRecordDetail | null>(null);
  const [inventoryTransactionForm, setInventoryTransactionForm] = useState<InventoryTransactionForm>(EMPTY_INVENTORY_TRANSACTION_FORM);
  const [inventoryTransactionDialogOpen, setInventoryTransactionDialogOpen] = useState(false);
  const [vehicleLedgerFilter, setVehicleLedgerFilter] = useState({ search: "", projectId: "all", ownership: "all", status: "all" });
  useEffect(() => {
    if (evidenceWatermarkTemplate.data?.template) setWatermarkTemplateForm({ ...evidenceWatermarkTemplate.data.template, fields: [...evidenceWatermarkTemplate.data.template.fields] });
  }, [evidenceWatermarkTemplate.data?.template]);
  const businessStatisticsInput = useMemo(() => ({
    projectId: businessFilter.projectId === "all" ? undefined : Number(businessFilter.projectId),
    period: businessFilter.period || undefined,
  }), [businessFilter.period, businessFilter.projectId]);
  const businessStatistics = trpc.admin.business.statistics.useQuery(businessStatisticsInput, { enabled: canQuery && isBusiness });
  const backups = trpc.admin.backup.list.useQuery(undefined, { enabled: canQuery && isBusiness });
  const workspaceProjectState = getBusinessWorkspaceProjectState(businessWorkspaceProjectId);
  const workspaceProjectId = workspaceProjectState.projectId;
  const hasBusinessWorkspaceProject = workspaceProjectState.hasProject;
  const workspaceProjectInput = useMemo(() => ({ projectId: workspaceProjectId }), [workspaceProjectId]);
  const laborWorkspaceInput = useMemo(() => ({ projectId: workspaceProjectId, includeLeft: true }), [workspaceProjectId]);
  const payrollWorkspaceInput = useMemo(() => ({ projectId: workspaceProjectId, period: laborPeriod || undefined }), [laborPeriod, workspaceProjectId]);
  const laborCheckInWorkspaceInput = useMemo(() => ({ projectId: workspaceProjectId, businessDate: laborAttendanceDate || undefined }), [laborAttendanceDate, workspaceProjectId]);
  const machineCostWorkspaceInput = useMemo(() => ({ machineId: Number(selectedMachineId || 0), projectId: workspaceProjectId }), [selectedMachineId, workspaceProjectId]);
  const machineMonthlyStatementsInput = useMemo(() => ({ projectId: workspaceProjectId, period: machineStatementPeriod }), [machineStatementPeriod, workspaceProjectId]);
  const machineAnalysisInput = useMemo(() => ({ machineId: Number(selectedMachineId || 0), projectId: workspaceProjectId, period: machineStatementPeriod }), [machineStatementPeriod, selectedMachineId, workspaceProjectId]);
  const machineMonthlyPreviewInput = useMemo(() => ({ machineId: Number(machineStatementForm.machineId || 0), projectId: Number(machineStatementForm.projectId || 0), period: machineStatementForm.period, driverUserId: machineStatementForm.driverUserId ? Number(machineStatementForm.driverUserId) : null, machineWorkDays: Number(machineStatementForm.machineWorkDays || 0), machineOvertimeHours: Number(machineStatementForm.machineOvertimeHours || 0), driverMonthlyWage: Number(machineStatementForm.driverMonthlyWage || 0), driverWorkDays: Number(machineStatementForm.driverWorkDays || 0), driverOvertimeHours: Number(machineStatementForm.driverOvertimeHours || 0), signatureName: machineStatementForm.signatureName.trim() || null, remarks: machineStatementForm.remarks.trim() || null }), [machineStatementForm]);
  const vehicleSummariesInput = useMemo(() => ({ projectId: vehicleLedgerFilter.projectId === "all" ? undefined : Number(vehicleLedgerFilter.projectId), period: vehicleAnalysisPeriod }), [vehicleAnalysisPeriod, vehicleLedgerFilter.projectId]);
  const vehicleAnalysisInput = useMemo(() => ({ vehicleId: vehicleAnalysisTarget?.vehicleId ?? 0, projectId: vehicleAnalysisTarget?.projectId ?? 0, period: vehicleAnalysisPeriod }), [vehicleAnalysisPeriod, vehicleAnalysisTarget]);
  const transportWorkspaceInput = useMemo(() => ({
    projectId: workspaceProjectId,
    date: transportLedgerFilter.periodMode === "day" ? transportLedgerFilter.date || undefined : undefined,
    month: transportLedgerFilter.periodMode === "month" ? transportLedgerFilter.month || undefined : undefined,
    dateFrom: transportLedgerFilter.periodMode === "custom" ? transportLedgerFilter.dateFrom || undefined : undefined,
    dateTo: transportLedgerFilter.periodMode === "custom" ? transportLedgerFilter.dateTo || undefined : undefined,
    vehicleId: transportLedgerFilter.vehicleId === "all" ? undefined : Number(transportLedgerFilter.vehicleId),
    status: transportLedgerFilter.status === "all" ? undefined : transportLedgerFilter.status as "draft" | "submitted" | "verified" | "settled" | "void",
    routePresetId: transportLedgerFilter.routePresetId === "all" ? undefined : Number(transportLedgerFilter.routePresetId),
  }), [transportLedgerFilter, workspaceProjectId]);
  const subcontractPackagesInput = useMemo(() => ({ projectId: workspaceProjectId, subcontractTeamId: subcontractTeamFilter === "all" ? undefined : Number(subcontractTeamFilter), status: subcontractStatusFilter === "all" ? undefined : subcontractStatusFilter as "draft" | "allocated" | "confirmed" | "settled" | "void" }), [subcontractStatusFilter, subcontractTeamFilter, workspaceProjectId]);
  const financeProjectInput = useMemo(() => ({ projectId: Number(financeProjectId || 0), period: financePeriod || undefined }), [financePeriod, financeProjectId]);
  const riskProjectInput = useMemo(() => ({ projectId: Number(financeProjectId || 0) }), [financeProjectId]);
  const riskAlertsInput = useMemo(() => ({ projectId: Number(financeProjectId || 0), period: financePeriod, status: riskAlertStatus }), [financePeriod, financeProjectId, riskAlertStatus]);
  const dieselRefuelRecordsInput = useMemo(() => ({
    projectId: Number(financeProjectId || 0),
    plateNo: dieselLedgerFilter.plateNo.trim() || undefined,
    dateFrom: dieselLedgerFilter.dateFrom || undefined,
    dateTo: dieselLedgerFilter.dateTo || undefined,
    month: dieselLedgerFilter.month || undefined,
    supplyMethod: dieselLedgerFilter.supplyMethod === "all" ? undefined : dieselLedgerFilter.supplyMethod as "project_supply" | "external_station",
    assetType: dieselLedgerFilter.assetType === "all" ? undefined : dieselLedgerFilter.assetType as "vehicle" | "machine",
    supplierName: dieselLedgerFilter.supplierName.trim() || undefined,
  }), [dieselLedgerFilter, financeProjectId]);
  const broadcastAudienceInput = useMemo(() => getBroadcastAudienceInput(broadcastForm), [broadcastForm]);
  const validBroadcastScope = broadcastForm.audienceType === "role" ? Boolean(broadcastForm.scopeValue.trim()) : Number.isInteger(Number(broadcastForm.scopeValue)) && Number(broadcastForm.scopeValue) > 0;
  const broadcastAudiencePreview = trpc.broadcast.previewAudience.useQuery(broadcastAudienceInput, { enabled: canQuery && isBroadcast && validBroadcastScope, retry: false });
  const broadcastDeliveries = trpc.broadcast.getDeliveries.useQuery({ broadcastId: selectedBroadcastId ?? 0 }, { enabled: canQuery && isBroadcast && selectedBroadcastId !== undefined, retry: false });
  const constructionDailyReports = trpc.construction.listReports.useQuery(workspaceProjectInput, { enabled: canQuery && isConstruction && hasBusinessWorkspaceProject });
  const constructionDailySummary = trpc.construction.summary.useQuery(workspaceProjectInput, { enabled: canQuery && isConstruction && hasBusinessWorkspaceProject });
  const constructionReportEvidenceIds = useMemo(() => (constructionDailyReports.data ?? []).map(report => Number(report.id)).filter(Number.isInteger), [constructionDailyReports.data]);
  const constructionReportEvidenceInput = useMemo(() => ({ projectId: workspaceProjectId, reportIds: constructionReportEvidenceIds.length ? constructionReportEvidenceIds : [0] }), [workspaceProjectId, constructionReportEvidenceIds]);
  const constructionReportEvidence = trpc.construction.reportEvidence.useQuery(constructionReportEvidenceInput, { enabled: canQuery && isConstruction && hasBusinessWorkspaceProject && constructionReportEvidenceIds.length > 0, retry: false });
  const constructionEvidenceByReport = useMemo(() => {
    const grouped = new Map<number, NonNullable<typeof constructionReportEvidence.data>>();
    (constructionReportEvidence.data ?? []).forEach(item => grouped.set(item.reportId, [...(grouped.get(item.reportId) ?? []), item]));
    return grouped;
  }, [constructionReportEvidence.data]);
  const laborWorkers = trpc.labor.listWorkers.useQuery(laborWorkspaceInput, { enabled: canQuery && isLabor && hasBusinessWorkspaceProject });
  const laborAttendance = trpc.labor.attendance.list.useQuery(workspaceProjectInput, { enabled: canQuery && isLabor && hasBusinessWorkspaceProject });
  const laborCheckIns = trpc.labor.attendance.listCheckIns.useQuery(laborCheckInWorkspaceInput, { enabled: canQuery && isLabor && hasBusinessWorkspaceProject });
  const payrollStatements = trpc.labor.payroll.list.useQuery(payrollWorkspaceInput, { enabled: canQuery && isLabor && hasBusinessWorkspaceProject });
  const laborDailyWages = trpc.labor.dailyWage.list.useQuery(workspaceProjectInput, { enabled: canQuery && isLabor && hasBusinessWorkspaceProject });
  const payrollWorkbookExport = trpc.labor.dailyWage.exportWorkbookData.useQuery(payrollWorkspaceInput, { enabled: false, retry: false });
  const payrollPaymentListExport = trpc.labor.dailyWage.exportPaymentList.useQuery(payrollWorkspaceInput, { enabled: false, retry: false });
  const machineryLedger = trpc.machinery.listMachines.useQuery(workspaceProjectInput, { enabled: canQuery && isMachinery && hasBusinessWorkspaceProject });
  const machineCosts = trpc.machinery.listCosts.useQuery(machineCostWorkspaceInput, { enabled: canQuery && isMachinery && hasBusinessWorkspaceProject && Boolean(selectedMachineId) });
  const machineCostSummaries = trpc.machinery.listCostSummaries.useQuery(workspaceProjectInput, { enabled: canQuery && isMachinery && hasBusinessWorkspaceProject });
  const machineMonthlyStatements = trpc.machinery.listMonthlyStatements.useQuery(machineMonthlyStatementsInput, { enabled: canQuery && isMachinery && hasBusinessWorkspaceProject && Boolean(machineStatementPeriod) });
  const machineAnalysis = trpc.machinery.getMachineAnalysis.useQuery(machineAnalysisInput, { enabled: canQuery && isMachinery && hasBusinessWorkspaceProject && machineDetailOpen && machineAnalysisInput.machineId > 0 && /^\d{4}-(0[1-9]|1[0-2])$/.test(machineAnalysisInput.period), retry: false });
  const machineMonthlyPreview = trpc.machinery.previewMonthlyStatement.useQuery(machineMonthlyPreviewInput, { enabled: canQuery && isMachinery && machineStatementDialogOpen && hasBusinessWorkspaceProject && machineMonthlyPreviewInput.machineId > 0 && machineMonthlyPreviewInput.projectId > 0 && /^\d{4}-(0[1-9]|1[0-2])$/.test(machineMonthlyPreviewInput.period), retry: false });
  const vehicleSummaries = trpc.transport.listVehicleSummaries.useQuery(vehicleSummariesInput, { enabled: canQuery && isVehicle && /^\d{4}-(0[1-9]|1[0-2])$/.test(vehicleAnalysisPeriod), retry: false });
  const vehicleAnalysis = trpc.transport.getVehicleAnalysis.useQuery(vehicleAnalysisInput, { enabled: canQuery && isVehicle && vehicleAnalysisTarget !== null && vehicleAnalysisInput.vehicleId > 0 && vehicleAnalysisInput.projectId > 0 && /^\d{4}-(0[1-9]|1[0-2])$/.test(vehicleAnalysisPeriod), retry: false });
  const transportVehicleLedger = trpc.transport.listVehicles.useQuery(workspaceProjectInput, { enabled: canQuery && isTransport && hasBusinessWorkspaceProject });
  const transportTrips = trpc.transport.listTrips.useQuery(transportWorkspaceInput, { enabled: canQuery && isTransport && hasBusinessWorkspaceProject });
  const transportSites = trpc.transport.listSites.useQuery(workspaceProjectInput, { enabled: canQuery && isTransport && hasBusinessWorkspaceProject });
  const transportRoutePresets = trpc.transport.listRoutePresets.useQuery(workspaceProjectInput, { enabled: canQuery && isTransport && hasBusinessWorkspaceProject });
  const transportFreightRules = trpc.transport.listFreightRules.useQuery(workspaceProjectInput, { enabled: canQuery && isTransport && hasBusinessWorkspaceProject });
  const rfidWriterDevices = trpc.transport.listRfidWriterDevices.useQuery(workspaceProjectInput, { enabled: canQuery && isTransport && hasBusinessWorkspaceProject });
  const vehicleRfidCards = trpc.transport.listVehicleRfidCards.useQuery(workspaceProjectInput, { enabled: canQuery && isTransport && hasBusinessWorkspaceProject });
  const subcontractCapabilities = trpc.subcontract.capabilities.useQuery(undefined, { enabled: canQuery && isSubcontract });
  const measurementTakeoffCapabilities = trpc.measurement.takeoffCapabilities.useQuery(undefined, { enabled: canQuery && isSubcontract });
  const subcontractTeams = trpc.subcontract.listTeams.useQuery(workspaceProjectInput, { enabled: canQuery && isSubcontract && hasBusinessWorkspaceProject });
  const subcontractPackages = trpc.subcontract.listPackages.useQuery(subcontractPackagesInput, { enabled: canQuery && isSubcontract && hasBusinessWorkspaceProject });
  const subcontractSummary = trpc.subcontract.summary.useQuery(workspaceProjectInput, { enabled: canQuery && isSubcontract && hasBusinessWorkspaceProject });
  const subcontractTakeoffs = trpc.measurement.listTakeoffs.useQuery(workspaceProjectInput, { enabled: canQuery && isSubcontract && hasBusinessWorkspaceProject });
  const purchasingRequests = trpc.purchasing.listRequests.useQuery(workspaceProjectInput, { enabled: canQuery && isPurchasing && hasBusinessWorkspaceProject });
  const purchasingOrders = trpc.purchasing.listOrders.useQuery(workspaceProjectInput, { enabled: canQuery && isPurchasing && hasBusinessWorkspaceProject });
  const purchasingInventory = trpc.purchasing.listInventory.useQuery(workspaceProjectInput, { enabled: canQuery && isPurchasing && hasBusinessWorkspaceProject });
  const purchasingSettlements = trpc.purchasing.listSettlements.useQuery(workspaceProjectInput, { enabled: canQuery && isPurchasing && hasBusinessWorkspaceProject });
  const financeSummary = trpc.finance.summary.useQuery({ projectId: Number(financeProjectId || 0), period: financePeriod }, { enabled: canQuery && isFinance && Number(financeProjectId) > 0 && Boolean(financePeriod) });
  const financeInvoices = trpc.finance.listInvoices.useQuery(financeProjectInput, { enabled: canQuery && isFinance && Number(financeProjectId) > 0 });
  const dailyAccountingReport = trpc.finance.getDailyPrintableReport.useQuery({ projectId: Number(financeProjectId || 0), closingDate: financeClosingDate }, { enabled: canQuery && isFinance && Number(financeProjectId) > 0 && Boolean(financeClosingDate) });
  const dieselGuidelinePrices = trpc.admin.diesel.listGuidelinePrices.useQuery({ projectId: Number(financeProjectId || 0) }, { enabled: canQuery && isFinance && Number(financeProjectId) > 0 });
  const dieselRefuelRecords = trpc.admin.diesel.listRefuelRecords.useQuery(dieselRefuelRecordsInput, { enabled: canQuery && isFinance && Number(financeProjectId) > 0 });
  const dieselDailySummary = trpc.admin.diesel.dailySummary.useQuery({ projectId: Number(financeProjectId || 0), date: dieselDate }, { enabled: canQuery && isFinance && Number(financeProjectId) > 0 && Boolean(dieselDate) });
  const dieselPriceAlertRule = trpc.admin.diesel.getPriceAlertRule.useQuery({ projectId: Number(financeProjectId || 0) }, { enabled: canQuery && isFinance && Number(financeProjectId) > 0 });
  const dieselSupplierReconciliation = trpc.admin.diesel.supplierReconciliation.useQuery({ projectId: Number(financeProjectId || 0), period: financePeriod }, { enabled: canQuery && isFinance && Number(financeProjectId) > 0 && /^\d{4}-(0[1-9]|1[0-2])$/.test(financePeriod) });
  const dieselVehicleOptions = trpc.admin.vehicle.list.useQuery(undefined, { enabled: canQuery && isFinance && Number(financeProjectId) > 0 });
  const dieselMachineOptions = trpc.machinery.listMachines.useQuery({ projectId: Number(financeProjectId || 0) }, { enabled: canQuery && isFinance && Number(financeProjectId) > 0 });
  const dieselTripOptions = trpc.transport.listTrips.useQuery({ projectId: Number(financeProjectId || 0), date: undefined }, { enabled: canQuery && isFinance && Number(financeProjectId) > 0 });
  const riskRule = trpc.projectRisk.getRule.useQuery(riskProjectInput, { enabled: canQuery && isRisk && Number(financeProjectId) > 0 });
  const riskCapacityReadiness = trpc.projectRisk.capacityReadiness.useQuery(riskProjectInput, { enabled: canQuery && isRisk && Number(financeProjectId) > 0 });
  const riskAssignees = trpc.projectRisk.listAssignees.useQuery(riskProjectInput, { enabled: canQuery && isRisk && Number(financeProjectId) > 0 });
  const riskAlerts = trpc.projectRisk.listAlerts.useQuery(riskAlertsInput, { enabled: canQuery && isRisk && Number(financeProjectId) > 0 && Boolean(financePeriod) });
  const riskFinanceAnalysis = trpc.projectRisk.financeCategoryAnalysis.useQuery({ projectId: Number(financeProjectId || 0), period: financePeriod }, { enabled: canQuery && (isRisk || isFinance) && Number(financeProjectId) > 0 && Boolean(financePeriod) });
  useEffect(() => {
    if (!vehicleAnalysisTarget || !vehicleAnalysis.data) return;
    const analysis = vehicleAnalysis.data;
    setDesktopRecordDetail({
      title: `单车收益支出分析 · ${analysis.vehicle.plateNo}`,
      description: "运输收入、柴油、维修保养和租赁估算均读取当前项目的服务端业务记录；柴油占比按柴油金额÷运输毛收入计算，已作废记录不参与汇总。",
      fields: [
        { label: "分析期间", value: analysis.period },
        { label: "运输趟次 / 里程", value: `${analysis.summary.tripCount} 趟 · ${displayMoney(analysis.summary.distanceKm)} km` },
        { label: "运输毛收入 / 净结算", value: `¥ ${displayMoney(analysis.summary.grossIncome)} / ¥ ${displayMoney(analysis.summary.settlementIncome)}` },
        { label: "柴油升数 / 金额 / 占比", value: `${displayMoney(analysis.summary.fuelLiters)} L / ¥ ${displayMoney(analysis.summary.fuelAmount)} / ${analysis.summary.fuelCostRatio === null ? "暂无收入基数" : `${displayMoney(analysis.summary.fuelCostRatio)}%`}` },
        { label: "维修保养 / 租赁估算", value: `¥ ${displayMoney(analysis.summary.repairAmount + analysis.summary.maintenanceAmount)} / ¥ ${displayMoney(analysis.summary.leaseEstimatedAmount)}${analysis.leaseRule?.estimatePending ? "（小时/台班租赁待按实际结算）" : ""}` },
        { label: "本期净收益", value: `¥ ${displayMoney(analysis.summary.netIncome)}` },
        { label: "按月汇总", value: <div className="max-h-52 overflow-auto rounded-lg border border-slate-200"><Table className="min-w-[720px] text-xs"><TableHeader><TableRow><TableHead>月份</TableHead><TableHead>趟次</TableHead><TableHead>收入</TableHead><TableHead>柴油 L / 金额</TableHead><TableHead>维修保养</TableHead><TableHead>净收益</TableHead></TableRow></TableHeader><TableBody>{analysis.monthly.length ? analysis.monthly.map(item => <TableRow key={item.date}><TableCell>{item.date}</TableCell><TableCell>{item.tripCount}</TableCell><TableCell>¥{displayMoney(item.grossIncome)}</TableCell><TableCell>{displayMoney(item.fuelLiters)} L / ¥{displayMoney(item.fuelAmount)}</TableCell><TableCell>¥{displayMoney(item.repairAmount + item.maintenanceAmount)}</TableCell><TableCell>¥{displayMoney(item.netIncome)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={6} className="text-center text-slate-500">暂无历史运输或成本记录。</TableCell></TableRow>}</TableBody></Table></div> },
        { label: "按日明细", value: <div className="max-h-64 overflow-auto rounded-lg border border-slate-200"><Table className="min-w-[900px] text-xs"><TableHeader><TableRow><TableHead>日期</TableHead><TableHead>趟次 / 里程</TableHead><TableHead>收入</TableHead><TableHead>柴油 L / 金额</TableHead><TableHead>维修保养</TableHead><TableHead>净收益</TableHead></TableRow></TableHeader><TableBody>{analysis.daily.length ? analysis.daily.map(item => <TableRow key={item.date}><TableCell>{item.date}</TableCell><TableCell>{item.tripCount} 趟 / {displayMoney(item.distanceKm)} km</TableCell><TableCell>¥{displayMoney(item.grossIncome)}</TableCell><TableCell>{displayMoney(item.fuelLiters)} L / ¥{displayMoney(item.fuelAmount)}</TableCell><TableCell>¥{displayMoney(item.repairAmount + item.maintenanceAmount)}</TableCell><TableCell>¥{displayMoney(item.netIncome)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={6} className="text-center text-slate-500">当前期间暂无运输、加油或维修记录。</TableCell></TableRow>}</TableBody></Table></div> },
      ],
      note: "外租车的月租、日租按有效租赁规则折算；小时租或台班租因缺少实际结算工时，不计入净收益并在详情中明确提示。",
    });
  }, [vehicleAnalysis.data, vehicleAnalysisTarget]);
  useEffect(() => {
    if (dieselPriceAlertRule.data) setDieselAlertThreshold(String(dieselPriceAlertRule.data.thresholdPercent));
  }, [dieselPriceAlertRule.data]);
  useEffect(() => {
    if (!riskRule.data) return;
    setRiskRuleForm({ enabled: riskRule.data.enabled, maxFuelFillRatio: String(riskRule.data.maxFuelFillRatio), maxTransportSpeedKmh: String(riskRule.data.maxTransportSpeedKmh), maxTransportDurationMinutes: String(riskRule.data.maxTransportDurationMinutes), maxOpenCheckInHours: String(riskRule.data.maxOpenCheckInHours), maxPendingReportHours: String(riskRule.data.maxPendingReportHours), overdueEscalationEnabled: riskRule.data.overdueEscalationEnabled, overdueEscalationHourChina: String(riskRule.data.overdueEscalationHourChina) });
  }, [riskRule.data]);
  const closeDailyAccount = trpc.finance.closeDailyAccount.useMutation({
    onSuccess: async result => {
      toast.success(`日结已封存：${result.closingNo}`);
      await Promise.all([financeSummary.refetch(), financeInvoices.refetch(), dailyAccountingReport.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const reopenDailyAccount = trpc.finance.reopenDailyAccount.useMutation({
    onSuccess: async result => {
      toast.success(`已授权反结账：${result.closingNo}（版本 ${result.revision}）`);
      setFinanceReopenReason("");
      await Promise.all([financeSummary.refetch(), financeInvoices.refetch(), dailyAccountingReport.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const refreshDieselLedger = async () => {
    await Promise.all([dieselGuidelinePrices.refetch(), dieselRefuelRecords.refetch(), dieselDailySummary.refetch(), dieselPriceAlertRule.refetch(), dieselSupplierReconciliation.refetch(), financeSummary.refetch(), audits.refetch()]);
  };
  const uploadDieselReceipt = trpc.evidence.upload.useMutation({ onError: error => toast.error(error.message) });
  const reverseGeocode = trpc.location.reverseGeocode.useMutation();
  const saveDieselPriceAlertRule = trpc.admin.diesel.savePriceAlertRule.useMutation({
    onSuccess: async () => { toast.success("柴油油价异常预警阈值已保存"); await refreshDieselLedger(); },
    onError: error => toast.error(error.message),
  });
  const saveDieselGuidelinePrice = trpc.admin.diesel.saveGuidelinePrice.useMutation({
    onSuccess: async () => {
      toast.success("柴油指导单价已保存；项目部供油将按生效日期自动取价");
      setDieselPriceDialogOpen(false);
      setDieselPriceForm(EMPTY_DIESEL_PRICE_FORM);
      await refreshDieselLedger();
    },
    onError: error => toast.error(error.message),
  });
  const saveDieselRefuelRecord = trpc.admin.diesel.saveRefuelRecord.useMutation({
    onSuccess: async result => {
      toast.success(`柴油领用已保存：¥${displayMoney(result.amount)}，适用单价 ¥${displayMoney(result.appliedUnitPrice)}/L`);
      if (result.priceAlert?.isAlert) toast.warning(`油价异常：相对同供应商上一笔波动 ${result.priceAlert.deviationPercent}%`);
      setDieselRefuelDialogOpen(false);
      setDieselRefuelForm(EMPTY_DIESEL_REFUEL_FORM);
      setDieselReceiptFile(null);
      await refreshDieselLedger();
    },
    onError: error => toast.error(error.message),
  });
  const submitDieselRefuel = async () => {
    try {
      let evidenceId: number | null = null;
      if (dieselReceiptFile) {
        if (!["image/jpeg", "image/png"].includes(dieselReceiptFile.type)) {
          toast.error("加油表照片仅支持 JPG 或 PNG 图片");
          return;
        }
        const capturedLocation = await captureWatermarkLocation();
        const locationAddress = (await reverseGeocode.mutateAsync({ latitude: capturedLocation.latitude, longitude: capturedLocation.longitude })).address;
        const capturedAt = new Date(dieselRefuelForm.refueledAt);
        if (Number.isNaN(capturedAt.getTime())) throw new Error("请填写有效加油时间后再生成工程水印");
        const projectName = projects.data?.find(project => String(project.id) === dieselRefuelForm.projectId)?.name ?? `项目 #${dieselRefuelForm.projectId}`;
        const antiCounterfeitNo = `DIESEL-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
        const watermarkValues: Record<string, string> = {
          capturedAt: `加油时间：${capturedAt.toLocaleString("zh-CN", { hour12: false })}`,
          principal: `操作人：${user?.name || "超级管理员"}`,
          location: `详细地点：${locationAddress}`,
          coordinates: `详细地点：${locationAddress}`,
          organization: `施工单位：${watermarkTemplateForm.organizationLabel}`,
          project: `项目名称：${projectName}`,
          antiCounterfeit: `防伪编号：${antiCounterfeitNo}`,
        };
        const requiredWatermarkFields = ["capturedAt", "principal", "location", "coordinates", "project", "antiCounterfeit"];
        const watermarkLines = Array.from(new Set([...watermarkTemplateForm.fields, ...requiredWatermarkFields])).map(field => watermarkValues[field]).filter(Boolean);
        const watermarkedFile = await createWatermarkedImage(dieselReceiptFile, watermarkLines, watermarkTemplateForm);
        const base64Data = await readImageAsBase64(watermarkedFile);
        const uploaded = await uploadDieselReceipt.mutateAsync({
          projectId: Number(dieselRefuelForm.projectId),
          sourceType: "diesel_receipt",
          sourceId: `diesel-meter-${antiCounterfeitNo}`,
          description: `柴油加油表工程水印 · ${dieselRefuelForm.stationOrSupplierName.trim() || "未登记供油点"} · ${dieselRefuelForm.liters || "0"}L · ${antiCounterfeitNo}`,
          capturedAt: capturedAt.toISOString(),
          longitude: capturedLocation.longitude,
          latitude: capturedLocation.latitude,
          fileName: watermarkedFile.name,
          mimeType: "image/jpeg",
          base64Data,
        });
        if (!uploaded.id) throw new Error("现金小票归档失败，未返回凭证编号");
        evidenceId = uploaded.id;
      }
      await saveDieselRefuelRecord.mutateAsync({
        id: dieselRefuelForm.id,
        projectId: Number(dieselRefuelForm.projectId),
        assetType: dieselRefuelForm.assetType,
        vehicleId: dieselRefuelForm.assetType === "vehicle" && dieselRefuelForm.vehicleId ? Number(dieselRefuelForm.vehicleId) : null,
        machineId: dieselRefuelForm.assetType === "machine" && dieselRefuelForm.machineId ? Number(dieselRefuelForm.machineId) : null,
        transportTripId: dieselRefuelForm.deductFromFreight && dieselRefuelForm.transportTripId ? Number(dieselRefuelForm.transportTripId) : null,
        supplyMethod: dieselRefuelForm.supplyMethod,
        stationOrSupplierName: dieselRefuelForm.stationOrSupplierName.trim() || null,
        liters: Number(dieselRefuelForm.liters),
        actualUnitPrice: dieselRefuelForm.supplyMethod === "external_station" && dieselRefuelForm.actualUnitPrice ? Number(dieselRefuelForm.actualUnitPrice) : null,
        deductFromFreight: dieselRefuelForm.assetType === "vehicle" && dieselRefuelForm.deductFromFreight,
        refueledAt: new Date(dieselRefuelForm.refueledAt).toISOString(),
        meterReading: dieselRefuelForm.meterReading ? Number(dieselRefuelForm.meterReading) : null,
        receiptNo: dieselRefuelForm.receiptNo.trim() || null,
        evidenceId,
        remarks: dieselRefuelForm.remarks.trim() || null,
        status: dieselRefuelForm.status,
      });
    } catch (error) {
      if (error instanceof Error) toast.error(error.message);
    }
  };
  const refreshBroadcasts = async () => { await Promise.all([broadcasts.refetch(), selectedBroadcastId ? broadcastDeliveries.refetch() : Promise.resolve()]); };
  const saveBroadcastDraft = trpc.broadcast.saveDraft.useMutation({
    onSuccess: async result => {
      toast.success("群发内容已保存，正在按授权范围直接发送");
      setSelectedBroadcastId(result.broadcastId);
      setBroadcastForm(EMPTY_BROADCAST_FORM);
      publishBroadcast.mutate({ id: result.broadcastId });
      await refreshBroadcasts();
    },
    onError: error => toast.error(error.message),
  });
  const reviewBroadcast = trpc.broadcast.review.useMutation({
    onSuccess: async result => { toast.success(`群发单状态已更新为 ${result.status}`); await refreshBroadcasts(); },
    onError: error => toast.error(error.message),
  });
  const publishBroadcast = trpc.broadcast.publish.useMutation({
    onSuccess: async result => { toast.success(`群发处理完成：成功 ${result.deliveredCount}，失败 ${result.failedCount}`); await refreshBroadcasts(); },
    onError: error => toast.error(error.message),
  });
  const revokeWechatBinding = trpc.admin.wechatLogin.revoke.useMutation({
    onSuccess: async () => {
      toast.success("微信授权绑定已解除；该人员须重新在微信内完成授权绑定");
      setWechatBindingActionTarget(null);
      await wechatLogins.refetch();
    },
    onError: error => toast.error(error.message),
  });

  const [selectedRoleId, setSelectedRoleId] = useState<number>();
  const [selectedSettingId, setSelectedSettingId] = useState<number>();
  const settingHistory = trpc.admin.settings.history.useQuery(
    { settingId: selectedSettingId ?? 0 },
    { enabled: canQuery && isSettings && selectedSettingId !== undefined },
  );
  const rolePermissionIds = trpc.admin.role.permissionIds.useQuery(
    { roleId: selectedRoleId ?? 0 },
    { enabled: canQuery && isPermission && selectedRoleId !== undefined },
  );
  const [draftPermissionIds, setDraftPermissionIds] = useState<number[]>([]);

  const [organizationForm, setOrganizationForm] = useState<OrganizationForm>(EMPTY_ORGANIZATION_FORM);
  const [projectForm, setProjectForm] = useState<ProjectForm>(EMPTY_PROJECT_FORM);
  const [positionForm, setPositionForm] = useState<PositionForm>(EMPTY_POSITION_FORM);
  const [vehicleForm, setVehicleForm] = useState<VehicleForm>(EMPTY_VEHICLE_FORM);
  const [vehicleEditorOpen, setVehicleEditorOpen] = useState(false);
  const [transportRouteSetupOpen, setTransportRouteSetupOpen] = useState(false);
  const [transportRouteSetup, setTransportRouteSetup] = useState({ loadName: "", unloadName: "", distanceKm: "", freightRuleId: "", isDefault: true });
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<number[]>([]);
  const [machineForm, setMachineForm] = useState<MachineForm>(EMPTY_MACHINE_FORM);
  const [machineDialogOpen, setMachineDialogOpen] = useState(false);
  const [machineCostForm, setMachineCostForm] = useState<MachineCostForm>(EMPTY_MACHINE_COST_FORM);
  const [machineCostDialogOpen, setMachineCostDialogOpen] = useState(false);
  const [employeeProfileForm, setEmployeeProfileForm] = useState<EmployeeProfileForm>(EMPTY_EMPLOYEE_PROFILE_FORM);
  const [employeeProfileDialogOpen, setEmployeeProfileDialogOpen] = useState(false);
  const [employeeInsuranceForm, setEmployeeInsuranceForm] = useState<EmployeeInsuranceForm>(EMPTY_EMPLOYEE_INSURANCE_FORM);
  const [employeeInsuranceDialogOpen, setEmployeeInsuranceDialogOpen] = useState(false);
  const [assetMaintenanceForm, setAssetMaintenanceForm] = useState<AssetMaintenanceForm>(EMPTY_ASSET_MAINTENANCE_FORM);
  const [assetMaintenanceDialogOpen, setAssetMaintenanceDialogOpen] = useState(false);
  const [dieselPriceForm, setDieselPriceForm] = useState<DieselPriceForm>(EMPTY_DIESEL_PRICE_FORM);
  const [dieselPriceDialogOpen, setDieselPriceDialogOpen] = useState(false);
  const [dieselRefuelForm, setDieselRefuelForm] = useState<DieselRefuelForm>(EMPTY_DIESEL_REFUEL_FORM);
  const [dieselRefuelDialogOpen, setDieselRefuelDialogOpen] = useState(false);
  const [dieselReceiptFile, setDieselReceiptFile] = useState<File | null>(null);
  const [dieselAlertThreshold, setDieselAlertThreshold] = useState("10");
  const [rfidWriterDeviceForm, setRfidWriterDeviceForm] = useState<RfidWriterDeviceForm>(EMPTY_RFID_WRITER_DEVICE_FORM);
  const [rfidCardForm, setRfidCardForm] = useState<RfidCardForm>(EMPTY_RFID_CARD_FORM);
  const [, setRfidPendingUid] = useState("");
  const [readingRfidBindingUid, setReadingRfidBindingUid] = useState(false);
  const selectedRfidVehicle = useMemo(() => (transportVehicleLedger.data ?? []).find(vehicle => String(vehicle.id) === rfidCardForm.vehicleId) ?? null, [rfidCardForm.vehicleId, transportVehicleLedger.data]);
  const [rfidWriterDialogOpen, setRfidWriterDialogOpen] = useState(false);
  const [rfidCardDialogOpen, setRfidCardDialogOpen] = useState(false);
  const [rfidWritePreview, setRfidWritePreview] = useState<{ jobId: number; jobNo: string; payload: Record<string, unknown> | null; hardwareMode: "manual_confirmation" | "pc_bridge"; bridgeToken: string | null } | null>(null);
  const [roleForm, setRoleForm] = useState<RoleForm>(EMPTY_ROLE_FORM);
  const [assignmentForm, setAssignmentForm] = useState<AssignmentForm>(EMPTY_ASSIGNMENT_FORM);
  const [personnelSearch, setPersonnelSearch] = useState("");
  const [employeeLedgerFilter, setEmployeeLedgerFilter] = useState({ search: "", type: "all", status: "all", insurance: "all" });
  const [machineLedgerFilter, setMachineLedgerFilter] = useState({ search: "", ownership: "all", status: "all" });
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const [localAccountForm, setLocalAccountForm] = useState({ username: "", displayName: "", initialPassword: "", status: "active" as LocalAccountStatus, loginMode: "both" as LocalLoginMode });
  const [localAccountEditForm, setLocalAccountEditForm] = useState<LocalAccountEditForm | null>(null);
  const [passwordResetTarget, setPasswordResetTarget] = useState<LocalAccountActionTarget | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<LocalAccountActionTarget | null>(null);
  const [userPermissionTarget, setUserPermissionTarget] = useState<LocalAccountActionTarget | null>(null);
  const [draftUserPermissionIds, setDraftUserPermissionIds] = useState<number[]>([]);
  const userPermissionIds = trpc.admin.personnel.userPermissionIds.useQuery({ userId: userPermissionTarget?.id ?? 0 }, { enabled: canQuery && isPermission && Boolean(userPermissionTarget), retry: false });
  const [wechatBindingActionTarget, setWechatBindingActionTarget] = useState<WechatBindingActionTarget | null>(null);
  const [departmentScopeForm, setDepartmentScopeForm] = useState<{ organizationId: string; module: DepartmentModuleCode | "" }>({ organizationId: "", module: "" });
  const [settingForm, setSettingForm] = useState<SettingForm>(EMPTY_SETTING_FORM);
  const [officialAccountConfigurationForm, setOfficialAccountConfigurationForm] = useState<OfficialAccountConfigurationForm>(EMPTY_OFFICIAL_ACCOUNT_CONFIGURATION_FORM);
  const [officialAccountConfigurationValidation, setOfficialAccountConfigurationValidation] = useState<{ success: boolean; message: string; statusCode?: number } | null>(null);
  const [externalAiApiConfigurationForm, setExternalAiApiConfigurationForm] = useState<ExternalAiApiConfigurationForm>(EMPTY_EXTERNAL_AI_API_CONFIGURATION_FORM);
  const [externalAiApiValidation, setExternalAiApiValidation] = useState<string | null>(null);
  const [dailyDigestForm, setDailyDigestForm] = useState<DailyDigestForm>(EMPTY_DAILY_DIGEST_FORM);
  const [dailyDigestPreviewProjectId, setDailyDigestPreviewProjectId] = useState("");
  const [dailyDigestPreviewDate, setDailyDigestPreviewDate] = useState(() => toLocalDateInput());
  const [settingDeleteTarget, setSettingDeleteTarget] = useState<SettingDeleteTarget | null>(null);
  const [masterDataDeleteTarget, setMasterDataDeleteTarget] = useState<MasterDataDeleteTarget | null>(null);

  // 首次加载后默认选中第一个角色；角色切换后以服务端真实权限回显编辑矩阵。
  useEffect(() => {
    if (!selectedRoleId && roles.data?.[0]) setSelectedRoleId(roles.data[0].id);
  }, [roles.data, selectedRoleId]);
  useEffect(() => {
    setDraftPermissionIds(rolePermissionIds.data ?? []);
  }, [rolePermissionIds.data]);
  useEffect(() => {
    if (userPermissionTarget) setDraftUserPermissionIds(userPermissionIds.data ?? []);
  }, [userPermissionIds.data, userPermissionTarget]);
  // 默认选中第一条配置，方便管理员直接查看其发布历史和回滚入口。
  /** 主清单隐藏停用项和当前无可下发模板的手工字段；历史、审计和服务端兼容读取不受影响。 */
  const allSettings = settings.data ?? [];
  const supervisorReviewAutoApproveSetting = allSettings.find(item => item.settingKey === "SUPERVISOR_REVIEW_AUTO_APPROVE" && item.status === "published");
  const supervisorReviewAutoApproveEnabled = supervisorReviewAutoApproveSetting?.valueJson === "true";
  const templateSettingKeys = new Set(["WECHAT_OFFICIAL_TEMPLATE_ID", "WECHAT_OFFICIAL_TEMPLATE_FIELDS"]);
  const visibleSettings = allSettings.filter(item => item.status !== "disabled" && !templateSettingKeys.has(item.settingKey) && !OFFICIAL_ACCOUNT_BASE_SETTING_KEYS.has(item.settingKey));
  const publishedOfficialSettingKeys = new Set(allSettings.filter(item => item.status === "published").map(item => item.settingKey));
  const officialCredentialsReady = publishedOfficialSettingKeys.has("WECHAT_OFFICIAL_APP_ID") && publishedOfficialSettingKeys.has("WECHAT_OFFICIAL_APP_SECRET");
  const officialBindingReady = officialCredentialsReady && publishedOfficialSettingKeys.has("WECHAT_OFFICIAL_APP_URL");
  const officialTemplateReady = officialCredentialsReady && publishedOfficialSettingKeys.has("WECHAT_OFFICIAL_TEMPLATE_ID");
  useEffect(() => {
    if (!visibleSettings.length) {
      if (selectedSettingId !== undefined) setSelectedSettingId(undefined);
      return;
    }
    if (!visibleSettings.some(item => item.id === selectedSettingId)) setSelectedSettingId(visibleSettings[0].id);
  }, [selectedSettingId, visibleSettings]);
  useEffect(() => {
    if (!dailyDigestSettings.data) return;
    setDailyDigestForm({
      enabled: dailyDigestSettings.data.enabled,
      deliveryHour: String(dailyDigestSettings.data.deliveryHour).padStart(2, "0"),
      deliveryMinute: String(dailyDigestSettings.data.deliveryMinute).padStart(2, "0"),
      includeEmptyProjects: dailyDigestSettings.data.includeEmptyProjects,
    });
  }, [dailyDigestSettings.data]);
  /** 已发布公开字段可安全回显；两项密钥始终保持空值，只以状态提示“留空保留密文”。 */
  useEffect(() => {
    if (!isSettings || !allSettings.length) return;
    const publishedValue = (settingKey: string) => allSettings.find(item => item.settingKey === settingKey && item.status === "published")?.valueJson ?? "";
    setOfficialAccountConfigurationForm(current => ({
      ...current,
      appId: current.appId || publishedValue("WECHAT_OFFICIAL_APP_ID"),
      appUrl: current.appUrl === EMPTY_OFFICIAL_ACCOUNT_CONFIGURATION_FORM.appUrl ? (publishedValue("WECHAT_OFFICIAL_APP_URL") || current.appUrl) : current.appUrl,
      egressUrl: current.egressUrl === EMPTY_OFFICIAL_ACCOUNT_CONFIGURATION_FORM.egressUrl ? (publishedValue("WECHAT_OFFICIAL_EGRESS_URL") || current.egressUrl) : current.egressUrl,
    }));
  }, [allSettings, isSettings]);
  useEffect(() => {
    if (!isSettings || !externalAiConfiguration.data) return;
    setExternalAiApiConfigurationForm(current => ({
      ...current,
      baseUrl: current.baseUrl || externalAiConfiguration.data.baseUrl,
      model: current.model || externalAiConfiguration.data.model,
      enabled: externalAiConfiguration.data.enabled,
    }));
  }, [externalAiConfiguration.data, isSettings]);
  useEffect(() => {
    if (!isBusinessWorkspace || businessWorkspaceProjectId || !projects.data?.length) return;
    const firstAvailableProject = projects.data.find(project => project.status !== "archived");
    if (firstAvailableProject) setBusinessWorkspaceProjectId(String(firstAvailableProject.id));
  }, [businessWorkspaceProjectId, isBusinessWorkspace, projects.data]);
  useEffect(() => {
    if (!(isFinance || isRisk) || financeProjectId || !projects.data?.length) return;
    const firstAvailableProject = projects.data.find(project => project.status !== "archived");
    if (firstAvailableProject) setFinanceProjectId(String(firstAvailableProject.id));
  }, [financeProjectId, isFinance, isRisk, projects.data]);
  useEffect(() => {
    setSelectedMachineId("");
  }, [businessWorkspaceProjectId]);
  useEffect(() => {
    if (!isMachinery || !machineryLedger.data?.length) return;
    if (!machineryLedger.data.some(machine => String(machine.id) === selectedMachineId)) {
      setSelectedMachineId(String(machineryLedger.data[0].id));
    }
  }, [isMachinery, machineryLedger.data, selectedMachineId]);
  const selectedSetting = visibleSettings.find(item => item.id === selectedSettingId);
  const selectedBusinessProject = projects.data?.find(project => String(project.id) === businessFilter.projectId);
  const selectedWorkspaceProject = projects.data?.find(project => String(project.id) === businessWorkspaceProjectId);
  const selectedMachineForDialog = (machineryLedger.data ?? []).find(machine => String(machine.id) === selectedMachineId);
  const filteredEmployeeProfiles = useMemo(() => (employeeProfiles.data ?? []).filter(profile => {
    const keyword = employeeLedgerFilter.search.trim().toLowerCase();
    const matchesSearch = !keyword || [profile.displayName, profile.localUsername, profile.teamName, profile.laborTeamName].some(value => value?.toLowerCase().includes(keyword));
    return matchesSearch && (employeeLedgerFilter.type === "all" || profile.employeeType === employeeLedgerFilter.type) && (employeeLedgerFilter.status === "all" || profile.employmentStatus === employeeLedgerFilter.status) && (employeeLedgerFilter.insurance === "all" || profile.insuranceStatus === employeeLedgerFilter.insurance);
  }), [employeeLedgerFilter, employeeProfiles.data]);
  const activeCsvExportScope = useMemo<CsvExportScope>(() => {
    const workspaceProjectLabel = selectedWorkspaceProject?.name ?? "当前已授权项目范围";
    const financeProjectLabel = projects.data?.find(project => String(project.id) === financeProjectId)?.name ?? workspaceProjectLabel;
    if (activeSection === "vehicles") {
      return {
        module: "车辆资源台账",
        filters: [
          ["项目", vehicleLedgerFilter.projectId === "all" ? "全部已授权项目" : projects.data?.find(project => String(project.id) === vehicleLedgerFilter.projectId)?.name ?? vehicleLedgerFilter.projectId],
          ["检索", vehicleLedgerFilter.search || "未设置"],
          ["资源性质", vehicleLedgerFilter.ownership === "all" ? "全部" : vehicleLedgerFilter.ownership === "owned" ? "公司自有" : "外租车辆"],
          ["调度状态", vehicleLedgerFilter.status === "all" ? "全部" : vehicleLedgerFilter.status === "active" ? "可调度" : vehicleLedgerFilter.status === "suspended" ? "暂停" : "停用"],
          ["分析期间", vehicleAnalysisPeriod],
        ],
      };
    }
    if (activeSection === "machinery") {
      return {
        module: "机械综合台账",
        filters: [
          ["项目", workspaceProjectLabel],
          ["检索", machineLedgerFilter.search || "未设置"],
          ["资源性质", machineLedgerFilter.ownership === "all" ? "全部" : machineLedgerFilter.ownership === "owned" ? "公司自有" : "外租机械"],
          ["机械状态", machineLedgerFilter.status === "all" ? "全部" : machineLedgerFilter.status],
          ["分析期间", machineStatementPeriod],
        ],
      };
    }
    if (activeSection === "labor") {
      return {
        module: "劳务考勤与工资台账",
        filters: [
          ["项目范围", workspaceProjectLabel],
          ["考勤日期", laborAttendanceDate || "全部日期"],
          ["工资期间", laborPeriod || "全部期间"],
          ["工资检索", laborPayrollSearch || "未设置"],
        ],
      };
    }
    if (activeSection === "diesel") {
      return {
        module: "柴油管理台账",
        filters: [
          ["项目", financeProjectLabel],
          ["车牌", dieselLedgerFilter.plateNo || "全部"],
          ["加油日期起", dieselLedgerFilter.dateFrom || "未设置"],
          ["加油日期止", dieselLedgerFilter.dateTo || "未设置"],
          ["月份", dieselLedgerFilter.month || "全部"],
          ["供油方式", dieselLedgerFilter.supplyMethod === "all" ? "全部" : dieselLedgerFilter.supplyMethod === "project_supply" ? "项目部供油" : "加油站现金加油"],
          ["车辆/机械", dieselLedgerFilter.assetType === "all" ? "全部" : dieselLedgerFilter.assetType === "vehicle" ? "车辆" : "机械"],
          ["供应商", dieselLedgerFilter.supplierName || "全部"],
          ["每日汇总日期", dieselDate],
        ],
      };
    }
    if (activeSection === "permission") {
      return {
        module: "员工档案台账",
        filters: [
          ["检索", employeeLedgerFilter.search || "未设置"],
          ["人员类型", employeeLedgerFilter.type === "all" ? "全部" : employeeLedgerFilter.type],
          ["在职状态", employeeLedgerFilter.status === "all" ? "全部" : employeeLedgerFilter.status],
          ["保险状态", employeeLedgerFilter.insurance === "all" ? "全部" : employeeLedgerFilter.insurance],
          ["数据范围", "当前管理员已授权人员范围"],
        ],
      };
    }
    return { module: "后台台账", filters: [["项目范围", workspaceProjectLabel], ["数据范围", "当前管理员已授权数据"]] };
  }, [activeSection, dieselDate, dieselLedgerFilter, employeeLedgerFilter, financePeriod, financeProjectId, laborAttendanceDate, laborPayrollSearch, laborPeriod, machineLedgerFilter, machineStatementPeriod, projects.data, selectedWorkspaceProject?.name, vehicleAnalysisPeriod, vehicleLedgerFilter]);
  useEffect(() => {
    const exportWindow = window as ExportScopeWindow;
    exportWindow.__roadConstructionExportScope = activeCsvExportScope;
    return () => {
      if (exportWindow.__roadConstructionExportScope === activeCsvExportScope) delete exportWindow.__roadConstructionExportScope;
    };
  }, [activeCsvExportScope]);
  const businessFilterLabel = `${selectedBusinessProject?.name ?? "全部项目"}${businessFilter.period ? ` · ${businessFilter.period}` : " · 全部期间"}`;
  const dailyDigestPreviewInput = useMemo(() => ({ projectId: Number(dailyDigestPreviewProjectId || 0), businessDate: dailyDigestPreviewDate }), [dailyDigestPreviewDate, dailyDigestPreviewProjectId]);
  const dailyDigestPreview = trpc.dailyDigest.preview.useQuery(dailyDigestPreviewInput, { enabled: canQuery && isSettings && Number(dailyDigestPreviewProjectId) > 0 && Boolean(dailyDigestPreviewDate) });

  /** 配置版本冲突后强制刷新列表与历史，避免管理员继续在旧版本上操作。 */
  const refreshAfterSettingConflict = async () => {
    toast.error("配置已被其他管理员更新，已刷新为最新版本，请确认后重试");
    await Promise.all([settings.refetch(), settingHistory.refetch(), audits.refetch()]);
  };

  const saveOrganization = trpc.admin.organization.save.useMutation({
    onSuccess: async () => {
      toast.success("组织节点已保存");
      setOrganizationForm(EMPTY_ORGANIZATION_FORM);
      await Promise.all([organizations.refetch(), overview.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveProject = trpc.admin.project.save.useMutation({
    onSuccess: async () => {
      toast.success("项目节点已保存");
      setProjectForm(EMPTY_PROJECT_FORM);
      await Promise.all([projects.refetch(), overview.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const savePosition = trpc.admin.position.save.useMutation({
    onSuccess: async () => {
      toast.success("岗位字典已保存");
      setPositionForm(EMPTY_POSITION_FORM);
      await Promise.all([positions.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveVehicle = trpc.admin.vehicle.save.useMutation({
    onSuccess: async data => {
      toast.success(`车辆台账已保存，理论方量 ${data.theoreticalVolumeCubicMeters} m³`);
      setVehicleForm(EMPTY_VEHICLE_FORM);
      setVehicleEditorOpen(false);
      await Promise.all([vehicles.refetch(), overview.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveTransportSite = trpc.transport.saveSite.useMutation({ onSuccess: async () => { toast.success("装卸土点已保存"); await Promise.all([transportSites.refetch(), transportRoutePresets.refetch(), audits.refetch()]); }, onError: error => toast.error(error.message) });
  const saveTransportRoutePreset = trpc.transport.saveRoutePreset.useMutation({ onSuccess: async () => { toast.success("运输路线已保存"); await Promise.all([transportRoutePresets.refetch(), audits.refetch()]); }, onError: error => toast.error(error.message) });
  const saveMachine = trpc.machinery.saveMachine.useMutation({
    onSuccess: async () => {
      toast.success(machineForm.id ? "机械档案已在 PC 后台更新" : "机械档案已在 PC 后台建立");
      setMachineForm(EMPTY_MACHINE_FORM);
      setMachineDialogOpen(false);
      await Promise.all([machineryLedger.refetch(), machineCostSummaries.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const refreshSubcontractWorkspace = async () => {
    await Promise.all([subcontractTeams.refetch(), subcontractPackages.refetch(), subcontractSummary.refetch(), subcontractTakeoffs.refetch(), audits.refetch()]);
  };
  const saveSubcontractTeam = trpc.subcontract.saveTeam.useMutation({
    onSuccess: async () => {
      toast.success(subcontractTeamForm.id ? "施工队台账已更新" : "施工队台账已建立");
      setSubcontractTeamDialogOpen(false);
      setSubcontractTeamForm(EMPTY_SUBCONTRACT_TEAM_FORM);
      await refreshSubcontractWorkspace();
    },
    onError: error => toast.error(error.message),
  });
  const saveSubcontractPackage = trpc.subcontract.savePackage.useMutation({
    onSuccess: async result => {
      toast.success(`分包批次已保存：上游 ¥${displayMoney(result.upstreamAmount)}，分包 ¥${displayMoney(result.subcontractAmount)}，测算差额 ¥${displayMoney(result.marginAmount)}`);
      setSubcontractPackageDialogOpen(false);
      setSubcontractPackageForm(EMPTY_SUBCONTRACT_PACKAGE_FORM);
      await refreshSubcontractWorkspace();
    },
    onError: error => toast.error(error.message),
  });
  const saveMeasurementTakeoff = trpc.measurement.saveTakeoff.useMutation({
    onSuccess: async result => {
      toast.success(`项目部收方草稿已保存，申报金额 ¥${displayMoney(result.declaredAmount)}`);
      setMeasurementTakeoffDialogOpen(false);
      setMeasurementTakeoffForm(EMPTY_MEASUREMENT_TAKEOFF_FORM);
      await refreshSubcontractWorkspace();
    },
    onError: error => toast.error(error.message),
  });
  const transitionSubcontractPackage = trpc.subcontract.transitionPackage.useMutation({
    onSuccess: async () => {
      toast.success("分包批次状态已更新");
      await refreshSubcontractWorkspace();
    },
    onError: error => toast.error(error.message),
  });
  const refreshPurchasingWorkspace = async () => {
    await Promise.all([purchasingRequests.refetch(), purchasingOrders.refetch(), purchasingInventory.refetch(), purchasingSettlements.refetch(), audits.refetch()]);
  };
  const saveInventoryTransaction = trpc.purchasing.saveInventoryTransaction.useMutation({
    onSuccess: async result => {
      toast.success(`库存流水已登记，金额 ¥${displayMoney(result.amount)}`);
      setInventoryTransactionDialogOpen(false);
      setInventoryTransactionForm(EMPTY_INVENTORY_TRANSACTION_FORM);
      await refreshPurchasingWorkspace();
    },
    onError: error => toast.error(error.message),
  });
  const saveRiskRule = trpc.projectRisk.saveRule.useMutation({
    onSuccess: async () => {
      toast.success("AI 项目风控阈值与逾期升级计划已保存");
      await Promise.all([riskRule.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const scanProjectRisks = trpc.projectRisk.scan.useMutation({
    onSuccess: async result => {
      const scanned = result.scanned ?? { pendingConstructionReports: 0, openAttendanceCheckIns: 0, dieselRefuelRecords: 0, transportTrips: 0 };
      toast.success(result.enabled ? `真实数据扫描完成：日报 ${scanned.pendingConstructionReports}、考勤 ${scanned.openAttendanceCheckIns}、柴油 ${scanned.dieselRefuelRecords}、运输 ${scanned.transportTrips}；发现 ${result.detectedCount} 条，新增 ${result.createdCount} 条，已投递 ${result.notifiedCount} 条提醒` : "当前项目风险扫描已停用");
      await Promise.all([riskAlerts.refetch(), riskFinanceAnalysis.refetch(), riskCapacityReadiness.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const updateRiskAlertStatus = trpc.projectRisk.updateAlertStatus.useMutation({
    onSuccess: async () => {
      toast.success("风险预警处置状态已更新");
      await Promise.all([riskAlerts.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const assignRiskRectification = trpc.projectRisk.assignRectification.useMutation({
    onSuccess: async () => {
      toast.success("已分配整改责任人并发送站内待办");
      setRiskRectificationTarget(null);
      await Promise.all([riskAlerts.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const runOverdueRiskEscalation = trpc.projectRisk.runOverdueEscalation.useMutation({
    onSuccess: async result => {
      toast.success(`逾期升级验收完成：升级 ${result.escalatedCount} 条，投递 ${result.notifiedCount} 条站内提醒`);
      await Promise.all([riskAlerts.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const generateRiskBriefing = trpc.projectRisk.generateBriefing.useMutation({
    onSuccess: result => {
      setRiskBriefing({ ...result.briefing, source: result.source, model: result.model, externalFallback: result.externalFallback });
      if (result.externalFallback) toast.warning(`外部 AI 已降级（${result.externalFallback}）；系统已继续生成可用摘要`);
      else toast.success(result.source === "fallback" ? "AI 服务暂不可用，已生成规则汇总摘要" : result.source === "external" ? "外部 AI 管理摘要已生成" : "系统内置 AI 管理摘要已生成");
    },
    onError: error => toast.error(error.message),
  });
  const saveMachineCost = trpc.machinery.saveCost.useMutation({
    onSuccess: async data => {
      toast.success(`机械成本已录入，系统核算金额 ¥${displayMoney(data.amount)}`);
      setMachineCostForm(EMPTY_MACHINE_COST_FORM);
      setMachineCostDialogOpen(false);
      await Promise.all([machineCosts.refetch(), machineCostSummaries.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveMachineMonthlyStatement = trpc.machinery.saveMonthlyStatement.useMutation({
    onSuccess: async result => {
      toast.success(`会计机械月度明细已保存：总产值 ¥${displayMoney(result.preview.statement.totalOutput)}`);
      setMachineStatementDialogOpen(false);
      setMachineStatementForm(EMPTY_MACHINE_MONTHLY_STATEMENT_FORM);
      await Promise.all([machineMonthlyStatements.refetch(), machineCostSummaries.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const transitionMachineMonthlyStatement = trpc.machinery.transitionMonthlyStatement.useMutation({
    onSuccess: async () => {
      toast.success("机械月度明细状态已更新");
      await Promise.all([machineMonthlyStatements.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveEmployeeProfile = trpc.admin.employee.saveProfile.useMutation({
    onSuccess: async () => {
      toast.success(employeeProfileForm.id ? "员工档案已更新" : "员工档案已建立");
      setEmployeeProfileForm(EMPTY_EMPLOYEE_PROFILE_FORM);
      setEmployeeProfileDialogOpen(false);
      await Promise.all([employeeProfiles.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveEmployeeInsurance = trpc.admin.employee.saveInsurance.useMutation({
    onSuccess: async () => {
      toast.success("员工保险台账已保存，到期状态已刷新");
      setEmployeeInsuranceForm(EMPTY_EMPLOYEE_INSURANCE_FORM);
      setEmployeeInsuranceDialogOpen(false);
      await Promise.all([employeeProfiles.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveAssetMaintenance = trpc.admin.assetMaintenance.save.useMutation({
    onSuccess: async () => {
      toast.success("维修保养费用已保存并纳入资源汇总");
      setAssetMaintenanceForm(EMPTY_ASSET_MAINTENANCE_FORM);
      setAssetMaintenanceDialogOpen(false);
      await Promise.all([assetMaintenanceRecords.refetch(), assetMaintenanceSummary.refetch(), machineCosts.refetch(), machineCostSummaries.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveRfidWriterDevice = trpc.transport.saveRfidWriterDevice.useMutation({
    onSuccess: async () => {
      toast.success("写卡器台账已保存");
      setRfidWriterDeviceForm(EMPTY_RFID_WRITER_DEVICE_FORM);
      setRfidWriterDialogOpen(false);
      await Promise.all([rfidWriterDevices.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveVehicleRfidCard = trpc.transport.saveVehicleRfidCard.useMutation({
    onSuccess: async () => {
      toast.success("车辆射频卡绑定已保存；请生成写卡任务后再进行物理写入");
      setRfidCardForm(EMPTY_RFID_CARD_FORM);
      setRfidCardDialogOpen(false);
      await Promise.all([vehicleRfidCards.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const readRfidBindingUid = async () => {
    setReadingRfidBindingUid(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch("http://127.0.0.1:47601/api/read-uid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({})) as { success?: boolean; cardUid?: string; message?: string };
      if (!response.ok || !result.success || !result.cardUid) throw new Error(result.message || `读取卡 ID 失败（HTTP ${response.status}）`);
      setRfidCardForm(current => ({ ...current, cardUid: result.cardUid! }));
      toast.success("已读取卡 ID，并自动填入本次绑定表单。");
    } catch (error) {
      const message = error instanceof DOMException && error.name === "AbortError"
        ? "读取卡 ID 超时：请确认 NTAG216 已放在 uTrust 4701 F CL Reader 感应区。"
        : error instanceof Error ? error.message : "读取卡 ID 失败";
      toast.error(message);
    } finally {
      window.clearTimeout(timeoutId);
      setReadingRfidBindingUid(false);
    }
  };
  const prepareRfidCardWrite = trpc.transport.prepareRfidCardWrite.useMutation({
    onSuccess: data => {
      const isPcBridge = data.hardwareMode === "pc_bridge";
      setRfidWritePreview({ jobId: data.jobId, jobNo: data.jobNo, payload: "payload" in data ? data.payload as Record<string, unknown> : null, hardwareMode: data.hardwareMode, bridgeToken: isPcBridge ? data.bridgeToken : null });
      toast.success(isPcBridge ? "PC 受控写卡任务已生成，请保持新卡放在 uTrust 感应区后执行写入。" : "写卡载荷已生成；请在现场写卡器完成物理写入后确认结果");
    },
    onError: error => toast.error(error.message),
  });
  const [writingRfidCard, setWritingRfidCard] = useState(false);
  const writeRfidCardWithBridge = async () => {
    if (!rfidWritePreview?.bridgeToken) return toast.error("本地写卡授权无效，请重新生成 PC 写卡任务");
    setWritingRfidCard(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch("http://127.0.0.1:47601/api/write-vehicle-card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bridgeToken: rfidWritePreview.bridgeToken }), cache: "no-store", signal: controller.signal });
      const result = await response.json().catch(() => ({})) as { success?: boolean; jobNo?: string; message?: string; status?: string };
      if (!response.ok || !result.success || result.status !== "confirmed") throw new Error(result.message || `本地写卡未通过回读校验（HTTP ${response.status}）`);
      await Promise.all([vehicleRfidCards.refetch(), rfidWriterDevices.refetch(), audits.refetch()]);
      toast.success(`车辆卡 ${result.jobNo || rfidWritePreview.jobNo} 已完成写入、回读校验并启用。`);
      window.requestAnimationFrame(() => setRfidWritePreview(null));
    } catch (error) {
      const message = error instanceof DOMException && error.name === "AbortError" ? "本地写卡超时：请保持车辆卡停留在 uTrust 感应区，并检查桥接连接。" : error instanceof Error ? error.message : "本地车辆卡写入失败";
      toast.error(message);
    } finally {
      window.clearTimeout(timeoutId);
      setWritingRfidCard(false);
    }
  };
  const confirmRfidCardWrite = trpc.transport.confirmRfidCardWrite.useMutation({
    onSuccess: async data => {
      await Promise.all([vehicleRfidCards.refetch(), rfidWriterDevices.refetch(), audits.refetch()]);
      toast.success(data.status === "confirmed" ? "写卡结果已确认并留痕" : "写卡失败已记录，请核对设备和卡片后重试");
      window.requestAnimationFrame(() => setRfidWritePreview(null));
    },
    onError: error => toast.error(error.message),
  });
  const saveRole = trpc.admin.role.save.useMutation({
    onSuccess: async () => {
      toast.success("角色已保存");
      setRoleForm(EMPTY_ROLE_FORM);
      await roles.refetch();
      await overview.refetch();
    },
  });
  const saveAssignment = trpc.admin.personnel.saveAssignment.useMutation({
    onSuccess: async () => {
      toast.success(assignmentForm.id ? "人员授权已更新" : "人员授权已保存");
      setAssignmentForm(EMPTY_ASSIGNMENT_FORM);
      await Promise.all([assignments.refetch(), audits.refetch(), users.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const createLocalUser = trpc.admin.personnel.createLocalUser.useMutation({
    onSuccess: async () => {
      toast.success("普通管理人员账号已创建，请继续配置角色、部门和项目范围");
      setLocalAccountForm({ username: "", displayName: "", initialPassword: "", status: "active", loginMode: "both" });
      await Promise.all([users.refetch(), audits.refetch(), overview.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const setLocalUserStatus = trpc.admin.personnel.setLocalUserStatus.useMutation({
    onSuccess: async () => {
      toast.success("本地账号状态已更新；已停用账号的后续请求会被服务端拒绝");
      await Promise.all([users.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const updateLocalUser = trpc.admin.personnel.updateLocalUser.useMutation({
    onSuccess: async () => {
      toast.success("普通管理人员账号资料已更新");
      setLocalAccountEditForm(null);
      await Promise.all([users.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const resetLocalUserPassword = trpc.admin.personnel.resetLocalUserPassword.useMutation({
    onSuccess: async () => {
      toast.success("普通管理人员密码已重置，新密码不会再次显示");
      setPasswordResetTarget(null);
      setResetPassword("");
      await audits.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const deleteLocalUser = trpc.admin.personnel.deleteLocalUser.useMutation({
    onSuccess: async data => {
      toast.success(`普通管理人员账号已删除，并撤销 ${data.revokedAssignmentCount} 项角色授权`);
      setDeleteTarget(null);
      await Promise.all([users.refetch(), assignments.refetch(), audits.refetch(), overview.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const setUserPermissions = trpc.admin.personnel.setUserPermissions.useMutation({
    onSuccess: async () => {
      toast.success("该用户的专属操作权限已保存并即时生效");
      setUserPermissionTarget(null);
      setDraftUserPermissionIds([]);
      await Promise.all([users.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveDepartmentScope = trpc.admin.department.saveScope.useMutation({
    onSuccess: async () => {
      toast.success("部门业务范围已保存，相关人员下次请求将按新范围校验");
      setDepartmentScopeForm({ organizationId: "", module: "" });
      await departmentScopes.refetch();
    },
  });
  const saveSetting = trpc.admin.settings.saveDraft.useMutation({
    onSuccess: async data => {
      toast.success(settingForm.id ? `配置草稿已更新为 v${data.version ?? "新版本"}` : "配置草稿已安全保存");
      setSettingForm(EMPTY_SETTING_FORM);
      await Promise.all([settings.refetch(), settingHistory.refetch(), overview.refetch(), audits.refetch()]);
    },
    onError: refreshAfterSettingConflict,
  });
  const saveOfficialAccountConfiguration = trpc.admin.settings.saveOfficialAccountConfiguration.useMutation({
    onSuccess: async result => {
      setOfficialAccountConfigurationValidation(result);
      result.success ? toast.success("服务号五项配置已一次保存并校验通过") : toast.error(`服务号配置已保存，但校验未通过：${result.message}`);
      setOfficialAccountConfigurationForm(current => ({ ...current, appSecret: "", egressSigningSecret: "" }));
      await Promise.all([settings.refetch(), officialTemplateCoverage.refetch(), overview.refetch(), audits.refetch()]);
    },
    onError: error => {
      setOfficialAccountConfigurationValidation({ success: false, message: error.message });
      toast.error(error.message);
    },
  });
  const saveExternalAiConfiguration = trpc.admin.settings.saveExternalAiConfiguration.useMutation({
    onSuccess: async () => {
      toast.success("外部 AI API 配置已加密保存；启用后新的 AI 管理摘要将优先使用该模型");
      setExternalAiApiConfigurationForm(current => ({ ...current, apiKey: "" }));
      setExternalAiApiValidation(null);
      await Promise.all([externalAiConfiguration.refetch(), settings.refetch(), audits.refetch()]);
    },
    onError: error => {
      setExternalAiApiValidation(error.message);
      toast.error(error.message);
    },
  });
  const testExternalAiConfiguration = trpc.admin.settings.testExternalAiConfiguration.useMutation({
    onSuccess: async result => {
      setExternalAiApiValidation(result.message);
      toast.success("外部 AI API 连接校验通过");
      await audits.refetch();
    },
    onError: error => {
      setExternalAiApiValidation(error.message);
      toast.error(error.message);
    },
  });
  const saveEvidenceWatermarkTemplate = trpc.admin.settings.saveEvidenceWatermarkTemplate.useMutation({
    onSuccess: async result => {
      toast.success(`工程水印模板已发布为 v${result.version}，后续现场取证将使用新样式`);
      await Promise.all([evidenceWatermarkTemplate.refetch(), settings.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const setSupervisorReviewAutoApprove = trpc.admin.settings.setSupervisorReviewAutoApprove.useMutation({
    onSuccess: async result => {
      toast.success(result.enabled ? "已开启：上级主管审核节点将自动通过" : "已关闭：后续上级主管审核需人工办理");
      await Promise.all([settings.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const publishSetting = trpc.admin.settings.publish.useMutation({
    onSuccess: async () => {
      toast.success("配置已发布并记录版本");
      await settings.refetch();
      await audits.refetch();
    },
    onError: refreshAfterSettingConflict,
  });
  const testSetting = trpc.admin.settings.test.useMutation({
    onSuccess: async result => {
      result.success ? toast.success(result.message) : toast.error(result.message);
      await audits.refetch();
    },
  });
  const checkOfficialTemplateCapability = trpc.admin.settings.checkOfficialAccountTemplateCapability.useMutation({
    onSuccess: async result => {
      result.success ? toast.success(result.message) : toast.error(result.message);
      await audits.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const [officialTemplateOptions, setOfficialTemplateOptions] = useState<Array<{ templateId: string; title: string; content: string; fieldMapping: Record<string, string>; persistentBusinessEligible?: boolean; eligibilityMessage?: string }>>([]);
  const listOfficialTemplates = trpc.admin.settings.listOfficialAccountTemplates.useMutation({
    onSuccess: result => {
      setOfficialTemplateOptions(result.templates);
      result.success ? toast.success(result.message) : toast.error(result.message);
    },
    onError: error => toast.error(error.message),
  });
  const createOfficialTemplateDraft = trpc.admin.settings.createOfficialAccountTemplateDraft.useMutation({
    onSuccess: async result => {
      toast.success(result.message);
      setOfficialTemplateOptions([]);
      await Promise.all([settings.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const [officialTemplateModuleById, setOfficialTemplateModuleById] = useState<Record<string, "purchasing" | "measurement" | "finance" | "machinery" | "transport" | "security" | "labor" | "construction">>({});
  const bindOfficialModuleTemplate = trpc.admin.settings.bindOfficialAccountModuleTemplate.useMutation({
    onSuccess: async result => {
      toast.success(result.message);
      await Promise.all([officialTemplateCoverage.refetch(), settings.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveDailyDigest = trpc.dailyDigest.saveSettings.useMutation({
    onSuccess: async data => {
      toast.success(data.taskUid ? "每日项目汇总已保存，定时任务已同步" : "每日项目汇总设置已保存");
      await Promise.all([dailyDigestSettings.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const runDailyDigestNow = trpc.dailyDigest.runNow.useMutation({
    onSuccess: async result => {
      toast.success(`每日汇总已执行：${result.projectCount} 个项目，成功/幂等投递 ${result.deliveredCount} 次，失败 ${result.failedCount} 次`);
      await Promise.all([dailyDigestSettings.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const disableSetting = trpc.admin.settings.disable.useMutation({
    onSuccess: async result => {
      toast.success(`配置已停用并记录为 v${result.version}`);
      await Promise.all([settings.refetch(), settingHistory.refetch(), audits.refetch()]);
    },
    onError: refreshAfterSettingConflict,
  });
  const removeSetting = trpc.admin.settings.remove.useMutation({
    onSuccess: async () => {
      toast.success("配置已删除，配置值与历史快照中的可恢复内容已清除");
      setSettingDeleteTarget(null);
      setSettingForm(current => current.id ? EMPTY_SETTING_FORM : current);
      setSelectedSettingId(undefined);
      await Promise.all([settings.refetch(), settingHistory.refetch(), overview.refetch(), audits.refetch()]);
    },
    onError: refreshAfterSettingConflict,
  });
  const removeMasterData = trpc.admin.masterData.remove.useMutation({
    onSuccess: async result => {
      const target = masterDataDeleteTarget;
      toast.success(result.operation === "revoked" ? "角色授权已撤销并保留可追溯历史" : `${target?.label ?? "主数据"}已安全删除`);
      setMasterDataDeleteTarget(null);
      if (target?.resource === "organization") setOrganizationForm(EMPTY_ORGANIZATION_FORM);
      if (target?.resource === "position") setPositionForm(EMPTY_POSITION_FORM);
      if (target?.resource === "project") setProjectForm(EMPTY_PROJECT_FORM);
      if (target?.resource === "vehicle") {
        setVehicleForm(EMPTY_VEHICLE_FORM);
        setVehicleEditorOpen(false);
      }
      if (target?.resource === "role") setRoleForm(EMPTY_ROLE_FORM);
      await Promise.all([organizations.refetch(), positions.refetch(), projects.refetch(), vehicles.refetch(), roles.refetch(), assignments.refetch(), departmentScopes.refetch(), overview.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  /**
   * 批量删除不使用数据库批量 SQL：逐条调用既有受控删除接口，让每一条均经过关联检查、权限判断与审计。
   * 任一车辆仍被运输趟次引用时只会返回该条失败，不影响其他无关联车辆的安全删除。
   */
  const batchRemoveVehicles = async (rows: LedgerTableRow[]) => {
    if (!rows.length) return;
    if (!window.confirm(`确认删除选中的 ${rows.length} 辆车辆吗？系统将逐条核验运输趟次、项目范围和关联关系；有关联的车辆不会被删除。`)) return;
    const outcomes = await Promise.allSettled(rows.map(row => removeMasterData.mutateAsync({ resource: "vehicle", id: Number(row.id) })));
    const succeeded = outcomes.filter(result => result.status === "fulfilled").length;
    const failed = outcomes.length - succeeded;
    setDesktopRecordDetail({
      title: "车辆批量受控删除结果",
      description: "每一条均已在服务端独立执行权限、项目范围、运输趟次关联和审计校验；失败记录未被修改。",
      fields: rows.map((row, index) => ({ label: `车辆 #${row.id}`, value: outcomes[index].status === "fulfilled" ? "已安全删除" : `未删除：${outcomes[index].reason instanceof Error ? outcomes[index].reason.message : "关联或权限校验未通过"}` })),
    });
    if (succeeded) toast.success(`已安全删除 ${succeeded} 辆无关联车辆${failed ? `；${failed} 辆因有关联或权限限制未删除` : ""}`);
    else toast.error("没有车辆可被删除；请检查运输趟次关联、项目范围或账号权限");
  };
  /** 历史机械成本、租赁与维修责任链不可删除；批量动作只将可访问机械受控变更为“已退役”。 */
  const batchRetireMachines = async (rows: LedgerTableRow[]) => {
    if (!rows.length) return;
    if (!window.confirm(`确认将选中的 ${rows.length} 台机械批量标记为“已退役”吗？此操作不会删除成本、租赁和维修历史；每台机械仍须单独通过项目范围与租赁契约校验。`)) return;
    const machineById = new Map((machineryLedger.data ?? []).map(machine => [machine.id, machine]));
    const outcomes = await Promise.allSettled(rows.map(row => {
      const machine = machineById.get(Number(row.id));
      if (!machine || !machine.projectId) return Promise.reject(new Error("机械台账缺少有效项目归属或已刷新，请重新选择"));
      return saveMachine.mutateAsync({ id: machine.id, projectId: machine.projectId, operatorUserId: machine.operatorUserId ?? null, code: machine.code, name: machine.name, model: machine.model ?? null, ownership: machine.ownership, supplierName: machine.supplierName ?? null, plateOrAssetNo: machine.plateOrAssetNo ?? null, status: "retired", leaseTerms: machine.ownership === "leased" && machine.leaseTerms ? { billingType: machine.leaseTerms.billingType, rate: Number(machine.leaseTerms.rate), effectiveFrom: toBusinessDateInput(machine.leaseTerms.effectiveFrom), effectiveTo: machine.leaseTerms.effectiveTo ? toBusinessDateInput(machine.leaseTerms.effectiveTo) : null } : null });
    }));
    const succeeded = outcomes.filter(result => result.status === "fulfilled").length;
    const failed = outcomes.length - succeeded;
    setDesktopRecordDetail({ title: "机械批量退役结果", description: "机械记录及其成本、租赁、维修历史均被保留；每条退役动作已由服务端独立校验并审计。", fields: rows.map((row, index) => ({ label: `机械 #${row.id}`, value: outcomes[index].status === "fulfilled" ? "已标记为退役" : `未处理：${outcomes[index].reason instanceof Error ? outcomes[index].reason.message : "项目范围或租赁契约校验未通过"}` })) });
    if (succeeded) toast.success(`已将 ${succeeded} 台机械标记为退役${failed ? `；${failed} 台未处理` : ""}`);
    else toast.error("没有机械可退役；请检查当前项目范围、租赁状态或账号权限");
  };
  /** 员工工资、考勤、保险和授权均具有审计价值；批量动作只停用档案，不删除任何历史责任链。 */
  const batchSuspendEmployees = async (rows: LedgerTableRow[]) => {
    if (!rows.length) return;
    if (!window.confirm(`确认停用选中的 ${rows.length} 份员工档案吗？系统将保留工资、考勤、保险和授权历史，并逐条记录审计。`)) return;
    const profileById = new Map((employeeProfiles.data ?? []).map(profile => [profile.id, profile]));
    const outcomes = await Promise.allSettled(rows.map(row => {
      const profile = profileById.get(Number(row.id));
      if (!profile) return Promise.reject(new Error("员工档案已刷新，请重新选择"));
      return saveEmployeeProfile.mutateAsync({ id: profile.id, userId: profile.userId ?? null, laborWorkerId: profile.laborWorkerId ?? null, projectId: profile.projectId ?? null, employeeType: profile.employeeType, teamName: profile.teamName ?? null, employmentStatus: "suspended", joinedAt: profile.joinedAt ? toBusinessDateInput(profile.joinedAt) : null, leftAt: profile.leftAt ? toBusinessDateInput(profile.leftAt) : null, salaryBasis: profile.salaryBasis, baseSalary: profile.baseSalary === null ? null : Number(profile.baseSalary), remarks: profile.remarks ?? null });
    }));
    const succeeded = outcomes.filter(result => result.status === "fulfilled").length;
    const failed = outcomes.length - succeeded;
    setDesktopRecordDetail({ title: "员工批量停用结果", description: "员工档案、工资、考勤、保险和授权历史均被保留；每一条停用操作均单独由服务端校验并审计。", fields: rows.map((row, index) => ({ label: `员工档案 #${row.id}`, value: outcomes[index].status === "fulfilled" ? "已停用" : `未处理：${outcomes[index].reason instanceof Error ? outcomes[index].reason.message : "人员关联或权限校验未通过"}` })) });
    if (succeeded) toast.success(`已停用 ${succeeded} 份员工档案${failed ? `；${failed} 份未处理` : ""}`);
    else toast.error("没有员工档案可停用；请检查当前账号权限或档案状态");
  };
  const rollbackSetting = trpc.admin.settings.rollback.useMutation({
    onSuccess: async result => {
      toast.success(`配置已回滚并发布为 v${result.version}`);
      await Promise.all([settings.refetch(), settingHistory.refetch(), audits.refetch()]);
    },
    onError: refreshAfterSettingConflict,
  });
  const savePermissions = trpc.admin.role.setPermissions.useMutation({
    onSuccess: async () => {
      toast.success("角色权限矩阵已更新");
      await rolePermissionIds.refetch();
    },
  });
  const createBackup = trpc.admin.backup.create.useMutation({
    onSuccess: async backup => {
      toast.success(`业务数据逻辑备份已归档：${backup.recordCount} 条记录`);
      await Promise.all([backups.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const downloadBackup = trpc.admin.backup.download.useMutation({
    onSuccess: async backup => {
      const anchor = document.createElement("a");
      anchor.href = backup.url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.download = backup.fileName;
      anchor.click();
      toast.success("已生成受控下载链接，下载行为已记录审计");
      await audits.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const transitionConstructionReport = trpc.construction.transitionReport.useMutation({
    onSuccess: async () => {
      toast.success("施工日报状态已更新");
      await Promise.all([constructionDailyReports.refetch(), constructionDailySummary.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveConstructionReport = trpc.construction.saveReport.useMutation({
    onSuccess: async result => {
      toast.success(result.created ? "施工日报已在 PC 后台保存" : "施工日报已在 PC 后台更新");
      setConstructionReportEditor(null);
      await Promise.all([constructionDailyReports.refetch(), constructionDailySummary.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const submitPayroll = trpc.labor.payroll.submit.useMutation({
    onSuccess: async () => {
      toast.success("工资条已提交会计审核");
      await payrollStatements.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const approvePayroll = trpc.labor.payroll.approve.useMutation({
    onSuccess: async () => {
      toast.success("工资条审核状态已更新");
      await payrollStatements.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const payPayroll = trpc.labor.payroll.pay.useMutation({
    onSuccess: async () => {
      toast.success("工资条已确认发放");
      setPayrollPaymentTarget(null);
      setPaymentReference("");
      await payrollStatements.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const submitDailyWage = trpc.labor.dailyWage.submit.useMutation({
    onSuccess: async () => {
      toast.success("临时日结已提交会计/财务审核");
      await laborDailyWages.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const reviewDailyWage = trpc.labor.dailyWage.review.useMutation({
    onSuccess: async result => {
      toast.success(result.status === "approved" ? "临时日结已审核通过，待登记付款" : "临时日结已退回草稿，可修改后重新提交");
      await laborDailyWages.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const payDailyWage = trpc.labor.dailyWage.pay.useMutation({
    onSuccess: async () => {
      toast.success("临时日结已登记实际付款并完成结算");
      setDailyWagePaymentTarget(null);
      setDailyWagePaymentForm({ paidAt: toLocalDateInput(), paymentReference: "" });
      await Promise.all([laborDailyWages.refetch(), payrollStatements.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const transitionMachineCost = trpc.machinery.transitionCost.useMutation({
    onSuccess: async () => {
      toast.success("机械成本状态已更新");
      await Promise.all([machineCosts.refetch(), machineCostSummaries.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const transitionTransportTrip = trpc.transport.transitionTrip.useMutation({
    onSuccess: async () => {
      toast.success("运输趟次状态已更新");
      await transportTrips.refetch();
    },
    onError: error => toast.error(error.message),
  });

  const permissionModuleLabels: Record<string, string> = { admin: "后台治理", mobile: "移动工作台", construction: "施工日报", labor: "劳务与工资", machinery: "机械资源", transport: "运输调度", purchase: "采购仓储", measurement: "工程计量", finance: "财务成本", evidence: "影像取证", message: "消息中心" };
  const permissionActionLabels: Record<string, string> = { read: "查看", create: "新增", edit: "编辑", submit: "提交", review: "审核", settle: "结算/发放", void: "作废/归档", export: "导出", print: "打印", manage: "全量办理", publish: "发布", rollback: "回滚", test: "测试" };
  // 按功能模块分组展示权限，避免管理员在长列表中难以辨识业务归属。
  const permissionGroups = useMemo(() => {
    const grouped: Record<string, Array<NonNullable<typeof permissions.data>[number]>> = {};
    for (const permission of permissions.data ?? []) {
      (grouped[permission.module] ??= []).push(permission);
    }
    return Object.entries(grouped);
  }, [permissions.data]);
  const departmentNodes = useMemo(
    () => (organizations.data ?? []).filter(item => item.type === "department" || item.type === "project_department"),
    [organizations.data],
  );
  const departmentScopePickerState = getDepartmentScopePickerState(organizations.isLoading, departmentNodes.length);
  const organizationNameById = useMemo(
    () => new Map((organizations.data ?? []).map(item => [item.id, item.name])),
    [organizations.data],
  );
  const userNameById = useMemo(
    () => new Map((users.data ?? []).map(user => [user.id, user.name || `用户 #${user.id}`])),
    [users.data],
  );
  const selectedAssignmentRole = useMemo(
    () => roles.data?.find(role => role.id === Number(assignmentForm.roleId)),
    [assignmentForm.roleId, roles.data],
  );
  const selectedAssignmentTemplate = useMemo(
    () => roleTemplates.data?.find(template => template.roleId === Number(assignmentForm.roleId)) ?? null,
    [assignmentForm.roleId, roleTemplates.data],
  );
  const groupedRoleTemplates = useMemo(() => {
    const grouped: Record<string, NonNullable<typeof roleTemplates.data>> = {};
    for (const template of roleTemplates.data ?? []) {
      if (template.code === "SUPER_ADMIN") continue;
      (grouped[template.group] ??= []).push(template);
    }
    return Object.entries(grouped);
  }, [roleTemplates.data]);
  const assignmentRequiresBusinessScope = Boolean(selectedAssignmentRole && selectedAssignmentRole.code !== "SUPER_ADMIN");
  const assignmentHasScope = Boolean(assignmentForm.organizationId || assignmentForm.projectId);
  const assignmentReady = Boolean(assignmentForm.userId && selectedAssignmentRole && (!assignmentRequiresBusinessScope || assignmentHasScope));
  const normalizedAssignmentScope = getAssignmentScopeSaveInput(assignmentForm);
  const localManagerUsers = useMemo(() => (users.data ?? []).filter(user => user.loginMethod === "local_manager"), [users.data]);
  const filteredLocalManagerUsers = useMemo(() => {
    const keyword = personnelSearch.trim().toLowerCase();
    if (!keyword) return localManagerUsers;
    return localManagerUsers.filter(user => `${user.name ?? ""} ${user.localUsername ?? ""}`.toLowerCase().includes(keyword));
  }, [localManagerUsers, personnelSearch]);
  const filteredAssignments = useMemo(() => {
    const keyword = assignmentSearch.trim().toLowerCase();
    const rows = assignments.data ?? [];
    if (!keyword) return rows;
    return rows.filter(item => `${item.userName ?? ""} ${item.localUsername ?? ""} ${item.roleName} ${item.roleCode} ${item.organizationName ?? ""} ${item.projectName ?? ""}`.toLowerCase().includes(keyword));
  }, [assignmentSearch, assignments.data]);
  const activeAssignmentCount = useMemo(() => (assignments.data ?? []).filter(item => getAssignmentLifecycle(item).label === "有效").length, [assignments.data]);

  const renderOverview = () => (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-[#203c48]">统一管理入口 · 全局治理</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">系统治理概览</h1>
        <p className="mt-2 text-sm text-slate-500">此处仅展示配置与治理对象，施工生产数据在移动业务工作台按岗位办理。</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="组织节点" value={overview.data?.organizations} description="部门、班组与成本中心" icon={Building2} />
        <MetricCard title="项目层级" value={overview.data?.projects} description="项目、标段、工区与作业面" icon={FolderKanban} />
        <MetricCard title="角色数量" value={overview.data?.roles} description="可分配的后台和业务角色" icon={ShieldCheck} />
        <MetricCard title="配置项" value={overview.data?.settings} description="接口、密钥与业务参数" icon={KeyRound} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">上线前治理清单</CardTitle>
          <CardDescription>按以下顺序完成基础配置，避免业务账号、项目范围和外部接口出现无主状态。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-slate-600 md:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-4"><b className="text-slate-800">01 组织与项目</b><p className="mt-1 text-xs leading-5">建立公司、部门、项目、标段和成本中心。</p></div>
          <div className="rounded-xl bg-slate-50 p-4"><b className="text-slate-800">02 人员与角色</b><p className="mt-1 text-xs leading-5">设置岗位、角色、项目数据范围和有效期。</p></div>
          <div className="rounded-xl bg-slate-50 p-4"><b className="text-slate-800">03 系统设置</b><p className="mt-1 text-xs leading-5">配置微信公众号服务号及外部 API，校验后发布。</p></div>
        </CardContent>
      </Card>
      <Card className="border-[#d8e3e0]">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">真实项目数据验收预检</CardTitle>
            <CardDescription>仅统计授权与业务记录数量，不读取或展示人员、考勤、工资明细；不会创建任何模拟数据。</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => realDataReadiness.refetch()} disabled={realDataReadiness.isFetching}>刷新预检</Button>
        </CardHeader>
        <CardContent>
          {realDataReadiness.isLoading ? <EmptyState text="正在读取真实数据验收准备度…" /> : realDataReadiness.isError ? <EmptyState text="暂无法读取验收预检，请确认当前账号具有超级管理员权限并稍后重试。" /> : realDataReadiness.data ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-4 py-3">
                <div><p className="text-sm font-medium text-slate-800">{realDataReadiness.data.ready ? "已具备完整复测前提" : "尚未具备完整复测前提"}</p><p className="mt-1 text-xs text-slate-500">真实项目验收应使用已授权账号和可追溯业务记录完成，不能以模拟数据替代。</p></div>
                <Badge variant={realDataReadiness.data.ready ? "secondary" : "outline"}>{realDataReadiness.data.ready ? "可安排复测" : "待补齐真实数据"}</Badge>
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {realDataReadiness.data.checks.map(check => <div key={check.key} className={`rounded-lg border p-3 ${check.ready ? "border-emerald-100 bg-emerald-50/40" : "border-amber-100 bg-amber-50/40"}`}><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium text-slate-800">{check.label}</p><Badge variant={check.ready ? "secondary" : "outline"}>{check.ready ? "已就绪" : "待补齐"}</Badge></div><p className="mt-1.5 text-xs leading-5 text-slate-500">{check.detail}</p><div className="mt-2 flex items-center justify-between gap-2"><p className="text-xs text-slate-500">责任：{check.ownerRole}</p><Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setLocation(check.actionPath)}>{check.actionLabel}</Button></div></div>)}
              </div>
              {realDataReadiness.data.findings.length ? <div className="rounded-xl border border-rose-100 bg-rose-50/30 p-3"><div className="mb-2 flex items-center justify-between gap-2"><div><p className="text-sm font-semibold text-rose-950">跨模块经营异常与现场闭环提醒</p><p className="mt-1 text-xs text-rose-800">仅依据真实业务聚合数据识别断链；AI 和系统提示不替代人工复核、审批或财务确认。</p></div><Badge variant="outline">{realDataReadiness.data.findings.length} 项待处置</Badge></div><div className="grid gap-2 lg:grid-cols-2">{realDataReadiness.data.findings.map(item => <div key={item.id} className={`rounded-lg border p-3 ${item.severity === "critical" ? "border-rose-200 bg-white" : "border-amber-200 bg-amber-50/40"}`}><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium text-slate-800">{item.title}</p><Badge variant="outline">{item.severity === "critical" ? "重要" : "提示"}</Badge></div><p className="mt-1.5 text-xs leading-5 text-slate-600">{item.summary}</p><div className="mt-2 flex items-center justify-between gap-2"><p className="text-xs text-slate-500">责任：{item.ownerRole}</p><Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setLocation(item.actionPath)}>{item.actionLabel}</Button></div></div>)}</div></div> : null}
            </div>
          ) : <EmptyState text="暂无预检结果，请刷新后重试。" />}
        </CardContent>
      </Card>
      <Card className="border-[#d8e3e0] shadow-sm">
        <CardHeader>
          <p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">项目经理驾驶舱 · 作业节奏</p>
          <CardTitle className="mt-1 text-base">施工项目经营 KPI 作业指引</CardTitle>
          <CardDescription>指标只用于组织真实业务录入、审核与复核；业务暂估、未审核成本或未确认收入必须与财务确认口径分开查看。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[
            { name: "施工日报有效率", cadence: "每日", owner: "项目生产经理", source: "日报、工程部位、影像、资源消耗", path: "/admin/construction", action: "检查施工日报" },
            { name: "资源成本归集", cadence: "每周", owner: "机务 / 运输负责人", source: "机械台班、柴油领用、运输趟次", path: "/admin/diesel", action: "核对资源消耗" },
            { name: "采购实耗闭环", cadence: "每周", owner: "物资负责人", source: "采购订单、验收、入库、领用、退库", path: "/admin/purchasing", action: "处理采购库存" },
            { name: "计量与分包对账", cadence: "每周", owner: "商务合约负责人", source: "收方、工程计量、分包包件、合同清单", path: "/admin/settlement", action: "录入收方计量" },
            { name: "财务确认与资金计划", cadence: "每周 / 月", owner: "财务负责人", source: "应收应付、资金流水、已审核业务单据", path: "/admin/finance", action: "进入财务确认" },
            { name: "服务号通知送达率", cadence: "每日", owner: "数字化运维负责人", source: "真实模板、员工绑定、投递回执与失败码", path: "/admin/settings", action: "检查模板投递" },
          ].map(item => <div key={item.name} className="rounded-xl border border-[#d8e3e0] bg-[#f8fbfa] p-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold text-[#203c48]">{item.name}</p><Badge variant="outline">{item.cadence}</Badge></div><p className="mt-2 text-xs text-slate-500">责任：{item.owner}</p><p className="mt-1 text-xs leading-5 text-slate-600">数据源：{item.source}</p><Button size="sm" variant="outline" className="mt-3 h-7 px-2 text-xs" onClick={() => setLocation(item.path)}>{item.action}</Button></div>)}
        </CardContent>
      </Card>
    </div>
  );

  const renderOrganization = () => {
    const submitOrganization = () => {
      if (!organizationForm.code.trim() || !organizationForm.name.trim()) return toast.error("请填写组织编码和组织名称");
      saveOrganization.mutate({
        id: organizationForm.id,
        parentId: organizationForm.parentId ? Number(organizationForm.parentId) : null,
        code: organizationForm.code.trim(),
        name: organizationForm.name.trim(),
        type: organizationForm.type,
        managerUserId: organizationForm.managerUserId ? Number(organizationForm.managerUserId) : null,
        costCenterCode: organizationForm.costCenterCode.trim() || null,
        sortOrder: Number(organizationForm.sortOrder || 0),
        status: organizationForm.status,
      });
    };
    const submitProject = () => {
      if (!projectForm.code.trim() || !projectForm.name.trim() || !projectForm.nodeType.trim()) return toast.error("请填写项目编码、名称和层级名称");
      saveProject.mutate({
        id: projectForm.id,
        parentId: projectForm.parentId ? Number(projectForm.parentId) : null,
        organizationId: projectForm.organizationId ? Number(projectForm.organizationId) : null,
        code: projectForm.code.trim(),
        name: projectForm.name.trim(),
        nodeType: projectForm.nodeType.trim(),
        projectType: projectForm.projectType,
        status: projectForm.status,
        startDate: projectForm.startDate || null,
        endDate: projectForm.endDate || null,
        costCenterCode: projectForm.costCenterCode.trim() || null,
        sortOrder: Number(projectForm.sortOrder || 0),
      });
    };
    const submitPosition = () => {
      if (!positionForm.code.trim() || !positionForm.name.trim() || !positionForm.category.trim()) return toast.error("请填写岗位编码、名称和分类");
      savePosition.mutate({ id: positionForm.id, code: positionForm.code.trim(), name: positionForm.name.trim(), category: positionForm.category.trim(), description: positionForm.description.trim() || null, status: positionForm.status });
    };
    const editableOrganizationOptions = (organizations.data ?? []).filter(item => item.id !== organizationForm.id);
    const editableProjectOptions = (projects.data ?? []).filter(item => item.id !== projectForm.id);

    return (
      <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
        <section className="space-y-6">
          <div>
            <p className="text-sm font-medium text-[#203c48]">基础主数据</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">组织、岗位与项目层级</h1>
            <p className="mt-2 text-sm text-slate-500">统一维护管理部门、负责人、岗位、项目范围和状态；所有保存均由超级管理员鉴权并写入审计。</p>
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">组织架构</CardTitle><CardDescription>支持集团、公司、部门、项目部和班组层级。点击条目即可在右侧维护。</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {organizations.data?.length ? organizations.data.map(item => (
                <button key={item.id} className="flex w-full items-center justify-between rounded-lg border border-slate-100 px-3 py-2.5 text-left transition-colors hover:border-[#b9ccc6] hover:bg-[#f7faf9]" onClick={() => setOrganizationForm({ id: item.id, parentId: item.parentId ? String(item.parentId) : "", code: item.code, name: item.name, type: item.type, managerUserId: item.managerUserId ? String(item.managerUserId) : "", costCenterCode: item.costCenterCode ?? "", sortOrder: String(item.sortOrder), status: item.status })}>
                  <div><p className="text-sm font-medium">{item.name}</p><p className="mt-0.5 text-xs text-slate-500">{item.code} · 上级：{item.parentId ? organizationNameById.get(item.parentId) ?? `#${item.parentId}` : "顶级"} · 负责人：{item.managerUserId ? userNameById.get(item.managerUserId) ?? `#${item.managerUserId}` : "未设置"} · 成本中心：{item.costCenterCode || "未设置"}</p></div>
                  <Badge variant={item.status === "active" ? "secondary" : "outline"}>{item.status === "active" ? "启用" : "停用"}</Badge>
                </button>
              )) : <EmptyState text="暂无组织节点，请在右侧新增后开始维护。" />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">岗位字典</CardTitle><CardDescription>岗位用于人员档案与职责管理，不直接替代角色权限。</CardDescription></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {positions.data?.length ? positions.data.map(item => <button key={item.id} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-sm transition-colors hover:border-[#b9ccc6] hover:bg-[#f7faf9]" onClick={() => setPositionForm({ id: item.id, code: item.code, name: item.name, category: item.category, description: item.description ?? "", status: item.status })}>{item.name}<span className="ml-1 text-xs text-slate-400">{item.category} · {item.status === "active" ? "启用" : "停用"}</span></button>) : <EmptyState text="暂无自定义岗位；请在右侧新增后再为人员分配。" />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">项目层级</CardTitle><CardDescription>推荐“项目 → 标段/工区 → 单位工程 → 施工段/作业面”；点击条目可维护归属、计划日期和状态。</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {projects.data?.length ? projects.data.map(item => <button key={item.id} className="w-full rounded-lg border border-slate-100 px-3 py-2.5 text-left transition-colors hover:border-[#b9ccc6] hover:bg-[#f7faf9]" onClick={() => setProjectForm({ id: item.id, parentId: item.parentId ? String(item.parentId) : "", organizationId: item.organizationId ? String(item.organizationId) : "", code: item.code, name: item.name, nodeType: item.nodeType, projectType: item.projectType ?? "other", status: item.status, startDate: item.startDate ? new Date(item.startDate).toISOString().slice(0, 10) : "", endDate: item.endDate ? new Date(item.endDate).toISOString().slice(0, 10) : "", costCenterCode: item.costCenterCode ?? "", sortOrder: String(item.sortOrder) })}><p className="text-sm font-medium">{item.name}</p><p className="mt-0.5 text-xs text-slate-500">{item.code} · {item.nodeType} · 上级：{item.parentId ? projects.data?.find(project => project.id === item.parentId)?.name ?? `#${item.parentId}` : "顶级"} · {item.status}</p></button>) : <EmptyState text="暂无项目层级，请在右侧新增项目或项目节点。" />}
            </CardContent>
          </Card>
        </section>
        <aside className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0"><CardTitle className="text-base">{organizationForm.id ? "维护组织节点" : "新增组织节点"}</CardTitle>{organizationForm.id ? <Button size="sm" variant="ghost" onClick={() => setOrganizationForm(EMPTY_ORGANIZATION_FORM)}>新建</Button> : null}</CardHeader>
            <CardContent className="space-y-3">
              <div><Label>组织编码</Label><Input value={organizationForm.code} placeholder="例如 DEPT_FIN" onChange={event => setOrganizationForm({ ...organizationForm, code: event.target.value.toUpperCase() })} /></div>
              <div><Label>组织名称</Label><Input value={organizationForm.name} placeholder="例如 财务部" onChange={event => setOrganizationForm({ ...organizationForm, name: event.target.value })} /></div>
              <div><Label>上级组织</Label><Select value={organizationForm.parentId || "ROOT"} onValueChange={value => setOrganizationForm({ ...organizationForm, parentId: value === "ROOT" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ROOT">顶级节点</SelectItem>{editableOrganizationOptions.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>节点类型</Label><Select value={organizationForm.type} onValueChange={(value: OrganizationType) => setOrganizationForm({ ...organizationForm, type: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="group">集团</SelectItem><SelectItem value="company">公司</SelectItem><SelectItem value="department">部门</SelectItem><SelectItem value="project_department">项目部</SelectItem><SelectItem value="team">班组</SelectItem></SelectContent></Select></div>
              <div><Label>组织负责人</Label><Select value={organizationForm.managerUserId || "UNASSIGNED"} onValueChange={value => setOrganizationForm({ ...organizationForm, managerUserId: value === "UNASSIGNED" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">暂不设置</SelectItem>{users.data?.map(user => <SelectItem key={user.id} value={String(user.id)}>{user.name || `用户 #${user.id}`}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid grid-cols-2 gap-3"><div><Label>成本中心</Label><Input value={organizationForm.costCenterCode} placeholder="可选" onChange={event => setOrganizationForm({ ...organizationForm, costCenterCode: event.target.value.toUpperCase() })} /></div><div><Label>排序</Label><Input type="number" min="0" value={organizationForm.sortOrder} onChange={event => setOrganizationForm({ ...organizationForm, sortOrder: event.target.value })} /></div></div>
              <div><Label>状态</Label><Select value={organizationForm.status} onValueChange={(value: OrganizationStatus) => setOrganizationForm({ ...organizationForm, status: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">启用</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select></div>
              <div className="grid gap-2 sm:grid-cols-2"><Button className="bg-[#203c48] hover:bg-[#17313b]" disabled={!organizationForm.code || !organizationForm.name || saveOrganization.isPending} onClick={submitOrganization}>{organizationForm.id ? "保存组织变更" : "保存组织节点"}</Button>{organizationForm.id ? <Button variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => setMasterDataDeleteTarget({ resource: "organization", id: organizationForm.id!, label: organizationForm.name, description: `确认删除组织“${organizationForm.name}”？若仍被下级节点、人员、项目、车辆、授权或部门业务范围引用，系统将拒绝删除并要求先迁移或停用。` })}>删除组织</Button> : null}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0"><CardTitle className="text-base">{projectForm.id ? "维护项目节点" : "新增项目节点"}</CardTitle>{projectForm.id ? <Button size="sm" variant="ghost" onClick={() => setProjectForm(EMPTY_PROJECT_FORM)}>新建</Button> : null}</CardHeader>
            <CardContent className="space-y-3">
              <div><Label>项目编码</Label><Input value={projectForm.code} placeholder="例如 GZ-GS-01" onChange={event => setProjectForm({ ...projectForm, code: event.target.value.toUpperCase() })} /></div>
              <div><Label>项目名称</Label><Input value={projectForm.name} placeholder="例如 GZ 高速一标段" onChange={event => setProjectForm({ ...projectForm, name: event.target.value })} /></div>
              <div><Label>上级项目</Label><Select value={projectForm.parentId || "ROOT"} onValueChange={value => setProjectForm({ ...projectForm, parentId: value === "ROOT" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ROOT">顶级项目</SelectItem>{editableProjectOptions.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>归属组织</Label><Select value={projectForm.organizationId || "UNASSIGNED"} onValueChange={value => setProjectForm({ ...projectForm, organizationId: value === "UNASSIGNED" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">暂不设置</SelectItem>{organizations.data?.filter(item => item.status === "active").map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid grid-cols-2 gap-3"><div><Label>层级名称</Label><Input value={projectForm.nodeType} onChange={event => setProjectForm({ ...projectForm, nodeType: event.target.value })} /></div><div><Label>工程类型</Label><Select value={projectForm.projectType} onValueChange={(value: ProjectType) => setProjectForm({ ...projectForm, projectType: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="highway">公路</SelectItem><SelectItem value="railway">铁路</SelectItem><SelectItem value="municipal">市政</SelectItem><SelectItem value="other">其他</SelectItem></SelectContent></Select></div></div>
              <div className="grid grid-cols-2 gap-3"><div><Label>开始日期</Label><Input type="date" value={projectForm.startDate} onChange={event => setProjectForm({ ...projectForm, startDate: event.target.value })} /></div><div><Label>结束日期</Label><Input type="date" value={projectForm.endDate} onChange={event => setProjectForm({ ...projectForm, endDate: event.target.value })} /></div></div>
              <div className="grid grid-cols-2 gap-3"><div><Label>成本中心</Label><Input value={projectForm.costCenterCode} placeholder="可选" onChange={event => setProjectForm({ ...projectForm, costCenterCode: event.target.value.toUpperCase() })} /></div><div><Label>排序</Label><Input type="number" min="0" value={projectForm.sortOrder} onChange={event => setProjectForm({ ...projectForm, sortOrder: event.target.value })} /></div></div>
              <div><Label>状态</Label><Select value={projectForm.status} onValueChange={(value: ProjectStatus) => setProjectForm({ ...projectForm, status: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="planning">筹备</SelectItem><SelectItem value="active">进行中</SelectItem><SelectItem value="suspended">暂停</SelectItem><SelectItem value="completed">已完工</SelectItem><SelectItem value="archived">已归档</SelectItem></SelectContent></Select></div>
              <div className="grid gap-2 sm:grid-cols-2"><Button className="bg-[#203c48] hover:bg-[#17313b]" disabled={!projectForm.code || !projectForm.name || !projectForm.nodeType || saveProject.isPending} onClick={submitProject}>{projectForm.id ? "保存项目变更" : "保存项目节点"}</Button>{projectForm.id ? <Button variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => setMasterDataDeleteTarget({ resource: "project", id: projectForm.id!, label: projectForm.name, description: `确认删除项目节点“${projectForm.name}”？若仍有下级项目、授权、资源或业务单据，系统将拒绝删除并提示改为归档。` })}>删除项目</Button> : null}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0"><CardTitle className="text-base">{positionForm.id ? "维护岗位" : "新增岗位"}</CardTitle>{positionForm.id ? <Button size="sm" variant="ghost" onClick={() => setPositionForm(EMPTY_POSITION_FORM)}>新建</Button> : null}</CardHeader>
            <CardContent className="space-y-3"><div><Label>岗位编码</Label><Input value={positionForm.code} placeholder="例如 TRANSPORT_MANAGER" onChange={event => setPositionForm({ ...positionForm, code: event.target.value.toUpperCase() })} /></div><div><Label>岗位名称</Label><Input value={positionForm.name} placeholder="例如 运输主管" onChange={event => setPositionForm({ ...positionForm, name: event.target.value })} /></div><div><Label>岗位分类</Label><Input value={positionForm.category} placeholder="例如 业务岗位" onChange={event => setPositionForm({ ...positionForm, category: event.target.value })} /></div><div><Label>职责说明</Label><Input value={positionForm.description} placeholder="可选" onChange={event => setPositionForm({ ...positionForm, description: event.target.value })} /></div><div><Label>状态</Label><Select value={positionForm.status} onValueChange={(value: OrganizationStatus) => setPositionForm({ ...positionForm, status: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">启用</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select></div><div className="grid gap-2 sm:grid-cols-2"><Button variant="outline" disabled={!positionForm.code || !positionForm.name || !positionForm.category || savePosition.isPending} onClick={submitPosition}>{positionForm.id ? "保存岗位变更" : "保存岗位"}</Button>{positionForm.id ? <Button variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => setMasterDataDeleteTarget({ resource: "position", id: positionForm.id!, label: positionForm.name, description: `确认删除岗位“${positionForm.name}”？若仍被人员档案引用，系统将拒绝删除并提示改为停用。` })}>删除岗位</Button> : null}</div></CardContent>
          </Card>
        </aside>
      </div>
    );
  };

  const renderVehicles = () => {
    const vehicleTypeLabel: Record<VehicleType, string> = { dump_truck: "渣土车", tractor: "牵引车", mixer: "搅拌车", flatbed: "平板车", pickup: "皮卡车", suv: "越野车", other: "其他" };
    const vehicleStatusLabel: Record<VehicleStatus, string> = { active: "可调度", suspended: "暂停", disabled: "停用" };
    const vehicleStatusClass: Record<VehicleStatus, string> = { active: "bg-emerald-50 text-emerald-700", suspended: "bg-amber-50 text-amber-700", disabled: "bg-slate-100 text-slate-600" };
    const rows = vehicles.data ?? [];
    const settlementProjectId = vehicleLedgerFilter.projectId === "all" ? null : Number(vehicleLedgerFilter.projectId);
    const filteredRows = rows.filter(item => {
      const keyword = vehicleLedgerFilter.search.trim().toLowerCase();
      return (!keyword || [item.plateNo, item.ownerName].some(value => value?.toLowerCase().includes(keyword))) && (vehicleLedgerFilter.projectId === "all" || String(item.projectId) === vehicleLedgerFilter.projectId) && (vehicleLedgerFilter.ownership === "all" || item.ownership === vehicleLedgerFilter.ownership) && (vehicleLedgerFilter.status === "all" || item.status === vehicleLedgerFilter.status);
    });
    const vehicleMaintenanceRows = (assetMaintenanceRecords.data ?? []).filter(item => item.assetType === "vehicle");
    const vehicleMaintenanceAmountById = new Map<number, number>();
    vehicleMaintenanceRows.filter(item => item.status !== "void").forEach(item => vehicleMaintenanceAmountById.set(item.assetId, (vehicleMaintenanceAmountById.get(item.assetId) ?? 0) + Number(item.amount)));
    const vehicleSummaryById = new Map((vehicleSummaries.data ?? []).map(item => [item.vehicleId, item]));
    const selectedVehicleRows = filteredRows.filter(item => selectedVehicleIds.includes(item.id));
    const toggleVehicleSelection = (id: number, checked: boolean) => setSelectedVehicleIds(current => checked ? Array.from(new Set([...current, id])) : current.filter(item => item !== id));
    const toggleAllVisibleVehicles = (checked: boolean) => setSelectedVehicleIds(checked ? filteredRows.map(item => item.id) : []);
    const requestRemoveVehicle = (item: NonNullable<typeof vehicles.data>[number]) => setMasterDataDeleteTarget({ resource: "vehicle", id: item.id, label: `车辆 ${item.plateNo}`, description: `确认删除车辆“${item.plateNo}”？系统将先核验运输趟次、RFID 绑定及其他业务关联；有关联时会拒绝删除，您可改为停用车辆。` });
    const submitVehicle = () => {
      if (!vehicleForm.projectId || !vehicleForm.plateNo.trim()) return toast.error("请填写车辆归属项目和车牌号");
      if (!vehicleForm.boxLengthMeters || !vehicleForm.boxWidthMeters || !vehicleForm.boxHeightMeters) return toast.error("请填写货厢长、宽、高");
      if (vehicleForm.ownership === "leased" && (!vehicleForm.ownerName.trim() || !vehicleForm.leaseRate || !vehicleForm.leaseStartDate)) return toast.error("外租车辆必须填写出租方、租金和起租日期");
      saveVehicle.mutate({
        id: vehicleForm.id,
        projectId: Number(vehicleForm.projectId),
        organizationId: vehicleForm.organizationId ? Number(vehicleForm.organizationId) : null,
        plateNo: vehicleForm.plateNo.trim(),
        vehicleType: vehicleForm.vehicleType,
        ownership: vehicleForm.ownership,
        ownerName: vehicleForm.ownerName.trim() || null,
        driverUserId: vehicleForm.driverUserId ? Number(vehicleForm.driverUserId) : null, driverName: vehicleForm.driverName.trim() || null, driverPhone: vehicleForm.driverPhone.trim() && !vehicleForm.driverPhone.includes("*") ? vehicleForm.driverPhone.trim() : undefined,
        boxLengthMeters: Number(vehicleForm.boxLengthMeters),
        boxWidthMeters: Number(vehicleForm.boxWidthMeters),
        boxHeightMeters: Number(vehicleForm.boxHeightMeters),
        loadFactor: Number(vehicleForm.loadFactor || 1),
        payloadTons: vehicleForm.payloadTons ? Number(vehicleForm.payloadTons) : null,
        fuelTankCapacityLiters: vehicleForm.fuelTankCapacityLiters ? Number(vehicleForm.fuelTankCapacityLiters) : null,
        status: vehicleForm.status,
        leaseTerms: vehicleForm.ownership === "leased" ? { billingType: vehicleForm.leaseBillingType, rate: Number(vehicleForm.leaseRate), effectiveFrom: vehicleForm.leaseStartDate, effectiveTo: vehicleForm.leaseEndDate || null } : null,
      });
    };
    const openVehicle = (item: NonNullable<typeof vehicles.data>[number]) => {
      setVehicleForm({
        id: item.id,
        projectId: String(item.projectId),
        organizationId: item.organizationId ? String(item.organizationId) : "",
        plateNo: item.plateNo,
        vehicleType: item.vehicleType,
        ownership: item.ownership,
        ownerName: item.ownerName ?? "",
        driverUserId: item.driverUserId ? String(item.driverUserId) : "",
        driverName: item.driverName ?? "",
        driverPhone: item.driverPhoneMasked ?? "",
        boxLengthMeters: String(item.boxLengthMeters),
        boxWidthMeters: String(item.boxWidthMeters),
        boxHeightMeters: String(item.boxHeightMeters),
        loadFactor: String(item.loadFactor),
        payloadTons: item.payloadTons ? String(item.payloadTons) : "",
        fuelTankCapacityLiters: item.fuelTankCapacityLiters ? String(item.fuelTankCapacityLiters) : "",
        status: item.status,
        leaseBillingType: item.leaseTerms?.billingType ?? "monthly",
        leaseRate: item.leaseTerms?.rate ? String(item.leaseTerms.rate) : "",
        leaseStartDate: item.leaseTerms?.effectiveFrom ? toLocalDateInput(item.leaseTerms.effectiveFrom) : "",
        leaseEndDate: item.leaseTerms?.effectiveTo ? toLocalDateInput(item.leaseTerms.effectiveTo) : "",
      });
      setVehicleEditorOpen(true);
    };
    const showVehicleDetail = (item: NonNullable<typeof vehicles.data>[number]) => setDesktopRecordDetail({
      title: `车辆档案 · ${item.plateNo}`,
      description: "车辆档案由超级管理后台统一维护。已有运输趟次的车辆不可删除，应改为暂停或停用以保留运输责任链。",
      fields: [
        { label: "所属项目", value: projects.data?.find(project => project.id === item.projectId)?.name ?? `#${item.projectId}` },
        { label: "车辆类型", value: vehicleTypeLabel[item.vehicleType] },
        { label: "产权/所属人", value: item.ownerName || "未登记" },
        { label: "外部司机", value: item.driverName || "未登记" },
        { label: "货厢尺寸", value: `${item.boxLengthMeters} × ${item.boxWidthMeters} × ${item.boxHeightMeters} m` },
        { label: "理论方量", value: `${item.theoreticalVolumeCubicMeters} m³` },
        { label: "核定油箱容量", value: item.fuelTankCapacityLiters ? `${displayMoney(item.fuelTankCapacityLiters)} L` : "未维护（柴油超量检测将跳过该车辆）" },
        { label: "累计维修保养", value: `¥${displayMoney(vehicleMaintenanceAmountById.get(item.id) ?? 0)}` },
        { label: "调度状态", value: <Badge className={vehicleStatusClass[item.status]}>{vehicleStatusLabel[item.status]}</Badge> },
      ],
    });
    return (
      <div className="space-y-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-sm font-medium text-[#203c48]">资源与运输治理</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">车辆统一台账</h1><p className="mt-2 text-sm text-slate-500">与移动运输端使用同一车辆数据源。超级管理员可维护归属、司机、货厢参数和启停状态；已存在未结算趟次的车辆不能直接停用。</p></div><Button variant="outline" onClick={() => void vehicles.refetch()}><Truck className="mr-2 h-4 w-4" />刷新车辆</Button></div>
        <section className="grid gap-3 sm:grid-cols-4"><MetricCard title="车辆总数" value={rows.length} description="运输车辆唯一台账" icon={Truck} /><MetricCard title="可调度" value={rows.filter(item => item.status === "active").length} description="可用于新建运输趟次" icon={ShieldCheck} /><MetricCard title="暂停或停用" value={rows.filter(item => item.status !== "active").length} description="需先处理未结算趟次" icon={ScrollText} /><MetricCard title="车辆维修保养费" value={`¥${displayMoney(assetMaintenanceSummary.data?.vehicleMaintenanceAmount ? Number(assetMaintenanceSummary.data.vehicleMaintenanceAmount) + Number(assetMaintenanceSummary.data.vehicleRepairAmount) : 0)}`} description="不含外租租金与运输运费" icon={BarChart3} /></section>
        {settlementProjectId ? <TransportVehicleSettlementManager projectId={settlementProjectId} vehicles={rows.filter(item => item.projectId === settlementProjectId)} /> : <Card className="border-[#d8e3e0] bg-[#f8fcfb]"><CardContent className="p-4"><p className="font-semibold text-[#203c48]">渣土车费用结算</p><p className="mt-1 text-sm text-slate-500">请先在下方“车辆资源列表”的项目筛选中选择一个项目，即可按车牌查看每日趟数、总运费、柴油扣款、净应付、微信日结通知及付款台账。</p></CardContent></Card>}
        <div className="flex flex-col gap-6">
          <Card className="order-2 w-full border-[#d8e3e0] shadow-sm">
            <CardHeader><div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">车辆资源 · 全宽台账</p><CardTitle className="mt-1 text-base">车辆资源列表</CardTitle><CardDescription className="mt-1">每行汇总单车运输、柴油、维修、租赁与净收益；详情查看按日、按月分析。期间为 {vehicleAnalysisPeriod}。</CardDescription></div><div className="flex w-full flex-wrap gap-2 sm:w-auto"><Button className="min-h-11 flex-1 text-sm sm:min-h-8 sm:flex-none" size="sm" variant="outline" disabled={!filteredRows.length} onClick={() => downloadCsvFile(`车辆台账-${vehicleAnalysisPeriod}.csv`, ["车牌", "项目", "车辆类型", "资源性质", "调度状态", "出租方/所属人", "司机", "运输趟次", "运输毛收入", "柴油升数", "柴油金额", "柴油占比", "维修保养", "租赁估算", "净收益"], filteredRows.map(item => { const summary = vehicleSummaryById.get(item.id); return [item.plateNo, projects.data?.find(project => project.id === item.projectId)?.name ?? item.projectId, vehicleTypeLabel[item.vehicleType], item.ownership === "owned" ? "公司自有" : "外租", vehicleStatusLabel[item.status], item.ownerName, item.driverUserId ? userNameById.get(item.driverUserId) : "", summary?.tripCount ?? 0, summary?.grossIncome ?? 0, summary?.fuelLiters ?? 0, summary?.fuelAmount ?? 0, summary?.fuelCostRatio ?? "", (summary?.repairAmount ?? 0) + (summary?.maintenanceAmount ?? 0), summary?.leaseEstimatedAmount ?? 0, summary?.netIncome ?? 0]; }))}>导出详细 CSV</Button><Button className="min-h-11 flex-1 text-sm sm:min-h-8 sm:flex-none" size="sm" variant="outline" disabled={!selectedVehicleRows.length} onClick={() => batchRemoveVehicles(selectedVehicleRows.map(item => ({ id: item.id, cells: [] })))}>批量受控删除（{selectedVehicleRows.length}）</Button><Button className="min-h-11 flex-1 bg-[#203c48] text-sm text-white hover:bg-[#17313b] sm:min-h-8 sm:flex-none" size="sm" onClick={() => { setVehicleForm(EMPTY_VEHICLE_FORM); setVehicleEditorOpen(true); }}><Truck className="mr-2 h-4 w-4" />新增车辆档案</Button></div></div></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5"><Input className="min-h-11" value={vehicleLedgerFilter.search} onChange={event => setVehicleLedgerFilter(current => ({ ...current, search: event.target.value }))} placeholder="车牌或所属人" /><Select value={vehicleLedgerFilter.projectId} onValueChange={value => setVehicleLedgerFilter(current => ({ ...current, projectId: value }))}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部项目</SelectItem>{projects.data?.map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select><Select value={vehicleLedgerFilter.ownership} onValueChange={value => setVehicleLedgerFilter(current => ({ ...current, ownership: value }))}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部资源性质</SelectItem><SelectItem value="owned">公司自有</SelectItem><SelectItem value="leased">外租车辆</SelectItem><SelectItem value="trip_settlement">渣土车（按趟结算）</SelectItem></SelectContent></Select><Select value={vehicleLedgerFilter.status} onValueChange={value => setVehicleLedgerFilter(current => ({ ...current, status: value }))}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部调度状态</SelectItem><SelectItem value="active">可调度</SelectItem><SelectItem value="suspended">暂停</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select><Input className="min-h-11" type="month" aria-label="车辆分析期间" value={vehicleAnalysisPeriod} onChange={event => setVehicleAnalysisPeriod(event.target.value)} /></div>
              <div className="overflow-x-auto rounded-xl border border-[#e1e8e4]"><Table className="min-w-[1460px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow className="border-[#dce3de] hover:bg-[#edf1ed]"><TableHead className="h-11 w-11 px-3"><input aria-label="全选当前筛选车辆" type="checkbox" checked={Boolean(filteredRows.length) && selectedVehicleRows.length === filteredRows.length} onChange={event => toggleAllVisibleVehicles(event.target.checked)} /></TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">车牌 / 类型</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">归属项目</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">资源性质</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">所属人 / 出租方</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">绑定司机</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">货厢 / 方量</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">调度状态</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">维修保养</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">加油升数 / 金额</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">本月收益 / 净收益</TableHead><TableHead className="h-11 px-4 text-right font-semibold text-[#46615a]">操作</TableHead></TableRow></TableHeader><TableBody>{filteredRows.length ? filteredRows.map(item => { const summary = vehicleSummaryById.get(item.id); return <TableRow className="border-[#edf0ee] hover:bg-[#fbfaf1]" key={item.id}><TableCell className="w-11 px-3"><input aria-label={`选择车辆 ${item.plateNo}`} type="checkbox" checked={selectedVehicleIds.includes(item.id)} onChange={event => toggleVehicleSelection(item.id, event.target.checked)} /></TableCell><TableCell className="px-4 py-3"><p className="font-semibold text-[#203c48]">{item.plateNo}</p><p className="mt-1 text-slate-500">{vehicleTypeLabel[item.vehicleType]}</p></TableCell><TableCell className="px-4 py-3 text-slate-700">{projects.data?.find(project => project.id === item.projectId)?.name ?? `#${item.projectId}`}</TableCell><TableCell className="px-4 py-3"><Badge variant="outline">{item.ownership === "owned" ? "公司自有" : item.ownership === "leased" ? "外租车辆" : "渣土车（按趟结算）"}</Badge></TableCell><TableCell className="px-4 py-3 text-slate-700">{item.ownerName || "未登记"}</TableCell><TableCell className="px-4 py-3 text-slate-700">{item.driverName || (item.driverUserId ? userNameById.get(item.driverUserId) ?? `#${item.driverUserId}` : "未登记")}</TableCell><TableCell className="px-4 py-3 text-slate-700"><p>{item.boxLengthMeters} × {item.boxWidthMeters} × {item.boxHeightMeters} m</p><p className="mt-1 text-slate-500">理论 {item.theoreticalVolumeCubicMeters} m³</p></TableCell><TableCell className="px-4 py-3"><Badge className={vehicleStatusClass[item.status]}>{vehicleStatusLabel[item.status]}</Badge></TableCell><TableCell className="px-4 py-3 text-slate-700">¥{displayMoney(vehicleMaintenanceAmountById.get(item.id) ?? 0)}</TableCell><TableCell className="px-4 py-3 text-slate-700"><p>{displayMoney(summary?.fuelLiters ?? 0)} L</p><p className="mt-1 text-slate-500">¥{displayMoney(summary?.fuelAmount ?? 0)}</p></TableCell><TableCell className="px-4 py-3 text-slate-700"><p>¥{displayMoney(summary?.grossIncome ?? 0)} / ¥{displayMoney(summary?.netIncome ?? 0)}</p><p className="mt-1 text-slate-500">油费 {summary?.fuelCostRatio === null || summary?.fuelCostRatio === undefined ? "—" : `${displayMoney(summary.fuelCostRatio)}%`}</p></TableCell><TableCell className="px-4 py-3 text-right"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => { setVehicleAnalysisTarget({ vehicleId: item.id, projectId: item.projectId, plateNo: item.plateNo }); showVehicleDetail(item); }}>详情</Button><Button size="sm" variant="outline" onClick={() => openVehicle(item)}>编辑</Button><Button size="sm" variant="destructive" onClick={() => requestRemoveVehicle(item)}>删除</Button></div></TableCell></TableRow>; }) : <TableRow><TableCell className="px-4 py-8 text-center text-slate-500" colSpan={12}>{rows.length ? "当前筛选条件下没有车辆。" : "尚无真实车辆台账。请使用上方“新增车辆档案”录入已授权项目的真实车辆资料。"}</TableCell></TableRow>}</TableBody></Table></div>
              <p className="text-xs text-slate-500">手机端可左右滑动查看完整字段；详情、编辑、删除和状态变更仍由服务端逐条校验项目范围、关联趟次与审计要求。</p>
            </CardContent>
          </Card>
          {vehicleEditorOpen ? <Card className="order-1 w-full border-[#d8e3e0] shadow-sm">
            <CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0"><div><p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">车辆资源 · 档案维护</p><CardTitle className="mt-1 text-base">{vehicleForm.id ? "维护车辆档案" : "新增车辆档案"}</CardTitle><CardDescription className="mt-1">车牌全局唯一，理论方量由服务端计算；车辆、司机、项目、调度状态与 RFID 卡均在 PC 后台关联维护。</CardDescription></div><div className="flex flex-wrap gap-2">{vehicleForm.id ? <><Button size="sm" variant="outline" onClick={() => { setBusinessWorkspaceProjectId(vehicleForm.projectId); setLocation("/admin/transport"); }}>运输调度</Button><Button size="sm" variant="outline" onClick={() => { setBusinessWorkspaceProjectId(vehicleForm.projectId); setLocation("/admin/transport"); }}>RFID 写卡</Button></> : null}<Button size="sm" variant="ghost" onClick={() => { setVehicleEditorOpen(false); setVehicleForm(EMPTY_VEHICLE_FORM); }}>收起</Button></div></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3"><div><Label>车牌号</Label><Input value={vehicleForm.plateNo} placeholder="例如 粤A12345" onChange={event => setVehicleForm({ ...vehicleForm, plateNo: event.target.value.toUpperCase() })} /></div><div><Label>车辆类型</Label><Select value={vehicleForm.vehicleType} onValueChange={(value: VehicleType) => setVehicleForm({ ...vehicleForm, vehicleType: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="dump_truck">渣土车</SelectItem><SelectItem value="tractor">牵引车</SelectItem><SelectItem value="mixer">搅拌车</SelectItem><SelectItem value="flatbed">平板车</SelectItem><SelectItem value="pickup">皮卡车</SelectItem><SelectItem value="suv">越野车</SelectItem><SelectItem value="other">其他</SelectItem></SelectContent></Select></div></div>
              <div><Label>归属项目</Label><Select value={vehicleForm.projectId || "UNASSIGNED"} onValueChange={value => setVehicleForm({ ...vehicleForm, projectId: value === "UNASSIGNED" ? "" : value })}><SelectTrigger><SelectValue placeholder="选择有效项目" /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">请选择项目</SelectItem>{projects.data?.filter(project => project.status !== "archived").map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>所属单位</Label><Select value={vehicleForm.organizationId || "UNASSIGNED"} onValueChange={value => setVehicleForm({ ...vehicleForm, organizationId: value === "UNASSIGNED" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">暂不设置</SelectItem>{organizations.data?.filter(item => item.status === "active").map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><div><Label>资源性质</Label><Select value={vehicleForm.ownership} onValueChange={value => setVehicleForm({ ...vehicleForm, ownership: value as VehicleForm["ownership"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="owned">公司自有</SelectItem><SelectItem value="leased">外租车辆</SelectItem><SelectItem value="trip_settlement">渣土车（按趟结算）</SelectItem></SelectContent></Select></div><div><Label>{vehicleForm.ownership === "leased" ? "出租方" : vehicleForm.ownership === "trip_settlement" ? "车主/车队" : "产权/所属人"}</Label><Input value={vehicleForm.ownerName} placeholder={vehicleForm.ownership === "leased" ? "外租必填" : vehicleForm.ownership === "trip_settlement" ? "可选，用于车队对账" : "可选"} onChange={event => setVehicleForm({ ...vehicleForm, ownerName: event.target.value })} /></div><div><Label>司机姓名</Label><Input value={vehicleForm.driverName} placeholder="直接录入外部司机姓名" onChange={event => setVehicleForm({ ...vehicleForm, driverName: event.target.value, driverUserId: "" })} /></div><div><Label>司机手机号</Label><Input inputMode="tel" maxLength={32} value={vehicleForm.driverPhone} placeholder="直接录入，服务端加密保存" onChange={event => setVehicleForm({ ...vehicleForm, driverPhone: event.target.value, driverUserId: "" })} /></div><div><Label>核定油箱容量（L）</Label><Input type="number" min="0.01" step="0.01" value={vehicleForm.fuelTankCapacityLiters} placeholder="用于柴油合理性检测" onChange={event => setVehicleForm({ ...vehicleForm, fuelTankCapacityLiters: event.target.value })} /></div></div>
              <div className="grid grid-cols-3 gap-2"><div><Label>货厢长(m)</Label><Input type="number" min="0.001" step="0.001" value={vehicleForm.boxLengthMeters} onChange={event => setVehicleForm({ ...vehicleForm, boxLengthMeters: event.target.value })} /></div><div><Label>货厢宽(m)</Label><Input type="number" min="0.001" step="0.001" value={vehicleForm.boxWidthMeters} onChange={event => setVehicleForm({ ...vehicleForm, boxWidthMeters: event.target.value })} /></div><div><Label>货厢高(m)</Label><Input type="number" min="0.001" step="0.001" value={vehicleForm.boxHeightMeters} onChange={event => setVehicleForm({ ...vehicleForm, boxHeightMeters: event.target.value })} /></div></div>
              <div className="grid grid-cols-3 gap-2"><div><Label>装载系数</Label><Input type="number" min="0.001" max="1.5" step="0.001" value={vehicleForm.loadFactor} onChange={event => setVehicleForm({ ...vehicleForm, loadFactor: event.target.value })} /></div><div><Label>核定载重(t)</Label><Input type="number" min="0.001" step="0.001" value={vehicleForm.payloadTons} placeholder="可选" onChange={event => setVehicleForm({ ...vehicleForm, payloadTons: event.target.value })} /></div><div><Label>调度状态</Label><Select value={vehicleForm.status} onValueChange={(value: VehicleStatus) => setVehicleForm({ ...vehicleForm, status: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">可调度</SelectItem><SelectItem value="suspended">暂停</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select></div></div>
              {vehicleForm.ownership === "leased" ? <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3"><div><p className="text-sm font-semibold text-amber-950">外租合同与租金</p><p className="mt-1 text-xs text-amber-800">租金和租期会同步到车辆租赁规则；自有车辆不录入该项。</p></div><div className="grid gap-3 sm:grid-cols-2"><div><Label>计费方式</Label><Select value={vehicleForm.leaseBillingType} onValueChange={value => setVehicleForm({ ...vehicleForm, leaseBillingType: value as LeaseBillingType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monthly">月租</SelectItem><SelectItem value="daily">日租</SelectItem><SelectItem value="hourly">小时租</SelectItem><SelectItem value="shift">台班</SelectItem></SelectContent></Select></div><div><Label>租金（元）</Label><Input type="number" min="0.01" step="0.01" value={vehicleForm.leaseRate} placeholder="外租必填" onChange={event => setVehicleForm({ ...vehicleForm, leaseRate: event.target.value })} /></div></div><div className="grid gap-3 sm:grid-cols-2"><div><Label>起租日期</Label><Input type="date" value={vehicleForm.leaseStartDate} onChange={event => setVehicleForm({ ...vehicleForm, leaseStartDate: event.target.value })} /></div><div><Label>截止日期</Label><Input type="date" min={vehicleForm.leaseStartDate || undefined} value={vehicleForm.leaseEndDate} onChange={event => setVehicleForm({ ...vehicleForm, leaseEndDate: event.target.value })} /></div></div></section> : null}
              <div className="grid gap-2 sm:grid-cols-2"><Button className="bg-[#203c48] hover:bg-[#17313b]" disabled={!vehicleForm.projectId || !vehicleForm.plateNo || !vehicleForm.boxLengthMeters || !vehicleForm.boxWidthMeters || !vehicleForm.boxHeightMeters || (vehicleForm.ownership === "leased" && (!vehicleForm.ownerName || !vehicleForm.leaseRate || !vehicleForm.leaseStartDate)) || saveVehicle.isPending} onClick={submitVehicle}>{vehicleForm.id ? "保存车辆变更" : "保存车辆档案"}</Button>{vehicleForm.id ? <Button variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => setMasterDataDeleteTarget({ resource: "vehicle", id: vehicleForm.id!, label: vehicleForm.plateNo, description: `确认删除车辆“${vehicleForm.plateNo}”？已有运输趟次的车辆不可删除，应改为停用以保留责任链。` })}>删除车辆</Button> : null}</div>
              {vehicleForm.id ? <section className="space-y-2 rounded-xl border border-slate-100 bg-slate-50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-slate-800">车辆维修保养费用</p><p className="text-xs text-slate-500">累计 ¥{displayMoney(vehicleMaintenanceAmountById.get(vehicleForm.id) ?? 0)}；作废记录不参与汇总。</p></div><Button size="sm" variant="outline" onClick={() => { setAssetMaintenanceForm({ ...EMPTY_ASSET_MAINTENANCE_FORM, assetType: "vehicle", assetId: String(vehicleForm.id), projectId: vehicleForm.projectId, occurredAt: new Date().toISOString() }); setAssetMaintenanceDialogOpen(true); }}>登记费用</Button></div>{vehicleMaintenanceRows.filter(item => item.assetId === vehicleForm.id).slice(0, 4).map(item => <div key={item.id} className="flex items-center justify-between gap-2 text-xs text-slate-600"><span>{item.costCategory === "maintenance" ? "保养" : "维修"} · {displayDate(item.occurredAt)}</span><span>¥{displayMoney(item.amount)} · {item.status === "void" ? "已作废" : item.status}</span></div>)}{!vehicleMaintenanceRows.some(item => item.assetId === vehicleForm.id) ? <p className="text-xs text-slate-500">暂无维修或保养费用记录。</p> : null}</section> : null}
            </CardContent>
          </Card> : null}
        </div>
      </div>
    );
  };

  const renderPermissions = () => (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,.78fr)_minmax(0,1.22fr)]">
      <section className="min-w-0 space-y-3">
        <div><p className="text-sm font-medium text-[#203c48]">人员与授权</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">人员、角色与数据范围</h1><p className="mt-2 text-sm text-slate-500">先维护账号与岗位，再以部门或具体项目配置数据范围；所有实际访问均由服务端按角色状态、有效期和范围实时裁决。</p></div>
        <Button className="min-h-10 w-full bg-[#203c48] text-white hover:bg-[#17313b] sm:w-auto" size="sm" onClick={() => { setEmployeeProfileForm(EMPTY_EMPLOYEE_PROFILE_FORM); setEmployeeProfileDialogOpen(true); }}>新建员工档案</Button>
        <div className="grid grid-cols-2 gap-2"><div className="rounded-xl border border-slate-100 bg-white p-3"><p className="text-xs text-slate-500">普通管理账号</p><p className="mt-1 text-2xl font-semibold text-slate-800">{localManagerUsers.length}</p></div><div className="rounded-xl border border-slate-100 bg-white p-3"><p className="text-xs text-slate-500">账号已启用</p><p className="mt-1 text-2xl font-semibold text-emerald-700">{localManagerUsers.filter(user => user.localAccountStatus === "active").length}</p></div><div className="rounded-xl border border-slate-100 bg-white p-3"><p className="text-xs text-slate-500">当前有效授权</p><p className="mt-1 text-2xl font-semibold text-[#203c48]">{activeAssignmentCount}</p></div><div className="rounded-xl border border-slate-100 bg-white p-3"><p className="text-xs text-slate-500">待关注绑定</p><p className="mt-1 text-2xl font-semibold text-amber-700">{localManagerUsers.filter(user => user.officialAccountBindingStatus !== "active").length}</p></div></div>
        <details className="rounded-xl border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">高级治理：岗位字典与自定义角色</summary>
          <p className="mt-1 text-xs leading-5 text-slate-500">日常授权请使用右侧的“人员—岗位模板—范围—有效期”流程；仅在维护自定义岗位时展开。</p>
          <div className="mt-3 space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">角色列表</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {roles.data?.map(role => <button key={role.id} className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${selectedRoleId === role.id ? "border-[#203c48] bg-[#edf4f1]" : "border-slate-100 hover:bg-slate-50"}`} onClick={() => { setSelectedRoleId(role.id); setRoleForm(role.isSystem ? EMPTY_ROLE_FORM : { id: role.id, code: role.code, name: role.name, category: role.category, description: role.description ?? "", status: role.status, isSystem: role.isSystem }); }}><p className="text-sm font-medium">{role.name}</p><p className="mt-0.5 text-xs text-slate-500">{role.code} · {role.category === "system" ? "系统角色" : "业务角色"} · {role.status === "active" ? "启用" : "停用"}</p></button>)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0"><CardTitle className="text-base">{roleForm.id ? "维护业务角色" : "新增业务角色"}</CardTitle>{roleForm.id ? <Button size="sm" variant="ghost" onClick={() => setRoleForm(EMPTY_ROLE_FORM)}>新建</Button> : null}</CardHeader>
          <CardContent className="space-y-3">
            <Input value={roleForm.code} placeholder="角色编码，例如 CONTRACT_MANAGER" onChange={event => setRoleForm({ ...roleForm, code: event.target.value.toUpperCase() })} />
            <Input value={roleForm.name} placeholder="角色名称" onChange={event => setRoleForm({ ...roleForm, name: event.target.value })} />
            <Input value={roleForm.description} placeholder="职责说明（可选）" onChange={event => setRoleForm({ ...roleForm, description: event.target.value })} />
            <Select value={roleForm.status} onValueChange={(value: OrganizationStatus) => setRoleForm({ ...roleForm, status: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">启用</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select>
            <div className="grid gap-2 sm:grid-cols-2"><Button variant="outline" disabled={!roleForm.code || !roleForm.name || saveRole.isPending} onClick={() => { const { isSystem, ...input } = roleForm; saveRole.mutate(input); }}>{roleForm.id ? "保存角色变更" : "保存角色"}</Button>{roleForm.id ? <Button variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => setMasterDataDeleteTarget({ resource: "role", id: roleForm.id!, label: roleForm.name, description: `确认删除自定义角色“${roleForm.name}”？系统内置角色和已有授权历史的角色不可删除，应改为停用并撤销现有授权。` })}>删除角色</Button> : null}</div>
          </CardContent>
        </Card>
          </div>
        </details>
        <Card className="border-[#d8e3e0] bg-[#f8fbfa]"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-[#203c48]">公司管理人员薪资标准</p><p className="mt-1 text-sm leading-6 text-slate-500">设置路径：权限管理 → 员工档案、薪资与保险 → 筛选“公司管理人员” → 编辑。可维护计薪口径、基础工资、所属项目、入职日期和备注；实际工资仍以考勤与经审核工资条为准，不会覆盖已审核或已付款工资。</p></div><Button className="shrink-0" variant="outline" onClick={() => setEmployeeLedgerFilter(current => ({ ...current, type: "management" }))}>进入公司人员薪资设置</Button></CardContent></Card>
        <Card className="border-[#d8e3e0] shadow-sm">
          <CardHeader className="flex flex-col items-start gap-4 space-y-0 sm:flex-row sm:justify-between"><div className="min-w-0"><p className="text-xs font-medium tracking-wide text-[#467067]">人员主数据 · 人事与用工台账</p><CardTitle className="mt-1 text-base">员工档案、薪资与保险</CardTitle><CardDescription className="mt-1">统一管理公司管理人员、机械操作员与施工队工人。基础工资仅供台账与费用预算参考，实际工资仍以考勤和审核工资条为准。</CardDescription></div><div className="w-full sm:w-auto"><Button className="min-h-11 w-full text-sm sm:min-h-8 sm:w-auto" size="sm" variant="outline" disabled={!filteredEmployeeProfiles.length} onClick={() => downloadCsvFile(`员工台账-${toLocalDateInput()}.csv`, ["姓名", "人员类型", "归属队伍", "状态", "入职日期", "计薪口径", "基础工资", "保险状态", "最近到期日"], filteredEmployeeProfiles.map(profile => [profile.displayName, profile.employeeType === "management" ? "公司管理人员" : profile.employeeType === "operator" ? "机械操作员" : "施工队工人", profile.teamName || profile.laborTeamName || "", profile.employmentStatus === "active" ? "在职" : profile.employmentStatus === "suspended" ? "停用" : "已离职", profile.joinedAt ? toLocalDateInput(new Date(profile.joinedAt)) : "", profile.salaryBasis === "monthly" ? "月薪" : profile.salaryBasis === "daily" ? "日薪" : profile.salaryBasis === "hourly" ? "时薪" : "计件", profile.baseSalary, profile.insuranceStatus === "active" ? "有效" : profile.insuranceStatus === "expiring" ? "30天内到期" : profile.insuranceStatus === "expired" ? "已到期" : "未登记", profile.policies[0]?.expiresAt ? toLocalDateInput(new Date(profile.policies[0].expiresAt)) : ""]))}>导出 CSV</Button></div></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4"><Input className="min-h-11" value={employeeLedgerFilter.search} onChange={event => setEmployeeLedgerFilter(current => ({ ...current, search: event.target.value }))} placeholder="姓名、队伍或账号" /><Select value={employeeLedgerFilter.type} onValueChange={value => setEmployeeLedgerFilter(current => ({ ...current, type: value }))}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部人员类型</SelectItem><SelectItem value="management">公司管理人员</SelectItem><SelectItem value="operator">机械操作员</SelectItem><SelectItem value="construction_worker">施工队工人</SelectItem></SelectContent></Select><Select value={employeeLedgerFilter.status} onValueChange={value => setEmployeeLedgerFilter(current => ({ ...current, status: value }))}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部在职状态</SelectItem><SelectItem value="active">在职</SelectItem><SelectItem value="suspended">停用</SelectItem><SelectItem value="left">已离职</SelectItem></SelectContent></Select><Select value={employeeLedgerFilter.insurance} onValueChange={value => setEmployeeLedgerFilter(current => ({ ...current, insurance: value }))}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部保险状态</SelectItem><SelectItem value="active">保险有效</SelectItem><SelectItem value="expiring">30 天内到期</SelectItem><SelectItem value="expired">保险已到期</SelectItem><SelectItem value="missing">未登记保险</SelectItem></SelectContent></Select></div>
            {employeeProfiles.isLoading ? <EmptyState text="正在读取员工、保险与薪资台账…" /> : <div className="overflow-x-auto rounded-xl border border-[#e1e8e4]"><Table className="min-w-[1280px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow className="border-[#dce3de] hover:bg-[#edf1ed]"><TableHead className="h-11 px-4 font-semibold text-[#46615a]">姓名</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">人员类型</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">归属队伍</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">入职日期</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">计薪口径 / 基础工资</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">保险</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">在职状态</TableHead><TableHead className="h-11 px-4 text-right font-semibold text-[#46615a]">操作</TableHead></TableRow></TableHeader><TableBody>{filteredEmployeeProfiles.length ? filteredEmployeeProfiles.map(profile => { const insuranceLabel = profile.insuranceStatus === "active" ? "保险有效" : profile.insuranceStatus === "expiring" ? "30天内到期" : profile.insuranceStatus === "expired" ? "保险已到期" : "未登记保险"; return <TableRow key={profile.id} className="border-[#edf0ee] hover:bg-[#fbfaf1]"><TableCell className="px-4 py-3 font-semibold text-[#203c48]">{profile.displayName}</TableCell><TableCell className="px-4 py-3 text-slate-700">{profile.employeeType === "management" ? "公司管理人员" : profile.employeeType === "operator" ? "机械操作员" : "施工队工人"}</TableCell><TableCell className="px-4 py-3 text-slate-700">{profile.teamName || profile.laborTeamName || "未分配"}</TableCell><TableCell className="px-4 py-3 text-slate-700">{profile.joinedAt ? toLocalDateInput(new Date(profile.joinedAt)) : "未登记"}</TableCell><TableCell className="px-4 py-3 text-slate-700"><p>{profile.salaryBasis === "monthly" ? "月薪" : profile.salaryBasis === "daily" ? "日薪" : profile.salaryBasis === "hourly" ? "时薪" : "计件"}</p><p className="mt-1 text-slate-500">¥{displayMoney(profile.baseSalary)}</p></TableCell><TableCell className="px-4 py-3"><p className="text-slate-700">{insuranceLabel}</p><p className="mt-1 text-slate-500">{profile.policies[0]?.expiresAt ? `到期 ${toLocalDateInput(new Date(profile.policies[0].expiresAt))}` : "—"}</p></TableCell><TableCell className="px-4 py-3"><BusinessStatusBadge status={profile.employmentStatus === "active" ? "active" : profile.employmentStatus === "suspended" ? "suspended" : "archived"} /></TableCell><TableCell className="px-4 py-3 text-right"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => { setEmployeeProfileForm({ id: profile.id, userId: profile.userId ? String(profile.userId) : "", laborWorkerId: profile.laborWorkerId ? String(profile.laborWorkerId) : "", projectId: profile.projectId ? String(profile.projectId) : "", employeeType: profile.employeeType, teamName: profile.teamName ?? "", employmentStatus: profile.employmentStatus, joinedAt: profile.joinedAt ? toLocalDateInput(new Date(profile.joinedAt)) : "", leftAt: profile.leftAt ? toLocalDateInput(new Date(profile.leftAt)) : "", salaryBasis: profile.salaryBasis, baseSalary: profile.baseSalary ? String(profile.baseSalary) : "", remarks: profile.remarks ?? "" }); setEmployeeProfileDialogOpen(true); }}>编辑</Button><Button size="sm" variant="outline" onClick={() => { setEmployeeInsuranceForm({ ...EMPTY_EMPLOYEE_INSURANCE_FORM, employeeProfileId: String(profile.id) }); setEmployeeInsuranceDialogOpen(true); }}>保险</Button><Button size="sm" variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => batchSuspendEmployees([{ id: profile.id, cells: [] }])}>停用</Button></div></TableCell></TableRow>; }) : <TableRow><TableCell colSpan={8} className="px-4 py-10 text-center text-slate-500">暂无匹配员工档案。请分别建立管理人员、机械操作员或施工队工人的档案。</TableCell></TableRow>}</TableBody></Table></div>}
          </CardContent>
        </Card>
        <Dialog open={employeeProfileDialogOpen} onOpenChange={open => { setEmployeeProfileDialogOpen(open); if (!open) setEmployeeProfileForm(EMPTY_EMPLOYEE_PROFILE_FORM); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{employeeProfileForm.id ? "编辑员工档案" : "新建员工档案"}</DialogTitle><DialogDescription>员工档案只能关联一名公司账号或一条施工队劳务档案；实际工资结算仍使用考勤与工资条流程。</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={event => { event.preventDefault(); saveEmployeeProfile.mutate({ id: employeeProfileForm.id, userId: employeeProfileForm.employeeType === "construction_worker" ? null : Number(employeeProfileForm.userId || 0) || null, laborWorkerId: employeeProfileForm.employeeType === "construction_worker" ? Number(employeeProfileForm.laborWorkerId || 0) || null : null, projectId: Number(employeeProfileForm.projectId || 0) || null, employeeType: employeeProfileForm.employeeType, teamName: employeeProfileForm.teamName || null, employmentStatus: employeeProfileForm.employmentStatus, joinedAt: employeeProfileForm.joinedAt || null, leftAt: employeeProfileForm.leftAt || null, salaryBasis: employeeProfileForm.salaryBasis, baseSalary: employeeProfileForm.baseSalary ? Number(employeeProfileForm.baseSalary) : null, remarks: employeeProfileForm.remarks || null }); }}><div className="grid gap-3 sm:grid-cols-2"><Field label="人员类型"><Select value={employeeProfileForm.employeeType} onValueChange={value => setEmployeeProfileForm(current => ({ ...current, employeeType: value as EmployeeType, userId: value === "construction_worker" ? "" : current.userId, laborWorkerId: value === "construction_worker" ? current.laborWorkerId : "" }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="management">公司管理人员</SelectItem><SelectItem value="operator">机械操作员</SelectItem><SelectItem value="construction_worker">施工队工人</SelectItem></SelectContent></Select></Field>{employeeProfileForm.employeeType === "construction_worker" ? <Field label="关联施工队工人"><Select value={employeeProfileForm.laborWorkerId || "UNASSIGNED"} onValueChange={value => { const worker = employeeOptions.data?.laborWorkers.find(item => String(item.id) === value); setEmployeeProfileForm(current => ({ ...current, laborWorkerId: value === "UNASSIGNED" ? "" : value, projectId: worker ? String(worker.projectId) : current.projectId, teamName: worker?.teamName ?? current.teamName })); }}><SelectTrigger><SelectValue placeholder="选择劳务档案" /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">请选择</SelectItem>{employeeOptions.data?.laborWorkers.map(worker => <SelectItem key={worker.id} value={String(worker.id)}>{worker.realName}{worker.teamName ? ` · ${worker.teamName}` : ""}</SelectItem>)}</SelectContent></Select></Field> : <Field label="关联公司账号"><Select value={employeeProfileForm.userId || "UNASSIGNED"} onValueChange={value => setEmployeeProfileForm(current => ({ ...current, userId: value === "UNASSIGNED" ? "" : value }))}><SelectTrigger><SelectValue placeholder="选择账号" /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">请选择</SelectItem>{employeeOptions.data?.users.map(user => <SelectItem key={user.id} value={String(user.id)}>{user.name || `用户 #${user.id}`}</SelectItem>)}</SelectContent></Select></Field>}<Field label="归属项目"><Select value={employeeProfileForm.projectId || "UNASSIGNED"} onValueChange={value => setEmployeeProfileForm(current => ({ ...current, projectId: value === "UNASSIGNED" ? "" : value }))}><SelectTrigger><SelectValue placeholder="选择项目（可选）" /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">不设置项目</SelectItem>{projects.data?.map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select></Field><Field label="归属队伍"><Input value={employeeProfileForm.teamName} onChange={event => setEmployeeProfileForm(current => ({ ...current, teamName: event.target.value }))} placeholder="例如：路基施工一队" /></Field><Field label="入职日期"><Input type="date" value={employeeProfileForm.joinedAt} onChange={event => setEmployeeProfileForm(current => ({ ...current, joinedAt: event.target.value }))} /></Field><Field label="在职状态"><Select value={employeeProfileForm.employmentStatus} onValueChange={value => setEmployeeProfileForm(current => ({ ...current, employmentStatus: value as EmployeeProfileForm["employmentStatus"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">在职</SelectItem><SelectItem value="suspended">停用</SelectItem><SelectItem value="left">已离职</SelectItem></SelectContent></Select></Field><Field label="计薪口径"><Select value={employeeProfileForm.salaryBasis} onValueChange={value => setEmployeeProfileForm(current => ({ ...current, salaryBasis: value as EmployeeProfileForm["salaryBasis"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monthly">月薪</SelectItem><SelectItem value="daily">日薪</SelectItem><SelectItem value="hourly">时薪</SelectItem><SelectItem value="piecework">计件</SelectItem></SelectContent></Select></Field><Field label="基础工资 / 单价"><Input inputMode="decimal" value={employeeProfileForm.baseSalary} onChange={event => setEmployeeProfileForm(current => ({ ...current, baseSalary: event.target.value }))} placeholder="仅作台账与预算参考" /></Field><Field label="离职日期"><Input type="date" value={employeeProfileForm.leftAt} onChange={event => setEmployeeProfileForm(current => ({ ...current, leftAt: event.target.value }))} /></Field></div><Field label="备注"><Textarea value={employeeProfileForm.remarks} onChange={event => setEmployeeProfileForm(current => ({ ...current, remarks: event.target.value }))} placeholder="岗位说明、交接或其他不含敏感证件原文的说明" /></Field><DialogFooter><Button type="button" variant="outline" onClick={() => setEmployeeProfileDialogOpen(false)}>取消</Button><Button type="submit" disabled={saveEmployeeProfile.isPending || (employeeProfileForm.employeeType === "construction_worker" ? !employeeProfileForm.laborWorkerId : !employeeProfileForm.userId)}>{saveEmployeeProfile.isPending ? "正在保存…" : "保存员工档案"}</Button></DialogFooter></form></DialogContent></Dialog>
        <Dialog open={employeeInsuranceDialogOpen} onOpenChange={open => { setEmployeeInsuranceDialogOpen(open); if (!open) setEmployeeInsuranceForm(EMPTY_EMPLOYEE_INSURANCE_FORM); }}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>登记员工保险</DialogTitle><DialogDescription>到期提醒在后台加载时实时计算；请填写真实购买日与到期日。</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={event => { event.preventDefault(); saveEmployeeInsurance.mutate({ id: employeeInsuranceForm.id, employeeProfileId: Number(employeeInsuranceForm.employeeProfileId), insuranceType: employeeInsuranceForm.insuranceType, providerName: employeeInsuranceForm.providerName || null, policyReference: employeeInsuranceForm.policyReference || null, purchasedAt: employeeInsuranceForm.purchasedAt, expiresAt: employeeInsuranceForm.expiresAt, status: employeeInsuranceForm.status, remarks: employeeInsuranceForm.remarks || null }); }}><div className="grid gap-3 sm:grid-cols-2"><Field label="保险类型"><Select value={employeeInsuranceForm.insuranceType} onValueChange={value => setEmployeeInsuranceForm(current => ({ ...current, insuranceType: value as EmployeeInsuranceForm["insuranceType"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="work_injury">工伤保险</SelectItem><SelectItem value="accident">意外险</SelectItem><SelectItem value="medical">医疗保险</SelectItem><SelectItem value="employer_liability">雇主责任险</SelectItem><SelectItem value="other">其他</SelectItem></SelectContent></Select></Field><Field label="保险状态"><Select value={employeeInsuranceForm.status} onValueChange={value => setEmployeeInsuranceForm(current => ({ ...current, status: value as EmployeeInsuranceForm["status"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">有效</SelectItem><SelectItem value="expired">已到期</SelectItem><SelectItem value="cancelled">已取消</SelectItem></SelectContent></Select></Field><Field label="保险公司"><Input value={employeeInsuranceForm.providerName} onChange={event => setEmployeeInsuranceForm(current => ({ ...current, providerName: event.target.value }))} /></Field><Field label="保单编号 / 参考号"><Input value={employeeInsuranceForm.policyReference} onChange={event => setEmployeeInsuranceForm(current => ({ ...current, policyReference: event.target.value }))} /></Field><Field label="购买日期"><Input type="date" value={employeeInsuranceForm.purchasedAt} onChange={event => setEmployeeInsuranceForm(current => ({ ...current, purchasedAt: event.target.value }))} /></Field><Field label="到期日期"><Input type="date" value={employeeInsuranceForm.expiresAt} onChange={event => setEmployeeInsuranceForm(current => ({ ...current, expiresAt: event.target.value }))} /></Field></div><Field label="备注"><Textarea value={employeeInsuranceForm.remarks} onChange={event => setEmployeeInsuranceForm(current => ({ ...current, remarks: event.target.value }))} /></Field><DialogFooter><Button type="button" variant="outline" onClick={() => setEmployeeInsuranceDialogOpen(false)}>取消</Button><Button type="submit" disabled={saveEmployeeInsurance.isPending || !employeeInsuranceForm.employeeProfileId || !employeeInsuranceForm.purchasedAt || !employeeInsuranceForm.expiresAt}>{saveEmployeeInsurance.isPending ? "正在保存…" : "保存保险台账"}</Button></DialogFooter></form></DialogContent></Dialog>
      </section>
      <section className="min-w-0 space-y-3">
        <details open className="rounded-xl border border-slate-200 bg-white p-2.5">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">角色详细操作权限与部门业务开关</summary>
          <p className="mt-1 text-xs leading-5 text-slate-500">岗位模板用于快速分配标准职责；请在此按业务模块设置角色可查看、新增、审核、结算、作废、导出或打印的具体操作。</p>
          <div className="mt-3 grid gap-2 md:grid-cols-3"><div className="rounded-lg border border-[#d8e3e0] bg-[#f8fbfa] p-3"><p className="text-xs font-semibold text-[#203c48]">第一级 · 菜单</p><p className="mt-1 text-xs leading-5 text-slate-500">部门业务范围与岗位模板决定可见业务菜单；前端只做导航投影，不能代替服务端拦截。</p></div><div className="rounded-lg border border-[#d8e3e0] bg-[#f8fbfa] p-3"><p className="text-xs font-semibold text-[#203c48]">第二级 · 页面</p><p className="mt-1 text-xs leading-5 text-slate-500">项目范围与账号有效期决定可查看的项目台账和页面数据；跨项目查询会被服务端拒绝。</p></div><div className="rounded-lg border border-[#d8e3e0] bg-[#f8fbfa] p-3"><p className="text-xs font-semibold text-[#203c48]">第三级 · 操作</p><p className="mt-1 text-xs leading-5 text-slate-500">本页勾选查看、新增、编辑、提交、审核、结算、作废、导出、打印；用户专属权限仅覆盖本模块操作，不扩大项目范围。</p></div></div>
          <div className="mt-2 space-y-3">
        <Card>
          <CardHeader><CardTitle className="text-base">角色详细操作权限</CardTitle><CardDescription>选择角色后，按业务模块勾选查看、新增、编辑、提交、审核、结算、作废、导出或打印等动作。角色一旦配置某业务域的详细权限，服务端将拒绝该域未勾选的直接接口调用；岗位、部门和项目范围仍同时校验。</CardDescription></CardHeader>
          <CardContent>
            {selectedRoleId === undefined ? <EmptyState text="正在加载可分配角色…" /> : (
              <div className="space-y-5">
                {permissionGroups.map(([module, items]) => (
                    <div key={module} className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><p className="text-sm font-semibold text-slate-800">{permissionModuleLabels[module] ?? module}</p><p className="mt-0.5 text-xs text-slate-500">已选择 {items.filter(item => draftPermissionIds.includes(item.id)).length} / {items.length} 项操作权限</p></div><div className="flex shrink-0 gap-1"><Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => setDraftPermissionIds(current => Array.from(new Set([...current, ...items.map(item => item.id)])))}>全选</Button><Button size="sm" variant="ghost" className="h-8 px-2 text-xs text-slate-600" onClick={() => setDraftPermissionIds(current => current.filter(id => !items.some(item => item.id === id)))}>清空</Button></div></div>
                    <div className="grid gap-1.5 sm:grid-cols-2 2xl:grid-cols-3">
                      {items.map(permission => (
                        <label key={permission.id} className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-white p-2 hover:border-[#9ab6ad] hover:bg-[#f7fbf8]">
                          <Checkbox checked={draftPermissionIds.includes(permission.id)} onCheckedChange={checked => setDraftPermissionIds(current => checked ? Array.from(new Set([...current, permission.id])) : current.filter(id => id !== permission.id))} />
                          <span><span className="block text-sm font-medium text-slate-700">{permission.name}</span><span className="mt-1 inline-flex rounded bg-[#edf4f1] px-1.5 py-0.5 text-[11px] font-medium text-[#355c52]">操作：{permissionActionLabels[permission.action] ?? permission.action}</span><span className="mt-1 block text-xs text-slate-400">{permission.code}</span></span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <Button className="bg-[#203c48] hover:bg-[#17313b]" disabled={savePermissions.isPending} onClick={() => selectedRoleId && savePermissions.mutate({ roleId: selectedRoleId, permissionIds: draftPermissionIds })}>保存当前角色权限</Button>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">部门可办理业务</CardTitle><CardDescription>先为部门或项目部启用业务模块，再向人员授予该部门角色。服务端会同时校验角色、部门模块和项目范围。</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <Select value={departmentScopeForm.organizationId} disabled={departmentScopePickerState.disabled} onValueChange={value => setDepartmentScopeForm({ ...departmentScopeForm, organizationId: value })}><SelectTrigger><SelectValue placeholder={departmentScopePickerState.placeholder} /></SelectTrigger><SelectContent>{departmentNodes.map(node => <SelectItem key={node.id} value={String(node.id)}>{node.name}</SelectItem>)}</SelectContent></Select>
              <Select value={departmentScopeForm.module} onValueChange={value => setDepartmentScopeForm({ ...departmentScopeForm, module: value as DepartmentModuleCode })}><SelectTrigger><SelectValue placeholder="选择业务模块" /></SelectTrigger><SelectContent>{departmentModules.data?.map(module => <SelectItem key={module.code} value={module.code}>{module.name}</SelectItem>)}</SelectContent></Select>
              <Button disabled={!departmentScopeForm.organizationId || !departmentScopeForm.module || saveDepartmentScope.isPending} onClick={() => { if (departmentScopeForm.module) saveDepartmentScope.mutate({ organizationId: Number(departmentScopeForm.organizationId), module: departmentScopeForm.module, status: "active" }); }}>启用业务</Button>
            </div>
            {departmentScopePickerState.needsOrganizationSetup ? <div className="flex flex-col gap-3 rounded-xl border border-dashed border-amber-200 bg-amber-50/70 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium text-amber-950">尚无可选择的部门或项目部</p><p className="mt-1 text-xs leading-5 text-amber-800">请先在“组织与项目”中新增类型为“部门”或“项目部”的启用节点；保存后返回本页即可选择并启用业务模块。</p></div><Button variant="outline" className="shrink-0 border-amber-300 bg-white text-amber-950 hover:bg-amber-100" onClick={() => setLocation("/admin/organization")}>建立组织节点</Button></div> : null}
            {departmentScopes.data?.length ? <div className="space-y-2">{departmentScopes.data.map(scope => {
              const module = departmentModules.data?.find(item => item.code === scope.module);
              return <div key={scope.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5"><div><p className="text-sm font-medium text-slate-800">{scope.organizationName} · {module?.name ?? scope.module}</p><p className="mt-0.5 text-xs text-slate-500">{module?.description ?? "部门业务模块"} · 最后更新：{displayDate(scope.updatedAt)}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={saveDepartmentScope.isPending} onClick={() => saveDepartmentScope.mutate({ organizationId: scope.organizationId, module: scope.module, status: scope.status === "active" ? "disabled" : "active" })}>{scope.status === "active" ? "停用" : "启用"}</Button><Button size="sm" variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => setMasterDataDeleteTarget({ resource: "department_scope", id: scope.id, label: `${scope.organizationName} · ${module?.name ?? scope.module}`, description: `确认删除“${scope.organizationName}”的“${module?.name ?? scope.module}”业务范围？删除后该部门不再拥有该模块入口，可重新启用创建。` })}>删除</Button></div></div>;
            })}</div> : <EmptyState text="尚未配置部门可办理业务。请先建立部门节点，再按实际职责启用业务模块。" />}
          </CardContent>
        </Card>
          </div>
        </details>
        <Card>
          <CardHeader><CardTitle className="text-base">普通管理人员账号</CardTitle><CardDescription>使用中国大陆手机号创建、编辑、重置密码、启停和删除本地登录账号。口令只会生成不可逆摘要；删除会撤销角色授权，且存在业务责任、资源归属或历史单据的账号必须先完成交接。</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="grid gap-1.5"><Label htmlFor="local-account-username">登录手机号</Label><Input id="local-account-username" type="tel" inputMode="numeric" autoComplete="tel" value={localAccountForm.username} onChange={event => setLocalAccountForm({ ...localAccountForm, username: event.target.value })} placeholder="例如：13800138000" /><p className="text-xs text-slate-500">仅支持中国大陆 11 位手机号，可输入 +86、空格或短横线。</p></div>
              <div className="grid gap-1.5"><Label htmlFor="local-account-name">显示姓名</Label><Input id="local-account-name" value={localAccountForm.displayName} onChange={event => setLocalAccountForm({ ...localAccountForm, displayName: event.target.value })} placeholder="例如：张三" /></div>
              <div className="grid gap-1.5"><Label htmlFor="local-account-password">初始密码</Label><Input id="local-account-password" type="password" autoComplete="new-password" value={localAccountForm.initialPassword} onChange={event => setLocalAccountForm({ ...localAccountForm, initialPassword: event.target.value })} placeholder="至少 6 位，任意数字或字符" /></div>
              <div className="grid gap-1.5"><Label>初始状态</Label><Select value={localAccountForm.status} onValueChange={value => setLocalAccountForm({ ...localAccountForm, status: value as "active" | "disabled" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">启用</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select></div>
              <div className="grid gap-1.5"><Label>登录方式</Label><Select value={localAccountForm.loginMode} onValueChange={value => setLocalAccountForm({ ...localAccountForm, loginMode: value as LocalLoginMode })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pc">仅 PC 端</SelectItem><SelectItem value="mobile">仅手机端</SelectItem><SelectItem value="both">PC 端＋手机端</SelectItem></SelectContent></Select><p className="text-xs text-slate-500">服务端按实际请求终端限制，既有会话跨端复用也会被拒绝。</p></div>
              <div className="flex items-end"><Button className="w-full bg-[#203c48] hover:bg-[#17313b]" disabled={!localAccountForm.username || !localAccountForm.displayName || !localAccountForm.initialPassword || createLocalUser.isPending} onClick={() => createLocalUser.mutate(localAccountForm)}>{createLocalUser.isPending ? "正在创建…" : "创建普通管理人员"}</Button></div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2.5"><p className="text-xs text-slate-600">账号目录 · {localManagerUsers.length} 人</p><Input className="h-8 w-full sm:w-56" value={personnelSearch} onChange={event => setPersonnelSearch(event.target.value)} placeholder="搜索姓名或登录账号" /></div>
            {localManagerUsers.length ? <div className="space-y-2">{filteredLocalManagerUsers.map(user => {
              const accountTarget = { id: user.id, name: user.name || `用户 #${user.id}`, username: user.localUsername || "" };
              const bindingLabel = user.officialAccountBindingStatus === "active" ? "已绑定" : user.officialAccountBindingStatus === "unsubscribed" ? "已关注但通知暂停" : user.officialAccountBindingStatus === "revoked" || user.officialAccountBindingStatus === "disabled" ? "绑定已停用" : "待绑定";
              return <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2.5 shadow-sm"><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-slate-800">{accountTarget.name}</p><span className="font-mono text-xs text-slate-500">{user.localUsername}</span><Badge variant={user.localAccountStatus === "active" ? "secondary" : "outline"}>{user.localAccountStatus === "active" ? "已启用" : "已停用"}</Badge><Badge variant="outline">登录：{user.localLoginMode === "pc" ? "仅 PC" : user.localLoginMode === "mobile" ? "仅手机" : "双端"}</Badge><Badge variant="outline">公众号：{bindingLabel}</Badge></div><p className="mt-1 text-xs text-slate-500">密码已设置 · 最近登录：{displayDate(user.lastSignedIn)}</p></div><div className="flex flex-wrap items-center justify-end gap-2"><Button size="sm" className="bg-[#203c48] text-white hover:bg-[#17313b]" disabled={user.localAccountStatus !== "active"} onClick={() => { setDraftUserPermissionIds([]); setUserPermissionTarget(accountTarget); }}>操作权限</Button><Button size="sm" variant="outline" onClick={() => setLocalAccountEditForm({ userId: user.id, username: user.localUsername || "", displayName: accountTarget.name, status: user.localAccountStatus, loginMode: user.localLoginMode ?? "both" })}>编辑</Button><Button size="sm" variant="outline" onClick={() => { setPasswordResetTarget(accountTarget); setResetPassword(""); }}>重置密码</Button><Button size="sm" variant="outline" disabled={setLocalUserStatus.isPending} onClick={() => setLocalUserStatus.mutate({ userId: user.id, status: user.localAccountStatus === "active" ? "disabled" : "active" })}>{user.localAccountStatus === "active" ? "停用" : "启用"}</Button><Button size="sm" variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800" onClick={() => setDeleteTarget(accountTarget)}>删除</Button></div></div>;
            })}</div> : <EmptyState text={personnelSearch ? "未找到匹配的普通管理账号。" : "尚未创建普通管理人员本地账号。创建后请在下方继续配置其角色与数据范围。"} />}
          </CardContent>
        </Card>
        <Dialog open={Boolean(localAccountEditForm)} onOpenChange={open => { if (!open) setLocalAccountEditForm(null); }}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader><DialogTitle>编辑普通管理人员账号</DialogTitle><DialogDescription>可修改登录账号、显示姓名和启停状态；公众号关注绑定请由员工在移动端个人中心自主完成，角色及数据范围请在下方“管理人员角色授权”中单独维护。</DialogDescription></DialogHeader>
            {localAccountEditForm ? <form className="space-y-4" onSubmit={event => { event.preventDefault(); updateLocalUser.mutate(localAccountEditForm); }}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5"><Label htmlFor="edit-local-account-username">登录手机号</Label><Input id="edit-local-account-username" type="tel" inputMode="numeric" autoComplete="tel" value={localAccountEditForm.username} onChange={event => setLocalAccountEditForm({ ...localAccountEditForm, username: event.target.value })} /><p className="text-xs text-slate-500">仅支持中国大陆 11 位手机号，保存时会自动去除 +86、空格和短横线。</p></div>
                <div className="grid gap-1.5"><Label htmlFor="edit-local-account-name">显示姓名</Label><Input id="edit-local-account-name" value={localAccountEditForm.displayName} onChange={event => setLocalAccountEditForm({ ...localAccountEditForm, displayName: event.target.value })} /></div>
                <div className="grid gap-1.5"><Label>账号状态</Label><Select value={localAccountEditForm.status} onValueChange={value => setLocalAccountEditForm({ ...localAccountEditForm, status: value as LocalAccountStatus })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">启用</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select></div>
                <div className="grid gap-1.5"><Label>登录方式</Label><Select value={localAccountEditForm.loginMode} onValueChange={value => setLocalAccountEditForm({ ...localAccountEditForm, loginMode: value as LocalLoginMode })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pc">仅 PC 端</SelectItem><SelectItem value="mobile">仅手机端</SelectItem><SelectItem value="both">PC 端＋手机端</SelectItem></SelectContent></Select></div>
              </div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setLocalAccountEditForm(null)}>取消</Button><Button type="submit" className="bg-[#203c48] hover:bg-[#17313b]" disabled={!localAccountEditForm.username || !localAccountEditForm.displayName || updateLocalUser.isPending}>{updateLocalUser.isPending ? "正在保存…" : "保存修改"}</Button></DialogFooter>
            </form> : null}
          </DialogContent>
        </Dialog>
        <Dialog open={Boolean(passwordResetTarget)} onOpenChange={open => { if (!open) { setPasswordResetTarget(null); setResetPassword(""); } }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>重置普通管理人员密码</DialogTitle><DialogDescription>正在为“{passwordResetTarget?.name}”设置新密码。新密码至少 6 位，任意数字或字符均可；系统只保存不可逆摘要，设置后不会再次显示。</DialogDescription></DialogHeader>
            <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (passwordResetTarget) resetLocalUserPassword.mutate({ userId: passwordResetTarget.id, newPassword: resetPassword }); }}>
              <div className="grid gap-1.5"><Label htmlFor="reset-local-account-password">新密码</Label><Input id="reset-local-account-password" type="password" autoComplete="new-password" value={resetPassword} onChange={event => setResetPassword(event.target.value)} placeholder="至少 6 位，任意数字或字符" /></div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => { setPasswordResetTarget(null); setResetPassword(""); }}>取消</Button><Button type="submit" className="bg-[#203c48] hover:bg-[#17313b]" disabled={resetPassword.length < 6 || resetLocalUserPassword.isPending}>{resetLocalUserPassword.isPending ? "正在重置…" : "确认重置密码"}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog open={Boolean(userPermissionTarget)} onOpenChange={open => { if (!open) { setUserPermissionTarget(null); setDraftUserPermissionIds([]); } }}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader><DialogTitle>分配用户专属操作权限</DialogTitle><DialogDescription>正在为“{userPermissionTarget?.name}”设置具体业务动作。某业务模块配置专属权限后，会覆盖该用户在该模块的岗位角色权限；部门、项目范围、账号状态和业务状态机仍由服务端同时校验。</DialogDescription></DialogHeader>
            {userPermissionIds.isLoading ? <EmptyState text="正在读取该用户的专属权限…" /> : <div className="space-y-4">{permissionGroups.map(([module, items]) => <div key={module} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-slate-800">{permissionModuleLabels[module] ?? module}</p><p className="mt-0.5 text-xs text-slate-500">已选择 {items.filter(item => draftUserPermissionIds.includes(item.id)).length} / {items.length} 项；留空则沿用角色权限</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setDraftUserPermissionIds(current => Array.from(new Set([...current, ...items.map(item => item.id)])))}>全选本模块</Button><Button size="sm" variant="ghost" className="text-slate-600" onClick={() => setDraftUserPermissionIds(current => current.filter(id => !items.some(item => item.id === id)))}>清空</Button></div></div><div className="grid gap-2 md:grid-cols-2">{items.map(permission => <label key={permission.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-white p-3 hover:border-[#9ab6ad] hover:bg-[#f7fbf8]"><Checkbox checked={draftUserPermissionIds.includes(permission.id)} onCheckedChange={checked => setDraftUserPermissionIds(current => checked ? Array.from(new Set([...current, permission.id])) : current.filter(id => id !== permission.id))} /><span><span className="block text-sm font-medium text-slate-700">{permission.name}</span><span className="mt-1 inline-flex rounded bg-[#edf4f1] px-1.5 py-0.5 text-[11px] font-medium text-[#355c52]">操作：{permissionActionLabels[permission.action] ?? permission.action}</span></span></label>)}</div></div>)}</div>}
            <DialogFooter><Button type="button" variant="outline" onClick={() => { setUserPermissionTarget(null); setDraftUserPermissionIds([]); }}>取消</Button><Button className="bg-[#203c48] hover:bg-[#17313b]" disabled={!userPermissionTarget || setUserPermissions.isPending} onClick={() => userPermissionTarget && setUserPermissions.mutate({ userId: userPermissionTarget.id, permissionIds: draftUserPermissionIds })}>{setUserPermissions.isPending ? "正在保存…" : "保存该用户权限"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
        <AlertDialog open={Boolean(deleteTarget)} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>确认删除管理人员账号？</AlertDialogTitle><AlertDialogDescription>将删除“{deleteTarget?.name}（{deleteTarget?.username}）”的本地登录能力，并撤销其角色授权。系统会保留必要审计索引；如账号仍关联业务单据、资源责任或组织负责人信息，服务端会拒绝删除并提示需交接的事项。</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction className="bg-rose-600 text-white hover:bg-rose-700" disabled={deleteLocalUser.isPending} onClick={() => { if (deleteTarget) deleteLocalUser.mutate({ userId: deleteTarget.id }); }}>{deleteLocalUser.isPending ? "正在删除…" : "确认删除"}</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Card className="border-[#d8e3e0] shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0"><div><p className="text-xs font-medium tracking-wide text-[#467067]">简明授权流程</p><CardTitle className="mt-1 text-base">{assignmentForm.id ? "编辑管理人员授权" : "为人员分配岗位"}</CardTitle><CardDescription className="mt-1">按“1 人员 → 2 岗位模板 → 3 部门或项目 → 4 有效期”完成授权。系统会在每次访问时同时校验岗位、范围、有效期和业务状态。</CardDescription></div>{assignmentForm.id ? <Button size="sm" variant="outline" onClick={() => setAssignmentForm(EMPTY_ASSIGNMENT_FORM)}>取消编辑</Button> : null}</CardHeader>
          <CardContent className="space-y-4">
            <section className="rounded-xl border border-[#d8e3e0] bg-[#f7faf9] p-3">
              <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-sm font-semibold text-[#203c48]">第 2 步：选择行业岗位模板</p><p className="mt-1 text-xs text-slate-500">岗位模板只展示职责摘要；保存时仍写入系统角色并由服务端强制权限边界。</p></div>{selectedAssignmentTemplate ? <Badge variant="secondary">已选：{selectedAssignmentTemplate.name}</Badge> : null}</div>
              {roleTemplates.isLoading ? <p className="py-3 text-xs text-slate-500">正在加载标准岗位…</p> : <div className="mt-3 space-y-3">{groupedRoleTemplates.map(([group, templates]) => <div key={group}><p className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500">{group}</p><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{templates.map(template => <button type="button" key={template.code} disabled={!template.available || !template.roleId} className={`rounded-lg border p-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${Number(assignmentForm.roleId) === template.roleId ? "border-[#3e6a61] bg-white shadow-sm" : "border-[#dbe8e4] bg-white hover:border-[#7fa69d]"}`} onClick={() => setAssignmentForm(current => ({ ...current, roleId: String(template.roleId) }))}><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-slate-800">{template.name}</span><span className="text-[10px] text-slate-500">{template.available ? "可用" : "已停用"}</span></div><p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{template.summary}</p></button>)}</div></div>)}</div>}
            </section>
            {assignmentRequiresBusinessScope && !assignmentHasScope ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">请为业务角色至少选择一个所属部门/项目部或一个具体项目范围；未选择时不会提交授权。</div> : null}
            {!departmentNodes.length ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-900"><span>当前未配置可用部门或项目部。您仍可直接按具体项目授权；如需部门级范围，请先建立项目部并启用对应业务模块。</span><Button size="sm" variant="outline" onClick={() => setLocation("/admin/organization")}>配置组织与项目</Button></div> : null}
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="grid gap-1.5"><Label>管理人员</Label><Select value={assignmentForm.userId} onValueChange={value => setAssignmentForm({ ...assignmentForm, userId: value })}><SelectTrigger><SelectValue placeholder="选择用户" /></SelectTrigger><SelectContent>{users.data?.map(user => <SelectItem key={user.id} value={String(user.id)}>{user.name || `用户 #${user.id}`}{user.localUsername ? `（${user.localUsername}）` : ""}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label>岗位模板</Label><Select value={assignmentForm.roleId} onValueChange={value => setAssignmentForm({ ...assignmentForm, roleId: value })}><SelectTrigger><SelectValue placeholder="从上方卡片或此处选择岗位" /></SelectTrigger><SelectContent>{roles.data?.filter(role => role.status === "active" || String(role.id) === assignmentForm.roleId).filter(role => role.code !== "SUPER_ADMIN").map(role => <SelectItem key={role.id} value={String(role.id)}>{role.name}{role.status !== "active" ? "（已停用）" : ""}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label>所属部门 / 项目部</Label><Select value={assignmentForm.organizationId || "UNASSIGNED"} onValueChange={value => setAssignmentForm({ ...assignmentForm, organizationId: value === "UNASSIGNED" ? "" : value, projectId: value === "UNASSIGNED" ? assignmentForm.projectId : "" })}><SelectTrigger><SelectValue placeholder="选择所属部门" /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">不设置（可改用具体项目范围）</SelectItem>{departmentNodes.map(node => <SelectItem key={node.id} value={String(node.id)}>{node.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label>具体项目范围</Label><Select value={assignmentForm.projectId || "ALL"} onValueChange={value => setAssignmentForm({ ...assignmentForm, projectId: value === "ALL" ? "" : value, organizationId: value === "ALL" ? assignmentForm.organizationId : "" })}><SelectTrigger><SelectValue placeholder="项目范围（可选）" /></SelectTrigger><SelectContent><SelectItem value="ALL">不设置项目范围</SelectItem>{projects.data?.map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1.5"><Label htmlFor="assignment-valid-from">授权生效时间</Label><Input id="assignment-valid-from" type="datetime-local" value={assignmentForm.validFrom} onChange={event => setAssignmentForm({ ...assignmentForm, validFrom: event.target.value })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="assignment-valid-to">授权失效时间</Label><Input id="assignment-valid-to" type="datetime-local" value={assignmentForm.validTo} onChange={event => setAssignmentForm({ ...assignmentForm, validTo: event.target.value })} /></div>
            </div>
            {selectedAssignmentTemplate ? <div className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-950"><p className="font-semibold">{selectedAssignmentTemplate.name} · 职责摘要</p><p className="mt-1">可办理：{selectedAssignmentTemplate.allowedActions.join("、")}。</p><p className="mt-1 text-sky-800">职责分离：{selectedAssignmentTemplate.restrictedActions.join("、")}。</p></div> : null}
            <div className="rounded-lg border border-[#d8e3e0] bg-[#f7faf9] px-3 py-2 text-xs leading-5 text-slate-600">{normalizedAssignmentScope.projectId ? "当前为具体项目授权：保存后仅可访问该项目，角色对应业务模块将立即生效；不再依赖部门业务模块配置。" : normalizedAssignmentScope.organizationId ? "当前为部门范围授权：请先在“部门可办理业务”启用对应模块，才能显示业务入口。" : "请选择部门范围或具体项目范围后再授权。"}</div>
            <Button className="min-w-40 bg-[#203c48] hover:bg-[#17313b]" disabled={!assignmentReady || saveAssignment.isPending} onClick={() => saveAssignment.mutate({ id: assignmentForm.id, userId: Number(assignmentForm.userId), roleId: Number(assignmentForm.roleId), organizationId: normalizedAssignmentScope.organizationId, projectId: normalizedAssignmentScope.projectId, validFrom: assignmentForm.validFrom ? new Date(assignmentForm.validFrom).toISOString() : null, validTo: assignmentForm.validTo ? new Date(assignmentForm.validTo).toISOString() : null })}>{saveAssignment.isPending ? "正在保存…" : assignmentForm.id ? "保存授权修改" : "授予角色"}</Button>
          </CardContent>
          <CardContent className="pt-0">
            {(assignments.data ?? []).length ? <div className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2.5"><p className="text-xs text-slate-600">授权目录 · {filteredAssignments.length}/{(assignments.data ?? []).length} 条</p><Input className="h-8 w-full sm:w-64" value={assignmentSearch} onChange={event => setAssignmentSearch(event.target.value)} placeholder="搜索人员、角色、部门或项目" /></div>{filteredAssignments.map(item => { const lifecycle = getAssignmentLifecycle(item); return <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white px-3 py-3 shadow-sm"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-slate-800">{item.userName || `用户 #${item.userId}`}</p>{item.localUsername ? <span className="font-mono text-xs text-slate-500">{item.localUsername}</span> : null}<Badge variant={lifecycle.tone}>{lifecycle.label}</Badge><Badge variant="outline">{item.roleName} · {item.roleCode}</Badge></div><p className="mt-1 text-xs leading-5 text-slate-500">范围：{item.projectName ? `项目 · ${item.projectName}` : item.organizationName ? `部门 · ${item.organizationName}` : "全局管理员"} · 生效：{displayDate(item.validFrom)} · 到期：{displayDate(item.validTo)}</p></div><div className="flex flex-wrap items-center gap-2">{item.status !== "revoked" ? <><Button size="sm" variant="outline" onClick={() => setAssignmentForm({ id: item.id, userId: String(item.userId), roleId: String(item.roleId), organizationId: item.organizationId ? String(item.organizationId) : "", projectId: item.projectId ? String(item.projectId) : "", validFrom: toLocalDateTimeInput(item.validFrom), validTo: toLocalDateTimeInput(item.validTo) })}>编辑</Button><Button size="sm" variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => setMasterDataDeleteTarget({ resource: "role_assignment", id: item.id, label: `${item.userName || `用户 #${item.userId}`} 的 ${item.roleName} 授权`, description: "确认撤销该角色授权？系统将立即停止其权限，并保留原授权记录、操作人和审计历史。" })}>撤销</Button></> : null}</div></div>; })}{!filteredAssignments.length ? <EmptyState text="未找到匹配的授权记录。" /> : null}</div> : <EmptyState text="暂无角色授权记录。" />}
          </CardContent>
        </Card>
      </section>
    </div>
  );

  const renderSettings = () => (
    <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
      <section className="space-y-6">
        <div><p className="text-sm font-medium text-[#203c48]">系统设置中心</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">接口、密钥与业务参数</h1><p className="mt-2 text-sm text-slate-500">微信公众号服务号是唯一通知通道；地图、OCR、定位、油卡和地磅等连接均在此处加密托管并经过发布流程。</p></div>
        <Card className="border-[#d8e3e0]">
          <CardHeader><CardTitle className="text-base">每日项目站内汇总</CardTitle><CardDescription>每天按中国标准时间汇总施工日报、收入开支、计量申报与运输装卸数据，并写入项目负责人的站内消息中心。定时任务、运行结果和配置修改均保留审计记录。</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1.1fr_.8fr_.8fr]">
              <label className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700"><Checkbox checked={dailyDigestForm.enabled} onCheckedChange={checked => setDailyDigestForm(current => ({ ...current, enabled: Boolean(checked) }))} />启用每日自动汇总</label>
              <div><Label>汇总时</Label><Select value={dailyDigestForm.deliveryHour} onValueChange={value => setDailyDigestForm(current => ({ ...current, deliveryHour: value }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 24 }, (_, hour) => <SelectItem key={hour} value={String(hour).padStart(2, "0")}>{String(hour).padStart(2, "0")} 时</SelectItem>)}</SelectContent></Select></div>
              <div><Label>汇总分</Label><Select value={dailyDigestForm.deliveryMinute} onValueChange={value => setDailyDigestForm(current => ({ ...current, deliveryMinute: value }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{["00", "15", "30", "45"].map(minute => <SelectItem key={minute} value={minute}>{minute} 分</SelectItem>)}</SelectContent></Select></div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600"><Checkbox checked={dailyDigestForm.includeEmptyProjects} onCheckedChange={checked => setDailyDigestForm(current => ({ ...current, includeEmptyProjects: Boolean(checked) }))} />无业务数据的项目也生成“无新增数据”站内汇总</label>
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"><BusinessStatusBadge status={dailyDigestSettings.data?.enabled ? "active" : "disabled"} /><span>最近尝试：{displayDate(dailyDigestSettings.data?.lastAttemptedAt)}</span><span>最近完整业务日：{dailyDigestSettings.data?.lastSuccessfulBusinessDate ? new Date(dailyDigestSettings.data.lastSuccessfulBusinessDate).toISOString().slice(0, 10) : "—"}</span>{dailyDigestSettings.data?.scheduleCronTaskUid ? <span className="font-mono">任务已登记</span> : null}</div>
            <div className="flex flex-wrap gap-2"><Button className="bg-[#203c48] hover:bg-[#17313b]" disabled={saveDailyDigest.isPending} onClick={() => saveDailyDigest.mutate({ enabled: dailyDigestForm.enabled, deliveryHour: Number(dailyDigestForm.deliveryHour), deliveryMinute: Number(dailyDigestForm.deliveryMinute), includeEmptyProjects: dailyDigestForm.includeEmptyProjects })}>{dailyDigestForm.enabled ? "保存并启用站内汇总" : "保存并停用站内汇总"}</Button><Button variant="outline" disabled={!dailyDigestSettings.data?.enabled || runDailyDigestNow.isPending} onClick={() => runDailyDigestNow.mutate({ businessDate: dailyDigestPreviewDate || undefined })}>立即生成所选日期站内汇总</Button></div>
            <div className="grid gap-3 rounded-xl border border-slate-100 p-3 lg:grid-cols-[1fr_180px_auto]"><div><Label>预览项目</Label><Select value={dailyDigestPreviewProjectId || "UNASSIGNED"} onValueChange={value => setDailyDigestPreviewProjectId(value === "UNASSIGNED" ? "" : value)}><SelectTrigger className="mt-1"><SelectValue placeholder="选择项目" /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">请选择项目</SelectItem>{(projects.data ?? []).filter(project => project.status === "active").map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select></div><div><Label>业务日期</Label><Input className="mt-1" type="date" value={dailyDigestPreviewDate} onChange={event => setDailyDigestPreviewDate(event.target.value)} /></div><Button className="self-end" variant="outline" disabled={!dailyDigestPreviewProjectId || dailyDigestPreview.isFetching} onClick={() => dailyDigestPreview.refetch()}>刷新预览</Button></div>
            {dailyDigestPreview.data ? <div className="grid gap-2 rounded-xl bg-[#f7faf9] p-3 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-4"><div><b>施工日报</b><p className="mt-1">{dailyDigestPreview.data.construction.reportCount} 份 · 进度 {dailyDigestPreview.data.construction.averageProgressPercent}%</p></div><div><b>收入 / 开支</b><p className="mt-1">¥{displayMoney(dailyDigestPreview.data.finance.incomeAmount)} / ¥{displayMoney(dailyDigestPreview.data.finance.expenseAmount)}</p></div><div><b>计量申报</b><p className="mt-1">{dailyDigestPreview.data.measurement.claimCount} 笔 · ¥{displayMoney(dailyDigestPreview.data.measurement.declaredAmount)}</p></div><div><b>运输闭环</b><p className="mt-1">{dailyDigestPreview.data.transport.tripCount} 趟 · 装/卸 {dailyDigestPreview.data.transport.loadConfirmedCount}/{dailyDigestPreview.data.transport.unloadConfirmedCount} · 异常 {dailyDigestPreview.data.transport.exceptionTripCount}</p></div></div> : dailyDigestPreviewProjectId && !dailyDigestPreview.isLoading ? <p className="text-xs text-slate-500">选择项目和业务日期后可查看真实聚合结果；预览不会发送通知。</p> : null}
          </CardContent>
        </Card>
        <Card className="border-[#d4e2de] bg-[#f5faf8]">
          <CardHeader><CardTitle className="text-base">统一上级主管审核</CardTitle><CardDescription>对所有配置为“上级主管审核”的业务统一生效。开启后，施工日报、采购申请和清单采购等主管审核节点会自动通过；关闭后必须由项目上级主管人工审核。会计审核、付款、收入确认、终态锁定和项目权限范围不会被此开关绕过。</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-4">
            <label className="flex items-center gap-3"><Checkbox checked={supervisorReviewAutoApproveEnabled} disabled={setSupervisorReviewAutoApprove.isPending} onCheckedChange={checked => setSupervisorReviewAutoApprove.mutate({ enabled: Boolean(checked) })} /><span><b className="block text-sm text-slate-800">{supervisorReviewAutoApproveEnabled ? "已开启自动通过" : "已关闭，需人工审核"}</b><span className="mt-1 block text-xs text-slate-600">每次切换即时发布，并写入配置版本与审计日志。</span></span></label>
            <Badge variant="outline" className={supervisorReviewAutoApproveEnabled ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-50 text-amber-700"}>{supervisorReviewAutoApproveEnabled ? "自动审核通过" : "人工主管审核"}</Badge>
          </CardContent>
        </Card>
        <Card className="border-[#cbddea] bg-[#f8fbff]">
          <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><Camera className="h-4 w-4 text-[#2177d3]" />工程水印信息模板</CardTitle><CardDescription className="mt-1">按参考图以工程信息卡覆盖在现场照片左下角。此处仅维护字段、顺序和文案；拍摄时间、负责人、项目、定位与天气均由现场采集生成并受审计。</CardDescription></div><Badge variant="outline" className="border-[#b8d3eb] bg-white text-[#276da7]">{evidenceWatermarkTemplate.data?.status === "published" ? `已发布 v${evidenceWatermarkTemplate.data.version}` : "默认模板"}</Badge></div></CardHeader>
          <CardContent className="grid gap-5 lg:grid-cols-[1.08fr_.92fr]">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2"><div><Label>水印标题</Label><Input className="mt-1 bg-white" value={watermarkTemplateForm.title} maxLength={24} onChange={event => setWatermarkTemplateForm(current => ({ ...current, title: event.target.value }))} /></div><div><Label>施工单位</Label><Input className="mt-1 bg-white" value={watermarkTemplateForm.organizationLabel} maxLength={48} onChange={event => setWatermarkTemplateForm(current => ({ ...current, organizationLabel: event.target.value }))} /></div></div>
              <div><Label>底部防伪文案</Label><Input className="mt-1 bg-white" value={watermarkTemplateForm.footerLabel} maxLength={48} onChange={event => setWatermarkTemplateForm(current => ({ ...current, footerLabel: event.target.value }))} /></div>
              <div><Label>显示字段与顺序</Label><p className="mt-1 text-xs leading-5 text-slate-500">勾选决定是否显示；使用“上移 / 下移”控制卡片内顺序。至少保留两项。</p><div className="mt-2 space-y-2">{WATERMARK_FIELD_OPTIONS.map(option => {
                const index = watermarkTemplateForm.fields.indexOf(option.id);
                const selected = index >= 0;
                return <div key={option.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[#d9e6ef] bg-white px-3 py-2"><Checkbox checked={selected} onCheckedChange={checked => setWatermarkTemplateForm(current => {
                  if (checked) return { ...current, fields: [...current.fields, option.id] };
                  if (current.fields.length <= 2) { toast.error("工程水印至少保留两项信息"); return current; }
                  return { ...current, fields: current.fields.filter(field => field !== option.id) };
                })} /><span className="min-w-24 flex-1 text-sm font-medium text-slate-700">{option.label}</span>{selected ? <><Badge variant="outline" className="border-slate-200">第 {index + 1} 项</Badge><Button size="sm" variant="outline" disabled={index === 0} onClick={() => setWatermarkTemplateForm(current => { const fields = [...current.fields]; [fields[index - 1], fields[index]] = [fields[index], fields[index - 1]]; return { ...current, fields }; })}>上移</Button><Button size="sm" variant="outline" disabled={index === watermarkTemplateForm.fields.length - 1} onClick={() => setWatermarkTemplateForm(current => { const fields = [...current.fields]; [fields[index + 1], fields[index]] = [fields[index], fields[index + 1]]; return { ...current, fields }; })}>下移</Button></> : <span className="text-xs text-slate-400">不显示</span>}</div>;
              })}</div></div>
              <Button className="bg-[#2177d3] hover:bg-[#185fae]" disabled={saveEvidenceWatermarkTemplate.isPending || watermarkTemplateForm.fields.length < 2 || !watermarkTemplateForm.title.trim() || !watermarkTemplateForm.organizationLabel.trim() || !watermarkTemplateForm.footerLabel.trim()} onClick={() => saveEvidenceWatermarkTemplate.mutate({ title: watermarkTemplateForm.title, organizationLabel: watermarkTemplateForm.organizationLabel, footerLabel: watermarkTemplateForm.footerLabel, fields: watermarkTemplateForm.fields })}>{saveEvidenceWatermarkTemplate.isPending ? "正在发布水印模板…" : "保存并发布水印模板"}</Button>
            </div>
            <div className="rounded-2xl bg-[linear-gradient(145deg,#c9e4f8,#578fbe_55%,#235176)] p-5 shadow-inner"><p className="mb-3 text-xs font-semibold tracking-[0.12em] text-white/85">现场照片水印预览</p><div className="min-h-72 rounded-xl bg-[radial-gradient(circle_at_75%_20%,#eaf7ff,transparent_25%),linear-gradient(135deg,#85c5f0,#24689d)] p-4"><div className="mt-24 max-w-[280px] overflow-hidden rounded-md border border-white/80 bg-white/90 shadow-lg"><div className="bg-[#2177d3] px-3 py-2 text-sm font-bold text-white">{watermarkTemplateForm.title || "工程水印"}</div><div className="space-y-1.5 px-3 py-3 text-xs font-medium leading-5 text-[#263846]">{watermarkTemplateForm.fields.map(field => <p key={field}>{({ capturedAt: "拍摄时间：2026/08/16 13:31", principal: "施工负责人：现场管理员", weather: "天气：晴 33℃", location: "详细地点：当前现场地址", coordinates: "详细地点：当前现场地址", organization: `施工单位：${watermarkTemplateForm.organizationLabel || "工程云管"}`, project: "项目名称：当前授权项目", antiCounterfeit: "防伪编号：归档时生成" } as Record<string, string>)[field]}</p>)}</div><div className="bg-[#2177d3] px-3 py-1.5 text-[10px] font-semibold text-white">{watermarkTemplateForm.footerLabel || "防伪水印 · 真实时间"}</div></div></div><p className="mt-3 text-xs leading-5 text-slate-600">预览仅展示样式。实际照片将以拍摄当时的管理员、项目、时间、天气和中文详细地址逐张写入像素水印，并同步保存审计元数据。</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">配置项清单</CardTitle><CardDescription>敏感值仅以掩码展示。发布后生成版本与审计日志；不提供明文导出。</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {visibleSettings.length ? visibleSettings.map(item => (
              <div key={item.id} className={`flex flex-col gap-3 rounded-xl border p-4 transition-colors ${selectedSettingId === item.id ? "border-[#203c48] bg-[#f7faf9]" : "border-slate-100"}`}>
                <button className="text-left" onClick={() => setSelectedSettingId(item.id)}><div className="flex items-center gap-2"><p className="text-sm font-medium">{item.displayName}</p>{item.isSensitive ? <Badge variant="outline">加密托管</Badge> : null}<Badge variant={item.status === "published" ? "secondary" : "outline"}>{item.status === "published" ? "已发布" : item.status === "draft" ? "草稿" : "已禁用"}</Badge></div><p className="mt-1 text-xs text-slate-500">{item.category} · {item.settingKey} · v{item.version} · {item.valuePreview || "未设置值"}</p></button>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => {
                    setSelectedSettingId(item.id);
                    setSettingForm({ id: item.id, expectedVersion: item.version, category: item.category, settingKey: item.settingKey, displayName: item.displayName, value: item.isSensitive ? "" : item.valueJson ?? "", isSensitive: item.isSensitive, remarks: item.remarks ?? "" });
                  }}>编辑</Button>
                  <Button size="sm" variant="outline" disabled={item.status === "published" || publishSetting.isPending} onClick={() => publishSetting.mutate({ id: item.id, expectedVersion: item.version })}>发布</Button>
                  <Button size="sm" variant="outline" disabled={testSetting.isPending} onClick={() => testSetting.mutate({ id: item.id })}>{item.settingKey.startsWith("WECHAT_OFFICIAL_") ? getOfficialAccountTestLabel(item.settingKey) : "校验 / 测试"}</Button>
                  {item.status !== "disabled" ? <Button size="sm" variant="outline" className="text-rose-700 hover:text-rose-800" disabled={disableSetting.isPending} onClick={() => { if (window.confirm(`确认停用“${item.displayName}”？停用后将保留密文和历史版本，但不再参与业务调用。`)) disableSetting.mutate({ id: item.id, expectedVersion: item.version }); }}>停用</Button> : null}
                  <Button size="sm" variant="outline" className="text-rose-700 hover:text-rose-800" disabled={removeSetting.isPending} onClick={() => setSettingDeleteTarget({ id: item.id, displayName: item.displayName, settingKey: item.settingKey, version: item.version, isSensitive: item.isSensitive })}>删除</Button>
                </div>
              </div>
            )) : <EmptyState text="暂无有效配置项。已停用配置仅保留在发布历史与审计中，不参与系统调用。" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">配置版本与安全回滚</CardTitle><CardDescription>历史版本不展示密钥明文；回滚后会生成新的已发布版本，并全程记录审计日志。</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {selectedSettingId === undefined ? <EmptyState text="请选择一条配置查看其发布历史。" /> : settingHistory.data?.length ? settingHistory.data.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-3"><div><p className="text-sm font-medium">{item.operation === "publish" ? "发布版本" : item.operation === "update" ? "草稿修订" : "回滚版本"} · v{item.version}</p><p className="mt-0.5 text-xs text-slate-500">{item.createdAt ? new Date(item.createdAt).toLocaleString("zh-CN") : "时间未知"}</p></div><Button size="sm" variant="outline" disabled={!selectedSetting || rollbackSetting.isPending} onClick={() => { if (selectedSetting && window.confirm("确认将当前配置回滚至此历史版本？此操作会创建新的发布版本。")) rollbackSetting.mutate({ settingId: selectedSettingId, publishLogId: item.id, expectedVersion: selectedSetting.version }); }}>回滚至此版本</Button></div>) : <EmptyState text="该配置尚无已发布历史；发布后即可在此回滚。" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">统一配置分类</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {["基础品牌与多语言", "账号安全与密码策略", "微信公众号服务号与消息模板", "地图 / OCR / 定位连接器", "油卡 / 地磅 / 外部 API", "业务参数与编号规则", "文档影像与归档规则", "运行监控与审计", "发布、回滚与版本"].map(item => <div key={item} className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">{item}</div>)}
          </CardContent>
        </Card>
      </section>
      <aside className="space-y-4">
        <Card className="border-[#cbded9] bg-[#f4faf8]">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><CardTitle className="text-base">新版微信开发者平台接入状态</CardTitle><CardDescription className="mt-1">服务号开发配置已迁移至“微信开发者平台 → 我的业务 → 服务号”。运营、模板选用和网页授权域名仍按微信各业务后台当前可见能力配置。</CardDescription></div>
              <a className="inline-flex items-center gap-1 text-xs font-medium text-[#1b5c54] hover:underline" href="https://developers.weixin.qq.com/platform/" target="_blank" rel="noreferrer">打开开发者平台<ExternalLink className="h-3.5 w-3.5" /></a>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-lg border border-[#d7e8e3] bg-white p-3"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 font-medium text-slate-800"><KeyRound className="h-4 w-4 text-[#1f6b60]" />开发密钥</div><Badge variant="outline" className={officialCredentialsReady ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-50 text-amber-700"}>{officialCredentialsReady ? "AppID / AppSecret 已发布" : "待发布"}</Badge></div><p className="mt-1.5 text-xs leading-5 text-slate-600">路径：基础信息 → 开发密钥。AppSecret 必须为“启用”状态；重置后旧密钥立即失效。</p></div>
            <div className="rounded-lg border border-[#d7e8e3] bg-white p-3"><div className="flex items-center gap-2 font-medium text-slate-800"><ShieldCheck className="h-4 w-4 text-[#1f6b60]" />API IP 白名单</div><p className="mt-1.5 text-xs leading-5 text-slate-600">系统已使用受控固定出口。微信后台仅需保留固定出口 IP <span className="font-mono">35.237.214.196</span>；无需继续追加托管环境的动态 IP。</p></div>
            <div className="rounded-lg border border-[#d7e8e3] bg-white p-3"><div className="flex items-center justify-between gap-3"><div className="font-medium text-slate-800">网页授权与跳转域名</div><Badge variant="outline" className={officialBindingReady ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-50 text-amber-700"}>{officialBindingReady ? "可发起员工绑定" : "待发布 HTTPS 地址"}</Badge></div><p className="mt-1.5 text-xs leading-5 text-slate-600">系统跳转地址须发布为 HTTPS。网页授权域名在微信公众平台“设置与开发 → 账号设置 → 功能设置”中配置，只填域名，不填协议和路径。</p></div>
            <div className="rounded-lg border border-[#d7e8e3] bg-white p-3">
              <div className="flex items-center justify-between gap-3"><div className="font-medium text-slate-800">模板消息通知</div><Badge variant="outline" className={officialTemplateReady ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-300 bg-slate-50 text-slate-600"}>{officialTemplateReady ? "业务通知已就绪" : "待开通或选用模板"}</Badge></div>
              <p className="mt-1.5 text-xs leading-5 text-slate-600">范围通知和每日汇总使用站内消息，不依赖服务号模板。仅在刷卡、审核或状态变更等具体业务即时提醒需要服务号时，才选择符合微信规则的业务模板；员工 OAuth 绑定不依赖模板 ID。</p>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"><Button size="sm" variant="outline" disabled={checkOfficialTemplateCapability.isPending} onClick={() => checkOfficialTemplateCapability.mutate()}>{checkOfficialTemplateCapability.isPending ? "正在检测模板功能…" : "检测模板消息功能插件"}</Button><Button size="sm" className="bg-[#1f6b60] hover:bg-[#18564e]" disabled={listOfficialTemplates.isPending} onClick={() => listOfficialTemplates.mutate()}>{listOfficialTemplates.isPending ? "正在读取私有模板…" : "读取并选择私有模板"}</Button></div>
              {officialTemplateOptions.length ? <div className="mt-3 space-y-2 rounded-md border border-[#d7e8e3] bg-[#f8fbfa] p-2">{officialTemplateOptions.map(template => {
                const module = officialTemplateModuleById[template.templateId] ?? "transport";
                return <div key={template.templateId} className="rounded border border-slate-200 bg-white p-2"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-medium text-slate-800">{template.title}</div><Badge variant="outline" className={template.persistentBusinessEligible === false ? "border-amber-300 bg-amber-50 text-amber-700" : "border-emerald-300 bg-emerald-50 text-emerald-700"}>{template.persistentBusinessEligible === false ? "不可用于持续业务通知" : "可按模块自动映射"}</Badge></div><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{template.content}</p><p className="mt-1 text-[11px] text-slate-500">微信字段：{Object.keys(template.fieldMapping).join("、") || "未识别"}</p>{template.eligibilityMessage ? <p className="mt-1 text-[11px] leading-5 text-amber-700">{template.eligibilityMessage}</p> : null}<div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]"><Select value={module} onValueChange={value => setOfficialTemplateModuleById(current => ({ ...current, [template.templateId]: value as typeof module }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="transport">运输刷卡与趟次</SelectItem><SelectItem value="machinery">机械/车辆维保审核</SelectItem><SelectItem value="purchasing">采购申请与订单审核</SelectItem><SelectItem value="measurement">收方、计量与回款</SelectItem><SelectItem value="finance">财务流水与审计</SelectItem><SelectItem value="labor">劳务实名与工资</SelectItem><SelectItem value="construction">施工日报与现场审核</SelectItem><SelectItem value="security">系统安全与连接告警</SelectItem></SelectContent></Select><Button size="sm" variant="outline" disabled={bindOfficialModuleTemplate.isPending || template.persistentBusinessEligible === false} onClick={() => bindOfficialModuleTemplate.mutate({ templateId: template.templateId, module })}>{bindOfficialModuleTemplate.isPending ? "正在绑定…" : template.persistentBusinessEligible === false ? "该模板不可用" : "绑定并自动映射"}</Button></div></div>;
              })}</div> : null}
            </div>
            <div className="rounded-lg border border-[#d7e8e3] bg-[#f8fbfa] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium text-slate-800">业务通知模板矩阵</p><Badge variant="outline" className={officialTemplateCoverage.data?.configured ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-50 text-amber-700"}>{officialTemplateCoverage.data?.configured ? "已发布模块模板" : "待绑定业务模板"}</Badge></div><p className="mt-1 text-xs leading-5 text-slate-600">每个业务模块可绑定自己的服务号模板，系统按模板 `.DATA` 字段自动映射，不再要求手填内部占位符；范围通知和每日汇总继续使用站内消息。</p><div className="mt-3 space-y-2">{officialTemplateCoverage.isLoading ? <p className="text-xs text-slate-500">正在核验各业务模板…</p> : officialTemplateCoverage.data?.matrix.map(item => <div key={item.module} className="rounded-md border border-slate-200 bg-white px-3 py-2"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-slate-800">{item.name}</p><Badge variant="outline" className={item.ready ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-50 text-amber-700"}>{item.ready ? "已绑定模板" : "待绑定对应模板"}</Badge></div><p className="mt-1 text-xs leading-5 text-slate-600">{item.purpose}</p>{item.templateTitle ? <p className="mt-1 text-[11px] text-emerald-700">当前模板：{item.templateTitle}</p> : <p className="mt-1 text-[11px] text-amber-700">请从上方私有模板列表选择该业务模块并点击“绑定并自动映射”。</p>}<p className="mt-1 text-[11px] text-slate-500">事件：{item.events.join("、")}</p></div>) ?? <p className="text-xs text-slate-500">模板矩阵暂不可读取，请先检查已发布服务号配置。</p>}</div></div>
            <p className="rounded-lg bg-[#e8f2ef] px-3 py-2 text-xs leading-5 text-[#28584f]">“绑定关系 → 开放平台”仅在需要与小程序、网站应用或 UnionID 体系打通时配置；当前服务号通知与员工网页授权不以此为前置条件。</p>
          </CardContent>
        </Card>
        <Card className="border-[#d8e3e0] bg-[#f7faf9]">
          <CardHeader><CardTitle className="text-base">系统内服务号配置</CardTitle><CardDescription>五项基础参数在此一次填写、一次保存并自动校验。首次配置请完整填写；后续只修改公开参数时，两个密钥留空即可保留已加密的现有值。</CardDescription></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={event => { event.preventDefault(); setOfficialAccountConfigurationValidation(null); saveOfficialAccountConfiguration.mutate(officialAccountConfigurationForm); }}>
              <Field label="微信公众服务号 AppID"><Input value={officialAccountConfigurationForm.appId} placeholder="填写服务号 AppID" autoComplete="off" onChange={event => setOfficialAccountConfigurationForm(current => ({ ...current, appId: event.target.value }))} /></Field>
              <Field label="微信公众服务号 AppSecret"><Input type="password" value={officialAccountConfigurationForm.appSecret} placeholder={publishedOfficialSettingKeys.has("WECHAT_OFFICIAL_APP_SECRET") ? "已安全托管；留空保持不变" : "首次必填"} autoComplete="new-password" onChange={event => setOfficialAccountConfigurationForm(current => ({ ...current, appSecret: event.target.value }))} /></Field>
              <Field label="公众号业务跳转地址"><Input type="url" value={officialAccountConfigurationForm.appUrl} placeholder="https://example.com" onChange={event => setOfficialAccountConfigurationForm(current => ({ ...current, appUrl: event.target.value }))} /></Field>
              <Field label="微信 API 固定出口网关地址"><Input type="url" value={officialAccountConfigurationForm.egressUrl} placeholder="https://wechat-egress.example.com" onChange={event => setOfficialAccountConfigurationForm(current => ({ ...current, egressUrl: event.target.value }))} /></Field>
              <Field label="固定出口网关签名密钥"><Input type="password" value={officialAccountConfigurationForm.egressSigningSecret} placeholder={publishedOfficialSettingKeys.has("WECHAT_OFFICIAL_EGRESS_SHARED_SECRET") ? "已安全托管；留空保持不变" : "首次必填"} autoComplete="new-password" onChange={event => setOfficialAccountConfigurationForm(current => ({ ...current, egressSigningSecret: event.target.value }))} /></Field>
              <p className="rounded-lg bg-white/80 px-3 py-2 text-xs leading-5 text-slate-600">密钥仅在服务端加密保存，不会回显、写入日志或出现在版本记录中。保存后系统会自动校验服务号凭据，不会向员工发送测试消息。</p>
              <Button type="submit" className="min-h-11 w-full bg-[#203c48] hover:bg-[#17313b]" disabled={saveOfficialAccountConfiguration.isPending || !officialAccountConfigurationForm.appId.trim() || !officialAccountConfigurationForm.appUrl.trim() || !officialAccountConfigurationForm.egressUrl.trim()}>{saveOfficialAccountConfiguration.isPending ? "正在保存并校验…" : "保存并校验服务号配置"}</Button>
              {officialAccountConfigurationValidation ? <div className={`rounded-lg border px-3 py-2 text-xs leading-5 ${officialAccountConfigurationValidation.success ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{officialAccountConfigurationValidation.success ? "校验通过：" : "需要处理："}{officialAccountConfigurationValidation.message}</div> : null}
            </form>
          </CardContent>
        </Card>
        <Card className="border-[#d4ddeb] bg-[#f8faff]">
          <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-[#445dd1]" />AI 模型 API 接入</CardTitle><CardDescription className="mt-1">用于 AI 项目风控的管理摘要。支持兼容 OpenAI Chat Completions 的公开 HTTPS API；风险扫描、通知和整改不依赖该接口，调用失败会自动回退。</CardDescription></div><Badge variant="outline" className={externalAiConfiguration.data?.enabled ? "border-emerald-300 bg-emerald-50 text-emerald-700" : externalAiConfiguration.data?.configured ? "border-amber-300 bg-amber-50 text-amber-700" : "border-slate-300 bg-white text-slate-600"}>{externalAiConfiguration.data?.enabled ? "已启用外部 AI" : externalAiConfiguration.data?.configured ? "已配置，未启用" : "待配置"}</Badge></div></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={event => { event.preventDefault(); setExternalAiApiValidation(null); saveExternalAiConfiguration.mutate(externalAiApiConfigurationForm); }}>
              <Field label="AI API 基础地址"><Input type="url" value={externalAiApiConfigurationForm.baseUrl} placeholder="https://api.example.com/v1" autoComplete="off" onChange={event => setExternalAiApiConfigurationForm(current => ({ ...current, baseUrl: event.target.value }))} /><p className="mt-1 text-xs text-slate-500">填写兼容 OpenAI 的 v1 根地址；系统会调用其 <code>/models</code> 和 <code>/chat/completions</code> 端点。</p></Field>
              <Field label="模型名称"><Input value={externalAiApiConfigurationForm.model} placeholder="例如：gpt-4o-mini 或您的模型 ID" autoComplete="off" onChange={event => setExternalAiApiConfigurationForm(current => ({ ...current, model: event.target.value }))} /></Field>
              <Field label="AI API Key"><Input type="password" value={externalAiApiConfigurationForm.apiKey} placeholder={externalAiConfiguration.data?.apiKeyConfigured ? `已安全托管（${externalAiConfiguration.data.apiKeyPreview ?? "已配置"}）；留空保持不变` : "首次配置必须填写 API Key"} autoComplete="new-password" onChange={event => setExternalAiApiConfigurationForm(current => ({ ...current, apiKey: event.target.value }))} /></Field>
              <label className="flex items-start gap-2 rounded-lg border border-[#d9e3f6] bg-white/80 px-3 py-2 text-sm text-slate-700"><Checkbox className="mt-0.5" checked={externalAiApiConfigurationForm.enabled} onCheckedChange={checked => setExternalAiApiConfigurationForm(current => ({ ...current, enabled: checked === true }))} /><span><b>启用外部 AI 摘要</b><span className="mt-1 block text-xs leading-5 text-slate-500">启用后，AI 风控仅发送脱敏风险计数和费用分类金额；连接失败时会改用系统内置 AI，再降级为规则摘要。</span></span></label>
              <p className="rounded-lg bg-white/80 px-3 py-2 text-xs leading-5 text-slate-600">API Key 采用服务端 AES-GCM 加密保存，不会回显、写入前端代码、导出文件或审计明文。连接校验仅请求模型目录，不发送任何项目业务数据。</p>
              <div className="flex flex-col gap-2 sm:flex-row"><Button type="submit" className="min-h-11 flex-1 bg-[#445dd1] hover:bg-[#364bb2]" disabled={saveExternalAiConfiguration.isPending || !externalAiApiConfigurationForm.baseUrl.trim() || !externalAiApiConfigurationForm.model.trim() || (!externalAiApiConfigurationForm.apiKey.trim() && !externalAiConfiguration.data?.apiKeyConfigured)}>{saveExternalAiConfiguration.isPending ? "正在加密保存…" : "保存 AI API 配置"}</Button><Button type="button" variant="outline" className="min-h-11 sm:w-auto" disabled={testExternalAiConfiguration.isPending || !externalAiConfiguration.data?.configured} onClick={() => { setExternalAiApiValidation(null); testExternalAiConfiguration.mutate(); }}>{testExternalAiConfiguration.isPending ? "正在校验…" : "校验 API 连接"}</Button></div>
              {externalAiApiValidation ? <div className="rounded-lg border border-[#c9d9f5] bg-[#edf3ff] px-3 py-2 text-xs leading-5 text-[#294b89]">{externalAiApiValidation}</div> : null}
            </form>
          </CardContent>
        </Card>
        <Card className="border-[#d8e3e0] bg-[#f7faf9]">
          <CardHeader><CardTitle className="text-base">企业身份账号恢复</CardTitle><CardDescription>仅配置身份提供方公开 HTTPS 恢复页面。系统不保存企业密码，登录页和个人中心将通过受控端点跳转至该地址。</CardDescription></CardHeader>
          <CardContent><Button variant="outline" className="w-full border-[#203c48] text-[#203c48]" onClick={() => setSettingForm({ category: "账号安全", settingKey: "IDENTITY_PROVIDER_RECOVERY_URL", displayName: "企业身份平台账号恢复地址", value: "", isSensitive: false, remarks: "仅限企业统一身份提供方的账号找回或密码重置页面；保存草稿后需发布才会对用户生效。" })}>填入身份恢复地址模板</Button></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">其它系统参数</CardTitle><CardDescription>服务号五项配置请使用上方统一表单；这里仅用于按需维护其它系统参数、业务规则或外部连接器。</CardDescription></CardHeader>
          <CardContent>
            <details className="group">
              <summary className="flex min-h-11 cursor-pointer items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-[#203c48] marker:hidden">{settingForm.id ? "正在编辑其它配置草稿" : "展开维护其它系统参数"}<span className="text-xs text-slate-500 group-open:hidden">按需展开</span><span className="hidden text-xs text-slate-500 group-open:inline">收起</span></summary>
              <div className="mt-3 space-y-3">
            <div><Label>配置分类</Label><Select value={settingForm.category} onValueChange={value => setSettingForm({ ...settingForm, category: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="账号安全">账号安全与身份平台</SelectItem><SelectItem value="微信公众号服务号">微信公众号服务号</SelectItem><SelectItem value="公众号消息模板">公众号消息模板</SelectItem><SelectItem value="外部API">外部 API 连接器</SelectItem><SelectItem value="业务参数">业务参数与计价规则</SelectItem><SelectItem value="文档影像">文档影像与归档</SelectItem></SelectContent></Select></div>
            <div><Label>配置键</Label><Input value={settingForm.settingKey} disabled={Boolean(settingForm.id)} placeholder="WECHAT_OFFICIAL_APP_ID" onChange={event => { const settingKey = event.target.value.toUpperCase(); setSettingForm({ ...settingForm, settingKey, isSensitive: resolveOfficialAccountSensitivity(settingKey, settingForm.isSensitive) }); }} /></div>
            <div><Label>显示名称（仅系统内标签）</Label><Input value={settingForm.displayName} placeholder="微信公众号服务号 AppID" onChange={event => setSettingForm({ ...settingForm, displayName: event.target.value })} /><p className="mt-1 text-xs text-slate-500">不要将 AppID、AppSecret、模板 ID 填在这里；请填入下方“配置值”。</p></div>
            <div><Label>配置值</Label><Input value={settingForm.value} type={settingForm.isSensitive ? "password" : "text"} placeholder={settingForm.id && settingForm.isSensitive ? "留空保留现有加密值；输入完整新值以替换" : "输入值或密钥"} onChange={event => setSettingForm({ ...settingForm, value: event.target.value })} />{settingForm.id && settingForm.isSensitive ? <p className="mt-1 text-xs leading-5 text-slate-500">为保护密钥，系统不会回显现有值。留空仅更新名称、分类或备注；填写完整新值才会替换。</p> : null}</div>
            <label className="flex items-center gap-2 text-sm text-slate-600"><Checkbox checked={settingForm.isSensitive} disabled={Boolean(settingForm.id) || settingForm.settingKey.startsWith("WECHAT_OFFICIAL_")} onCheckedChange={checked => setSettingForm({ ...settingForm, isSensitive: Boolean(checked) })} />按敏感密钥加密托管{settingForm.settingKey.startsWith("WECHAT_OFFICIAL_") ? <span className="text-xs text-slate-400">（服务号字段按安全规则自动设置）</span> : null}</label>
            <div><Label>备注</Label><Input value={settingForm.remarks} placeholder="用途、回调地址或维护说明" onChange={event => setSettingForm({ ...settingForm, remarks: event.target.value })} /></div>
            <div className="flex gap-2"><Button className="flex-1 bg-[#203c48] hover:bg-[#17313b]" disabled={!settingForm.settingKey || !settingForm.displayName || (!settingForm.value && !(settingForm.id && settingForm.isSensitive)) || saveSetting.isPending} onClick={() => saveSetting.mutate(settingForm)}>{settingForm.id ? "保存修订草稿" : "保存草稿"}</Button>{settingForm.id ? <Button variant="outline" onClick={() => setSettingForm(EMPTY_SETTING_FORM)}>取消编辑</Button> : null}</div>
              </div>
            </details>
          </CardContent>
        </Card>
        <AlertDialog open={Boolean(settingDeleteTarget)} onOpenChange={open => { if (!open) setSettingDeleteTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除配置？</AlertDialogTitle>
              <AlertDialogDescription>将删除“{settingDeleteTarget?.displayName}”（{settingDeleteTarget?.settingKey}）。{settingDeleteTarget?.isSensitive ? "系统会同步抹除当前密文及历史快照中的可恢复内容；" : "系统会同步抹除当前值及历史快照中的可恢复内容；"}保留的审计记录仅包含操作标识，不含配置值。此操作不可恢复。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={removeSetting.isPending}>取消</AlertDialogCancel>
              <AlertDialogAction className="bg-rose-700 hover:bg-rose-800" disabled={!settingDeleteTarget || removeSetting.isPending} onClick={() => { if (settingDeleteTarget) removeSetting.mutate({ id: settingDeleteTarget.id, expectedVersion: settingDeleteTarget.version }); }}>确认删除</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </aside>
    </div>
  );

  const renderAudit = () => (
    <div className="space-y-6">
      <div><p className="text-sm font-medium text-[#203c48]">治理留痕</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">配置发布与审计日志</h1><p className="mt-2 text-sm text-slate-500">所有组织、角色、授权和系统设置的关键操作都会写入服务端审计记录。敏感数据利用与审计链仅限超级管理员在本页受控复核。</p></div>
      <section className="grid gap-3 md:grid-cols-3"><MetricCard title="审计链状态" value={auditIntegrity.isLoading ? "校验中" : auditIntegrity.data?.valid ? "完整" : "待核验"} description={auditIntegrity.data?.valid ? `已封存 ${auditIntegrity.data.eventCount} 条事件` : auditIntegrity.data?.errors?.[0] || "尚未取得校验结果"} icon={ShieldCheck} /><MetricCard title="本次补链" value={auditIntegrity.data?.sealedCount ?? 0} description={auditIntegrity.data?.completeSeal === false ? "达到单次上限，请刷新继续补链" : "未发现待补链事件或已完成"} icon={ScrollText} /><MetricCard title="近期敏感访问" value={sensitiveAccesses.data?.length ?? 0} description="仅记录用途、模块、范围与数量，不展示敏感原文" icon={KeyRound} /></section>
      <Card><CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0"><div><CardTitle className="text-base">敏感数据访问利用</CardTitle><CardDescription>完整收款账户、原始定位等受控读取均必须保留用途与项目范围留痕。</CardDescription></div><Button size="sm" variant="outline" onClick={() => { void auditIntegrity.refetch(); void sensitiveAccesses.refetch(); }} disabled={auditIntegrity.isFetching || sensitiveAccesses.isFetching}>刷新核验</Button></CardHeader><CardContent>{sensitiveAccesses.data?.length ? <div className="space-y-2">{sensitiveAccesses.data.map(item => <div key={item.id} className="grid gap-1 rounded-xl border border-slate-100 p-3 md:grid-cols-[1fr_auto]"><div><p className="text-sm font-medium text-slate-700">{item.dataCategory} · {item.result}</p><p className="mt-1 text-xs text-slate-500">{item.module} · {item.accessPurpose} · 返回 {item.recordCount} 条</p></div><p className="text-xs text-slate-400">{displayDate(item.createdAt)}</p></div>)}</div> : <EmptyState text="近期暂无受控敏感数据访问记录。" />}</CardContent></Card>
      <Card>
        <CardHeader><CardTitle className="text-base">最近操作</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {audits.data?.length ? audits.data.map(item => <div key={item.id} className="grid gap-1 rounded-xl border border-slate-100 p-3 md:grid-cols-[1fr_auto]"><div><p className="text-sm font-medium text-slate-700">{item.summary}</p><p className="mt-1 text-xs text-slate-400">{item.module} · {item.action} · 操作人 #{item.userId ?? "系统"}</p></div><p className="text-xs text-slate-400">{displayDate(item.createdAt)}</p></div>) : <EmptyState text="尚无审计记录；首次保存组织、角色或配置后将自动生成。" />}
        </CardContent>
      </Card>
    </div>
  );

  /** 微信登录台账只展示可读状态和业务范围；OpenID、令牌及设备原始指纹始终不进入浏览器。 */
  const renderWechatLogin = () => {
    const rows = wechatLogins.data ?? [];
    const activeCount = rows.filter(item => item.bindingStatus === "active").length;
    const needsActionCount = rows.filter(item => ["unsubscribed", "revoked", "disabled"].includes(item.bindingStatus)).length;
    const statusLabel: Record<string, string> = { active: "已绑定", pending: "待完成", unsubscribed: "未关注服务号", revoked: "已解除", disabled: "已停用" };
    const loginModeLabel: Record<string, string> = { pc: "仅 PC", mobile: "仅手机", both: "PC + 手机" };
    return (
      <div className="space-y-6">
        <div>
          <p className="text-sm font-medium text-[#203c48]">微信公众号服务号 · 身份治理</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">微信登录管理</h1>
          <p className="mt-2 text-sm text-slate-500">集中核验微信 OAuth 授权、服务号关注状态、岗位范围和匿名设备摘要。仅超级管理员可解除绑定；解除后人员须在微信内重新授权。</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard title="已绑定账号" value={activeCount} description="可接收服务号业务通知" icon={KeyRound} />
          <MetricCard title="需处理状态" value={needsActionCount} description="未关注、已解除或已停用" icon={ShieldCheck} />
          <MetricCard title="绑定台账" value={rows.length} description="不展示 OpenID、令牌或设备指纹" icon={UsersRound} />
        </div>
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div><CardTitle className="text-base">微信授权与登录台账</CardTitle><CardDescription>姓名、职务、角色、部门/项目范围和最近状态均为服务端投影；设备仅显示可读摘要。</CardDescription></div>
            <Button size="sm" variant="outline" onClick={() => wechatLogins.refetch()} disabled={wechatLogins.isFetching}>刷新台账</Button>
          </CardHeader>
          <CardContent>
            {wechatLogins.isLoading ? <EmptyState text="正在读取微信授权登录台账…" /> : wechatLogins.isError ? <EmptyState text="暂无法读取微信登录台账，请确认当前账号具有超级管理员权限后重试。" /> : rows.length ? <div className="space-y-3">{rows.map(item => (
              <div key={item.userId} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><p className="font-medium text-slate-900">{item.displayName || item.localUsername || "未命名人员"}</p><Badge className={item.bindingStatus === "active" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}>{statusLabel[item.bindingStatus] ?? item.bindingStatus}</Badge></div>
                    <p className="mt-1 text-xs text-slate-500">职务：{item.positionName || "未配置"} · 登录终端：{loginModeLabel[item.loginMode] ?? "按账号策略"} · 身份来源：{item.bindingSource === "wechat_oauth" ? "微信 OAuth" : "管理员核验"}</p>
                  </div>
                  <Button size="sm" variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" disabled={item.bindingStatus === "revoked" || revokeWechatBinding.isPending} onClick={() => setWechatBindingActionTarget({ userId: item.userId, displayName: item.displayName || item.localUsername || "该人员" })}>解除绑定</Button>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-slate-600 md:grid-cols-2 xl:grid-cols-4">
                  <p><span className="text-slate-400">岗位：</span>{item.roleNames.length ? item.roleNames.join("、") : "未授权"}</p>
                  <p><span className="text-slate-400">范围：</span>{item.scopeNames.length ? item.scopeNames.join("、") : "未配置"}</p>
                  <p><span className="text-slate-400">最近登录：</span>{displayDate(item.lastSignedIn)}</p>
                  <p><span className="text-slate-400">最近核验：</span>{displayDate(item.lastVerifiedAt)}</p>
                  <p><span className="text-slate-400">绑定时间：</span>{displayDate(item.boundAt)}</p>
                  <p><span className="text-slate-400">设备摘要：</span>{item.deviceLabel || "未绑定考勤设备"}</p>
                  <p><span className="text-slate-400">设备最近使用：</span>{displayDate(item.deviceLastUsedAt)}</p>
                  <p><span className="text-slate-400">投递异常：</span>{item.failureCount ? `${item.failureCount} 次，最近 ${displayDate(item.lastFailureAt)}` : "无"}</p>
                </div>
              </div>
            ))}</div> : <EmptyState text="尚无微信授权绑定记录。人员可在移动端“我的”中完成服务号 OAuth 绑定后在此出现。" />}
          </CardContent>
        </Card>
        <AlertDialog open={Boolean(wechatBindingActionTarget)} onOpenChange={open => { if (!open) setWechatBindingActionTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>确认解除微信授权绑定？</AlertDialogTitle><AlertDialogDescription>将解除“{wechatBindingActionTarget?.displayName}”的微信服务号身份关联。该人员将无法继续接收服务号业务通知，直到其在移动端重新完成微信授权绑定。岗位、项目范围和业务数据不会被修改。</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel disabled={revokeWechatBinding.isPending}>取消</AlertDialogCancel><AlertDialogAction className="bg-rose-700 hover:bg-rose-800" disabled={!wechatBindingActionTarget || revokeWechatBinding.isPending} onClick={() => { if (wechatBindingActionTarget) revokeWechatBinding.mutate({ userId: wechatBindingActionTarget.userId }); }}>确认解除</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  };

  /** 业务台账不把空项目解释为全量范围；数据读取仍由各业务路由在服务端复核权限。 */
  const renderWorkspaceProjectFilter = (title: string, description: string) => (
    <Card className="border-[#d8e3e0]">
      <CardContent className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[240px] flex-1">
          <Label htmlFor="business-workspace-project">当前项目</Label>
          <Select value={businessWorkspaceProjectId || "UNASSIGNED"} onValueChange={value => setBusinessWorkspaceProjectId(value === "UNASSIGNED" ? "" : value)}>
            <SelectTrigger id="business-workspace-project" className="mt-1"><SelectValue placeholder="选择已授权项目" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="UNASSIGNED">请选择项目</SelectItem>
              {(projects.data ?? []).filter(project => project.status !== "archived").map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[260px] flex-[2]"><p className="text-sm font-medium text-slate-800">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div>
        <Button size="sm" variant="outline" onClick={() => projects.refetch()} disabled={projects.isFetching}>刷新项目</Button>
      </CardContent>
    </Card>
  );

  const renderConstruction = () => {
    const rows = constructionDailyReports.data ?? [];
    const summary = constructionDailySummary.data;
    const editorCanEdit = isEditableConstructionReport(constructionReportEditor);
    const openConstructionEditor = (item?: typeof rows[number]) => setConstructionReportEditor(item ? {
      id: Number(item.id), projectId: workspaceProjectId, status: item.status, reportDate: toBusinessDateInput(item.reportDate), workArea: item.workArea, weather: item.weather, workContent: item.workContent, safetyNotes: item.safetyNotes ?? "", issueNotes: item.issueNotes ?? "", progressPercent: String(item.progressPercent),
    } : { projectId: workspaceProjectId, status: "draft", reportDate: toLocalDateInput(), workArea: "", weather: "other", workContent: "", safetyNotes: "", issueNotes: "", progressPercent: "0" });
    const showConstructionEvidence = (item: typeof rows[number]) => {
      const evidence = constructionEvidenceByReport.get(Number(item.id)) ?? [];
      setDesktopRecordDetail({
        title: `施工日报关联影像 · ${item.workArea}`,
        description: evidence.length ? `以下 ${evidence.length} 张水印照片随日报一并提交，图片链接为短时签名地址，仅在当前项目与施工权限范围内可查看。` : "该日报暂未关联现场影像；填报人员可在日报新建或编辑窗口中一次性补充照片后再提交审核。",
        fields: evidence.length ? evidence.map((photo, index) => ({
          label: `照片 ${index + 1}`,
          value: <a className="block max-w-sm overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-2 hover:border-[#2d6b63]" href={photo.url} target="_blank" rel="noreferrer"><img className="h-40 w-full rounded object-cover" src={photo.url} alt={photo.description || `施工日报照片 ${index + 1}`} /><span className="mt-2 block text-xs leading-5 text-slate-600">{photo.description || "施工日报现场影像"} · {displayDate(photo.capturedAt)}</span></a>,
        })) : [{ label: "关联状态", value: "尚无已归档照片" }],
      });
    };
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-sm font-medium text-[#203c48]">施工执行 · 真实业务台账</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">施工日报与现场进度</h1><p className="mt-2 max-w-3xl text-sm text-slate-500">仅查询所选项目的真实施工日报。提交、审核、退回和归档均继续通过服务端项目范围、岗位和状态机校验。</p></div>
          <Button onClick={() => openConstructionEditor()} disabled={!hasBusinessWorkspaceProject}>新建施工日报</Button>
        </div>
        {renderWorkspaceProjectFilter("施工项目范围", "选择项目后加载日报、累计进度和待处理状态；未选择项目时不会请求或展示施工生产记录。")}
        {!hasBusinessWorkspaceProject ? <EmptyState text="请先选择已授权项目，以读取真实施工日报。" /> : constructionDailyReports.isLoading || constructionDailySummary.isLoading ? <EmptyState text="正在读取施工日报与进度汇总…" /> : constructionDailyReports.isError || constructionDailySummary.isError ? <EmptyState text="暂无法读取施工业务数据，请确认当前账号的服务端授权后重试。" /> : (
          <>
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard title="日报总数" value={summary?.total} description={selectedWorkspaceProject?.name ?? "当前项目"} icon={FolderKanban} />
              <MetricCard title="待审核日报" value={summary?.submitted} description="已提交，待处理" icon={ScrollText} />
              <MetricCard title="已归档日报" value={summary?.locked} description="不可再回退" icon={ShieldCheck} />
              <MetricCard title="平均进度" value={summary?.averageProgressPercent} description="来自真实日报申报比例" icon={BarChart3} />
            </section>
            <Card className="w-full border-[#d8e3e0] shadow-sm"><CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0"><div><p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">施工执行 · 综合台账</p><CardTitle className="mt-1 text-base">施工日报、现场影像与审核台账</CardTitle><CardDescription className="mt-1">每份日报行内汇总作业面、天气、累计进度、影像数量、安全问题和审核状态；详情、编辑、提交、审核、退回与归档均在同一条业务记录办理。</CardDescription></div><Button size="sm" variant="outline" onClick={() => Promise.all([constructionDailyReports.refetch(), constructionDailySummary.refetch(), constructionReportEvidence.refetch()])} disabled={constructionDailyReports.isFetching || constructionDailySummary.isFetching || constructionReportEvidence.isFetching}>刷新台账</Button></CardHeader><CardContent><div className="overflow-x-auto rounded-xl border border-[#e1e8e4]"><Table className="min-w-[1350px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow className="border-[#dce3de] hover:bg-[#edf1ed]"><TableHead className="h-11 px-4 font-semibold text-[#46615a]">日报日期</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">作业面 / 内容</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">天气 / 进度</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">安全 / 问题</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">关联影像</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">状态</TableHead><TableHead className="h-11 px-4 text-right font-semibold text-[#46615a]">操作</TableHead></TableRow></TableHeader><TableBody>{rows.length ? rows.map(item => <TableRow key={item.id} className="border-[#edf0ee] hover:bg-[#fbfaf1]"><TableCell className="px-4 py-3 text-slate-700">{displayDate(item.reportDate)}</TableCell><TableCell className="max-w-[280px] px-4 py-3"><p className="font-semibold text-[#203c48]">{item.workArea}</p><p className="mt-1 line-clamp-2 text-slate-500">{item.workContent}</p></TableCell><TableCell className="px-4 py-3"><p className="text-slate-700">{CONSTRUCTION_WEATHER_LABELS[item.weather]}</p><p className="mt-1 text-slate-500">{Number(item.progressPercent).toFixed(2)}%</p></TableCell><TableCell className="max-w-[240px] px-4 py-3"><p className="line-clamp-1 text-slate-700">安全：{item.safetyNotes || "未记录"}</p><p className="mt-1 line-clamp-1 text-slate-500">问题：{item.issueNotes || "未记录"}</p></TableCell><TableCell className="px-4 py-3"><Button size="sm" variant="outline" onClick={() => showConstructionEvidence(item)} disabled={constructionReportEvidence.isFetching}>照片 {constructionEvidenceByReport.get(Number(item.id))?.length ?? 0} 张</Button></TableCell><TableCell className="px-4 py-3"><BusinessStatusBadge status={item.status} /></TableCell><TableCell className="px-4 py-3 text-right"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => openConstructionEditor(item)}>{["draft", "rejected"].includes(item.status) ? "查看/编辑" : "详情"}</Button>{item.status === "draft" ? <Button size="sm" onClick={() => transitionConstructionReport.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "submitted" })} disabled={transitionConstructionReport.isPending}>提交</Button> : null}{item.status === "submitted" ? <><Button size="sm" onClick={() => transitionConstructionReport.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "approved" })} disabled={transitionConstructionReport.isPending}>审核</Button><Button size="sm" variant="outline" onClick={() => transitionConstructionReport.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "rejected" })} disabled={transitionConstructionReport.isPending}>退回</Button></> : null}{item.status === "approved" ? <Button size="sm" variant="outline" onClick={() => transitionConstructionReport.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "locked" })} disabled={transitionConstructionReport.isPending}>归档</Button> : null}</div></TableCell></TableRow>) : <TableRow><TableCell colSpan={7} className="px-4 py-10 text-center text-slate-500">当前项目尚无真实施工日报。请使用右上方“新建施工日报”录入现场记录。</TableCell></TableRow>}</TableBody></Table></div><p className="mt-3 text-xs text-slate-500">手机端可左右滑动查看完整字段；照片、审批与归档仍由服务端按项目范围、岗位和状态机复核。</p></CardContent></Card>
            <Dialog open={Boolean(constructionReportEditor)} onOpenChange={open => { if (!open) setConstructionReportEditor(null); }}><DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{constructionReportEditor?.id ? "施工日报查看与编辑" : "新建施工日报"}</DialogTitle><DialogDescription>{editorCanEdit ? "当前日报可在 PC 后台直接维护。保存后由服务端重新校验项目范围、岗位和草稿/退回状态。" : "该日报已进入受控状态，PC 后台仅允许查看；如需处理，请使用本页状态操作。"}</DialogDescription></DialogHeader><div className="grid gap-4 py-2"><div className="grid gap-4 sm:grid-cols-2"><Field label="日报日期"><Input type="date" value={constructionReportEditor?.reportDate ?? ""} disabled={!editorCanEdit} onChange={event => setConstructionReportEditor(current => current ? { ...current, reportDate: event.target.value } : current)} /></Field><Field label="天气"><Select value={constructionReportEditor?.weather ?? "other"} disabled={!editorCanEdit} onValueChange={weather => setConstructionReportEditor(current => current ? { ...current, weather: weather as ConstructionWeather } : current)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(CONSTRUCTION_WEATHER_LABELS) as ConstructionWeather[]).map(weather => <SelectItem key={weather} value={weather}>{CONSTRUCTION_WEATHER_LABELS[weather]}</SelectItem>)}</SelectContent></Select></Field></div><div className="grid gap-4 sm:grid-cols-[1fr_180px]"><Field label="施工部位 / 作业面"><Input value={constructionReportEditor?.workArea ?? ""} disabled={!editorCanEdit} onChange={event => setConstructionReportEditor(current => current ? { ...current, workArea: event.target.value } : current)} /></Field><Field label="累计完成比例（%）"><Input type="number" min="0" max="100" step="0.01" value={constructionReportEditor?.progressPercent ?? ""} disabled={!editorCanEdit} onChange={event => setConstructionReportEditor(current => current ? { ...current, progressPercent: event.target.value } : current)} /></Field></div><Field label="当日施工内容"><Textarea className="min-h-32" value={constructionReportEditor?.workContent ?? ""} disabled={!editorCanEdit} onChange={event => setConstructionReportEditor(current => current ? { ...current, workContent: event.target.value } : current)} /></Field><div className="grid gap-4 md:grid-cols-2"><Field label="安全记录（可选）"><Textarea value={constructionReportEditor?.safetyNotes ?? ""} disabled={!editorCanEdit} onChange={event => setConstructionReportEditor(current => current ? { ...current, safetyNotes: event.target.value } : current)} /></Field><Field label="问题记录（可选）"><Textarea value={constructionReportEditor?.issueNotes ?? ""} disabled={!editorCanEdit} onChange={event => setConstructionReportEditor(current => current ? { ...current, issueNotes: event.target.value } : current)} /></Field></div></div><DialogFooter><Button variant="outline" onClick={() => setConstructionReportEditor(null)} disabled={saveConstructionReport.isPending}>关闭</Button>{editorCanEdit ? <Button disabled={!constructionReportEditor || !constructionReportEditor.reportDate || constructionReportEditor.workArea.trim().length < 2 || constructionReportEditor.workContent.trim().length < 4 || !Number.isFinite(Number(constructionReportEditor.progressPercent)) || saveConstructionReport.isPending} onClick={() => constructionReportEditor && saveConstructionReport.mutate({ id: constructionReportEditor.id, projectId: constructionReportEditor.projectId, reportDate: constructionReportEditor.reportDate, workArea: constructionReportEditor.workArea.trim(), weather: constructionReportEditor.weather, workContent: constructionReportEditor.workContent.trim(), safetyNotes: constructionReportEditor.safetyNotes.trim() || null, issueNotes: constructionReportEditor.issueNotes.trim() || null, progressPercent: Number(constructionReportEditor.progressPercent) })}>{saveConstructionReport.isPending ? "正在保存…" : constructionReportEditor.id ? "保存修改" : "保存日报"}</Button> : null}</DialogFooter></DialogContent></Dialog>
          </>
        )}
      </div>
    );
  };

  const renderPurchasing = () => {
    const requests = purchasingRequests.data ?? [];
    const orders = purchasingOrders.data ?? [];
    const inventoryData = purchasingInventory.data;
    const inventoryBalances = Array.isArray(inventoryData) ? [] : inventoryData?.balances ?? [];
    const inventoryTransactions = Array.isArray(inventoryData) ? [] : inventoryData?.transactions ?? [];
    const settlementTotals = purchasingSettlements.data?.totalsByOrder ?? {};
    const submittedRequests = requests.filter(item => item.status === "submitted");
    const activeOrders = orders.filter(item => !["closed", "void"].includes(item.status));
    const totalInventoryValue = inventoryBalances.reduce((sum, item) => sum + Number(item.totalAmount), 0);
    const pendingSettlementAmount = Object.values(settlementTotals).reduce((sum, item) => sum + Number(item.remainingAmount), 0);
    const statusLabel = (status: string) => ({ draft: "草稿", submitted: "待审批", approved: "已批准", ordered: "已下单", received: "已收货", stocked: "已入库", closed: "已关闭", rejected: "已退回", confirmed: "已确认", void: "已作废" }[status] ?? status);
    const transactionLabel = (type: string) => type === "inbound" ? "入库" : type === "outbound" ? "领用出库" : "退库";
    const openInventoryDialog = (transactionType: InventoryTransactionForm["transactionType"]) => {
      setInventoryTransactionForm({ ...EMPTY_INVENTORY_TRANSACTION_FORM, projectId: String(workspaceProjectId), transactionType, occurredAt: toLocalDateTimeInput(new Date()) });
      setInventoryTransactionDialogOpen(true);
    };
    return <div className="space-y-6">
      <Card className="border-[#d8e3e0] bg-[#f8fbfa]"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-[#203c48]">生活开支采购录入</p><p className="mt-1 text-sm leading-6 text-slate-500">食堂食材、宿舍营地、水电气网络、办公用品和通勤后勤等生活类支出，使用“清单采购录入”按固定类别登记。请先在手机端拍摄清单水印影像，再填写数量、单价和下单时间；金额、审核开关与审计由服务端控制。</p></div><Button className="shrink-0" onClick={() => window.location.assign(`/mobile/purchasing?projectId=${workspaceProjectId}`)} disabled={!hasBusinessWorkspaceProject}>前往生活开支采购录入</Button></CardContent></Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-medium text-[#203c48]">采购与仓储 · 采购闭环与库存审计</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">采购订单与库存台账</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">集中查看采购申请、清单小额采购、订单收货、结算余额以及不可变库存收发流水。库存余额由服务端按项目、物料和单位实时汇总，不能直接改写。</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => openInventoryDialog("outbound")} disabled={!hasBusinessWorkspaceProject}>登记领用出库</Button><Button onClick={() => openInventoryDialog("inbound")} disabled={!hasBusinessWorkspaceProject}>登记入库</Button></div></div>
      {renderWorkspaceProjectFilter("采购仓储项目范围", "选择项目后读取该项目采购申请、采购订单、实际结算与库存收发流水；未选择项目不会显示或办理库存数据。")}
      {!hasBusinessWorkspaceProject ? <EmptyState text="请先选择已授权项目，以读取采购申请、订单、仓储余额和出入库台账。" /> : purchasingRequests.isLoading || purchasingOrders.isLoading || purchasingInventory.isLoading || purchasingSettlements.isLoading ? <EmptyState text="正在读取采购与仓储台账…" /> : purchasingRequests.isError || purchasingOrders.isError || purchasingInventory.isError || purchasingSettlements.isError ? <EmptyState text="暂无法读取采购与仓储数据，请确认当前账号的采购模块、岗位与项目范围授权。" /> : <>
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><MetricCard title="待审批申请" value={submittedRequests.length} description={`采购申请共 ${requests.length} 单`} icon={ScrollText} /><MetricCard title="在途采购订单" value={activeOrders.length} description={`订单总金额 ¥${displayMoney(activeOrders.reduce((sum, item) => sum + Number(item.amount), 0))}`} icon={ShoppingCart} /><MetricCard title="库存物料品种" value={inventoryBalances.filter(item => Number(item.balanceQuantity) > 0).length} description="按物料名称与单位汇总" icon={DatabaseBackup} /><MetricCard title="库存账面金额" value={`¥${displayMoney(totalInventoryValue)}`} description={`待结算 ¥${displayMoney(pendingSettlementAmount)}`} icon={BarChart3} /></section>
        <Card className="border-[#d8e3e0]"><CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0"><div><CardTitle className="text-base">采购申请与订单闭环</CardTitle><CardDescription>采购申请与清单小额采购继续沿用既有移动端录入、主管审核开关和普通单据影像归档规则；本页用于项目级全流程复核。</CardDescription></div><Button size="sm" variant="outline" onClick={() => Promise.all([purchasingRequests.refetch(), purchasingOrders.refetch(), purchasingSettlements.refetch()])}>刷新采购台账</Button></CardHeader><CardContent className="space-y-4"><div className="overflow-x-auto rounded-xl border border-[#e1e8e4]"><Table className="min-w-[980px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow><TableHead>采购申请</TableHead><TableHead>金额</TableHead><TableHead>说明</TableHead><TableHead>状态</TableHead><TableHead>创建时间</TableHead></TableRow></TableHeader><TableBody>{requests.length ? requests.map(item => <TableRow key={item.id}><TableCell className="font-medium text-[#203c48]">{item.requestNo}</TableCell><TableCell>¥{displayMoney(item.amount)}</TableCell><TableCell className="max-w-[440px] truncate">{item.description}</TableCell><TableCell><BusinessStatusBadge status={item.status} /></TableCell><TableCell>{displayDate(item.updatedAt)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={5} className="h-20 text-center text-slate-500">当前项目暂无采购申请记录。</TableCell></TableRow>}</TableBody></Table></div><div className="overflow-x-auto rounded-xl border border-[#e1e8e4]"><Table className="min-w-[1080px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow><TableHead>采购订单</TableHead><TableHead>模式 / 物资</TableHead><TableHead>订单金额</TableHead><TableHead>已结算 / 待结算</TableHead><TableHead>状态</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{orders.length ? orders.map(item => { const settlement = settlementTotals[String(item.id)] ?? { settledAmount: 0, remainingAmount: Number(item.amount) }; return <TableRow key={item.id}><TableCell className="font-medium text-[#203c48]">{item.orderNo}</TableCell><TableCell><p>{item.procurementMode === "small_direct" ? "小额直接采购" : "申请转订单"}</p><p className="mt-1 max-w-[260px] truncate text-slate-500">{item.itemDescription || "采购申请关联订单"}</p></TableCell><TableCell>¥{displayMoney(item.amount)}</TableCell><TableCell><p>¥{displayMoney(settlement.settledAmount)}</p><p className="mt-1 text-slate-500">待 ¥{displayMoney(settlement.remainingAmount)}</p></TableCell><TableCell><BusinessStatusBadge status={item.status} /></TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setDesktopRecordDetail({ title: `采购订单详情 · ${item.orderNo}`, description: "采购金额、结算余额和状态均来自服务端受控业务记录。", fields: [{ label: "采购模式", value: item.procurementMode === "small_direct" ? "小额直接采购" : "采购申请转订单" }, { label: "物资说明", value: item.itemDescription || "—" }, { label: "订单金额", value: `¥ ${displayMoney(item.amount)}` }, { label: "已结算", value: `¥ ${displayMoney(settlement.settledAmount)}` }, { label: "待结算", value: `¥ ${displayMoney(settlement.remainingAmount)}` }, { label: "当前状态", value: statusLabel(item.status) }] })}>详情</Button></TableCell></TableRow>; }) : <TableRow><TableCell colSpan={6} className="h-20 text-center text-slate-500">当前项目暂无采购订单记录。</TableCell></TableRow>}</TableBody></Table></div><div className="rounded-xl border border-[#d8e3e0] bg-[#f8fbfa] p-3"><div className="mb-3 flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold text-[#203c48]">订单单据与发票影像</p><p className="mt-1 text-xs leading-5 text-slate-500">仅显示当前项目订单的受控附件。图片可直接预览并新窗口放大；PDF 仅提供受控打开入口。</p></div><Badge variant="outline">{orders.filter(item => item.documentAttachment || item.invoiceAttachment).length} 单已归档附件</Badge></div>{orders.length ? <div className="grid gap-3 lg:grid-cols-2">{orders.map(item => <div key={`attachment-${item.id}`} className="rounded-lg border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-medium text-[#203c48]">{item.orderNo}</p><p className="mt-1 text-xs text-slate-500">{item.itemDescription || "采购申请关联订单"} · 数量 {item.quantity === null ? "—" : displayMoney(item.quantity)} · 单价 ¥{item.unitPrice === null ? "—" : displayMoney(item.unitPrice)} · 金额 ¥{displayMoney(item.amount)}</p></div>{item.hasInvoice ? <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700" variant="outline">有发票</Badge> : <Badge variant="outline">无发票</Badge>}</div><div className="mt-3 grid gap-3 sm:grid-cols-2"><div><p className="mb-1 text-xs font-medium text-slate-700">采购单据</p>{item.documentAttachment ? <><a className="text-xs font-medium text-[#2b6660] underline" href={item.documentAttachment.url} target="_blank" rel="noreferrer">打开：{item.documentAttachment.fileName}</a>{item.documentAttachment.mimeType.startsWith("image/") ? <a href={item.documentAttachment.url} target="_blank" rel="noreferrer"><img className="mt-2 h-32 w-full rounded-md border border-slate-200 object-cover" src={item.documentAttachment.url} alt={`采购单据 ${item.orderNo}`} /></a> : <p className="mt-2 text-xs text-slate-500">PDF 单据将在新窗口打开。</p>}</> : <p className="text-xs text-slate-500">未关联单据照片</p>}</div><div><p className="mb-1 text-xs font-medium text-slate-700">发票附件</p>{item.hasInvoice && item.invoiceAttachment ? <><a className="text-xs font-medium text-[#2b6660] underline" href={item.invoiceAttachment.url} target="_blank" rel="noreferrer">打开：{item.invoiceAttachment.fileName}</a>{item.invoiceAttachment.mimeType.startsWith("image/") ? <a href={item.invoiceAttachment.url} target="_blank" rel="noreferrer"><img className="mt-2 h-32 w-full rounded-md border border-slate-200 object-cover" src={item.invoiceAttachment.url} alt={`发票附件 ${item.orderNo}`} /></a> : <p className="mt-2 text-xs text-slate-500">电子发票 PDF 将在新窗口打开。</p>}</> : <p className="text-xs text-slate-500">{item.hasInvoice ? "已登记有发票，但未找到归档附件" : "本单未登记发票"}</p>}</div></div></div>)}</div> : <p className="text-sm text-slate-500">当前项目暂无采购订单。</p>}</div></CardContent></Card>
        <Card className="border-[#d8e3e0]"><CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0"><div><CardTitle className="text-base">仓储余额与收发流水</CardTitle><CardDescription>入库、领用出库、退库均写入不可变流水；出库不会修改历史入库记录，库存余额由服务端汇总。请按实物和项目范围登记。</CardDescription></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => openInventoryDialog("return")}>登记退库</Button><Button size="sm" variant="outline" onClick={() => purchasingInventory.refetch()}>刷新库存</Button></div></CardHeader><CardContent className="space-y-4"><div className="overflow-x-auto rounded-xl border border-[#e1e8e4]"><Table className="min-w-[820px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow><TableHead>物料</TableHead><TableHead>单位</TableHead><TableHead>库存余额</TableHead><TableHead>库存账面金额</TableHead><TableHead>状态</TableHead></TableRow></TableHeader><TableBody>{inventoryBalances.length ? inventoryBalances.map(item => <TableRow key={`${item.itemName}-${item.unit}`}><TableCell className="font-medium text-[#203c48]">{item.itemName}</TableCell><TableCell>{item.unit}</TableCell><TableCell className={Number(item.balanceQuantity) < 0 ? "font-semibold text-rose-700" : "font-semibold text-emerald-700"}>{displayMoney(item.balanceQuantity)}</TableCell><TableCell>¥{displayMoney(item.totalAmount)}</TableCell><TableCell>{Number(item.balanceQuantity) < 0 ? <Badge variant="outline" className="border-rose-200 text-rose-700">账面负库存待核查</Badge> : Number(item.balanceQuantity) === 0 ? <Badge variant="outline">无库存</Badge> : <Badge variant="outline" className="border-emerald-200 text-emerald-700">可用</Badge>}</TableCell></TableRow>) : <TableRow><TableCell colSpan={5} className="h-20 text-center text-slate-500">当前项目暂无库存流水；请从入库、领用出库或退库开始登记。</TableCell></TableRow>}</TableBody></Table></div><div className="overflow-x-auto rounded-xl border border-[#e1e8e4]"><Table className="min-w-[920px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow><TableHead>流水单号</TableHead><TableHead>类型</TableHead><TableHead>物料</TableHead><TableHead>数量 / 单位</TableHead><TableHead>金额</TableHead><TableHead>发生时间</TableHead><TableHead>备注</TableHead></TableRow></TableHeader><TableBody>{inventoryTransactions.length ? inventoryTransactions.slice(0, 30).map(item => <TableRow key={item.id}><TableCell className="font-medium text-[#203c48]">{item.transactionNo}</TableCell><TableCell>{transactionLabel(item.transactionType)}</TableCell><TableCell>{item.itemName}</TableCell><TableCell>{displayMoney(item.quantity)} {item.unit}</TableCell><TableCell>¥{displayMoney(item.amount)}</TableCell><TableCell>{displayDate(item.occurredAt)}</TableCell><TableCell className="max-w-[260px] truncate">{item.remarks || "—"}</TableCell></TableRow>) : <TableRow><TableCell colSpan={7} className="h-20 text-center text-slate-500">暂无库存收发流水。</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
      </>}
      <Dialog open={inventoryTransactionDialogOpen} onOpenChange={open => { setInventoryTransactionDialogOpen(open); if (!open) setInventoryTransactionForm(EMPTY_INVENTORY_TRANSACTION_FORM); }}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>登记库存{transactionLabel(inventoryTransactionForm.transactionType)}</DialogTitle><DialogDescription>库存金额由数量 × 单价在服务器重新计算并写入不可变流水。请以实际物料、数量和发生时间为准，禁止用负数冲销。</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={event => { event.preventDefault(); saveInventoryTransaction.mutate({ projectId: Number(inventoryTransactionForm.projectId), transactionType: inventoryTransactionForm.transactionType, itemName: inventoryTransactionForm.itemName.trim(), unit: inventoryTransactionForm.unit.trim(), quantity: Number(inventoryTransactionForm.quantity), unitCost: Number(inventoryTransactionForm.unitCost), occurredAt: new Date(inventoryTransactionForm.occurredAt).toISOString(), remarks: inventoryTransactionForm.remarks.trim() || null }); }}><div className="grid gap-4 sm:grid-cols-2"><Field label="项目"><Input value={selectedWorkspaceProject?.name ?? ""} disabled /></Field><Field label="收发类型"><Select value={inventoryTransactionForm.transactionType} onValueChange={value => setInventoryTransactionForm(current => ({ ...current, transactionType: value as InventoryTransactionForm["transactionType"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inbound">入库</SelectItem><SelectItem value="outbound">领用出库</SelectItem><SelectItem value="return">退库</SelectItem></SelectContent></Select></Field></div><div className="grid gap-4 sm:grid-cols-2"><Field label="物料名称"><Input value={inventoryTransactionForm.itemName} maxLength={200} placeholder="例如：水泥 P.O 42.5" onChange={event => setInventoryTransactionForm(current => ({ ...current, itemName: event.target.value }))} /></Field><Field label="计量单位"><Input value={inventoryTransactionForm.unit} maxLength={32} placeholder="例如：袋、吨、件" onChange={event => setInventoryTransactionForm(current => ({ ...current, unit: event.target.value }))} /></Field></div><div className="grid gap-4 sm:grid-cols-3"><Field label="数量"><Input type="number" min="0.001" step="0.001" value={inventoryTransactionForm.quantity} onChange={event => setInventoryTransactionForm(current => ({ ...current, quantity: event.target.value }))} /></Field><Field label="单价（元）"><Input type="number" min="0" step="0.01" value={inventoryTransactionForm.unitCost} onChange={event => setInventoryTransactionForm(current => ({ ...current, unitCost: event.target.value }))} /></Field><Field label="发生时间"><Input type="datetime-local" value={inventoryTransactionForm.occurredAt} onChange={event => setInventoryTransactionForm(current => ({ ...current, occurredAt: event.target.value }))} /></Field></div><Field label="备注"><Textarea value={inventoryTransactionForm.remarks} maxLength={500} placeholder="可填写领用班组、存放位置、单据号或退库原因" onChange={event => setInventoryTransactionForm(current => ({ ...current, remarks: event.target.value }))} /></Field><DialogFooter><Button type="button" variant="outline" onClick={() => setInventoryTransactionDialogOpen(false)}>取消</Button><Button type="submit" disabled={!inventoryTransactionForm.projectId || !inventoryTransactionForm.itemName.trim() || !inventoryTransactionForm.unit.trim() || !Number.isFinite(Number(inventoryTransactionForm.quantity)) || Number(inventoryTransactionForm.quantity) <= 0 || !Number.isFinite(Number(inventoryTransactionForm.unitCost)) || Number(inventoryTransactionForm.unitCost) < 0 || !inventoryTransactionForm.occurredAt || saveInventoryTransaction.isPending}>{saveInventoryTransaction.isPending ? "正在登记…" : `确认${transactionLabel(inventoryTransactionForm.transactionType)}`}</Button></DialogFooter></form></DialogContent></Dialog>
    </div>;
  };

  const renderSubcontract = () => {
    const teams = subcontractTeams.data ?? [];
    const packages = subcontractPackages.data ?? [];
    const summary = subcontractSummary.data;
    const takeoffs = (subcontractTakeoffs.data ?? []).filter(item => ["approved", "locked"].includes(item.status));
    const capabilities = subcontractCapabilities.data;
    const summaryByStatus = new Map((summary?.byStatus ?? []).map(item => [item.status, item]));
    const linkedTakeoff = subcontractPackageForm.measurementTakeoffId ? takeoffs.find(item => String(item.id) === subcontractPackageForm.measurementTakeoffId) : undefined;
    const amountPreview = {
      upstream: Number(subcontractPackageForm.quantity || 0) * Number(subcontractPackageForm.upstreamUnitPrice || 0),
      subcontract: Number(subcontractPackageForm.quantity || 0) * Number(subcontractPackageForm.subcontractUnitPrice || 0),
    };
    const openTeamEditor = (team?: typeof teams[number]) => {
      setSubcontractTeamForm(team ? { id: Number(team.id), projectId: String(team.projectId), teamName: team.teamName, contactName: team.contactName ?? "", contactPhone: "", status: team.status, remarks: team.remarks ?? "" } : { ...EMPTY_SUBCONTRACT_TEAM_FORM, projectId: String(workspaceProjectId) });
      setSubcontractTeamDialogOpen(true);
    };
    const openPackageEditor = (item?: typeof packages[number]) => {
      setSubcontractPackageForm(item ? {
        id: Number(item.id), projectId: String(item.projectId), measurementTakeoffId: item.measurementTakeoffId ? String(item.measurementTakeoffId) : "", subcontractTeamId: String(item.subcontractTeamId), workItem: item.workItem, workLocation: item.workLocation ?? "", unit: item.unit, quantity: String(item.quantity), upstreamUnitPrice: String(item.upstreamUnitPrice), subcontractUnitPrice: String(item.subcontractUnitPrice), priceExceptionReason: item.priceExceptionReason ?? "", remarks: item.remarks ?? "",
      } : { ...EMPTY_SUBCONTRACT_PACKAGE_FORM, projectId: String(workspaceProjectId) });
      setSubcontractPackageDialogOpen(true);
    };
    const openTakeoffEditor = () => {
      setMeasurementTakeoffForm({ ...EMPTY_MEASUREMENT_TAKEOFF_FORM, projectId: String(workspaceProjectId), takeoffDate: toLocalDateInput() });
      setMeasurementTakeoffDialogOpen(true);
    };
    const setLinkedTakeoff = (value: string) => {
      if (value === "UNLINKED") {
        setSubcontractPackageForm(current => ({ ...current, measurementTakeoffId: "" }));
        return;
      }
      const takeoff = takeoffs.find(item => String(item.id) === value);
      if (!takeoff) return;
      setSubcontractPackageForm(current => ({ ...current, measurementTakeoffId: value, workItem: takeoff.workItem, workLocation: takeoff.workLocation ?? "", unit: takeoff.unit, quantity: String(takeoff.quantity), upstreamUnitPrice: String(takeoff.unitPrice) }));
    };
    const statusDescription = (status: string) => status === "draft" ? "草稿，尚未向施工队下达" : status === "allocated" ? "已分配，待计量/项目复核" : status === "confirmed" ? "已确认，须在分包应付结算台账完成付款" : status === "settled" ? "已付款结算，金额快照已锁定" : "已作废，不计入有效测算";
    return (
      <div className="space-y-6">
	        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-medium text-[#203c48]">工程结算与分包 · 真实业务台账</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">工程量分包与结算测算</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">以项目部已审核或已锁定收方为工程量依据，按施工队拆分批次，并在服务端固化上游金额、分包金额和测算差额。分配、复核和结算由不同岗位办理，已结算批次不可修改。</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setLocation("/admin/measurement-tools")}>打开计量工具</Button><Button variant="outline" onClick={openTakeoffEditor} disabled={!hasBusinessWorkspaceProject || !measurementTakeoffCapabilities.data?.canSubmit}>项目部工程量录入</Button><Button variant="outline" onClick={() => openTeamEditor()} disabled={!hasBusinessWorkspaceProject || !capabilities?.canMaintainDraft}>维护施工队</Button><Button onClick={() => openPackageEditor()} disabled={!hasBusinessWorkspaceProject || !capabilities?.canMaintainDraft || !teams.some(team => team.status === "active")}>新建分包批次</Button></div></div>
        {renderWorkspaceProjectFilter("分包项目范围", "选择项目后，读取该项目施工队、已审核工程量收方和分包批次。未选择项目不会加载或展示工程量与金额数据。")}
        {hasBusinessWorkspaceProject ? <SubcontractPaymentSettlementManager projectId={workspaceProjectId} /> : null}
        {!hasBusinessWorkspaceProject ? <EmptyState text="请先选择已授权项目，以读取施工队、收方工程量和分包结算台账。" /> : subcontractTeams.isLoading || subcontractPackages.isLoading || subcontractSummary.isLoading || subcontractTakeoffs.isLoading ? <EmptyState text="正在读取工程结算与分包台账…" /> : subcontractTeams.isError || subcontractPackages.isError || subcontractSummary.isError || subcontractTakeoffs.isError ? <EmptyState text="暂无法读取工程结算与分包数据，请确认当前账号的计量/财务部门、岗位与项目范围授权。" /> : <>
	          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><MetricCard title="有效上游金额" value={`¥${displayMoney(summary?.upstreamAmount ?? 0)}`} description="不含已作废分包批次" icon={BarChart3} /><MetricCard title="有效分包金额" value={`¥${displayMoney(summary?.subcontractAmount ?? 0)}`} description={`共 ${summary?.packageCount ?? 0} 个有效批次`} icon={UsersRound} /><MetricCard title="测算差额" value={`¥${displayMoney(summary?.marginAmount ?? 0)}`} description="上游金额 − 分包金额" icon={FolderKanban} /><MetricCard title="待财务结算" value={summaryByStatus.get("confirmed")?.packageCount ?? 0} description={`已结算 ${summaryByStatus.get("settled")?.packageCount ?? 0} 个批次`} icon={ShieldCheck} /></section>
	          <Dialog open={measurementTakeoffDialogOpen} onOpenChange={open => { setMeasurementTakeoffDialogOpen(open); if (!open) setMeasurementTakeoffForm(EMPTY_MEASUREMENT_TAKEOFF_FORM); }}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>项目部工程量收方录入</DialogTitle><DialogDescription>保存后形成项目部收方草稿；由计量/项目负责人提交、复核后，才能在分包批次中关联分配。工程量与上游单价由服务端重新计算申报金额。</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={event => { event.preventDefault(); saveMeasurementTakeoff.mutate({ id: measurementTakeoffForm.id, projectId: Number(measurementTakeoffForm.projectId), measurementClaimId: null, workItem: measurementTakeoffForm.workItem.trim(), workLocation: measurementTakeoffForm.workLocation.trim(), unit: measurementTakeoffForm.unit, quantity: Number(measurementTakeoffForm.quantity), unitPrice: Number(measurementTakeoffForm.unitPrice), takeoffDate: measurementTakeoffForm.takeoffDate }); }}><div className="grid gap-4 md:grid-cols-2"><Field label="当前项目"><Input value={selectedWorkspaceProject?.name ?? ""} disabled /></Field><Field label="收方日期"><Input type="date" value={measurementTakeoffForm.takeoffDate} onChange={event => setMeasurementTakeoffForm(current => ({ ...current, takeoffDate: event.target.value }))} /></Field></div><div className="grid gap-4 md:grid-cols-2"><Field label="工程项目"><Input value={measurementTakeoffForm.workItem} maxLength={200} placeholder="例如：K12+340 圆管涵 C20 混凝土" onChange={event => setMeasurementTakeoffForm(current => ({ ...current, workItem: event.target.value }))} /></Field><Field label="里程 / 作业位置"><Input value={measurementTakeoffForm.workLocation} maxLength={200} placeholder="例如：K12+340 左侧" onChange={event => setMeasurementTakeoffForm(current => ({ ...current, workLocation: event.target.value }))} /></Field></div><div className="grid gap-4 md:grid-cols-3"><Field label="计量单位"><Select value={measurementTakeoffForm.unit} onValueChange={value => setMeasurementTakeoffForm(current => ({ ...current, unit: value as MeasurementTakeoffForm["unit"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="m3">m³</SelectItem><SelectItem value="m2">m²</SelectItem><SelectItem value="m">m</SelectItem><SelectItem value="t">t</SelectItem><SelectItem value="piece">件</SelectItem><SelectItem value="set">套</SelectItem><SelectItem value="other">其他</SelectItem></SelectContent></Select></Field><Field label="工程量"><Input type="number" min="0.001" step="0.001" value={measurementTakeoffForm.quantity} placeholder="输入收方量" onChange={event => setMeasurementTakeoffForm(current => ({ ...current, quantity: event.target.value }))} /></Field><Field label="业主单价（元）"><Input type="number" min="0" step="0.01" value={measurementTakeoffForm.unitPrice} placeholder="输入上游单价" onChange={event => setMeasurementTakeoffForm(current => ({ ...current, unitPrice: event.target.value }))} /></Field></div><div className="rounded-xl border border-[#d8e3e0] bg-[#f5f9f8] p-4"><p className="text-xs text-slate-500">收方申报金额（服务端复算）</p><p className="mt-1 text-xl font-semibold text-[#203c48]">¥{displayMoney(Number(measurementTakeoffForm.quantity || 0) * Number(measurementTakeoffForm.unitPrice || 0))}</p></div><DialogFooter><Button type="button" variant="outline" onClick={() => setMeasurementTakeoffDialogOpen(false)}>取消</Button><Button type="submit" disabled={!measurementTakeoffForm.projectId || measurementTakeoffForm.workItem.trim().length < 2 || measurementTakeoffForm.workLocation.trim().length < 2 || !measurementTakeoffForm.takeoffDate || !Number.isFinite(Number(measurementTakeoffForm.quantity)) || Number(measurementTakeoffForm.quantity) <= 0 || !Number.isFinite(Number(measurementTakeoffForm.unitPrice)) || Number(measurementTakeoffForm.unitPrice) < 0 || saveMeasurementTakeoff.isPending}>{saveMeasurementTakeoff.isPending ? "正在保存…" : "保存收方草稿"}</Button></DialogFooter></form></DialogContent></Dialog>
	          <Card className="border-[#d8e3e0]"><CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0"><div><CardTitle className="text-base">施工队台账</CardTitle><CardDescription>施工队联系人电话仅以加密和脱敏形式保存；停用或关闭的施工队不可承接新的分包批次，但保留历史结算责任链。</CardDescription></div><Button size="sm" variant="outline" onClick={() => subcontractTeams.refetch()} disabled={subcontractTeams.isFetching}>刷新施工队</Button></CardHeader><CardContent><div className="overflow-x-auto rounded-xl border border-[#e1e8e4]"><Table className="min-w-[860px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow><TableHead>施工队</TableHead><TableHead>联系人</TableHead><TableHead>联系电话</TableHead><TableHead>状态</TableHead><TableHead>备注</TableHead><TableHead>更新时间</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>{teams.length ? teams.map(team => <TableRow key={team.id}><TableCell className="font-medium text-[#203c48]">{team.teamName}</TableCell><TableCell>{team.contactName || "—"}</TableCell><TableCell>{team.contactPhoneMasked || "未登记"}</TableCell><TableCell><BusinessStatusBadge status={team.status} /></TableCell><TableCell className="max-w-[220px] truncate">{team.remarks || "—"}</TableCell><TableCell>{displayDate(team.updatedAt)}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => openTeamEditor(team)} disabled={!capabilities?.canMaintainDraft}>编辑</Button></TableCell></TableRow>) : <TableRow><TableCell colSpan={7} className="h-24 text-center text-slate-500">当前项目尚无施工队台账。请先建立施工队，再按批次分配工程量。</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
          <Card className="border-[#d8e3e0]"><CardHeader className="flex flex-wrap items-end justify-between gap-3 space-y-0"><div><CardTitle className="text-base">分包批次与金额测算台账</CardTitle><CardDescription>每个批次保存工程量、上游单价、分包单价和测算差额；关联收方后，仅已审核或锁定工程量可分配，且累计分配量不能超过收方工程量。</CardDescription></div><div className="flex flex-wrap gap-2"><Select value={subcontractTeamFilter} onValueChange={setSubcontractTeamFilter}><SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部施工队</SelectItem>{teams.map(team => <SelectItem key={team.id} value={String(team.id)}>{team.teamName}</SelectItem>)}</SelectContent></Select><Select value={subcontractStatusFilter} onValueChange={setSubcontractStatusFilter}><SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="draft">草稿</SelectItem><SelectItem value="allocated">已分配</SelectItem><SelectItem value="confirmed">已确认</SelectItem><SelectItem value="settled">已结算</SelectItem><SelectItem value="void">已作废</SelectItem></SelectContent></Select><Button size="sm" variant="outline" onClick={() => Promise.all([subcontractPackages.refetch(), subcontractSummary.refetch(), subcontractTakeoffs.refetch()])} disabled={subcontractPackages.isFetching}>刷新台账</Button></div></CardHeader><CardContent><div className="overflow-x-auto rounded-xl border border-[#e1e8e4]"><Table className="min-w-[1380px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow><TableHead>批次 / 施工队</TableHead><TableHead>关联收方</TableHead><TableHead>工作项 / 位置</TableHead><TableHead>工程量</TableHead><TableHead>上游金额</TableHead><TableHead>分包金额</TableHead><TableHead>测算差额</TableHead><TableHead>状态</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>{packages.length ? packages.map(item => <TableRow key={item.id}><TableCell><p className="font-semibold text-[#203c48]">{item.packageNo}</p><p className="mt-1 text-slate-500">{item.teamName}</p></TableCell><TableCell>{item.takeoffNo ? <><p>{item.takeoffNo}</p><p className="mt-1 text-slate-500">{item.takeoffStatus === "locked" ? "已锁定收方" : "已审核收方"}</p></> : "独立分包测算"}</TableCell><TableCell className="max-w-[240px]"><p className="font-medium">{item.workItem}</p><p className="mt-1 truncate text-slate-500">{item.workLocation || "未登记位置"}</p></TableCell><TableCell>{displayMoney(item.quantity)} {item.unit}</TableCell><TableCell><p>¥{displayMoney(item.upstreamAmount)}</p><p className="mt-1 text-slate-500">¥{displayMoney(item.upstreamUnitPrice)}/{item.unit}</p></TableCell><TableCell><p>¥{displayMoney(item.subcontractAmount)}</p><p className="mt-1 text-slate-500">¥{displayMoney(item.subcontractUnitPrice)}/{item.unit}</p></TableCell><TableCell className={Number(item.marginAmount) >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>¥{displayMoney(item.marginAmount)}</TableCell><TableCell><BusinessStatusBadge status={item.status} /></TableCell><TableCell className="text-right"><div className="flex justify-end gap-1"><Button size="sm" variant="outline" onClick={() => setDesktopRecordDetail({ title: `分包批次详情 · ${item.packageNo}`, description: statusDescription(item.status), fields: [{ label: "施工队", value: item.teamName }, { label: "关联收方", value: item.takeoffNo || "未关联" }, { label: "工程量", value: `${displayMoney(item.quantity)} ${item.unit}` }, { label: "上游金额", value: `¥ ${displayMoney(item.upstreamAmount)}` }, { label: "分包金额", value: `¥ ${displayMoney(item.subcontractAmount)}` }, { label: "测算差额", value: `¥ ${displayMoney(item.marginAmount)}` }, { label: "备注", value: item.remarks || "—" }] })}>详情</Button>{item.status === "draft" ? <Button size="sm" variant="outline" onClick={() => openPackageEditor(item)} disabled={!capabilities?.canMaintainDraft}>编辑</Button> : null}{item.status === "draft" && capabilities?.canMaintainDraft ? <Button size="sm" onClick={() => transitionSubcontractPackage.mutate({ id: Number(item.id), projectId: workspaceProjectId, targetStatus: "allocated", remarks: null })} disabled={transitionSubcontractPackage.isPending}>分配</Button> : null}{item.status === "allocated" && capabilities?.canConfirm ? <Button size="sm" onClick={() => transitionSubcontractPackage.mutate({ id: Number(item.id), projectId: workspaceProjectId, targetStatus: "confirmed", remarks: null })} disabled={transitionSubcontractPackage.isPending}>复核确认</Button> : null}{item.status === "confirmed" && capabilities?.canSettle ? <Button size="sm" onClick={() => transitionSubcontractPackage.mutate({ id: Number(item.id), projectId: workspaceProjectId, targetStatus: "settled", remarks: null })} disabled={transitionSubcontractPackage.isPending}>财务结算</Button> : null}{["draft", "allocated", "confirmed"].includes(item.status) ? <Button size="sm" variant="outline" className="border-rose-200 text-rose-700" onClick={() => transitionSubcontractPackage.mutate({ id: Number(item.id), projectId: workspaceProjectId, targetStatus: "void", remarks: "后台作废" })} disabled={transitionSubcontractPackage.isPending || (item.status === "confirmed" ? !capabilities?.canSettle : !(capabilities?.canMaintainDraft || capabilities?.canConfirm))}>作废</Button> : null}</div></TableCell></TableRow>) : <TableRow><TableCell colSpan={9} className="h-24 text-center text-slate-500">当前筛选范围暂无分包批次。请先维护施工队，再关联已审核收方或建立独立分包测算草稿。</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
        </>}
        <Dialog open={subcontractTeamDialogOpen} onOpenChange={open => { setSubcontractTeamDialogOpen(open); if (!open) setSubcontractTeamForm(EMPTY_SUBCONTRACT_TEAM_FORM); }}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>{subcontractTeamForm.id ? "维护施工队台账" : "新建施工队台账"}</DialogTitle><DialogDescription>联系人电话号码在服务端加密保存，后台列表仅显示脱敏号码；停用施工队不会影响历史分包批次。</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={event => { event.preventDefault(); saveSubcontractTeam.mutate({ id: subcontractTeamForm.id, projectId: Number(subcontractTeamForm.projectId), teamName: subcontractTeamForm.teamName.trim(), contactName: subcontractTeamForm.contactName.trim() || null, contactPhone: subcontractTeamForm.contactPhone.trim() || undefined, status: subcontractTeamForm.status, remarks: subcontractTeamForm.remarks.trim() || null }); }}><div className="grid gap-4 sm:grid-cols-2"><Field label="所属项目"><Input value={selectedWorkspaceProject?.name ?? ""} disabled /></Field><Field label="施工队状态"><Select value={subcontractTeamForm.status} onValueChange={value => setSubcontractTeamForm(current => ({ ...current, status: value as SubcontractTeamForm["status"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">启用</SelectItem><SelectItem value="suspended">暂停</SelectItem><SelectItem value="closed">已关闭</SelectItem></SelectContent></Select></Field></div><div className="grid gap-4 sm:grid-cols-2"><Field label="施工队名称"><Input value={subcontractTeamForm.teamName} maxLength={200} placeholder="例如：路基一队" onChange={event => setSubcontractTeamForm(current => ({ ...current, teamName: event.target.value }))} /></Field><Field label="联系人姓名"><Input value={subcontractTeamForm.contactName} maxLength={100} placeholder="可选" onChange={event => setSubcontractTeamForm(current => ({ ...current, contactName: event.target.value }))} /></Field></div><Field label={subcontractTeamForm.id ? "联系人电话（留空保持原号码）" : "联系人电话（可选）"}><Input value={subcontractTeamForm.contactPhone} inputMode="tel" maxLength={32} placeholder={subcontractTeamForm.id ? "已加密保存；如需更新请输入新号码" : "例如 13800000000"} onChange={event => setSubcontractTeamForm(current => ({ ...current, contactPhone: event.target.value }))} /></Field><Field label="备注"><Textarea value={subcontractTeamForm.remarks} maxLength={500} placeholder="可填写班组能力、合同或现场协作说明" onChange={event => setSubcontractTeamForm(current => ({ ...current, remarks: event.target.value }))} /></Field><DialogFooter><Button type="button" variant="outline" onClick={() => setSubcontractTeamDialogOpen(false)}>取消</Button><Button type="submit" disabled={!subcontractTeamForm.projectId || subcontractTeamForm.teamName.trim().length < 2 || saveSubcontractTeam.isPending}>{saveSubcontractTeam.isPending ? "正在保存…" : "保存施工队"}</Button></DialogFooter></form></DialogContent></Dialog>
        <Dialog open={subcontractPackageDialogOpen} onOpenChange={open => { setSubcontractPackageDialogOpen(open); if (!open) setSubcontractPackageForm(EMPTY_SUBCONTRACT_PACKAGE_FORM); }}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{subcontractPackageForm.id ? "维护分包批次草稿" : "新建分包批次"}</DialogTitle><DialogDescription>关联收方时，系统锁定收方的工作项、位置、单位、工程量与上游单价，并校验累计分配量；金额和测算差额均由服务端重新计算。</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={event => { event.preventDefault(); saveSubcontractPackage.mutate({ id: subcontractPackageForm.id, projectId: Number(subcontractPackageForm.projectId), measurementTakeoffId: subcontractPackageForm.measurementTakeoffId ? Number(subcontractPackageForm.measurementTakeoffId) : null, subcontractTeamId: Number(subcontractPackageForm.subcontractTeamId), workItem: subcontractPackageForm.workItem.trim(), workLocation: subcontractPackageForm.workLocation.trim() || null, unit: subcontractPackageForm.unit, quantity: Number(subcontractPackageForm.quantity), upstreamUnitPrice: Number(subcontractPackageForm.upstreamUnitPrice), subcontractUnitPrice: Number(subcontractPackageForm.subcontractUnitPrice), remarks: subcontractPackageForm.remarks.trim() || null }); }}><div className="grid gap-4 md:grid-cols-2"><Field label="承接施工队"><Select value={subcontractPackageForm.subcontractTeamId || "UNASSIGNED"} onValueChange={value => setSubcontractPackageForm(current => ({ ...current, subcontractTeamId: value === "UNASSIGNED" ? "" : value }))}><SelectTrigger><SelectValue placeholder="选择启用施工队" /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">请选择施工队</SelectItem>{teams.filter(team => team.status === "active").map(team => <SelectItem key={team.id} value={String(team.id)}>{team.teamName}</SelectItem>)}</SelectContent></Select></Field><Field label="关联项目收方（可选）"><Select value={subcontractPackageForm.measurementTakeoffId || "UNLINKED"} onValueChange={setLinkedTakeoff}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UNLINKED">不关联，独立测算</SelectItem>{takeoffs.map(takeoff => <SelectItem key={takeoff.id} value={String(takeoff.id)}>{takeoff.takeoffNo} · {takeoff.workItem} · 可分配 {displayMoney(takeoff.quantity)} {takeoff.unit}</SelectItem>)}</SelectContent></Select></Field></div><div className="grid gap-4 md:grid-cols-2"><Field label="分包工作项"><Input value={subcontractPackageForm.workItem} disabled={Boolean(linkedTakeoff)} maxLength={200} onChange={event => setSubcontractPackageForm(current => ({ ...current, workItem: event.target.value }))} /></Field><Field label="施工位置"><Input value={subcontractPackageForm.workLocation} disabled={Boolean(linkedTakeoff)} maxLength={200} placeholder="可选" onChange={event => setSubcontractPackageForm(current => ({ ...current, workLocation: event.target.value }))} /></Field></div><div className="grid gap-4 md:grid-cols-4"><Field label="计量单位"><Select value={subcontractPackageForm.unit} disabled={Boolean(linkedTakeoff)} onValueChange={value => setSubcontractPackageForm(current => ({ ...current, unit: value as SubcontractPackageForm["unit"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="m3">m³</SelectItem><SelectItem value="m2">m²</SelectItem><SelectItem value="m">m</SelectItem><SelectItem value="t">t</SelectItem><SelectItem value="piece">件</SelectItem><SelectItem value="set">套</SelectItem><SelectItem value="other">其他</SelectItem></SelectContent></Select></Field><Field label="工程量"><Input type="number" min="0.001" step="0.001" value={subcontractPackageForm.quantity} disabled={Boolean(linkedTakeoff)} onChange={event => setSubcontractPackageForm(current => ({ ...current, quantity: event.target.value }))} /></Field><Field label="上游单价（元）"><Input type="number" min="0" step="0.01" value={subcontractPackageForm.upstreamUnitPrice} disabled={Boolean(linkedTakeoff)} onChange={event => setSubcontractPackageForm(current => ({ ...current, upstreamUnitPrice: event.target.value }))} /></Field><Field label="分包单价（元）"><Input type="number" min="0" step="0.01" value={subcontractPackageForm.subcontractUnitPrice} onChange={event => setSubcontractPackageForm(current => ({ ...current, subcontractUnitPrice: event.target.value }))} /></Field></div><div className="grid gap-3 rounded-xl border border-[#d8e3e0] bg-[#f5f9f8] p-4 sm:grid-cols-3"><div><p className="text-xs text-slate-500">上游金额测算</p><p className="mt-1 text-lg font-semibold text-[#203c48]">¥{displayMoney(amountPreview.upstream)}</p></div><div><p className="text-xs text-slate-500">分包金额测算</p><p className="mt-1 text-lg font-semibold text-[#203c48]">¥{displayMoney(amountPreview.subcontract)}</p></div><div><p className="text-xs text-slate-500">测算差额</p><p className={`mt-1 text-lg font-semibold ${amountPreview.upstream - amountPreview.subcontract >= 0 ? "text-emerald-700" : "text-rose-700"}`}>¥{displayMoney(amountPreview.upstream - amountPreview.subcontract)}</p></div></div><Field label="备注"><Textarea value={subcontractPackageForm.remarks} maxLength={500} placeholder="可填写分包边界、质量要求或结算说明" onChange={event => setSubcontractPackageForm(current => ({ ...current, remarks: event.target.value }))} /></Field><DialogFooter><Button type="button" variant="outline" onClick={() => setSubcontractPackageDialogOpen(false)}>取消</Button><Button type="submit" disabled={!subcontractPackageForm.projectId || !subcontractPackageForm.subcontractTeamId || subcontractPackageForm.workItem.trim().length < 2 || !Number.isFinite(Number(subcontractPackageForm.quantity)) || Number(subcontractPackageForm.quantity) <= 0 || !Number.isFinite(Number(subcontractPackageForm.upstreamUnitPrice)) || Number(subcontractPackageForm.upstreamUnitPrice) < 0 || !Number.isFinite(Number(subcontractPackageForm.subcontractUnitPrice)) || Number(subcontractPackageForm.subcontractUnitPrice) < 0 || saveSubcontractPackage.isPending}>{saveSubcontractPackage.isPending ? "正在保存…" : "保存分包草稿"}</Button></DialogFooter></form></DialogContent></Dialog>
      </div>
    );
  };

  const renderLabor = () => {
    const workers = laborWorkers.data ?? [];
    const attendance = laborAttendance.data ?? [];
    const workerById = new Map(workers.map(worker => [worker.id, worker]));
    const attendanceTeams = Array.from(new Set(attendance.map(item => item.teamName || "未设置班组"))).sort();
    const visibleAttendance = attendance.filter(item => {
      const worker = workerById.get(item.workerId);
      const keyword = laborAttendanceFilter.workerName.trim().toLowerCase();
      return (!keyword || [item.workerName, item.teamName, worker?.realName].some(value => String(value ?? "").toLowerCase().includes(keyword))) && (laborAttendanceFilter.team === "all" || (item.teamName || "未设置班组") === laborAttendanceFilter.team) && (laborAttendanceFilter.category === "all" || worker?.workerCategory === laborAttendanceFilter.category) && (laborAttendanceFilter.status === "all" || item.status === laborAttendanceFilter.status);
    });
    const payrolls = payrollStatements.data ?? [];
    const dailyWages = laborDailyWages.data ?? [];
    const checkIns = laborCheckIns.data ?? [];
    const visiblePayrolls = payrolls.filter(item => {
      const keyword = laborPayrollSearch.trim().toLowerCase();
      return (!keyword || [item.workerName, item.teamName, item.period, item.status].some(value => String(value ?? "").toLowerCase().includes(keyword))) && (laborPayrollTeam === "all" || (item.teamName || "未设置班组") === laborPayrollTeam) && (laborPayrollStatus === "all" || item.status === laborPayrollStatus);
    });
    const payrollSummary = visiblePayrolls.reduce((summary, item) => ({ payable: summary.payable + Number(item.payableAmount || 0), deduction: summary.deduction + Number(item.deductionAmount || 0), actual: summary.actual + Number(item.actualAmount || 0), approved: summary.approved + (item.status === "approved" ? Number(item.actualAmount || 0) : 0), paid: summary.paid + (item.status === "paid" ? Number(item.actualAmount || 0) : 0), pending: summary.pending + (["draft", "reviewing"].includes(item.status) ? Number(item.actualAmount || 0) : 0) }), { payable: 0, deduction: 0, actual: 0, approved: 0, paid: 0, pending: 0 });
    const summarizeAmounts = (records: Array<{ payableAmount: string | number; deductionAmount: string | number; actualAmount: string | number; status: string }>) => records.reduce((summary, item) => ({ payable: summary.payable + Number(item.payableAmount || 0), deduction: summary.deduction + Number(item.deductionAmount || 0), actual: summary.actual + Number(item.actualAmount || 0), approved: summary.approved + (item.status === "approved" ? Number(item.actualAmount || 0) : 0), paid: summary.paid + (item.status === "paid" ? Number(item.actualAmount || 0) : 0) }), { payable: 0, deduction: 0, actual: 0, approved: 0, paid: 0 });
    const companyPayrollSummary = summarizeAmounts(visiblePayrolls.filter(item => workerById.get(item.workerId)?.workerCategory === "company_admin"));
    const laborTeamPayrollSummary = summarizeAmounts(visiblePayrolls.filter(item => workerById.get(item.workerId)?.workerCategory === "labor_team"));
    const temporaryDailySummary = summarizeAmounts(dailyWages);
    const laborTeamAuditRows = Array.from(new Set(visiblePayrolls.filter(item => workerById.get(item.workerId)?.workerCategory === "labor_team").map(item => item.teamName || "未设置班组"))).sort().map(teamName => ({ teamName, summary: summarizeAmounts(visiblePayrolls.filter(item => workerById.get(item.workerId)?.workerCategory === "labor_team" && (item.teamName || "未设置班组") === teamName)) }));
    const payrollTeams = Array.from(new Set(payrolls.map(item => item.teamName || "未设置班组"))).sort();
    const dailyWageSummary = dailyWages.reduce((summary, item) => ({ actual: summary.actual + Number(item.actualAmount || 0), reviewing: summary.reviewing + (item.status === "reviewing" ? 1 : 0), approved: summary.approved + (item.status === "approved" ? 1 : 0), paid: summary.paid + (item.status === "paid" ? 1 : 0) }), { actual: 0, reviewing: 0, approved: 0, paid: 0 });
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-medium text-[#203c48]">劳务工资 · 真实业务台账</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">实名制、考勤与工资条</h1><p className="mt-2 max-w-3xl text-sm text-slate-500">人员证件、手机号和银行卡均由服务端脱敏后返回；工资发放只保存付款凭证引用，不会在系统内发起转账。档案和工资条详情均在当前 PC 台账中查看。</p></div></div>
        {renderWorkspaceProjectFilter("劳务项目范围", "选择项目后按真实人员、考勤和工资条加载。每个工资状态操作仍由劳务、会计和财务角色在服务端二次核验。")}
        {!hasBusinessWorkspaceProject ? <EmptyState text="请先选择已授权项目，以读取真实劳务工资台账。" /> : laborWorkers.isLoading || laborAttendance.isLoading || laborCheckIns.isLoading || payrollStatements.isLoading ? <EmptyState text="正在读取实名制、上下班考勤和工资条数据…" /> : laborWorkers.isError || laborAttendance.isError || laborCheckIns.isError || payrollStatements.isError ? <EmptyState text="暂无法读取劳务工资数据，请确认当前账号的服务端授权后重试。" /> : (
          <>
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><MetricCard title="实名制人员" value={workers.length} description="已按敏感字段脱敏" icon={UsersRound} /><MetricCard title="在场人员" value={workers.filter(item => item.attendanceStatus === "active").length} description="可计入当前项目考勤" icon={ShieldCheck} /><MetricCard title="今日已上班" value={checkIns.length} description={`${checkIns.filter(item => item.checkedOutAt).length} 人已完成下班打卡`} icon={ScrollText} /><MetricCard title="待会计处理" value={payrolls.filter(item => item.status === "reviewing").length} description="审核中工资条" icon={BarChart3} /></section>
            <Card className="border-[#d8e3e0]">
              <CardHeader className="flex flex-wrap items-end justify-between gap-3 space-y-0">
                <div><CardTitle className="text-base">全员上下班考勤台账</CardTitle><CardDescription>管理员、操作员等登录人员的上班/下班打卡统一在此核验；施工队工人无账号时继续由劳资人员在下方考勤工时台账录入。业务台账只显示中文详细地址，原始坐标须走争议核验留痕流程。</CardDescription></div>
                <div className="flex flex-wrap gap-2"><Input aria-label="考勤日期" className="w-[160px]" type="date" value={laborAttendanceDate} onChange={event => setLaborAttendanceDate(event.target.value)} /><Button size="sm" variant="outline" disabled={!checkIns.length} onClick={() => downloadCsvFile(`上下班考勤-${laborAttendanceDate || toLocalDateInput()}.csv`, ["人员", "日期", "上班时间", "下班时间", "上班打卡位置（中文地址）", "下班打卡位置（中文地址）", "定位复核", "设备"], checkIns.map(item => [item.userName || `用户 #${item.userId}`, displayDate(item.businessDate), displayDate(item.checkedInAt), item.checkedOutAt ? displayDate(item.checkedOutAt) : "未打卡", formatAttendanceLocation(item.checkInAddress, item.status), item.checkedOutAt ? formatAttendanceLocation(item.checkoutAddress, item.checkoutStatus) : "未打卡", `${item.status === "normal" ? "上班定位正常" : "上班缺少定位"}${item.checkoutStatus ? ` · ${item.checkoutStatus === "normal" ? "下班定位正常" : "下班缺少定位"}` : ""}`, item.deviceLabel || "未记录"]))}>导出 CSV</Button></div>
              </CardHeader>
              <CardContent><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>人员</TableHead><TableHead>考勤日期</TableHead><TableHead>上班打卡</TableHead><TableHead>下班打卡</TableHead><TableHead>上班位置（中文地址）</TableHead><TableHead>下班位置（中文地址）</TableHead><TableHead>定位复核</TableHead><TableHead>设备</TableHead></TableRow></TableHeader><TableBody>{checkIns.length ? checkIns.map(item => <TableRow key={item.id}><TableCell className="font-medium">{item.userName || `用户 #${item.userId}`}</TableCell><TableCell>{displayDate(item.businessDate)}</TableCell><TableCell>{displayDate(item.checkedInAt)}</TableCell><TableCell>{item.checkedOutAt ? displayDate(item.checkedOutAt) : <span className="text-amber-700">待下班打卡</span>}</TableCell><TableCell className="min-w-[168px] text-xs text-slate-600">{formatAttendanceLocation(item.checkInAddress, item.status)}</TableCell><TableCell className="min-w-[168px] text-xs text-slate-600">{item.checkedOutAt ? formatAttendanceLocation(item.checkoutAddress, item.checkoutStatus) : <span className="text-amber-700">待下班打卡</span>}</TableCell><TableCell><span className={item.status === "normal" && (!item.checkoutStatus || item.checkoutStatus === "normal") ? "text-emerald-700" : "text-amber-700"}>{item.status === "normal" ? "上班定位正常" : "上班缺少定位"}{item.checkoutStatus ? ` · ${item.checkoutStatus === "normal" ? "下班定位正常" : "下班缺少定位"}` : ""}</span></TableCell><TableCell className="text-xs text-slate-500">{item.deviceLabel || "未记录"}</TableCell></TableRow>) : <TableRow><TableCell colSpan={8} className="h-24 text-center text-sm text-slate-500">所选日期暂无登录人员上下班打卡记录。</TableCell></TableRow>}</TableBody></Table></div></CardContent>
            </Card>
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><MetricCard title="当前筛选应发总额" value={`¥${displayMoney(payrollSummary.payable)}`} description={`扣款 ¥${displayMoney(payrollSummary.deduction)} · 实发 ¥${displayMoney(payrollSummary.actual)}`} icon={BarChart3} /><MetricCard title="待处理金额" value={`¥${displayMoney(payrollSummary.pending)}`} description="草稿及会计审核中" icon={ScrollText} /><MetricCard title="已结算金额" value={`¥${displayMoney(payrollSummary.paid)}`} description={`已审核待付款 ¥${displayMoney(payrollSummary.approved)}`} icon={ShieldCheck} /></section>
            <Card className="border-[#d8e3e0]"><CardHeader><CardTitle className="text-base">人员分类与劳务队审计汇总</CardTitle><CardDescription>公司管理人员、劳务队人员和临时日结分口径汇总；金额均来自当前项目、工资期间和筛选范围内的真实服务端记录。</CardDescription></CardHeader><CardContent className="space-y-4"><section className="grid gap-3 md:grid-cols-3"><MetricCard title="公司管理人员" value={`¥${displayMoney(companyPayrollSummary.actual)}`} description={`应发 ¥${displayMoney(companyPayrollSummary.payable)} · 已付款 ¥${displayMoney(companyPayrollSummary.paid)}`} icon={UsersRound} /><MetricCard title="劳务队人员" value={`¥${displayMoney(laborTeamPayrollSummary.actual)}`} description={`应发 ¥${displayMoney(laborTeamPayrollSummary.payable)} · 已付款 ¥${displayMoney(laborTeamPayrollSummary.paid)}`} icon={ScrollText} /><MetricCard title="临时日结" value={`¥${displayMoney(temporaryDailySummary.actual)}`} description={`待付款 ¥${displayMoney(temporaryDailySummary.approved)} · 已付款 ¥${displayMoney(temporaryDailySummary.paid)}`} icon={BarChart3} /></section><div className="overflow-x-auto rounded-xl border border-[#e1e8e4]"><Table className="min-w-[720px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow><TableHead>劳务队</TableHead><TableHead>应发</TableHead><TableHead>扣款</TableHead><TableHead>实发</TableHead><TableHead>已审核待付款</TableHead><TableHead>已付款</TableHead></TableRow></TableHeader><TableBody>{laborTeamAuditRows.length ? laborTeamAuditRows.map(item => <TableRow key={item.teamName}><TableCell className="font-medium">{item.teamName}</TableCell><TableCell>¥{displayMoney(item.summary.payable)}</TableCell><TableCell>¥{displayMoney(item.summary.deduction)}</TableCell><TableCell className="font-semibold">¥{displayMoney(item.summary.actual)}</TableCell><TableCell>¥{displayMoney(item.summary.approved)}</TableCell><TableCell className="text-emerald-700">¥{displayMoney(item.summary.paid)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={6} className="h-16 text-center text-slate-500">当前工资筛选范围内暂无劳务队工资记录。</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
            <Card className="border-[#d8e3e0]"><CardHeader className="flex flex-wrap items-end justify-between gap-3 space-y-0"><div><CardTitle className="text-base">临时日结审核与付款台账</CardTitle><CardDescription>当天录入后按“草稿→审核中→已审核→已付款”办理；已审核未付款可退回草稿修改重审，付款后为最终结算状态。</CardDescription></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => laborDailyWages.refetch()} disabled={laborDailyWages.isFetching}>刷新日结</Button><Button size="sm" variant="outline" disabled={payrollWorkbookExport.isFetching} onClick={async () => { const response = await payrollWorkbookExport.refetch(); const data = response.data; if (!data) return toast.error("工资分类报表数据读取失败"); const standardHeaders = ["人员", "班组", "期间/日期", "应发", "扣款", "实发", "开户行", "脱敏银行卡", "状态", "实际付款日期"]; const toPayrollRows = (rows: typeof data.payrollRows) => rows.map(row => [row.workerName, row.teamName || "", row.period, row.payableAmount, row.deductionAmount, row.actualAmount, row.bankName || "", row.bankAccountMasked || "", row.status, row.paidAt ? displayDate(row.paidAt) : ""]); const toDailyRows = (rows: typeof data.dailyRows) => rows.map(row => [row.workerName, row.teamName || "", toBusinessDateInput(row.settlementDate), row.payableAmount, row.deductionAmount, row.actualAmount, row.bankName || "", row.bankAccountMasked || "", row.status, row.paidAt ? displayDate(row.paidAt) : ""]); const laborTeamNames = Array.from(new Set(data.payrollRows.filter(row => row.workerCategory === "labor_team").map(row => row.teamName || "未设置班组"))); downloadXlsxWorkbook(`工资分类报表-${laborPeriod || "全部期间"}.xlsx`, [{ name: "公司管理人员", headers: standardHeaders, rows: toPayrollRows(data.payrollRows.filter(row => row.workerCategory === "company_admin")) }, { name: "临时日结", headers: standardHeaders, rows: toDailyRows(data.dailyRows) }, ...laborTeamNames.map(teamName => ({ name: `劳务队-${teamName}`, headers: standardHeaders, rows: toPayrollRows(data.payrollRows.filter(row => row.workerCategory === "labor_team" && (row.teamName || "未设置班组") === teamName)) }))]); toast.success("分类工资 Excel 已生成，普通报表仅含脱敏银行卡"); }}>导出分类 Excel</Button><Button size="sm" className="bg-[#203c48] hover:bg-[#17313b]" disabled={payrollPaymentListExport.isFetching} onClick={async () => { const response = await payrollPaymentListExport.refetch(); const data = response.data; if (!data) return toast.error("付款专用清单无权限或数据读取失败"); const headers = ["来源", "人员", "人员类型", "班组", "期间/日结日期", "开户行", "完整银行卡号", "实发金额", "状态", "实际付款日期"]; const payrollRows = data.payrollRows.map(row => ["月度工资", row.workerName, row.workerCategory, row.teamName || "", toBusinessDateInput(row.settlementDate), row.bankName || "", row.bankAccount || "未登记", row.actualAmount, row.status, row.paidAt ? displayDate(row.paidAt) : ""]); const dailyRows = data.dailyRows.map(row => ["临时日结", row.workerName, row.workerCategory, row.teamName || "", toBusinessDateInput(row.settlementDate), row.bankName || "", row.bankAccount || "未登记", row.actualAmount, row.status, row.paidAt ? displayDate(row.paidAt) : ""]); downloadXlsxWorkbook(`付款专用清单-${laborPeriod || "全部期间"}.xlsx`, [{ name: "付款专用清单", headers, rows: [...payrollRows, ...dailyRows] }]); toast.success("付款专用 Excel 已生成，生成行为已写入审计日志"); }}>生成付款专用 Excel</Button></div></CardHeader><CardContent><section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><MetricCard title="日结实发总额" value={`¥${displayMoney(dailyWageSummary.actual)}`} description="当前项目全部日结记录" icon={BarChart3} /><MetricCard title="待审核" value={dailyWageSummary.reviewing} description="会计/财务待处理" icon={ScrollText} /><MetricCard title="待付款" value={dailyWageSummary.approved} description="审核通过，未登记付款" icon={ShieldCheck} /><MetricCard title="已付款" value={dailyWageSummary.paid} description="最终结算状态" icon={UsersRound} /></section><div className="mt-4 overflow-x-auto rounded-xl border border-[#e1e8e4]"><Table className="min-w-[1100px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow><TableHead>人员 / 班组</TableHead><TableHead>日结日期</TableHead><TableHead>应发 / 扣款 / 实发</TableHead><TableHead>状态</TableHead><TableHead>审核 / 付款</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>{dailyWages.length ? dailyWages.map(item => <TableRow key={item.id}><TableCell><p className="font-medium">{item.workerName}</p><p className="mt-1 text-slate-500">{item.teamName || "临时日结"}</p></TableCell><TableCell>{toBusinessDateInput(item.settlementDate)}</TableCell><TableCell>¥{displayMoney(item.payableAmount)} / ¥{displayMoney(item.deductionAmount)} / <span className="font-semibold">¥{displayMoney(item.actualAmount)}</span></TableCell><TableCell><BusinessStatusBadge status={item.status} /></TableCell><TableCell>{item.reviewedAt ? `审核：${displayDate(item.reviewedAt)}` : "待审核"}{item.paidAt ? <p className="mt-1 text-emerald-700">付款：{displayDate(item.paidAt)}</p> : null}</TableCell><TableCell className="text-right"><div className="flex justify-end gap-2">{item.status === "draft" ? <Button size="sm" variant="outline" onClick={() => submitDailyWage.mutate({ id: item.id })} disabled={submitDailyWage.isPending}>提交审核</Button> : null}{item.status === "reviewing" ? <><Button size="sm" variant="outline" className="border-rose-200 text-rose-700" onClick={() => reviewDailyWage.mutate({ id: item.id, decision: "returned" })} disabled={reviewDailyWage.isPending}>退回草稿</Button><Button size="sm" onClick={() => reviewDailyWage.mutate({ id: item.id, decision: "approved" })} disabled={reviewDailyWage.isPending}>审核通过</Button></> : null}{item.status === "approved" ? <Button size="sm" className="bg-[#3e746a] hover:bg-[#315f57]" onClick={() => { setDailyWagePaymentTarget({ id: item.id, workerName: item.workerName }); setDailyWagePaymentForm({ paidAt: toLocalDateInput(), paymentReference: "" }); }} disabled={payDailyWage.isPending}>登记付款</Button> : null}</div></TableCell></TableRow>) : <TableRow><TableCell colSpan={6} className="h-24 text-center text-slate-500">当前项目暂无临时日结记录。</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
            <Card className="border-[#d8e3e0]"><CardHeader className="flex flex-wrap items-end justify-between gap-3 space-y-0"><div><CardTitle className="text-base">工资条详细台账</CardTitle><CardDescription>按工资月份、人员、班组或状态筛选；导出仅包含当前项目范围内的真实工资条。</CardDescription></div><div className="flex flex-wrap gap-2"><Input aria-label="工资期间" className="w-[150px]" type="month" value={laborPeriod} onChange={event => setLaborPeriod(event.target.value)} /><Input aria-label="检索工资人员" className="w-[180px]" value={laborPayrollSearch} onChange={event => setLaborPayrollSearch(event.target.value)} placeholder="人员、班组或状态" /><Select value={laborPayrollTeam} onValueChange={setLaborPayrollTeam}><SelectTrigger className="w-[150px]"><SelectValue placeholder="全部班组" /></SelectTrigger><SelectContent><SelectItem value="all">全部班组</SelectItem>{payrollTeams.map(team => <SelectItem key={team} value={team}>{team}</SelectItem>)}</SelectContent></Select><Select value={laborPayrollStatus} onValueChange={setLaborPayrollStatus}><SelectTrigger className="w-[140px]"><SelectValue placeholder="全部状态" /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="draft">草稿</SelectItem><SelectItem value="reviewing">审核中</SelectItem><SelectItem value="approved">已审核</SelectItem><SelectItem value="paid">已付款</SelectItem><SelectItem value="void">已作废</SelectItem></SelectContent></Select><Button size="sm" variant="outline" disabled={!visiblePayrolls.length} onClick={() => downloadCsvFile(`工资条-${laborPeriod || "全部期间"}.csv`, ["项目范围", "筛选期间", "人员", "班组", "工资期间", "应发金额", "扣款", "实发金额", "付款凭证", "状态"], visiblePayrolls.map(item => [workspaceProjectId ? `项目 #${workspaceProjectId}` : "当前项目", laborPeriod || "全部期间", item.workerName, item.teamName || "", item.period, item.payableAmount, item.deductionAmount, item.actualAmount, item.paymentReference || "", item.status]))}>按当前筛选导出 CSV</Button></div></CardHeader><CardContent><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>人员</TableHead><TableHead>工资期间</TableHead><TableHead>应发金额</TableHead><TableHead>扣款</TableHead><TableHead>实发金额</TableHead><TableHead>付款凭证</TableHead><TableHead>状态</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{visiblePayrolls.length ? visiblePayrolls.map(item => <TableRow key={item.id}><TableCell><p className="font-medium">{item.workerName}</p><p className="text-xs text-slate-500">{item.teamName || "未设置班组"}</p></TableCell><TableCell>{item.period}</TableCell><TableCell>¥{displayMoney(item.payableAmount)}</TableCell><TableCell>¥{displayMoney(item.deductionAmount)}</TableCell><TableCell className="font-medium">¥{displayMoney(item.actualAmount)}</TableCell><TableCell>{item.paymentReference || "—"}</TableCell><TableCell><BusinessStatusBadge status={item.status} /></TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setDesktopRecordDetail({ title: `工资条明细 · ${item.workerName}`, description: "工资金额由服务端计算，付款凭证与敏感账户字段仅向获授权岗位展示。", fields: [{ label: "工资期间", value: item.period }, { label: "状态", value: <BusinessStatusBadge status={item.status} /> }, { label: "应发金额", value: `¥ ${displayMoney(item.payableAmount)}` }, { label: "扣款金额", value: `¥ ${displayMoney(item.deductionAmount)}` }, { label: "实发金额", value: `¥ ${displayMoney(item.actualAmount)}` }, { label: "付款凭证", value: item.paymentReference || "尚未发放" }] })}>查看</Button></TableCell></TableRow>) : <TableRow><TableCell colSpan={8} className="h-24 text-center text-sm text-slate-500">当前筛选条件下暂无工资条记录。</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
            <Card className="border-[#d8e3e0]"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-semibold text-[#203c48]">员工与工人信息录入</p><p className="mt-1 text-xs text-slate-500">新增公司管理人员、劳务队工人或临时日结人员档案；档案将同步用于工资、考勤与日结。</p></div><Button onClick={() => { setEmployeeProfileForm(EMPTY_EMPLOYEE_PROFILE_FORM); setEmployeeProfileDialogOpen(true); setLocation("/admin/permissions"); }}>添加员工/工人</Button></CardContent></Card>
            <div className="grid gap-6 xl:grid-cols-2">
              <Card><CardHeader><CardTitle className="text-base">劳务人员台账</CardTitle><CardDescription>展示实名核验与进退场状态；个人身份和资金字段保持脱敏。</CardDescription></CardHeader><CardContent className="space-y-2">{workers.length ? workers.map(worker => <div key={worker.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 p-3"><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-slate-800">{worker.realName}</p><BusinessStatusBadge status={worker.attendanceStatus} /><Badge variant="outline">实名：{worker.identityVerificationStatus === "verified" ? "已核验" : worker.identityVerificationStatus === "rejected" ? "已驳回" : "待核验"}</Badge></div><p className="mt-1 text-xs text-slate-500">班组：{worker.teamName || "未设置"} · 入场：{worker.entryDate ? displayDate(worker.entryDate) : "未登记"} · 退场：{worker.exitDate ? displayDate(worker.exitDate) : "—"}</p></div><Button size="sm" variant="outline" onClick={() => setDesktopRecordDetail({ title: `劳务人员档案 · ${worker.realName}`, description: "此为 PC 后台的受控脱敏档案视图。人员资料变更继续受岗位与项目范围校验。", fields: [{ label: "班组", value: worker.teamName || "未设置" }, { label: "实名状态", value: worker.identityVerificationStatus === "verified" ? "已核验" : worker.identityVerificationStatus === "rejected" ? "已驳回" : "待核验" }, { label: "出勤状态", value: <BusinessStatusBadge status={worker.attendanceStatus} /> }, { label: "入场日期", value: worker.entryDate ? displayDate(worker.entryDate) : "未登记" }, { label: "退场日期", value: worker.exitDate ? displayDate(worker.exitDate) : "—" }] })}>查看档案</Button></div>) : <EmptyState text="当前项目尚无真实劳务人员档案。" />}</CardContent></Card>
              <Card><CardHeader className="space-y-3"><div><CardTitle className="text-base">考勤记录</CardTitle><CardDescription>可按姓名、班组、人员类型与考勤状态组合筛选；导出仅包含当前项目与实际筛选范围，锁定记录不可由前端覆盖。</CardDescription></div><div className="flex flex-wrap gap-2"><Input className="w-[145px]" value={laborAttendanceFilter.workerName} placeholder="姓名或班组" onChange={event => setLaborAttendanceFilter(current => ({ ...current, workerName: event.target.value }))} /><Select value={laborAttendanceFilter.team} onValueChange={value => setLaborAttendanceFilter(current => ({ ...current, team: value }))}><SelectTrigger className="w-[130px]"><SelectValue placeholder="全部班组" /></SelectTrigger><SelectContent><SelectItem value="all">全部班组</SelectItem>{attendanceTeams.map(team => <SelectItem key={team} value={team}>{team}</SelectItem>)}</SelectContent></Select><Select value={laborAttendanceFilter.category} onValueChange={value => setLaborAttendanceFilter(current => ({ ...current, category: value }))}><SelectTrigger className="w-[140px]"><SelectValue placeholder="全部人员类型" /></SelectTrigger><SelectContent><SelectItem value="all">全部人员类型</SelectItem><SelectItem value="company_admin">公司管理人员</SelectItem><SelectItem value="labor_team">劳务队人员</SelectItem><SelectItem value="temporary_daily">临时日结人员</SelectItem></SelectContent></Select><Select value={laborAttendanceFilter.status} onValueChange={value => setLaborAttendanceFilter(current => ({ ...current, status: value }))}><SelectTrigger className="w-[120px]"><SelectValue placeholder="全部状态" /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="draft">草稿</SelectItem><SelectItem value="confirmed">已确认</SelectItem><SelectItem value="locked">已锁定</SelectItem></SelectContent></Select><Button size="sm" variant="outline" disabled={!visibleAttendance.length} onClick={() => downloadCsvFile(`劳务考勤-${laborAttendanceDate || "全部日期"}.csv`, ["人员", "班组", "人员类型", "考勤日期", "正常工时", "加班工时", "来源", "状态", "备注"], visibleAttendance.map(item => { const worker = workerById.get(item.workerId); return [item.workerName, item.teamName || "未设置班组", worker?.workerCategory === "company_admin" ? "公司管理人员" : worker?.workerCategory === "temporary_daily" ? "临时日结人员" : "劳务队人员", toBusinessDateInput(item.attendanceDate), item.workHours, item.overtimeHours, item.source, item.status, item.note || ""]; }), { module: "劳务考勤高级筛选导出", filters: [["项目", selectedWorkspaceProject?.name || `项目 #${workspaceProjectId}`], ["考勤日期", laborAttendanceDate || "全部日期"], ["姓名/班组", laborAttendanceFilter.workerName || "全部"], ["班组", laborAttendanceFilter.team === "all" ? "全部" : laborAttendanceFilter.team], ["人员类型", laborAttendanceFilter.category === "all" ? "全部" : laborAttendanceFilter.category], ["考勤状态", laborAttendanceFilter.status === "all" ? "全部" : laborAttendanceFilter.status]] })}>导出当前筛选</Button></div></CardHeader><CardContent className="space-y-2">{visibleAttendance.length ? visibleAttendance.map(item => { const worker = workerById.get(item.workerId); return <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 p-3"><div><p className="text-sm font-medium text-slate-800">{item.workerName} <span className="font-normal text-slate-400">{item.teamName ? `· ${item.teamName}` : ""}</span></p><p className="mt-1 text-xs text-slate-500">{displayDate(item.attendanceDate)} · 正常 {item.workHours} h · 加班 {item.overtimeHours} h · {item.source} · {worker?.workerCategory === "company_admin" ? "公司管理人员" : worker?.workerCategory === "temporary_daily" ? "临时日结" : "劳务队人员"}</p></div><BusinessStatusBadge status={item.status} /></div>; }) : <EmptyState text={attendance.length ? "当前筛选条件下没有考勤记录。" : "当前项目尚无真实考勤记录。"} />}</CardContent></Card>
            </div>
          </>
        )}
        <Dialog open={Boolean(dailyWagePaymentTarget)} onOpenChange={open => { if (!open) { setDailyWagePaymentTarget(null); setDailyWagePaymentForm({ paidAt: toLocalDateInput(), paymentReference: "" }); } }}><DialogContent><DialogHeader><DialogTitle>登记临时日结实际付款</DialogTitle><DialogDescription>付款日期为必填，付款参考说明可选；系统不发起转账。登记后该日结进入最终已付款状态，不能作废或回写。</DialogDescription></DialogHeader><div className="grid gap-3"><Field label="实际付款日期"><Input type="date" value={dailyWagePaymentForm.paidAt} onChange={event => setDailyWagePaymentForm(current => ({ ...current, paidAt: event.target.value }))} /></Field><Field label="付款参考说明（可选）"><Input value={dailyWagePaymentForm.paymentReference} maxLength={64} placeholder="如银行流水号或付款批次" onChange={event => setDailyWagePaymentForm(current => ({ ...current, paymentReference: event.target.value }))} /></Field></div><DialogFooter><Button variant="outline" onClick={() => setDailyWagePaymentTarget(null)} disabled={payDailyWage.isPending}>取消</Button><Button disabled={!dailyWagePaymentTarget || !dailyWagePaymentForm.paidAt || payDailyWage.isPending} onClick={() => dailyWagePaymentTarget && payDailyWage.mutate({ id: dailyWagePaymentTarget.id, paidAt: new Date(`${dailyWagePaymentForm.paidAt}T00:00:00.000Z`), paymentReference: dailyWagePaymentForm.paymentReference.trim() || null })}>{payDailyWage.isPending ? "正在登记…" : `确认 ${dailyWagePaymentTarget?.workerName ?? "日结"} 已付款`}</Button></DialogFooter></DialogContent></Dialog>
        <Dialog open={Boolean(payrollPaymentTarget)} onOpenChange={open => { if (!open) { setPayrollPaymentTarget(null); setPaymentReference(""); } }}><DialogContent><DialogHeader><DialogTitle>确认工资发放</DialogTitle><DialogDescription>系统不会发起银行转账。请在外部资金流程完成后，填写付款凭证号或资金流水号，服务端会复核财务岗位、项目范围和工资条状态。</DialogDescription></DialogHeader><div className="space-y-2"><Label htmlFor="payment-reference">付款凭证号 / 资金流水号</Label><Input id="payment-reference" value={paymentReference} placeholder="至少 4 个字符" onChange={event => setPaymentReference(event.target.value)} /></div><DialogFooter><Button variant="outline" onClick={() => setPayrollPaymentTarget(null)} disabled={payPayroll.isPending}>取消</Button><Button disabled={!payrollPaymentTarget || paymentReference.trim().length < 4 || payPayroll.isPending} onClick={() => payrollPaymentTarget && payPayroll.mutate({ id: payrollPaymentTarget.id, paymentReference: paymentReference.trim() })}>{payPayroll.isPending ? "正在确认…" : `确认 ${payrollPaymentTarget?.workerName ?? "工资条"} 发放`}</Button></DialogFooter></DialogContent></Dialog>
      </div>
    );
  };

  const renderMachinery = () => {
    const allMachines = machineryLedger.data ?? [];
    const machines = allMachines.filter(machine => {
      const keyword = machineLedgerFilter.search.trim().toLowerCase();
      return (!keyword || [machine.name, machine.code, machine.model, machine.supplierName, machine.plateOrAssetNo].some(value => value?.toLowerCase().includes(keyword))) && (machineLedgerFilter.ownership === "all" || machine.ownership === machineLedgerFilter.ownership) && (machineLedgerFilter.status === "all" || machine.status === machineLedgerFilter.status);
    });
    const costs = machineCosts.data ?? [];
    const monthlyStatements = machineMonthlyStatements.data ?? [];
    const statementByMachineId = new Map(monthlyStatements.map(statement => [statement.machineId, statement]));
    const selectedMachine = machines.find(machine => String(machine.id) === selectedMachineId);
    const machineMaintenanceRows = (assetMaintenanceRecords.data ?? []).filter(item => item.assetType === "machine" && item.projectId === workspaceProjectId);
    const machineMaintenanceAmountById = new Map<number, number>();
    machineMaintenanceRows.filter(item => item.status !== "void").forEach(item => machineMaintenanceAmountById.set(item.assetId, (machineMaintenanceAmountById.get(item.assetId) ?? 0) + Number(item.amount)));
    const machineCostSummaryById = new Map((machineCostSummaries.data ?? []).map(item => [item.machineId, item]));
    const openMachineEditor = (machine?: typeof machines[number]) => {
      setMachineForm(machine ? {
        id: machine.id,
        projectId: String(machine.projectId),
        operatorUserId: machine.operatorUserId ? String(machine.operatorUserId) : "",
        code: machine.code,
        name: machine.name,
        model: machine.model ?? "",
        ownership: machine.ownership,
        supplierName: machine.supplierName ?? "",
        plateOrAssetNo: machine.plateOrAssetNo ?? "",
        driverName: machine.driverName ?? "",
        driverPhone: machine.driverPhone ?? "",
        fuelTankCapacityLiters: machine.fuelTankCapacityLiters ? String(machine.fuelTankCapacityLiters) : "",
        status: machine.status,
        leaseBillingType: machine.leaseTerms?.billingType ?? "monthly",
        leaseRate: machine.leaseTerms?.rate ? String(machine.leaseTerms.rate) : "",
        leaseStartDate: machine.leaseTerms?.effectiveFrom ? toLocalDateInput(machine.leaseTerms.effectiveFrom) : "",
        leaseEndDate: machine.leaseTerms?.effectiveTo ? toLocalDateInput(machine.leaseTerms.effectiveTo) : "",
      } : { ...EMPTY_MACHINE_FORM, projectId: String(workspaceProjectId) });
      setMachineDialogOpen(true);
    };
    const openMachineCostEditor = (machine = selectedMachine) => {
      if (!machine) return toast.error("请先选择机械台账");
      setSelectedMachineId(String(machine.id));
      setMachineCostForm({ ...EMPTY_MACHINE_COST_FORM, machineId: String(machine.id), projectId: String(workspaceProjectId), occurredAt: toLocalDateTimeInput(new Date()) });
      setMachineCostDialogOpen(true);
    };
    const openMachineMaintenanceEditor = (machine: typeof machines[number]) => {
      setSelectedMachineId(String(machine.id));
      setAssetMaintenanceForm({ ...EMPTY_ASSET_MAINTENANCE_FORM, assetType: "machine", assetId: String(machine.id), projectId: String(machine.projectId), occurredAt: toLocalDateTimeInput(new Date()) });
      setAssetMaintenanceDialogOpen(true);
    };
    const openMachineDetail = (machine: typeof machines[number]) => {
      setSelectedMachineId(String(machine.id));
      setMachineDetailOpen(true);
    };
    const openMachineMonthlyStatement = (machine: typeof machines[number]) => {
      setSelectedMachineId(String(machine.id));
      setMachineStatementForm({ ...EMPTY_MACHINE_MONTHLY_STATEMENT_FORM, machineId: String(machine.id), projectId: String(machine.projectId), period: machineStatementPeriod, driverUserId: machine.operatorUserId ? String(machine.operatorUserId) : "", machineWorkDays: "0", driverWorkDays: "0" });
      setMachineStatementDialogOpen(true);
    };
    const formatMachineLease = (machine: typeof machines[number]) => machine.leaseTerms ? `${machine.leaseTerms.billingType === "monthly" ? "月租" : machine.leaseTerms.billingType === "daily" ? "日租" : machine.leaseTerms.billingType === "hourly" ? "小时租" : "台班"} ¥${displayMoney(machine.leaseTerms.rate)}` : machine.ownership === "owned" ? "未配置产值计价" : "外租 · 未登记有效租金";
    const formatLeaseDates = (machine: typeof machines[number]) => machine.leaseTerms ? `${toLocalDateInput(machine.leaseTerms.effectiveFrom)} 至 ${machine.leaseTerms.effectiveTo ? toLocalDateInput(machine.leaseTerms.effectiveTo) : "长期"}` : "—";
    return (
      <div className="space-y-6">
        <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="text-sm font-medium text-[#203c48]">机械资源 · 真实业务台账</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">机械台账与成本结算</h1><p className="mt-2 max-w-3xl text-sm text-slate-500">机械档案、操作员、产权/租赁、状态、成本录入与结算均在当前 PC 台账完成；已退役设备保留历史责任链。</p></div><Button className="min-h-11 w-full text-sm sm:w-auto" onClick={() => openMachineEditor()} disabled={!hasBusinessWorkspaceProject}>新建机械档案</Button></div>
        {hasBusinessWorkspaceProject && !machineryLedger.isLoading && !machineryLedger.isError ? <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><MetricCard title="机械总数" value={machines.length} description={selectedWorkspaceProject?.name ?? "当前项目"} icon={Settings2} /><MetricCard title="作业中" value={machines.filter(item => item.status === "working").length} description="当前可见机械资源" icon={BarChart3} /><MetricCard title="机械维修保养费" value={`¥${displayMoney(Number(assetMaintenanceSummary.data?.machineMaintenanceAmount ?? 0) + Number(assetMaintenanceSummary.data?.machineRepairAmount ?? 0))}`} description="独立于油料、租赁等运行成本" icon={ScrollText} /><MetricCard title="车辆/机械费用汇总" value={`¥${displayMoney(assetMaintenanceSummary.data?.totalAmount ?? 0)}`} description="车辆维修保养 + 机械维修保养/运行成本" icon={ShieldCheck} /></section> : null}
        {renderWorkspaceProjectFilter("机械项目范围", "选择项目后读取机械资源台账。选择具体机械后再读取其真实成本记录，避免无筛选的成本明细暴露。")}
        {hasBusinessWorkspaceProject ? <Card className="border-slate-200"><CardContent className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_180px_180px_auto]"><div><Label>机械检索</Label><Input className="mt-1 min-h-11" value={machineLedgerFilter.search} onChange={event => setMachineLedgerFilter(current => ({ ...current, search: event.target.value }))} placeholder="名称、编号、型号或供应商" /></div><div><Label>资源性质</Label><Select value={machineLedgerFilter.ownership} onValueChange={value => setMachineLedgerFilter(current => ({ ...current, ownership: value }))}><SelectTrigger className="mt-1 min-h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部性质</SelectItem><SelectItem value="owned">公司自有</SelectItem><SelectItem value="leased">外租机械</SelectItem></SelectContent></Select></div><div><Label>机械状态</Label><Select value={machineLedgerFilter.status} onValueChange={value => setMachineLedgerFilter(current => ({ ...current, status: value }))}><SelectTrigger className="mt-1 min-h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="idle">闲置</SelectItem><SelectItem value="working">作业中</SelectItem><SelectItem value="repairing">维修中</SelectItem><SelectItem value="offsite">场外</SelectItem><SelectItem value="retired">已退役</SelectItem></SelectContent></Select></div><Button className="min-h-11 w-full self-end text-sm xl:w-auto" size="sm" variant="outline" disabled={!machines.length} onClick={() => downloadCsvFile(`机械综合台账-${toLocalDateInput()}.csv`, ["机械名称", "编号", "项目", "操作员", "资源性质", "状态", "出租方", "租赁方式", "租金", "起租日期", "截止日期", "维修保养费", "维修成本", "累计成本"], machines.map(machine => { const summary = machineCostSummaryById.get(machine.id); return [machine.name, machine.code, selectedWorkspaceProject?.name ?? machine.projectId, machine.operatorUserId ? userNameById.get(machine.operatorUserId) ?? `#${machine.operatorUserId}` : "未分配", machine.ownership === "owned" ? "公司自有" : "外租", machine.status, machine.supplierName || "", machine.leaseTerms?.billingType ?? "", machine.leaseTerms?.rate ?? "", machine.leaseTerms?.effectiveFrom ? toLocalDateInput(machine.leaseTerms.effectiveFrom) : "", machine.leaseTerms?.effectiveTo ? toLocalDateInput(machine.leaseTerms.effectiveTo) : "", machineMaintenanceAmountById.get(machine.id) ?? 0, summary?.repairAmount ?? 0, summary?.totalAmount ?? 0]; }))}>导出 CSV</Button></CardContent></Card> : null}
        {!hasBusinessWorkspaceProject ? <EmptyState text="请先选择已授权项目，以读取真实机械资源台账。" /> : machineryLedger.isLoading ? <EmptyState text="正在读取机械资源台账…" /> : machineryLedger.isError ? <EmptyState text="暂无法读取机械资源，请确认当前账号的服务端授权后重试。" /> : (
          <>
            <Card className="w-full border-[#d8e3e0] shadow-sm"><CardHeader><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">机械资源 · 综合台账</p><CardTitle className="mt-1 text-base">机械资源、维修与会计计价台账</CardTitle><CardDescription className="mt-1">每台机械仅保留一行综合台账，行内汇总当期收益、支出、加油、维修与审计状态；点击详情查看按日、按月分析。</CardDescription></div><div className="flex flex-wrap items-end gap-2"><div><Label htmlFor="machine-ledger-period">分析期间</Label><Input id="machine-ledger-period" className="mt-1 w-[150px]" type="month" value={machineStatementPeriod} onChange={event => setMachineStatementPeriod(event.target.value)} /></div><Button size="sm" variant="outline" onClick={() => void Promise.all([machineryLedger.refetch(), machineCostSummaries.refetch(), assetMaintenanceRecords.refetch(), machineMonthlyStatements.refetch(), machineAnalysis.refetch()])}>刷新台账</Button></div></div></CardHeader><CardContent><div className="overflow-x-auto rounded-xl border border-[#e1e8e4]"><Table className="min-w-[1750px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow className="border-[#dce3de] hover:bg-[#edf1ed]"><TableHead className="h-11 px-4 font-semibold text-[#46615a]">机械 / 编号</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">型号 / 资产编号</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">操作员</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">资源 / 状态</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">出租方 / 车主</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">产值计价 / 有效日期</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">本月收益 / 净收益</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">本月支出</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">油耗 / 维修</TableHead><TableHead className="h-11 px-4 text-right font-semibold text-[#46615a]">操作</TableHead></TableRow></TableHeader><TableBody>{machines.length ? machines.map(machine => { const summary = machineCostSummaryById.get(machine.id); const statement = statementByMachineId.get(machine.id); const netIncome = statement ? Number(statement.totalOutput) - Number(statement.driverTotalWage) - Number(statement.repairAmount) - Number(statement.fuelAmount) : null; return <TableRow key={machine.id} className="border-[#edf0ee] hover:bg-[#fbfaf1]"><TableCell className="px-4 py-3"><p className="font-semibold text-[#203c48]">{machine.name}</p><p className="mt-1 text-slate-500">{machine.code}</p></TableCell><TableCell className="px-4 py-3 text-slate-700"><p>{machine.model || "未登记"}</p><p className="mt-1 text-slate-500">{machine.plateOrAssetNo || "未登记"}</p></TableCell><TableCell className="px-4 py-3 text-slate-700">{machine.operatorUserId ? userNameById.get(machine.operatorUserId) ?? `用户 #${machine.operatorUserId}` : "未分配"}</TableCell><TableCell className="px-4 py-3"><div className="flex flex-wrap gap-1"><Badge variant="outline">{machine.ownership === "owned" ? "公司自有" : "外租"}</Badge><BusinessStatusBadge status={machine.status} /></div></TableCell><TableCell className="px-4 py-3 text-slate-700">{machine.supplierName || (machine.ownership === "leased" ? "未登记" : "公司自有")}</TableCell><TableCell className="px-4 py-3 text-slate-700"><p>{formatMachineLease(machine)}</p><p className="mt-1 text-slate-500">{formatLeaseDates(machine)}</p></TableCell><TableCell className="px-4 py-3 text-slate-700"><p className="font-medium text-slate-900">{statement ? `¥${displayMoney(statement.totalOutput)}` : "待生成"}</p><p className="mt-1 text-slate-500">{netIncome === null ? "未生成当期快照" : `净收益 ¥${displayMoney(netIncome)}`}</p></TableCell><TableCell className="px-4 py-3 text-slate-700"><p>司机 ¥{displayMoney(statement?.driverTotalWage ?? 0)}</p><p className="mt-1">其他 ¥{displayMoney(statement?.deductionAmount ? Number(statement.deductionAmount) - Number(statement.driverTotalWage) - Number(statement.repairAmount) - Number(statement.fuelAmount) : 0)}</p></TableCell><TableCell className="px-4 py-3 text-slate-700"><p>油 {statement ? `${statement.fuelLiters} L / ¥${displayMoney(statement.fuelAmount)}` : "待核算"}</p><p className="mt-1">维修 ¥{displayMoney(statement?.repairAmount ?? ((machineMaintenanceAmountById.get(machine.id) ?? 0) + (summary?.repairAmount ?? 0)))}</p></TableCell><TableCell className="px-4 py-3 text-right"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => openMachineDetail(machine)}>详情</Button>{!statement || statement.status === "draft" ? <Button size="sm" variant="outline" onClick={() => openMachineMonthlyStatement(machine)}>月度明细</Button> : null}{statement?.status === "draft" ? <Button size="sm" onClick={() => transitionMachineMonthlyStatement.mutate({ id: statement.id, projectId: workspaceProjectId, nextStatus: "submitted" })} disabled={transitionMachineMonthlyStatement.isPending}>提交</Button> : null}{statement?.status === "submitted" ? <><Button size="sm" onClick={() => transitionMachineMonthlyStatement.mutate({ id: statement.id, projectId: workspaceProjectId, nextStatus: "approved" })} disabled={transitionMachineMonthlyStatement.isPending}>审核</Button><Button size="sm" variant="outline" onClick={() => transitionMachineMonthlyStatement.mutate({ id: statement.id, projectId: workspaceProjectId, nextStatus: "void" })} disabled={transitionMachineMonthlyStatement.isPending}>作废</Button></> : null}{statement?.status === "approved" ? <><span className="px-2 py-1 text-xs text-[#56746c]">请在下方付款台账生成结算</span><Button size="sm" variant="outline" onClick={() => transitionMachineMonthlyStatement.mutate({ id: statement.id, projectId: workspaceProjectId, nextStatus: "void" })} disabled={transitionMachineMonthlyStatement.isPending}>作废</Button></> : null}<Button size="sm" variant="outline" onClick={() => openMachineEditor(machine)}>编辑</Button></div></TableCell></TableRow>; }) : <TableRow><TableCell className="px-4 py-8 text-center text-slate-500" colSpan={10}>当前筛选条件下没有机械资源。</TableCell></TableRow>}</TableBody></Table></div><p className="mt-3 text-xs text-slate-500">会计月度明细固定使用 30 天月、每天 10 小时的模板口径；产值、成本、油耗和分成均由服务端按当前项目的真实记录和计价规则生成快照。</p></CardContent></Card>
            <MachinePaymentSettlementManager projectId={workspaceProjectId} />
            <Dialog open={machineDetailOpen} onOpenChange={setMachineDetailOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>{selectedMachine ? `${selectedMachine.name} · 机械业务详情` : "机械业务详情"}</DialogTitle><DialogDescription>当前明细来自已授权项目的真实机械档案、租赁规则、维修保养与成本记录；状态操作不会绕过服务端状态机与审计。</DialogDescription></DialogHeader>{selectedMachine ? <div className="space-y-4"><div className="grid gap-3 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><p className="text-xs text-slate-500">机械编号 / 型号</p><p className="mt-1 font-medium text-slate-800">{selectedMachine.code} · {selectedMachine.model || "未登记"}</p></div><div><p className="text-xs text-slate-500">操作员 / 状态</p><p className="mt-1 font-medium text-slate-800">{selectedMachine.operatorUserId ? userNameById.get(selectedMachine.operatorUserId) ?? `用户 #${selectedMachine.operatorUserId}` : "未分配"}</p><div className="mt-1"><BusinessStatusBadge status={selectedMachine.status} /></div></div><div><p className="text-xs text-slate-500">外租规则</p><p className="mt-1 font-medium text-slate-800">{formatMachineLease(selectedMachine)}</p><p className="mt-1 text-xs text-slate-500">{formatLeaseDates(selectedMachine)}</p></div><div><p className="text-xs text-slate-500">成本汇总</p><p className="mt-1 font-medium text-slate-800">维修保养 ¥{displayMoney(machineMaintenanceAmountById.get(selectedMachine.id) ?? 0)}</p><p className="mt-1 text-xs text-slate-500">业务成本 ¥{displayMoney(machineCostSummaryById.get(selectedMachine.id)?.totalAmount ?? 0)}</p></div></div>{machineAnalysis.isLoading ? <EmptyState text="正在汇总该设备的按日、按月收益支出分析…" /> : machineAnalysis.error ? <EmptyState text="暂无法读取该机械分析数据。" /> : machineAnalysis.data ? <section className="space-y-4 rounded-xl border border-[#d8e3e0] bg-[#f8fcfb] p-3"><div><p className="text-sm font-semibold text-[#203c48]">单机收益与成本分析</p><p className="mt-1 text-xs text-slate-500">月度收益以已保存会计快照为准；日度收益来自日作业记录，油料优先读取柴油领用台账，避免与历史油料成本重复计算。</p></div><div className="overflow-x-auto rounded-lg border border-slate-200 bg-white"><Table className="min-w-[940px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow><TableHead>月份</TableHead><TableHead>产值 / 收益</TableHead><TableHead>司机工资</TableHead><TableHead>油耗 / 油费</TableHead><TableHead>维修</TableHead><TableHead>净收益</TableHead><TableHead>签字 / 状态</TableHead></TableRow></TableHeader><TableBody>{machineAnalysis.data.monthly.length ? machineAnalysis.data.monthly.map(item => <TableRow key={item.id}><TableCell>{item.period}</TableCell><TableCell>¥{displayMoney(item.totalOutput)}</TableCell><TableCell>¥{displayMoney(item.driverTotalWage)}</TableCell><TableCell>{item.fuelLiters} L / ¥{displayMoney(item.fuelAmount)}</TableCell><TableCell>¥{displayMoney(item.repairAmount)}</TableCell><TableCell className="font-medium">¥{displayMoney(item.netIncome)}</TableCell><TableCell>{item.signatureName || "未签字"} · <BusinessStatusBadge status={item.status} /></TableCell></TableRow>) : <TableRow><TableCell colSpan={7} className="py-6 text-center text-slate-500">暂无已保存月度结算快照。</TableCell></TableRow>}</TableBody></Table></div><div className="overflow-x-auto rounded-lg border border-slate-200 bg-white"><Table className="min-w-[1100px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow><TableHead>日期</TableHead><TableHead>工时 / 加班</TableHead><TableHead>日收益</TableHead><TableHead>司机工资</TableHead><TableHead>加油</TableHead><TableHead>维修 / 保养</TableHead><TableHead>其他支出</TableHead><TableHead>净收益</TableHead><TableHead>审计状态</TableHead></TableRow></TableHeader><TableBody>{machineAnalysis.data.daily.length ? machineAnalysis.data.daily.map(item => <TableRow key={item.date}><TableCell>{item.date}</TableCell><TableCell>{item.workHours} h / {item.overtimeHours} h</TableCell><TableCell>¥{displayMoney(item.outputAmount)}</TableCell><TableCell>¥{displayMoney(item.driverWageAmount)}</TableCell><TableCell>{item.fuelLiters} L / ¥{displayMoney(item.fuelAmount)}</TableCell><TableCell>¥{displayMoney(item.repairAmount)} / ¥{displayMoney(item.maintenanceAmount)}</TableCell><TableCell>¥{displayMoney(item.otherExpenseAmount)}</TableCell><TableCell className="font-medium">¥{displayMoney(item.netIncome)}</TableCell><TableCell>{item.operationStatus ? <BusinessStatusBadge status={item.operationStatus} /> : "仅有费用凭证"}</TableCell></TableRow>) : <TableRow><TableCell colSpan={9} className="py-6 text-center text-slate-500">当前期间暂无日作业、加油、维修或成本凭证。</TableCell></TableRow>}</TableBody></Table></div></section> : null}<div className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-slate-800">维修保养明细</p><p className="text-xs text-slate-500">维修与保养费用独立留档，作废记录不计入汇总。</p></div><Button size="sm" variant="outline" onClick={() => openMachineMaintenanceEditor(selectedMachine)}>登记维修保养</Button></div>{machineMaintenanceRows.filter(item => item.assetId === selectedMachine.id).length ? machineMaintenanceRows.filter(item => item.assetId === selectedMachine.id).map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"><div><p className="font-medium text-slate-800">{item.costCategory === "repair" ? "维修" : "保养"}</p><p className="mt-1 text-xs text-slate-500">{displayDate(item.occurredAt)} · {item.serviceProvider || "未登记服务单位"}</p></div><div className="text-right"><p className="font-medium text-slate-800">¥{displayMoney(item.amount)}</p><p className="mt-1 text-xs text-slate-500">{item.status === "void" ? "已作废" : item.status === "approved" ? "已核准" : "草稿"}</p></div></div>) : <EmptyState text="该机械尚无维修保养记录。" />}</div><div className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-slate-800">机械成本明细</p><p className="text-xs text-slate-500">审核、结算与作废仍按成本状态机逐笔办理。</p></div><Button size="sm" onClick={() => openMachineCostEditor(selectedMachine)}>录入成本</Button></div>{machineCosts.isLoading ? <EmptyState text="正在读取该机械的真实成本记录…" /> : machineCosts.isError ? <EmptyState text="暂无法读取该机械成本记录。" /> : costs.length ? costs.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"><div><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-slate-800">{item.costType === "fuel" ? "油料" : item.costType === "repair" ? "维修" : item.costType === "overtime" ? "加班" : item.costType === "mobilization" ? "进退场" : "其他"}</p><BusinessStatusBadge status={item.status} /></div><p className="mt-1 text-xs text-slate-500">{displayDate(item.occurredAt)} · 数量 {item.quantity} · 单价 ¥{displayMoney(item.unitPrice)} · 金额 ¥{displayMoney(item.amount)}</p></div><div className="flex flex-wrap gap-2">{item.status === "draft" ? <Button size="sm" onClick={() => transitionMachineCost.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "approved" })} disabled={transitionMachineCost.isPending}>审核</Button> : null}{item.status === "approved" ? <Button size="sm" onClick={() => transitionMachineCost.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "settled" })} disabled={transitionMachineCost.isPending}>确认结算</Button> : null}{["draft", "approved"].includes(item.status) ? <Button size="sm" variant="outline" onClick={() => transitionMachineCost.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "void" })} disabled={transitionMachineCost.isPending}>作废</Button> : null}</div></div>) : <EmptyState text="该机械尚无真实成本记录。" />}</div></div> : <EmptyState text="请选择机械后查看详情。" />}<DialogFooter>{selectedMachine ? <><Button type="button" variant="outline" onClick={() => openMachineEditor(selectedMachine)}>编辑档案</Button><Button type="button" variant="outline" onClick={() => setLocation("/admin/transport")}>关联运输调度</Button></> : null}<Button type="button" onClick={() => setMachineDetailOpen(false)}>关闭</Button></DialogFooter></DialogContent></Dialog>
          </>
        )}
      </div>
    );
  };

  const renderTransport = () => {
    const vehiclesForProject = transportVehicleLedger.data ?? [];
    const trips = transportTrips.data ?? [];
    const activeTrips = trips.filter(item => item.status !== "void");
    const totalAmount = activeTrips.reduce((sum, item) => sum + Number(item.calculatedAmount ?? 0), 0);
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-medium text-[#203c48]">运输调度 · 真实业务台账</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">车辆、趟次与结算状态</h1><p className="mt-2 max-w-3xl text-sm text-slate-500">展示真实车辆资源与指定自然日趟次。运价快照、理论方量、异常检测、核验、详情查看和结算均在当前 PC 台账中完成。</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!hasBusinessWorkspaceProject} onClick={() => { setVehicleForm({ ...EMPTY_VEHICLE_FORM, projectId: String(workspaceProjectId) }); setVehicleEditorOpen(true); setLocation("/admin/vehicles"); }}><Truck className="mr-1.5 h-4 w-4" />录入车辆档案</Button><Button size="sm" variant="outline" onClick={() => setLocation("/admin/vehicles")}>单车柴油分析</Button></div></div>
        {renderWorkspaceProjectFilter("运输项目范围", "选择项目后读取车辆台账和实际运输趟次。司机、运输管理和财务操作由服务端按角色、项目和状态分别校验。")}
        {/* 装卸土点与路线统一配置器放在下方运输业务区，避免项目筛选后出现两个重复配置入口。 */}
        {!hasBusinessWorkspaceProject ? <EmptyState text="请先选择已授权项目，以读取真实运输调度台账。" /> : transportVehicleLedger.isLoading || transportTrips.isLoading ? <EmptyState text="正在读取车辆和运输趟次…" /> : transportVehicleLedger.isError || transportTrips.isError ? <EmptyState text="暂无法读取运输调度数据，请确认当前账号的服务端授权后重试。" /> : (
          <>
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><MetricCard title="可见车辆" value={vehiclesForProject.length} description={selectedWorkspaceProject?.name ?? "当前项目"} icon={Truck} /><MetricCard title="可调度车辆" value={vehiclesForProject.filter(item => item.status === "active").length} description="车辆状态来自真实台账" icon={ShieldCheck} /><MetricCard title="当日有效趟次" value={activeTrips.length} description={transportDate || "全部日期"} icon={ScrollText} /><MetricCard title="可结算金额" value={Math.round(totalAmount * 100) / 100} description="非作废趟次金额合计" icon={BarChart3} /></section>
            <TransportRouteConfigurationEditor projectId={workspaceProjectId} />
            <Card className="w-full border-[#d8e3e0] shadow-sm"><CardHeader className="flex flex-wrap items-end justify-between gap-3 space-y-0"><div><p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">运输调度 · 综合台账</p><CardTitle className="mt-1 text-base">车辆趟次、异常与结算台账</CardTitle><CardDescription className="mt-1">车辆主档只在“车辆资源”维护；本页按趟次集中展示车辆、方量、里程、异常、运费和结算状态，避免重复车辆列表。</CardDescription></div><div className="min-w-[170px]"><Label htmlFor="transport-date">运输日期</Label><Input id="transport-date" className="mt-1" type="date" value={transportDate} onChange={event => setTransportDate(event.target.value)} /></div></CardHeader><CardContent><div className="overflow-x-auto rounded-xl border border-[#e1e8e4]"><Table className="min-w-[1280px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow className="border-[#dce3de] hover:bg-[#edf1ed]"><TableHead className="h-11 px-4 font-semibold text-[#46615a]">趟次单号</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">车辆</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">开始时间</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">里程 / 方量</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">结算金额</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">异常</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">状态</TableHead><TableHead className="h-11 px-4 text-right font-semibold text-[#46615a]">操作</TableHead></TableRow></TableHeader><TableBody>{trips.length ? trips.map(item => { const vehicle = vehiclesForProject.find(candidate => candidate.id === item.vehicleId); return <TableRow key={item.id} className="border-[#edf0ee] hover:bg-[#fbfaf1]"><TableCell className="px-4 py-3 font-semibold text-[#203c48]">{item.tripNo}</TableCell><TableCell className="px-4 py-3 text-slate-700"><p>{vehicle?.plateNo || `车辆 #${item.vehicleId}`}</p><p className="mt-1 text-slate-500">{vehicle?.vehicleType || "—"} · 理论 {vehicle?.theoreticalVolumeCubicMeters ?? "—"} m³</p></TableCell><TableCell className="px-4 py-3 text-slate-700">{displayDate(item.startAt)}</TableCell><TableCell className="px-4 py-3 text-slate-700"><p>{item.actualDistanceKm ?? "—"} km</p><p className="mt-1 text-slate-500">{item.volumeCubicMeters ?? "—"} m³</p></TableCell><TableCell className="px-4 py-3 font-medium text-slate-800">¥{displayMoney(item.calculatedAmount)}</TableCell><TableCell className="px-4 py-3">{item.anomalies.length ? <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-50">{item.anomalies.length} 项提示</Badge> : <span className="text-slate-500">无</span>}</TableCell><TableCell className="px-4 py-3"><BusinessStatusBadge status={item.status} /></TableCell><TableCell className="px-4 py-3 text-right"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setDesktopRecordDetail({ title: `运输趟次明细 · ${item.tripNo}`, description: "此为 PC 后台的运输趟次快照。金额、状态和异常均以服务端记录为准。", fields: [{ label: "状态", value: <BusinessStatusBadge status={item.status} /> }, { label: "车辆", value: vehicle?.plateNo || `#${item.vehicleId}` }, { label: "开始时间", value: displayDate(item.startAt) }, { label: "实际距离", value: item.actualDistanceKm === null ? "未记录" : `${item.actualDistanceKm} km` }, { label: "方量", value: item.volumeCubicMeters === null ? "未记录" : `${item.volumeCubicMeters} m³` }, { label: "重量", value: item.weightTons === null ? "未记录" : `${item.weightTons} t` }, { label: "结算金额", value: `¥ ${displayMoney(item.calculatedAmount)}` }, { label: "异常提示", value: item.anomalies.length ? item.anomalies.join("；") : "无" }] })}>详情</Button>{item.status === "draft" ? <Button size="sm" onClick={() => transitionTransportTrip.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "submitted" })} disabled={transitionTransportTrip.isPending}>提交</Button> : null}{item.status === "submitted" ? <><Button size="sm" onClick={() => transitionTransportTrip.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "verified" })} disabled={transitionTransportTrip.isPending}>核验</Button><Button size="sm" variant="outline" onClick={() => transitionTransportTrip.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "void" })} disabled={transitionTransportTrip.isPending}>作废</Button></> : null}{item.status === "verified" ? <><Button size="sm" onClick={() => transitionTransportTrip.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "settled" })} disabled={transitionTransportTrip.isPending}>结算</Button><Button size="sm" variant="outline" onClick={() => transitionTransportTrip.mutate({ id: item.id, projectId: workspaceProjectId, nextStatus: "void" })} disabled={transitionTransportTrip.isPending}>作废</Button></> : null}</div></TableCell></TableRow>; }) : <TableRow><TableCell colSpan={8} className="px-4 py-10 text-center text-slate-500">{transportDate ? "当前项目和日期尚无真实运输趟次。" : "当前项目尚无真实运输趟次。"}</TableCell></TableRow>}</TableBody></Table></div><p className="mt-3 text-xs text-slate-500">车辆档案、RFID 卡和维修成本通过相应资源台账维护；趟次状态、异常和结算均由服务端复核。</p></CardContent></Card>
            <TransportRouteSafetySettings projectId={workspaceProjectId} />
            <div id="transport-trip-ledger-upgrade">
              <TransportTripLedger
                filter={transportLedgerFilter}
                onFilterChange={setTransportLedgerFilter}
                trips={trips}
                vehicles={vehiclesForProject}
                routePresets={transportRoutePresets.data ?? []}
                loading={transportTrips.isLoading}
                projectName={selectedWorkspaceProject?.name ?? "当前项目"}
                onTransition={(id, nextStatus) => transitionTransportTrip.mutate({ id, projectId: workspaceProjectId, nextStatus })}
                transitionPending={transitionTransportTrip.isPending}
                onExport={(headers, rows) => downloadCsvFile(`运输车辆趟次台账-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows)}
              />
            </div>
          </>
        )}
      </div>
    );
  };

  const renderRfidManagement = () => {
    if (!hasBusinessWorkspaceProject) return null;
    const writerDevices = rfidWriterDevices.data ?? [];
    const cards = vehicleRfidCards.data ?? [];
    return (
      <div className="space-y-5">
        <Card className="border-[#d8e3e0] bg-[#f8fcfb]">
          <CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0"><div><p className="text-sm font-medium text-[#203c48]">射频写卡 · 受控预留</p><CardTitle className="mt-1 text-base">车辆卡绑定与写卡任务</CardTitle><CardDescription className="mt-1 max-w-3xl">系统生成并审计车辆、车型、货厢、司机与联系电话载荷；当前不伪造 USB/串口直连，现场需使用已登记写卡器完成物理写入后再确认结果。</CardDescription></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { setRfidWriterDeviceForm(EMPTY_RFID_WRITER_DEVICE_FORM); setRfidWriterDialogOpen(true); }}>登记写卡器</Button><Button size="sm" onClick={() => { const firstVehicle = transportVehicleLedger.data?.[0]; setRfidCardForm({ ...EMPTY_RFID_CARD_FORM, vehicleId: firstVehicle ? String(firstVehicle.id) : "", writerDeviceId: writerDevices[0] ? String(writerDevices[0].id) : "", driverPhone: firstVehicle?.driverPhone || "" }); setRfidCardDialogOpen(true); }} disabled={!transportVehicleLedger.data?.length}>绑定车辆卡</Button></div></CardHeader>
          <CardContent className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]">
            <div className="space-y-2"><p className="text-sm font-medium text-slate-800">写卡器设备</p>{writerDevices.length ? writerDevices.map(device => <div key={device.id} className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-slate-800">{device.displayName}</p><BusinessStatusBadge status={device.status} /></div><p className="mt-1 text-xs text-slate-500">编号 {device.deviceCode} · 型号 {device.model || "待采购/未登记"} · {device.connectionMode === "manual_placeholder" ? "人工确认模式" : device.connectionMode}</p></div>) : <EmptyState text="尚未登记写卡器。可先登记编号和型号，硬件协议后续再受控接入。" />}</div>
            <div className="space-y-2"><p className="text-sm font-medium text-slate-800">车辆射频卡</p>{cards.length ? cards.map(card => <div key={card.id} className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-slate-800">{card.plateNo}</p><BusinessStatusBadge status={card.status} /><Badge variant="outline">卡 {card.cardUidMasked}</Badge></div><p className="mt-1 text-xs text-slate-500">司机电话 {card.driverPhoneMasked || "未登记"} · 写卡器 {card.writerName || "未指定"}{card.writerModel ? `（${card.writerModel}）` : ""} · 最近写入 {displayDate(card.lastWrittenAt)}</p></div><Button size="sm" onClick={() => prepareRfidCardWrite.mutate({ cardId: Number(card.id), projectId: workspaceProjectId, writerDeviceId: card.writerDeviceId ?? null, action: card.lastWrittenAt ? "rewrite" : "issue", executionMode: "pc_bridge" })} disabled={prepareRfidCardWrite.isPending || card.status !== "active"}>{prepareRfidCardWrite.isPending ? "生成中…" : card.lastWrittenAt ? "PC 补写车辆卡" : "PC 写入车辆卡"}</Button></div></div>) : <EmptyState text="尚未绑定车辆射频卡。请先登记车辆和司机，再读取卡 UID 完成绑定。" />}</div>
          </CardContent>
        </Card>

        <Dialog open={rfidWriterDialogOpen} onOpenChange={setRfidWriterDialogOpen}><DialogContent><DialogHeader><DialogTitle>登记射频写卡器</DialogTitle><DialogDescription>目前先记录写卡器型号与使用状态；未接入设备适配器前，系统只允许生成并人工确认写卡任务。</DialogDescription></DialogHeader><div className="grid gap-3 py-2"><div className="grid gap-3 sm:grid-cols-2"><Field label="设备编号"><Input value={rfidWriterDeviceForm.deviceCode} placeholder="例如 RFID-W-001" onChange={event => setRfidWriterDeviceForm(current => ({ ...current, deviceCode: event.target.value }))} /></Field><Field label="显示名称"><Input value={rfidWriterDeviceForm.displayName} placeholder="装土点写卡器" onChange={event => setRfidWriterDeviceForm(current => ({ ...current, displayName: event.target.value }))} /></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="型号（预留）"><Input value={rfidWriterDeviceForm.model} placeholder="采购后填写" onChange={event => setRfidWriterDeviceForm(current => ({ ...current, model: event.target.value }))} /></Field><Field label="连接方式"><Select value={rfidWriterDeviceForm.connectionMode} onValueChange={value => setRfidWriterDeviceForm(current => ({ ...current, connectionMode: value as RfidWriterDeviceForm["connectionMode"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manual_placeholder">人工确认（当前）</SelectItem><SelectItem value="usb">USB（预留）</SelectItem><SelectItem value="serial">串口（预留）</SelectItem><SelectItem value="network">网络（预留）</SelectItem></SelectContent></Select></Field></div><Field label="备注"><Input value={rfidWriterDeviceForm.remarks} onChange={event => setRfidWriterDeviceForm(current => ({ ...current, remarks: event.target.value }))} /></Field></div><DialogFooter><Button variant="outline" onClick={() => setRfidWriterDialogOpen(false)}>取消</Button><Button disabled={!rfidWriterDeviceForm.deviceCode.trim() || !rfidWriterDeviceForm.displayName.trim() || saveRfidWriterDevice.isPending} onClick={() => saveRfidWriterDevice.mutate({ projectId: workspaceProjectId, deviceCode: rfidWriterDeviceForm.deviceCode, displayName: rfidWriterDeviceForm.displayName, model: rfidWriterDeviceForm.model || null, connectionMode: rfidWriterDeviceForm.connectionMode, status: rfidWriterDeviceForm.status, remarks: rfidWriterDeviceForm.remarks || null })}>{saveRfidWriterDevice.isPending ? "保存中…" : "保存设备"}</Button></DialogFooter></DialogContent></Dialog>

        <Dialog open={rfidCardDialogOpen} onOpenChange={setRfidCardDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>绑定车辆射频卡</DialogTitle>
              <DialogDescription>卡 ID/UID、车牌与驾驶员信息用于本次受控绑定和 RC3 签名写卡。服务端只保存 UID 指纹、电话密文和掩码；请勿写入身份证、银行卡、路线或结算金额。</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="车辆（车牌号）">
                  <Select value={rfidCardForm.vehicleId} onValueChange={value => {
                    const vehicle = (transportVehicleLedger.data ?? []).find(item => String(item.id) === value);
                    setRfidCardForm(current => ({ ...current, vehicleId: value, driverPhone: vehicle?.driverPhone || current.driverPhone }));
                  }}>
                    <SelectTrigger><SelectValue placeholder="选择车辆" /></SelectTrigger>
                    <SelectContent>{transportVehicleLedger.data?.map(vehicle => <SelectItem key={vehicle.id} value={String(vehicle.id)}>{vehicle.plateNo}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="写卡器（用于审计）">
                  <Select value={rfidCardForm.writerDeviceId || "UNASSIGNED"} onValueChange={value => setRfidCardForm(current => ({ ...current, writerDeviceId: value === "UNASSIGNED" ? "" : value }))}>
                    <SelectTrigger><SelectValue placeholder="选择写卡器" /></SelectTrigger>
                    <SelectContent><SelectItem value="UNASSIGNED">暂不指定</SelectItem>{writerDevices.filter(device => device.status === "active").map(device => <SelectItem key={device.id} value={String(device.id)}>{device.displayName} · {device.deviceCode}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid gap-3 rounded-xl border border-cyan-200 bg-cyan-50/60 p-3 sm:grid-cols-2">
                <Field label="车牌号"><Input disabled value={selectedRfidVehicle?.plateNo || "请先选择车辆"} /></Field>
                <Field label="驾驶员姓名"><Input disabled value={selectedRfidVehicle?.driverName || "车辆台账尚未填写驾驶员姓名"} /></Field>
                <Field label="驾驶员联系电话"><Input value={rfidCardForm.driverPhone} placeholder="选择车辆后自动带入，可按现场确认修改" onChange={event => setRfidCardForm(current => ({ ...current, driverPhone: event.target.value }))} /></Field>
                <Field label="卡 ID / UID"><div className="flex gap-2"><Input readOnly value={rfidCardForm.cardUid} placeholder="请点击右侧读取卡 ID" /><Button type="button" variant="outline" className="shrink-0" onClick={readRfidBindingUid} disabled={readingRfidBindingUid}>{readingRfidBindingUid ? "读取中…" : "读取卡 ID"}</Button></div></Field>
                <Field label="卡片状态"><Input disabled value={rfidCardForm.status === "active" ? "启用" : rfidCardForm.status === "suspended" ? "暂停" : "已停用"} /></Field>
                <Field label="签名版本"><Input disabled value="RC3 · 服务端签名校验" /></Field>
              </div>
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">写入正式卡时，卡内仅包含车牌号、驾驶员姓名、联系电话、卡绑定引用、项目引用、修订号、随机挑战值与签名。路线、方量、单价、金额和结算状态不写入卡片。</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRfidCardDialogOpen(false)}>取消</Button>
              <Button disabled={!rfidCardForm.vehicleId || !rfidCardForm.cardUid.trim() || !rfidCardForm.driverPhone.trim() || saveVehicleRfidCard.isPending} onClick={() => saveVehicleRfidCard.mutate({ projectId: workspaceProjectId, vehicleId: Number(rfidCardForm.vehicleId), writerDeviceId: rfidCardForm.writerDeviceId ? Number(rfidCardForm.writerDeviceId) : null, cardUid: rfidCardForm.cardUid, driverPhone: rfidCardForm.driverPhone, status: rfidCardForm.status })}>{saveVehicleRfidCard.isPending ? "保存中…" : "保存绑定"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(rfidWritePreview)} onOpenChange={open => { if (!open) setRfidWritePreview(null); }}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{rfidWritePreview?.hardwareMode === "pc_bridge" ? "PC 受控车辆卡写入" : "受控写卡载荷"} · {rfidWritePreview?.jobNo}</DialogTitle><DialogDescription>{rfidWritePreview?.hardwareMode === "pc_bridge" ? "请将已绑定的 NTAG216 保持在 uTrust 4701 F CL Reader 感应区。系统仅把一次性任务授权交给本机桥接；桥接将读取 UID、向服务器领取匹配载荷、写入 NDEF 并逐字节回读，全部成功后自动确认。" : "请将下列载荷写入已绑定物理卡。写入成功后再确认；此处内容不保存到数据库，关闭窗口后需重新生成任务。"}</DialogDescription></DialogHeader>{rfidWritePreview?.hardwareMode === "pc_bridge" ? <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4 text-sm leading-6 text-cyan-950"><p className="font-semibold">将卡片放在读卡器感应区后开始。</p><p className="mt-1 text-xs">不会向浏览器或桥接暴露签名密钥、可编辑载荷或写保护口令；写入失败会记录原因，不能被手工标记成功。</p></div> : <pre className="max-h-[45vh] overflow-auto rounded-xl bg-slate-950 p-3 text-xs leading-5 text-emerald-100">{rfidWritePreview ? JSON.stringify(rfidWritePreview.payload, null, 2) : ""}</pre>}<DialogFooter><Button variant="outline" onClick={() => rfidWritePreview && confirmRfidCardWrite.mutate({ id: rfidWritePreview.jobId, projectId: workspaceProjectId, success: false, failureReason: "现场未完成物理写卡" })} disabled={confirmRfidCardWrite.isPending || writingRfidCard}>{rfidWritePreview?.hardwareMode === "pc_bridge" ? "关闭任务" : "记录写卡失败"}</Button>{rfidWritePreview?.hardwareMode === "pc_bridge" ? <Button onClick={() => void writeRfidCardWithBridge()} disabled={writingRfidCard}>{writingRfidCard ? "正在写入并回读…" : "写入并回读确认"}</Button> : <Button onClick={() => rfidWritePreview && confirmRfidCardWrite.mutate({ id: rfidWritePreview.jobId, projectId: workspaceProjectId, success: true })} disabled={confirmRfidCardWrite.isPending}>{confirmRfidCardWrite.isPending ? "确认中…" : "已完成物理写卡"}</Button>}</DialogFooter></DialogContent></Dialog>
      </div>
    );
  };

  const renderBusiness = () => (
    <div className="space-y-6" id="business-governance-report">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[#203c48]">全业务治理</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">业务模块、统计与安全备份</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">超级管理员可从本页进入各业务模块维护真实数据。原有审批、状态流转、项目范围与敏感字段保护仍由服务端执行，不因后台入口而放宽。</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button size="sm" variant="outline" onClick={() => businessStatistics.refetch()} disabled={businessStatistics.isFetching}>刷新统计</Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="mr-1.5 h-4 w-4" />打印当前页</Button>
        </div>
      </div>

      <Card className="print:border-0 print:shadow-none">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[220px] flex-1">
            <Label htmlFor="business-project-filter">统计项目</Label>
            <Select value={businessFilter.projectId} onValueChange={projectId => setBusinessFilter(current => ({ ...current, projectId }))}>
              <SelectTrigger id="business-project-filter" className="mt-1"><SelectValue placeholder="选择项目" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部项目</SelectItem>
                {(projects.data ?? []).filter(project => project.status !== "archived").map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[180px]">
            <Label htmlFor="business-period-filter">统计期间</Label>
            <Input id="business-period-filter" className="mt-1" type="month" value={businessFilter.period} onChange={event => setBusinessFilter(current => ({ ...current, period: event.target.value }))} />
          </div>
          <Button className="print:hidden" size="sm" variant="outline" onClick={() => setBusinessFilter({ projectId: "all", period: "" })} disabled={businessFilter.projectId === "all" && !businessFilter.period}>清除筛选</Button>
          <p className="w-full text-xs text-slate-500">当前统计与打印口径：{businessFilterLabel}。基础档案按创建时间、业务单据按发生日期或结算期间统计。</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">全业务管理入口</CardTitle>
          <CardDescription>每个入口均跳转至已部署的真实业务工作台；超级管理员可维护记录，普通人员仍会受到角色、部门与项目范围限制。</CardDescription>
        </CardHeader>
        <CardContent>
          {!isAuthenticated ? <EmptyState text="请先登录超级管理员账号后读取真实业务统计。" /> : businessStatistics.isLoading ? <EmptyState text="正在汇总真实业务记录…" /> : businessStatistics.isError ? <EmptyState text="暂无法读取全业务统计，请确认当前账号具有超级管理员权限。" /> : businessStatistics.data?.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {businessStatistics.data.map(module => (
                <div key={module.code} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3"><div><p className="font-medium text-slate-900">{module.name}</p><p className="mt-1 text-xs text-slate-500">当前真实记录</p></div><Badge variant="secondary">{module.recordCount} 条</Badge></div>
                  <Button className="mt-4 w-full print:hidden" size="sm" variant="outline" onClick={() => setLocation(ADMIN_BUSINESS_ROUTE_BY_MODULE[module.code] ?? module.route)}><ExternalLink className="mr-1.5 h-4 w-4" />进入维护</Button>
                </div>
              ))}
            </div>
          ) : <EmptyState text="暂无业务模块统计结果。" />}
        </CardContent>
      </Card>

      <Card className="border-[#d8e3e0]">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">业务数据逻辑备份</CardTitle>
            <CardDescription>创建只包含业务数据与关联元数据的 JSON 快照；不包含口令摘要、接口密钥、敏感系统配置、审计日志或影像文件本体。在线恢复未开放，防止误覆盖生产数据。</CardDescription>
          </div>
          <Button className="shrink-0 print:hidden" size="sm" onClick={() => createBackup.mutate()} disabled={createBackup.isPending}><DatabaseBackup className="mr-1.5 h-4 w-4" />{createBackup.isPending ? "正在归档…" : "创建备份"}</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {!isAuthenticated ? <EmptyState text="请先登录超级管理员账号后读取已归档备份。" /> : backups.isLoading ? <EmptyState text="正在读取已归档备份…" /> : backups.isError ? <EmptyState text="暂无法读取备份目录，请稍后重试。" /> : backups.data?.length ? backups.data.map(backup => (
            <div key={backup.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-800">{backup.fileName}</p><p className="mt-1 text-xs text-slate-500">{displayDate(backup.createdAt)} · {backup.recordCount} 条 · SHA-256：{backup.sha256.slice(0, 12)}… · 范围 {backup.scopeVersion}</p></div>
              <Button className="print:hidden" size="sm" variant="outline" onClick={() => downloadBackup.mutate({ id: Number(backup.id) })} disabled={downloadBackup.isPending}>下载</Button>
            </div>
          )) : <EmptyState text="尚无已归档备份。首次创建备份前不会生成任何示例文件。" />}
        </CardContent>
      </Card>
    </div>
  );

  const renderFinance = () => {
    const allFinanceRecords = financeSummary.data?.records ?? [];
    const financeCategories = Array.from(new Set(allFinanceRecords.map(record => record.category).filter(Boolean))).sort();
    const financeSourceTypes = Array.from(new Set(allFinanceRecords.map(record => record.sourceType || "manual").filter(Boolean))).sort();
    const financeLedgerRows = allFinanceRecords.filter(record => {
      if (financeLedgerFilter.direction !== "all" && record.direction !== financeLedgerFilter.direction) return false;
      if (financeLedgerFilter.category !== "all" && record.category !== financeLedgerFilter.category) return false;
      if (financeLedgerFilter.settlementStatus !== "all" && record.settlementStatus !== financeLedgerFilter.settlementStatus) return false;
      const sourceType = record.sourceType || "manual";
      if (financeLedgerFilter.sourceType !== "all" && sourceType !== financeLedgerFilter.sourceType) return false;
      const keyword = financeLedgerFilter.keyword.trim().toLowerCase();
      return !keyword || `${record.recordNo} ${record.category} ${record.sourceType ?? ""} ${record.remarks ?? ""}`.toLowerCase().includes(keyword);
    });
    const financeLedgerIncome = financeLedgerRows.filter(record => record.direction === "income" && record.settlementStatus !== "void").reduce((sum, record) => sum + Number(record.amount), 0);
    const financeLedgerExpense = financeLedgerRows.filter(record => record.direction === "expense" && record.settlementStatus !== "void").reduce((sum, record) => sum + Number(record.amount), 0);
    const settlementStatusLabel: Record<string, string> = { unpaid: "未结清", partial: "部分结清", paid: "已结清", void: "已作废" };
    const sourceTypeLabel: Record<string, string> = { manual: "人工财务流水", measurement_claim: "工程计量申报", measurement_payment: "工程计量回款", purchase_order_payable: "采购订单应付", purchase_order_settlement: "采购订单结算", financial_reversal: "财务冲销" };
    return <div className="space-y-5">
      <Card className="border-[#d8e3e0] shadow-sm">
        <CardHeader><CardTitle className="text-base">{isDiesel ? "柴油管理与加油台账" : "审计级财务管理"}</CardTitle><CardDescription>{isDiesel ? "管理员按每次加油的日期、升数和当天单价登记；系统在服务端固化金额快照并自动归集到机械、车辆、运输扣款和项目成本。" : "按项目和会计期间读取真实费用、成本、应收应付及发票状态。发票台账不重复计入成本；每日日结生成不可变快照，供会计审核与凭证装订打印。"}</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
          <Select value={financeProjectId} onValueChange={setFinanceProjectId}><SelectTrigger><SelectValue placeholder="选择项目" /></SelectTrigger><SelectContent>{projects.data?.filter(project => project.status !== "archived").map(project => <SelectItem key={project.id} value={String(project.id)}>{project.code} · {project.name}</SelectItem>)}</SelectContent></Select>
          <Input type="month" value={financePeriod} onChange={event => setFinancePeriod(event.target.value)} aria-label="会计期间" />
          <Button variant="outline" onClick={() => { void financeSummary.refetch(); void financeInvoices.refetch(); }}>刷新统计</Button>
        </CardContent>
      </Card>
      {!financeProjectId ? <EmptyState text={isDiesel ? "请选择项目后读取真实柴油指导价、每次加油金额和资源成本归集台账。" : "请选择项目后读取真实费用、成本和发票审计台账。"} /> : <>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="确认收入" value={financeSummary.data?.incomeAmount} description="不含重复回款口径" icon={BarChart3} />
          <MetricCard title="项目成本/开支" value={financeSummary.data?.expenseAmount} description="已登记支出流水" icon={ScrollText} />
          <MetricCard title="已开票金额" value={financeInvoices.data?.summary.totalAmount} description="不含作废与红冲" icon={ScrollText} />
          <MetricCard title="待认证发票" value={financeInvoices.data?.summary.pendingAmount} description="须会计复核" icon={ScrollText} />
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="应收余额" value={financeSummary.data?.receivableAmount} description="已确认收入待回款" icon={BarChart3} />
          <MetricCard title="应付余额" value={financeSummary.data?.payableAmount} description="已登记开支待结清" icon={ScrollText} />
          <MetricCard title="本期现金净流" value={financeSummary.data?.netCashFlowAmount} description={`流入 ¥${displayMoney(financeSummary.data?.cashInflowAmount ?? 0)} · 流出 ¥${displayMoney(financeSummary.data?.cashOutflowAmount ?? 0)}`} icon={BarChart3} />
          <MetricCard title="本期经营利润" value={financeSummary.data?.profitAmount} description="确认收入减已登记支出" icon={ScrollText} />
        </div>
        <Card className="border-[#d8e3e0] shadow-sm">
          <CardHeader className="flex flex-col gap-3 space-y-0 lg:flex-row lg:items-start lg:justify-between"><div><p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">资金总账 · 审计口径</p><CardTitle className="mt-1 text-base">全部收入、支出、应收应付与现金流明细</CardTitle><CardDescription className="mt-1">本表只汇总已形成的真实财务流水；采购、工资、柴油、运输等业务成本在下方“成本类别分析”按权威来源归集，避免同一笔业务重复累计。可按大类、细项、收付状态、业务来源及关键词组合筛选。</CardDescription></div><Button size="sm" variant="outline" disabled={!financeLedgerRows.length} onClick={() => downloadCsvFile(`项目资金总账-${financePeriod}.csv`, ["单号", "发生时间", "收支方向", "资金大类/细项", "业务来源", "结算状态", "金额", "说明"], financeLedgerRows.map(record => [record.recordNo, displayDate(record.occurredAt), record.direction === "income" ? "收入" : "支出", record.category, sourceTypeLabel[record.sourceType ?? "manual"] ?? record.sourceType ?? "人工财务流水", settlementStatusLabel[record.settlementStatus] ?? record.settlementStatus, Number(record.amount), record.remarks ?? ""] ))}>导出当前明细</Button></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5"><Select value={financeLedgerFilter.direction} onValueChange={direction => setFinanceLedgerFilter(current => ({ ...current, direction }))}><SelectTrigger aria-label="资金收支方向"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部收支方向</SelectItem><SelectItem value="income">仅收入</SelectItem><SelectItem value="expense">仅支出</SelectItem></SelectContent></Select><Select value={financeLedgerFilter.category} onValueChange={category => setFinanceLedgerFilter(current => ({ ...current, category }))}><SelectTrigger aria-label="财务细项"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部资金细项</SelectItem>{financeCategories.map(category => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select><Select value={financeLedgerFilter.settlementStatus} onValueChange={settlementStatus => setFinanceLedgerFilter(current => ({ ...current, settlementStatus }))}><SelectTrigger aria-label="资金结算状态"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部结算状态</SelectItem><SelectItem value="unpaid">未结清</SelectItem><SelectItem value="partial">部分结清</SelectItem><SelectItem value="paid">已结清</SelectItem><SelectItem value="void">已作废</SelectItem></SelectContent></Select><Select value={financeLedgerFilter.sourceType} onValueChange={sourceType => setFinanceLedgerFilter(current => ({ ...current, sourceType }))}><SelectTrigger aria-label="财务业务来源"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部业务来源</SelectItem>{financeSourceTypes.map(source => <SelectItem key={source} value={source}>{sourceTypeLabel[source] ?? source}</SelectItem>)}</SelectContent></Select><Input value={financeLedgerFilter.keyword} aria-label="财务关键词筛选" placeholder="单号、类别、说明" onChange={event => setFinanceLedgerFilter(current => ({ ...current, keyword: event.target.value }))} /></div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e1e8e4] bg-[#f8fbf8] px-4 py-3 text-sm"><span>当前筛选：{financeLedgerRows.length} 笔 · 收入 <strong>¥{displayMoney(financeLedgerIncome)}</strong> · 支出 <strong>¥{displayMoney(financeLedgerExpense)}</strong> · 净额 <strong>¥{displayMoney(financeLedgerIncome - financeLedgerExpense)}</strong></span><Button size="sm" variant="ghost" onClick={() => setFinanceLedgerFilter({ direction: "all", category: "all", settlementStatus: "all", sourceType: "all", keyword: "" })}>清除筛选</Button></div>
            <div className="overflow-x-auto rounded-xl border border-[#e1e8e4]"><Table className="min-w-[1060px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow><TableHead>单号 / 时间</TableHead><TableHead>收支</TableHead><TableHead>资金细项</TableHead><TableHead>业务来源</TableHead><TableHead>结算状态</TableHead><TableHead>金额</TableHead><TableHead>说明</TableHead></TableRow></TableHeader><TableBody>{financeLedgerRows.length ? financeLedgerRows.map(record => <TableRow key={record.id}><TableCell><p className="font-medium text-[#203c48]">{record.recordNo}</p><p className="mt-1 text-[11px] text-slate-500">{displayDate(record.occurredAt)}</p></TableCell><TableCell className={record.direction === "income" ? "font-medium text-emerald-700" : "font-medium text-rose-700"}>{record.direction === "income" ? "收入" : "支出"}</TableCell><TableCell>{record.category}</TableCell><TableCell>{sourceTypeLabel[record.sourceType ?? "manual"] ?? record.sourceType ?? "人工财务流水"}</TableCell><TableCell><BusinessStatusBadge status={record.settlementStatus} /></TableCell><TableCell className="font-medium">¥{displayMoney(record.amount)}</TableCell><TableCell className="max-w-[280px] whitespace-normal text-slate-600">{record.remarks || "—"}</TableCell></TableRow>) : <TableRow><TableCell colSpan={7} className="py-10 text-center text-slate-500">当前筛选范围暂无已登记资金流水。可检查项目、期间和筛选条件，或由财务按权限登记真实流水。</TableCell></TableRow>}</TableBody></Table></div>
          </CardContent>
        </Card>
        {!isDiesel ? <Card className="border-[#d8e3e0] shadow-sm"><CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">业财分析 · 小类目</p><CardTitle className="mt-1 text-base">小类目成本占比与导出</CardTitle><CardDescription className="mt-1">在一级成本口径内细分生活、工资、油料、维修等已登记明细；占比均以当前项目、当前会计期间的真实项目开支为分母。采购订单应付与实际现金结算继续分开处理，不在本表重复累计。</CardDescription></div><Button size="sm" variant="outline" disabled={!riskFinanceAnalysis.data?.subcategories.length} onClick={() => downloadCsvFile(`财务小类目汇总-${financePeriod}.csv`, ["一级类别", "小类目", "金额", "占项目开支", "业务笔数", "权威来源"], (riskFinanceAnalysis.data?.subcategories ?? []).map(item => [riskFinanceAnalysis.data?.categories.find(category => category.code === item.parentCode)?.label ?? item.parentCode, item.label, item.amount, `${item.percentage}%`, item.recordCount, item.sources.join("、")]))}>导出小类目汇总</Button></CardHeader><CardContent>{riskFinanceAnalysis.isLoading ? <p className="text-sm text-slate-500">正在汇总小类目成本…</p> : riskFinanceAnalysis.data?.subcategories.length ? <div className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-[#d8e3e0] bg-[#f8fbfa] p-3"><p className="text-xs text-slate-500">生活开支占项目开支</p><p className="mt-1 text-lg font-semibold text-[#203c48]">{riskFinanceAnalysis.data.categories.find(item => item.code === "living")?.percentage ?? 0}%</p><p className="mt-1 text-xs text-slate-500">¥ {displayMoney(riskFinanceAnalysis.data.categories.find(item => item.code === "living")?.amount ?? 0)}</p></div><div className="rounded-lg border border-[#d8e3e0] bg-[#f8fbfa] p-3"><p className="text-xs text-slate-500">工资劳务占项目开支</p><p className="mt-1 text-lg font-semibold text-[#203c48]">{riskFinanceAnalysis.data.categories.find(item => item.code === "payroll")?.percentage ?? 0}%</p><p className="mt-1 text-xs text-slate-500">¥ {displayMoney(riskFinanceAnalysis.data.categories.find(item => item.code === "payroll")?.amount ?? 0)}</p></div></div><div className="overflow-x-auto rounded-xl border border-[#e1e8e4]"><Table className="min-w-[820px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow><TableHead>一级类别</TableHead><TableHead>小类目</TableHead><TableHead>金额</TableHead><TableHead>占项目开支</TableHead><TableHead>业务笔数</TableHead><TableHead>权威来源</TableHead></TableRow></TableHeader><TableBody>{riskFinanceAnalysis.data.subcategories.map(item => <TableRow key={item.code}><TableCell>{riskFinanceAnalysis.data?.categories.find(category => category.code === item.parentCode)?.label ?? item.parentCode}</TableCell><TableCell className="font-medium text-[#203c48]">{item.label}</TableCell><TableCell>¥{displayMoney(item.amount)}</TableCell><TableCell>{item.percentage}%</TableCell><TableCell>{item.recordCount}</TableCell><TableCell className="text-slate-600">{item.sources.join("、")}</TableCell></TableRow>)}</TableBody></Table></div></div> : <p className="text-sm text-slate-500">当前期间暂无可导出的已登记小类目成本。</p>}</CardContent></Card> : null}
        {!isDiesel ? <Card className="border-[#d8e3e0] shadow-sm"><CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0"><div><p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">业财分析 · 权威业务来源</p><CardTitle className="mt-1 text-base">按成本类别分析汇总</CardTitle><CardDescription className="mt-1">生活开支、柴油、工资、机械、车辆运输、采购及其他开支分别读取已登记财务流水、柴油领用、已审核工资、机械成本和维修保养；同一业务不重复计入。</CardDescription></div><Button size="sm" variant="outline" disabled={!riskFinanceAnalysis.data?.categories.length} onClick={() => downloadCsvFile(`财务分类汇总-${financePeriod}.csv`, ["成本类别", "金额", "占比", "笔数", "权威来源"], (riskFinanceAnalysis.data?.categories ?? []).map(item => [item.label, item.amount, `${item.percentage}%`, item.recordCount, item.sources.join("、")]))}>导出分类汇总</Button></CardHeader><CardContent>{riskFinanceAnalysis.isLoading ? <p className="text-sm text-slate-500">正在汇总已登记的真实成本…</p> : riskFinanceAnalysis.data?.categories.length ? <div className="overflow-x-auto rounded-xl border border-[#e1e8e4]"><Table className="min-w-[720px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow><TableHead>成本类别</TableHead><TableHead>金额</TableHead><TableHead>占项目开支</TableHead><TableHead>业务笔数</TableHead><TableHead>权威来源</TableHead></TableRow></TableHeader><TableBody>{riskFinanceAnalysis.data.categories.map(item => <TableRow key={item.code}><TableCell className="font-medium text-[#203c48]">{item.label}</TableCell><TableCell>¥{displayMoney(item.amount)}</TableCell><TableCell>{item.percentage}%</TableCell><TableCell>{item.recordCount}</TableCell><TableCell className="text-slate-600">{item.sources.join("、")}</TableCell></TableRow>)}<TableRow className="bg-[#f8fbf8]"><TableCell className="font-semibold">合计</TableCell><TableCell className="font-semibold">¥{displayMoney(riskFinanceAnalysis.data.expenseAmount)}</TableCell><TableCell>100%</TableCell><TableCell colSpan={2}>统计期间：{financePeriod}</TableCell></TableRow></TableBody></Table></div> : <p className="text-sm text-slate-500">当前期间暂无可分类的已登记成本。请先登记真实流水、柴油领用、工资或设备成本。</p>}</CardContent></Card> : null}
        <Card className="border-[#d8e3e0] shadow-sm print:border-0 print:shadow-none">
          <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
            <div><p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">项目部供油 · 运输扣款 · 机械油料成本</p><CardTitle className="mt-1 text-base">柴油领用与每日结算</CardTitle><CardDescription className="mt-1">项目部供油按有效指导单价计价；加油站加油按实际单价入账。关联渣土车趟次且勾选“结算扣油”后，财务结算自动从总运费扣除油款并锁定明细。</CardDescription></div>
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto"><Button className="min-h-11 sm:min-h-8" size="sm" variant="outline" onClick={() => { setDieselPriceForm({ ...EMPTY_DIESEL_PRICE_FORM, projectId: financeProjectId, effectiveFrom: dieselDate }); setDieselPriceDialogOpen(true); }}>维护指导价</Button><Button className="min-h-11 sm:min-h-8" size="sm" onClick={() => { setDieselRefuelForm({ ...EMPTY_DIESEL_REFUEL_FORM, projectId: financeProjectId, refueledAt: `${dieselDate}T08:00` }); setDieselRefuelDialogOpen(true); }}>登记柴油领用</Button></div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-[#d8e3e0] bg-[#f8fbf8] p-3"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-[#29483e]">柴油组合筛选</p><p className="mt-1 text-xs text-slate-500">可同时按车牌、加油日期区间、月份、供油方式、车辆/机械和供应商筛选；导出内容与当前明细完全一致。</p></div><Button size="sm" variant="ghost" onClick={() => setDieselLedgerFilter({ plateNo: "", dateFrom: "", dateTo: "", month: "", supplyMethod: "all", assetType: "all", supplierName: "" })}>清除筛选</Button></div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><Input value={dieselLedgerFilter.plateNo} aria-label="柴油筛选车牌" placeholder="车牌（模糊查询）" onChange={event => setDieselLedgerFilter(current => ({ ...current, plateNo: event.target.value.toUpperCase() }))} /><Input type="date" max={dieselLedgerFilter.dateTo || undefined} value={dieselLedgerFilter.dateFrom} aria-label="柴油加油开始日期" onChange={event => setDieselLedgerFilter(current => ({ ...current, dateFrom: event.target.value }))} /><Input type="date" min={dieselLedgerFilter.dateFrom || undefined} value={dieselLedgerFilter.dateTo} aria-label="柴油加油结束日期" onChange={event => setDieselLedgerFilter(current => ({ ...current, dateTo: event.target.value }))} /><Input type="month" value={dieselLedgerFilter.month} aria-label="柴油加油月份" onChange={event => setDieselLedgerFilter(current => ({ ...current, month: event.target.value }))} /><Select value={dieselLedgerFilter.supplyMethod} onValueChange={value => setDieselLedgerFilter(current => ({ ...current, supplyMethod: value }))}><SelectTrigger aria-label="柴油供油方式"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部供油方式</SelectItem><SelectItem value="project_supply">项目部供油</SelectItem><SelectItem value="external_station">加油站现金加油</SelectItem></SelectContent></Select><Select value={dieselLedgerFilter.assetType} onValueChange={value => setDieselLedgerFilter(current => ({ ...current, assetType: value }))}><SelectTrigger aria-label="柴油车辆机械"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部车辆 / 机械</SelectItem><SelectItem value="vehicle">仅车辆</SelectItem><SelectItem value="machine">仅机械</SelectItem></SelectContent></Select><Input value={dieselLedgerFilter.supplierName} aria-label="柴油筛选供应商" placeholder="供应商 / 加油站（模糊查询）" onChange={event => setDieselLedgerFilter(current => ({ ...current, supplierName: event.target.value }))} /></div></div>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]"><Input type="date" value={dieselDate} aria-label="柴油每日汇总日期" onChange={event => setDieselDate(event.target.value)} /><Button variant="outline" onClick={() => { void dieselRefuelRecords.refetch(); void dieselDailySummary.refetch(); void dieselGuidelinePrices.refetch(); }}>刷新柴油台账</Button><Button variant="outline" disabled={!dieselRefuelRecords.data?.length} onClick={() => downloadCsvFile(`柴油领用明细-${dieselLedgerFilter.month || dieselLedgerFilter.dateFrom || dieselDate}.csv`, ["单号", "资源", "资源类型", "供油方式", "供应商/供油点", "升数", "适用单价", "金额", "是否扣运费", "加油时间", "状态"], (dieselRefuelRecords.data ?? []).map(item => [item.recordNo, item.assetName, item.assetType === "vehicle" ? "车辆" : "机械", item.supplyMethod === "project_supply" ? "项目部供油" : "加油站加油", item.stationOrSupplierName ?? "", Number(item.liters), Number(item.appliedUnitPrice), Number(item.amount), item.deductFromFreight ? "是" : "否", displayDate(item.refueledAt), item.status]))}>导出当前筛选明细</Button></div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard title="当日供油量" value={`${Number(dieselDailySummary.data?.totalLiters ?? 0).toFixed(2)} L`} description={`项目部 ${Number(dieselDailySummary.data?.projectSupplyLiters ?? 0).toFixed(2)} L · 加油站 ${Number(dieselDailySummary.data?.stationLiters ?? 0).toFixed(2)} L`} icon={Truck} /><MetricCard title="当日柴油金额" value={dieselDailySummary.data?.totalAmount} description="作废记录不计入" icon={BarChart3} /><MetricCard title="车辆 / 机械领用" value={`${Number(dieselDailySummary.data?.vehicleLiters ?? 0).toFixed(2)} / ${Number(dieselDailySummary.data?.machineLiters ?? 0).toFixed(2)} L`} description="车辆油料可关联趟次；机械油料自动进入成本台账" icon={Settings2} /><MetricCard title="待扣运费油款" value={dieselDailySummary.data?.deductibleAmount} description="结算运输趟次时从总运费扣减" icon={ScrollText} /></div>
            <div className="rounded-xl border border-[#d8e3e0] bg-[#f8fbf8] p-3 text-sm text-[#29483e]"><p><span className="font-medium">项目部供油：</span>{dieselGuidelinePrices.data?.find(price => price.status === "active") ? `¥ ${displayMoney(dieselGuidelinePrices.data.find(price => price.status === "active")?.pricePerLiter)} / L（生效 ${toBusinessDateInput(dieselGuidelinePrices.data.find(price => price.status === "active")?.effectiveFrom)}，按加油日期由服务端匹配并固化）` : "尚未维护有效指导价；项目部供油登记前请先维护。"}</p><p className="mt-1"><span className="font-medium">加油站现金加油：</span>每次登记当天实际单价和升数，系统自动计算金额并固化现金油价快照。</p><Button className="mt-2 print:hidden" size="sm" variant="outline" disabled={!dieselDailySummary.data} onClick={() => window.print()}>打印每日供油单</Button></div>
            <div className="grid gap-3 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <Card className="border-amber-200 bg-amber-50/50 shadow-none"><CardHeader className="pb-3"><CardTitle className="text-sm">现金油价异常预警</CardTitle><CardDescription>同项目、同一供应商当前价格相对上一笔有效现金价格的波动达到阈值时，柴油记录和采购对账将显示预警并写入审计。</CardDescription></CardHeader><CardContent className="flex flex-wrap items-end gap-2"><div className="grid gap-1.5"><Label>波动阈值（%）</Label><Input className="w-36" type="number" min="0.01" step="0.01" value={dieselAlertThreshold} onChange={event => setDieselAlertThreshold(event.target.value)} /></div><Button size="sm" disabled={saveDieselPriceAlertRule.isPending || !Number(dieselAlertThreshold)} onClick={() => saveDieselPriceAlertRule.mutate({ projectId: Number(financeProjectId), thresholdPercent: Number(dieselAlertThreshold), enabled: dieselPriceAlertRule.data?.enabled ?? true })}>{saveDieselPriceAlertRule.isPending ? "正在保存…" : `保存${dieselPriceAlertRule.data?.enabled === false ? "并启用" : "阈值"}`}</Button><p className="basis-full text-xs text-amber-900">当前：{dieselPriceAlertRule.data?.enabled === false ? "已停用预警" : `波动达到 ${dieselPriceAlertRule.data?.thresholdPercent ?? 10}% 时预警`}</p></CardContent></Card>
              <Card className="border-[#d8e3e0] shadow-none"><CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0"><div><CardTitle className="text-sm">供应商柴油采购对账</CardTitle><CardDescription>按当前会计期间汇总加油站现金采购的升数、金额、加权均价、凭证和异常数量。</CardDescription></div><Button size="sm" variant="outline" disabled={!dieselSupplierReconciliation.data?.length} onClick={() => downloadCsvFile(`柴油供应商对账-${financePeriod}.csv`, ["供应商", "笔数", "升数", "金额", "加权均价", "最低单价", "最高单价", "价差", "凭证数", "异常数"], (dieselSupplierReconciliation.data ?? []).map(item => [item.supplierName, item.recordCount, item.liters.toFixed(3), item.amount.toFixed(2), item.averageUnitPrice.toFixed(2), item.minUnitPrice.toFixed(2), item.maxUnitPrice.toFixed(2), item.priceSpread.toFixed(2), item.receiptCount, item.alertCount]))}>导出对账</Button></CardHeader><CardContent>{dieselSupplierReconciliation.isLoading ? <p className="text-sm text-slate-500">正在汇总供应商采购…</p> : dieselSupplierReconciliation.data?.length ? <div className="overflow-x-auto"><Table className="min-w-[760px] text-xs"><TableHeader><TableRow><TableHead>供应商</TableHead><TableHead>升数 / 金额</TableHead><TableHead>加权均价</TableHead><TableHead>价格区间</TableHead><TableHead>凭证</TableHead><TableHead>异常</TableHead></TableRow></TableHeader><TableBody>{dieselSupplierReconciliation.data.map(item => <TableRow key={item.supplierName}><TableCell className="font-medium">{item.supplierName}</TableCell><TableCell>{item.liters.toFixed(2)} L / ¥{displayMoney(item.amount)}</TableCell><TableCell>¥{displayMoney(item.averageUnitPrice)}/L</TableCell><TableCell>¥{displayMoney(item.minUnitPrice)}–{displayMoney(item.maxUnitPrice)}</TableCell><TableCell>{item.receiptCount} / {item.recordCount}</TableCell><TableCell className={item.alertCount ? "font-medium text-rose-700" : "text-emerald-700"}>{item.alertCount ? `${item.alertCount} 条预警` : "无异常"}</TableCell></TableRow>)}</TableBody></Table></div> : <p className="text-sm text-slate-500">当前期间暂无加油站现金采购记录。</p>}</CardContent></Card>
            </div>
            <LedgerTable title="每日柴油领用明细" description="项目部供油按指导价快照，加油站现金加油按实际单价快照；小票影像、价格预警和供应商对账均保留审计链。已结算车辆油款会锁定并在运输净结算中体现。" loading={dieselRefuelRecords.isLoading} columns={["单号/资源", "供油方式", "油量 / 单价", "金额", "凭证 / 预警", "运输扣油", "加油时间", "状态"]} rows={(dieselRefuelRecords.data ?? []).map(item => ({ id: Number(item.id), cells: [<div><p>{item.recordNo}</p><p className="mt-1 text-[11px] text-slate-500">{item.assetName}</p></div>, item.supplyMethod === "project_supply" ? "项目部供油" : `加油站 · ${item.stationOrSupplierName ?? "未填写"}`, `${Number(item.liters).toFixed(2)} L / ¥${displayMoney(item.appliedUnitPrice)}`, `¥ ${displayMoney(item.amount)}`, <div className="space-y-1">{item.receiptEvidence?.url ? <a className="text-xs font-medium text-[#2b6660] underline" href={item.receiptEvidence.url} target="_blank" rel="noreferrer">查看小票照片</a> : <p className="text-xs text-slate-500">无小票照片</p>}{item.priceAlert?.isAlert ? <p className="text-xs font-medium text-rose-700">价格波动 {item.priceAlert.deviationPercent}%</p> : item.supplyMethod === "external_station" ? <p className="text-xs text-emerald-700">价格正常</p> : null}</div>, item.deductFromFreight ? (item.tripNo ? `扣 ${item.tripNo}` : "待关联趟次") : "不扣", displayDate(item.refueledAt), <BusinessStatusBadge status={item.status} />], onOpen: () => setDesktopRecordDetail({ title: `柴油领用 ${item.recordNo}`, description: "领用金额、计价方式、小票影像和运输扣款均以服务端快照为准。", fields: [{ label: "资源", value: item.assetName }, { label: "供油方式", value: item.supplyMethod === "project_supply" ? "项目部供油" : "加油站现金加油" }, { label: "加油量", value: `${Number(item.liters).toFixed(2)} L` }, { label: "适用单价", value: `¥ ${displayMoney(item.appliedUnitPrice)}/L` }, { label: "金额", value: `¥ ${displayMoney(item.amount)}` }, { label: "价格预警", value: item.priceAlert?.isAlert ? `异常波动 ${item.priceAlert.deviationPercent}%（基准 ¥${displayMoney(item.priceAlert.referenceUnitPrice)}/L，阈值 ${item.priceAlert.thresholdPercent}%）` : item.supplyMethod === "external_station" ? "未触发预警" : "项目部指导价供油，不参与现金价格预警" }, { label: "现金小票", value: item.receiptEvidence?.url ? <a className="font-medium text-[#2b6660] underline" href={item.receiptEvidence.url} target="_blank" rel="noreferrer">查看受控小票影像：{item.receiptEvidence.fileName}</a> : "未关联小票照片" }, { label: "运输扣款", value: item.deductFromFreight ? (item.tripNo ?? "待关联趟次") : "不扣减运费" }, { label: "时间", value: displayDate(item.refueledAt) }, { label: "状态", value: item.status }] }) }))} />
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50/40 shadow-sm"><CardHeader><p className="text-xs font-semibold tracking-[0.12em] text-amber-800">财务期间控制 · 调整链</p><CardTitle className="mt-1 text-base">日结封存、授权反结账与版本快照</CardTitle><CardDescription className="mt-1">已封存日期的流水、发票、采购结算和冲销会由服务端拦截。仅财务负责人可填写原因授权反结账；重新封存后生成新版本，旧快照与反结账原因永久保留。</CardDescription></CardHeader><CardContent className="space-y-3">{dailyAccountingReport.data ? <><div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white/80 p-3"><div><p className="text-sm font-semibold text-slate-900">{dailyAccountingReport.data.closure.closingNo} · 第 {dailyAccountingReport.data.closure.revision ?? 1} 版</p><p className="mt-1 text-xs text-slate-600">当前状态：{dailyAccountingReport.data.closure.status === "reopened" ? "已授权反结账，允许补充后重新封存" : "已封存，写入已锁定"} · 快照 {dailyAccountingReport.data.closure.snapshotHash.slice(0, 16)}…</p></div><BusinessStatusBadge status={dailyAccountingReport.data.closure.status} /></div>{dailyAccountingReport.data.closure.status === "closed" ? <div className="grid gap-2 md:grid-cols-[1fr_auto]"><Input value={financeReopenReason} maxLength={500} placeholder="反结账原因（至少 5 个字，例如：补充已核实的原始凭证）" onChange={event => setFinanceReopenReason(event.target.value)} /><Button variant="outline" disabled={reopenDailyAccount.isPending || financeReopenReason.trim().length < 5} onClick={() => reopenDailyAccount.mutate({ projectId: Number(financeProjectId), closingDate: financeClosingDate, reason: financeReopenReason.trim() })}>{reopenDailyAccount.isPending ? "正在授权…" : "授权反结账"}</Button></div> : <p className="text-sm text-amber-900">当前日期已反结账。请完成受控调整后重新执行日结，系统会生成下一版本快照。</p>}</> : <p className="text-sm text-slate-600">选择已封存日期后可查看版本快照和受控调整状态。</p>}</CardContent></Card>
        <Card className="w-full border-[#d8e3e0] shadow-sm"><CardHeader><p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">财务审计 · 综合台账</p><CardTitle className="mt-1 text-base">发票、成本与审计台账</CardTitle><CardDescription className="mt-1">发票行内集中展示往来单位、开票日期、金额、税额与状态；柴油领用和会计日结保留为关联业务台账，不重复展示发票列表。</CardDescription></CardHeader><CardContent>{financeInvoices.isLoading ? <EmptyState text="正在读取发票台账…" /> : <div className="overflow-x-auto rounded-xl border border-[#e1e8e4]"><Table className="min-w-[1080px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow className="border-[#dce3de] hover:bg-[#edf1ed]"><TableHead className="h-11 px-4 font-semibold text-[#46615a]">发票号码</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">往来单位</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">开票日期</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">发票类型</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">金额</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">税额</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">状态</TableHead><TableHead className="h-11 px-4 text-right font-semibold text-[#46615a]">操作</TableHead></TableRow></TableHeader><TableBody>{financeInvoices.data?.invoices.length ? financeInvoices.data?.invoices.map(invoice => <TableRow key={invoice.id} className="border-[#edf0ee] hover:bg-[#fbfaf1]"><TableCell className="px-4 py-3 font-semibold text-[#203c48]">{invoice.invoiceNo}</TableCell><TableCell className="px-4 py-3 text-slate-700">{invoice.counterpartyName}</TableCell><TableCell className="px-4 py-3 text-slate-700">{displayDate(invoice.issuedAt)}</TableCell><TableCell className="px-4 py-3 text-slate-700">{invoice.invoiceType}</TableCell><TableCell className="px-4 py-3 font-medium text-slate-800">¥{displayMoney(invoice.amount)}</TableCell><TableCell className="px-4 py-3 text-slate-700">¥{displayMoney(invoice.taxAmount)}</TableCell><TableCell className="px-4 py-3"><BusinessStatusBadge status={invoice.status} /></TableCell><TableCell className="px-4 py-3 text-right"><Button size="sm" variant="outline" onClick={() => setDesktopRecordDetail({ title: `发票审计 · ${invoice.invoiceNo}`, description: "发票详情仍受会计、财务负责人及项目范围的服务端校验。", fields: [{ label: "往来单位", value: invoice.counterpartyName }, { label: "开票日期", value: displayDate(invoice.issuedAt) }, { label: "发票类型", value: invoice.invoiceType }, { label: "金额", value: `¥ ${displayMoney(invoice.amount)}` }, { label: "税额", value: `¥ ${displayMoney(invoice.taxAmount)}` }, { label: "状态", value: <BusinessStatusBadge status={invoice.status} /> }] })}>详情</Button></TableCell></TableRow>) : <TableRow><TableCell colSpan={8} className="px-4 py-10 text-center text-slate-500">当前期间暂无发票，财务岗位可通过发票台账接口登记真实凭证。</TableCell></TableRow>}</TableBody></Table></div>}</CardContent></Card>
        <TaxAccountingHandoffManager projectId={Number(financeProjectId)} period={financePeriod} />
        <Card className="print:border-0 print:shadow-none"><CardHeader><CardTitle className="text-base">后勤每日开支会计日结与打印</CardTitle><CardDescription>日结时由服务端重新汇总当日流水与发票，生成 SHA-256 快照；封存后不可重复日结，可作为每日凭证装订页打印。</CardDescription></CardHeader><CardContent className="space-y-3"><div className="flex flex-wrap items-end gap-3"><div className="grid gap-1.5"><Label>日结日期</Label><Input type="date" value={financeClosingDate} onChange={event => setFinanceClosingDate(event.target.value)} /></div><Button className="bg-[#203c48] hover:bg-[#17313b]" disabled={closeDailyAccount.isPending} onClick={() => closeDailyAccount.mutate({ projectId: Number(financeProjectId), closingDate: financeClosingDate })}>{closeDailyAccount.isPending ? "正在日结…" : "执行日结并封存"}</Button><Button variant="outline" disabled={!dailyAccountingReport.data} onClick={() => window.print()}>打印日结装订页</Button></div>{dailyAccountingReport.data ? <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex flex-wrap justify-between gap-3"><div><p className="font-medium text-slate-900">日结单：{dailyAccountingReport.data.closure.closingNo}</p><p className="mt-1 text-xs text-slate-500">封存日期：{financeClosingDate} · 快照指纹：{dailyAccountingReport.data.closure.snapshotHash.slice(0, 16)}…</p></div><div className="text-right text-sm"><p>收入：¥ {displayMoney(dailyAccountingReport.data.closure.totalIncome)}</p><p>开支：¥ {displayMoney(dailyAccountingReport.data.closure.totalExpense)}</p><p>发票：{dailyAccountingReport.data.closure.invoiceCount} 张 · ¥ {displayMoney(dailyAccountingReport.data.closure.invoiceAmount)}</p></div></div></div> : <p className="text-sm text-slate-500">尚未封存该日期，执行日结后将显示可打印的审计快照。</p>}</CardContent></Card>
      </>}
    </div>;
  };

  const renderRisk = () => {
    const alerts = riskAlerts.data ?? [];
    const openCount = alerts.filter(item => item.status === "open").length;
    const criticalCount = alerts.filter(item => item.severity === "critical" && ["open", "acknowledged"].includes(item.status)).length;
    const validateRule = () => {
      const values = [riskRuleForm.maxFuelFillRatio, riskRuleForm.maxTransportSpeedKmh, riskRuleForm.maxTransportDurationMinutes, riskRuleForm.maxOpenCheckInHours, riskRuleForm.maxPendingReportHours].map(Number);
      const escalationHour = Number(riskRuleForm.overdueEscalationHourChina);
      if (values.some(value => !Number.isFinite(value) || value <= 0)) return toast.error("请填写有效的正数风险阈值");
      if (!Number.isInteger(escalationHour) || escalationHour < 0 || escalationHour > 23) return toast.error("逾期升级检查时间必须为 0—23 点（中国标准时间）");
      if (!financeProjectId) return toast.error("请先选择项目");
      saveRiskRule.mutate({ projectId: Number(financeProjectId), enabled: riskRuleForm.enabled, maxFuelFillRatio: values[0], maxTransportSpeedKmh: values[1], maxTransportDurationMinutes: Math.round(values[2]), maxOpenCheckInHours: Math.round(values[3]), maxPendingReportHours: Math.round(values[4]), overdueEscalationEnabled: riskRuleForm.overdueEscalationEnabled, overdueEscalationHourChina: escalationHour });
    };
    const severityLabel: Record<string, string> = { notice: "提示", warning: "预警", critical: "严重" };
    const categoryLabel: Record<string, string> = { construction: "施工日报", attendance: "考勤", fuel: "柴油", transport: "运输" };
    const pendingRectifications = alerts.filter(item => ["open", "acknowledged", "in_rectification"].includes(item.status));
    return <div className="space-y-5">
      {financeProjectId ? <Card className="border-[#d8e3e0] shadow-sm"><CardHeader className="flex flex-col gap-3 space-y-0 lg:flex-row lg:items-start lg:justify-between"><div><p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">真实配置与整改治理</p><CardTitle className="mt-1 text-base">设备容量、整改期限与逾期升级</CardTitle><CardDescription className="mt-1">请维护现场核定油箱容量。未配置容量的车辆或机械不会触发加油超量规则；逾期升级启用后会在每日指定中国标准时间检查未解决整改并向责任人与项目管理岗位发送站内提醒。</CardDescription></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { setLocation("/admin/vehicles"); }}>维护车辆容量</Button><Button size="sm" variant="outline" onClick={() => { setLocation("/admin/machinery"); }}>维护机械容量</Button><Button size="sm" disabled={runOverdueRiskEscalation.isPending} onClick={() => runOverdueRiskEscalation.mutate({ projectId: Number(financeProjectId) })}>{runOverdueRiskEscalation.isPending ? "正在验收…" : "执行逾期升级验收"}</Button></div></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><MetricCard title="车辆容量已配置" value={`${riskCapacityReadiness.data?.vehicleConfigured ?? 0} / ${riskCapacityReadiness.data?.vehicleTotal ?? 0}`} description="加油超量检测前置条件" icon={Truck} /><MetricCard title="机械容量已配置" value={`${riskCapacityReadiness.data?.machineConfigured ?? 0} / ${riskCapacityReadiness.data?.machineTotal ?? 0}`} description="加油超量检测前置条件" icon={Settings2} /><MetricCard title="待整改风险" value={pendingRectifications.length} description="可分配责任人与期限" icon={ShieldCheck} /><MetricCard title="逾期升级" value={riskRuleForm.overdueEscalationEnabled ? `每日 ${riskRuleForm.overdueEscalationHourChina.padStart(2, "0")}:00` : "未启用"} description="中国标准时间" icon={ScrollText} /></div><div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3"><div className="grid gap-3 md:grid-cols-[1fr_160px_auto]"><div className="flex items-center gap-2"><Checkbox id="risk-overdue-escalation" checked={riskRuleForm.overdueEscalationEnabled} onCheckedChange={checked => setRiskRuleForm(current => ({ ...current, overdueEscalationEnabled: checked === true }))} /><Label htmlFor="risk-overdue-escalation">启用每日整改逾期升级</Label></div><Field label="检查时间（中国标准时间）"><Input type="number" min="0" max="23" step="1" value={riskRuleForm.overdueEscalationHourChina} onChange={event => setRiskRuleForm(current => ({ ...current, overdueEscalationHourChina: event.target.value }))} /></Field><div className="flex items-end"><Button className="w-full" variant="outline" disabled={saveRiskRule.isPending} onClick={validateRule}>保存升级计划</Button></div></div><p className="mt-2 text-xs text-amber-900">任务由平台 Heartbeat 运行，支持重试与同日去重；停用后会暂停该项目调度，不会删除历史整改和升级审计。</p></div>{riskCapacityReadiness.data?.unconfiguredAssets.length ? <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3"><p className="text-sm font-semibold text-rose-900">以下资源尚未维护核定油箱容量，柴油超量检测会跳过：</p><p className="mt-1 text-sm text-rose-800">{riskCapacityReadiness.data.unconfiguredAssets.map(item => `${item.assetType === "vehicle" ? "车辆" : "机械"}·${item.label}`).join("；")}</p></div> : <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-emerald-800">车辆与机械核定油箱容量均已配置，可参与柴油加油量合理性检测。</div>}<div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-slate-800">整改派单</p><p className="mt-1 text-xs text-slate-500">仅可选择当前项目范围内的有效管理人员；到期未解决将按已保存的升级计划提醒责任人与管理岗位。</p></div></div>{pendingRectifications.length ? <div className="mt-3 grid gap-2 lg:grid-cols-2">{pendingRectifications.map(item => <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3" key={item.id}><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-800">{item.title}</p><p className="mt-1 text-xs text-slate-500">状态：{item.status === "in_rectification" ? "整改中" : item.status === "acknowledged" ? "已确认" : "待处置"}{item.dueAt ? ` · 期限 ${displayDate(item.dueAt)}` : " · 尚未设置期限"}</p></div><Button size="sm" variant="outline" onClick={() => setRiskRectificationTarget({ id: Number(item.id), title: item.title, assigneeUserId: item.assigneeUserId ? String(item.assigneeUserId) : "", dueAt: item.dueAt ? new Date(item.dueAt).toISOString().slice(0, 16) : "", rectificationNote: item.rectificationNote ?? "" })}>分配整改</Button></div>)}</div> : <p className="mt-3 text-sm text-slate-500">当前没有待派单风险。先执行真实数据扫描后再分配整改责任。</p>}</div>{riskRectificationTarget ? <div className="rounded-xl border border-[#c9dbd6] bg-[#f5f9f8] p-4"><div className="mb-3 flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-[#203c48]">分配整改：{riskRectificationTarget.title}</p><p className="mt-1 text-xs text-slate-500">责任人、期限和整改说明均会写入审计；期限必须晚于当前时间。</p></div><Button size="sm" variant="ghost" onClick={() => setRiskRectificationTarget(null)}>取消</Button></div><div className="grid gap-3 md:grid-cols-3"><Field label="整改责任人"><Select value={riskRectificationTarget.assigneeUserId || "UNASSIGNED"} onValueChange={value => setRiskRectificationTarget(current => current ? { ...current, assigneeUserId: value === "UNASSIGNED" ? "" : value } : current)}><SelectTrigger><SelectValue placeholder="选择项目管理人员" /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">请选择责任人</SelectItem>{riskAssignees.data?.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name || `管理人员 #${item.id}`}</SelectItem>)}</SelectContent></Select></Field><Field label="整改期限"><Input type="datetime-local" value={riskRectificationTarget.dueAt} onChange={event => setRiskRectificationTarget(current => current ? { ...current, dueAt: event.target.value } : current)} /></Field><Field label="整改说明"><Input value={riskRectificationTarget.rectificationNote} placeholder="例如：核对原始记录并补齐影像" onChange={event => setRiskRectificationTarget(current => current ? { ...current, rectificationNote: event.target.value } : current)} /></Field></div><div className="mt-3 flex justify-end"><Button disabled={!riskRectificationTarget.assigneeUserId || !riskRectificationTarget.dueAt || assignRiskRectification.isPending} onClick={() => { if (!riskRectificationTarget) return; assignRiskRectification.mutate({ id: riskRectificationTarget.id, projectId: Number(financeProjectId), assigneeUserId: Number(riskRectificationTarget.assigneeUserId), dueAt: new Date(riskRectificationTarget.dueAt).toISOString(), rectificationNote: riskRectificationTarget.rectificationNote.trim() || null }); }}>{assignRiskRectification.isPending ? "正在派单…" : "保存责任人与整改期限"}</Button></div></div> : null}</CardContent></Card> : null}
      <Card className="border-[#d8e3e0] shadow-sm"><CardHeader><p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">AI 辅助 · 规则可解释 · 人工可处置</p><CardTitle className="mt-1 text-base">AI 项目风险预警中心</CardTitle><CardDescription className="mt-1">系统先以真实业务记录执行确定性规则：施工日报待办、上下班考勤缺口、加油量与核定油箱容量不符、运输里程与时长/速度不匹配。仅将脱敏的风险计数和费用分类提交给 AI 生成管理摘要；所有预警均可回到原始单据核验。</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-[1fr_180px_180px_auto]"><Select value={financeProjectId} onValueChange={setFinanceProjectId}><SelectTrigger><SelectValue placeholder="选择项目" /></SelectTrigger><SelectContent>{projects.data?.filter(project => project.status !== "archived").map(project => <SelectItem key={project.id} value={String(project.id)}>{project.code} · {project.name}</SelectItem>)}</SelectContent></Select><Input type="month" value={financePeriod} aria-label="风险统计期间" onChange={event => setFinancePeriod(event.target.value)} /><Input type="date" value={riskScanDate} aria-label="风险扫描日期" onChange={event => setRiskScanDate(event.target.value)} /><Button disabled={!financeProjectId || scanProjectRisks.isPending} onClick={() => scanProjectRisks.mutate({ projectId: Number(financeProjectId), businessDate: riskScanDate })}>{scanProjectRisks.isPending ? "正在扫描…" : "立即扫描并提醒"}</Button></CardContent></Card>
      {!financeProjectId ? <EmptyState text="请选择项目后配置风险阈值、扫描真实施工/考勤/柴油/运输记录，并查看本期财务分类。" /> : <>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><MetricCard title="本期未处置预警" value={openCount} description="可确认、解决或忽略" icon={ShieldCheck} /><MetricCard title="严重风险" value={criticalCount} description="请优先回到原始单据核验" icon={ShieldCheck} /><MetricCard title="本期成本" value={riskFinanceAnalysis.data?.expenseAmount} description="分类汇总的真实业务成本" icon={BarChart3} /><MetricCard title="风险扫描日期" value={riskScanDate} description="点击立即扫描生成/刷新风险清单" icon={ScrollText} /></div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]"><Card className="border-[#d8e3e0] shadow-sm"><CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0"><div><CardTitle className="text-base">风险检测阈值</CardTitle><CardDescription>阈值按项目独立保存。未维护核定油箱容量的车辆/机械不会产生“加油超量”结论，需先补全档案。</CardDescription></div><div className="flex items-center gap-2 text-sm"><Checkbox id="risk-enabled" checked={riskRuleForm.enabled} onCheckedChange={checked => setRiskRuleForm(current => ({ ...current, enabled: checked === true }))} /><Label htmlFor="risk-enabled">启用扫描</Label></div></CardHeader><CardContent className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><Field label="单次加油最大容量比例"><Input type="number" min="1" max="3" step="0.01" value={riskRuleForm.maxFuelFillRatio} onChange={event => setRiskRuleForm(current => ({ ...current, maxFuelFillRatio: event.target.value }))} /></Field><Field label="运输最大平均速度（km/h）"><Input type="number" min="20" max="180" step="1" value={riskRuleForm.maxTransportSpeedKmh} onChange={event => setRiskRuleForm(current => ({ ...current, maxTransportSpeedKmh: event.target.value }))} /></Field><Field label="运输最长合理耗时（分钟）"><Input type="number" min="15" max="1440" step="1" value={riskRuleForm.maxTransportDurationMinutes} onChange={event => setRiskRuleForm(current => ({ ...current, maxTransportDurationMinutes: event.target.value }))} /></Field><Field label="上班未下班打卡阈值（小时）"><Input type="number" min="2" max="72" step="1" value={riskRuleForm.maxOpenCheckInHours} onChange={event => setRiskRuleForm(current => ({ ...current, maxOpenCheckInHours: event.target.value }))} /></Field><Field label="日报待办阈值（小时）"><Input type="number" min="1" max="720" step="1" value={riskRuleForm.maxPendingReportHours} onChange={event => setRiskRuleForm(current => ({ ...current, maxPendingReportHours: event.target.value }))} /></Field></div><div className="flex justify-end"><Button disabled={saveRiskRule.isPending} onClick={validateRule}>{saveRiskRule.isPending ? "正在保存…" : "保存项目风险阈值"}</Button></div></CardContent></Card>
          <Card className="border-[#d8e3e0] shadow-sm"><CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0"><div><CardTitle className="text-base">财务分类成本</CardTitle><CardDescription>以已登记的财务流水、柴油、工资、机械成本和维修保养为准，避免用 AI 推测成本。</CardDescription></div><Button size="sm" variant="outline" disabled={!riskFinanceAnalysis.data?.categories.length} onClick={() => downloadCsvFile(`项目成本分类-${financePeriod}.csv`, ["类别", "金额", "占比", "笔数", "来源"], (riskFinanceAnalysis.data?.categories ?? []).map(item => [item.label, item.amount, `${item.percentage}%`, item.recordCount, item.sources.join("、")]))}>导出</Button></CardHeader><CardContent>{riskFinanceAnalysis.data?.categories.length ? <div className="space-y-2">{riskFinanceAnalysis.data.categories.map(item => <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2" key={item.code}><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium text-slate-800">{item.label}</p><p className="text-sm font-semibold text-[#203c48]">¥{displayMoney(item.amount)}</p></div><div className="mt-1 flex justify-between text-xs text-slate-500"><span>{item.percentage}% · {item.recordCount} 笔</span><span>{item.sources.join("、")}</span></div></div>)}<div className="flex justify-between border-t pt-3 text-sm font-semibold"><span>本期分类成本</span><span>¥{displayMoney(riskFinanceAnalysis.data.expenseAmount)}</span></div></div> : <p className="text-sm text-slate-500">当前期间暂无可分类的真实成本记录。</p>}</CardContent></Card></div>
        <Card className="border-[#d8e3e0] shadow-sm"><CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle className="text-base">风险预警台账与管理提醒</CardTitle><CardDescription>新发现的预警会按项目范围向有效项目主管、财务、施工、运输和安全管理人员发送幂等站内提醒；同一单据同一规则同一日期不会重复创建。</CardDescription></div><div className="flex flex-wrap gap-2"><Select value={riskAlertStatus} onValueChange={value => setRiskAlertStatus(value as typeof riskAlertStatus)}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="open">待处置</SelectItem><SelectItem value="acknowledged">已确认</SelectItem><SelectItem value="resolved">已解决</SelectItem><SelectItem value="ignored">已忽略</SelectItem></SelectContent></Select><Button size="sm" variant="outline" onClick={() => riskAlerts.refetch()}>刷新</Button><Button size="sm" variant="outline" disabled={!alerts.length} onClick={() => downloadCsvFile(`项目风险预警-${financePeriod}.csv`, ["日期", "类别", "等级", "规则", "预警内容", "状态"], alerts.map(item => [toBusinessDateInput(item.businessDate), categoryLabel[item.category], severityLabel[item.severity], item.ruleCode, item.summary, item.status]))}>导出</Button></div></CardHeader><CardContent>{riskAlerts.isLoading ? <EmptyState text="正在读取风险预警…" /> : alerts.length ? <div className="overflow-x-auto rounded-xl border border-[#e1e8e4]"><Table className="min-w-[1040px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow><TableHead>业务日期</TableHead><TableHead>类别 / 等级</TableHead><TableHead>预警内容</TableHead><TableHead>计算规则</TableHead><TableHead>状态</TableHead><TableHead className="text-right">处置</TableHead></TableRow></TableHeader><TableBody>{alerts.map(item => <TableRow key={item.id}><TableCell>{toBusinessDateInput(item.businessDate)}</TableCell><TableCell><p>{categoryLabel[item.category]}</p><p className={item.severity === "critical" ? "mt-1 font-medium text-rose-700" : item.severity === "warning" ? "mt-1 font-medium text-amber-700" : "mt-1 text-slate-500"}>{severityLabel[item.severity]}</p></TableCell><TableCell className="max-w-xl whitespace-normal"><p className="font-medium text-slate-800">{item.title}</p><p className="mt-1 text-slate-600">{item.summary}</p></TableCell><TableCell>{item.ruleCode}</TableCell><TableCell><Badge variant="outline">{item.status === "open" ? "待处置" : item.status === "acknowledged" ? "已确认" : item.status === "resolved" ? "已解决" : "已忽略"}</Badge></TableCell><TableCell className="text-right">{["open", "acknowledged"].includes(item.status) ? <div className="flex justify-end gap-2"><Button size="sm" variant="outline" disabled={updateRiskAlertStatus.isPending} onClick={() => updateRiskAlertStatus.mutate({ id: Number(item.id), projectId: Number(financeProjectId), status: "acknowledged", resolutionNote: null })}>确认</Button><Button size="sm" disabled={updateRiskAlertStatus.isPending} onClick={() => updateRiskAlertStatus.mutate({ id: Number(item.id), projectId: Number(financeProjectId), status: "resolved", resolutionNote: "已由管理人员核验处理" })}>解决</Button><Button size="sm" variant="ghost" disabled={updateRiskAlertStatus.isPending} onClick={() => updateRiskAlertStatus.mutate({ id: Number(item.id), projectId: Number(financeProjectId), status: "ignored", resolutionNote: "经管理人员核验不构成异常" })}>忽略</Button></div> : <span className="text-slate-500">已完成处置</span>}</TableCell></TableRow>)}</TableBody></Table></div> : <EmptyState text="当前期间暂无风险预警。请点击“立即扫描并提醒”对选定日期的真实业务记录执行检测。" />}</CardContent></Card>
        <Card className="border-[#d8e3e0] shadow-sm"><CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0"><div><CardTitle className="text-base">AI 管理摘要</CardTitle><CardDescription>AI 仅读取本期风险类别/等级/状态的计数与财务分类金额，不读取姓名、手机号、定位、车牌、影像或凭证内容。摘要仅作辅助管理判断。</CardDescription></div><Button disabled={generateRiskBriefing.isPending} onClick={() => generateRiskBriefing.mutate({ projectId: Number(financeProjectId), period: financePeriod })}>{generateRiskBriefing.isPending ? "正在分析…" : "生成 AI 管理摘要"}</Button></CardHeader><CardContent>{riskBriefing ? <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium text-indigo-950">{riskBriefing.source === "external" ? "外部 AI 辅助摘要" : riskBriefing.source === "builtin" ? "系统内置 AI 辅助摘要" : "规则汇总摘要（AI 服务降级）"}</p><Badge variant="outline">{riskBriefing.model}</Badge></div><p className="text-sm leading-6 text-slate-700">{riskBriefing.executiveSummary}</p><div className="grid gap-3 sm:grid-cols-2"><div><p className="text-xs font-semibold text-slate-600">优先处理</p><ul className="mt-1 space-y-1 text-sm text-slate-700">{riskBriefing.priorityActions.map(item => <li key={item}>· {item}</li>)}</ul></div><div><p className="text-xs font-semibold text-slate-600">持续关注</p><ul className="mt-1 space-y-1 text-sm text-slate-700">{riskBriefing.watchItems.map(item => <li key={item}>· {item}</li>)}</ul></div></div><p className="text-xs text-slate-500">{riskBriefing.disclaimer}</p></div> : <p className="text-sm text-slate-500">生成后将展示本期风险与成本结构的脱敏管理摘要。系统不会让 AI 替代现场核验、财务审核或责任认定。</p>}</CardContent></Card>
      </>}
    </div>;
  };

  const renderLegacyBroadcast = () => {
    const scopeOptions = broadcastForm.audienceType === "project" ? (broadcastOptions.data?.projects ?? []).map(item => ({ value: String(item.id), label: `${item.code} · ${item.name}` })) : broadcastForm.audienceType === "organization" ? (broadcastOptions.data?.organizations ?? []).map(item => ({ value: String(item.id), label: `${item.code} · ${item.name}` })) : (broadcastOptions.data?.roles ?? []).map(item => ({ value: item.code, label: `${item.code} · ${item.name}` }));
    const scopeTitle = broadcastForm.audienceType === "project" ? "收件项目" : broadcastForm.audienceType === "organization" ? "收件组织" : "收件岗位";
    const describeBroadcastScope = (item: NonNullable<typeof broadcasts.data>[number]) => item.audienceType === "project" ? (broadcastOptions.data?.projects ?? []).find(project => project.id === item.projectId)?.name ?? "项目范围" : item.audienceType === "organization" ? (broadcastOptions.data?.organizations ?? []).find(organization => organization.id === item.organizationId)?.name ?? "组织范围" : (broadcastOptions.data?.roles ?? []).find(role => role.code === item.roleCode)?.name ?? "岗位范围";
    const editBroadcast = (item: NonNullable<typeof broadcasts.data>[number]) => setBroadcastForm({ id: Number(item.id), title: item.title, content: item.content, deepLink: item.deepLink ?? "", audienceType: item.audienceType, scopeValue: item.audienceType === "project" ? String(item.projectId ?? "") : item.audienceType === "organization" ? String(item.organizationId ?? "") : item.roleCode ?? "" });
    return <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-medium text-[#203c48]">认证服务号通知中心</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">受控群发设置与发布</h1><p className="mt-2 max-w-3xl text-sm text-slate-500">群发必须限定到单一项目、组织或岗位范围，先预览已绑定收件人数，再经审批发布。投递审计仅展示收件人姓名、职务、授权范围、确认状态和脱敏失败原因，不展示 OpenID 或内部编号。</p></div><Button variant="outline" size="sm" onClick={() => { setBroadcastForm(EMPTY_BROADCAST_FORM); setSelectedBroadcastId(undefined); }}>新建草稿</Button></div>
      <Card className="border-[#d8e3e0]"><CardHeader><CardTitle className="text-base">群发草稿与范围预览</CardTitle><CardDescription>所有范围和收件人均在服务端重新核验；未关注或未绑定服务号的人员会被统计但不会被强行投递。</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-4 lg:grid-cols-2"><div><Label>通知标题</Label><Input className="mt-1" value={broadcastForm.title} maxLength={80} placeholder="例如：本周施工计划调整通知" onChange={event => setBroadcastForm(current => ({ ...current, title: event.target.value }))} /></div><div><Label>系统跳转地址（可选）</Label><Input className="mt-1" value={broadcastForm.deepLink} placeholder="/mobile/messages" onChange={event => setBroadcastForm(current => ({ ...current, deepLink: event.target.value }))} /></div></div><div><Label>通知内容</Label><textarea className="mt-1 min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" value={broadcastForm.content} maxLength={1000} placeholder="请填写不含身份证、银行卡、完整电话号码或其他敏感个人信息的业务通知。" onChange={event => setBroadcastForm(current => ({ ...current, content: event.target.value }))} /></div><div className="grid gap-4 lg:grid-cols-2"><div><Label>收件范围类型</Label><Select value={broadcastForm.audienceType} onValueChange={value => setBroadcastForm(current => ({ ...current, audienceType: value as BroadcastAudienceType, scopeValue: "" }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="project">按项目</SelectItem><SelectItem value="organization">按组织及下级组织</SelectItem><SelectItem value="role">按岗位</SelectItem></SelectContent></Select></div><div><Label>{scopeTitle}</Label><Select value={broadcastForm.scopeValue || undefined} onValueChange={value => setBroadcastForm(current => ({ ...current, scopeValue: value }))} disabled={broadcastOptions.isLoading || !scopeOptions.length}><SelectTrigger className="mt-1"><SelectValue placeholder={broadcastOptions.isLoading ? "正在读取范围选项…" : `选择${scopeTitle}`} /></SelectTrigger><SelectContent>{scopeOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div></div><div className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-3"><div><p className="text-xs text-slate-500">范围内有效人员</p><p className="mt-1 text-xl font-semibold text-slate-800">{validBroadcastScope ? broadcastAudiencePreview.data?.qualifiedCount ?? "—" : "—"}</p></div><div><p className="text-xs text-slate-500">已绑定可投递</p><p className="mt-1 text-xl font-semibold text-emerald-700">{validBroadcastScope ? broadcastAudiencePreview.data?.boundRecipientCount ?? "—" : "—"}</p></div><div><p className="text-xs text-slate-500">未绑定/不会投递</p><p className="mt-1 text-xl font-semibold text-amber-700">{validBroadcastScope ? broadcastAudiencePreview.data?.unboundCount ?? "—" : "—"}</p></div></div>{broadcastAudiencePreview.isError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">范围预览失败：{broadcastAudiencePreview.error.message}</p> : null}<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setBroadcastForm(EMPTY_BROADCAST_FORM)}>清空</Button><Button className="bg-[#203c48] hover:bg-[#17313b]" disabled={!broadcastForm.title.trim() || !broadcastForm.content.trim() || !validBroadcastScope || saveBroadcastDraft.isPending} onClick={() => saveBroadcastDraft.mutate({ id: broadcastForm.id, title: broadcastForm.title.trim(), content: broadcastForm.content.trim(), deepLink: broadcastForm.deepLink.trim() || null, ...getBroadcastAudienceInput(broadcastForm) })}>{saveBroadcastDraft.isPending ? "保存中…" : broadcastForm.id ? "更新草稿" : "保存草稿"}</Button></div></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">发布审批与投递审计</CardTitle><CardDescription>审批通过后才能发布。发布时按当前有效范围重新解析实际绑定收件人，并对每个收件人使用独立幂等键，防止重复投递。</CardDescription></CardHeader><CardContent>{broadcasts.isLoading ? <EmptyState text="正在读取群发台账…" /> : broadcasts.isError ? <EmptyState text="无法读取群发台账，请确认当前账号具有超级管理员权限。" /> : broadcasts.data?.length ? <div className="space-y-3">{broadcasts.data.map(item => <div key={item.id} className={`rounded-xl border p-4 ${selectedBroadcastId === Number(item.id) ? "border-[#203c48] bg-[#f5f9f8]" : "border-slate-200 bg-white"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-slate-900">{item.title}</p><BusinessStatusBadge status={item.status} /></div><p className="mt-1 text-xs text-slate-500">{item.broadcastNo} · 创建于 {displayDate(item.createdAt)} · 范围：{item.audienceType === "project" ? `项目 #${item.projectId}` : item.audienceType === "organization" ? `组织 #${item.organizationId}` : `岗位 ${item.roleCode}`}</p><p className="mt-2 max-w-3xl text-sm text-slate-700">{item.content}</p>{item.reviewNote ? <p className="mt-2 text-xs text-amber-800">审批说明：{item.reviewNote}</p> : null}</div><div className="text-right text-xs text-slate-500"><p>计划收件：{item.recipientCount}</p><p className="mt-1 text-emerald-700">成功：{item.deliveredCount}</p><p className="mt-1 text-rose-700">失败：{item.failedCount}</p><p className="mt-1 text-amber-700">跳过：{item.skippedCount}</p></div></div><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setSelectedBroadcastId(Number(item.id))}>查看投递审计</Button>{["draft", "rejected"].includes(item.status) ? <><Button size="sm" variant="outline" onClick={() => editBroadcast(item)}>编辑</Button><Button size="sm" onClick={() => reviewBroadcast.mutate({ id: Number(item.id), action: "submit", reviewNote: null })} disabled={reviewBroadcast.isPending}>提交审批</Button></> : null}{item.status === "submitted" ? <><Button size="sm" className="bg-[#47754d] hover:bg-[#355c3c]" onClick={() => reviewBroadcast.mutate({ id: Number(item.id), action: "approve", reviewNote: "已核对内容与收件范围" })} disabled={reviewBroadcast.isPending}>审批通过</Button><Button size="sm" variant="outline" className="border-rose-200 text-rose-700" onClick={() => reviewBroadcast.mutate({ id: Number(item.id), action: "reject", reviewNote: "请补充或修正通知内容与收件范围" })} disabled={reviewBroadcast.isPending}>退回修改</Button></> : null}{item.status === "approved" ? <Button size="sm" className="bg-[#8b3f20] hover:bg-[#6d3421]" onClick={() => publishBroadcast.mutate({ id: Number(item.id) })} disabled={publishBroadcast.isPending}>发布服务号通知</Button> : null}{["draft", "submitted", "approved", "rejected"].includes(item.status) ? <Button size="sm" variant="ghost" className="text-slate-500" onClick={() => reviewBroadcast.mutate({ id: Number(item.id), action: "cancel", reviewNote: null })} disabled={reviewBroadcast.isPending}>取消</Button> : null}</div></div>)}</div> : <EmptyState text="尚无群发记录。请先建立范围明确的群发草稿，再预览、审批和发布。" />}</CardContent></Card>
      {selectedBroadcastId ? <Card><CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0"><div><CardTitle className="text-base">逐收件人投递与确认审计</CardTitle><CardDescription>显示姓名、岗位、授权范围、投递结果和“收到”确认时间；不展示内部用户编号、OpenID、手机号或密钥。</CardDescription></div><Button size="sm" variant="outline" onClick={() => broadcastDeliveries.refetch()} disabled={broadcastDeliveries.isFetching}>刷新</Button></CardHeader><CardContent>{broadcastDeliveries.isLoading ? <EmptyState text="正在读取投递审计…" /> : broadcastDeliveries.data?.length ? <div className="space-y-2">{broadcastDeliveries.data.map(delivery => <div key={delivery.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"><div className="min-w-0"><p className="text-sm font-medium text-slate-800">{delivery.recipientName}</p><p className="mt-1 text-xs text-slate-600">{delivery.recipientRole ?? "岗位信息待同步"} · {delivery.recipientScope ?? "授权范围待同步"}</p><p className="mt-1 text-xs text-slate-500">最近尝试：{displayDate(delivery.attemptedAt)}{delivery.deliveryReason ? ` · 失败原因：${delivery.deliveryReason}${delivery.failureCode ? `（微信码 ${delivery.failureCode}）` : ""}` : ""}</p><p className="mt-1 text-xs text-[#80543d]">确认状态：{delivery.acknowledgementStatus === "acknowledged" ? `已确认收到（${displayDate(delivery.acknowledgedAt)}）` : delivery.acknowledgementStatus === "pending" ? "待确认收到" : "无需确认"}</p></div><BusinessStatusBadge status={delivery.deliveryStatus} /></div>)}</div> : <EmptyState text="该群发单尚未生成逐收件人投递记录。" />}</CardContent></Card> : null}
    </div>;
  };

  const renderBroadcast = () => {
    const scopeOptions = broadcastForm.audienceType === "project"
      ? (broadcastOptions.data?.projects ?? []).map(item => ({ value: String(item.id), label: `${item.code} · ${item.name}` }))
      : broadcastForm.audienceType === "organization"
        ? (broadcastOptions.data?.organizations ?? []).map(item => ({ value: String(item.id), label: `${item.code} · ${item.name}` }))
        : (broadcastOptions.data?.roles ?? []).map(item => ({ value: item.code, label: `${item.code} · ${item.name}` }));
    const scopeTitle = broadcastForm.audienceType === "project" ? "收件项目" : broadcastForm.audienceType === "organization" ? "收件组织" : "收件岗位";
    const describeScope = (item: NonNullable<typeof broadcasts.data>[number]) => item.audienceType === "project"
      ? (broadcastOptions.data?.projects ?? []).find(project => project.id === item.projectId)?.name ?? "项目范围"
      : item.audienceType === "organization"
        ? (broadcastOptions.data?.organizations ?? []).find(organization => organization.id === item.organizationId)?.name ?? "组织范围"
        : (broadcastOptions.data?.roles ?? []).find(role => role.code === item.roleCode)?.name ?? "岗位范围";
    const directSendable = (status: string) => ["draft", "rejected", "submitted", "approved"].includes(status);
    return <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-medium text-[#203c48]">范围通知与确认中心</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">范围内站内通知</h1><p className="mt-2 max-w-3xl text-sm text-slate-500">获授权管理员选择单一项目、组织或岗位范围后，可直接向系统消息中心发送通知。此功能不发送微信服务号消息；微信服务号仅用于具体业务事件的合规即时提醒。</p></div><Button variant="outline" size="sm" onClick={() => { setBroadcastForm(EMPTY_BROADCAST_FORM); setSelectedBroadcastId(undefined); }}>新建通知</Button></div>
      <Card className="border-[#d8e3e0]"><CardHeader><CardTitle className="text-base">站内通知内容与发送范围</CardTitle><CardDescription>保存后即向当前授权范围的系统消息中心投递，并可要求收件人“确认收到”。本页的成功数量不代表微信服务号已送达。</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-4 lg:grid-cols-2"><div><Label>通知标题</Label><Input className="mt-1" value={broadcastForm.title} maxLength={80} placeholder="例如：本周施工计划调整通知" onChange={event => setBroadcastForm(current => ({ ...current, title: event.target.value }))} /></div><div><Label>系统跳转地址（可选）</Label><Input className="mt-1" value={broadcastForm.deepLink} placeholder="/mobile/messages" onChange={event => setBroadcastForm(current => ({ ...current, deepLink: event.target.value }))} /></div></div><div><Label>通知内容</Label><textarea className="mt-1 min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" value={broadcastForm.content} maxLength={1000} placeholder="请填写不含身份证、银行卡、完整电话号码或其他敏感个人信息的业务通知。" onChange={event => setBroadcastForm(current => ({ ...current, content: event.target.value }))} /></div><div className="grid gap-4 lg:grid-cols-2"><div><Label>范围类型</Label><Select value={broadcastForm.audienceType} onValueChange={value => setBroadcastForm(current => ({ ...current, audienceType: value as BroadcastAudienceType, scopeValue: "" }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="project">按项目</SelectItem><SelectItem value="organization">按组织及下级组织</SelectItem><SelectItem value="role">按岗位</SelectItem></SelectContent></Select></div><div><Label>{scopeTitle}</Label><Select value={broadcastForm.scopeValue || undefined} onValueChange={value => setBroadcastForm(current => ({ ...current, scopeValue: value }))} disabled={broadcastOptions.isLoading || !scopeOptions.length}><SelectTrigger className="mt-1"><SelectValue placeholder={broadcastOptions.isLoading ? "正在读取范围选项…" : `选择${scopeTitle}`} /></SelectTrigger><SelectContent>{scopeOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div></div><div className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-3"><div><p className="text-xs text-slate-500">范围内有效人员</p><p className="mt-1 text-xl font-semibold text-slate-800">{validBroadcastScope ? broadcastAudiencePreview.data?.qualifiedCount ?? "—" : "—"}</p></div><div><p className="text-xs text-slate-500">已绑定服务号</p><p className="mt-1 text-xl font-semibold text-emerald-700">{validBroadcastScope ? broadcastAudiencePreview.data?.boundRecipientCount ?? "—" : "—"}</p></div><div><p className="text-xs text-slate-500">未绑定服务号</p><p className="mt-1 text-xl font-semibold text-amber-700">{validBroadcastScope ? broadcastAudiencePreview.data?.unboundCount ?? "—" : "—"}</p></div></div>{broadcastAudiencePreview.isError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">范围预览失败：{broadcastAudiencePreview.error.message}</p> : null}<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setBroadcastForm(EMPTY_BROADCAST_FORM)}>清空</Button><Button className="bg-[#203c48] hover:bg-[#17313b]" disabled={!broadcastForm.title.trim() || !broadcastForm.content.trim() || !validBroadcastScope || saveBroadcastDraft.isPending || publishBroadcast.isPending} onClick={() => saveBroadcastDraft.mutate({ id: broadcastForm.id, title: broadcastForm.title.trim(), content: broadcastForm.content.trim(), deepLink: broadcastForm.deepLink.trim() || null, ...getBroadcastAudienceInput(broadcastForm) })}>{saveBroadcastDraft.isPending || publishBroadcast.isPending ? "正在发送…" : "保存并发送站内通知"}</Button></div></CardContent></Card>
      <Card className="w-full border-[#d8e3e0] shadow-sm"><CardHeader><p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">范围通知 · 综合台账</p><CardTitle className="mt-1 text-base">站内通知、投递与确认台账</CardTitle><CardDescription className="mt-1">每条通知行内展示发送范围、计划收件、送达、失败与确认数量；投递明细在同一行下方展开，不再另设重复通知列表。微信服务号业务事件不在本表重复计入。</CardDescription></CardHeader><CardContent>{broadcasts.isLoading ? <EmptyState text="正在读取范围通知台账…" /> : broadcasts.isError ? <EmptyState text="无法读取范围通知台账，请确认当前账号具有超级管理员权限。" /> : <div className="overflow-x-auto rounded-xl border border-[#e1e8e4]"><Table className="min-w-[1280px] text-xs"><TableHeader className="bg-[#edf1ed]"><TableRow className="border-[#dce3de] hover:bg-[#edf1ed]"><TableHead className="h-11 px-4 font-semibold text-[#46615a]">通知 / 内容</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">发送范围</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">计划收件</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">已送达</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">失败 / 跳过</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">已确认</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">状态</TableHead><TableHead className="h-11 px-4 font-semibold text-[#46615a]">创建时间</TableHead><TableHead className="h-11 px-4 text-right font-semibold text-[#46615a]">操作</TableHead></TableRow></TableHeader><TableBody>{broadcasts.data?.length ? broadcasts.data.map(item => { const isExpanded = isInlineBroadcastDeliveryExpanded(selectedBroadcastId, Number(item.id)); return <><TableRow key={item.id} className={isExpanded ? "border-[#c9dbd6] bg-[#f5f9f8]" : "border-[#edf0ee] hover:bg-[#fbfaf1]"}><TableCell className="max-w-[300px] px-4 py-3"><p className="font-semibold text-[#203c48]">{item.title}</p><p className="mt-1 line-clamp-2 text-slate-500">{item.content}</p></TableCell><TableCell className="px-4 py-3 text-slate-700">{describeScope(item)}</TableCell><TableCell className="px-4 py-3 text-slate-700">{item.recipientCount}</TableCell><TableCell className="px-4 py-3 text-emerald-700">{item.deliveredCount}</TableCell><TableCell className="px-4 py-3"><p className="text-rose-700">失败 {item.failedCount}</p><p className="mt-1 text-amber-700">跳过 {item.skippedCount}</p></TableCell><TableCell className="px-4 py-3 text-[#80543d]">{item.acknowledgedCount ?? 0}</TableCell><TableCell className="px-4 py-3"><BusinessStatusBadge status={item.status} /></TableCell><TableCell className="px-4 py-3 text-slate-700">{displayDate(item.createdAt)}</TableCell><TableCell className="px-4 py-3 text-right"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setSelectedBroadcastId(isExpanded ? undefined : Number(item.id))}>{isExpanded ? "收起明细" : "投递明细"}</Button>{directSendable(item.status) ? <Button size="sm" className="bg-[#8b3f20] hover:bg-[#6d3421]" onClick={() => publishBroadcast.mutate({ id: Number(item.id) })} disabled={publishBroadcast.isPending}>按范围发送</Button> : null}</div></TableCell></TableRow>{isExpanded ? <TableRow key={`${item.id}-deliveries`} className="border-[#c9dbd6] bg-[#f8fbf8]"><TableCell colSpan={9} className="px-4 py-4"><div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-800">投递明细与确认状态</p><p className="mt-1 text-xs text-slate-500">显示姓名、岗位、授权范围、投递结果、失败原因和“收到”确认时间；不展示内部编号或敏感身份信息。</p></div><Button size="sm" variant="outline" onClick={() => broadcastDeliveries.refetch()} disabled={broadcastDeliveries.isFetching}>{broadcastDeliveries.isFetching ? "正在刷新…" : "刷新明细"}</Button></div>{broadcastDeliveries.isLoading ? <EmptyState text="正在读取投递明细…" /> : broadcastDeliveries.data?.length ? <div className="grid gap-2 lg:grid-cols-2">{broadcastDeliveries.data.map(delivery => <div key={delivery.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"><div className="min-w-0"><p className="text-sm font-medium text-slate-800">{delivery.recipientName}</p><p className="mt-1 text-xs text-slate-600">{delivery.recipientRole ?? "岗位信息待同步"} · {delivery.recipientScope ?? "授权范围待同步"}</p><p className="mt-1 text-xs text-slate-500">最近尝试：{displayDate(delivery.attemptedAt)}{delivery.deliveryReason ? ` · 原因：${delivery.deliveryReason}` : ""}</p>{delivery.failureGuidance ? <p className="mt-1 text-xs text-amber-800">处理建议：{delivery.failureGuidance}</p> : null}<p className="mt-1 text-xs text-[#80543d]">确认状态：{delivery.acknowledgementStatus === "acknowledged" ? `已确认收到（${displayDate(delivery.acknowledgedAt)}）` : delivery.acknowledgementStatus === "pending" ? "待确认收到" : "无需确认"}</p></div><BusinessStatusBadge status={delivery.deliveryStatus} /></div>)}</div> : <EmptyState text="该通知尚未生成逐收件人投递记录。" />}</TableCell></TableRow> : null}</>; }) : <TableRow><TableCell colSpan={9} className="px-4 py-10 text-center text-slate-500">尚无范围通知记录。填写通知内容并选择范围后可发送站内通知。</TableCell></TableRow>}</TableBody></Table></div>}</CardContent></Card>
    </div>;
  };

  const renderMeasurementTools = () => <div className="space-y-6"><div><p className="text-sm font-medium text-[#203c48]">计量工具 · 独立测算工作区</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">工程计量与施工辅助工具</h1><p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">集中提供土石方、附属工程、混凝土材料、机械台班、运输运价和公路铁路施工知识。所有工具仅用于方案测算、学习和打印，不会自动写入项目部收方、施工队分包批次或财务结算台账。</p></div><Card className="border-[#d8e3e0] bg-[#f8fbfa]"><CardContent className="grid gap-3 p-4 md:grid-cols-4"><div><p className="font-medium text-[#203c48]">一、土石方结算</p><p className="mt-1 text-xs leading-5 text-slate-500">按桩号录入天然方土石方，结合土石系数计算运输、填方和分包双价。</p></div><div><p className="font-medium text-[#203c48]">二、附属工程结算</p><p className="mt-1 text-xs leading-5 text-slate-500">按里程、涵洞、边沟、挡墙等构件录入图纸参数并自动计算方量。</p></div><div><p className="font-medium text-[#203c48]">三、施工辅助测算</p><p className="mt-1 text-xs leading-5 text-slate-500">混凝土材料、机械台班和运输运价按输入参数即时测算，结果须由现场和商务人员复核。</p></div><div><p className="font-medium text-[#203c48]">四、公铁知识库</p><p className="mt-1 text-xs leading-5 text-slate-500">按通用、公路、铁路、计量造价和试验检测分类查询术语、应用及公式。</p></div></CardContent></Card><ConstructionToolbox /><SettlementTemplateCalculator /><RoadRailKnowledgeBase /></div>;

  const content = activeSection === "organization" ? renderOrganization() : activeSection === "vehicles" ? renderVehicles() : activeSection === "construction" ? renderConstruction() : activeSection === "labor" ? renderLabor() : activeSection === "machinery" ? renderMachinery() : activeSection === "transport" ? <>{renderTransport()}{renderRfidManagement()}</> : activeSection === "purchasing" ? renderPurchasing() : activeSection === "measurement-tools" ? renderMeasurementTools() : activeSection === "subcontract" ? renderSubcontract() : activeSection === "contracts" ? <ContractManagementPanel projects={(projects.data ?? []).map(project => ({ id: project.id, name: project.name }))} /> : activeSection === "permission" ? renderPermissions() : activeSection === "risk" ? renderRisk() : (activeSection === "finance" || activeSection === "diesel") ? renderFinance() : activeSection === "broadcast" ? renderBroadcast() : activeSection === "wechat-login" ? renderWechatLogin() : activeSection === "business" ? renderBusiness() : activeSection === "settings" ? renderSettings() : activeSection === "audit" ? renderAudit() : renderOverview();

  return (
    <DashboardLayout title="工程云管 · 管理后台" menuItems={ADMIN_MENU}>
      <div className="mx-auto max-w-7xl space-y-6 py-3">
        <Tabs value={activeSection} onValueChange={value => setLocation(value === "overview" ? "/admin" : `/admin/${value}`)} className="lg:hidden">
          <TabsList aria-label="超级管理后台业务菜单" className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-[#dce3de] bg-[#f8f8f4] p-1 shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsTrigger className="h-10 shrink-0 whitespace-nowrap px-3 text-xs" value="overview">概览</TabsTrigger>
            <TabsTrigger className="h-10 shrink-0 whitespace-nowrap px-3 text-xs" value="organization">组织</TabsTrigger>
            <TabsTrigger className="h-10 shrink-0 whitespace-nowrap px-3 text-xs" value="vehicles">车辆</TabsTrigger>
            <TabsTrigger className="h-10 shrink-0 whitespace-nowrap px-3 text-xs" value="construction">施工</TabsTrigger>
            <TabsTrigger className="h-10 shrink-0 whitespace-nowrap px-3 text-xs" value="labor">劳务</TabsTrigger>
            <TabsTrigger className="h-10 shrink-0 whitespace-nowrap px-3 text-xs" value="machinery">机械</TabsTrigger>
            <TabsTrigger className="h-10 shrink-0 whitespace-nowrap px-3 text-xs" value="transport">运输</TabsTrigger>
            <TabsTrigger className="h-10 shrink-0 whitespace-nowrap px-3 text-xs" value="permission">权限</TabsTrigger>
            <TabsTrigger className="h-10 shrink-0 whitespace-nowrap px-3 text-xs" value="finance">财务</TabsTrigger>
            <TabsTrigger className="h-10 shrink-0 whitespace-nowrap px-3 text-xs" value="subcontract">分包</TabsTrigger>
            <TabsTrigger className="h-10 shrink-0 whitespace-nowrap px-3 text-xs" value="risk">AI 风控</TabsTrigger>
            <TabsTrigger className="h-10 shrink-0 whitespace-nowrap px-3 text-xs" value="broadcast">群发</TabsTrigger>
            <TabsTrigger className="h-10 shrink-0 whitespace-nowrap px-3 text-xs" value="wechat-login">微信登录</TabsTrigger>
            <TabsTrigger className="h-10 shrink-0 whitespace-nowrap px-3 text-xs" value="business">业务治理</TabsTrigger>
            <TabsTrigger className="h-10 shrink-0 whitespace-nowrap px-3 text-xs" value="settings">设置</TabsTrigger>
            <TabsTrigger className="h-10 shrink-0 whitespace-nowrap px-3 text-xs" value="audit">审计</TabsTrigger>
          </TabsList>
        </Tabs>
        <Suspense fallback={<Card className="border-[#d8e3e0] bg-[#f8fcfb]"><CardContent className="p-6 text-sm text-slate-600">正在加载当前管理工作区…</CardContent></Card>}>
          {content}
          {activeSection === "transport" && workspaceProjectId ? <RfidLocalWriterPanel projectId={workspaceProjectId} onUidRead={uid => { const activeWriter = (rfidWriterDevices.data ?? []).find(device => device.status === "active"); const defaultVehicle = transportVehicleLedger.data?.[0]; setRfidPendingUid(uid); setRfidCardForm({ ...EMPTY_RFID_CARD_FORM, vehicleId: defaultVehicle ? String(defaultVehicle.id) : "", writerDeviceId: activeWriter ? String(activeWriter.id) : "", cardUid: uid, driverPhone: defaultVehicle?.driverPhone || "" }); setRfidCardDialogOpen(true); }} /> : null}
        </Suspense>
        <AlertDialog open={Boolean(masterDataDeleteTarget)} onOpenChange={open => { if (!open) setMasterDataDeleteTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{masterDataDeleteTarget?.resource === "role_assignment" ? "确认撤销角色授权？" : "确认删除主数据？"}</AlertDialogTitle>
              <AlertDialogDescription>{masterDataDeleteTarget?.description ?? "系统将在服务端校验关联业务数据。仍被引用的记录将被拒绝删除，并提示改为停用或归档。"}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={removeMasterData.isPending}>取消</AlertDialogCancel>
              <AlertDialogAction className="bg-rose-700 hover:bg-rose-800" disabled={!masterDataDeleteTarget || removeMasterData.isPending} onClick={() => { if (masterDataDeleteTarget) removeMasterData.mutate({ resource: masterDataDeleteTarget.resource, id: masterDataDeleteTarget.id }); }}>{masterDataDeleteTarget?.resource === "role_assignment" ? "确认撤销" : "确认删除"}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Dialog open={Boolean(desktopRecordDetail)} onOpenChange={open => { if (!open) setDesktopRecordDetail(null); }}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{desktopRecordDetail?.title}</DialogTitle><DialogDescription>{desktopRecordDetail?.description}</DialogDescription></DialogHeader><dl className="grid gap-3 py-2 sm:grid-cols-2">{desktopRecordDetail?.fields.map(field => <div key={field.label} className="rounded-lg border border-slate-100 bg-slate-50 p-3"><dt className="text-xs text-slate-500">{field.label}</dt><dd className="mt-1 text-sm font-medium text-slate-800">{field.value}</dd></div>)}</dl>{desktopRecordDetail?.note ? <p className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">{desktopRecordDetail.note}</p> : null}<DialogFooter><Button onClick={() => setDesktopRecordDetail(null)}>关闭</Button></DialogFooter></DialogContent></Dialog>
        <Dialog open={machineDialogOpen} onOpenChange={open => { if (!open) { setMachineDialogOpen(false); setMachineForm(EMPTY_MACHINE_FORM); } }}>
          <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
            <DialogHeader><DialogTitle>{machineForm.id ? "维护机械档案" : "新建机械档案"}</DialogTitle><DialogDescription>项目、操作员、产权/租赁、资产标识与状态均由超级管理后台受控维护；已退役机械仅改变状态，不物理删除历史成本与责任记录。</DialogDescription></DialogHeader>
            <form className="space-y-4" onSubmit={event => { event.preventDefault(); saveMachine.mutate({ id: machineForm.id, projectId: Number(machineForm.projectId), operatorUserId: machineForm.operatorUserId ? Number(machineForm.operatorUserId) : null, code: machineForm.code.trim(), name: machineForm.name.trim(), model: machineForm.model.trim() || null, ownership: machineForm.ownership, supplierName: machineForm.supplierName.trim() || null, plateOrAssetNo: machineForm.plateOrAssetNo.trim() || null, driverName: machineForm.driverName.trim() || null, driverPhone: machineForm.driverPhone.trim() || null, fuelTankCapacityLiters: machineForm.fuelTankCapacityLiters ? Number(machineForm.fuelTankCapacityLiters) : null, status: machineForm.status, leaseTerms: machineForm.leaseRate && machineForm.leaseStartDate ? { billingType: machineForm.leaseBillingType, rate: Number(machineForm.leaseRate), effectiveFrom: machineForm.leaseStartDate, effectiveTo: machineForm.leaseEndDate || null } : null }); }}>
              <div className="grid gap-4 sm:grid-cols-2"><Field label="所属项目"><Select value={machineForm.projectId || "UNASSIGNED"} onValueChange={value => setMachineForm(current => ({ ...current, projectId: value === "UNASSIGNED" ? "" : value }))}><SelectTrigger><SelectValue placeholder="选择项目" /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">请选择项目</SelectItem>{projects.data?.filter(project => project.status !== "archived").map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select></Field><Field label="机械状态"><Select value={machineForm.status} onValueChange={value => setMachineForm(current => ({ ...current, status: value as MachineStatus }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="idle">闲置</SelectItem><SelectItem value="working">作业中</SelectItem><SelectItem value="repairing">维修中</SelectItem><SelectItem value="offsite">场外</SelectItem><SelectItem value="retired">已退役</SelectItem></SelectContent></Select></Field></div>
              <div className="grid gap-4 sm:grid-cols-2"><Field label="机械编号"><Input value={machineForm.code} placeholder="例如 EXC-001" onChange={event => setMachineForm(current => ({ ...current, code: event.target.value.toUpperCase() }))} /></Field><Field label="机械名称"><Input value={machineForm.name} placeholder="例如 挖掘机" onChange={event => setMachineForm(current => ({ ...current, name: event.target.value }))} /></Field></div>
              <div className="grid gap-4 sm:grid-cols-3"><Field label="型号"><Input value={machineForm.model} placeholder="可选" onChange={event => setMachineForm(current => ({ ...current, model: event.target.value }))} /></Field><Field label="资产编号 / 车牌"><Input value={machineForm.plateOrAssetNo} placeholder="可选" onChange={event => setMachineForm(current => ({ ...current, plateOrAssetNo: event.target.value }))} /></Field><Field label="核定油箱容量（L）"><Input type="number" min="0.01" step="0.01" value={machineForm.fuelTankCapacityLiters} placeholder="用于柴油合理性检测" onChange={event => setMachineForm(current => ({ ...current, fuelTankCapacityLiters: event.target.value }))} /></Field></div>
              <div className="grid gap-4 sm:grid-cols-3"><Field label="产权类型"><Select value={machineForm.ownership} onValueChange={value => setMachineForm(current => ({ ...current, ownership: value as MachineOwnership }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="owned">自有</SelectItem><SelectItem value="leased">外租</SelectItem></SelectContent></Select></Field><Field label="供应商 / 出租方"><Input value={machineForm.supplierName} placeholder="自有可不填" onChange={event => setMachineForm(current => ({ ...current, supplierName: event.target.value }))} /></Field><Field label="操作员"><Select value={machineForm.operatorUserId || "UNASSIGNED"} onValueChange={value => setMachineForm(current => ({ ...current, operatorUserId: value === "UNASSIGNED" ? "" : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">暂不分配</SelectItem>{users.data?.map(user => <SelectItem key={user.id} value={String(user.id)}>{user.name || `用户 #${user.id}`}</SelectItem>)}</SelectContent></Select></Field></div>
              <div className="grid gap-4 sm:grid-cols-2"><Field label="驾驶员姓名"><Input value={machineForm.driverName} maxLength={128} placeholder="可选" onChange={event => setMachineForm(current => ({ ...current, driverName: event.target.value }))} /></Field><Field label="驾驶员手机"><Input value={machineForm.driverPhone} inputMode="tel" maxLength={32} placeholder="加密保存，仅授权范围可见" onChange={event => setMachineForm(current => ({ ...current, driverPhone: event.target.value }))} /></Field></div>
              <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3"><div><p className="text-sm font-semibold text-amber-950">会计产值计价规则</p><p className="mt-1 text-xs text-amber-800">自有与外租机械均可维护固定月租、日租、小时或台班计价，供会计月度明细按真实出勤与加班核算。外租机械仍须同时填写出租方、计价和租期。</p></div><div className="grid gap-3 sm:grid-cols-2"><Field label="计费方式"><Select value={machineForm.leaseBillingType} onValueChange={value => setMachineForm(current => ({ ...current, leaseBillingType: value as LeaseBillingType }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monthly">固定月租</SelectItem><SelectItem value="daily">日租</SelectItem><SelectItem value="hourly">小时租</SelectItem><SelectItem value="shift">台班</SelectItem></SelectContent></Select></Field><Field label="固定租金 / 单价（元）"><Input type="number" min="0.01" step="0.01" value={machineForm.leaseRate} placeholder={machineForm.ownership === "leased" ? "外租必填" : "会计月结需要时填写"} onChange={event => setMachineForm(current => ({ ...current, leaseRate: event.target.value }))} /></Field></div><div className="grid gap-3 sm:grid-cols-2"><Field label="生效 / 起租日期"><Input type="date" value={machineForm.leaseStartDate} onChange={event => setMachineForm(current => ({ ...current, leaseStartDate: event.target.value }))} /></Field><Field label="截止日期"><Input type="date" min={machineForm.leaseStartDate || undefined} value={machineForm.leaseEndDate} onChange={event => setMachineForm(current => ({ ...current, leaseEndDate: event.target.value }))} /></Field></div></section>
              <DialogFooter><Button type="button" variant="outline" onClick={() => { setMachineDialogOpen(false); setMachineForm(EMPTY_MACHINE_FORM); }}>取消</Button><Button type="submit" disabled={!machineForm.projectId || machineForm.code.trim().length < 2 || machineForm.name.trim().length < 2 || (machineForm.ownership === "leased" && (!machineForm.supplierName || !machineForm.leaseRate || !machineForm.leaseStartDate)) || saveMachine.isPending}>{saveMachine.isPending ? "正在保存…" : machineForm.id ? "保存机械档案" : "建立机械档案"}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog open={machineCostDialogOpen} onOpenChange={open => { if (!open) { setMachineCostDialogOpen(false); setMachineCostForm(EMPTY_MACHINE_COST_FORM); } }}>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>录入机械成本</DialogTitle><DialogDescription>成本金额仅由服务端按数量乘单价计算，保存后先进入草稿状态，再由受权岗位审核、结算或作废。</DialogDescription></DialogHeader>
            <form className="space-y-4" onSubmit={event => { event.preventDefault(); saveMachineCost.mutate({ machineId: Number(machineCostForm.machineId), projectId: Number(machineCostForm.projectId), costType: machineCostForm.costType, quantity: Number(machineCostForm.quantity), unitPrice: Number(machineCostForm.unitPrice), occurredAt: new Date(machineCostForm.occurredAt).toISOString(), evidenceId: null }); }}>
              <div className="grid gap-4 sm:grid-cols-2"><Field label="机械"><Input value={selectedMachineForDialog ? `${selectedMachineForDialog.name}（${selectedMachineForDialog.code}）` : ""} disabled /></Field><Field label="发生时间"><Input type="datetime-local" value={machineCostForm.occurredAt} onChange={event => setMachineCostForm(current => ({ ...current, occurredAt: event.target.value }))} /></Field></div>
              <div className="grid gap-4 sm:grid-cols-3"><Field label="成本类别"><Select value={machineCostForm.costType} onValueChange={value => setMachineCostForm(current => ({ ...current, costType: value as MachineCostType }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fuel">油料</SelectItem><SelectItem value="repair">维修</SelectItem><SelectItem value="overtime">加班</SelectItem><SelectItem value="mobilization">进退场</SelectItem><SelectItem value="other">其他</SelectItem></SelectContent></Select></Field><Field label="数量"><Input type="number" min="0" step="0.001" value={machineCostForm.quantity} onChange={event => setMachineCostForm(current => ({ ...current, quantity: event.target.value }))} /></Field><Field label="单价（元）"><Input type="number" min="0" step="0.01" value={machineCostForm.unitPrice} onChange={event => setMachineCostForm(current => ({ ...current, unitPrice: event.target.value }))} /></Field></div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => { setMachineCostDialogOpen(false); setMachineCostForm(EMPTY_MACHINE_COST_FORM); }}>取消</Button><Button type="submit" disabled={!machineCostForm.machineId || !machineCostForm.projectId || !machineCostForm.occurredAt || !Number.isFinite(Number(machineCostForm.quantity)) || Number(machineCostForm.quantity) < 0 || !Number.isFinite(Number(machineCostForm.unitPrice)) || Number(machineCostForm.unitPrice) < 0 || saveMachineCost.isPending}>{saveMachineCost.isPending ? "正在保存…" : "保存成本草稿"}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog open={machineStatementDialogOpen} onOpenChange={open => { setMachineStatementDialogOpen(open); if (!open) setMachineStatementForm(EMPTY_MACHINE_MONTHLY_STATEMENT_FORM); }}>
          <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
            <DialogHeader><DialogTitle>会计机械月度明细</DialogTitle><DialogDescription>按会计模板录入出勤、司机固定工资、加班与签字。机械产值、维修费、油耗、司机工资和机械分成始终由服务端按项目真实成本和生效计价规则生成。</DialogDescription></DialogHeader>
            <form className="space-y-4" onSubmit={event => { event.preventDefault(); saveMachineMonthlyStatement.mutate({ machineId: Number(machineStatementForm.machineId), projectId: Number(machineStatementForm.projectId), period: machineStatementForm.period, driverUserId: machineStatementForm.driverUserId ? Number(machineStatementForm.driverUserId) : null, machineWorkDays: Number(machineStatementForm.machineWorkDays), machineOvertimeHours: Number(machineStatementForm.machineOvertimeHours), driverMonthlyWage: Number(machineStatementForm.driverMonthlyWage), driverWorkDays: Number(machineStatementForm.driverWorkDays), driverOvertimeHours: Number(machineStatementForm.driverOvertimeHours), signatureName: machineStatementForm.signatureName.trim() || null, remarks: machineStatementForm.remarks.trim() || null }); }}>
              <div className="grid gap-3 sm:grid-cols-3"><Field label="机械"><Input disabled value={machineMonthlyPreview.data?.machine ? `${machineMonthlyPreview.data.machine.name}（${machineMonthlyPreview.data.machine.code}）` : ((machineryLedger.data ?? []).find(item => String(item.id) === machineStatementForm.machineId) ? `${(machineryLedger.data ?? []).find(item => String(item.id) === machineStatementForm.machineId)?.name}（待核算）` : "未选择机械")} /></Field><Field label="结算期间"><Input type="month" value={machineStatementForm.period} onChange={event => setMachineStatementForm(current => ({ ...current, period: event.target.value }))} /></Field><Field label="司机 / 操作员"><Select value={machineStatementForm.driverUserId || "UNASSIGNED"} onValueChange={value => setMachineStatementForm(current => ({ ...current, driverUserId: value === "UNASSIGNED" ? "" : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">按机械绑定操作员 / 未分配</SelectItem>{users.data?.map(user => <SelectItem key={user.id} value={String(user.id)}>{user.name || `用户 #${user.id}`}</SelectItem>)}</SelectContent></Select></Field></div>
              <section className="rounded-xl border border-[#d8e3e0] bg-[#f8fcfb] p-3"><div className="mb-3"><p className="text-sm font-semibold text-[#203c48]">机械产值口径</p><p className="mt-1 text-xs text-slate-500">固定月租按“月租 ÷ 30 × 出勤天数”计算；机械加班默认按“月租 ÷ 30 ÷ 10 × 小时”计算，存在合同加班单价时优先使用合同单价。</p></div><div className="grid gap-3 sm:grid-cols-2"><Field label="机械出勤天数"><Input type="number" min="0" max="31" step="0.5" value={machineStatementForm.machineWorkDays} onChange={event => setMachineStatementForm(current => ({ ...current, machineWorkDays: event.target.value }))} /></Field><Field label="机械加班（小时）"><Input type="number" min="0" max="744" step="0.5" value={machineStatementForm.machineOvertimeHours} onChange={event => setMachineStatementForm(current => ({ ...current, machineOvertimeHours: event.target.value }))} /></Field></div></section>
              <section className="rounded-xl border border-[#d8e3e0] bg-[#f8fcfb] p-3"><div className="mb-3"><p className="text-sm font-semibold text-[#203c48]">司机工资口径</p><p className="mt-1 text-xs text-slate-500">司机总工资按“固定工资 ÷ 30 × 出勤天数 + 固定工资 ÷ 30 ÷ 10 × 加班小时”由服务端计算。</p></div><div className="grid gap-3 sm:grid-cols-3"><Field label="司机固定月工资（元）"><Input type="number" min="0" step="0.01" value={machineStatementForm.driverMonthlyWage} onChange={event => setMachineStatementForm(current => ({ ...current, driverMonthlyWage: event.target.value }))} /></Field><Field label="司机出勤天数"><Input type="number" min="0" max="31" step="0.5" value={machineStatementForm.driverWorkDays} onChange={event => setMachineStatementForm(current => ({ ...current, driverWorkDays: event.target.value }))} /></Field><Field label="司机加班（小时）"><Input type="number" min="0" max="744" step="0.5" value={machineStatementForm.driverOvertimeHours} onChange={event => setMachineStatementForm(current => ({ ...current, driverOvertimeHours: event.target.value }))} /></Field></div></section>
              {machineMonthlyPreview.isLoading ? <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">正在按当前项目真实成本与计价规则核算会计明细…</div> : machineMonthlyPreview.error ? <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{machineMonthlyPreview.error.message}。请先在机械档案中维护当前期间的产值计价规则。</div> : machineMonthlyPreview.data ? <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-amber-950">服务端会计核算预览</p><p className="mt-1 text-xs text-amber-800">计价：{machineMonthlyPreview.data.rule.billingType === "monthly" ? "月租" : machineMonthlyPreview.data.rule.billingType === "daily" ? "日租" : machineMonthlyPreview.data.rule.billingType === "hourly" ? "小时租" : "台班"} ¥{displayMoney(machineMonthlyPreview.data.rule.rate)}；来源成本 {machineMonthlyPreview.data.source.costRecordCount} 笔、维修保养 {machineMonthlyPreview.data.source.maintenanceRecordCount} 笔。</p></div><Badge variant="outline">{machineMonthlyPreview.data.machine.ownerName}</Badge></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div><p className="text-xs text-amber-800">机械总产值</p><p className="mt-1 font-semibold text-amber-950">¥{displayMoney(machineMonthlyPreview.data.statement.totalOutput)}</p></div><div><p className="text-xs text-amber-800">司机总工资</p><p className="mt-1 font-semibold text-amber-950">¥{displayMoney(machineMonthlyPreview.data.statement.driverTotalWage)}</p></div><div><p className="text-xs text-amber-800">维修 / 油费</p><p className="mt-1 font-semibold text-amber-950">¥{displayMoney(machineMonthlyPreview.data.statement.repairAmount)} / ¥{displayMoney(machineMonthlyPreview.data.statement.fuelAmount)}</p></div><div><p className="text-xs text-amber-800">机械分成</p><p className="mt-1 font-semibold text-amber-950">¥{displayMoney(machineMonthlyPreview.data.statement.machineShareAmount)}</p></div></div></section> : null}
              <div className="grid gap-3 sm:grid-cols-2"><Field label="签字 / 经办人"><Input value={machineStatementForm.signatureName} placeholder="例如：车主或经办会计" onChange={event => setMachineStatementForm(current => ({ ...current, signatureName: event.target.value }))} /></Field><Field label="备注"><Input value={machineStatementForm.remarks} placeholder="可填写核对说明或异常原因" onChange={event => setMachineStatementForm(current => ({ ...current, remarks: event.target.value }))} /></Field></div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setMachineStatementDialogOpen(false)}>取消</Button><Button type="submit" disabled={saveMachineMonthlyStatement.isPending || !machineMonthlyPreview.data || !machineStatementForm.machineId || !machineStatementForm.projectId || !machineStatementForm.period}>{saveMachineMonthlyStatement.isPending ? "正在生成…" : "生成会计明细草稿"}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog open={assetMaintenanceDialogOpen} onOpenChange={open => { setAssetMaintenanceDialogOpen(open); if (!open) setAssetMaintenanceForm(EMPTY_ASSET_MAINTENANCE_FORM); }}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader><DialogTitle>登记{assetMaintenanceForm.assetType === "vehicle" ? "车辆" : "机械"}维修保养费用</DialogTitle><DialogDescription>费用会纳入单车/单设备及车辆、机械费用汇总；作废记录不参与金额统计。</DialogDescription></DialogHeader>
            <form className="space-y-4" onSubmit={event => { event.preventDefault(); saveAssetMaintenance.mutate({ id: assetMaintenanceForm.id, assetType: assetMaintenanceForm.assetType, assetId: Number(assetMaintenanceForm.assetId), projectId: Number(assetMaintenanceForm.projectId), costCategory: assetMaintenanceForm.costCategory, amount: Number(assetMaintenanceForm.amount), occurredAt: new Date(assetMaintenanceForm.occurredAt).toISOString(), serviceProvider: assetMaintenanceForm.serviceProvider || null, meterReading: assetMaintenanceForm.meterReading ? Number(assetMaintenanceForm.meterReading) : null, nextDueAt: assetMaintenanceForm.nextDueAt || null, remarks: assetMaintenanceForm.remarks || null, status: assetMaintenanceForm.status }); }}>
              <div className="grid gap-3 sm:grid-cols-2"><Field label="资源"><Input disabled value={assetMaintenanceForm.assetType === "vehicle" ? (vehicles.data?.find(item => String(item.id) === assetMaintenanceForm.assetId)?.plateNo ?? "未选择车辆") : ((machineryLedger.data ?? []).find(item => String(item.id) === assetMaintenanceForm.assetId)?.name ?? "未选择机械")} /></Field><Field label="费用类别"><Select value={assetMaintenanceForm.costCategory} onValueChange={value => setAssetMaintenanceForm(current => ({ ...current, costCategory: value as AssetMaintenanceForm["costCategory"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="maintenance">保养</SelectItem><SelectItem value="repair">维修</SelectItem></SelectContent></Select></Field><Field label="发生时间"><Input type="datetime-local" value={assetMaintenanceForm.occurredAt ? toLocalDateTimeInput(new Date(assetMaintenanceForm.occurredAt)) : ""} onChange={event => setAssetMaintenanceForm(current => ({ ...current, occurredAt: event.target.value }))} /></Field><Field label="金额（元）"><Input type="number" min="0.01" step="0.01" value={assetMaintenanceForm.amount} onChange={event => setAssetMaintenanceForm(current => ({ ...current, amount: event.target.value }))} /></Field><Field label="维修/保养服务商"><Input value={assetMaintenanceForm.serviceProvider} onChange={event => setAssetMaintenanceForm(current => ({ ...current, serviceProvider: event.target.value }))} /></Field><Field label="里程 / 工时读数"><Input type="number" min="0" step="0.01" value={assetMaintenanceForm.meterReading} onChange={event => setAssetMaintenanceForm(current => ({ ...current, meterReading: event.target.value }))} placeholder="可选" /></Field><Field label="下次保养日期"><Input type="date" value={assetMaintenanceForm.nextDueAt} onChange={event => setAssetMaintenanceForm(current => ({ ...current, nextDueAt: event.target.value }))} /></Field><Field label="费用状态"><Select value={assetMaintenanceForm.status} onValueChange={value => setAssetMaintenanceForm(current => ({ ...current, status: value as AssetMaintenanceForm["status"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="draft">草稿</SelectItem><SelectItem value="approved">已核准</SelectItem><SelectItem value="settled">已结算</SelectItem><SelectItem value="void">作废</SelectItem></SelectContent></Select></Field></div><Field label="维修/保养说明"><Textarea value={assetMaintenanceForm.remarks} onChange={event => setAssetMaintenanceForm(current => ({ ...current, remarks: event.target.value }))} placeholder="维修项目、零件或保养内容；不得填写不必要的个人敏感信息" /></Field><DialogFooter><Button type="button" variant="outline" onClick={() => setAssetMaintenanceDialogOpen(false)}>取消</Button><Button type="submit" disabled={saveAssetMaintenance.isPending || !assetMaintenanceForm.assetId || !assetMaintenanceForm.projectId || !assetMaintenanceForm.amount || !assetMaintenanceForm.occurredAt}>{saveAssetMaintenance.isPending ? "正在保存…" : "保存费用台账"}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog open={dieselPriceDialogOpen} onOpenChange={open => { setDieselPriceDialogOpen(open); if (!open) setDieselPriceForm(EMPTY_DIESEL_PRICE_FORM); }}>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>{dieselPriceForm.id ? "维护柴油指导价" : "新增柴油指导价"}</DialogTitle><DialogDescription>项目部供油在登记时按发生日期匹配有效指导单价；加油站加油则按实际单价入账。停用价格不会影响已有领用和运输结算快照。</DialogDescription></DialogHeader>
            <form className="space-y-4" onSubmit={event => { event.preventDefault(); saveDieselGuidelinePrice.mutate({ id: dieselPriceForm.id, projectId: Number(dieselPriceForm.projectId), pricePerLiter: Number(dieselPriceForm.pricePerLiter), effectiveFrom: dieselPriceForm.effectiveFrom, effectiveTo: dieselPriceForm.effectiveTo || null, status: dieselPriceForm.status, remarks: dieselPriceForm.remarks || null }); }}>
              <div className="grid gap-3 sm:grid-cols-2"><Field label="项目"><Select value={dieselPriceForm.projectId || "UNASSIGNED"} onValueChange={value => setDieselPriceForm(current => ({ ...current, projectId: value === "UNASSIGNED" ? "" : value }))}><SelectTrigger><SelectValue placeholder="选择项目" /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">请选择项目</SelectItem>{projects.data?.filter(project => project.status !== "archived").map(project => <SelectItem key={project.id} value={String(project.id)}>{project.code} · {project.name}</SelectItem>)}</SelectContent></Select></Field><Field label="指导单价（元/升）"><Input type="number" min="0.01" step="0.01" value={dieselPriceForm.pricePerLiter} placeholder="例如 7.25" onChange={event => setDieselPriceForm(current => ({ ...current, pricePerLiter: event.target.value }))} /></Field><Field label="生效日期"><Input type="date" value={dieselPriceForm.effectiveFrom} onChange={event => setDieselPriceForm(current => ({ ...current, effectiveFrom: event.target.value }))} /></Field><Field label="截止日期"><Input type="date" min={dieselPriceForm.effectiveFrom || undefined} value={dieselPriceForm.effectiveTo} onChange={event => setDieselPriceForm(current => ({ ...current, effectiveTo: event.target.value }))} /></Field><Field label="状态"><Select value={dieselPriceForm.status} onValueChange={value => setDieselPriceForm(current => ({ ...current, status: value as DieselPriceForm["status"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">启用</SelectItem><SelectItem value="draft">草稿</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select></Field></div><Field label="备注"><Textarea value={dieselPriceForm.remarks} placeholder="例如：项目部本周柴油核准指导价" onChange={event => setDieselPriceForm(current => ({ ...current, remarks: event.target.value }))} /></Field><DialogFooter><Button type="button" variant="outline" onClick={() => setDieselPriceDialogOpen(false)}>取消</Button><Button type="submit" disabled={saveDieselGuidelinePrice.isPending || !dieselPriceForm.projectId || !dieselPriceForm.pricePerLiter || !dieselPriceForm.effectiveFrom}>{saveDieselGuidelinePrice.isPending ? "正在保存…" : "保存指导价"}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog open={dieselRefuelDialogOpen} onOpenChange={open => { setDieselRefuelDialogOpen(open); if (!open) { setDieselRefuelForm(EMPTY_DIESEL_REFUEL_FORM); setDieselReceiptFile(null); } }}>
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>登记柴油领用</DialogTitle><DialogDescription>项目部供油按加油日期匹配有效指导价；加油站现金加油必须录入当天实际单价与升数。两种方式均由服务端计算并固化金额快照；关联车辆趟次并勾选扣油后，结算时从总运费扣减并锁定该记录。</DialogDescription></DialogHeader>
            <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submitDieselRefuel(); }}>
              <div className="grid gap-3 sm:grid-cols-2"><Field label="项目"><Input disabled value={projects.data?.find(project => String(project.id) === dieselRefuelForm.projectId)?.name ?? "未选择项目"} /></Field><Field label="加油时间"><Input type="datetime-local" value={dieselRefuelForm.refueledAt} onChange={event => setDieselRefuelForm(current => ({ ...current, refueledAt: event.target.value }))} /></Field><Field label="领用对象"><Select value={dieselRefuelForm.assetType} onValueChange={value => setDieselRefuelForm(current => ({ ...current, assetType: value as DieselRefuelForm["assetType"], vehicleId: "", machineId: "", transportTripId: "", deductFromFreight: false }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="vehicle">渣土车 / 车辆</SelectItem><SelectItem value="machine">工程机械</SelectItem></SelectContent></Select></Field><Field label={dieselRefuelForm.assetType === "vehicle" ? "车辆" : "机械"}><Select value={(dieselRefuelForm.assetType === "vehicle" ? dieselRefuelForm.vehicleId : dieselRefuelForm.machineId) || "UNASSIGNED"} onValueChange={value => setDieselRefuelForm(current => current.assetType === "vehicle" ? ({ ...current, vehicleId: value === "UNASSIGNED" ? "" : value, transportTripId: "" }) : ({ ...current, machineId: value === "UNASSIGNED" ? "" : value }))}><SelectTrigger><SelectValue placeholder={dieselRefuelForm.assetType === "vehicle" ? "选择车辆" : "选择机械"} /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">请选择资源</SelectItem>{dieselRefuelForm.assetType === "vehicle" ? (dieselVehicleOptions.data ?? []).filter(vehicle => String(vehicle.projectId) === dieselRefuelForm.projectId).map(vehicle => <SelectItem key={vehicle.id} value={String(vehicle.id)}>{vehicle.plateNo}</SelectItem>) : (dieselMachineOptions.data ?? []).map(machine => <SelectItem key={machine.id} value={String(machine.id)}>{machine.name} · {machine.code}</SelectItem>)}</SelectContent></Select></Field></div>
              <div className="grid gap-3 sm:grid-cols-2"><Field label="供油方式"><Select value={dieselRefuelForm.supplyMethod} onValueChange={value => setDieselRefuelForm(current => ({ ...current, supplyMethod: value as DieselRefuelForm["supplyMethod"], actualUnitPrice: "" }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="project_supply">项目部供油（当天指导价）</SelectItem><SelectItem value="external_station">加油站现金加油（当天实际价）</SelectItem></SelectContent></Select></Field><Field label={dieselRefuelForm.supplyMethod === "project_supply" ? "供油点 / 说明" : "加油站 / 现金供应商"}><Input value={dieselRefuelForm.stationOrSupplierName} placeholder={dieselRefuelForm.supplyMethod === "project_supply" ? "例如：项目油库" : "例如：中国石化 xx 加油站"} onChange={event => setDieselRefuelForm(current => ({ ...current, stationOrSupplierName: event.target.value }))} /></Field><Field label="加油量（升）"><Input type="number" min="0.001" step="0.001" value={dieselRefuelForm.liters} onChange={event => setDieselRefuelForm(current => ({ ...current, liters: event.target.value }))} /></Field>{dieselRefuelForm.supplyMethod === "external_station" ? <Field label="当天现金单价（元/升）"><Input type="number" min="0.01" step="0.01" value={dieselRefuelForm.actualUnitPrice} placeholder="必填" onChange={event => setDieselRefuelForm(current => ({ ...current, actualUnitPrice: event.target.value }))} /></Field> : <Field label="当天指导单价"><Input disabled value={dieselGuidelinePrices.data?.find(price => price.status === "active") ? `¥ ${displayMoney(dieselGuidelinePrices.data.find(price => price.status === "active")?.pricePerLiter)} / L` : "请先维护有效指导价"} /></Field>}<Field label="油表 / 里程读数"><Input type="number" min="0" step="0.01" value={dieselRefuelForm.meterReading} placeholder="可选" onChange={event => setDieselRefuelForm(current => ({ ...current, meterReading: event.target.value }))} /></Field><Field label="小票 / 现金凭证号"><Input value={dieselRefuelForm.receiptNo} placeholder={dieselRefuelForm.supplyMethod === "external_station" ? "建议填写现金小票号" : "可选"} onChange={event => setDieselRefuelForm(current => ({ ...current, receiptNo: event.target.value }))} /></Field><Field label="加油表照片（JPG/PNG）"><Input type="file" accept="image/jpeg,image/png" onChange={event => setDieselReceiptFile(event.target.files?.[0] ?? null)} /><p className="mt-1 text-xs text-slate-500">{dieselReceiptFile ? `已选择：${dieselReceiptFile.name}。保存时将先获取现场定位并自动添加工程水印。` : "可选但建议上传；保存时会自动写入项目、加油时间、定位、操作人和防伪编号后再受控归档。"}</p></Field></div>
              {dieselRefuelForm.supplyMethod === "external_station" ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"><span className="font-medium">现金油费预览：</span>{dieselRefuelForm.liters && dieselRefuelForm.actualUnitPrice ? `${Number(dieselRefuelForm.liters).toFixed(3)} L × ¥${displayMoney(Number(dieselRefuelForm.actualUnitPrice))}/L = ¥${displayMoney(Number(dieselRefuelForm.liters) * Number(dieselRefuelForm.actualUnitPrice))}` : "请填写当天现金单价和加油升数；最终金额以服务端保存的油价快照为准。"}</div> : null}
              {dieselRefuelForm.assetType === "vehicle" ? <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3"><div className="flex items-center gap-2"><Checkbox id="diesel-deduct-freight" checked={dieselRefuelForm.deductFromFreight} onCheckedChange={checked => setDieselRefuelForm(current => ({ ...current, deductFromFreight: Boolean(checked), transportTripId: checked ? current.transportTripId : "" }))} /><Label htmlFor="diesel-deduct-freight" className="cursor-pointer font-medium text-amber-950">本次油款在渣土车运费结算时扣除</Label></div>{dieselRefuelForm.deductFromFreight ? <Field label="关联运输趟次"><Select value={dieselRefuelForm.transportTripId || "UNASSIGNED"} onValueChange={value => setDieselRefuelForm(current => ({ ...current, transportTripId: value === "UNASSIGNED" ? "" : value }))}><SelectTrigger><SelectValue placeholder="选择未结算趟次" /></SelectTrigger><SelectContent><SelectItem value="UNASSIGNED">请选择运输趟次</SelectItem>{(dieselTripOptions.data ?? []).filter(trip => String(trip.vehicleId) === dieselRefuelForm.vehicleId && !["settled", "void"].includes(trip.status)).map(trip => <SelectItem key={trip.id} value={String(trip.id)}>{trip.tripNo} · 总运费 ¥{displayMoney(trip.calculatedAmount)}</SelectItem>)}</SelectContent></Select></Field> : null}</section> : null}
              <div className="grid gap-3 sm:grid-cols-2"><Field label="记账状态"><Select value={dieselRefuelForm.status} onValueChange={value => setDieselRefuelForm(current => ({ ...current, status: value as DieselRefuelForm["status"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="approved">已直接记账，立即纳入成本/结算</SelectItem>{dieselRefuelForm.id ? <SelectItem value="void">作废（仅限纠错）</SelectItem> : null}</SelectContent></Select><p className="mt-1 text-xs leading-5 text-emerald-700">柴油领用无需上级审核；保存后立即生效。价格异常、影像、项目范围和审计控制继续执行。</p></Field></div><Field label="说明"><Textarea value={dieselRefuelForm.remarks} placeholder="领用用途、油品说明或异常说明；不得填写不必要个人敏感信息" onChange={event => setDieselRefuelForm(current => ({ ...current, remarks: event.target.value }))} /></Field><DialogFooter><Button type="button" variant="outline" onClick={() => setDieselRefuelDialogOpen(false)}>取消</Button><Button type="submit" disabled={saveDieselRefuelRecord.isPending || uploadDieselReceipt.isPending || !dieselRefuelForm.projectId || !dieselRefuelForm.refueledAt || !dieselRefuelForm.liters || (dieselRefuelForm.assetType === "vehicle" && !dieselRefuelForm.vehicleId) || (dieselRefuelForm.assetType === "machine" && !dieselRefuelForm.machineId) || (dieselRefuelForm.supplyMethod === "external_station" && !dieselRefuelForm.actualUnitPrice) || (dieselRefuelForm.deductFromFreight && !dieselRefuelForm.transportTripId)}>{uploadDieselReceipt.isPending ? "正在归档小票…" : saveDieselRefuelRecord.isPending ? "正在直接记账…" : "保存并直接记账"}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
