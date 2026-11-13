import {
  DieselPriceHistory,
  DieselSupplierReport,
} from "@/components/DieselSupportingReports";
import { DieselReceiptLedger } from "@/components/DieselReceiptLedger";
import RfidBridgeReadinessPanel from "@/components/RfidBridgeReadinessPanel";
import FullDatabaseBackupHistory from "@/components/FullDatabaseBackupHistory";
import {
  readRfidBridgeReadiness,
  RFID_FIRST_INSTALL_PACKAGE_URL,
  type RfidBridgeReadiness,
} from "@/lib/rfidBridgeReadiness";
import {
  FinanceWorkspaceNavigation,
  FinanceRetainedPanel,
  FinancePagination,
  useFinancePagination,
  type FinanceWorkspaceTab,
} from "@/components/FinanceWorkspaceNavigation";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import ConstructionWorkspace, {
  type ConstructionWorkspaceReport,
} from "@/components/ConstructionWorkspace";
import { PersonnelResourceSelect } from "@/components/PersonnelResourceSelect";
import { PurchasingWorkspace } from "@/components/PurchasingWorkspace";
import { useManagementPermissions } from "@/hooks/useManagementPermissions";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout, {
  type DashboardMenuItem,
} from "@/components/DashboardLayout";
import BusinessStatusBadge, {
  getBusinessStatusLabel,
} from "@/components/BusinessStatusBadge";
import { CurrentFilterPrintActions } from "@/components/CurrentFilterPrintActions";
import { ProtectedImagePreview } from "@/components/ProtectedImagePreview";
import type { ScopedPcAdminSection } from "@/lib/scopedManagementWorkspace";
import {
  getBusinessWorkspaceProjectState,
  getDepartmentScopePickerState,
  isInlineBroadcastDeliveryExpanded,
} from "@/lib/adminWorkspaceState";
import { escapePrintHtml, openA4LandscapePrintDocument } from "@/lib/a4Print";
import {
  formatChinaDateTime,
  toChinaDateInput,
  toChinaMonthInput,
  toDeviceDateInput,
  toDeviceDateTimeInput,
} from "@/lib/businessTime";
import { summarizeDieselLedgerRecords } from "@/lib/dieselLedgerSummary";
import type { DieselPrintRecord } from "@/components/DieselRefuelPrintDialog";
import type { LaborWorkspaceRenderState } from "@/components/LaborWorkspaceLoader";
import type { TransportLedgerFilter } from "@/components/TransportTripLedger";
import { BusinessWorkspaceNavigation as TransportWorkspaceNavigation } from "@/components/BusinessWorkspaceNavigation";
import { FinanceRetainedPanel as TransportRetainedPanel } from "@/components/FinanceWorkspaceNavigation";
import {
  TRANSPORT_WORKSPACE_TABS,
  type TransportWorkspaceTab,
  type TransportReviewView,
} from "@/lib/transportWorkspace";
import type { TransportSettlementFocusTrip } from "@/components/TransportVehicleSettlementManager";
import { TransportReaderTerminalManager } from "@/components/TransportReaderTerminalManager";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { getAdminBusinessRoute } from "@/lib/adminBusinessRoutes";
import { requestDashboardNavigation } from "@/lib/dashboardNavigation";
import { getAssignmentScopeSaveInput } from "@/lib/assignmentScope";
import {
  summarizeLaborPayrollCategories,
  summarizePayrollAmounts,
} from "@/lib/laborPayrollMetrics";
import {
  filterAttendanceRows,
  getAttendanceTeams,
} from "@/lib/laborAttendanceFilters";
import { filterPayrollRows, getPayrollTeams } from "@/lib/payrollLedgerFilters";
import {
  DEFAULT_EVIDENCE_WATERMARK_TEMPLATE,
  WATERMARK_FIELD_OPTIONS,
  type EvidenceWatermarkTemplate,
} from "@shared/watermarkTemplate";
import { getAttendanceSourceLabel, getInvoiceTypeLabel } from "@shared/domain";
import {
  Building2,
  BarChart3,
  BookOpen,
  Calculator,
  ChevronDown,
  DatabaseBackup,
  ExternalLink,
  FileText,
  FileSpreadsheet,
  FolderKanban,
  Fuel,
  KeyRound,
  LayoutDashboard,
  Megaphone,
  Monitor,
  Printer,
  Camera,
  ScrollText,
  ShoppingCart,
  Settings2,
  ShieldCheck,
  Sparkles,
  Truck,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import {
  lazy,
  Suspense,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

/** 仅在相应后台菜单进入时加载独立工作区，避免财税、结算和工具模块膨胀管理端首屏包。 */
const AdminMeasurementToolsPanel = lazy(
  () => import("@/components/AdminMeasurementToolsPanel")
);
const EvidenceWorkspace = lazy(() =>
  import("@/pages/MobileEvidencePage").then(module => ({
    default: module.EvidenceWorkspace,
  }))
);
const NotificationChannelSettings = lazy(
  () => import("@/components/NotificationChannelSettings")
);
const ContractManagementPanel = lazy(
  () => import("@/components/ContractManagementPanel")
);
const RfidLocalWriterPanel = lazy(
  () => import("@/components/RfidLocalWriterPanel")
);
const TransportTripLedger = lazy(
  () => import("@/components/TransportTripLedger")
);
const TransportRouteSafetySettings = lazy(() =>
  import("@/components/TransportRouteSafetySettings").then(module => ({
    default: module.TransportRouteSafetySettings,
  }))
);
const TransportRouteConfigurationEditor = lazy(() =>
  import("@/components/TransportRouteConfigurationEditor").then(module => ({
    default: module.TransportRouteConfigurationEditor,
  }))
);
const TransportFreightRuleManager = lazy(() =>
  import("@/components/TransportFreightRuleManager").then(module => ({
    default: module.TransportFreightRuleManager,
  }))
);
const TransportVehicleSettlementManager = lazy(
  () => import("@/components/TransportVehicleSettlementManager")
);
const VehicleManagementWorkspace = lazy(
  () => import("@/components/VehicleManagementWorkspace")
);
const AdministratorManagement = lazy(
  () => import("@/components/AdministratorManagement")
);
const MachineryWorkspace = lazy(
  () => import("@/components/MachineryWorkspace")
);
const SettlementPaymentFinancialBoard = lazy(
  () => import("@/components/SettlementPaymentFinancialBoard")
);
const SubcontractPaymentSettlementManager = lazy(
  () => import("@/components/SubcontractPaymentSettlementManager")
);
const TaxAccountingHandoffManager = lazy(
  () => import("@/components/TaxAccountingHandoffManager")
);
const AdminAuditWorkspace = lazy(
  () => import("@/components/AdminAuditWorkspace")
);
/** 打印预览仅在财务或柴油管理中主动打开，避免计入后台常驻初始包。 */
const DieselRefuelPrintDialog = lazy(
  () => import("@/components/DieselRefuelPrintDialog")
);
const PaymentAccountBillPrintDialog = lazy(() =>
  import("@/components/PaymentAccountBillPrintDialog").then(module => ({
    default: module.PaymentAccountBillPrintDialog,
  }))
);
const FinancialLedgerPrintPreviewDialogs = lazy(() =>
  import("@/components/FinancialLedgerPrintPreviewDialogs").then(module => ({
    default: module.FinancialLedgerPrintPreviewDialogs,
  }))
);
const LaborWorkspaceShell = lazy(
  () => import("@/components/LaborWorkspaceShell")
);
const LaborWorkspaceLoader = lazy(
  () => import("@/components/LaborWorkspaceLoader")
);
const UnifiedPersonnelDirectory = lazy(
  () => import("@/components/UnifiedPersonnelDirectory")
);
const LaborCheckInLedger = lazy(
  () => import("@/components/LaborCheckInLedger")
);
const LaborWorkerRoster = lazy(() => import("@/components/LaborWorkerRoster"));
const LaborAttendanceLedger = lazy(
  () => import("@/components/LaborAttendanceLedger")
);
const PayrollStatementLedger = lazy(
  () => import("@/components/PayrollStatementLedger")
);
const DailyWageLedger = lazy(() => import("@/components/DailyWageLedger"));
const LaborTeamAuditSummary = lazy(
  () => import("@/components/LaborTeamAuditSummary")
);
const LaborEntryActionCard = lazy(
  () => import("@/components/LaborEntryActionCard")
);
const LaborPayrollHeadline = lazy(() =>
  import("@/components/LaborPayrollHeadline").then(module => ({
    default: module.LaborPayrollHeadline,
  }))
);
const SettlementPaymentDialog = lazy(() =>
  import("@/components/SettlementPaymentDialog").then(module => ({
    default: module.SettlementPaymentDialog,
  }))
);

/**
 * PC 端为统一管理入口中的全局治理工作台。菜单只负责界面导航，服务端仍会对每个全局治理接口执行超级管理员校验。
 */
const ADMIN_MENU: DashboardMenuItem[] = [
  { icon: Monitor, label: "数据大屏", path: "/", section: "决策总览" },
  {
    icon: LayoutDashboard,
    label: "运营概览",
    path: "/admin",
    section: "决策总览",
  },
  {
    icon: Building2,
    label: "组织与项目",
    path: "/admin/organization",
    section: "经营业务",
  },
  {
    icon: FolderKanban,
    label: "施工管理",
    path: "/admin/construction",
    section: "经营业务",
  },
  {
    icon: Truck,
    label: "车辆管理",
    path: "/admin/vehicles",
    section: "资源与现场",
  },
  {
    icon: Settings2,
    label: "机械管理",
    path: "/admin/machinery",
    section: "资源与现场",
  },
  {
    icon: Truck,
    label: "运输管理",
    path: "/admin/transport",
    section: "资源与现场",
  },
  {
    icon: UsersRound,
    label: "劳务工资",
    path: "/admin/labor",
    section: "资源与现场",
  },
  {
    icon: Fuel,
    label: "柴油管理",
    path: "/admin/diesel",
    section: "资源与现场",
  },
  {
    icon: Camera,
    label: "现场取证",
    path: "/admin/evidence",
    section: "资源与现场",
  },
  {
    icon: BarChart3,
    label: "财务管理",
    path: "/admin/finance",
    section: "业财结算",
  },
  {
    icon: ShoppingCart,
    label: "采购仓储",
    path: "/admin/purchasing",
    section: "业财结算",
  },
  {
    icon: Calculator,
    label: "工具知识",
    path: "/admin/measurement-tools",
    section: "业财结算",
  },
  {
    icon: FolderKanban,
    label: "结算分包",
    path: "/admin/subcontract",
    section: "业财结算",
  },
  {
    icon: FileText,
    label: "合同管理",
    path: "/admin/contracts",
    section: "业财结算",
  },
  {
    icon: ShieldCheck,
    label: "智能风控",
    path: "/admin/risk",
    section: "风险与通知",
  },
  {
    icon: Megaphone,
    label: "范围通知",
    path: "/admin/broadcast",
    section: "风险与通知",
  },
  {
    icon: UsersRound,
    label: "管理员管理",
    path: "/admin/administrators",
    section: "平台治理",
  },
  {
    icon: UsersRound,
    label: "权限管理",
    path: "/admin/permission",
    section: "平台治理",
  },
  {
    icon: KeyRound,
    label: "微信登录管理",
    path: "/admin/wechat-login",
    section: "平台治理",
  },
  {
    icon: BarChart3,
    label: "业务治理与备份",
    path: "/admin/business",
    section: "平台治理",
  },
  {
    icon: Settings2,
    label: "系统设置",
    path: "/admin/settings",
    section: "平台治理",
  },
  { icon: BookOpen, label: "使用教程", path: "/help", section: "平台治理" },
  {
    icon: ScrollText,
    label: "发布与审计",
    path: "/admin/audit",
    section: "平台治理",
  },
];

type OrganizationType =
  | "group"
  | "company"
  | "project_department"
  | "department"
  | "team";
type DepartmentModuleCode =
  | "CONSTRUCTION"
  | "LABOR"
  | "MACHINERY"
  | "TRANSPORT"
  | "PURCHASING"
  | "MEASUREMENT"
  | "FINANCE"
  | "EVIDENCE";
type OrganizationStatus = "active" | "disabled";
type ProjectType = "highway" | "railway" | "municipal" | "other";
type ProjectStatus =
  | "planning"
  | "active"
  | "suspended"
  | "completed"
  | "archived";

type OrganizationForm = {
  id?: number;
  parentId: string;
  code: string;
  name: string;
  type: OrganizationType;
  managerUserId: string;
  costCenterCode: string;
  sortOrder: string;
  status: OrganizationStatus;
};
type ProjectForm = {
  id?: number;
  parentId: string;
  organizationId: string;
  code: string;
  name: string;
  nodeType: string;
  projectType: ProjectType;
  status: ProjectStatus;
  startDate: string;
  endDate: string;
  costCenterCode: string;
  sortOrder: string;
};
type PositionForm = {
  id?: number;
  code: string;
  name: string;
  category: string;
  description: string;
  status: OrganizationStatus;
};
type VehicleType =
  | "dump_truck"
  | "tractor"
  | "mixer"
  | "flatbed"
  | "pickup"
  | "suv"
  | "other";
type VehicleStatus = "active" | "suspended" | "disabled";
type LeaseBillingType = "monthly" | "daily" | "hourly" | "shift";
type VehicleForm = {
  id?: number;
  driverPersonId: string;
  projectId: string;
  organizationId: string;
  plateNo: string;
  vehicleType: VehicleType;
  ownership: "owned" | "leased" | "trip_settlement";
  ownerName: string;
  driverUserId: string;
  driverName: string;
  driverPhone: string;
  boxLengthMeters: string;
  boxWidthMeters: string;
  boxHeightMeters: string;
  loadFactor: string;
  payloadTons: string;
  fuelTankCapacityLiters: string;
  status: VehicleStatus;
  leaseBillingType: LeaseBillingType;
  leaseRate: string;
  leaseStartDate: string;
  leaseEndDate: string;
};
type MachineOwnership = "owned" | "leased";
type MachineStatus = "idle" | "working" | "repairing" | "offsite" | "retired";
type MachineCostType =
  | "fuel"
  | "repair"
  | "overtime"
  | "mobilization"
  | "other";
type MachineForm = {
  id?: number;
  operatorPersonId: string;
  projectId: string;
  operatorUserId: string;
  ownerUserId: string;
  code: string;
  name: string;
  model: string;
  ownership: MachineOwnership;
  supplierName: string;
  plateOrAssetNo: string;
  driverName: string;
  driverPhone: string;
  fuelTankCapacityLiters: string;
  status: MachineStatus;
  leaseBillingType: LeaseBillingType;
  leaseRate: string;
  leaseStartDate: string;
  leaseEndDate: string;
};
type MachineCostForm = {
  machineId: string;
  projectId: string;
  costType: MachineCostType;
  costName: string;
  quantity: string;
  unitPrice: string;
  occurredAt: string;
  remarks: string;
};
type MachineDailyOperationForm = {
  id?: number;
  machineId: string;
  projectId: string;
  occurredOn: string;
  operatorUserId: string;
  shiftCount: string;
  workHours: string;
  overtimeHours: string;
  shiftRate: string;
  overtimeHourlyRate: string;
  outputAmount: string;
  driverWageAmount: string;
  remarks: string;
};
type MachineMonthlyStatementForm = {
  machineId: string;
  projectId: string;
  period: string;
  driverUserId: string;
  machineWorkDays: string;
  machineOvertimeHours: string;
  driverMonthlyWage: string;
  driverWorkDays: string;
  driverOvertimeHours: string;
  signatureName: string;
  remarks: string;
};
type EmployeeType = "management" | "operator" | "construction_worker";
type EmployeeProfileForm = {
  id?: number;
  userId: string;
  laborWorkerId: string;
  projectId: string;
  employeeType: EmployeeType;
  teamName: string;
  employmentStatus: "active" | "suspended" | "left";
  joinedAt: string;
  leftAt: string;
  salaryBasis: "monthly" | "daily" | "hourly" | "piecework";
  baseSalary: string;
  remarks: string;
};
/**
 * PC 劳务入口仅新建施工队实名制工人。敏感字段只保留在当前对话框的受控内存中，
 * 不接入任何本机草稿或既有员工档案表单。
 */
type LaborWorkerCreateForm = {
  realName: string;
  identityNo: string;
  teamName: string;
  phone: string;
  bankName: string;
  bankAccount: string;
  entryDate: string;
  remarks: string;
};
type EmployeeInsuranceForm = {
  id?: number;
  employeeProfileId: string;
  insuranceType:
    | "work_injury"
    | "accident"
    | "medical"
    | "employer_liability"
    | "other";
  providerName: string;
  policyReference: string;
  evidenceId?: number;
  premiumAmount: string;
  coverageAmount: string;
  purchasedAt: string;
  expiresAt: string;
  status: "active" | "expired" | "cancelled";
  remarks: string;
};
type AssetMaintenanceForm = {
  id?: number;
  assetType: "vehicle" | "machine";
  assetId: string;
  projectId: string;
  costCategory: "maintenance" | "repair";
  amount: string;
  occurredAt: string;
  serviceProvider: string;
  meterReading: string;
  nextDueAt: string;
  remarks: string;
  status: "draft" | "approved" | "settled" | "void";
};
type DieselPriceForm = {
  id?: number;
  projectId: string;
  pricePerLiter: string;
  effectiveFrom: string;
  effectiveTo: string;
  status: "draft" | "active" | "disabled";
  remarks: string;
};
type DieselRefuelForm = {
  id?: number;
  projectId: string;
  assetType: "vehicle" | "machine";
  vehicleId: string;
  machineId: string;
  transportTripId: string;
  supplyMethod: "project_supply" | "external_station";
  stationOrSupplierName: string;
  liters: string;
  actualUnitPrice: string;
  deductFromFreight: boolean;
  refueledAt: string;
  meterReading: string;
  receiptNo: string;
  remarks: string;
  status: "draft" | "approved" | "void";
};
type RiskRuleForm = {
  enabled: boolean;
  maxFuelFillRatio: string;
  maxTransportSpeedKmh: string;
  maxTransportDurationMinutes: string;
  maxOpenCheckInHours: string;
  maxPendingReportHours: string;
  overdueEscalationEnabled: boolean;
  overdueEscalationHourChina: string;
};
type RfidWriterDeviceForm = {
  id?: number;
  deviceCode: string;
  displayName: string;
  model: string;
  connectionMode: "manual_placeholder" | "usb" | "serial" | "network";
  status: "active" | "disabled" | "maintenance";
  remarks: string;
};
type RfidCardForm = {
  id?: number;
  vehicleId: string;
  writerDeviceId: string;
  managementCode: string;
  cardUid: string;
  driverPhone: string;
  status: "active" | "suspended" | "revoked";
  reuseRevokedUnboundCard: boolean;
};
type LocalAccountStatus = "active" | "disabled";
type LocalLoginMode = "pc" | "mobile" | "both";
type LocalAccountEditForm = {
  userId: number;
  username: string;
  displayName: string;
  status: LocalAccountStatus;
  loginMode: LocalLoginMode;
};
type LocalAccountActionTarget = { id: number; name: string; username: string };
type AssignmentForm = {
  id?: number;
  userId: string;
  roleId: string;
  organizationId: string;
  projectId: string;
  validFrom: string;
  validTo: string;
};
type RoleForm = {
  id?: number;
  code: string;
  name: string;
  category: "system" | "business";
  description: string;
  status: OrganizationStatus;
  isSystem: boolean;
};
type SettingForm = {
  id?: number;
  expectedVersion?: number;
  category: string;
  settingKey: string;
  displayName: string;
  value: string;
  isSensitive: boolean;
  remarks: string;
};
type OfficialAccountConfigurationForm = {
  appId: string;
  appSecret: string;
  appUrl: string;
  egressUrl: string;
  egressSigningSecret: string;
};
type OfficialAccountMessagePushForm = {
  eventToken: string;
  encodingAesKey: string;
};
type ExternalAiApiConfigurationForm = {
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
};
type AliyunOssPhotoStorageConfigurationForm = {
  enabled: boolean;
  region: string;
  endpoint: string;
  bucket: string;
  objectPrefix: string;
  accessKeyId: string;
  accessKeySecret: string;
};
type AliyunOssPhotoStorageValidation = {
  success: boolean;
  code: string;
  message: string;
};
type SettingDeleteTarget = {
  id: number;
  displayName: string;
  settingKey: string;
  version: number;
  isSensitive: boolean;
};
type DailyDigestForm = {
  enabled: boolean;
  deliveryHour: string;
  deliveryMinute: string;
  includeEmptyProjects: boolean;
};
type SettingsCategory = "business" | "integrations" | "media" | "governance";
type PermissionWorkspaceTab =
  | "accounts"
  | "authorization"
  | "roles"
  | "department";
type BroadcastAudienceType = "project" | "organization" | "role";
type BroadcastForm = {
  id?: number;
  title: string;
  content: string;
  deepLink: string;
  audienceType: BroadcastAudienceType;
  scopeValue: string;
};
type MasterDataResource =
  | "organization"
  | "position"
  | "project"
  | "vehicle"
  | "role"
  | "department_scope"
  | "role_assignment";
type MasterDataDeleteTarget = {
  resource: MasterDataResource;
  id: number;
  label: string;
  description: string;
};
type PayrollPaymentTarget = { id: number; workerName: string; period: string };
type WechatBindingActionTarget = { userId: number; displayName: string };
type ConstructionWeather =
  | "sunny"
  | "cloudy"
  | "rainy"
  | "snowy"
  | "windy"
  | "other";
type ConstructionReportEditor = {
  id?: number;
  projectId: number;
  status: "draft" | "submitted" | "approved" | "rejected" | "locked";
  reportDate: string;
  workArea: string;
  weather: ConstructionWeather;
  workContent: string;
  safetyNotes: string;
  issueNotes: string;
  progressPercent: string;
};
type SubcontractTeamForm = {
  id?: number;
  projectId: string;
  teamName: string;
  contactName: string;
  contactPhone: string;
  status: "active" | "suspended" | "closed";
  remarks: string;
};
type SubcontractPackageForm = {
  id?: number;
  projectId: string;
  measurementTakeoffId: string;
  subcontractTeamId: string;
  workItem: string;
  workLocation: string;
  unit: "m3" | "m2" | "m" | "t" | "piece" | "set" | "other";
  quantity: string;
  upstreamUnitPrice: string;
  subcontractUnitPrice: string;
  priceExceptionReason: string;
  remarks: string;
};
type MeasurementTakeoffForm = {
  id?: number;
  projectId: string;
  workItem: string;
  workLocation: string;
  unit: "m3" | "m2" | "m" | "t" | "piece" | "set" | "other";
  quantity: string;
  unitPrice: string;
  takeoffDate: string;
};
type InventoryTransactionForm = {
  projectId: string;
  transactionType: "inbound" | "outbound" | "return";
  itemName: string;
  unit: string;
  quantity: string;
  unitCost: string;
  occurredAt: string;
  remarks: string;
};
type PurchaseSpreadsheetOrderImport = {
  orderNo: string | null;
  purchaserName: string;
  categoryName: string;
  itemDescription: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
  orderedAt: string;
  supplierName: string | null;
  hasInvoice: boolean;
  remarks: string | null;
};
type PurchaseSpreadsheetInventoryImport = {
  transactionNo: string | null;
  transactionType: "inbound" | "outbound" | "return";
  itemName: string;
  unit: string;
  quantity: number;
  unitCost: number;
  occurredAt: string;
  remarks: string | null;
};
type PurchaseSpreadsheetImportPreview = {
  fileName: string;
  orders: PurchaseSpreadsheetOrderImport[];
  inventoryTransactions: PurchaseSpreadsheetInventoryImport[];
};
type DesktopRecordDetail = {
  title: string;
  description: string;
  fields: Array<{ label: string; value: ReactNode }>;
  note?: string;
  onPrint?: () => void;
};

/** 仅在用户主动打开单份日报详情时申请短时影像URL，避免台账列表预取所有现场照片。 */
function ConstructionReportEvidenceDetail({
  projectId,
  reportId,
}: {
  projectId: number;
  reportId: number;
}) {
  const evidence = trpc.construction.reportEvidence.useQuery(
    { projectId, reportIds: [reportId] },
    { enabled: projectId > 0 && reportId > 0, retry: false }
  );
  if (evidence.isLoading || evidence.isFetching)
    return (
      <p className="text-sm text-slate-500">正在读取已授权的关联现场照片…</p>
    );
  if (evidence.isError)
    return (
      <p className="text-sm leading-6 text-amber-700">
        关联照片暂时无法读取，请关闭详情后刷新台账重试。
      </p>
    );
  if (!evidence.data?.length)
    return (
      <p className="text-sm leading-6 text-slate-500">
        该日报暂未关联现场照片。填报人员可在日报新建或编辑窗口中补充照片后再提交审核。
      </p>
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {evidence.data.map((photo, index) => (
        <ProtectedImagePreview
          key={photo.id}
          file={{ url: photo.url, fileName: photo.fileName }}
          title={`施工日报照片 ${index + 1}`}
          description="点击查看站内原图，不会下载照片。"
          className="block overflow-hidden rounded-lg border border-slate-200 bg-white p-2 hover:border-[#2d6b63]"
        >
          <img
            className="h-40 w-full rounded object-cover"
            src={photo.url}
            alt={photo.description || `施工日报照片 ${index + 1}`}
          />
          <span className="mt-2 block text-xs leading-5 text-slate-600">
            {photo.description || "施工日报现场影像"} ·{" "}
            {displayDate(photo.capturedAt)} · 点击预览
          </span>
        </ProtectedImagePreview>
      ))}
    </div>
  );
}

const EMPTY_ORGANIZATION_FORM: OrganizationForm = {
  parentId: "",
  code: "",
  name: "",
  type: "department",
  managerUserId: "",
  costCenterCode: "",
  sortOrder: "0",
  status: "active",
};
const EMPTY_PROJECT_FORM: ProjectForm = {
  parentId: "",
  organizationId: "",
  code: "",
  name: "",
  nodeType: "项目",
  projectType: "highway",
  status: "planning",
  startDate: "",
  endDate: "",
  costCenterCode: "",
  sortOrder: "0",
};
const EMPTY_POSITION_FORM: PositionForm = {
  code: "",
  name: "",
  category: "业务岗位",
  description: "",
  status: "active",
};
const EMPTY_VEHICLE_FORM: VehicleForm = {
  driverPersonId: "",
  projectId: "",
  organizationId: "",
  plateNo: "",
  vehicleType: "dump_truck",
  ownership: "owned",
  ownerName: "",
  driverUserId: "",
  driverName: "",
  driverPhone: "",
  boxLengthMeters: "",
  boxWidthMeters: "",
  boxHeightMeters: "",
  loadFactor: "1",
  payloadTons: "",
  fuelTankCapacityLiters: "",
  status: "active",
  leaseBillingType: "monthly",
  leaseRate: "",
  leaseStartDate: "",
  leaseEndDate: "",
};
const EMPTY_MACHINE_FORM: MachineForm = {
  operatorPersonId: "",
  projectId: "",
  operatorUserId: "",
  ownerUserId: "",
  code: "",
  name: "",
  model: "",
  ownership: "owned",
  supplierName: "",
  plateOrAssetNo: "",
  driverName: "",
  driverPhone: "",
  fuelTankCapacityLiters: "",
  status: "idle",
  leaseBillingType: "monthly",
  leaseRate: "",
  leaseStartDate: "",
  leaseEndDate: "",
};
const EMPTY_MACHINE_DAILY_OPERATION_FORM: MachineDailyOperationForm = {
  machineId: "",
  projectId: "",
  occurredOn: toLocalDateInput(),
  operatorUserId: "",
  shiftCount: "0",
  workHours: "0",
  overtimeHours: "0",
  shiftRate: "0",
  overtimeHourlyRate: "",
  outputAmount: "0",
  driverWageAmount: "0",
  remarks: "",
};
/** 稳定的模块级字段包装组件，禁止在页面渲染函数内定义，避免受控输入在每次状态更新时失焦。 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** 设置组默认收起，将低频配置从长页面中收纳，仍保留原有表单与服务端权限校验。 */
function SettingsDisclosure({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  description: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      className="group rounded-xl border border-[#d8e3e0] bg-white shadow-sm"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 marker:content-none sm:px-5">
        <div>
          <p className="text-sm font-semibold text-[#203c48]">{title}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-[#e6eeeb] p-3 sm:p-4">{children}</div>
    </details>
  );
}

function DuplicateEntryNotice({ detail }: { detail?: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
      <p className="font-semibold">防重复录入提醒</p>
      <p className="mt-1">
        {detail ??
          "保存前请核对项目、对象、日期、数量、单价、凭证号和现场照片；如同一对象同日已有相近记录，请先打开台账确认后再保存，避免重复入账或重复通知。"}
      </p>
    </div>
  );
}
const EMPTY_RISK_RULE_FORM: RiskRuleForm = {
  enabled: true,
  maxFuelFillRatio: "1.1",
  maxTransportSpeedKmh: "80",
  maxTransportDurationMinutes: "360",
  maxOpenCheckInHours: "14",
  maxPendingReportHours: "24",
  overdueEscalationEnabled: false,
  overdueEscalationHourChina: "9",
};
const EMPTY_MACHINE_COST_FORM: MachineCostForm = {
  machineId: "",
  projectId: "",
  costType: "fuel",
  costName: "",
  quantity: "",
  unitPrice: "",
  occurredAt: "",
  remarks: "",
};
const EMPTY_MACHINE_MONTHLY_STATEMENT_FORM: MachineMonthlyStatementForm = {
  machineId: "",
  projectId: "",
  period: "",
  driverUserId: "",
  machineWorkDays: "0",
  machineOvertimeHours: "0",
  driverMonthlyWage: "0",
  driverWorkDays: "0",
  driverOvertimeHours: "0",
  signatureName: "",
  remarks: "",
};
const EMPTY_EMPLOYEE_PROFILE_FORM: EmployeeProfileForm = {
  userId: "",
  laborWorkerId: "",
  projectId: "",
  employeeType: "management",
  teamName: "",
  employmentStatus: "active",
  joinedAt: "",
  leftAt: "",
  salaryBasis: "monthly",
  baseSalary: "",
  remarks: "",
};
const EMPTY_LABOR_WORKER_CREATE_FORM: LaborWorkerCreateForm = {
  realName: "",
  identityNo: "",
  teamName: "",
  phone: "",
  bankName: "",
  bankAccount: "",
  entryDate: "",
  remarks: "",
};
const EMPTY_EMPLOYEE_INSURANCE_FORM: EmployeeInsuranceForm = {
  employeeProfileId: "",
  insuranceType: "work_injury",
  providerName: "",
  policyReference: "",
  evidenceId: undefined,
  premiumAmount: "",
  coverageAmount: "",
  purchasedAt: "",
  expiresAt: "",
  status: "active",
  remarks: "",
};
const EMPTY_ASSET_MAINTENANCE_FORM: AssetMaintenanceForm = {
  assetType: "vehicle",
  assetId: "",
  projectId: "",
  costCategory: "maintenance",
  amount: "",
  occurredAt: "",
  serviceProvider: "",
  meterReading: "",
  nextDueAt: "",
  remarks: "",
  status: "draft",
};
const EMPTY_DIESEL_PRICE_FORM: DieselPriceForm = {
  projectId: "",
  pricePerLiter: "",
  effectiveFrom: toLocalDateInput(),
  effectiveTo: "",
  status: "active",
  remarks: "",
};
const EMPTY_DIESEL_REFUEL_FORM: DieselRefuelForm = {
  projectId: "",
  assetType: "vehicle",
  vehicleId: "",
  machineId: "",
  transportTripId: "",
  supplyMethod: "project_supply",
  stationOrSupplierName: "",
  liters: "",
  actualUnitPrice: "",
  deductFromFreight: false,
  refueledAt: toLocalDateTimeInput(new Date()),
  meterReading: "",
  receiptNo: "",
  remarks: "",
  status: "approved",
};
const EMPTY_RFID_WRITER_DEVICE_FORM: RfidWriterDeviceForm = {
  deviceCode: "",
  displayName: "",
  model: "",
  connectionMode: "manual_placeholder",
  status: "active",
  remarks: "",
};
const EMPTY_RFID_CARD_FORM: RfidCardForm = {
  vehicleId: "",
  writerDeviceId: "",
  managementCode: "",
  cardUid: "",
  driverPhone: "",
  status: "suspended",
  reuseRevokedUnboundCard: false,
};
const EMPTY_ROLE_FORM: RoleForm = {
  code: "",
  name: "",
  category: "business",
  description: "",
  status: "active",
  isSystem: false,
};
const EMPTY_ASSIGNMENT_FORM: AssignmentForm = {
  userId: "",
  roleId: "",
  organizationId: "",
  projectId: "",
  validFrom: "",
  validTo: "",
};
const EMPTY_SETTING_FORM: SettingForm = {
  category: "微信公众号服务号",
  settingKey: "",
  displayName: "",
  value: "",
  isSensitive: false,
  remarks: "",
};
const EMPTY_OFFICIAL_ACCOUNT_CONFIGURATION_FORM: OfficialAccountConfigurationForm =
  {
    appId: "",
    appSecret: "",
    appUrl: "https://roadmanage-xjifzbue.manus.space",
    egressUrl: "https://wechat-egress.maomaoyx.com",
    egressSigningSecret: "",
  };
const EMPTY_OFFICIAL_ACCOUNT_MESSAGE_PUSH_FORM: OfficialAccountMessagePushForm =
  { eventToken: "", encodingAesKey: "" };
const EMPTY_EXTERNAL_AI_API_CONFIGURATION_FORM: ExternalAiApiConfigurationForm =
  { baseUrl: "", apiKey: "", model: "", enabled: false };
const EMPTY_ALIYUN_OSS_PHOTO_STORAGE_CONFIGURATION_FORM: AliyunOssPhotoStorageConfigurationForm =
  {
    enabled: false,
    region: "",
    endpoint: "",
    bucket: "",
    objectPrefix: "photos",
    accessKeyId: "",
    accessKeySecret: "",
  };
const EMPTY_DAILY_DIGEST_FORM: DailyDigestForm = {
  enabled: false,
  deliveryHour: "17",
  deliveryMinute: "30",
  includeEmptyProjects: false,
};
const EMPTY_BROADCAST_FORM: BroadcastForm = {
  title: "",
  content: "",
  deepLink: "/mobile/messages",
  audienceType: "project",
  scopeValue: "",
};
const EMPTY_SUBCONTRACT_TEAM_FORM: SubcontractTeamForm = {
  projectId: "",
  teamName: "",
  contactName: "",
  contactPhone: "",
  status: "active",
  remarks: "",
};
const EMPTY_SUBCONTRACT_PACKAGE_FORM: SubcontractPackageForm = {
  projectId: "",
  measurementTakeoffId: "",
  subcontractTeamId: "",
  workItem: "",
  workLocation: "",
  unit: "m3",
  quantity: "",
  upstreamUnitPrice: "",
  subcontractUnitPrice: "",
  priceExceptionReason: "",
  remarks: "",
};
const EMPTY_MEASUREMENT_TAKEOFF_FORM: MeasurementTakeoffForm = {
  projectId: "",
  workItem: "",
  workLocation: "",
  unit: "m3",
  quantity: "",
  unitPrice: "",
  takeoffDate: toLocalDateInput(),
};
const EMPTY_INVENTORY_TRANSACTION_FORM: InventoryTransactionForm = {
  projectId: "",
  transactionType: "inbound",
  itemName: "",
  unit: "件",
  quantity: "",
  unitCost: "0",
  occurredAt: toLocalDateTimeInput(new Date()),
  remarks: "",
};
const CONSTRUCTION_WEATHER_LABELS: Record<ConstructionWeather, string> = {
  sunny: "晴",
  cloudy: "多云",
  rainy: "雨",
  snowy: "雪",
  windy: "大风",
  other: "其他",
};
const OFFICIAL_ACCOUNT_BASE_SETTING_KEYS = new Set([
  "WECHAT_OFFICIAL_APP_ID",
  "WECHAT_OFFICIAL_APP_SECRET",
  "WECHAT_OFFICIAL_APP_URL",
  "WECHAT_OFFICIAL_EGRESS_URL",
  "WECHAT_OFFICIAL_EGRESS_SHARED_SECRET",
  "WECHAT_OFFICIAL_EVENT_TOKEN",
  "WECHAT_OFFICIAL_EVENT_AES_KEY",
]);
/** 服务号配置的敏感等级由后端契约决定，避免管理员手动误将 AppID 等运行参数保存为密文。 */
function resolveOfficialAccountSensitivity(
  settingKey: string,
  fallback: boolean
) {
  if (settingKey === "WECHAT_OFFICIAL_APP_SECRET") return true;
  if (settingKey === "WECHAT_OFFICIAL_EGRESS_SHARED_SECRET") return true;
  if (
    settingKey === "WECHAT_OFFICIAL_EVENT_TOKEN" ||
    settingKey === "WECHAT_OFFICIAL_EVENT_AES_KEY"
  )
    return true;
  if (settingKey.startsWith("WECHAT_OFFICIAL_")) return false;
  return fallback;
}

/** 将同一安全测试按新版服务号配置阶段呈现为管理员可理解的操作标签。 */
function getOfficialAccountTestLabel(settingKey: string) {
  if (
    settingKey === "WECHAT_OFFICIAL_APP_ID" ||
    settingKey === "WECHAT_OFFICIAL_APP_SECRET"
  )
    return "校验开发密钥";
  if (
    settingKey === "WECHAT_OFFICIAL_TEMPLATE_ID" ||
    settingKey === "WECHAT_OFFICIAL_TEMPLATE_FIELDS"
  )
    return "检查通知就绪";
  if (settingKey === "WECHAT_OFFICIAL_APP_URL") return "校验绑定前置";
  return "校验服务号";
}

/** 兼容 API 返回 Date 或字符串的时间展示方法。 */
function displayDate(value: Date | string | null | undefined) {
  return formatChinaDateTime(value);
}

/** 工资导出只呈现中文人员分类，内部枚举继续用于筛选、权限和服务端契约。 */
function getPayrollWorkerCategoryLabel(category: string | null | undefined) {
  if (category === "company_admin") return "公司管理人员";
  if (category === "labor_team") return "劳务队人员";
  if (category === "temporary_daily") return "临时日结人员";
  return category && /[\u4e00-\u9fff]/.test(category) ? category : "未分类人员";
}

/** 射频卡高风险操作仅反馈可操作的业务原因，不向管理员回显框架或数据库原始异常。 */
function getVehicleRfidCardManagementErrorMessage(
  action: "revoke" | "unbind",
  message: string | null | undefined
) {
  const value = message ?? "";
  if (value.includes("未闭环运输趟次"))
    return "当前车辆存在未闭环运输趟次，请完成或作废该趟次后再解除绑定";
  if (value.includes("已经解除绑定"))
    return "该车辆卡当前未绑定车辆，无需重复解除";
  if (value.includes("已经挂失停用"))
    return "该车辆卡已经挂失停用，无需重复操作";
  if (value.includes("不存在或不属于当前项目"))
    return "未找到当前项目下的车辆射频卡，请刷新台账后重试";
  if (value.includes("权限"))
    return "当前账号没有车辆卡管理权限，请联系超级管理员授权";
  if (value.includes("数据库连接暂不可用"))
    return "车辆卡台账暂时不可用，请稍后重试";
  return action === "unbind"
    ? "车辆射频卡解除绑定失败，请刷新后重试"
    : "车辆射频卡挂失失败，请刷新后重试";
}

/** 考勤业务台账只显示中文详细地址；坐标仅可在有用途说明的争议核验接口中受控读取。 */
function formatAttendanceLocation(
  address: string | null | undefined,
  status: "normal" | "location_missing" | null | undefined
) {
  if (status !== "normal") return "未上传定位";
  return address?.trim() || "定位已采集，中文详细地址待解析";
}

/** 本地日期筛选以用户浏览器日历为准，避免将 UTC 日期偏移带入运输日结算口径。 */
function toLocalDateInput(value = new Date()) {
  return toDeviceDateInput(value);
}

/** 上下班考勤的“当天”由服务端按中国业务日期裁切；后台默认筛选必须使用同一口径。 */
function toChinaBusinessDateInput(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const dateParts = Object.fromEntries(
    parts
      .filter(part => ["year", "month", "day"].includes(part.type))
      .map(part => [part.type, part.value])
  );
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

function readImageAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("现金小票读取失败"));
    reader.onload = () =>
      resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ""));
    reader.readAsDataURL(file);
  });
}

/** 将浏览器定位转换为可写入工程水印的最小现场坐标；拒绝定位时不归档无定位的加油表照片。 */
function captureWatermarkLocation() {
  return new Promise<{
    longitude: number;
    latitude: number;
    accuracyMeters: number;
  }>((resolve, reject) => {
    if (!navigator.geolocation)
      return reject(
        new Error("当前浏览器不支持定位，无法生成含定位的加油表工程水印")
      );
    navigator.geolocation.getCurrentPosition(
      position =>
        resolve({
          longitude: position.coords.longitude,
          latitude: position.coords.latitude,
          accuracyMeters: position.coords.accuracy,
        }),
      () =>
        reject(
          new Error("请允许浏览器获取现场定位后，再保存加油表工程水印照片")
        ),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 }
    );
  });
}

/** 后台柴油影像与移动端现场取证使用同一像素级工程水印样式。 */
function createWatermarkedImage(
  file: File,
  watermarkLines: string[],
  template: EvidenceWatermarkTemplate
) {
  return new Promise<File>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("加油表工程水印生成失败"));
    };
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("当前浏览器不支持工程水印绘制");
        context.drawImage(image, 0, 0);
        const fontSize = Math.max(
          15,
          Math.round(Math.min(canvas.width, canvas.height) / 34)
        );
        const lineHeight = Math.round(fontSize * 1.46);
        const padding = Math.round(fontSize * 0.72);
        const visibleLines = watermarkLines.filter(Boolean).slice(0, 8);
        context.font = `600 ${fontSize}px sans-serif`;
        const textWidth = Math.min(
          canvas.width - padding * 2,
          Math.max(
            ...visibleLines.map(line => context.measureText(line).width),
            canvas.width * 0.42
          )
        );
        const headerHeight = Math.round(lineHeight * 1.35);
        const footerHeight = Math.round(lineHeight * 1.1);
        const boxHeight =
          headerHeight +
          visibleLines.length * lineHeight +
          footerHeight +
          padding * 2;
        const boxY = Math.max(padding, canvas.height - boxHeight - padding);
        context.fillStyle = "rgba(255, 255, 255, .88)";
        context.fillRect(padding, boxY, textWidth + padding * 2, boxHeight);
        context.fillStyle = "rgba(33, 119, 211, .9)";
        context.fillRect(
          padding,
          boxY,
          textWidth + padding * 2,
          headerHeight + padding
        );
        context.fillStyle = "#ffffff";
        context.font = `700 ${Math.round(fontSize * 1.08)}px sans-serif`;
        context.fillText(
          template.title,
          padding * 2,
          boxY + Math.round(padding * 0.55)
        );
        context.fillStyle = "#26333d";
        context.font = `600 ${fontSize}px sans-serif`;
        context.textBaseline = "top";
        visibleLines.forEach((line, index) =>
          context.fillText(
            line,
            padding * 2,
            boxY + headerHeight + padding + index * lineHeight
          )
        );
        context.fillStyle = "rgba(33, 119, 211, .92)";
        context.fillRect(
          padding,
          boxY + boxHeight - footerHeight - padding,
          textWidth + padding * 2,
          footerHeight + padding
        );
        context.fillStyle = "#ffffff";
        context.font = `600 ${Math.round(fontSize * 0.78)}px sans-serif`;
        context.fillText(
          template.footerLabel,
          padding * 2,
          boxY + boxHeight - footerHeight - Math.round(padding * 0.1)
        );
        canvas.toBlob(
          blob => {
            URL.revokeObjectURL(objectUrl);
            if (!blob) return reject(new Error("加油表工程水印生成失败"));
            const name =
              file.name.replace(/\.(jpe?g|png)$/i, "") || "diesel-meter";
            resolve(
              new File([blob], `${name}-watermark.jpg`, {
                type: "image/jpeg",
                lastModified: Date.now(),
              })
            );
          },
          "image/jpeg",
          0.9
        );
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        reject(
          error instanceof Error ? error : new Error("加油表工程水印生成失败")
        );
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

type DailyWageWorkbookFilter = {
  dateFrom: string;
  dateTo: string;
  keyword: string;
  team: string;
  status: string;
};
type ExportScopeWindow = Window & {
  __roadConstructionExportScope?: CsvExportScope;
  __roadConstructionDailyWageExportFilter?: DailyWageWorkbookFilter;
};

function getActiveCsvExportScope(): CsvExportScope {
  if (typeof window === "undefined")
    return { module: "后台台账", filters: [["页面范围", "当前已授权数据"]] };
  return (
    (window as ExportScopeWindow).__roadConstructionExportScope ?? {
      module: "后台台账",
      filters: [["页面范围", "当前已授权数据"]],
    }
  );
}

function getActiveDailyWageWorkbookFilter():
  | DailyWageWorkbookFilter
  | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as ExportScopeWindow).__roadConstructionDailyWageExportFilter;
}

/** Excel 导入仅接受用户下载的标准模板；先在浏览器做字段预检，写入仍由服务端事务二次校验。 */
function importText(value: unknown) {
  return String(value ?? "").trim();
}
function importOptionalText(value: unknown) {
  const text = importText(value);
  return text || null;
}
function importNumber(
  value: unknown,
  field: string,
  rowNumber: number,
  required = true
) {
  const text = importText(value).replaceAll(",", "");
  if (!text && !required) return null;
  const numberValue = Number(text);
  if (!Number.isFinite(numberValue))
    throw new Error(`第 ${rowNumber} 行“${field}”必须是有效数字`);
  return numberValue;
}
function importDateTime(value: unknown, field: string, rowNumber: number) {
  const text = importText(value);
  if (!text) throw new Error(`第 ${rowNumber} 行请填写“${field}”`);
  const normalized =
    /^\d{4}[/-]\d{1,2}[/-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(text)
      ? text
          .replaceAll("/", "-")
          .replace(
            /(\d{4}-\d{1,2}-\d{1,2})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?/,
            (_match, datePart, timePart) =>
              `${datePart}T${timePart || "00:00:00"}+08:00`
          )
      : text;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime()))
    throw new Error(
      `第 ${rowNumber} 行“${field}”格式不正确，请使用 YYYY-MM-DD HH:mm`
    );
  return date.toISOString();
}
function importYesNo(value: unknown, field: string, rowNumber: number) {
  const text = importText(value).toLocaleLowerCase();
  if (!text || ["否", "no", "n", "0", "false"].includes(text)) return false;
  if (["是", "yes", "y", "1", "true"].includes(text)) return true;
  throw new Error(`第 ${rowNumber} 行“${field}”请填写“是”或“否”`);
}
async function downloadPurchaseSpreadsheetTemplate(
  categories: Array<{ name: string }>
) {
  const categoryNames =
    categories.map(category => category.name).join("、") ||
    "请先进入采购仓储并等待类别加载";
  await downloadXlsxWorkbook(
    "采购仓储数据导入模板.xlsx",
    [
      {
        name: "采购订单导入",
        headers: [
          "订单号（留空自动生成）",
          "采购者（必填）",
          "采购类别（必填）",
          "物资说明（必填）",
          "数量（可选）",
          "单价（可选）",
          "订单金额（必填）",
          "下单时间（必填）",
          "供应商（可选）",
          "是否有发票（是/否）",
          "备注（可选）",
        ],
        rows: [],
      },
      {
        name: "库存流水导入",
        headers: [
          "流水单号（留空自动生成）",
          "收发类型（入库/领用出库/退库）",
          "物料名称（必填）",
          "计量单位（必填）",
          "数量（必填）",
          "单价（必填）",
          "发生时间（必填）",
          "备注（可选）",
        ],
        rows: [],
      },
      {
        name: "填写说明",
        headers: ["项目", "说明"],
        rows: [
          [
            "导入范围",
            "采购订单导入后均为“历史导入草稿”，不会自动触发审核、结算、通知或扣款。库存流水导入后立即进入项目库存台账。",
          ],
          [
            "时间格式",
            "请填写 YYYY-MM-DD HH:mm，例如 2026-10-16 15:30。所有时间按北京时间处理。",
          ],
          ["采购类别", `须使用当前标准类别：${categoryNames}`],
          [
            "采购者",
            "采购者为必填项，用于保留历史订单的实际采购人员；不等同于导入操作人或单据上传人。",
          ],
          [
            "金额规则",
            "采购订单：填写订单金额；如填写数量和单价，系统会校验订单金额=数量×单价。库存流水金额由数量×单价计算。",
          ],
          [
            "发票与附件",
            "“是否有发票”为“是”时，订单会明确显示“有发票待补附件”；图片/PDF需在订单详情后续上传，Excel不能直接导入图片。",
          ],
          [
            "重复保护",
            "订单号、库存流水号在同一文件或系统内重复时，整批不会写入。留空则由系统自动生成导入单号。",
          ],
          [
            "操作流程",
            "下载模板 → 填写并保存 .xlsx → 选择文件预检 → 核对预览条数 → 确认导入。单次最多500条。",
          ],
        ],
      },
    ],
    {
      module: "采购仓储数据导入模板",
      filters: [
        ["采购类别", categoryNames],
        ["写入状态", "仅模板，不写入业务数据"],
      ],
    }
  );
}
async function parsePurchaseSpreadsheetImport(
  file: File,
  categoryNames: readonly string[]
): Promise<PurchaseSpreadsheetImportPreview> {
  if (!/\.xlsx$/i.test(file.name))
    throw new Error("请上传由模板保存的 .xlsx Excel 文件");
  const XLSX = await import("@e965/xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    raw: false,
    cellDates: false,
  });
  const readRows = (sheetName: string) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [] as Record<string, unknown>[];
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: false,
    });
  };
  const orderRows = readRows("采购订单导入");
  const inventoryRows = readRows("库存流水导入");
  if (!workbook.Sheets["采购订单导入"] && !workbook.Sheets["库存流水导入"])
    throw new Error(
      "未找到“采购订单导入”或“库存流水导入”工作表，请使用系统模板"
    );
  const orders = orderRows
    .filter(row => Object.values(row).some(value => importText(value)))
    .map((row, index) => {
      const rowNumber = index + 2;
      const purchaserName = importText(row["采购者（必填）"]);
      const categoryName = importText(row["采购类别（必填）"]);
      const itemDescription = importText(row["物资说明（必填）"]);
      if (!purchaserName)
        throw new Error(`第 ${rowNumber} 行请填写“采购者（必填）”`);
      if (purchaserName.length > 128)
        throw new Error(`第 ${rowNumber} 行“采购者”不能超过 128 个字符`);
      if (!categoryName)
        throw new Error(`第 ${rowNumber} 行请填写“采购类别（必填）”`);
      if (!categoryNames.includes(categoryName))
        throw new Error(
          `第 ${rowNumber} 行采购类别“${categoryName}”不存在或已停用，请从模板说明复制类别名称`
        );
      if (!itemDescription)
        throw new Error(`第 ${rowNumber} 行请填写“物资说明（必填）”`);
      const quantity = importNumber(
        row["数量（可选）"],
        "数量",
        rowNumber,
        false
      );
      const unitPrice = importNumber(
        row["单价（可选）"],
        "单价",
        rowNumber,
        false
      );
      if ((quantity === null) !== (unitPrice === null))
        throw new Error(`第 ${rowNumber} 行数量和单价须同时填写，或同时留空`);
      const amount = importNumber(
        row["订单金额（必填）"],
        "订单金额",
        rowNumber
      )!;
      if (amount <= 0) throw new Error(`第 ${rowNumber} 行订单金额必须大于 0`);
      if (
        quantity !== null &&
        unitPrice !== null &&
        Math.abs(
          Number((quantity * unitPrice).toFixed(2)) - Number(amount.toFixed(2))
        ) > 0.01
      )
        throw new Error(`第 ${rowNumber} 行订单金额须等于数量×单价`);
      return {
        orderNo: importOptionalText(row["订单号（留空自动生成）"]),
        purchaserName,
        categoryName,
        itemDescription,
        quantity,
        unitPrice,
        amount,
        orderedAt: importDateTime(
          row["下单时间（必填）"],
          "下单时间",
          rowNumber
        ),
        supplierName: importOptionalText(row["供应商（可选）"]),
        hasInvoice: importYesNo(
          row["是否有发票（是/否）"],
          "是否有发票",
          rowNumber
        ),
        remarks: importOptionalText(row["备注（可选）"]),
      };
    });
  const inventoryTransactions = inventoryRows
    .filter(row => Object.values(row).some(value => importText(value)))
    .map((row, index) => {
      const rowNumber = index + 2;
      const transactionText = importText(row["收发类型（入库/领用出库/退库）"]);
      const transactionType:
        | PurchaseSpreadsheetInventoryImport["transactionType"]
        | null =
        transactionText === "入库"
          ? "inbound"
          : transactionText === "领用出库"
            ? "outbound"
            : transactionText === "退库"
              ? "return"
              : null;
      if (!transactionType)
        throw new Error(
          `第 ${rowNumber} 行“收发类型”请填写“入库”“领用出库”或“退库”`
        );
      const itemName = importText(row["物料名称（必填）"]);
      const unit = importText(row["计量单位（必填）"]);
      if (!itemName || !unit)
        throw new Error(`第 ${rowNumber} 行请填写物料名称和计量单位`);
      const quantity = importNumber(row["数量（必填）"], "数量", rowNumber)!;
      const unitCost = importNumber(row["单价（必填）"], "单价", rowNumber)!;
      if (quantity <= 0 || unitCost < 0)
        throw new Error(`第 ${rowNumber} 行数量须大于 0，单价不能小于 0`);
      return {
        transactionNo: importOptionalText(row["流水单号（留空自动生成）"]),
        transactionType,
        itemName,
        unit,
        quantity,
        unitCost,
        occurredAt: importDateTime(
          row["发生时间（必填）"],
          "发生时间",
          rowNumber
        ),
        remarks: importOptionalText(row["备注（可选）"]),
      };
    });
  if (!orders.length && !inventoryTransactions.length)
    throw new Error(
      "文件中没有可导入的数据行，请至少填写一条采购订单或库存流水"
    );
  if (orders.length + inventoryTransactions.length > 500)
    throw new Error("单次最多导入 500 条记录，请拆分文件后重试");
  return { fileName: file.name, orders, inventoryTransactions };
}

/** 浏览器端仅导出当前已授权且已筛选的台账数据；CSV 可直接由 Excel 打开，不额外暴露下载接口。 */
function downloadCsvFile(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
  scope = getActiveCsvExportScope()
) {
  const escapeCell = (value: string | number | null | undefined) =>
    `"${String(value ?? "").replaceAll('"', '""')}"`;
  const scopeRows: Array<Array<string | number | null | undefined>> = [
    ["导出模块", scope.module],
    ...scope.filters.map(([label, value]) => [
      `筛选条件 · ${label}`,
      value ?? "未设置",
    ]),
    ["导出记录数", rows.length],
    ["生成时间", formatChinaDateTime(new Date())],
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

/** 多工作表 Excel 统一写入授权范围、筛选条件和生成时间；日结分类表在浏览器端再次按当前筛选收敛，防止工作表和筛选栏不一致。 */
async function downloadXlsxWorkbook(
  filename: string,
  sheets: Array<{
    name: string;
    headers: string[];
    rows: Array<Array<string | number | null | undefined>>;
  }>,
  scope = getActiveCsvExportScope()
) {
  const dailyFilter = getActiveDailyWageWorkbookFilter();
  const matchesDailyWageFilter = (
    row: Array<string | number | null | undefined>
  ) => {
    if (!dailyFilter) return true;
    const [workerName, teamName, settlementDate, , , , , , status] = row.map(
      value => String(value ?? "")
    );
    const keyword = dailyFilter.keyword.trim().toLocaleLowerCase();
    const normalizedTeam = teamName || "未设置班组";
    return (
      (!dailyFilter.dateFrom || settlementDate >= dailyFilter.dateFrom) &&
      (!dailyFilter.dateTo || settlementDate <= dailyFilter.dateTo) &&
      (!keyword ||
        `${workerName} ${teamName}`.toLocaleLowerCase().includes(keyword)) &&
      (dailyFilter.team === "all" || normalizedTeam === dailyFilter.team) &&
      (dailyFilter.status === "all" ||
        status === getBusinessStatusLabel(dailyFilter.status))
    );
  };
  const scopedSheets = sheets.map(sheet =>
    sheet.name === "临时日结" && dailyFilter
      ? { ...sheet, rows: sheet.rows.filter(matchesDailyWageFilter) }
      : sheet
  );
  const scopedFilters: CsvExportScope["filters"] = dailyFilter
    ? [
        ...scope.filters,
        ["日结日期起", dailyFilter.dateFrom || "全部"],
        ["日结日期止", dailyFilter.dateTo || "全部"],
        ["日结人员/班组", dailyFilter.keyword || "全部"],
        ["日结班组", dailyFilter.team === "all" ? "全部" : dailyFilter.team],
        [
          "日结状态",
          dailyFilter.status === "all" ? "全部" : dailyFilter.status,
        ],
      ]
    : scope.filters;
  const exportScope = { ...scope, filters: scopedFilters };
  const XLSX = await import("@e965/xlsx");
  const workbook = XLSX.utils.book_new();
  const overviewRows: Array<Array<string | number | null | undefined>> = [
    ["导出模块", exportScope.module],
    ...exportScope.filters.map(([label, value]) => [
      `筛选条件 · ${label}`,
      value ?? "未设置",
    ]),
    ["生成时间", formatChinaDateTime(new Date())],
    [],
    ["工作表", "记录数"],
    ...scopedSheets.map(sheet => [sheet.name, sheet.rows.length]),
  ];
  const overview = XLSX.utils.aoa_to_sheet(overviewRows);
  overview["!cols"] = [{ wch: 22 }, { wch: 48 }];
  XLSX.utils.book_append_sheet(workbook, overview, "汇总说明");
  scopedSheets.forEach(sheet => {
    const worksheet = XLSX.utils.aoa_to_sheet([sheet.headers, ...sheet.rows]);
    worksheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: {
          r: Math.max(sheet.rows.length, 1),
          c: Math.max(sheet.headers.length - 1, 0),
        },
      }),
    };
    worksheet["!cols"] = sheet.headers.map(header => ({
      wch: Math.min(Math.max(header.length + 4, 12), 28),
    }));
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  });
  XLSX.writeFile(workbook, filename, { compression: true });
}

/** 日期字段优先保留接口返回的自然日，避免桌面端编辑日报时发生时区偏移。 */
function toBusinessDateInput(value: Date | string | null | undefined) {
  if (!value) return toLocalDateInput();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value))
    return value.slice(0, 10);
  return toLocalDateInput(new Date(value));
}

/** 只有草稿或退回日报可在桌面端提交编辑；类型守卫同时避免只读详情误用空表单。 */
function isEditableConstructionReport(
  input: ConstructionReportEditor | null
): input is ConstructionReportEditor {
  return (
    input !== null &&
    (!input.id || ["draft", "rejected"].includes(input.status))
  );
}

/** 将服务端 UTC 时间转换为 datetime-local 控件可编辑的本地值，避免维护授权有效期时出现时区偏移。 */
function toLocalDateTimeInput(value: Date | string | null | undefined) {
  return toDeviceDateTimeInput(value);
}

/** 后台仅展示推导状态；服务端仍以授权记录、角色状态和当前时间作为最终访问边界。 */
function getAssignmentLifecycle(input: {
  status: string;
  roleStatus: string;
  validFrom: Date | string | null;
  validTo: Date | string | null;
}) {
  if (input.status === "revoked")
    return { label: "已撤销", tone: "outline" as const };
  if (input.roleStatus !== "active")
    return { label: "角色已停用", tone: "destructive" as const };
  const now = Date.now();
  if (input.validFrom && new Date(input.validFrom).getTime() > now)
    return { label: "尚未生效", tone: "outline" as const };
  if (input.validTo && new Date(input.validTo).getTime() <= now)
    return { label: "已过期", tone: "outline" as const };
  return { label: "有效", tone: "secondary" as const };
}

function displayMoney(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "—";
}

/** 将后台表单转换为群发接口的三选一范围契约，避免浏览器同时提交项目、组织和岗位而扩大收件人。 */
function getBroadcastAudienceInput(form: BroadcastForm) {
  if (form.audienceType === "project")
    return {
      audienceType: "project" as const,
      projectId: Number(form.scopeValue),
    };
  if (form.audienceType === "organization")
    return {
      audienceType: "organization" as const,
      organizationId: Number(form.scopeValue),
    };
  return { audienceType: "role" as const, roleCode: form.scopeValue.trim() };
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
          <p className="text-xs font-semibold tracking-[0.1em] text-[#6d8179]">
            {title}
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-[#172a32]">
            {value ?? "—"}
          </p>
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
function LedgerTable({
  title,
  description,
  columns,
  rows,
  loading,
  titleActions,
  onBulkRemove,
  removeLabel = "删除",
  bulkRemoveLabel = "批量受控删除",
}: {
  title: string;
  description: string;
  columns: string[];
  rows: LedgerTableRow[];
  loading?: boolean;
  titleActions?: ReactNode;
  onBulkRemove?: (rows: LedgerTableRow[]) => void;
  removeLabel?: string;
  bulkRemoveLabel?: string;
}) {
  const removableRows = rows.filter(row => Boolean(row.onRemove));
  const [selectedIds, setSelectedIds] = useState<Array<string | number>>([]);
  const selectedRows = rows.filter(
    row => selectedIds.includes(row.id) && row.onRemove
  );
  const toggleRow = (id: string | number, checked: boolean) =>
    setSelectedIds(current =>
      checked
        ? Array.from(new Set([...current, id]))
        : current.filter(item => item !== id)
    );
  const toggleAll = (checked: boolean) =>
    setSelectedIds(checked ? removableRows.map(row => row.id) : []);
  return (
    <Card className="ledger-table-shell overflow-hidden border-[#d8e3e0] shadow-sm">
      <CardHeader className="border-b border-[#e1e8e4] pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">
              台账列表 · 可筛选 / 可导出
            </p>
            <CardTitle className="mt-1 text-base">{title}</CardTitle>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>
          {titleActions || onBulkRemove ? (
            <div className="flex flex-wrap gap-2">
              {titleActions}
              {onBulkRemove ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-10 sm:min-h-8"
                  disabled={!selectedRows.length}
                  onClick={() => onBulkRemove(selectedRows)}
                >
                  {bulkRemoveLabel}（{selectedRows.length}）
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <Table className="min-w-[780px] text-xs">
          <TableHeader className="sticky top-0 z-10 bg-[#edf1ed]">
            <TableRow className="border-[#dce3de] hover:bg-[#edf1ed]">
              {onBulkRemove ? (
                <TableHead className="h-11 w-11 px-3">
                  <input
                    aria-label="全选可受控删除记录"
                    type="checkbox"
                    checked={
                      Boolean(removableRows.length) &&
                      selectedIds.length === removableRows.length
                    }
                    onChange={event => toggleAll(event.target.checked)}
                  />
                </TableHead>
              ) : null}
              {columns.map(column => (
                <TableHead
                  className="h-11 px-4 font-semibold text-[#46615a]"
                  key={column}
                >
                  {column}
                </TableHead>
              ))}
              <TableHead className="h-11 px-4 text-right font-semibold text-[#46615a]">
                操作
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  className="px-4 py-8 text-center text-slate-500"
                  colSpan={columns.length + 1 + (onBulkRemove ? 1 : 0)}
                >
                  正在读取已授权台账记录…
                </TableCell>
              </TableRow>
            ) : rows.length ? (
              rows.map((row, index) => (
                <TableRow
                  className="border-[#edf0ee] hover:bg-[#fbfaf1]"
                  key={row.id}
                >
                  {onBulkRemove ? (
                    <TableCell className="w-11 px-3">
                      {row.onRemove ? (
                        <input
                          aria-label={`选择第 ${index + 1} 条记录`}
                          type="checkbox"
                          checked={selectedIds.includes(row.id)}
                          onChange={event =>
                            toggleRow(row.id, event.target.checked)
                          }
                        />
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </TableCell>
                  ) : null}
                  {row.cells.map((cell, cellIndex) => (
                    <TableCell
                      className={`px-4 py-3 text-slate-700 ${cellIndex === 0 ? "font-medium text-[#203c48]" : ""}`}
                      key={`${row.id}-${cellIndex}`}
                    >
                      {cell}
                    </TableCell>
                  ))}
                  <TableCell className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      {row.onOpen ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={row.onOpen}
                        >
                          详情
                        </Button>
                      ) : null}
                      {row.onEdit ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={row.onEdit}
                        >
                          编辑
                        </Button>
                      ) : null}
                      {row.onRemove ? (
                        <Button
                          size="sm"
                          variant={
                            removeLabel === "删除" ? "destructive" : "outline"
                          }
                          onClick={row.onRemove}
                        >
                          {removeLabel}
                        </Button>
                      ) : !row.onOpen && !row.onEdit ? (
                        <span className="text-slate-400">
                          第 {index + 1} 条
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  className="px-4 py-8 text-center text-slate-500"
                  colSpan={columns.length + 1 + (onBulkRemove ? 1 : 0)}
                >
                  暂无匹配记录。可调整筛选条件，或通过本模块录入真实业务数据。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <p className="border-t border-[#edf0ee] px-4 py-3 text-xs text-slate-500">
          手机端可左右滑动查看完整字段；编辑、删除和批量处理仍由服务端逐条校验关联、权限、项目范围和审计要求。
        </p>
      </CardContent>
    </Card>
  );
}

export default function AdminPage({
  scopedSection,
  authorizedMenuItems,
}: {
  scopedSection?: ScopedPcAdminSection;
  authorizedMenuItems?: DashboardMenuItem[];
} = {}) {
  const { isAuthenticated, user } = useAuth();
  const [location, setLocation] = useLocation();
  const trpcUtils = trpc.useUtils();
  const activeSection = scopedSection ?? (location.split("/")[2] || "overview");
  const scopedMenuItems: DashboardMenuItem[] = scopedSection
    ? (authorizedMenuItems ?? [
        {
          icon: LayoutDashboard,
          label: "业务工作台",
          path: "/admin",
          section: "我的工作台",
        },
        ...ADMIN_MENU.filter(
          item => item.path === `/admin/${activeSection}`
        ).map(item => ({ ...item, section: "当前业务" })),
      ])
    : ADMIN_MENU;
  const [dieselReceiptPreview, setDieselReceiptPreview] = useState<
    string | null
  >(null);
  const [dieselCameraOpen, setDieselCameraOpen] = useState(false);
  const [dieselCameraStream, setDieselCameraStream] =
    useState<MediaStream | null>(null);
  const dieselCameraVideoRef = useRef<HTMLVideoElement | null>(null);

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
  const { isSuperAdmin: purchasingIsSuperAdmin } = useManagementPermissions();
  const isMeasurementTools = activeSection === "measurement-tools";
  const isSubcontract = activeSection === "subcontract";
  const isContracts = activeSection === "contracts";
  const isDiesel = activeSection === "diesel";
  const isRisk = activeSection === "risk";
  const isFinance = activeSection === "finance" || isDiesel;
  const isBroadcast = activeSection === "broadcast";
  const isWechatLogin = activeSection === "wechat-login";
  const isBusinessWorkspace =
    isConstruction ||
    isLabor ||
    isMachinery ||
    isTransport ||
    isPurchasing ||
    isSubcontract ||
    isContracts;
  const isPermission = activeSection === "permission";
  const isBusiness = activeSection === "business";
  const isSettings = activeSection === "settings";
  const isAudit = activeSection === "audit";
  const needsOrganizations = isOrganization || isVehicle || isPermission;
  const needsProjects =
    isOrganization ||
    isVehicle ||
    isPermission ||
    isBusiness ||
    isBusinessWorkspace ||
    isFinance ||
    isRisk ||
    isSettings;
  const needsUsers = isOrganization || isVehicle || isPermission || isMachinery;

  const overview = trpc.admin.overview.useQuery(undefined, {
    enabled: canQuery && isOverview,
  });
  const organizations = trpc.admin.organization.list.useQuery(undefined, {
    enabled: canQuery && needsOrganizations,
  });
  const positions = trpc.admin.position.list.useQuery(undefined, {
    enabled: canQuery && isOrganization,
  });
  const projects = trpc.admin.project.listAccessible.useQuery(undefined, {
    enabled: canQuery && needsProjects,
  });
  const roles = trpc.admin.role.list.useQuery(undefined, {
    enabled: canQuery && isPermission,
  });
  const roleTemplates = trpc.admin.role.templates.useQuery(undefined, {
    enabled: canQuery && isPermission,
  });
  const permissions = trpc.admin.role.permissions.useQuery(undefined, {
    enabled: canQuery && isPermission,
  });
  const users = trpc.admin.personnel.listUsers.useQuery(undefined, {
    enabled: canQuery && needsUsers,
  });
  const assignments = trpc.admin.personnel.listAssignments.useQuery(undefined, {
    enabled: canQuery && isPermission,
  });
  const departmentScopes = trpc.admin.department.listScopes.useQuery(
    undefined,
    { enabled: canQuery && isPermission }
  );
  const departmentModules = trpc.admin.department.modules.useQuery(undefined, {
    enabled: canQuery && isPermission,
  });
  const settings = trpc.admin.settings.list.useQuery(undefined, {
    enabled: canQuery && isSettings,
  });
  const externalAiConfiguration =
    trpc.admin.settings.getExternalAiConfiguration.useQuery(undefined, {
      enabled: canQuery && isSettings,
    });
  const aliyunOssPhotoStorageConfiguration =
    trpc.admin.settings.getAliyunOssPhotoStorageConfiguration.useQuery(
      undefined,
      { enabled: canQuery && isSettings }
    );
  const officialMessagePushConfiguration =
    trpc.admin.settings.getOfficialAccountMessagePushConfiguration.useQuery(
      undefined,
      { enabled: canQuery && isSettings }
    );
  const evidenceWatermarkTemplate =
    trpc.admin.settings.evidenceWatermarkTemplate.useQuery(undefined, {
      enabled: canQuery && (isSettings || isDiesel),
    });
  const officialTemplateCoverage =
    trpc.admin.settings.officialAccountTemplateCoverage.useQuery(undefined, {
      enabled: canQuery && isSettings,
    });
  const dailyDigestSettings = trpc.dailyDigest.getSettings.useQuery(undefined, {
    enabled: canQuery && isSettings,
  });
  const audits = trpc.admin.audit.list.useQuery(undefined, {
    enabled: canQuery && isAudit,
  });
  const auditIntegrity = trpc.admin.audit.integrity.useQuery(undefined, {
    enabled: canQuery && isAudit,
    retry: false,
  });
  const sensitiveAccesses = trpc.admin.audit.sensitiveAccesses.useQuery(
    { limit: 50 },
    { enabled: canQuery && isAudit, retry: false }
  );
  const broadcastOptions = trpc.broadcast.formOptions.useQuery(undefined, {
    enabled: canQuery && isBroadcast,
  });
  const broadcasts = trpc.broadcast.list.useQuery(undefined, {
    enabled: canQuery && isBroadcast,
  });
  const wechatLogins = trpc.admin.wechatLogin.list.useQuery(undefined, {
    enabled: canQuery && isWechatLogin,
  });
  const realDataReadiness = trpc.admin.acceptance.realDataReadiness.useQuery(
    undefined,
    { enabled: canQuery && isOverview }
  );
  const vehicles = trpc.admin.vehicle.list.useQuery(undefined, {
    enabled: canQuery && isVehicle,
  });
  const employeeProfiles = trpc.admin.employee.listProfiles.useQuery(
    undefined,
    { enabled: canQuery && isPermission }
  );
  const employeeOptions = trpc.admin.employee.options.useQuery(undefined, {
    enabled: canQuery && isPermission,
  });
  const constructionWorkerOptions = useMemo(
    () =>
      (employeeOptions.data?.laborWorkers ?? []).filter(
        worker => worker.workerCategory === "labor_team"
      ),
    [employeeOptions.data?.laborWorkers]
  );
  const companyPersonnelRoster = trpc.admin.employee.listCompanyRoster.useQuery(
    undefined,
    { enabled: canQuery && isLabor && !scopedSection }
  );
  const assetMaintenanceRecords = trpc.admin.assetMaintenance.list.useQuery(
    undefined,
    { enabled: canQuery && (isVehicle || isMachinery) }
  );
  const assetMaintenanceSummary = trpc.admin.assetMaintenance.summary.useQuery(
    undefined,
    { enabled: canQuery && (isVehicle || isMachinery) }
  );
  const [businessFilter, setBusinessFilter] = useState({
    projectId: "all",
    period: "",
  });
  const [businessWorkspaceProjectId, setBusinessWorkspaceProjectId] =
    useState("");
  const [selectedMachineId, setSelectedMachineId] = useState("");
  const [machineDetailOpen, setMachineDetailOpen] = useState(false);
  // transport-workspace-v1: hooks are unconditional; each current-tab query is enabled explicitly.
  const [transportWorkspaceTab, setTransportWorkspaceTab] =
    useState<TransportWorkspaceTab>("ledger");
  // vehicle-management-workspace-v1: vehicle registry is independent of daily transport filters.
  const [vehicleCreateRequest, setVehicleCreateRequest] = useState<{
    projectId: number;
    requestId: number;
  }>();
  const [workspaceDrafts, setWorkspaceDrafts] = useState<
    Record<string, boolean>
  >({});
  const recordWorkspaceDirty = useCallback((key: string, dirty: boolean) => {
    setWorkspaceDrafts(current =>
      current[key] === dirty ? current : { ...current, [key]: dirty }
    );
  }, []);
  const onVehicleManagementDirtyChange = useCallback(
    (dirty: boolean) => recordWorkspaceDirty("vehicle-management", dirty),
    [recordWorkspaceDirty]
  );
  const onAdministratorManagementDirtyChange = useCallback(
    (dirty: boolean) => recordWorkspaceDirty("administrator-management", dirty),
    [recordWorkspaceDirty]
  );
  const onPurchasingDirtyChange = useCallback(
    (dirty: boolean) => recordWorkspaceDirty("purchasing", dirty),
    [recordWorkspaceDirty]
  );
  const onEvidenceDirtyChange = useCallback(
    (dirty: boolean) => recordWorkspaceDirty("evidence", dirty),
    [recordWorkspaceDirty]
  );
  const onTransportSettlementDirtyChange = useCallback(
    (dirty: boolean) => recordWorkspaceDirty("transport-settlement", dirty),
    [recordWorkspaceDirty]
  );
  const onTransportRatesDirtyChange = useCallback(
    (dirty: boolean) => recordWorkspaceDirty("transport-rates", dirty),
    [recordWorkspaceDirty]
  );
  const onTransportRoutesDirtyChange = useCallback(
    (dirty: boolean) => recordWorkspaceDirty("transport-routes", dirty),
    [recordWorkspaceDirty]
  );
  const onTransportTerminalsDirtyChange = useCallback(
    (dirty: boolean) => recordWorkspaceDirty("transport-terminals", dirty),
    [recordWorkspaceDirty]
  );
  const hasWorkspaceDraft = Object.values(workspaceDrafts).some(Boolean);
  useEffect(() => {
    if (!hasWorkspaceDraft) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const beforeNavigate = (event: MouseEvent) => {
      const target =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (!target) return;
      const href = new URL(
        target.getAttribute("href") || "",
        window.location.href
      );
      if (
        href.origin !== window.location.origin ||
        !href.pathname.startsWith("/admin") ||
        href.pathname === window.location.pathname
      )
        return;
      if (
        !window.confirm(
          "有尚未保存的业务资料，离开当前模块将放弃未保存内容。确认离开吗？"
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeNavigate, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", beforeNavigate, true);
    };
  }, [hasWorkspaceDraft]);

  const [transportReviewView, setTransportReviewView] =
    useState<TransportReviewView>("pending");
  const [transportSettlementFocusTrip, setTransportSettlementFocusTrip] =
    useState<TransportSettlementFocusTrip | null>(null);
  const [transportLedgerFilter, setTransportLedgerFilter] =
    useState<TransportLedgerFilter>({
      periodMode: "day",
      date: toLocalDateInput(),
      month: toChinaMonthInput(),
      dateFrom: toLocalDateInput(),
      dateTo: toLocalDateInput(),
      vehicleId: "all",
      status: "all",
      routePresetId: "all",
    });
  /** 旧简版运输表仅作兼容渲染，完整筛选由 transportLedgerFilter 接管。 */
  const [transportDate, setTransportDate] = useState(() => toLocalDateInput());
  const [dailyWagePaymentTarget, setDailyWagePaymentTarget] = useState<{
    id: number;
    workerName: string;
  } | null>(null);
  const [subcontractTeamFilter, setSubcontractTeamFilter] = useState("all");
  const [subcontractStatusFilter, setSubcontractStatusFilter] = useState("all");
  const [subcontractTeamForm, setSubcontractTeamForm] =
    useState<SubcontractTeamForm>(EMPTY_SUBCONTRACT_TEAM_FORM);
  const [subcontractPackageForm, setSubcontractPackageForm] =
    useState<SubcontractPackageForm>(EMPTY_SUBCONTRACT_PACKAGE_FORM);
  const [subcontractTeamDialogOpen, setSubcontractTeamDialogOpen] =
    useState(false);
  const [subcontractPackageDialogOpen, setSubcontractPackageDialogOpen] =
    useState(false);
  const [measurementTakeoffForm, setMeasurementTakeoffForm] =
    useState<MeasurementTakeoffForm>(EMPTY_MEASUREMENT_TAKEOFF_FORM);
  const [measurementTakeoffDialogOpen, setMeasurementTakeoffDialogOpen] =
    useState(false);
  const [financeProjectId, setFinanceProjectId] = useState("");
  const financeUtils = trpc.useUtils();
  const [financePaymentTarget, setFinancePaymentTarget] = useState<{
    projectId: number;
    sourceType:
      | "transport_vehicle"
      | "machine"
      | "payroll"
      | "daily_wage"
      | "subcontract";
    settlementId: number;
    settlementNo: string;
    readOnly: boolean;
  } | null>(null);
  const [dieselTab, setDieselTab] = useState<
    "ledger" | "prices" | "suppliers" | "receipts"
  >("ledger");
  const [dieselPriceDialogOpen, setDieselPriceDialogOpen] = useState(false);
  const [dieselRefuelDialogOpen, setDieselRefuelDialogOpen] = useState(false);
  const [financeTab, setFinanceTab] = useState<FinanceWorkspaceTab>("overview");
  const [financeSettlementView, setFinanceSettlementView] = useState<
    "board" | "records"
  >("board");
  const [financeClosingView, setFinanceClosingView] = useState<
    "daily" | "reconciliation"
  >("daily");
  const [financeCostsView, setFinanceCostsView] = useState<
    "categories" | "subcategories"
  >("categories");
  const [financeTaxDirty, setFinanceTaxDirty] = useState(false);
  const [financeInvoiceFilter, setFinanceInvoiceFilter] = useState({
    status: "all",
    keyword: "",
  });
  const [financeLedgerPage, setFinanceLedgerPage] = useState(1);
  const [financeLedgerPageSize, setFinanceLedgerPageSize] = useState(20);
  const [financeInvoicePage, setFinanceInvoicePage] = useState(1);
  const [financeInvoicePageSize, setFinanceInvoicePageSize] = useState(20);
  const [financeExpensePage, setFinanceExpensePage] = useState(1);
  const [financeExpensePageSize, setFinanceExpensePageSize] = useState(20);
  const [financePeriod, setFinancePeriod] = useState(() => toChinaMonthInput());
  const [financeLedgerFilter, setFinanceLedgerFilter] = useState({
    direction: "all",
    category: "all",
    settlementStatus: "all",
    sourceType: "all",
    keyword: "",
  });
  const [expenseCategoryDetailOpen, setExpenseCategoryDetailOpen] =
    useState(false);
  const [expenseCategoryDetailFilter, setExpenseCategoryDetailFilter] =
    useState(() => ({
      category: "all",
      source: "all",
      status: "all",
      dateFrom: toLocalDateInput(),
      dateTo: toLocalDateInput(),
      keyword: "",
    }));
  const [financePrintPreview, setFinancePrintPreview] = useState<
    "ledger" | "invoices" | "categories" | "subcategories" | null
  >(null);
  const [paymentBillPrintOpen, setPaymentBillPrintOpen] = useState(false);
  const confirmFinanceScopeChange = () =>
    !financePaymentTarget &&
    !dieselRefuelDialogOpen &&
    !dieselPriceDialogOpen &&
    (!(financeTaxDirty || financeReopenReason.trim()) ||
      window.confirm(
        "当前财务资料有未保存内容。切换项目或月份将清空未保存内容，是否继续？"
      ));
  const changeFinanceProject = (value: string) => {
    if (value === financeProjectId || !confirmFinanceScopeChange()) return;
    setFinanceProjectId(value);
    setFinancePrintPreview(null);
    setExpenseCategoryDetailOpen(false);
    setFinanceReopenReason("");
    setFinanceTaxDirty(false);
  };
  const changeFinancePeriod = (value: string) => {
    if (
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(value) ||
      value === financePeriod ||
      !confirmFinanceScopeChange()
    )
      return;
    setFinancePeriod(value);
    setFinancePrintPreview(null);
    setExpenseCategoryDetailOpen(false);
    setFinanceReopenReason("");
    setFinanceTaxDirty(false);
  };
  useEffect(() => {
    setFinanceLedgerPage(1);
  }, [
    financeProjectId,
    financePeriod,
    financeLedgerFilter,
    financeLedgerPageSize,
  ]);
  useEffect(() => {
    setFinanceInvoicePage(1);
  }, [
    financeProjectId,
    financePeriod,
    financeInvoiceFilter,
    financeInvoicePageSize,
  ]);
  useEffect(() => {
    setFinanceExpensePage(1);
  }, [
    financeProjectId,
    financePeriod,
    expenseCategoryDetailFilter,
    financeExpensePageSize,
  ]);
  const [riskScanDate, setRiskScanDate] = useState(() => toLocalDateInput());
  const [riskAlertStatus, setRiskAlertStatus] = useState<
    | "all"
    | "open"
    | "acknowledged"
    | "in_rectification"
    | "resolved"
    | "ignored"
  >("all");
  const [riskRuleForm, setRiskRuleForm] =
    useState<RiskRuleForm>(EMPTY_RISK_RULE_FORM);
  type RiskRectificationTarget = {
    id: number;
    title: string;
    assigneeUserId: string;
    dueAt: string;
    rectificationNote: string;
  };
  const [riskRectificationTarget, setRiskRectificationTargetState] =
    useState<RiskRectificationTarget | null>(null);
  const setRiskRectificationTarget = (
    next:
      | RiskRectificationTarget
      | null
      | ((
          current: RiskRectificationTarget | null
        ) => RiskRectificationTarget | null)
  ) => {
    setRiskRectificationTargetState(current => {
      if (typeof next === "function") return next(current);
      return next?.dueAt
        ? { ...next, dueAt: toDeviceDateTimeInput(`${next.dueAt}:00Z`) }
        : next;
    });
  };
  const [riskBriefing, setRiskBriefing] = useState<{
    executiveSummary: string;
    priorityActions: string[];
    watchItems: string[];
    disclaimer: string;
    source: "external" | "builtin" | "fallback";
    model: string;
    externalFallback?: string | null;
  } | null>(null);
  const [machineStatementPeriod, setMachineStatementPeriod] = useState(() =>
    toChinaMonthInput()
  );
  const [vehicleAnalysisPeriod, setVehicleAnalysisPeriod] = useState(() =>
    toChinaMonthInput()
  );
  const [vehicleAnalysisTarget, setVehicleAnalysisTarget] = useState<{
    vehicleId: number;
    projectId: number;
    plateNo: string;
  } | null>(null);
  const [machineStatementForm, setMachineStatementForm] =
    useState<MachineMonthlyStatementForm>(EMPTY_MACHINE_MONTHLY_STATEMENT_FORM);
  const [machineStatementDialogOpen, setMachineStatementDialogOpen] =
    useState(false);
  const [financeClosingDate, setFinanceClosingDate] = useState(() =>
    toLocalDateInput()
  );
  const [financeReopenReason, setFinanceReopenReason] = useState("");
  const [dieselDate, setDieselDate] = useState(() => toLocalDateInput());
  const [dieselLedgerFilter, setDieselLedgerFilter] = useState(() => ({
    plateNo: "",
    dateFrom: toLocalDateInput(),
    dateTo: toLocalDateInput(),
    month: "",
    supplyMethod: "all",
    assetType: "all",
    supplierName: "",
  }));
  const [dieselMachineName, setDieselMachineName] = useState("");
  const [dieselPrintMode, setDieselPrintMode] = useState<
    "current" | "daily" | "vehicle" | "machine"
  >("current");
  const [dieselPrintOpen, setDieselPrintOpen] = useState(false);
  const [watermarkTemplateForm, setWatermarkTemplateForm] =
    useState<EvidenceWatermarkTemplate>({
      ...DEFAULT_EVIDENCE_WATERMARK_TEMPLATE,
      fields: [...DEFAULT_EVIDENCE_WATERMARK_TEMPLATE.fields],
    });
  const [broadcastForm, setBroadcastForm] =
    useState<BroadcastForm>(EMPTY_BROADCAST_FORM);
  const [selectedBroadcastId, setSelectedBroadcastId] = useState<number>();
  const [payrollPaymentTarget, setPayrollPaymentTarget] =
    useState<PayrollPaymentTarget | null>(null);
  const [constructionReportEditor, setConstructionReportEditor] =
    useState<ConstructionReportEditor | null>(null);
  const [constructionEditorSnapshot, setConstructionEditorSnapshot] =
    useState("");
  const [desktopRecordDetail, setDesktopRecordDetail] =
    useState<DesktopRecordDetail | null>(null);
  const [purchasingOrderUploader, setPurchasingOrderUploader] = useState("all");
  const [purchasingOrderPurchaser, setPurchasingOrderPurchaser] =
    useState("all");
  const [purchasingOrderCategory, setPurchasingOrderCategory] = useState("all");
  const [purchasingOrderInvoice, setPurchasingOrderInvoice] = useState("all");
  const [purchasingOrderDateFrom, setPurchasingOrderDateFrom] = useState(() =>
    toChinaDateInput()
  );
  const [purchasingOrderDateTo, setPurchasingOrderDateTo] = useState(() =>
    toChinaDateInput()
  );
  const [inventoryTransactionForm, setInventoryTransactionForm] =
    useState<InventoryTransactionForm>(EMPTY_INVENTORY_TRANSACTION_FORM);
  const [inventoryTransactionDialogOpen, setInventoryTransactionDialogOpen] =
    useState(false);
  const [purchaseSpreadsheetImportOpen, setPurchaseSpreadsheetImportOpen] =
    useState(false);
  const [
    purchaseSpreadsheetImportPreview,
    setPurchaseSpreadsheetImportPreview,
  ] = useState<PurchaseSpreadsheetImportPreview | null>(null);
  const [vehicleLedgerFilter, setVehicleLedgerFilter] = useState({
    search: "",
    projectId: "all",
    ownership: "all",
    status: "all",
  });
  const [vehicleSettlementFocus, setVehicleSettlementFocus] = useState<{
    id: number;
    requestId: number;
  } | null>(null);
  useEffect(() => {
    if (evidenceWatermarkTemplate.data?.template)
      setWatermarkTemplateForm({
        ...evidenceWatermarkTemplate.data.template,
        fields: [...evidenceWatermarkTemplate.data.template.fields],
      });
  }, [evidenceWatermarkTemplate.data?.template]);
  const businessStatisticsInput = useMemo(
    () => ({
      projectId:
        businessFilter.projectId === "all"
          ? undefined
          : Number(businessFilter.projectId),
      period: businessFilter.period || undefined,
    }),
    [businessFilter.period, businessFilter.projectId]
  );
  const businessStatistics = trpc.admin.business.statistics.useQuery(
    businessStatisticsInput,
    { enabled: canQuery && isBusiness }
  );
  const operatingDashboard = trpc.admin.business.operatingDashboard.useQuery(
    businessStatisticsInput,
    { enabled: canQuery && isBusiness }
  );
  const backups = trpc.admin.backup.list.useQuery(undefined, {
    enabled: canQuery && isBusiness,
  });
  const fullDatabaseBackup = trpc.admin.backup.fullStatus.useQuery(undefined, {
    enabled: canQuery && isBusiness,
  });
  const fullDatabaseBackupHistory = trpc.admin.backup.fullHistory.useQuery(
    undefined,
    {
      enabled: canQuery && isBusiness,
    }
  );
  const workspaceProjectState = getBusinessWorkspaceProjectState(
    businessWorkspaceProjectId
  );
  const workspaceProjectId = workspaceProjectState.projectId;
  const hasBusinessWorkspaceProject = workspaceProjectState.hasProject;
  const workspaceProjectInput = useMemo(
    () => ({ projectId: workspaceProjectId }),
    [workspaceProjectId]
  );
  const machineCostWorkspaceInput = useMemo(
    () => ({
      machineId: Number(selectedMachineId || 0),
      projectId: workspaceProjectId,
    }),
    [selectedMachineId, workspaceProjectId]
  );
  const machineMonthlyStatementsInput = useMemo(
    () => ({ projectId: workspaceProjectId, period: machineStatementPeriod }),
    [machineStatementPeriod, workspaceProjectId]
  );
  const machineAnalysisInput = useMemo(
    () => ({
      machineId: Number(selectedMachineId || 0),
      projectId: workspaceProjectId,
      period: machineStatementPeriod,
    }),
    [machineStatementPeriod, selectedMachineId, workspaceProjectId]
  );
  const machineMonthlyPreviewInput = useMemo(
    () => ({
      machineId: Number(machineStatementForm.machineId || 0),
      projectId: Number(machineStatementForm.projectId || 0),
      period: machineStatementForm.period,
      driverUserId: machineStatementForm.driverUserId
        ? Number(machineStatementForm.driverUserId)
        : null,
      machineWorkDays: Number(machineStatementForm.machineWorkDays || 0),
      machineOvertimeHours: Number(
        machineStatementForm.machineOvertimeHours || 0
      ),
      driverMonthlyWage: Number(machineStatementForm.driverMonthlyWage || 0),
      driverWorkDays: Number(machineStatementForm.driverWorkDays || 0),
      driverOvertimeHours: Number(
        machineStatementForm.driverOvertimeHours || 0
      ),
      signatureName: machineStatementForm.signatureName.trim() || null,
      remarks: machineStatementForm.remarks.trim() || null,
    }),
    [machineStatementForm]
  );
  const vehicleSummariesInput = useMemo(
    () => ({
      projectId:
        vehicleLedgerFilter.projectId === "all"
          ? undefined
          : Number(vehicleLedgerFilter.projectId),
      period: vehicleAnalysisPeriod,
    }),
    [vehicleAnalysisPeriod, vehicleLedgerFilter.projectId]
  );
  const vehicleAnalysisInput = useMemo(
    () => ({
      vehicleId: vehicleAnalysisTarget?.vehicleId ?? 0,
      projectId: vehicleAnalysisTarget?.projectId ?? 0,
      period: vehicleAnalysisPeriod,
    }),
    [vehicleAnalysisPeriod, vehicleAnalysisTarget]
  );
  const transportWorkspaceInput = useMemo(
    () => ({
      projectId: workspaceProjectId,
      reviewView:
        transportWorkspaceTab === "review" ? transportReviewView : undefined,
      date:
        transportLedgerFilter.periodMode === "day"
          ? transportLedgerFilter.date || undefined
          : undefined,
      month:
        transportLedgerFilter.periodMode === "month"
          ? transportLedgerFilter.month || undefined
          : undefined,
      dateFrom:
        transportLedgerFilter.periodMode === "custom"
          ? transportLedgerFilter.dateFrom || undefined
          : undefined,
      dateTo:
        transportLedgerFilter.periodMode === "custom"
          ? transportLedgerFilter.dateTo || undefined
          : undefined,
      vehicleId:
        transportLedgerFilter.vehicleId === "all"
          ? undefined
          : Number(transportLedgerFilter.vehicleId),
      status:
        transportLedgerFilter.status === "all"
          ? undefined
          : (transportLedgerFilter.status as
              | "draft"
              | "submitted"
              | "verified"
              | "settled"
              | "void"),
      routePresetId:
        transportLedgerFilter.routePresetId === "all"
          ? undefined
          : Number(transportLedgerFilter.routePresetId),
    }),
    [
      transportLedgerFilter,
      workspaceProjectId,
      transportWorkspaceTab,
      transportReviewView,
    ]
  );
  const subcontractPackagesInput = useMemo(
    () => ({
      projectId: workspaceProjectId,
      subcontractTeamId:
        subcontractTeamFilter === "all"
          ? undefined
          : Number(subcontractTeamFilter),
      status:
        subcontractStatusFilter === "all"
          ? undefined
          : (subcontractStatusFilter as
              | "draft"
              | "allocated"
              | "confirmed"
              | "settled"
              | "void"),
    }),
    [subcontractStatusFilter, subcontractTeamFilter, workspaceProjectId]
  );
  const financeProjectInput = useMemo(
    () => ({
      projectId: Number(financeProjectId || 0),
      period: financePeriod || undefined,
    }),
    [financePeriod, financeProjectId]
  );
  const riskProjectInput = useMemo(
    () => ({ projectId: Number(financeProjectId || 0) }),
    [financeProjectId]
  );
  const riskAlertsInput = useMemo(
    () => ({
      projectId: Number(financeProjectId || 0),
      period: financePeriod,
      status: riskAlertStatus,
    }),
    [financePeriod, financeProjectId, riskAlertStatus]
  );
  const expenseCategoryDetailInput = useMemo(
    () => ({
      projectId: Number(financeProjectId || 0),
      period: financePeriod,
      category:
        expenseCategoryDetailFilter.category === "all"
          ? undefined
          : (expenseCategoryDetailFilter.category as
              | "living"
              | "diesel"
              | "payroll"
              | "machinery"
              | "vehicle_transport"
              | "purchasing"
              | "other"),
      source:
        expenseCategoryDetailFilter.source === "all"
          ? undefined
          : (expenseCategoryDetailFilter.source as
              | "finance_record"
              | "diesel_refuel"
              | "payroll_statement"
              | "daily_wage"
              | "purchase_order"
              | "machine_cost"
              | "machine_payment_settlement"
              | "asset_maintenance"
              | "transport_settlement"),
      status:
        expenseCategoryDetailFilter.status === "all"
          ? undefined
          : (expenseCategoryDetailFilter.status as
              | "draft"
              | "reviewing"
              | "submitted"
              | "approved"
              | "confirmed"
              | "received"
              | "closed"
              | "settled"
              | "unpaid"
              | "partial"
              | "paid"),
      dateFrom: expenseCategoryDetailFilter.dateFrom || undefined,
      dateTo: expenseCategoryDetailFilter.dateTo || undefined,
      keyword: expenseCategoryDetailFilter.keyword.trim() || undefined,
    }),
    [expenseCategoryDetailFilter, financePeriod, financeProjectId]
  );
  const dieselRefuelRecordsInput = useMemo(
    () => ({
      projectId: Number(financeProjectId || 0),
      plateNo: dieselLedgerFilter.plateNo.trim() || undefined,
      dateFrom: dieselLedgerFilter.dateFrom || undefined,
      dateTo: dieselLedgerFilter.dateTo || undefined,
      month: dieselLedgerFilter.month || undefined,
      supplyMethod:
        dieselLedgerFilter.supplyMethod === "all"
          ? undefined
          : (dieselLedgerFilter.supplyMethod as
              | "project_supply"
              | "external_station"),
      assetType:
        dieselLedgerFilter.assetType === "all"
          ? undefined
          : (dieselLedgerFilter.assetType as "vehicle" | "machine"),
      machineName: dieselMachineName.trim() || undefined,
      supplierName: dieselLedgerFilter.supplierName.trim() || undefined,
    }),
    [dieselLedgerFilter, dieselMachineName, financeProjectId]
  );
  const broadcastAudienceInput = useMemo(
    () => getBroadcastAudienceInput(broadcastForm),
    [broadcastForm]
  );
  const validBroadcastScope =
    broadcastForm.audienceType === "role"
      ? Boolean(broadcastForm.scopeValue.trim())
      : Number.isInteger(Number(broadcastForm.scopeValue)) &&
        Number(broadcastForm.scopeValue) > 0;
  const broadcastAudiencePreview = trpc.broadcast.previewAudience.useQuery(
    broadcastAudienceInput,
    { enabled: canQuery && isBroadcast && validBroadcastScope, retry: false }
  );
  const broadcastDeliveries = trpc.broadcast.getDeliveries.useQuery(
    { broadcastId: selectedBroadcastId ?? 0 },
    {
      enabled: canQuery && isBroadcast && selectedBroadcastId !== undefined,
      retry: false,
    }
  );
  const constructionEditorCapabilities =
    trpc.construction.capabilities.useQuery(workspaceProjectInput, {
      enabled: canQuery && isConstruction && hasBusinessWorkspaceProject,
      retry: false,
    });
  const constructionEditorDirty =
    Boolean(constructionReportEditor) &&
    JSON.stringify(constructionReportEditor) !== constructionEditorSnapshot;
  useEffect(() => {
    if (
      constructionReportEditor &&
      constructionReportEditor.projectId !== workspaceProjectId
    ) {
      setConstructionReportEditor(null);
      setConstructionEditorSnapshot("");
      toast.info(
        "当前项目已变化，原项目日报编辑窗口已关闭，请在原项目重新打开记录"
      );
    }
  }, [workspaceProjectId, constructionReportEditor]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (constructionEditorDirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [constructionEditorDirty]);
  const machineryLedger = trpc.machinery.listMachines.useQuery(
    workspaceProjectInput,
    { enabled: canQuery && isMachinery && hasBusinessWorkspaceProject }
  );
  const machineCosts = trpc.machinery.listCosts.useQuery(
    machineCostWorkspaceInput,
    {
      enabled: false,
    }
  );
  const machineCostSummaries = trpc.machinery.listCostSummaries.useQuery(
    workspaceProjectInput,
    { enabled: false }
  );
  const machineMonthlyStatements =
    trpc.machinery.listMonthlyStatements.useQuery(
      machineMonthlyStatementsInput,
      {
        enabled: false,
      }
    );
  const machineAnalysis = trpc.machinery.getMachineAnalysis.useQuery(
    machineAnalysisInput,
    {
      enabled: false,
      retry: false,
    }
  );
  const machineMonthlyPreview = trpc.machinery.previewMonthlyStatement.useQuery(
    machineMonthlyPreviewInput,
    {
      enabled:
        canQuery &&
        isMachinery &&
        machineStatementDialogOpen &&
        hasBusinessWorkspaceProject &&
        machineMonthlyPreviewInput.machineId > 0 &&
        machineMonthlyPreviewInput.projectId > 0 &&
        /^\d{4}-(0[1-9]|1[0-2])$/.test(machineMonthlyPreviewInput.period),
      retry: false,
    }
  );
  const vehicleSummaries = trpc.transport.listVehicleSummaries.useQuery(
    vehicleSummariesInput,
    {
      enabled:
        canQuery &&
        isVehicle &&
        /^\d{4}-(0[1-9]|1[0-2])$/.test(vehicleAnalysisPeriod),
      retry: false,
    }
  );
  const vehicleAnalysis = trpc.transport.getVehicleAnalysis.useQuery(
    vehicleAnalysisInput,
    {
      enabled:
        canQuery &&
        isVehicle &&
        vehicleAnalysisTarget !== null &&
        vehicleAnalysisInput.vehicleId > 0 &&
        vehicleAnalysisInput.projectId > 0 &&
        /^\d{4}-(0[1-9]|1[0-2])$/.test(vehicleAnalysisPeriod),
      retry: false,
    }
  );
  const transportVehicleLedger = trpc.transport.listVehicles.useQuery(
    workspaceProjectInput,
    { enabled: canQuery && isTransport && hasBusinessWorkspaceProject }
  );
  const transportTrips = trpc.transport.listTrips.useQuery(
    transportWorkspaceInput,
    {
      enabled:
        canQuery &&
        isTransport &&
        hasBusinessWorkspaceProject &&
        ["ledger", "review"].includes(transportWorkspaceTab),
    }
  );
  const transportSites = trpc.transport.listSites.useQuery(
    workspaceProjectInput,
    {
      enabled:
        canQuery &&
        isTransport &&
        hasBusinessWorkspaceProject &&
        transportWorkspaceTab === "terminals",
    }
  );
  const transportRoutePresets = trpc.transport.listRoutePresets.useQuery(
    workspaceProjectInput,
    {
      enabled:
        canQuery &&
        isTransport &&
        hasBusinessWorkspaceProject &&
        ["ledger", "review", "terminals"].includes(transportWorkspaceTab),
    }
  );
  const transportFreightRules = trpc.transport.listFreightRules.useQuery(
    workspaceProjectInput,
    {
      enabled:
        canQuery &&
        isTransport &&
        hasBusinessWorkspaceProject &&
        ["rates", "terminals"].includes(transportWorkspaceTab),
    }
  );
  const rfidWriterDevices = trpc.transport.listRfidWriterDevices.useQuery(
    workspaceProjectInput,
    {
      enabled:
        canQuery &&
        isTransport &&
        hasBusinessWorkspaceProject &&
        transportWorkspaceTab === "terminals",
    }
  );
  const vehicleRfidCards = trpc.transport.listVehicleRfidCards.useQuery(
    workspaceProjectInput,
    {
      enabled:
        canQuery &&
        isTransport &&
        hasBusinessWorkspaceProject &&
        transportWorkspaceTab === "terminals",
    }
  );
  const transportWorkspaceAccess = trpc.transport.workspaceAccess.useQuery(
    workspaceProjectInput,
    { enabled: canQuery && isTransport && hasBusinessWorkspaceProject }
  );
  const subcontractCapabilities = trpc.subcontract.capabilities.useQuery(
    undefined,
    { enabled: canQuery && isSubcontract }
  );
  const measurementTakeoffCapabilities =
    trpc.measurement.takeoffCapabilities.useQuery(undefined, {
      enabled: canQuery && isSubcontract,
    });
  const subcontractTeams = trpc.subcontract.listTeams.useQuery(
    workspaceProjectInput,
    { enabled: canQuery && isSubcontract && hasBusinessWorkspaceProject }
  );
  const subcontractPackages = trpc.subcontract.listPackages.useQuery(
    subcontractPackagesInput,
    { enabled: canQuery && isSubcontract && hasBusinessWorkspaceProject }
  );
  const subcontractSummary = trpc.subcontract.summary.useQuery(
    workspaceProjectInput,
    { enabled: canQuery && isSubcontract && hasBusinessWorkspaceProject }
  );
  const subcontractTakeoffs = trpc.measurement.listTakeoffs.useQuery(
    workspaceProjectInput,
    { enabled: canQuery && isSubcontract && hasBusinessWorkspaceProject }
  );
  const purchasingCategories = trpc.purchasing.categories.useQuery(undefined, {
    enabled: canQuery && isPurchasing,
  });
  const purchasingRequests = trpc.purchasing.listRequests.useQuery(
    workspaceProjectInput,
    { enabled: false }
  );
  const purchasingOrders = trpc.purchasing.listOrders.useQuery(
    workspaceProjectInput,
    { enabled: false }
  );
  const purchasingInventory = trpc.purchasing.listInventory.useQuery(
    workspaceProjectInput,
    { enabled: false }
  );
  const purchasingSettlements = trpc.purchasing.listSettlements.useQuery(
    workspaceProjectInput,
    { enabled: false }
  );
  const financeSummary = trpc.finance.summary.useQuery(
    { projectId: Number(financeProjectId || 0), period: financePeriod },
    {
      enabled:
        canQuery &&
        isFinance &&
        !isDiesel &&
        (financeTab === "overview" ||
          financeTab === "ledger" ||
          financePrintPreview === "ledger") &&
        Number(financeProjectId) > 0 &&
        Boolean(financePeriod),
    }
  );
  const financeBusinessSummary = trpc.finance.businessSummary.useQuery(
    { projectId: Number(financeProjectId || 0), period: financePeriod },
    {
      enabled:
        canQuery &&
        isFinance &&
        !isDiesel &&
        financeTab === "overview" &&
        Number(financeProjectId) > 0 &&
        Boolean(financePeriod),
    }
  );
  const financeInvoices = trpc.finance.listInvoices.useQuery(
    { ...financeProjectInput, period: financePeriod },
    {
      enabled:
        canQuery &&
        isFinance &&
        !isDiesel &&
        (financeTab === "overview" ||
          financeTab === "invoices" ||
          financePrintPreview === "invoices") &&
        Number(financeProjectId) > 0,
    }
  );
  const dailyAccountingReport = trpc.finance.getDailyPrintableReport.useQuery(
    {
      projectId: Number(financeProjectId || 0),
      closingDate: financeClosingDate,
    },
    {
      enabled:
        canQuery &&
        isFinance &&
        !isDiesel &&
        financeTab === "closing" &&
        financeClosingView === "daily" &&
        Number(financeProjectId) > 0 &&
        Boolean(financeClosingDate),
    }
  );
  const dieselGuidelinePrices = trpc.admin.diesel.listGuidelinePrices.useQuery(
    { projectId: Number(financeProjectId || 0) },
    {
      enabled:
        canQuery &&
        isDiesel &&
        (dieselTab === "ledger" ||
          dieselTab === "prices" ||
          dieselRefuelDialogOpen) &&
        Number(financeProjectId) > 0,
    }
  );
  const dieselRefuelRecords = trpc.admin.diesel.listRefuelRecords.useQuery(
    dieselRefuelRecordsInput,
    {
      enabled:
        canQuery &&
        isDiesel &&
        (dieselTab === "ledger" || dieselTab === "receipts") &&
        Number(financeProjectId) > 0,
    }
  );
  const dieselLedgerPagination = useFinancePagination(
    dieselRefuelRecords.data ?? [],
    JSON.stringify(dieselRefuelRecordsInput)
  );
  const dieselCurrentSummary = useMemo(
    () =>
      summarizeDieselLedgerRecords(
        (dieselRefuelRecords.data ?? []) as DieselPrintRecord[]
      ),
    [dieselRefuelRecords.data]
  );
  const dieselCurrentFilterLabel = [
    `日期：${dieselLedgerFilter.dateFrom || dieselLedgerFilter.month || "全部"} 至 ${dieselLedgerFilter.dateTo || dieselLedgerFilter.month || "当前"}`,
    `车牌：${dieselLedgerFilter.plateNo || "全部"}`,
    `机械：${dieselMachineName.trim() || "全部"}`,
    `供油：${dieselLedgerFilter.supplyMethod === "all" ? "全部" : dieselLedgerFilter.supplyMethod === "project_supply" ? "项目部供油" : "加油站现金加油"}`,
    `资源：${dieselLedgerFilter.assetType === "all" ? "全部" : dieselLedgerFilter.assetType === "vehicle" ? "车辆" : "机械"}`,
    `供应商：${dieselLedgerFilter.supplierName.trim() || "全部"}`,
  ].join("；");
  const dieselPriceAlertRule = trpc.admin.diesel.getPriceAlertRule.useQuery(
    { projectId: Number(financeProjectId || 0) },
    {
      enabled:
        canQuery &&
        isDiesel &&
        dieselTab === "prices" &&
        Number(financeProjectId) > 0,
    }
  );
  const dieselSupplierReconciliation =
    trpc.admin.diesel.supplierReconciliation.useQuery(
      { projectId: Number(financeProjectId || 0), period: financePeriod },
      {
        enabled:
          canQuery &&
          isDiesel &&
          dieselTab === "suppliers" &&
          Number(financeProjectId) > 0 &&
          /^\d{4}-(0[1-9]|1[0-2])$/.test(financePeriod),
      }
    );
  const dieselVehicleOptions = trpc.admin.vehicle.list.useQuery(undefined, {
    enabled: canQuery && isDiesel && Number(financeProjectId) > 0,
  });
  const dieselMachineOptions = trpc.machinery.listMachines.useQuery(
    { projectId: Number(financeProjectId || 0) },
    { enabled: canQuery && isDiesel && Number(financeProjectId) > 0 }
  );
  const dieselTripOptions = trpc.transport.listTrips.useQuery(
    { projectId: Number(financeProjectId || 0), date: undefined },
    { enabled: canQuery && isDiesel && Number(financeProjectId) > 0 }
  );
  const riskRule = trpc.projectRisk.getRule.useQuery(riskProjectInput, {
    enabled: canQuery && isRisk && Number(financeProjectId) > 0,
  });
  const riskCapacityReadiness = trpc.projectRisk.capacityReadiness.useQuery(
    riskProjectInput,
    { enabled: canQuery && isRisk && Number(financeProjectId) > 0 }
  );
  const riskAssignees = trpc.projectRisk.listAssignees.useQuery(
    riskProjectInput,
    { enabled: canQuery && isRisk && Number(financeProjectId) > 0 }
  );
  const riskAlerts = trpc.projectRisk.listAlerts.useQuery(riskAlertsInput, {
    enabled:
      canQuery &&
      isRisk &&
      Number(financeProjectId) > 0 &&
      Boolean(financePeriod),
  });
  const riskFinanceAnalysis = trpc.projectRisk.financeCategoryAnalysis.useQuery(
    { projectId: Number(financeProjectId || 0), period: financePeriod },
    {
      enabled:
        canQuery &&
        (isRisk ||
          (isFinance &&
            !isDiesel &&
            (financeTab === "overview" ||
              financeTab === "costs" ||
              financePrintPreview === "categories" ||
              financePrintPreview === "subcategories"))) &&
        Number(financeProjectId) > 0 &&
        Boolean(financePeriod),
    }
  );
  const expenseCategoryDetails =
    trpc.projectRisk.financeCategoryDetails.useQuery(
      expenseCategoryDetailInput,
      {
        enabled:
          canQuery &&
          isFinance &&
          expenseCategoryDetailOpen &&
          Number(financeProjectId) > 0 &&
          Boolean(financePeriod),
        retry: false,
      }
    );

  useEffect(() => {
    if (dieselPriceAlertRule.data)
      setDieselAlertThreshold(
        String(dieselPriceAlertRule.data.thresholdPercent)
      );
  }, [dieselPriceAlertRule.data]);
  useEffect(() => {
    if (!riskRule.data) return;
    setRiskRuleForm({
      enabled: riskRule.data.enabled,
      maxFuelFillRatio: String(riskRule.data.maxFuelFillRatio),
      maxTransportSpeedKmh: String(riskRule.data.maxTransportSpeedKmh),
      maxTransportDurationMinutes: String(
        riskRule.data.maxTransportDurationMinutes
      ),
      maxOpenCheckInHours: String(riskRule.data.maxOpenCheckInHours),
      maxPendingReportHours: String(riskRule.data.maxPendingReportHours),
      overdueEscalationEnabled: riskRule.data.overdueEscalationEnabled,
      overdueEscalationHourChina: String(
        riskRule.data.overdueEscalationHourChina
      ),
    });
  }, [riskRule.data]);
  const closeDailyAccount = trpc.finance.closeDailyAccount.useMutation({
    onSuccess: async result => {
      toast.success(`日结已封存：${result.closingNo}`);
      await Promise.all([
        financeSummary.refetch(),
        financeInvoices.refetch(),
        dailyAccountingReport.refetch(),
        audits.refetch(),
      ]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const reopenDailyAccount = trpc.finance.reopenDailyAccount.useMutation({
    onSuccess: async result => {
      toast.success(
        `已授权反结账：${result.closingNo}（版本 ${result.revision}）`
      );
      setFinanceReopenReason("");
      await Promise.all([
        financeSummary.refetch(),
        financeInvoices.refetch(),
        dailyAccountingReport.refetch(),
        audits.refetch(),
      ]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const refreshDieselLedger = async () => {
    await trpcUtils.admin.diesel.invalidate();
  };
  const stopDieselCamera = () => {
    dieselCameraStream?.getTracks().forEach(track => track.stop());
    setDieselCameraStream(null);
    setDieselCameraOpen(false);
  };
  const resetDieselReceiptCapture = () => {
    stopDieselCamera();
    if (dieselReceiptPreview) URL.revokeObjectURL(dieselReceiptPreview);
    setDieselReceiptPreview(null);
    setDieselReceiptFile(null);
  };
  const startDieselCamera = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "当前浏览器不支持后置相机直拍，请使用支持相机授权的手机浏览器"
        );
      stopDieselCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      setDieselCameraStream(stream);
      setDieselCameraOpen(true);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "后置相机无法打开，请检查浏览器权限后重试"
        )
      );
    }
  };
  const captureDieselMeterPhoto = () => {
    const video = dieselCameraVideoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      toast.error("相机尚未就绪，请稍后重新拍摄");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      toast.error("当前浏览器不支持相机照片处理");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      blob => {
        if (!blob) {
          toast.error("加油表照片生成失败，请重新拍摄");
          return;
        }
        if (dieselReceiptPreview) URL.revokeObjectURL(dieselReceiptPreview);
        const file = new File([blob], `diesel-meter-${Date.now()}.jpg`, {
          type: "image/jpeg",
          lastModified: Date.now(),
        });
        setDieselReceiptFile(file);
        setDieselReceiptPreview(URL.createObjectURL(file));
        stopDieselCamera();
      },
      "image/jpeg",
      0.92
    );
  };
  useEffect(() => {
    const video = dieselCameraVideoRef.current;
    if (!dieselCameraOpen || !dieselCameraStream || !video) return;
    video.srcObject = dieselCameraStream;
    void video.play().catch(() => undefined);
    return () => {
      if (video.srcObject === dieselCameraStream) video.srcObject = null;
    };
  }, [dieselCameraOpen, dieselCameraStream]);
  const uploadDieselReceipt = trpc.evidence.upload.useMutation({
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const reverseGeocode = trpc.location.reverseGeocode.useMutation();
  const saveDieselPriceAlertRule =
    trpc.admin.diesel.savePriceAlertRule.useMutation({
      onSuccess: async () => {
        toast.success("柴油油价异常预警阈值已保存");
        await refreshDieselLedger();
      },
      onError: error => toast.error(getUserFacingErrorMessage(error)),
    });
  const saveDieselGuidelinePrice =
    trpc.admin.diesel.saveGuidelinePrice.useMutation({
      onSuccess: async () => {
        toast.success("柴油指导单价已保存；项目部供油将按生效日期自动取价");
        setDieselPriceDialogOpen(false);
        setDieselPriceForm(EMPTY_DIESEL_PRICE_FORM);
        await refreshDieselLedger();
      },
      onError: error => toast.error(getUserFacingErrorMessage(error)),
    });
  const saveDieselRefuelRecord = trpc.admin.diesel.saveRefuelRecord.useMutation(
    {
      onSuccess: async result => {
        toast.success(
          `柴油领用已保存：¥${displayMoney(result.amount)}，适用单价 ¥${displayMoney(result.appliedUnitPrice)}/L`
        );
        if (result.priceAlert?.isAlert)
          toast.warning(
            `油价异常：相对同供应商上一笔波动 ${result.priceAlert.deviationPercent}%`
          );
        setDieselRefuelDialogOpen(false);
        setDieselRefuelForm(EMPTY_DIESEL_REFUEL_FORM);
        resetDieselReceiptCapture();
        await refreshDieselLedger();
      },
      onError: error => toast.error(getUserFacingErrorMessage(error)),
    }
  );
  const submitDieselRefuel = async () => {
    try {
      let evidenceId: number | null = null;
      if (
        !dieselRefuelForm.id &&
        dieselDuplicateCandidates.length > 0 &&
        !window.confirm(
          "系统检测到同一资源同日已有相近柴油领用记录。请确认不是重复录入后再继续保存。"
        )
      ) {
        return;
      }
      if (
        !dieselReceiptFile &&
        !dieselRefuelForm.id &&
        dieselRefuelForm.status !== "void"
      ) {
        toast.error("请使用后置相机现场拍摄清晰的加油表照片后再保存");
        return;
      }
      if (dieselReceiptFile) {
        if (!["image/jpeg", "image/png"].includes(dieselReceiptFile.type)) {
          toast.error("加油表照片仅支持 JPG 或 PNG 图片");
          return;
        }
        const capturedLocation = await captureWatermarkLocation();
        const locationAddress = (
          await reverseGeocode.mutateAsync({
            latitude: capturedLocation.latitude,
            longitude: capturedLocation.longitude,
          })
        ).address;
        const capturedAt = new Date(dieselRefuelForm.refueledAt);
        if (Number.isNaN(capturedAt.getTime()))
          throw new Error("请填写有效加油时间后再生成工程水印");
        const projectName =
          projects.data?.find(
            project => String(project.id) === dieselRefuelForm.projectId
          )?.name ?? `项目 #${dieselRefuelForm.projectId}`;
        const antiCounterfeitNo = `DIESEL-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
        const watermarkValues: Record<string, string> = {
          capturedAt: `加油时间：${formatChinaDateTime(capturedAt)}`,
          principal: `操作人：${user?.name || "超级管理员"}`,
          location: `详细地点：${locationAddress}`,
          coordinates: `详细地点：${locationAddress}`,
          organization: `施工单位：${watermarkTemplateForm.organizationLabel}`,
          project: `项目名称：${projectName}`,
          antiCounterfeit: `防伪编号：${antiCounterfeitNo}`,
        };
        const requiredWatermarkFields = [
          "capturedAt",
          "principal",
          "location",
          "coordinates",
          "project",
          "antiCounterfeit",
        ];
        const watermarkLines = Array.from(
          new Set([...watermarkTemplateForm.fields, ...requiredWatermarkFields])
        )
          .map(field => watermarkValues[field])
          .filter(Boolean);
        const watermarkedFile = await createWatermarkedImage(
          dieselReceiptFile,
          watermarkLines,
          watermarkTemplateForm
        );
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
        vehicleId:
          dieselRefuelForm.assetType === "vehicle" && dieselRefuelForm.vehicleId
            ? Number(dieselRefuelForm.vehicleId)
            : null,
        machineId:
          dieselRefuelForm.assetType === "machine" && dieselRefuelForm.machineId
            ? Number(dieselRefuelForm.machineId)
            : null,
        transportTripId: null,
        supplyMethod: dieselRefuelForm.supplyMethod,
        stationOrSupplierName:
          dieselRefuelForm.stationOrSupplierName.trim() || null,
        liters: Number(dieselRefuelForm.liters),
        actualUnitPrice:
          dieselRefuelForm.supplyMethod === "external_station" &&
          dieselRefuelForm.actualUnitPrice
            ? Number(dieselRefuelForm.actualUnitPrice)
            : null,
        deductFromFreight:
          dieselRefuelForm.assetType === "vehicle" &&
          dieselRefuelForm.deductFromFreight,
        refueledAt: new Date(dieselRefuelForm.refueledAt).toISOString(),
        meterReading: dieselRefuelForm.meterReading
          ? Number(dieselRefuelForm.meterReading)
          : null,
        receiptNo: dieselRefuelForm.receiptNo.trim() || null,
        evidenceId,
        remarks: dieselRefuelForm.remarks.trim() || null,
        status: dieselRefuelForm.status,
      });
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error));
    }
  };
  const refreshBroadcasts = async () => {
    await Promise.all([
      broadcasts.refetch(),
      selectedBroadcastId ? broadcastDeliveries.refetch() : Promise.resolve(),
    ]);
  };
  const saveBroadcastDraft = trpc.broadcast.saveDraft.useMutation({
    onSuccess: async result => {
      toast.success("群发内容已保存，正在按授权范围直接发送");
      setSelectedBroadcastId(result.broadcastId);
      setBroadcastForm(EMPTY_BROADCAST_FORM);
      publishBroadcast.mutate({ id: result.broadcastId });
      await refreshBroadcasts();
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const reviewBroadcast = trpc.broadcast.review.useMutation({
    onSuccess: async result => {
      toast.success(
        `范围通知状态已更新为：${getBusinessStatusLabel(result.status)}`
      );
      await refreshBroadcasts();
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const publishBroadcast = trpc.broadcast.publish.useMutation({
    onSuccess: async result => {
      toast.success(
        `群发处理完成：成功 ${result.deliveredCount}，失败 ${result.failedCount}`
      );
      await refreshBroadcasts();
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const revokeWechatBinding = trpc.admin.wechatLogin.revoke.useMutation({
    onSuccess: async () => {
      toast.success("微信授权绑定已解除；该人员须重新在微信内完成授权绑定");
      setWechatBindingActionTarget(null);
      await wechatLogins.refetch();
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });

  const [selectedRoleId, setSelectedRoleId] = useState<number>();
  const [selectedSettingId, setSelectedSettingId] = useState<number>();
  const settingHistory = trpc.admin.settings.history.useQuery(
    { settingId: selectedSettingId ?? 0 },
    { enabled: canQuery && isSettings && selectedSettingId !== undefined }
  );
  const rolePermissionIds = trpc.admin.role.permissionIds.useQuery(
    { roleId: selectedRoleId ?? 0 },
    { enabled: canQuery && isPermission && selectedRoleId !== undefined }
  );
  const [draftPermissionIds, setDraftPermissionIds] = useState<number[]>([]);

  const [organizationForm, setOrganizationForm] = useState<OrganizationForm>(
    EMPTY_ORGANIZATION_FORM
  );
  const [projectForm, setProjectForm] =
    useState<ProjectForm>(EMPTY_PROJECT_FORM);
  const [positionForm, setPositionForm] =
    useState<PositionForm>(EMPTY_POSITION_FORM);
  const [vehicleForm, setVehicleForm] =
    useState<VehicleForm>(EMPTY_VEHICLE_FORM);
  const [vehicleEditorOpen, setVehicleEditorOpen] = useState(false);
  const [transportRouteSetupOpen, setTransportRouteSetupOpen] = useState(false);
  const [transportRouteSetup, setTransportRouteSetup] = useState({
    loadName: "",
    unloadName: "",
    distanceKm: "",
    freightRuleId: "",
    isDefault: true,
  });
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<number[]>([]);
  const [machineForm, setMachineForm] =
    useState<MachineForm>(EMPTY_MACHINE_FORM);
  const [machineDialogOpen, setMachineDialogOpen] = useState(false);
  const [machineOwnerAccountDialogOpen, setMachineOwnerAccountDialogOpen] =
    useState(false);
  const [machineryPaymentFormOpen, setMachineryPaymentFormOpen] =
    useState(false);
  const confirmMachineryFormClose = () =>
    window.confirm("当前机械表单有未保存内容，确认放弃并关闭？");
  const [machineCostForm, setMachineCostForm] = useState<MachineCostForm>(
    EMPTY_MACHINE_COST_FORM
  );
  const [machineCostDialogOpen, setMachineCostDialogOpen] = useState(false);
  const [machineDailyOperationForm, setMachineDailyOperationForm] =
    useState<MachineDailyOperationForm>(EMPTY_MACHINE_DAILY_OPERATION_FORM);
  const [machineDailyOperationDialogOpen, setMachineDailyOperationDialogOpen] =
    useState(false);
  const [employeeProfileForm, setEmployeeProfileForm] =
    useState<EmployeeProfileForm>(EMPTY_EMPLOYEE_PROFILE_FORM);
  const [laborWorkspaceTab, setLaborWorkspaceTab] = useState(() =>
    new URLSearchParams(window.location.search).get("tab") === "operations"
      ? "operations"
      : "personnel"
  );
  const [personnelCreateSignal, setPersonnelCreateSignal] = useState(0);
  const [personnelOpenSource, setPersonnelOpenSource] = useState<
    | {
        sourceType: "worker" | "profile" | "user";
        sourceId: number;
        requestKey: number;
      }
    | undefined
  >();
  const [employeeProfileDialogOpen, setEmployeeProfileDialogOpen] =
    useState(false);
  const [laborWorkerCreateForm, setLaborWorkerCreateForm] =
    useState<LaborWorkerCreateForm>(EMPTY_LABOR_WORKER_CREATE_FORM);
  const [laborWorkerCreateDialogOpen, setLaborWorkerCreateDialogOpen] =
    useState(false);
  const [employeeInsuranceForm, setEmployeeInsuranceForm] =
    useState<EmployeeInsuranceForm>(EMPTY_EMPLOYEE_INSURANCE_FORM);
  const [employeeInsuranceDialogOpen, setEmployeeInsuranceDialogOpen] =
    useState(false);
  const [employeeInsurancePolicyFile, setEmployeeInsurancePolicyFile] =
    useState<File | null>(null);
  const [assetMaintenanceForm, setAssetMaintenanceForm] =
    useState<AssetMaintenanceForm>(EMPTY_ASSET_MAINTENANCE_FORM);
  const [assetMaintenanceDialogOpen, setAssetMaintenanceDialogOpen] =
    useState(false);
  const [dieselPriceForm, setDieselPriceForm] = useState<DieselPriceForm>(
    EMPTY_DIESEL_PRICE_FORM
  );
  const [dieselRefuelForm, setDieselRefuelForm] = useState<DieselRefuelForm>(
    EMPTY_DIESEL_REFUEL_FORM
  );
  const [dieselReceiptFile, setDieselReceiptFile] = useState<File | null>(null);
  const [dieselAlertThreshold, setDieselAlertThreshold] = useState("10");
  const [rfidWriterDeviceForm, setRfidWriterDeviceForm] =
    useState<RfidWriterDeviceForm>(EMPTY_RFID_WRITER_DEVICE_FORM);
  const [rfidCardForm, setRfidCardForm] =
    useState<RfidCardForm>(EMPTY_RFID_CARD_FORM);
  const [, setRfidPendingUid] = useState("");
  const [readingRfidBindingUid, setReadingRfidBindingUid] = useState(false);
  const selectedRfidVehicle = useMemo(
    () =>
      (transportVehicleLedger.data ?? []).find(
        vehicle => String(vehicle.id) === rfidCardForm.vehicleId
      ) ?? null,
    [rfidCardForm.vehicleId, transportVehicleLedger.data]
  );
  const [rfidWriterDialogOpen, setRfidWriterDialogOpen] = useState(false);
  const [rfidCardDialogOpen, setRfidCardDialogOpen] = useState(false);
  const [rfidWritePreview, setRfidWritePreview] = useState<{
    jobId: number;
    jobNo: string;
    payload: Record<string, unknown> | null;
    hardwareMode: "manual_confirmation" | "pc_bridge";
    bridgeToken: string | null;
  } | null>(null);
  const [roleForm, setRoleForm] = useState<RoleForm>(EMPTY_ROLE_FORM);
  const [assignmentForm, setAssignmentForm] = useState<AssignmentForm>(
    EMPTY_ASSIGNMENT_FORM
  );
  const [personnelSearch, setPersonnelSearch] = useState("");
  const [employeeLedgerFilter, setEmployeeLedgerFilter] = useState({
    search: "",
    type: "all",
    status: "all",
    insurance: "all",
  });
  const [machineLedgerFilter, setMachineLedgerFilter] = useState({
    search: "",
    ownership: "all",
    status: "all",
  });
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const [localAccountForm, setLocalAccountForm] = useState({
    username: "",
    displayName: "",
    initialPassword: "",
    status: "active" as LocalAccountStatus,
    loginMode: "both" as LocalLoginMode,
  });
  const [localAccountEditForm, setLocalAccountEditForm] =
    useState<LocalAccountEditForm | null>(null);
  const [passwordResetTarget, setPasswordResetTarget] =
    useState<LocalAccountActionTarget | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [deleteTarget, setDeleteTarget] =
    useState<LocalAccountActionTarget | null>(null);
  const [fullBackupDownloadTarget, setFullBackupDownloadTarget] = useState<{
    backupId: string;
    tableCount: number;
    compressedBytes: number;
  } | null>(null);
  const [userPermissionTarget, setUserPermissionTarget] =
    useState<LocalAccountActionTarget | null>(null);
  const [draftUserPermissionIds, setDraftUserPermissionIds] = useState<
    number[]
  >([]);
  const userPermissionIds = trpc.admin.personnel.userPermissionIds.useQuery(
    { userId: userPermissionTarget?.id ?? 0 },
    {
      enabled: canQuery && isPermission && Boolean(userPermissionTarget),
      retry: false,
    }
  );
  const [wechatBindingActionTarget, setWechatBindingActionTarget] =
    useState<WechatBindingActionTarget | null>(null);
  const [departmentScopeForm, setDepartmentScopeForm] = useState<{
    scopeTarget: string;
    module: DepartmentModuleCode | "";
  }>({ scopeTarget: "", module: "" });
  const [settingForm, setSettingForm] =
    useState<SettingForm>(EMPTY_SETTING_FORM);
  const [
    officialAccountConfigurationForm,
    setOfficialAccountConfigurationForm,
  ] = useState<OfficialAccountConfigurationForm>(
    EMPTY_OFFICIAL_ACCOUNT_CONFIGURATION_FORM
  );
  const [
    officialAccountConfigurationValidation,
    setOfficialAccountConfigurationValidation,
  ] = useState<{
    success: boolean;
    message: string;
    statusCode?: number;
  } | null>(null);
  const [officialAccountMessagePushForm, setOfficialAccountMessagePushForm] =
    useState<OfficialAccountMessagePushForm>(
      EMPTY_OFFICIAL_ACCOUNT_MESSAGE_PUSH_FORM
    );
  const [
    officialAccountMessagePushValidation,
    setOfficialAccountMessagePushValidation,
  ] = useState<{
    success: boolean;
    message: string;
    statusCode?: number;
    callbackUrl?: string | null;
  } | null>(null);
  const [externalAiApiConfigurationForm, setExternalAiApiConfigurationForm] =
    useState<ExternalAiApiConfigurationForm>(
      EMPTY_EXTERNAL_AI_API_CONFIGURATION_FORM
    );
  const [externalAiApiValidation, setExternalAiApiValidation] = useState<
    string | null
  >(null);
  const [aliyunOssPhotoStorageForm, setAliyunOssPhotoStorageForm] =
    useState<AliyunOssPhotoStorageConfigurationForm>(
      EMPTY_ALIYUN_OSS_PHOTO_STORAGE_CONFIGURATION_FORM
    );
  const [aliyunOssPhotoStorageValidation, setAliyunOssPhotoStorageValidation] =
    useState<AliyunOssPhotoStorageValidation | null>(null);
  const [dailyDigestForm, setDailyDigestForm] = useState<DailyDigestForm>(
    EMPTY_DAILY_DIGEST_FORM
  );
  const [dailyDigestPreviewProjectId, setDailyDigestPreviewProjectId] =
    useState("");
  const [dailyDigestPreviewDate, setDailyDigestPreviewDate] = useState(() =>
    toLocalDateInput()
  );
  const [settingDeleteTarget, setSettingDeleteTarget] =
    useState<SettingDeleteTarget | null>(null);
  const [masterDataDeleteTarget, setMasterDataDeleteTarget] =
    useState<MasterDataDeleteTarget | null>(null);
  const [attendanceDeviceLimitDraft, setAttendanceDeviceLimitDraft] =
    useState("3");
  const [settingsCategory, setSettingsCategory] =
    useState<SettingsCategory>("business");
  const [permissionWorkspaceTab, setPermissionWorkspaceTab] =
    useState<PermissionWorkspaceTab>("authorization");
  const [rolePermissionModule, setRolePermissionModule] = useState("all");

  // 首次加载后默认选中第一个角色；角色切换后以服务端真实权限回显编辑矩阵。
  useEffect(() => {
    if (!selectedRoleId && roles.data?.[0]) setSelectedRoleId(roles.data[0].id);
  }, [roles.data, selectedRoleId]);
  useEffect(() => {
    setDraftPermissionIds(rolePermissionIds.data ?? []);
  }, [rolePermissionIds.data]);
  useEffect(() => {
    if (
      employeeProfileDialogOpen ||
      employeeInsuranceDialogOpen ||
      localAccountEditForm ||
      passwordResetTarget ||
      userPermissionTarget
    ) {
      setPermissionWorkspaceTab("accounts");
    }
  }, [
    employeeInsuranceDialogOpen,
    employeeProfileDialogOpen,
    localAccountEditForm,
    passwordResetTarget,
    userPermissionTarget,
  ]);
  useEffect(() => {
    if (userPermissionTarget)
      setDraftUserPermissionIds(userPermissionIds.data ?? []);
  }, [userPermissionIds.data, userPermissionTarget]);
  // 默认选中第一条配置，方便管理员直接查看其发布历史和回滚入口。
  /** 主清单隐藏停用项和当前无可下发模板的手工字段；历史、审计和服务端兼容读取不受影响。 */
  const allSettings = settings.data ?? [];
  const supervisorReviewAutoApproveSetting = allSettings.find(
    item =>
      item.settingKey === "SUPERVISOR_REVIEW_AUTO_APPROVE" &&
      item.status === "published"
  );
  const supervisorReviewAutoApproveEnabled =
    supervisorReviewAutoApproveSetting?.valueJson === "true";
  const templateSettingKeys = new Set([
    "WECHAT_OFFICIAL_TEMPLATE_ID",
    "WECHAT_OFFICIAL_TEMPLATE_FIELDS",
  ]);
  const managedOssSettingKeys = new Set([
    "ALIYUN_OSS_PHOTO_STORAGE_ENABLED",
    "ALIYUN_OSS_PHOTO_STORAGE_REGION",
    "ALIYUN_OSS_PHOTO_STORAGE_ENDPOINT",
    "ALIYUN_OSS_PHOTO_STORAGE_BUCKET",
    "ALIYUN_OSS_PHOTO_STORAGE_PREFIX",
    "ALIYUN_OSS_PHOTO_STORAGE_ACCESS_KEY_ID",
    "ALIYUN_OSS_PHOTO_STORAGE_ACCESS_KEY_SECRET",
  ]);
  const visibleSettings = allSettings.filter(
    item =>
      item.status !== "disabled" &&
      !templateSettingKeys.has(item.settingKey) &&
      !OFFICIAL_ACCOUNT_BASE_SETTING_KEYS.has(item.settingKey) &&
      !managedOssSettingKeys.has(item.settingKey)
  );
  const attendanceDeviceLimitSetting = visibleSettings.find(
    item => item.settingKey === "ATTENDANCE_DEVICE_BINDING_LIMIT"
  );
  const publishedOfficialSettingKeys = new Set(
    allSettings
      .filter(item => item.status === "published")
      .map(item => item.settingKey)
  );
  const officialCredentialsReady =
    publishedOfficialSettingKeys.has("WECHAT_OFFICIAL_APP_ID") &&
    publishedOfficialSettingKeys.has("WECHAT_OFFICIAL_APP_SECRET");
  const officialBindingReady =
    officialCredentialsReady &&
    publishedOfficialSettingKeys.has("WECHAT_OFFICIAL_APP_URL");
  const officialTemplateReady =
    officialCredentialsReady &&
    publishedOfficialSettingKeys.has("WECHAT_OFFICIAL_TEMPLATE_ID");
  useEffect(() => {
    if (!visibleSettings.length) {
      if (selectedSettingId !== undefined) setSelectedSettingId(undefined);
      return;
    }
    if (!visibleSettings.some(item => item.id === selectedSettingId))
      setSelectedSettingId(visibleSettings[0].id);
  }, [selectedSettingId, visibleSettings]);
  useEffect(() => {
    if (attendanceDeviceLimitSetting?.valueJson)
      setAttendanceDeviceLimitDraft(attendanceDeviceLimitSetting.valueJson);
  }, [attendanceDeviceLimitSetting?.valueJson]);
  useEffect(() => {
    if (!dailyDigestSettings.data) return;
    setDailyDigestForm({
      enabled: dailyDigestSettings.data.enabled,
      deliveryHour: String(dailyDigestSettings.data.deliveryHour).padStart(
        2,
        "0"
      ),
      deliveryMinute: String(dailyDigestSettings.data.deliveryMinute).padStart(
        2,
        "0"
      ),
      includeEmptyProjects: dailyDigestSettings.data.includeEmptyProjects,
    });
  }, [dailyDigestSettings.data]);
  /** 已发布公开字段可安全回显；两项密钥始终保持空值，只以状态提示“留空保留密文”。 */
  useEffect(() => {
    if (!isSettings || !allSettings.length) return;
    const publishedValue = (settingKey: string) =>
      allSettings.find(
        item => item.settingKey === settingKey && item.status === "published"
      )?.valueJson ?? "";
    setOfficialAccountConfigurationForm(current => ({
      ...current,
      appId: current.appId || publishedValue("WECHAT_OFFICIAL_APP_ID"),
      appUrl:
        current.appUrl === EMPTY_OFFICIAL_ACCOUNT_CONFIGURATION_FORM.appUrl
          ? publishedValue("WECHAT_OFFICIAL_APP_URL") || current.appUrl
          : current.appUrl,
      egressUrl:
        current.egressUrl ===
        EMPTY_OFFICIAL_ACCOUNT_CONFIGURATION_FORM.egressUrl
          ? publishedValue("WECHAT_OFFICIAL_EGRESS_URL") || current.egressUrl
          : current.egressUrl,
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
    if (!isSettings || !aliyunOssPhotoStorageConfiguration.data) return;
    setAliyunOssPhotoStorageForm(current => ({
      ...current,
      enabled: aliyunOssPhotoStorageConfiguration.data.enabled,
      region: current.region || aliyunOssPhotoStorageConfiguration.data.region,
      endpoint:
        current.endpoint || aliyunOssPhotoStorageConfiguration.data.endpoint,
      bucket: current.bucket || aliyunOssPhotoStorageConfiguration.data.bucket,
      objectPrefix:
        current.objectPrefix ===
        EMPTY_ALIYUN_OSS_PHOTO_STORAGE_CONFIGURATION_FORM.objectPrefix
          ? aliyunOssPhotoStorageConfiguration.data.objectPrefix
          : current.objectPrefix,
    }));
  }, [aliyunOssPhotoStorageConfiguration.data, isSettings]);
  useEffect(() => {
    if (
      !isBusinessWorkspace ||
      businessWorkspaceProjectId ||
      !projects.data?.length
    )
      return;
    const firstAvailableProject = projects.data.find(
      project => project.status !== "archived"
    );
    if (firstAvailableProject)
      setBusinessWorkspaceProjectId(String(firstAvailableProject.id));
  }, [businessWorkspaceProjectId, isBusinessWorkspace, projects.data]);
  useEffect(() => {
    if (!(isFinance || isRisk) || financeProjectId || !projects.data?.length)
      return;
    const firstAvailableProject = projects.data.find(
      project => project.status !== "archived"
    );
    if (firstAvailableProject)
      setFinanceProjectId(String(firstAvailableProject.id));
  }, [financeProjectId, isFinance, isRisk, projects.data]);
  useEffect(() => {
    setSelectedMachineId("");
  }, [businessWorkspaceProjectId]);
  useEffect(() => {
    if (!isMachinery || !machineryLedger.data?.length) return;
    if (
      !machineryLedger.data.some(
        machine => String(machine.id) === selectedMachineId
      )
    ) {
      setSelectedMachineId(String(machineryLedger.data[0].id));
    }
  }, [isMachinery, machineryLedger.data, selectedMachineId]);
  const selectedSetting = visibleSettings.find(
    item => item.id === selectedSettingId
  );
  const selectedBusinessProject = projects.data?.find(
    project => String(project.id) === businessFilter.projectId
  );
  const selectedWorkspaceProject = projects.data?.find(
    project => String(project.id) === businessWorkspaceProjectId
  );
  const selectedMachineForDialog = (machineryLedger.data ?? []).find(
    machine => String(machine.id) === selectedMachineId
  );
  const filteredEmployeeProfiles = useMemo(
    () =>
      (employeeProfiles.data ?? []).filter(profile => {
        const keyword = employeeLedgerFilter.search.trim().toLowerCase();
        const matchesSearch =
          !keyword ||
          [
            profile.displayName,
            profile.localUsername,
            profile.teamName,
            profile.laborTeamName,
          ].some(value => value?.toLowerCase().includes(keyword));
        return (
          matchesSearch &&
          (employeeLedgerFilter.type === "all" ||
            profile.employeeType === employeeLedgerFilter.type) &&
          (employeeLedgerFilter.status === "all" ||
            profile.employmentStatus === employeeLedgerFilter.status) &&
          (employeeLedgerFilter.insurance === "all" ||
            profile.insuranceStatus === employeeLedgerFilter.insurance)
        );
      }),
    [employeeLedgerFilter, employeeProfiles.data]
  );
  const activeCsvExportScope = useMemo<CsvExportScope>(() => {
    const workspaceProjectLabel =
      selectedWorkspaceProject?.name ?? "当前已授权项目范围";
    const financeProjectLabel =
      projects.data?.find(project => String(project.id) === financeProjectId)
        ?.name ?? workspaceProjectLabel;
    if (activeSection === "vehicles") {
      return {
        module: "车辆资源台账",
        filters: [
          [
            "项目",
            vehicleLedgerFilter.projectId === "all"
              ? "全部已授权项目"
              : (projects.data?.find(
                  project =>
                    String(project.id) === vehicleLedgerFilter.projectId
                )?.name ?? vehicleLedgerFilter.projectId),
          ],
          ["检索", vehicleLedgerFilter.search || "未设置"],
          [
            "资源性质",
            vehicleLedgerFilter.ownership === "all"
              ? "全部"
              : vehicleLedgerFilter.ownership === "owned"
                ? "公司自有"
                : "外租车辆",
          ],
          [
            "调度状态",
            vehicleLedgerFilter.status === "all"
              ? "全部"
              : vehicleLedgerFilter.status === "active"
                ? "可调度"
                : vehicleLedgerFilter.status === "suspended"
                  ? "暂停"
                  : "停用",
          ],
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
          [
            "资源性质",
            machineLedgerFilter.ownership === "all"
              ? "全部"
              : machineLedgerFilter.ownership === "owned"
                ? "公司自有"
                : "外租机械",
          ],
          [
            "机械状态",
            machineLedgerFilter.status === "all"
              ? "全部"
              : machineLedgerFilter.status,
          ],
          ["分析期间", machineStatementPeriod],
        ],
      };
    }
    if (activeSection === "labor") {
      return {
        module: "劳务考勤与工资台账",
        filters: [
          ["项目范围", workspaceProjectLabel],
          [
            "劳务工作区筛选",
            "以当前劳务菜单内的期间、人员、班组与状态筛选为准",
          ],
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
          [
            "供油方式",
            dieselLedgerFilter.supplyMethod === "all"
              ? "全部"
              : dieselLedgerFilter.supplyMethod === "project_supply"
                ? "项目部供油"
                : "加油站现金加油",
          ],
          [
            "车辆/机械",
            dieselLedgerFilter.assetType === "all"
              ? "全部"
              : dieselLedgerFilter.assetType === "vehicle"
                ? "车辆"
                : "机械",
          ],
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
          [
            "人员类型",
            employeeLedgerFilter.type === "all"
              ? "全部"
              : employeeLedgerFilter.type,
          ],
          [
            "在职状态",
            employeeLedgerFilter.status === "all"
              ? "全部"
              : employeeLedgerFilter.status,
          ],
          [
            "保险状态",
            employeeLedgerFilter.insurance === "all"
              ? "全部"
              : employeeLedgerFilter.insurance,
          ],
          ["数据范围", "当前管理员已授权人员范围"],
        ],
      };
    }
    return {
      module: "后台台账",
      filters: [
        ["项目范围", workspaceProjectLabel],
        ["数据范围", "当前管理员已授权数据"],
      ],
    };
  }, [
    activeSection,
    dieselDate,
    dieselLedgerFilter,
    employeeLedgerFilter,
    financePeriod,
    financeProjectId,
    machineLedgerFilter,
    machineStatementPeriod,
    projects.data,
    selectedWorkspaceProject?.name,
    vehicleAnalysisPeriod,
    vehicleLedgerFilter,
  ]);
  useEffect(() => {
    const exportWindow = window as ExportScopeWindow;
    exportWindow.__roadConstructionExportScope = activeCsvExportScope;
    return () => {
      if (exportWindow.__roadConstructionExportScope === activeCsvExportScope)
        delete exportWindow.__roadConstructionExportScope;
    };
  }, [activeCsvExportScope]);
  const businessFilterLabel = `${selectedBusinessProject?.name ?? "全部项目"}${businessFilter.period ? ` · ${businessFilter.period}` : " · 全部期间"}`;
  const dailyDigestPreviewInput = useMemo(
    () => ({
      projectId: Number(dailyDigestPreviewProjectId || 0),
      businessDate: dailyDigestPreviewDate,
    }),
    [dailyDigestPreviewDate, dailyDigestPreviewProjectId]
  );
  const dailyDigestPreview = trpc.dailyDigest.preview.useQuery(
    dailyDigestPreviewInput,
    {
      enabled:
        canQuery &&
        isSettings &&
        Number(dailyDigestPreviewProjectId) > 0 &&
        Boolean(dailyDigestPreviewDate),
    }
  );

  /** 配置版本冲突后强制刷新列表与历史，避免管理员继续在旧版本上操作。 */
  const refreshAfterSettingConflict = async () => {
    toast.error("配置已被其他管理员更新，已刷新为最新版本，请确认后重试");
    await Promise.all([
      settings.refetch(),
      settingHistory.refetch(),
      audits.refetch(),
    ]);
  };

  const saveOrganization = trpc.admin.organization.save.useMutation({
    onSuccess: async () => {
      toast.success("组织节点已保存");
      setOrganizationForm(EMPTY_ORGANIZATION_FORM);
      await Promise.all([
        organizations.refetch(),
        overview.refetch(),
        audits.refetch(),
      ]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const saveProject = trpc.admin.project.save.useMutation({
    onSuccess: async () => {
      toast.success("项目节点已保存");
      setProjectForm(EMPTY_PROJECT_FORM);
      await Promise.all([
        projects.refetch(),
        overview.refetch(),
        audits.refetch(),
      ]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const savePosition = trpc.admin.position.save.useMutation({
    onSuccess: async () => {
      toast.success("岗位字典已保存");
      setPositionForm(EMPTY_POSITION_FORM);
      await Promise.all([positions.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const saveVehicle = trpc.admin.vehicle.save.useMutation({
    onSuccess: async data => {
      toast.success(
        `车辆台账已保存，理论方量 ${data.theoreticalVolumeCubicMeters} m³`
      );
      setVehicleForm(EMPTY_VEHICLE_FORM);
      setVehicleEditorOpen(false);
      await Promise.all([
        vehicles.refetch(),
        overview.refetch(),
        audits.refetch(),
      ]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const revokeDriverWechatBinding =
    trpc.admin.vehicle.revokeDriverWechatBinding.useMutation({
      onSuccess: async () => {
        toast.success(
          "司机微信绑定已解除；司机可在服务号重新发送“绑定”获取新链接"
        );
        await Promise.all([vehicles.refetch(), audits.refetch()]);
      },
      onError: error => toast.error(getUserFacingErrorMessage(error)),
    });
  const saveTransportSite = trpc.transport.saveSite.useMutation({
    onSuccess: async () => {
      toast.success("装卸土点已保存");
      await Promise.all([
        transportSites.refetch(),
        transportRoutePresets.refetch(),
        audits.refetch(),
      ]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const saveTransportRoutePreset = trpc.transport.saveRoutePreset.useMutation({
    onSuccess: async () => {
      toast.success("运输路线已保存");
      await Promise.all([transportRoutePresets.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const saveMachine = trpc.machinery.saveMachine.useMutation({
    onSuccess: async () => {
      toast.success(
        machineForm.id ? "机械档案已在 PC 后台更新" : "机械档案已在 PC 后台建立"
      );
      setMachineForm(EMPTY_MACHINE_FORM);
      setMachineDialogOpen(false);
      await Promise.all([
        machineryLedger.refetch(),
        machineCostSummaries.refetch(),
        audits.refetch(),
      ]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const refreshSubcontractWorkspace = async () => {
    await Promise.all([
      subcontractTeams.refetch(),
      subcontractPackages.refetch(),
      subcontractSummary.refetch(),
      subcontractTakeoffs.refetch(),
      audits.refetch(),
    ]);
  };
  const saveSubcontractTeam = trpc.subcontract.saveTeam.useMutation({
    onSuccess: async () => {
      toast.success(
        subcontractTeamForm.id ? "施工队台账已更新" : "施工队台账已建立"
      );
      setSubcontractTeamDialogOpen(false);
      setSubcontractTeamForm(EMPTY_SUBCONTRACT_TEAM_FORM);
      await refreshSubcontractWorkspace();
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const saveSubcontractPackage = trpc.subcontract.savePackage.useMutation({
    onSuccess: async result => {
      toast.success(
        `分包批次已保存：上游 ¥${displayMoney(result.upstreamAmount)}，分包 ¥${displayMoney(result.subcontractAmount)}，测算差额 ¥${displayMoney(result.marginAmount)}`
      );
      setSubcontractPackageDialogOpen(false);
      setSubcontractPackageForm(EMPTY_SUBCONTRACT_PACKAGE_FORM);
      await refreshSubcontractWorkspace();
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const saveMeasurementTakeoff = trpc.measurement.saveTakeoff.useMutation({
    onSuccess: async result => {
      toast.success(
        `项目部收方草稿已保存，申报金额 ¥${displayMoney(result.declaredAmount)}`
      );
      setMeasurementTakeoffDialogOpen(false);
      setMeasurementTakeoffForm(EMPTY_MEASUREMENT_TAKEOFF_FORM);
      await refreshSubcontractWorkspace();
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const transitionSubcontractPackage =
    trpc.subcontract.transitionPackage.useMutation({
      onSuccess: async () => {
        toast.success("分包批次状态已更新");
        await refreshSubcontractWorkspace();
      },
      onError: error => toast.error(getUserFacingErrorMessage(error)),
    });
  const refreshPurchasingWorkspace = async () => {
    await Promise.all([
      purchasingRequests.refetch(),
      purchasingOrders.refetch(),
      purchasingInventory.refetch(),
      purchasingSettlements.refetch(),
      audits.refetch(),
    ]);
  };
  const importPurchaseSpreadsheet =
    trpc.purchasing.importSpreadsheet.useMutation({
      onSuccess: async result => {
        toast.success(
          `Excel 导入完成：采购订单 ${result.createdOrders} 条、库存流水 ${result.createdInventoryTransactions} 条${result.createdSuppliers ? `、供应商 ${result.createdSuppliers} 家` : ""}`
        );
        setPurchaseSpreadsheetImportOpen(false);
        setPurchaseSpreadsheetImportPreview(null);
        await refreshPurchasingWorkspace();
      },
      onError: error => toast.error(getUserFacingErrorMessage(error)),
    });
  const saveInventoryTransaction =
    trpc.purchasing.saveInventoryTransaction.useMutation({
      onSuccess: async result => {
        toast.success(`库存流水已登记，金额 ¥${displayMoney(result.amount)}`);
        setInventoryTransactionDialogOpen(false);
        setInventoryTransactionForm(EMPTY_INVENTORY_TRANSACTION_FORM);
        await refreshPurchasingWorkspace();
      },
      onError: error => toast.error(getUserFacingErrorMessage(error)),
    });
  const saveRiskRule = trpc.projectRisk.saveRule.useMutation({
    onSuccess: async () => {
      toast.success("AI 项目风控阈值与逾期升级计划已保存");
      await Promise.all([riskRule.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const scanProjectRisks = trpc.projectRisk.scan.useMutation({
    onSuccess: async result => {
      const scanned = result.scanned ?? {
        pendingConstructionReports: 0,
        openAttendanceCheckIns: 0,
        dieselRefuelRecords: 0,
        transportTrips: 0,
      };
      toast.success(
        result.enabled
          ? `真实数据扫描完成：日报 ${scanned.pendingConstructionReports}、考勤 ${scanned.openAttendanceCheckIns}、柴油 ${scanned.dieselRefuelRecords}、运输 ${scanned.transportTrips}；发现 ${result.detectedCount} 条，新增 ${result.createdCount} 条，已投递 ${result.notifiedCount} 条提醒`
          : "当前项目风险扫描已停用"
      );
      await Promise.all([
        riskAlerts.refetch(),
        riskFinanceAnalysis.refetch(),
        riskCapacityReadiness.refetch(),
        audits.refetch(),
      ]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const updateRiskAlertStatus = trpc.projectRisk.updateAlertStatus.useMutation({
    onSuccess: async () => {
      toast.success("风险预警处置状态已更新");
      await Promise.all([riskAlerts.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const assignRiskRectification =
    trpc.projectRisk.assignRectification.useMutation({
      onSuccess: async () => {
        toast.success("已分配整改责任人并发送站内待办");
        setRiskRectificationTarget(null);
        await Promise.all([riskAlerts.refetch(), audits.refetch()]);
      },
      onError: error => toast.error(getUserFacingErrorMessage(error)),
    });
  const runOverdueRiskEscalation =
    trpc.projectRisk.runOverdueEscalation.useMutation({
      onSuccess: async result => {
        toast.success(
          `逾期升级验收完成：升级 ${result.escalatedCount} 条，投递 ${result.notifiedCount} 条站内提醒`
        );
        await Promise.all([riskAlerts.refetch(), audits.refetch()]);
      },
      onError: error => toast.error(getUserFacingErrorMessage(error)),
    });
  const generateRiskBriefing = trpc.projectRisk.generateBriefing.useMutation({
    onSuccess: result => {
      setRiskBriefing({
        ...result.briefing,
        source: result.source,
        model: result.model,
        externalFallback: result.externalFallback,
      });
      if (result.externalFallback)
        toast.warning(
          `外部 AI 已降级（${result.externalFallback}）；系统已继续生成可用摘要`
        );
      else
        toast.success(
          result.source === "fallback"
            ? "AI 服务暂不可用，已生成规则汇总摘要"
            : result.source === "external"
              ? "外部 AI 管理摘要已生成"
              : "系统内置 AI 管理摘要已生成"
        );
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const saveMachineCost = trpc.machinery.saveCost.useMutation({
    onSuccess: async data => {
      await Promise.all([
        trpcUtils.machinery.listDailyOperations.invalidate(),
        trpcUtils.machinery.printSummary.invalidate(),
      ]);
      toast.success(
        `机械成本已录入，系统核算金额 ¥${displayMoney(data.amount)}`
      );
      setMachineCostForm(EMPTY_MACHINE_COST_FORM);
      setMachineCostDialogOpen(false);
      await Promise.all([
        trpcUtils.machinery.listCosts.invalidate(),
        trpcUtils.machinery.listCostSummaries.invalidate(),
        audits.refetch(),
      ]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const saveMachineDailyOperation =
    trpc.machinery.saveDailyOperation.useMutation({
      onSuccess: async () => {
        await Promise.all([
          trpcUtils.machinery.listDailyOperations.invalidate(),
          trpcUtils.machinery.printSummary.invalidate(),
        ]);
        toast.success("机械加班记录已保存，金额由服务端核算");
        setMachineDailyOperationDialogOpen(false);
        setMachineDailyOperationForm(EMPTY_MACHINE_DAILY_OPERATION_FORM);
        await Promise.all([
          trpcUtils.machinery.getMachineAnalysis.invalidate(),
          audits.refetch(),
        ]);
      },
      onError: error => toast.error(getUserFacingErrorMessage(error)),
    });
  const saveMachineMonthlyStatement =
    trpc.machinery.saveMonthlyStatement.useMutation({
      onSuccess: async result => {
        await Promise.all([
          trpcUtils.machinery.listDailyOperations.invalidate(),
          trpcUtils.machinery.printSummary.invalidate(),
        ]);
        toast.success(
          `会计机械月度明细已保存：总产值 ¥${displayMoney(result.preview.statement.totalOutput)}`
        );
        setMachineStatementDialogOpen(false);
        setMachineStatementForm(EMPTY_MACHINE_MONTHLY_STATEMENT_FORM);
        await Promise.all([
          trpcUtils.machinery.listMonthlyStatements.invalidate(),
          trpcUtils.machinery.listCostSummaries.invalidate(),
          audits.refetch(),
        ]);
      },
      onError: error => toast.error(getUserFacingErrorMessage(error)),
    });
  const transitionMachineMonthlyStatement =
    trpc.machinery.transitionMonthlyStatement.useMutation({
      onSuccess: async () => {
        await Promise.all([
          trpcUtils.machinery.listDailyOperations.invalidate(),
          trpcUtils.machinery.printSummary.invalidate(),
        ]);
        toast.success("机械月度明细状态已更新");
        await Promise.all([
          trpcUtils.machinery.listMonthlyStatements.invalidate(),
          audits.refetch(),
        ]);
      },
      onError: error => toast.error(getUserFacingErrorMessage(error)),
    });
  const saveEmployeeProfile = trpc.admin.employee.saveProfile.useMutation({
    onSuccess: async () => {
      toast.success(
        employeeProfileForm.id ? "员工档案已更新" : "员工档案已建立"
      );
      setEmployeeProfileForm(EMPTY_EMPLOYEE_PROFILE_FORM);
      setEmployeeProfileDialogOpen(false);
      await Promise.all([employeeProfiles.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  /**
   * 施工队工人的身份证、电话与银行卡只会在本次受控提交内存中出现；
   * 成功、取消和遮罩关闭均清空，且绝不写入本机草稿或员工档案。
   */
  const closeLaborWorkerCreateDialog = () => {
    setLaborWorkerCreateDialogOpen(false);
    setLaborWorkerCreateForm(EMPTY_LABOR_WORKER_CREATE_FORM);
  };
  const saveLaborWorker = trpc.labor.saveWorker.useMutation({
    onSuccess: async (_result, variables) => {
      toast.success("实名制施工队工人已新建");
      closeLaborWorkerCreateDialog();
      await trpcUtils.labor.listWorkers.invalidate({
        projectId: variables.projectId,
        includeLeft: true,
      });
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const submitLaborWorkerCreate = () => {
    if (!hasBusinessWorkspaceProject) return toast.error("请先选择已授权项目");
    if (!laborWorkerCreateForm.realName.trim())
      return toast.error("请填写实名姓名");
    if (!laborWorkerCreateForm.identityNo.trim())
      return toast.error("请填写身份证号码");
    saveLaborWorker.mutate({
      projectId: workspaceProjectId,
      workerCategory: "labor_team",
      realName: laborWorkerCreateForm.realName.trim(),
      identityNo: laborWorkerCreateForm.identityNo.trim(),
      teamName: laborWorkerCreateForm.teamName.trim() || null,
      phone: laborWorkerCreateForm.phone.trim() || null,
      bankName: laborWorkerCreateForm.bankName.trim() || null,
      bankAccount: laborWorkerCreateForm.bankAccount.trim() || null,
      entryDate: laborWorkerCreateForm.entryDate || null,
      remarks: laborWorkerCreateForm.remarks.trim() || null,
      identityVerificationStatus: "pending",
      attendanceStatus: "active",
    });
  };
  const uploadEmployeeInsurancePolicy =
    trpc.admin.employee.uploadInsurancePolicy.useMutation();
  const saveEmployeeInsurance = trpc.admin.employee.saveInsurance.useMutation({
    onSuccess: async () => {
      toast.success("员工保险台账已保存，到期状态已刷新");
      setEmployeeInsuranceForm(EMPTY_EMPLOYEE_INSURANCE_FORM);
      setEmployeeInsurancePolicyFile(null);
      setEmployeeInsuranceDialogOpen(false);
      await Promise.all([employeeProfiles.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const saveAssetMaintenance = trpc.admin.assetMaintenance.save.useMutation({
    onSuccess: async () => {
      toast.success("维修保养费用已保存并纳入资源汇总");
      setAssetMaintenanceForm(EMPTY_ASSET_MAINTENANCE_FORM);
      setAssetMaintenanceDialogOpen(false);
      await Promise.all([
        assetMaintenanceRecords.refetch(),
        assetMaintenanceSummary.refetch(),
        machineCosts.refetch(),
        machineCostSummaries.refetch(),
        audits.refetch(),
      ]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const saveRfidWriterDevice = trpc.transport.saveRfidWriterDevice.useMutation({
    onSuccess: async () => {
      toast.success("写卡器台账已保存");
      setRfidWriterDeviceForm(EMPTY_RFID_WRITER_DEVICE_FORM);
      setRfidWriterDialogOpen(false);
      await Promise.all([rfidWriterDevices.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const saveVehicleRfidCard = trpc.transport.saveVehicleRfidCard.useMutation({
    onSuccess: async (_data, variables) => {
      toast.success(
        variables.reuseRevokedUnboundCard
          ? "历史车辆卡已重新绑定为待写入；请生成新任务完成写入和回读确认"
          : "车辆射频卡绑定已保存为待写入；写入并回读确认成功后才会启用"
      );
      setRfidCardForm(EMPTY_RFID_CARD_FORM);
      setRfidCardDialogOpen(false);
      await Promise.all([vehicleRfidCards.refetch(), audits.refetch()]);
    },
    onError: error =>
      toast.error(
        error.message ===
          "该射频卡仍由其他车辆卡台账占用，请先在对应台账完成挂失和解除绑定"
          ? "当前实体卡仍由另一条车辆卡台账占用，请先处理对应台账后再重新绑定。"
          : error.message
      ),
  });
  const revokeVehicleRfidCard =
    trpc.transport.revokeVehicleRfidCard.useMutation({
      onSuccess: async () => {
        toast.success("车辆射频卡已挂失停用");
        await Promise.all([vehicleRfidCards.refetch(), audits.refetch()]);
      },
      onError: error =>
        toast.error(
          getVehicleRfidCardManagementErrorMessage("revoke", error.message)
        ),
    });
  const unbindVehicleRfidCard =
    trpc.transport.unbindVehicleRfidCard.useMutation({
      onSuccess: async () => {
        toast.success("车辆射频卡已解除绑定，卡片记录和审计已保留");
        await Promise.all([vehicleRfidCards.refetch(), audits.refetch()]);
      },
      onError: error =>
        toast.error(
          getVehicleRfidCardManagementErrorMessage("unbind", error.message)
        ),
    });
  const handleRevokeVehicleRfidCard = (cardId: number) => {
    if (
      window.confirm(
        "确认挂失停用这张车辆射频卡？停用只影响后续运输识别，不会擦除实体卡内容。"
      )
    )
      revokeVehicleRfidCard.mutate({
        cardId,
        projectId: workspaceProjectId,
        reason: "后台车辆卡台账操作",
      });
  };
  const handleUnbindVehicleRfidCard = (cardId: number) => {
    if (
      window.confirm(
        "确认解除该射频卡与当前车辆的绑定？卡片记录和审计会保留，未闭环运输趟次会阻止操作。"
      )
    )
      unbindVehicleRfidCard.mutate({
        cardId,
        projectId: workspaceProjectId,
        reason: "后台车辆卡台账操作",
      });
  };
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
      const result = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        cardUid?: string;
        message?: string;
      };
      if (!response.ok || !result.success || !result.cardUid)
        throw new Error(
          result.message || `读取卡 ID 失败（HTTP ${response.status}）`
        );
      setRfidCardForm(current => ({ ...current, cardUid: result.cardUid! }));
      toast.success("已读取卡 ID，并自动填入本次绑定表单。");
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "读取卡 ID 超时：请确认 NTAG216 已放在 uTrust 4701 F CL Reader 感应区。"
          : "无法访问本机读卡桥接程序：请确认 Windows 桥接程序已启动，并允许浏览器访问本机设备。";
      toast.error(message);
    } finally {
      window.clearTimeout(timeoutId);
      setReadingRfidBindingUid(false);
    }
  };
  const prepareRfidCardWrite = trpc.transport.prepareRfidCardWrite.useMutation({
    onSuccess: data => {
      const isPcBridge = data.hardwareMode === "pc_bridge";
      setRfidWritePreview({
        jobId: data.jobId,
        jobNo: data.jobNo,
        payload:
          "payload" in data ? (data.payload as Record<string, unknown>) : null,
        hardwareMode: data.hardwareMode,
        bridgeToken: isPcBridge ? data.bridgeToken : null,
      });
      toast.success(
        isPcBridge
          ? "PC 受控写卡任务已生成，请保持新卡放在 uTrust 感应区后执行写入。"
          : "写卡载荷已生成；请在现场写卡器完成物理写入后确认结果"
      );
    },
    onError: (error, variables) => {
      if (
        error.data?.code === "CONFLICT" &&
        !variables.replacePreparedPcBridgeJob
      ) {
        if (
          window.confirm(
            "该车辆卡已有未完成写卡任务。确认结束原任务并生成新的单次写卡任务吗？此操作不会写卡，也不会启用卡片。"
          )
        ) {
          prepareRfidCardWrite.mutate({
            ...variables,
            replacePreparedPcBridgeJob: true,
          });
        } else {
          toast.error(
            "已保留原写卡任务；请回到原窗口完成写入，或稍后重新生成任务。"
          );
        }
        return;
      }
      toast.error(
        error.data?.code === "CONFLICT"
          ? "原写卡任务状态已变化，请刷新列表后重新操作。"
          : "车辆卡写卡任务生成失败，请刷新后重试"
      );
    },
  });
  const [writingRfidCard, setWritingRfidCard] = useState(false);
  const [rfidBridgeReadiness, setRfidBridgeReadiness] =
    useState<RfidBridgeReadiness | null>(null);
  const [checkingRfidBridgeReadiness, setCheckingRfidBridgeReadiness] =
    useState(false);
  const checkRfidBridgeReadiness = async () => {
    setCheckingRfidBridgeReadiness(true);
    try {
      const result = await readRfidBridgeReadiness();
      setRfidBridgeReadiness(result);
      result.status === "ready"
        ? toast.success("本机桥接版本已匹配；未执行写卡。")
        : toast.error(result.reason);
    } finally {
      setCheckingRfidBridgeReadiness(false);
    }
  };
  const [readingVehicleCardEntry, setReadingVehicleCardEntry] = useState(false);
  const [retryingRfidCardConfirmation, setRetryingRfidCardConfirmation] =
    useState(false);
  const recoverRfidCardConfirmation =
    trpc.transport.recoverRfidCardConfirmation.useMutation();
  const verifyAndConfirmWrittenRfidCard = async (jobId: number) => {
    if (
      !window.confirm(
        "确认只读复核当前车辆卡并完成启用吗？此操作只读取卡内现有 NDEF 并逐字节比对，绝不会再次写入卡片。"
      )
    )
      return;
    setRetryingRfidCardConfirmation(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 45_000);
    try {
      const readiness = await readRfidBridgeReadiness(controller.signal);
      setRfidBridgeReadiness(readiness);
      if (readiness.status !== "ready")
        throw new Error("bridge_recovery_version_mismatch");
      const recovery = await recoverRfidCardConfirmation.mutateAsync({
        id: jobId,
        projectId: workspaceProjectId,
      });
      const response = await fetch(
        "http://127.0.0.1:47601/api/verify-and-confirm-vehicle-card",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bridgeToken: recovery.bridgeToken }),
          cache: "no-store",
          signal: controller.signal,
        }
      );
      const result = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        status?: string;
        message?: string;
        wroteCard?: boolean;
        readbackVerified?: boolean;
      };
      if (
        !response.ok ||
        !result.success ||
        result.status !== "confirmed" ||
        result.wroteCard !== false ||
        result.readbackVerified !== true
      )
        throw new Error(result.message || "bridge_recovery_readback_failed");
      await Promise.all([
        vehicleRfidCards.refetch(),
        rfidWriterDevices.refetch(),
        audits.refetch(),
      ]);
      toast.success(
        "车辆卡现有内容已逐字节只读复核，服务端确认完成并已启用；本次没有再次写卡。"
      );
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "只读复核超时：请保持车辆卡不动，不要重新写卡。"
          : error instanceof Error &&
              error.message === "bridge_recovery_version_mismatch"
            ? "Windows 桥接版本不支持只读复核，已停止操作；卡片未被再次写入。"
            : error instanceof TypeError
              ? "浏览器无法访问本机只读复核接口；卡片未被再次写入。"
              : "现有卡内容未通过只读复核或任务状态已变化；请停止操作，不要重新写卡。";
      toast.error(message);
    } finally {
      window.clearTimeout(timeoutId);
      setRetryingRfidCardConfirmation(false);
    }
  };
  const writeRfidCardWithBridge = async () => {
    if (!rfidWritePreview?.bridgeToken)
      return toast.error("本地写卡授权无效，请重新生成 PC 写卡任务");
    setWritingRfidCard(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 45_000);
    try {
      const readiness = await readRfidBridgeReadiness(controller.signal);
      setRfidBridgeReadiness(readiness);
      if (readiness.status === "unavailable")
        throw new Error("bridge_write_unavailable");
      if (readiness.status === "writer_mismatch")
        throw new Error("bridge_write_interface_version_mismatch");
      if (readiness.status !== "ready")
        throw new Error("bridge_write_version_mismatch");
      const response = await fetch(
        "http://127.0.0.1:47601/api/write-vehicle-card",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bridgeToken: rfidWritePreview.bridgeToken }),
          cache: "no-store",
          signal: controller.signal,
        }
      );
      const result = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        jobNo?: string;
        message?: string;
        status?: string;
      };
      if (response.status === 404)
        throw new Error("bridge_write_endpoint_missing");
      if (response.status === 401 || response.status === 403)
        throw new Error("bridge_write_authorization_rejected");
      if (response.status === 409)
        throw new Error("bridge_write_card_or_payload_mismatch");
      const bridgeFailure =
        typeof result.message === "string" ? result.message : "";
      if (!response.ok || !result.success || result.status !== "confirmed") {
        if (
          bridgeFailure.includes("vehicle_card_readback_fingerprint_mismatch")
        )
          throw new Error("bridge_write_readback_fingerprint_mismatch");
        if (bridgeFailure.includes("bridge_payload_shape_invalid"))
          throw new Error("bridge_write_payload_shape_invalid");
        if (bridgeFailure.includes("server_vehicle_card_claim_token_invalid"))
          throw new Error("bridge_write_server_claim_token_invalid");
        if (bridgeFailure.includes("server_vehicle_card_claim_uid_invalid"))
          throw new Error("bridge_write_server_claim_uid_invalid");
        if (bridgeFailure.includes("server_vehicle_card_claim_request_invalid"))
          throw new Error("bridge_write_server_claim_request_invalid");
        if (
          bridgeFailure.includes(
            "server_vehicle_card_claim_card_or_payload_conflict"
          )
        )
          throw new Error("bridge_write_server_claim_card_or_payload_conflict");
        if (
          bridgeFailure.includes(
            "server_vehicle_card_claim_authorization_or_server_unavailable"
          )
        )
          throw new Error(
            "bridge_write_server_claim_authorization_or_server_unavailable"
          );
        if (bridgeFailure.includes("server_vehicle_card_claim_failed"))
          throw new Error("bridge_write_server_claim_failed");
        if (bridgeFailure.includes("server_vehicle_card_confirm_retryable"))
          throw new Error("bridge_write_server_confirm_retryable");
        if (bridgeFailure.includes("card_reader_connection_failed"))
          throw new Error("bridge_write_reader_connection_failed");
        if (bridgeFailure.includes("ndef_exceeds_declared_card_capacity"))
          throw new Error("bridge_write_card_capacity_insufficient");
        if (bridgeFailure.includes("card_user_area_read_failed"))
          throw new Error("bridge_write_user_area_read_failed");
        if (bridgeFailure.includes("card_user_area_write_failed"))
          throw new Error("bridge_write_user_area_write_failed");
        if (bridgeFailure.includes("post_write_byte_mismatch"))
          throw new Error("bridge_write_post_write_mismatch");
        if (bridgeFailure.includes("ntag_type2_ndef_cc_not_detected"))
          throw new Error("bridge_write_ndef_cc_invalid");
        if (bridgeFailure.includes("card_writer_no_diagnostic_result"))
          throw new Error("bridge_write_no_diagnostic_result");
        if (bridgeFailure.includes("card_writer_load_failed"))
          throw new Error("bridge_write_writer_load_failed");
        if (bridgeFailure.includes("card_write_prepare_failed"))
          throw new Error("bridge_write_prepare_failed");
        if (bridgeFailure.includes("card_uid_read_failed"))
          throw new Error("bridge_write_uid_read_failed");
        if (bridgeFailure.includes("card_writer_execution_failed"))
          throw new Error("bridge_write_writer_execution_failed");
        if (bridgeFailure.includes("card_writer_result_invalid"))
          throw new Error("bridge_write_writer_result_invalid");
        if (bridgeFailure.includes("local_confirmation_receipt_failed"))
          throw new Error("bridge_write_confirmation_receipt_failed");
        if (bridgeFailure.includes("card_writer_version_mismatch")) {
          setRfidBridgeReadiness(current => ({
            status: "writer_mismatch",
            bridgeVersion: current?.bridgeVersion ?? null,
            bridgeBuildId: current?.bridgeBuildId ?? null,
            writerVersion: current?.writerVersion ?? null,
            reason:
              "本机底层写卡程序的版本或加载结果未通过校验。不能确定卡片是否已写入，请保持卡片不动，完整更新安装包后先进行只读复核，不要反复写卡。",
          }));
          throw new Error("bridge_write_writer_version_mismatch");
        }
        throw new Error("bridge_write_or_readback_failed");
      }
      await Promise.all([
        vehicleRfidCards.refetch(),
        rfidWriterDevices.refetch(),
        audits.refetch(),
      ]);
      toast.success(
        `车辆卡 ${result.jobNo || rfidWritePreview.jobNo} 已完成写入、回读校验并启用。`
      );
      window.requestAnimationFrame(() => setRfidWritePreview(null));
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "本地写卡超时：请保持车辆卡停留在 uTrust 感应区，并检查桥接连接。"
          : error instanceof TypeError
            ? "浏览器无法访问正式写卡接口：请保持 Windows 桥接程序运行，并允许当前网站访问本机 127.0.0.1 设备后重试。"
            : error instanceof Error &&
                error.message === "bridge_write_version_mismatch"
              ? "当前 Windows 桥接程序的版本或构建标识不符合正式写卡要求，已在写卡前停止操作；请在窗口中查看本机版本并下载最新版安装包，安装完成后重新检测。"
              : error instanceof Error &&
                  error.message === "bridge_write_unavailable"
                ? "本机桥接未就绪或连接检测失败，并非已确认的版本不符。请查看窗口内诊断并重新检测。"
                : error instanceof Error &&
                    error.message === "bridge_write_interface_version_mismatch"
                  ? "桥接的写卡接口声明与正式要求不符，尚未开始写卡；请完整安装最新版后重新检测。"
                  : error instanceof Error &&
                      error.message === "bridge_write_writer_version_mismatch"
                    ? "本机底层写卡程序版本或加载结果未通过校验；这不是前置桥接版本错误。请保持卡片不动，先只读复核，不要重复写入。"
                    : error instanceof Error &&
                        error.message === "bridge_write_endpoint_missing"
                      ? "当前 Windows 桥接程序未安装正式车辆卡写入接口：测试写卡可用，但请更新桥接程序后再办理正式车辆卡。"
                      : error instanceof Error &&
                          error.message ===
                            "bridge_write_authorization_rejected"
                        ? "本次写卡任务授权已失效或被拒绝：请关闭窗口后重新生成 PC 写卡任务，再立即写入。"
                        : error instanceof Error &&
                            error.message ===
                              "bridge_write_card_or_payload_mismatch"
                          ? "当前卡片 UID 或回读载荷与写卡任务不一致：请确认仍为刚绑定的车辆卡，不要更换卡片后重试。"
                          : error instanceof Error &&
                              error.message ===
                                "bridge_write_readback_fingerprint_mismatch"
                            ? "卡片已完成写入回读，但回读摘要与本次受控任务不一致：请保持卡片不动并停止操作，不要重新写卡。"
                            : error instanceof Error &&
                                error.message ===
                                  "bridge_write_payload_shape_invalid"
                              ? "本次正式车辆卡载荷格式校验未通过：请刷新后台后重新生成 PC 写卡任务。"
                              : error instanceof Error &&
                                  error.message ===
                                    "bridge_write_server_claim_token_invalid"
                                ? "本次 PC 写卡授权未被桥接正确提交：当前卡没有开始写入。请关闭窗口并重新生成任务后立即写入。"
                                : error instanceof Error &&
                                    error.message ===
                                      "bridge_write_server_claim_uid_invalid"
                                  ? "本机读取的卡 UID 未能生成有效指纹：当前卡没有开始写入。请保持卡片不动，重新读取 UID 并核对绑定后再生成任务。"
                                  : error instanceof Error &&
                                      error.message ===
                                        "bridge_write_server_claim_request_invalid"
                                    ? "本次写卡请求格式无效：当前卡没有开始写入。请关闭窗口后重新生成 PC 写卡任务。"
                                    : error instanceof Error &&
                                        error.message ===
                                          "bridge_write_server_claim_card_or_payload_conflict"
                                      ? "当前感应卡与所选车辆卡不匹配，或该任务载荷不可用：当前卡没有开始写入。请先核对卡片绑定后重新生成任务。"
                                      : error instanceof Error &&
                                          error.message ===
                                            "bridge_write_server_claim_authorization_or_server_unavailable"
                                        ? "本次写卡授权已过期、已处理，或服务器暂时无法读取任务：当前卡没有开始写入。请关闭窗口后重新生成 PC 写卡任务。"
                                        : error instanceof Error &&
                                            error.message ===
                                              "bridge_write_server_claim_failed"
                                          ? "服务器未返回本次正式写卡载荷：当前卡没有开始写入。请关闭窗口后重新生成 PC 写卡任务；不要点击“仅回传确认”。"
                                          : error instanceof Error &&
                                              error.message ===
                                                "bridge_write_server_confirm_retryable"
                                            ? "本机写入回读已完成，但服务端确认暂未返回：请保持卡片和桥接程序不变，只点击“仅回传确认（不写卡）”，不得再次写入。"
                                            : error instanceof Error &&
                                                error.message ===
                                                  "bridge_write_reader_connection_failed"
                                              ? "正式写卡时读卡器连接中断：请保持卡片在 uTrust 感应区，关闭其他读卡程序后重新生成任务。"
                                              : error instanceof Error &&
                                                  error.message ===
                                                    "bridge_write_card_capacity_insufficient"
                                                ? "当前卡片可用 NDEF 容量不足以写入正式车辆卡：请使用符合 NTAG216 容量要求的空白卡，勿用测试卡替代。"
                                                : error instanceof Error &&
                                                    error.message ===
                                                      "bridge_write_user_area_read_failed"
                                                  ? "读取卡片 NDEF 用户区失败：请保持卡片稳定停留在感应区，并确认不是低容量或受保护卡。"
                                                  : error instanceof Error &&
                                                      error.message ===
                                                        "bridge_write_user_area_write_failed"
                                                    ? "写入卡片 NDEF 用户区失败：请确认卡片未被写保护，并保持卡片稳定停留在感应区后重新生成任务。"
                                                    : error instanceof Error &&
                                                        error.message ===
                                                          "bridge_write_post_write_mismatch"
                                                      ? "卡片写入后逐字节回读不一致：请保持卡片不动并停止操作，不要再次写入。"
                                                      : error instanceof
                                                            Error &&
                                                          error.message ===
                                                            "bridge_write_ndef_cc_invalid"
                                                        ? "当前卡片未识别到有效 NDEF 能力容器：请使用符合 NTAG216 要求的空白 NFC 卡。"
                                                        : error instanceof
                                                              Error &&
                                                            error.message ===
                                                              "bridge_write_no_diagnostic_result"
                                                          ? "本机写卡器未返回可诊断结果：请保持卡片在感应区，关闭后重新启动 Windows 桥接程序后再生成新任务。"
                                                          : error instanceof
                                                                Error &&
                                                              error.message ===
                                                                "bridge_write_writer_load_failed"
                                                            ? "本机正式写卡器源码未能加载或编译：当前卡没有开始写入。请更新写卡器文件并重启桥接后再生成任务。"
                                                            : error instanceof
                                                                  Error &&
                                                                error.message ===
                                                                  "bridge_write_prepare_failed"
                                                              ? "正式车辆卡载荷在本机写入前准备校验失败：当前卡没有开始写入。请保留任务号并停止重试。"
                                                              : error instanceof
                                                                    Error &&
                                                                  error.message ===
                                                                    "bridge_write_uid_read_failed"
                                                                ? "本机未能稳定读取当前车辆卡 UID：当前卡没有开始写入。请保持卡片在感应区并关闭其他读卡程序。"
                                                                : error instanceof
                                                                      Error &&
                                                                    error.message ===
                                                                      "bridge_write_writer_execution_failed"
                                                                  ? "本机调用正式写卡器失败：当前卡未通过写入确认。请停止重试并读取最近一次受控失败阶段。"
                                                                  : error instanceof
                                                                        Error &&
                                                                      error.message ===
                                                                        "bridge_write_writer_result_invalid"
                                                                    ? "本机写卡器返回结果不完整：当前卡未通过写入确认。请停止重试并读取最近一次受控失败阶段。"
                                                                    : error instanceof
                                                                          Error &&
                                                                        error.message ===
                                                                          "bridge_write_confirmation_receipt_failed"
                                                                      ? "卡片写入回读后，本机短时确认收据保存失败：请保持卡片和桥接不变，停止再次写入。"
                                                                      : "本机写卡未通过写入或回读校验：请保持车辆卡在感应区，确认后重新生成任务再重试。";
      toast.error(message);
    } finally {
      window.clearTimeout(timeoutId);
      setWritingRfidCard(false);
    }
  };
  const openVehicleTransportFromBridge = async () => {
    setReadingVehicleCardEntry(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(
        "http://127.0.0.1:47601/api/read-vehicle-entry",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          cache: "no-store",
          signal: controller.signal,
        }
      );
      const result = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        nfcEntryUrl?: string;
        message?: string;
      };
      if (!response.ok || !result.success || !result.nfcEntryUrl) {
        if (result.message === "vehicle_card_ndef_entry_not_found")
          throw new Error("vehicle_card_ndef_entry_not_found");
        if (result.message === "vehicle_card_ndef_entry_not_allowed")
          throw new Error("vehicle_card_ndef_entry_not_allowed");
        throw new Error("vehicle_card_entry_read_failed");
      }
      const target = new URL(result.nfcEntryUrl);
      if (
        target.protocol !== "https:" ||
        target.hostname !== "yx.maomaoyx.com" ||
        target.port ||
        target.pathname !== "/mobile/transport" ||
        target.hash ||
        target.searchParams.size !== 1 ||
        !target.searchParams.get("nfc")
      )
        throw new Error("vehicle_card_ndef_entry_not_allowed");
      window.location.assign(target.toString());
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "刷卡读取超时：请保持车辆卡在 uTrust 感应区后重试。"
          : error instanceof TypeError
            ? "无法访问本机读卡桥接：请启动 Windows 桥接程序并允许当前网站访问本机设备。"
            : error instanceof Error &&
                error.message === "vehicle_card_ndef_entry_not_found"
              ? "未读取到有效车辆卡网页入口：请使用已完成受控写入的车辆卡，勿使用测试卡。"
              : error instanceof Error &&
                  error.message === "vehicle_card_ndef_entry_not_allowed"
                ? "该卡片入口不属于受控运输页面，已拒绝打开。"
                : "读取车辆卡入口失败：请保持卡片稳定放在读卡器感应区后重试。";
      toast.error(message);
    } finally {
      window.clearTimeout(timeoutId);
      setReadingVehicleCardEntry(false);
    }
  };
  const confirmRfidCardWithBridgeReceipt = async () => {
    if (!rfidWritePreview?.bridgeToken)
      return toast.error("本地写卡授权无效，请重新生成 PC 写卡任务");
    if (
      !window.confirm(
        "确认仅回传服务端确认结果吗？此操作不会再次写入车辆卡，只会使用本机已验证的短时确认收据。"
      )
    )
      return;
    setRetryingRfidCardConfirmation(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(
        "http://127.0.0.1:47601/api/confirm-vehicle-card",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          cache: "no-store",
          signal: controller.signal,
        }
      );
      const result = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        jobNo?: string;
        status?: string;
        message?: string;
      };
      if (!response.ok || !result.success || result.status !== "confirmed") {
        if (result.message === "pending_vehicle_card_confirmation_not_found")
          throw new Error("bridge_confirmation_receipt_not_found");
        throw new Error("bridge_confirmation_retry_failed");
      }
      await Promise.all([
        vehicleRfidCards.refetch(),
        rfidWriterDevices.refetch(),
        audits.refetch(),
      ]);
      toast.success(
        `车辆卡 ${result.jobNo || rfidWritePreview.jobNo} 已完成服务端确认并启用。`
      );
      window.requestAnimationFrame(() => setRfidWritePreview(null));
    } catch (error) {
      toast.error(
        error instanceof Error &&
          error.message === "bridge_confirmation_receipt_not_found"
          ? "未找到可用的本机确认收据：请重新生成任务后执行一次完整写入与回读。"
          : "仅回传确认未完成：请保持桥接程序运行和当前卡片不动后重试；15 分钟后需重新生成任务。"
      );
    } finally {
      window.clearTimeout(timeoutId);
      setRetryingRfidCardConfirmation(false);
    }
  };
  const confirmRfidCardWrite = trpc.transport.confirmRfidCardWrite.useMutation({
    onSuccess: async data => {
      await Promise.all([
        vehicleRfidCards.refetch(),
        rfidWriterDevices.refetch(),
        audits.refetch(),
      ]);
      toast.success(
        data.status === "confirmed"
          ? "写卡结果已确认并留痕"
          : "写卡失败已记录，请核对设备和卡片后重试"
      );
      window.requestAnimationFrame(() => setRfidWritePreview(null));
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
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
      await Promise.all([
        assignments.refetch(),
        audits.refetch(),
        users.refetch(),
      ]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const createLocalUser = trpc.admin.personnel.createLocalUser.useMutation({
    onSuccess: async () => {
      toast.success(
        machineOwnerAccountDialogOpen
          ? "机械老板账号已创建，请在机械档案中选择并绑定该账号"
          : "普通管理人员账号已创建，请继续配置角色、部门和项目范围"
      );
      setLocalAccountForm({
        username: "",
        displayName: "",
        initialPassword: "",
        status: "active",
        loginMode: "both",
      });
      setMachineOwnerAccountDialogOpen(false);
      await Promise.all([
        users.refetch(),
        audits.refetch(),
        overview.refetch(),
      ]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const setLocalUserStatus =
    trpc.admin.personnel.setLocalUserStatus.useMutation({
      onSuccess: async () => {
        toast.success("本地账号状态已更新；已停用账号的后续请求会被服务端拒绝");
        await Promise.all([users.refetch(), audits.refetch()]);
      },
      onError: error => toast.error(getUserFacingErrorMessage(error)),
    });
  const updateLocalUser = trpc.admin.personnel.updateLocalUser.useMutation({
    onSuccess: async () => {
      toast.success("普通管理人员账号资料已更新");
      setLocalAccountEditForm(null);
      await Promise.all([users.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const resetLocalUserPassword =
    trpc.admin.personnel.resetLocalUserPassword.useMutation({
      onSuccess: async () => {
        toast.success("普通管理人员密码已重置，新密码不会再次显示");
        setPasswordResetTarget(null);
        setResetPassword("");
        await audits.refetch();
      },
      onError: error => toast.error(getUserFacingErrorMessage(error)),
    });
  const deleteLocalUser = trpc.admin.personnel.deleteLocalUser.useMutation({
    onSuccess: async data => {
      toast.success(
        `普通管理人员账号已删除，并撤销 ${data.revokedAssignmentCount} 项角色授权`
      );
      setDeleteTarget(null);
      await Promise.all([
        users.refetch(),
        assignments.refetch(),
        audits.refetch(),
        overview.refetch(),
      ]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const setUserPermissions =
    trpc.admin.personnel.setUserPermissions.useMutation({
      onSuccess: async () => {
        toast.success("该用户的专属操作权限已保存并即时生效");
        setUserPermissionTarget(null);
        setDraftUserPermissionIds([]);
        await Promise.all([users.refetch(), audits.refetch()]);
      },
      onError: error => toast.error(getUserFacingErrorMessage(error)),
    });
  const saveDepartmentScope = trpc.admin.department.saveScope.useMutation({
    onSuccess: async () => {
      toast.success("项目或部门业务范围已保存，相关人员下次请求将按新范围校验");
      setDepartmentScopeForm({ scopeTarget: "", module: "" });
      await departmentScopes.refetch();
    },
  });
  const saveSetting = trpc.admin.settings.saveDraft.useMutation({
    onSuccess: async data => {
      toast.success(
        settingForm.id
          ? `配置草稿已更新为 v${data.version ?? "新版本"}`
          : "配置草稿已安全保存"
      );
      setSettingForm(EMPTY_SETTING_FORM);
      await Promise.all([
        settings.refetch(),
        settingHistory.refetch(),
        overview.refetch(),
        audits.refetch(),
      ]);
    },
    onError: refreshAfterSettingConflict,
  });
  const saveAttendanceDeviceLimit = trpc.admin.settings.saveDraft.useMutation({
    onSuccess: async () => {
      toast.success("考勤设备绑定上限草稿已保存，请点击发布后生效");
      await Promise.all([
        settings.refetch(),
        settingHistory.refetch(),
        overview.refetch(),
        audits.refetch(),
      ]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const saveOfficialAccountConfiguration =
    trpc.admin.settings.saveOfficialAccountConfiguration.useMutation({
      onSuccess: async result => {
        setOfficialAccountConfigurationValidation(result);
        result.success
          ? toast.success("服务号五项配置已一次保存并校验通过")
          : toast.error(`服务号配置已保存，但校验未通过：${result.message}`);
        setOfficialAccountConfigurationForm(current => ({
          ...current,
          appSecret: "",
          egressSigningSecret: "",
        }));
        await Promise.all([
          settings.refetch(),
          officialTemplateCoverage.refetch(),
          overview.refetch(),
          audits.refetch(),
        ]);
      },
      onError: error => {
        setOfficialAccountConfigurationValidation({
          success: false,
          message: error.message,
        });
        toast.error(getUserFacingErrorMessage(error));
      },
    });
  const saveOfficialAccountMessagePushConfiguration =
    trpc.admin.settings.saveOfficialAccountMessagePushConfiguration.useMutation(
      {
        onSuccess: async result => {
          setOfficialAccountMessagePushValidation({
            success: result.success,
            message: result.message,
          });
          toast.success("消息推送 Token 已保存；微信后台请填同一 Token");
          setOfficialAccountMessagePushForm(
            EMPTY_OFFICIAL_ACCOUNT_MESSAGE_PUSH_FORM
          );
          await Promise.all([
            officialMessagePushConfiguration.refetch(),
            settings.refetch(),
            audits.refetch(),
          ]);
        },
        onError: error => {
          setOfficialAccountMessagePushValidation({
            success: false,
            message: error.message,
          });
          toast.error(getUserFacingErrorMessage(error));
        },
      }
    );
  const testOfficialAccountMessagePushConfiguration =
    trpc.admin.settings.testOfficialAccountMessagePushConfiguration.useMutation(
      {
        onSuccess: async result => {
          setOfficialAccountMessagePushValidation(result);
          result.success
            ? toast.success("消息推送回调验签通过")
            : toast.error(result.message);
          await audits.refetch();
        },
        onError: error => {
          setOfficialAccountMessagePushValidation({
            success: false,
            message: error.message,
          });
          toast.error(getUserFacingErrorMessage(error));
        },
      }
    );
  const saveExternalAiConfiguration =
    trpc.admin.settings.saveExternalAiConfiguration.useMutation({
      onSuccess: async () => {
        toast.success(
          "外部 AI API 配置已加密保存；启用后新的 AI 管理摘要将优先使用该模型"
        );
        setExternalAiApiConfigurationForm(current => ({
          ...current,
          apiKey: "",
        }));
        setExternalAiApiValidation(null);
        await Promise.all([
          externalAiConfiguration.refetch(),
          settings.refetch(),
          audits.refetch(),
        ]);
      },
      onError: error => {
        setExternalAiApiValidation(error.message);
        toast.error(getUserFacingErrorMessage(error));
      },
    });
  const saveAliyunOssPhotoStorageConfiguration =
    trpc.admin.settings.saveAliyunOssPhotoStorageConfiguration.useMutation({
      onSuccess: async result => {
        toast.success(result.message);
        setAliyunOssPhotoStorageForm(current => ({
          ...current,
          accessKeyId: "",
          accessKeySecret: "",
        }));
        setAliyunOssPhotoStorageValidation(null);
        await Promise.all([
          aliyunOssPhotoStorageConfiguration.refetch(),
          settings.refetch(),
          audits.refetch(),
        ]);
      },
      onError: error => toast.error(getUserFacingErrorMessage(error)),
    });
  const testAliyunOssPhotoStorageConnection =
    trpc.admin.settings.testAliyunOssPhotoStorageConnection.useMutation({
      onSuccess: async result => {
        setAliyunOssPhotoStorageValidation(result);
        if (result.success) toast.success("OSS 只读连接校验通过");
        else toast.error(result.message);
        await audits.refetch();
      },
      onError: error => {
        setAliyunOssPhotoStorageValidation({
          success: false,
          code: "request_failed",
          message: error.message,
        });
        toast.error(getUserFacingErrorMessage(error));
      },
    });
  const testExternalAiConfiguration =
    trpc.admin.settings.testExternalAiConfiguration.useMutation({
      onSuccess: async result => {
        setExternalAiApiValidation(result.message);
        toast.success("外部 AI API 连接校验通过");
        await audits.refetch();
      },
      onError: error => {
        setExternalAiApiValidation(error.message);
        toast.error(getUserFacingErrorMessage(error));
      },
    });
  const saveEvidenceWatermarkTemplate =
    trpc.admin.settings.saveEvidenceWatermarkTemplate.useMutation({
      onSuccess: async result => {
        toast.success(
          `工程水印模板已发布为 v${result.version}，后续现场取证将使用新样式`
        );
        await Promise.all([
          evidenceWatermarkTemplate.refetch(),
          settings.refetch(),
          audits.refetch(),
        ]);
      },
      onError: error => toast.error(getUserFacingErrorMessage(error)),
    });
  const setSupervisorReviewAutoApprove =
    trpc.admin.settings.setSupervisorReviewAutoApprove.useMutation({
      onSuccess: async result => {
        toast.success(
          result.enabled
            ? "已开启：上级主管审核节点将自动通过"
            : "已关闭：后续上级主管审核需人工办理"
        );
        await Promise.all([settings.refetch(), audits.refetch()]);
      },
      onError: error => toast.error(getUserFacingErrorMessage(error)),
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
      result.success
        ? toast.success(result.message)
        : toast.error(result.message);
      await audits.refetch();
    },
  });
  const checkOfficialTemplateCapability =
    trpc.admin.settings.checkOfficialAccountTemplateCapability.useMutation({
      onSuccess: async result => {
        result.success
          ? toast.success(result.message)
          : toast.error(result.message);
        await audits.refetch();
      },
      onError: error => toast.error(getUserFacingErrorMessage(error)),
    });
  const [officialTemplateOptions, setOfficialTemplateOptions] = useState<
    Array<{
      templateId: string;
      title: string;
      content: string;
      fieldMapping: Record<string, string>;
      persistentBusinessEligible?: boolean;
      eligibilityMessage?: string;
    }>
  >([]);
  const listOfficialTemplates =
    trpc.admin.settings.listOfficialAccountTemplates.useMutation({
      onSuccess: result => {
        setOfficialTemplateOptions(result.templates);
        result.success
          ? toast.success(result.message)
          : toast.error(result.message);
      },
      onError: error => toast.error(getUserFacingErrorMessage(error)),
    });
  const createOfficialTemplateDraft =
    trpc.admin.settings.createOfficialAccountTemplateDraft.useMutation({
      onSuccess: async result => {
        toast.success(result.message);
        setOfficialTemplateOptions([]);
        await Promise.all([settings.refetch(), audits.refetch()]);
      },
      onError: error => toast.error(getUserFacingErrorMessage(error)),
    });
  const [officialTemplateModuleById, setOfficialTemplateModuleById] = useState<
    Record<
      string,
      | "purchasing"
      | "measurement"
      | "finance"
      | "machinery"
      | "transport"
      | "security"
      | "labor"
      | "construction"
    >
  >({});
  const bindOfficialModuleTemplate =
    trpc.admin.settings.bindOfficialAccountModuleTemplate.useMutation({
      onSuccess: async result => {
        toast.success(result.message);
        await Promise.all([
          officialTemplateCoverage.refetch(),
          settings.refetch(),
          audits.refetch(),
        ]);
      },
      onError: error => toast.error(getUserFacingErrorMessage(error)),
    });
  const saveDailyDigest = trpc.dailyDigest.saveSettings.useMutation({
    onSuccess: async data => {
      toast.success(
        data.taskUid
          ? "每日项目汇总已保存，定时任务已同步"
          : "每日项目汇总设置已保存"
      );
      await Promise.all([dailyDigestSettings.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const runDailyDigestNow = trpc.dailyDigest.runNow.useMutation({
    onSuccess: async result => {
      toast.success(
        `每日汇总已执行：${result.projectCount} 个项目，成功/幂等投递 ${result.deliveredCount} 次，失败 ${result.failedCount} 次`
      );
      await Promise.all([dailyDigestSettings.refetch(), audits.refetch()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const disableSetting = trpc.admin.settings.disable.useMutation({
    onSuccess: async result => {
      toast.success(`配置已停用并记录为 v${result.version}`);
      await Promise.all([
        settings.refetch(),
        settingHistory.refetch(),
        audits.refetch(),
      ]);
    },
    onError: refreshAfterSettingConflict,
  });
  const removeSetting = trpc.admin.settings.remove.useMutation({
    onSuccess: async () => {
      toast.success("配置已删除，配置值与历史快照中的可恢复内容已清除");
      setSettingDeleteTarget(null);
      setSettingForm(current => (current.id ? EMPTY_SETTING_FORM : current));
      setSelectedSettingId(undefined);
      await Promise.all([
        settings.refetch(),
        settingHistory.refetch(),
        overview.refetch(),
        audits.refetch(),
      ]);
    },
    onError: refreshAfterSettingConflict,
  });
  const removeMasterData = trpc.admin.masterData.remove.useMutation({
    onSuccess: async result => {
      const target = masterDataDeleteTarget;
      toast.success(
        result.operation === "revoked"
          ? "角色授权已撤销并保留可追溯历史"
          : `${target?.label ?? "主数据"}已安全删除`
      );
      setMasterDataDeleteTarget(null);
      if (target?.resource === "organization")
        setOrganizationForm(EMPTY_ORGANIZATION_FORM);
      if (target?.resource === "position") setPositionForm(EMPTY_POSITION_FORM);
      if (target?.resource === "project") setProjectForm(EMPTY_PROJECT_FORM);
      if (target?.resource === "vehicle") {
        setVehicleForm(EMPTY_VEHICLE_FORM);
        setVehicleEditorOpen(false);
      }
      if (target?.resource === "role") setRoleForm(EMPTY_ROLE_FORM);
      await Promise.all([
        organizations.refetch(),
        positions.refetch(),
        projects.refetch(),
        vehicles.refetch(),
        roles.refetch(),
        assignments.refetch(),
        departmentScopes.refetch(),
        overview.refetch(),
        audits.refetch(),
      ]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  /**
   * 批量删除不使用数据库批量 SQL：逐条调用既有受控删除接口，让每一条均经过关联检查、权限判断与审计。
   * 任一车辆仍被运输趟次引用时只会返回该条失败，不影响其他无关联车辆的安全删除。
   */
  const batchRemoveVehicles = async (rows: LedgerTableRow[]) => {
    if (!rows.length) return;
    if (
      !window.confirm(
        `确认删除选中的 ${rows.length} 辆车辆吗？系统将逐条核验运输趟次、项目范围和关联关系；有关联的车辆不会被删除。`
      )
    )
      return;
    const outcomes = await Promise.allSettled(
      rows.map(row =>
        removeMasterData.mutateAsync({
          resource: "vehicle",
          id: Number(row.id),
        })
      )
    );
    const succeeded = outcomes.filter(
      result => result.status === "fulfilled"
    ).length;
    const failed = outcomes.length - succeeded;
    setDesktopRecordDetail({
      title: "车辆批量受控删除结果",
      description:
        "每一条均已在服务端独立执行权限、项目范围、运输趟次关联和审计校验；失败记录未被修改。",
      fields: rows.map((row, index) => ({
        label: `车辆 #${row.id}`,
        value:
          outcomes[index].status === "fulfilled"
            ? "已安全删除"
            : `未删除：${outcomes[index].reason instanceof Error ? outcomes[index].reason.message : "关联或权限校验未通过"}`,
      })),
    });
    if (succeeded)
      toast.success(
        `已安全删除 ${succeeded} 辆无关联车辆${failed ? `；${failed} 辆因有关联或权限限制未删除` : ""}`
      );
    else
      toast.error("没有车辆可被删除；请检查运输趟次关联、项目范围或账号权限");
  };
  /** 历史机械成本、租赁与维修责任链不可删除；批量动作只将可访问机械受控变更为“已退役”。 */
  const batchRetireMachines = async (rows: LedgerTableRow[]) => {
    if (!rows.length) return;
    if (
      !window.confirm(
        `确认将选中的 ${rows.length} 台机械批量标记为“已退役”吗？此操作不会删除成本、租赁和维修历史；每台机械仍须单独通过项目范围与租赁契约校验。`
      )
    )
      return;
    const machineById = new Map(
      (machineryLedger.data ?? []).map(machine => [machine.id, machine])
    );
    const outcomes = await Promise.allSettled(
      rows.map(row => {
        const machine = machineById.get(Number(row.id));
        if (!machine || !machine.projectId)
          return Promise.reject(
            new Error("机械台账缺少有效项目归属或已刷新，请重新选择")
          );
        return saveMachine.mutateAsync({
          id: machine.id,
          projectId: machine.projectId,
          operatorUserId: machine.operatorUserId ?? null,
          code: machine.code,
          name: machine.name,
          model: machine.model ?? null,
          ownership: machine.ownership,
          supplierName: machine.supplierName ?? null,
          plateOrAssetNo: machine.plateOrAssetNo ?? null,
          status: "retired",
          leaseTerms:
            machine.ownership === "leased" && machine.leaseTerms
              ? {
                  billingType: machine.leaseTerms.billingType,
                  rate: Number(machine.leaseTerms.rate),
                  effectiveFrom: toBusinessDateInput(
                    machine.leaseTerms.effectiveFrom
                  ),
                  effectiveTo: machine.leaseTerms.effectiveTo
                    ? toBusinessDateInput(machine.leaseTerms.effectiveTo)
                    : null,
                }
              : null,
        });
      })
    );
    const succeeded = outcomes.filter(
      result => result.status === "fulfilled"
    ).length;
    const failed = outcomes.length - succeeded;
    setDesktopRecordDetail({
      title: "机械批量退役结果",
      description:
        "机械记录及其成本、租赁、维修历史均被保留；每条退役动作已由服务端独立校验并审计。",
      fields: rows.map((row, index) => ({
        label: `机械 #${row.id}`,
        value:
          outcomes[index].status === "fulfilled"
            ? "已标记为退役"
            : `未处理：${outcomes[index].reason instanceof Error ? outcomes[index].reason.message : "项目范围或租赁契约校验未通过"}`,
      })),
    });
    if (succeeded)
      toast.success(
        `已将 ${succeeded} 台机械标记为退役${failed ? `；${failed} 台未处理` : ""}`
      );
    else toast.error("没有机械可退役；请检查当前项目范围、租赁状态或账号权限");
  };
  /** 员工工资、考勤、保险和授权均具有审计价值；批量动作只停用档案，不删除任何历史责任链。 */
  const batchSuspendEmployees = async (rows: LedgerTableRow[]) => {
    if (!rows.length) return;
    if (
      !window.confirm(
        `确认停用选中的 ${rows.length} 份员工档案吗？系统将保留工资、考勤、保险和授权历史，并逐条记录审计。`
      )
    )
      return;
    const profileById = new Map(
      (employeeProfiles.data ?? []).map(profile => [profile.id, profile])
    );
    const outcomes = await Promise.allSettled(
      rows.map(row => {
        const profile = profileById.get(Number(row.id));
        if (!profile)
          return Promise.reject(new Error("员工档案已刷新，请重新选择"));
        return saveEmployeeProfile.mutateAsync({
          id: profile.id,
          userId: profile.userId ?? null,
          laborWorkerId: profile.laborWorkerId ?? null,
          projectId: profile.projectId ?? null,
          employeeType: profile.employeeType,
          teamName: profile.teamName ?? null,
          employmentStatus: "suspended",
          joinedAt: profile.joinedAt
            ? toBusinessDateInput(profile.joinedAt)
            : null,
          leftAt: profile.leftAt ? toBusinessDateInput(profile.leftAt) : null,
          salaryBasis: profile.salaryBasis,
          baseSalary:
            profile.baseSalary === null ? null : Number(profile.baseSalary),
          remarks: profile.remarks ?? null,
        });
      })
    );
    const succeeded = outcomes.filter(
      result => result.status === "fulfilled"
    ).length;
    const failed = outcomes.length - succeeded;
    setDesktopRecordDetail({
      title: "员工批量停用结果",
      description:
        "员工档案、工资、考勤、保险和授权历史均被保留；每一条停用操作均单独由服务端校验并审计。",
      fields: rows.map((row, index) => ({
        label: `员工档案 #${row.id}`,
        value:
          outcomes[index].status === "fulfilled"
            ? "已停用"
            : `未处理：${outcomes[index].reason instanceof Error ? outcomes[index].reason.message : "人员关联或权限校验未通过"}`,
      })),
    });
    if (succeeded)
      toast.success(
        `已停用 ${succeeded} 份员工档案${failed ? `；${failed} 份未处理` : ""}`
      );
    else toast.error("没有员工档案可停用；请检查当前账号权限或档案状态");
  };
  const rollbackSetting = trpc.admin.settings.rollback.useMutation({
    onSuccess: async result => {
      toast.success(`配置已回滚并发布为 v${result.version}`);
      await Promise.all([
        settings.refetch(),
        settingHistory.refetch(),
        audits.refetch(),
      ]);
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
    onError: error => toast.error(getUserFacingErrorMessage(error)),
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
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const createFullDatabaseBackup = trpc.admin.backup.createFull.useMutation({
    onSuccess: async backup => {
      toast.success(
        `完整数据库备份已完成：${backup.tableCount} 张表已逐表校验`
      );
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
    onSettled: async () => {
      await Promise.all([
        fullDatabaseBackup.refetch(),
        fullDatabaseBackupHistory.refetch(),
        audits.refetch(),
      ]);
    },
  });
  const confirmFullDatabaseBackupDownload = async () => {
    if (!fullBackupDownloadTarget) return;
    const anchor = document.createElement("a");
    anchor.href = `/api/admin/backups/full/${encodeURIComponent(fullBackupDownloadTarget.backupId)}/download`;
    // 服务端会重验会话、超级管理员身份、清单、大小与 SHA-256；文件名不含数据库名或服务器路径。
    anchor.download = "yx-full-database-backup.sql.gz";
    anchor.rel = "noopener noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setFullBackupDownloadTarget(null);
    toast.success("已开始下载已验证的完整数据库备份，下载行为已记录审计");
    await audits.refetch();
  };
  const transitionConstructionReport =
    trpc.construction.transitionReport.useMutation({
      onSuccess: async () => {
        toast.success("施工日报状态已更新");
        await Promise.all([
          trpcUtils.construction.listReports.invalidate(),
          trpcUtils.construction.summary.invalidate(),
          trpcUtils.mobile.workbench.invalidate(),
        ]);
      },
      onError: error => toast.error(getUserFacingErrorMessage(error)),
    });
  const saveConstructionReport = trpc.construction.saveReport.useMutation({
    onSuccess: async result => {
      toast.success(
        result.created ? "施工日报已在 PC 后台保存" : "施工日报已在 PC 后台更新"
      );
      setConstructionReportEditor(null);
      setConstructionEditorSnapshot("");
      await Promise.all([
        trpcUtils.construction.listReports.invalidate(),
        trpcUtils.construction.summary.invalidate(),
        trpcUtils.construction.reportSubmitterOptions.invalidate(),
        trpcUtils.mobile.workbench.invalidate(),
      ]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const submitPayroll = trpc.labor.payroll.submit.useMutation({
    onSuccess: async () => {
      toast.success("工资条已提交会计审核");
      await trpcUtils.labor.payroll.list.invalidate();
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const approvePayroll = trpc.labor.payroll.approve.useMutation({
    onSuccess: async () => {
      toast.success("工资条审核状态已更新");
      await trpcUtils.labor.payroll.list.invalidate();
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const submitDailyWage = trpc.labor.dailyWage.submit.useMutation({
    onSuccess: async () => {
      toast.success("临时日结已提交会计/财务审核");
      await trpcUtils.labor.dailyWage.list.invalidate();
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const reviewDailyWage = trpc.labor.dailyWage.review.useMutation({
    onSuccess: async result => {
      toast.success(
        result.status === "approved"
          ? "临时日结已审核通过，待登记付款"
          : "临时日结已退回草稿，可修改后重新提交"
      );
      await trpcUtils.labor.dailyWage.list.invalidate();
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const transitionMachineCost = trpc.machinery.transitionCost.useMutation({
    onSuccess: async () => {
      await Promise.all([
        trpcUtils.machinery.listDailyOperations.invalidate(),
        trpcUtils.machinery.printSummary.invalidate(),
      ]);
      toast.success("机械成本状态已更新");
      await Promise.all([
        trpcUtils.machinery.listCosts.invalidate(),
        trpcUtils.machinery.listCostSummaries.invalidate(),
      ]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });
  const transitionTransportTrip = trpc.transport.transitionTrip.useMutation({
    onSuccess: async () => {
      toast.success("运输趟次状态已更新");
      await transportTrips.refetch();
    },
    onError: error => toast.error(getUserFacingErrorMessage(error)),
  });

  const permissionModuleLabels: Record<string, string> = {
    admin: "后台治理",
    mobile: "移动工作台",
    construction: "施工日报",
    labor: "劳务与工资",
    machinery: "机械资源",
    transport: "运输调度",
    purchase: "采购仓储",
    measurement: "工程计量",
    finance: "财务成本",
    diesel: "柴油管理",
    evidence: "影像取证",
    message: "消息中心",
  };
  const permissionActionLabels: Record<string, string> = {
    read: "查看",
    create: "新增",
    edit: "编辑",
    submit: "提交",
    review: "审核",
    settle: "结算/发放",
    void: "作废/归档",
    export: "导出",
    print: "打印",
    manage: "全量办理",
    publish: "发布",
    rollback: "回滚",
    test: "测试",
  };
  // 按功能模块分组展示权限，避免管理员在长列表中难以辨识业务归属。
  const permissionGroups = useMemo(() => {
    const grouped: Record<
      string,
      Array<NonNullable<typeof permissions.data>[number]>
    > = {};
    for (const permission of permissions.data ?? []) {
      (grouped[permission.module] ??= []).push(permission);
    }
    return Object.entries(grouped);
  }, [permissions.data]);
  const departmentNodes = useMemo(
    () =>
      (organizations.data ?? []).filter(
        item => item.type === "department" || item.type === "project_department"
      ),
    [organizations.data]
  );
  const departmentScopeProjects = useMemo(
    () =>
      (projects.data ?? []).filter(project => project.status !== "archived"),
    [projects.data]
  );
  const departmentScopePickerState = getDepartmentScopePickerState(
    organizations.isLoading || projects.isLoading,
    departmentNodes.length,
    departmentScopeProjects.length
  );
  const organizationNameById = useMemo(
    () => new Map((organizations.data ?? []).map(item => [item.id, item.name])),
    [organizations.data]
  );
  const userNameById = useMemo(
    () =>
      new Map(
        (users.data ?? []).map(user => [
          user.id,
          user.name || `用户 #${user.id}`,
        ])
      ),
    [users.data]
  );
  const dieselDuplicateCandidates = useMemo(() => {
    if (
      !dieselRefuelDialogOpen ||
      dieselRefuelForm.id ||
      !dieselRefuelForm.projectId ||
      !dieselRefuelForm.refueledAt
    )
      return [];
    const selectedAssetId =
      dieselRefuelForm.assetType === "vehicle"
        ? dieselRefuelForm.vehicleId
        : dieselRefuelForm.machineId;
    if (!selectedAssetId) return [];
    const refueledDate = dieselRefuelForm.refueledAt.slice(0, 10);
    const refueledAtMs = new Date(dieselRefuelForm.refueledAt).getTime();
    const liters = Number(dieselRefuelForm.liters || 0);
    const receiptNo = dieselRefuelForm.receiptNo.trim();
    const supplierName = dieselRefuelForm.stationOrSupplierName.trim();
    return (dieselRefuelRecords.data ?? [])
      .filter(record => {
        if (
          record.status === "void" ||
          String(record.projectId) !== dieselRefuelForm.projectId ||
          record.assetType !== dieselRefuelForm.assetType
        )
          return false;
        const recordAssetId =
          record.assetType === "vehicle" ? record.vehicleId : record.machineId;
        if (String(recordAssetId ?? "") !== selectedAssetId) return false;
        const recordDate = toChinaDateInput(record.refueledAt);
        if (recordDate !== refueledDate) return false;
        if (receiptNo && record.receiptNo === receiptNo) return true;
        const recordTimeMs = new Date(record.refueledAt).getTime();
        const withinTwoHours =
          Number.isFinite(recordTimeMs) &&
          Number.isFinite(refueledAtMs) &&
          Math.abs(recordTimeMs - refueledAtMs) <= 2 * 60 * 60 * 1000;
        const sameLiters =
          liters > 0 && Math.abs(Number(record.liters) - liters) < 0.001;
        const sameSupplier =
          supplierName && (record.stationOrSupplierName ?? "") === supplierName;
        return (
          withinTwoHours ||
          (sameLiters &&
            (dieselRefuelForm.supplyMethod === "project_supply" ||
              sameSupplier))
        );
      })
      .slice(0, 3);
  }, [dieselRefuelDialogOpen, dieselRefuelForm, dieselRefuelRecords.data]);
  const selectedAssignmentRole = useMemo(
    () => roles.data?.find(role => role.id === Number(assignmentForm.roleId)),
    [assignmentForm.roleId, roles.data]
  );
  const selectedAssignmentTemplate = useMemo(
    () =>
      roleTemplates.data?.find(
        template => template.roleId === Number(assignmentForm.roleId)
      ) ?? null,
    [assignmentForm.roleId, roleTemplates.data]
  );
  const groupedRoleTemplates = useMemo(() => {
    const grouped: Record<string, NonNullable<typeof roleTemplates.data>> = {};
    for (const template of roleTemplates.data ?? []) {
      if (template.code === "SUPER_ADMIN") continue;
      (grouped[template.group] ??= []).push(template);
    }
    return Object.entries(grouped);
  }, [roleTemplates.data]);
  const assignmentRequiresBusinessScope = Boolean(
    selectedAssignmentRole && selectedAssignmentRole.code !== "SUPER_ADMIN"
  );
  const assignmentHasScope = Boolean(
    assignmentForm.organizationId || assignmentForm.projectId
  );
  const assignmentReady = Boolean(
    assignmentForm.userId &&
      selectedAssignmentRole &&
      (!assignmentRequiresBusinessScope || assignmentHasScope)
  );
  const normalizedAssignmentScope = getAssignmentScopeSaveInput(assignmentForm);
  const localManagerUsers = useMemo(
    () =>
      (users.data ?? []).filter(user => user.loginMethod === "local_manager"),
    [users.data]
  );
  const filteredLocalManagerUsers = useMemo(() => {
    const keyword = personnelSearch.trim().toLowerCase();
    if (!keyword) return localManagerUsers;
    return localManagerUsers.filter(user =>
      `${user.name ?? ""} ${user.localUsername ?? ""}`
        .toLowerCase()
        .includes(keyword)
    );
  }, [localManagerUsers, personnelSearch]);
  const filteredAssignments = useMemo(() => {
    const keyword = assignmentSearch.trim().toLowerCase();
    const rows = assignments.data ?? [];
    if (!keyword) return rows;
    return rows.filter(item =>
      `${item.userName ?? ""} ${item.localUsername ?? ""} ${item.roleName} ${item.roleCode} ${item.organizationName ?? ""} ${item.projectName ?? ""}`
        .toLowerCase()
        .includes(keyword)
    );
  }, [assignmentSearch, assignments.data]);
  const activeAssignmentCount = useMemo(
    () =>
      (assignments.data ?? []).filter(
        item => getAssignmentLifecycle(item).label === "有效"
      ).length,
    [assignments.data]
  );

  const renderOverview = () => (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-[#203c48]">
          统一管理入口 · 全局治理
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
          系统治理概览
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          此处仅展示配置与治理对象，施工生产数据在移动业务工作台按岗位办理。
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="组织节点"
          value={overview.data?.organizations}
          description="部门、班组与成本中心"
          icon={Building2}
        />
        <MetricCard
          title="项目层级"
          value={overview.data?.projects}
          description="项目、标段、工区与作业面"
          icon={FolderKanban}
        />
        <MetricCard
          title="角色数量"
          value={overview.data?.roles}
          description="可分配的后台和业务角色"
          icon={ShieldCheck}
        />
        <MetricCard
          title="配置项"
          value={overview.data?.settings}
          description="接口、密钥与业务参数"
          icon={KeyRound}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">上线前治理清单</CardTitle>
          <CardDescription>
            按以下顺序完成基础配置，避免业务账号、项目范围和外部接口出现无主状态。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-slate-600 md:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-4">
            <b className="text-slate-800">01 组织与项目</b>
            <p className="mt-1 text-xs leading-5">
              建立公司、部门、项目、标段和成本中心。
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <b className="text-slate-800">02 人员与角色</b>
            <p className="mt-1 text-xs leading-5">
              设置岗位、角色、项目数据范围和有效期。
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <b className="text-slate-800">03 系统设置</b>
            <p className="mt-1 text-xs leading-5">
              配置微信公众号服务号及外部 API，校验后发布。
            </p>
          </div>
        </CardContent>
      </Card>
      <Card className="border-[#d8e3e0]">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">真实项目数据验收预检</CardTitle>
            <CardDescription>
              仅统计授权与业务记录数量，不读取或展示人员、考勤、工资明细；不会创建任何模拟数据。
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => realDataReadiness.refetch()}
            disabled={realDataReadiness.isFetching}
          >
            刷新预检
          </Button>
        </CardHeader>
        <CardContent>
          {realDataReadiness.isLoading ? (
            <EmptyState text="正在读取真实数据验收准备度…" />
          ) : realDataReadiness.isError ? (
            <EmptyState text="暂无法读取验收预检，请确认当前账号具有超级管理员权限并稍后重试。" />
          ) : realDataReadiness.data ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {realDataReadiness.data.ready
                      ? "已具备完整复测前提"
                      : "尚未具备完整复测前提"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    真实项目验收应使用已授权账号和可追溯业务记录完成，不能以模拟数据替代。
                  </p>
                </div>
                <Badge
                  variant={
                    realDataReadiness.data.ready ? "secondary" : "outline"
                  }
                >
                  {realDataReadiness.data.ready
                    ? "可安排复测"
                    : "待补齐真实数据"}
                </Badge>
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {realDataReadiness.data.checks.map(check => (
                  <div
                    key={check.key}
                    className={`rounded-lg border p-3 ${check.ready ? "border-emerald-100 bg-emerald-50/40" : "border-amber-100 bg-amber-50/40"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-800">
                        {check.label}
                      </p>
                      <Badge variant={check.ready ? "secondary" : "outline"}>
                        {check.ready ? "已就绪" : "待补齐"}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-xs leading-5 text-slate-500">
                      {check.detail}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className="text-xs text-slate-500">
                        责任：{check.ownerRole}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => setLocation(check.actionPath)}
                      >
                        {check.actionLabel}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              {realDataReadiness.data.findings.length ? (
                <div className="rounded-xl border border-rose-100 bg-rose-50/30 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-rose-950">
                        跨模块经营异常与现场闭环提醒
                      </p>
                      <p className="mt-1 text-xs text-rose-800">
                        仅依据真实业务聚合数据识别断链；AI
                        和系统提示不替代人工复核、审批或财务确认。
                      </p>
                    </div>
                    <Badge variant="outline">
                      {realDataReadiness.data.findings.length} 项待处置
                    </Badge>
                  </div>
                  <div className="grid gap-2 lg:grid-cols-2">
                    {realDataReadiness.data.findings.map(item => (
                      <div
                        key={item.id}
                        className={`rounded-lg border p-3 ${item.severity === "critical" ? "border-rose-200 bg-white" : "border-amber-200 bg-amber-50/40"}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-slate-800">
                            {item.title}
                          </p>
                          <Badge variant="outline">
                            {item.severity === "critical" ? "重要" : "提示"}
                          </Badge>
                        </div>
                        <p className="mt-1.5 text-xs leading-5 text-slate-600">
                          {item.summary}
                        </p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <p className="text-xs text-slate-500">
                            责任：{item.ownerRole}
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => setLocation(item.actionPath)}
                          >
                            {item.actionLabel}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyState text="暂无预检结果，请刷新后重试。" />
          )}
        </CardContent>
      </Card>
      <Card className="border-[#d8e3e0] shadow-sm">
        <CardHeader>
          <p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">
            项目经理驾驶舱 · 作业节奏
          </p>
          <CardTitle className="mt-1 text-base">
            施工项目经营 KPI 作业指引
          </CardTitle>
          <CardDescription>
            指标只用于组织真实业务录入、审核与复核；业务暂估、未审核成本或未确认收入必须与财务确认口径分开查看。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[
            {
              name: "施工日报有效率",
              cadence: "每日",
              owner: "项目生产经理",
              source: "日报、工程部位、影像、资源消耗",
              path: "/admin/construction",
              action: "检查施工日报",
            },
            {
              name: "资源成本归集",
              cadence: "每周",
              owner: "机务 / 运输负责人",
              source: "机械台班、柴油领用、运输趟次",
              path: "/admin/diesel",
              action: "核对资源消耗",
            },
            {
              name: "采购实耗闭环",
              cadence: "每周",
              owner: "物资负责人",
              source: "采购订单、验收、入库、领用、退库",
              path: "/admin/purchasing",
              action: "处理采购库存",
            },
            {
              name: "计量与分包对账",
              cadence: "每周",
              owner: "商务合约负责人",
              source: "收方、工程计量、分包包件、合同清单",
              path: "/admin/settlement",
              action: "录入收方计量",
            },
            {
              name: "财务确认与资金计划",
              cadence: "每周 / 月",
              owner: "财务负责人",
              source: "应收应付、资金流水、已审核业务单据",
              path: "/admin/finance",
              action: "进入财务确认",
            },
            {
              name: "服务号通知送达率",
              cadence: "每日",
              owner: "数字化运维负责人",
              source: "真实模板、员工绑定、投递回执与失败码",
              path: "/admin/settings",
              action: "检查模板投递",
            },
          ].map(item => (
            <div
              key={item.name}
              className="rounded-xl border border-[#d8e3e0] bg-[#f8fbfa] p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[#203c48]">
                  {item.name}
                </p>
                <Badge variant="outline">{item.cadence}</Badge>
              </div>
              <p className="mt-2 text-xs text-slate-500">责任：{item.owner}</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                数据源：{item.source}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 h-7 px-2 text-xs"
                onClick={() => setLocation(item.path)}
              >
                {item.action}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );

  const renderOrganization = () => {
    const submitOrganization = () => {
      if (!organizationForm.code.trim() || !organizationForm.name.trim())
        return toast.error("请填写组织编码和组织名称");
      saveOrganization.mutate({
        id: organizationForm.id,
        parentId: organizationForm.parentId
          ? Number(organizationForm.parentId)
          : null,
        code: organizationForm.code.trim(),
        name: organizationForm.name.trim(),
        type: organizationForm.type,
        managerUserId: organizationForm.managerUserId
          ? Number(organizationForm.managerUserId)
          : null,
        costCenterCode: organizationForm.costCenterCode.trim() || null,
        sortOrder: Number(organizationForm.sortOrder || 0),
        status: organizationForm.status,
      });
    };
    const submitProject = () => {
      if (
        !projectForm.code.trim() ||
        !projectForm.name.trim() ||
        !projectForm.nodeType.trim()
      )
        return toast.error("请填写项目编码、名称和层级名称");
      saveProject.mutate({
        id: projectForm.id,
        parentId: projectForm.parentId ? Number(projectForm.parentId) : null,
        organizationId: projectForm.organizationId
          ? Number(projectForm.organizationId)
          : null,
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
      if (
        !positionForm.code.trim() ||
        !positionForm.name.trim() ||
        !positionForm.category.trim()
      )
        return toast.error("请填写岗位编码、名称和分类");
      savePosition.mutate({
        id: positionForm.id,
        code: positionForm.code.trim(),
        name: positionForm.name.trim(),
        category: positionForm.category.trim(),
        description: positionForm.description.trim() || null,
        status: positionForm.status,
      });
    };
    const editableOrganizationOptions = (organizations.data ?? []).filter(
      item => item.id !== organizationForm.id
    );
    const editableProjectOptions = (projects.data ?? []).filter(
      item => item.id !== projectForm.id
    );

    return (
      <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
        <section className="space-y-6">
          <div>
            <p className="text-sm font-medium text-[#203c48]">基础主数据</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              组织、岗位与项目层级
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              统一维护管理部门、负责人、岗位、项目范围和状态；所有保存均由超级管理员鉴权并写入审计。
            </p>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">组织架构</CardTitle>
              <CardDescription>
                支持集团、公司、部门、项目部和班组层级。点击条目即可在右侧维护。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {organizations.data?.length ? (
                organizations.data.map(item => (
                  <button
                    key={item.id}
                    className="flex w-full items-center justify-between rounded-lg border border-slate-100 px-3 py-2.5 text-left transition-colors hover:border-[#b9ccc6] hover:bg-[#f7faf9]"
                    onClick={() =>
                      setOrganizationForm({
                        id: item.id,
                        parentId: item.parentId ? String(item.parentId) : "",
                        code: item.code,
                        name: item.name,
                        type: item.type,
                        managerUserId: item.managerUserId
                          ? String(item.managerUserId)
                          : "",
                        costCenterCode: item.costCenterCode ?? "",
                        sortOrder: String(item.sortOrder),
                        status: item.status,
                      })
                    }
                  >
                    <div>
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {item.code} · 上级：
                        {item.parentId
                          ? (organizationNameById.get(item.parentId) ??
                            `#${item.parentId}`)
                          : "顶级"}{" "}
                        · 负责人：
                        {item.managerUserId
                          ? (userNameById.get(item.managerUserId) ??
                            `#${item.managerUserId}`)
                          : "未设置"}{" "}
                        · 成本中心：{item.costCenterCode || "未设置"}
                      </p>
                    </div>
                    <Badge
                      variant={
                        item.status === "active" ? "secondary" : "outline"
                      }
                    >
                      {item.status === "active" ? "启用" : "停用"}
                    </Badge>
                  </button>
                ))
              ) : (
                <EmptyState text="暂无组织节点，请在右侧新增后开始维护。" />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">岗位字典</CardTitle>
              <CardDescription>
                岗位用于人员档案与职责管理，不直接替代角色权限。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {positions.data?.length ? (
                positions.data.map(item => (
                  <button
                    key={item.id}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-sm transition-colors hover:border-[#b9ccc6] hover:bg-[#f7faf9]"
                    onClick={() =>
                      setPositionForm({
                        id: item.id,
                        code: item.code,
                        name: item.name,
                        category: item.category,
                        description: item.description ?? "",
                        status: item.status,
                      })
                    }
                  >
                    {item.name}
                    <span className="ml-1 text-xs text-slate-400">
                      {item.category} ·{" "}
                      {item.status === "active" ? "启用" : "停用"}
                    </span>
                  </button>
                ))
              ) : (
                <EmptyState text="暂无自定义岗位；请在右侧新增后再为人员分配。" />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">项目层级</CardTitle>
              <CardDescription>
                推荐“项目 → 标段/工区 → 单位工程 →
                施工段/作业面”；点击条目可维护归属、计划日期和状态。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {projects.data?.length ? (
                projects.data.map(item => (
                  <button
                    key={item.id}
                    className="w-full rounded-lg border border-slate-100 px-3 py-2.5 text-left transition-colors hover:border-[#b9ccc6] hover:bg-[#f7faf9]"
                    onClick={() =>
                      setProjectForm({
                        id: item.id,
                        parentId: item.parentId ? String(item.parentId) : "",
                        organizationId: item.organizationId
                          ? String(item.organizationId)
                          : "",
                        code: item.code,
                        name: item.name,
                        nodeType: item.nodeType,
                        projectType: item.projectType ?? "other",
                        status: item.status,
                        startDate: item.startDate
                          ? toDeviceDateInput(item.startDate)
                          : "",
                        endDate: item.endDate
                          ? toDeviceDateInput(item.endDate)
                          : "",
                        costCenterCode: item.costCenterCode ?? "",
                        sortOrder: String(item.sortOrder),
                      })
                    }
                  >
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {item.code} · {item.nodeType} · 上级：
                      {item.parentId
                        ? (projects.data?.find(
                            project => project.id === item.parentId
                          )?.name ?? `#${item.parentId}`)
                        : "顶级"}{" "}
                      · {getBusinessStatusLabel(item.status)}
                    </p>
                  </button>
                ))
              ) : (
                <EmptyState text="暂无项目层级，请在右侧新增项目或项目节点。" />
              )}
            </CardContent>
          </Card>
        </section>
        <aside className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">
                {organizationForm.id ? "维护组织节点" : "新增组织节点"}
              </CardTitle>
              {organizationForm.id ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setOrganizationForm(EMPTY_ORGANIZATION_FORM)}
                >
                  新建
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>组织编码</Label>
                <Input
                  value={organizationForm.code}
                  placeholder="例如 DEPT_FIN"
                  onChange={event =>
                    setOrganizationForm({
                      ...organizationForm,
                      code: event.target.value.toUpperCase(),
                    })
                  }
                />
              </div>
              <div>
                <Label>组织名称</Label>
                <Input
                  value={organizationForm.name}
                  placeholder="例如 财务部"
                  onChange={event =>
                    setOrganizationForm({
                      ...organizationForm,
                      name: event.target.value,
                    })
                  }
                />
              </div>
              <div>
                <Label>上级组织</Label>
                <Select
                  value={organizationForm.parentId || "ROOT"}
                  onValueChange={value =>
                    setOrganizationForm({
                      ...organizationForm,
                      parentId: value === "ROOT" ? "" : value,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ROOT">顶级节点</SelectItem>
                    {editableOrganizationOptions.map(item => (
                      <SelectItem key={item.id} value={String(item.id)}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>节点类型</Label>
                <Select
                  value={organizationForm.type}
                  onValueChange={(value: OrganizationType) =>
                    setOrganizationForm({ ...organizationForm, type: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="group">集团</SelectItem>
                    <SelectItem value="company">公司</SelectItem>
                    <SelectItem value="department">部门</SelectItem>
                    <SelectItem value="project_department">项目部</SelectItem>
                    <SelectItem value="team">班组</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>组织负责人</Label>
                <Select
                  value={organizationForm.managerUserId || "UNASSIGNED"}
                  onValueChange={value =>
                    setOrganizationForm({
                      ...organizationForm,
                      managerUserId: value === "UNASSIGNED" ? "" : value,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UNASSIGNED">暂不设置</SelectItem>
                    {users.data?.map(user => (
                      <SelectItem key={user.id} value={String(user.id)}>
                        {user.name || `用户 #${user.id}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>成本中心</Label>
                  <Input
                    value={organizationForm.costCenterCode}
                    placeholder="可选"
                    onChange={event =>
                      setOrganizationForm({
                        ...organizationForm,
                        costCenterCode: event.target.value.toUpperCase(),
                      })
                    }
                  />
                </div>
                <div>
                  <Label>排序</Label>
                  <Input
                    type="number"
                    min="0"
                    value={organizationForm.sortOrder}
                    onChange={event =>
                      setOrganizationForm({
                        ...organizationForm,
                        sortOrder: event.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <div>
                <Label>状态</Label>
                <Select
                  value={organizationForm.status}
                  onValueChange={(value: OrganizationStatus) =>
                    setOrganizationForm({ ...organizationForm, status: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">启用</SelectItem>
                    <SelectItem value="disabled">停用</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  className="bg-[#203c48] hover:bg-[#17313b]"
                  disabled={
                    !organizationForm.code ||
                    !organizationForm.name ||
                    saveOrganization.isPending
                  }
                  onClick={submitOrganization}
                >
                  {organizationForm.id ? "保存组织变更" : "保存组织节点"}
                </Button>
                {organizationForm.id ? (
                  <Button
                    variant="outline"
                    className="border-rose-200 text-rose-700 hover:bg-rose-50"
                    onClick={() =>
                      setMasterDataDeleteTarget({
                        resource: "organization",
                        id: organizationForm.id!,
                        label: organizationForm.name,
                        description: `确认删除组织“${organizationForm.name}”？若仍被下级节点、人员、项目、车辆、授权或部门业务范围引用，系统将拒绝删除并要求先迁移或停用。`,
                      })
                    }
                  >
                    删除组织
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">
                {projectForm.id ? "维护项目节点" : "新增项目节点"}
              </CardTitle>
              {projectForm.id ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setProjectForm(EMPTY_PROJECT_FORM)}
                >
                  新建
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>项目编码</Label>
                <Input
                  value={projectForm.code}
                  placeholder="例如 GZ-GS-01"
                  onChange={event =>
                    setProjectForm({
                      ...projectForm,
                      code: event.target.value.toUpperCase(),
                    })
                  }
                />
              </div>
              <div>
                <Label>项目名称</Label>
                <Input
                  value={projectForm.name}
                  placeholder="例如 GZ 高速一标段"
                  onChange={event =>
                    setProjectForm({ ...projectForm, name: event.target.value })
                  }
                />
              </div>
              <div>
                <Label>上级项目</Label>
                <Select
                  value={projectForm.parentId || "ROOT"}
                  onValueChange={value =>
                    setProjectForm({
                      ...projectForm,
                      parentId: value === "ROOT" ? "" : value,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ROOT">顶级项目</SelectItem>
                    {editableProjectOptions.map(item => (
                      <SelectItem key={item.id} value={String(item.id)}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>归属组织</Label>
                <Select
                  value={projectForm.organizationId || "UNASSIGNED"}
                  onValueChange={value =>
                    setProjectForm({
                      ...projectForm,
                      organizationId: value === "UNASSIGNED" ? "" : value,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UNASSIGNED">暂不设置</SelectItem>
                    {organizations.data
                      ?.filter(item => item.status === "active")
                      .map(item => (
                        <SelectItem key={item.id} value={String(item.id)}>
                          {item.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>层级名称</Label>
                  <Input
                    value={projectForm.nodeType}
                    onChange={event =>
                      setProjectForm({
                        ...projectForm,
                        nodeType: event.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <Label>工程类型</Label>
                  <Select
                    value={projectForm.projectType}
                    onValueChange={(value: ProjectType) =>
                      setProjectForm({ ...projectForm, projectType: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="highway">公路</SelectItem>
                      <SelectItem value="railway">铁路</SelectItem>
                      <SelectItem value="municipal">市政</SelectItem>
                      <SelectItem value="other">其他</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>开始日期</Label>
                  <Input
                    type="date"
                    value={projectForm.startDate}
                    onChange={event =>
                      setProjectForm({
                        ...projectForm,
                        startDate: event.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <Label>结束日期</Label>
                  <Input
                    type="date"
                    value={projectForm.endDate}
                    onChange={event =>
                      setProjectForm({
                        ...projectForm,
                        endDate: event.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>成本中心</Label>
                  <Input
                    value={projectForm.costCenterCode}
                    placeholder="可选"
                    onChange={event =>
                      setProjectForm({
                        ...projectForm,
                        costCenterCode: event.target.value.toUpperCase(),
                      })
                    }
                  />
                </div>
                <div>
                  <Label>排序</Label>
                  <Input
                    type="number"
                    min="0"
                    value={projectForm.sortOrder}
                    onChange={event =>
                      setProjectForm({
                        ...projectForm,
                        sortOrder: event.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <div>
                <Label>状态</Label>
                <Select
                  value={projectForm.status}
                  onValueChange={(value: ProjectStatus) =>
                    setProjectForm({ ...projectForm, status: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="planning">筹备</SelectItem>
                    <SelectItem value="active">进行中</SelectItem>
                    <SelectItem value="suspended">暂停</SelectItem>
                    <SelectItem value="completed">已完工</SelectItem>
                    <SelectItem value="archived">已归档</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  className="bg-[#203c48] hover:bg-[#17313b]"
                  disabled={
                    !projectForm.code ||
                    !projectForm.name ||
                    !projectForm.nodeType ||
                    saveProject.isPending
                  }
                  onClick={submitProject}
                >
                  {projectForm.id ? "保存项目变更" : "保存项目节点"}
                </Button>
                {projectForm.id ? (
                  <Button
                    variant="outline"
                    className="border-rose-200 text-rose-700 hover:bg-rose-50"
                    onClick={() =>
                      setMasterDataDeleteTarget({
                        resource: "project",
                        id: projectForm.id!,
                        label: projectForm.name,
                        description: `确认删除项目节点“${projectForm.name}”？若仍有下级项目、授权、资源或业务单据，系统将拒绝删除并提示改为归档。`,
                      })
                    }
                  >
                    删除项目
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">
                {positionForm.id ? "维护岗位" : "新增岗位"}
              </CardTitle>
              {positionForm.id ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPositionForm(EMPTY_POSITION_FORM)}
                >
                  新建
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>岗位编码</Label>
                <Input
                  value={positionForm.code}
                  placeholder="例如 TRANSPORT_MANAGER"
                  onChange={event =>
                    setPositionForm({
                      ...positionForm,
                      code: event.target.value.toUpperCase(),
                    })
                  }
                />
              </div>
              <div>
                <Label>岗位名称</Label>
                <Input
                  value={positionForm.name}
                  placeholder="例如 运输主管"
                  onChange={event =>
                    setPositionForm({
                      ...positionForm,
                      name: event.target.value,
                    })
                  }
                />
              </div>
              <div>
                <Label>岗位分类</Label>
                <Input
                  value={positionForm.category}
                  placeholder="例如 业务岗位"
                  onChange={event =>
                    setPositionForm({
                      ...positionForm,
                      category: event.target.value,
                    })
                  }
                />
              </div>
              <div>
                <Label>职责说明</Label>
                <Input
                  value={positionForm.description}
                  placeholder="可选"
                  onChange={event =>
                    setPositionForm({
                      ...positionForm,
                      description: event.target.value,
                    })
                  }
                />
              </div>
              <div>
                <Label>状态</Label>
                <Select
                  value={positionForm.status}
                  onValueChange={(value: OrganizationStatus) =>
                    setPositionForm({ ...positionForm, status: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">启用</SelectItem>
                    <SelectItem value="disabled">停用</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  variant="outline"
                  disabled={
                    !positionForm.code ||
                    !positionForm.name ||
                    !positionForm.category ||
                    savePosition.isPending
                  }
                  onClick={submitPosition}
                >
                  {positionForm.id ? "保存岗位变更" : "保存岗位"}
                </Button>
                {positionForm.id ? (
                  <Button
                    variant="outline"
                    className="border-rose-200 text-rose-700 hover:bg-rose-50"
                    onClick={() =>
                      setMasterDataDeleteTarget({
                        resource: "position",
                        id: positionForm.id!,
                        label: positionForm.name,
                        description: `确认删除岗位“${positionForm.name}”？若仍被人员档案引用，系统将拒绝删除并提示改为停用。`,
                      })
                    }
                  >
                    删除岗位
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    );
  };

  const renderVehicles = () => (
    <Suspense
      fallback={
        <p className="rounded-xl bg-muted p-4 text-sm">正在加载车辆管理…</p>
      }
    >
      <VehicleManagementWorkspace
        projects={projects.data ?? []}
        organizations={organizations.data ?? []}
        createRequest={vehicleCreateRequest}
        onDirtyChange={onVehicleManagementDirtyChange}
      />
    </Suspense>
  );

  const renderPermissions = () => (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[#d8e3e0] bg-[linear-gradient(135deg,#f8fbfa,#ffffff)] p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">
              平台治理 · 权限管理
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
              人员、角色与数据范围
            </h1>
            <p className="mt-1.5 max-w-4xl text-sm leading-6 text-slate-600">
              日常操作按“账号 → 岗位模板 → 部门或项目范围 →
              有效期”完成。角色权限、部门菜单、项目范围和账号状态均由服务端同时校验，页面调整不会放宽现有权限边界。
            </p>
          </div>
          <div className="shrink-0 rounded-xl border border-[#cfe0da] bg-white px-3 py-2 text-xs leading-5 text-[#355c52]">
            <b>推荐流程：</b>
            先建账号，再授予岗位与范围；仅在需要例外时设置专属操作权限。
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
            <p className="text-xs text-slate-500">普通管理账号</p>
            <p className="mt-0.5 text-xl font-semibold text-slate-800">
              {localManagerUsers.length}
            </p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
            <p className="text-xs text-slate-500">账号已启用</p>
            <p className="mt-0.5 text-xl font-semibold text-emerald-700">
              {
                localManagerUsers.filter(
                  user => user.localAccountStatus === "active"
                ).length
              }
            </p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
            <p className="text-xs text-slate-500">当前有效授权</p>
            <p className="mt-0.5 text-xl font-semibold text-[#203c48]">
              {activeAssignmentCount}
            </p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
            <p className="text-xs text-slate-500">待关注绑定</p>
            <p className="mt-0.5 text-xl font-semibold text-amber-700">
              {
                localManagerUsers.filter(
                  user => user.officialAccountBindingStatus !== "active"
                ).length
              }
            </p>
          </div>
        </div>
      </section>

      <Tabs
        value={permissionWorkspaceTab}
        onValueChange={value =>
          setPermissionWorkspaceTab(value as PermissionWorkspaceTab)
        }
        className="gap-4"
      >
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl bg-[#edf4f1] p-1.5 lg:grid-cols-4">
          <TabsTrigger value="authorization" className="min-h-10 px-3 text-sm">
            人员授权
          </TabsTrigger>
          <TabsTrigger value="accounts" className="min-h-10 px-3 text-sm">
            账号与员工
          </TabsTrigger>
          <TabsTrigger value="roles" className="min-h-10 px-3 text-sm">
            角色与操作权限
          </TabsTrigger>
          <TabsTrigger value="department" className="min-h-10 px-3 text-sm">
            部门业务菜单
          </TabsTrigger>
        </TabsList>

        <TabsContent value="authorization" className="mt-0 space-y-4">
          <Card className="border-[#d8e3e0] shadow-sm">
            <CardHeader className="flex flex-col gap-2 space-y-0 border-b border-slate-100 pb-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wide text-[#467067]">
                  日常授权 · 第 2 至 4 步
                </p>
                <CardTitle className="mt-1 text-base">
                  为人员分配岗位与数据范围
                </CardTitle>
                <CardDescription className="mt-1">
                  选择人员、岗位模板与一个可访问范围；需要到期收回时再填写失效时间。若账号尚未创建，请先转到“账号与员工”。
                </CardDescription>
              </div>
              {assignmentForm.id ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAssignmentForm(EMPTY_ASSIGNMENT_FORM)}
                >
                  取消编辑
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              <section className="rounded-xl border border-[#d8e3e0] bg-[#f7faf9] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-[#203c48]">
                      选择岗位模板
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      模板决定岗位职责；具体项目范围仍需在下方设置。
                    </p>
                  </div>
                  {selectedAssignmentTemplate ? (
                    <Badge variant="secondary">
                      已选：{selectedAssignmentTemplate.name}
                    </Badge>
                  ) : null}
                </div>
                {roleTemplates.isLoading ? (
                  <p className="py-3 text-xs text-slate-500">
                    正在加载标准岗位…
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {groupedRoleTemplates.map(([group, templates]) => (
                      <div key={group}>
                        <p className="mb-1 text-[11px] font-semibold tracking-wide text-slate-500">
                          {group}
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                          {templates.map(template => (
                            <button
                              type="button"
                              key={template.code}
                              disabled={!template.available || !template.roleId}
                              className={`rounded-lg border p-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${Number(assignmentForm.roleId) === template.roleId ? "border-[#3e6a61] bg-white shadow-sm" : "border-[#dbe8e4] bg-white hover:border-[#7fa69d]"}`}
                              onClick={() =>
                                setAssignmentForm(current => ({
                                  ...current,
                                  roleId: String(template.roleId),
                                }))
                              }
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium text-slate-800">
                                  {template.name}
                                </span>
                                <span className="text-[10px] text-slate-500">
                                  {template.available ? "可用" : "已停用"}
                                </span>
                              </div>
                              <p className="mt-1 line-clamp-1 text-[11px] leading-4 text-slate-500">
                                {template.summary}
                              </p>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              {assignmentRequiresBusinessScope && !assignmentHasScope ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  业务岗位必须选择至少一个部门/项目部或一个具体项目范围后才可保存。
                </div>
              ) : null}
              {!departmentNodes.length ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-900">
                  <span>
                    尚未配置可用部门或项目部；仍可直接按具体项目授权。
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setLocation("/admin/organization")}
                  >
                    配置组织与项目
                  </Button>
                </div>
              ) : null}
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label>管理人员</Label>
                  <Select
                    value={assignmentForm.userId}
                    onValueChange={value =>
                      setAssignmentForm({ ...assignmentForm, userId: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择用户" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.data?.map(user => (
                        <SelectItem key={user.id} value={String(user.id)}>
                          {user.name || `用户 #${user.id}`}
                          {user.localUsername
                            ? `（${user.localUsername}）`
                            : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>岗位模板</Label>
                  <Select
                    value={assignmentForm.roleId}
                    onValueChange={value =>
                      setAssignmentForm({ ...assignmentForm, roleId: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择岗位" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.data
                        ?.filter(
                          role =>
                            role.status === "active" ||
                            String(role.id) === assignmentForm.roleId
                        )
                        .filter(role => role.code !== "SUPER_ADMIN")
                        .map(role => (
                          <SelectItem key={role.id} value={String(role.id)}>
                            {role.name}
                            {role.status !== "active" ? "（已停用）" : ""}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>所属部门 / 项目部</Label>
                  <Select
                    value={assignmentForm.organizationId || "UNASSIGNED"}
                    onValueChange={value =>
                      setAssignmentForm({
                        ...assignmentForm,
                        organizationId: value === "UNASSIGNED" ? "" : value,
                        projectId:
                          value === "UNASSIGNED"
                            ? assignmentForm.projectId
                            : "",
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择所属部门" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UNASSIGNED">
                        不设置（改用项目范围）
                      </SelectItem>
                      {departmentNodes.map(node => (
                        <SelectItem key={node.id} value={String(node.id)}>
                          {node.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>具体项目范围</Label>
                  <Select
                    value={assignmentForm.projectId || "ALL"}
                    onValueChange={value =>
                      setAssignmentForm({
                        ...assignmentForm,
                        projectId: value === "ALL" ? "" : value,
                        organizationId:
                          value === "ALL" ? assignmentForm.organizationId : "",
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="项目范围（可选）" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">不设置项目范围</SelectItem>
                      {projects.data?.map(project => (
                        <SelectItem key={project.id} value={String(project.id)}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="assignment-valid-from">授权生效时间</Label>
                  <Input
                    id="assignment-valid-from"
                    type="datetime-local"
                    value={assignmentForm.validFrom}
                    onChange={event =>
                      setAssignmentForm({
                        ...assignmentForm,
                        validFrom: event.target.value,
                      })
                    }
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="assignment-valid-to">授权失效时间</Label>
                  <Input
                    id="assignment-valid-to"
                    type="datetime-local"
                    value={assignmentForm.validTo}
                    onChange={event =>
                      setAssignmentForm({
                        ...assignmentForm,
                        validTo: event.target.value,
                      })
                    }
                  />
                </div>
              </div>
              {selectedAssignmentTemplate ? (
                <div className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-950">
                  <b>{selectedAssignmentTemplate.name}</b>：可办理{" "}
                  {selectedAssignmentTemplate.allowedActions.join("、")}
                  ；职责分离{" "}
                  {selectedAssignmentTemplate.restrictedActions.join("、")}。
                </div>
              ) : null}
              <div className="rounded-lg border border-[#d8e3e0] bg-[#f7faf9] px-3 py-2 text-xs leading-5 text-slate-600">
                {normalizedAssignmentScope.projectId
                  ? "当前为具体项目授权：保存后仅可访问该项目，角色对应菜单立即生效。"
                  : normalizedAssignmentScope.organizationId
                    ? "当前为部门范围授权：需先在“部门业务菜单”启用对应模块。"
                    : "请选择部门范围或具体项目范围后再授权。"}
              </div>
              <Button
                className="min-w-40 bg-[#203c48] hover:bg-[#17313b]"
                disabled={!assignmentReady || saveAssignment.isPending}
                onClick={() =>
                  saveAssignment.mutate({
                    id: assignmentForm.id,
                    userId: Number(assignmentForm.userId),
                    roleId: Number(assignmentForm.roleId),
                    organizationId: normalizedAssignmentScope.organizationId,
                    projectId: normalizedAssignmentScope.projectId,
                    validFrom: assignmentForm.validFrom
                      ? new Date(assignmentForm.validFrom).toISOString()
                      : null,
                    validTo: assignmentForm.validTo
                      ? new Date(assignmentForm.validTo).toISOString()
                      : null,
                  })
                }
              >
                {saveAssignment.isPending
                  ? "正在保存…"
                  : assignmentForm.id
                    ? "保存授权修改"
                    : "授予角色"}
              </Button>
            </CardContent>
          </Card>
          <Card className="border-[#d8e3e0] shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 border-b border-slate-100 pb-3">
              <div>
                <CardTitle className="text-base">已授权人员</CardTitle>
                <CardDescription className="mt-1">
                  可按人员、角色、部门或项目查找，编辑时返回上方表单。
                </CardDescription>
              </div>
              <Input
                className="h-8 w-56"
                value={assignmentSearch}
                onChange={event => setAssignmentSearch(event.target.value)}
                placeholder="搜索人员、角色或范围"
              />
            </CardHeader>
            <CardContent className="pt-3">
              {(assignments.data ?? []).length ? (
                <div className="space-y-2">
                  {filteredAssignments.map(item => {
                    const lifecycle = getAssignmentLifecycle(item);
                    return (
                      <div
                        key={item.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2 shadow-sm"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-slate-800">
                              {item.userName || `用户 #${item.userId}`}
                            </p>
                            {item.localUsername ? (
                              <span className="font-mono text-xs text-slate-500">
                                {item.localUsername}
                              </span>
                            ) : null}
                            <Badge variant={lifecycle.tone}>
                              {lifecycle.label}
                            </Badge>
                            <Badge variant="outline">{item.roleName}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            {item.projectName
                              ? `项目：${item.projectName}`
                              : item.organizationName
                                ? `部门：${item.organizationName}`
                                : "全局管理员"}{" "}
                            · 生效 {displayDate(item.validFrom)} · 到期{" "}
                            {displayDate(item.validTo)}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {item.status !== "revoked" ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setAssignmentForm({
                                    id: item.id,
                                    userId: String(item.userId),
                                    roleId: String(item.roleId),
                                    organizationId: item.organizationId
                                      ? String(item.organizationId)
                                      : "",
                                    projectId: item.projectId
                                      ? String(item.projectId)
                                      : "",
                                    validFrom: toLocalDateTimeInput(
                                      item.validFrom
                                    ),
                                    validTo: toLocalDateTimeInput(item.validTo),
                                  })
                                }
                              >
                                编辑
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-rose-200 text-rose-700 hover:bg-rose-50"
                                onClick={() =>
                                  setMasterDataDeleteTarget({
                                    resource: "role_assignment",
                                    id: item.id,
                                    label: `${item.userName || `用户 #${item.userId}`} 的 ${item.roleName} 授权`,
                                    description:
                                      "确认撤销该角色授权？系统将立即停止其权限，并保留原授权记录、操作人和审计历史。",
                                  })
                                }
                              >
                                撤销
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                  {!filteredAssignments.length ? (
                    <EmptyState text="未找到匹配的授权记录。" />
                  ) : null}
                </div>
              ) : (
                <EmptyState text="暂无角色授权记录。" />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accounts" className="mt-0 space-y-4">
          <UnifiedPersonnelDirectory
            onSaved={async () => {
              await Promise.all([
                companyPersonnelRoster.refetch(),
                employeeProfiles.refetch(),
                audits.refetch(),
              ]);
            }}
          />
          <Card className="border-[#d8e3e0] shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">普通管理人员账号</CardTitle>
              <CardDescription className="mt-1">
                手机号仅用于登录；创建账号后请到“人员授权”分配岗位与范围。删除前系统会核查业务责任与资源归属。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <details className="rounded-xl border border-[#d8e3e0] bg-[#f7faf9] p-3">
                <summary className="cursor-pointer text-sm font-semibold text-[#203c48]">
                  新建普通管理人员账号
                </summary>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="local-account-username">登录手机号</Label>
                    <Input
                      id="local-account-username"
                      className="h-9"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      value={localAccountForm.username}
                      onChange={event =>
                        setLocalAccountForm({
                          ...localAccountForm,
                          username: event.target.value,
                        })
                      }
                      placeholder="例如：13800138000"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="local-account-name">显示姓名</Label>
                    <Input
                      id="local-account-name"
                      className="h-9"
                      value={localAccountForm.displayName}
                      onChange={event =>
                        setLocalAccountForm({
                          ...localAccountForm,
                          displayName: event.target.value,
                        })
                      }
                      placeholder="例如：张三"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="local-account-password">初始密码</Label>
                    <Input
                      id="local-account-password"
                      className="h-9"
                      type="password"
                      autoComplete="new-password"
                      value={localAccountForm.initialPassword}
                      onChange={event =>
                        setLocalAccountForm({
                          ...localAccountForm,
                          initialPassword: event.target.value,
                        })
                      }
                      placeholder="至少 6 位"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>初始状态</Label>
                    <Select
                      value={localAccountForm.status}
                      onValueChange={value =>
                        setLocalAccountForm({
                          ...localAccountForm,
                          status: value as "active" | "disabled",
                        })
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">启用</SelectItem>
                        <SelectItem value="disabled">停用</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label>登录方式</Label>
                    <Select
                      value={localAccountForm.loginMode}
                      onValueChange={value =>
                        setLocalAccountForm({
                          ...localAccountForm,
                          loginMode: value as LocalLoginMode,
                        })
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pc">仅 PC 端</SelectItem>
                        <SelectItem value="mobile">仅手机端</SelectItem>
                        <SelectItem value="both">PC 端＋手机端</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button
                      className="h-9 w-full bg-[#203c48] hover:bg-[#17313b]"
                      disabled={
                        !localAccountForm.username ||
                        !localAccountForm.displayName ||
                        !localAccountForm.initialPassword ||
                        createLocalUser.isPending
                      }
                      onClick={() => createLocalUser.mutate(localAccountForm)}
                    >
                      {createLocalUser.isPending ? "正在创建…" : "创建管理人员"}
                    </Button>
                  </div>
                </div>
              </details>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                <p className="text-xs text-slate-600">
                  账号目录 · {filteredLocalManagerUsers.length}/
                  {localManagerUsers.length} 人
                </p>
                <Input
                  className="h-8 w-full sm:w-56"
                  value={personnelSearch}
                  onChange={event => setPersonnelSearch(event.target.value)}
                  placeholder="搜索姓名或登录账号"
                />
              </div>
              {localManagerUsers.length ? (
                <div className="space-y-2">
                  {filteredLocalManagerUsers.map(user => {
                    const accountTarget = {
                      id: user.id,
                      name: user.name || `用户 #${user.id}`,
                      username: user.localUsername || "",
                    };
                    const bindingLabel =
                      user.officialAccountBindingStatus === "active"
                        ? "已绑定"
                        : user.officialAccountBindingStatus === "unsubscribed"
                          ? "已关注但通知暂停"
                          : user.officialAccountBindingStatus === "revoked" ||
                              user.officialAccountBindingStatus === "disabled"
                            ? "绑定已停用"
                            : "待绑定";
                    return (
                      <div
                        key={user.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2 shadow-sm"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-slate-800">
                              {accountTarget.name}
                            </p>
                            <span className="font-mono text-xs text-slate-500">
                              {user.localUsername}
                            </span>
                            <Badge
                              variant={
                                user.localAccountStatus === "active"
                                  ? "secondary"
                                  : "outline"
                              }
                            >
                              {user.localAccountStatus === "active"
                                ? "已启用"
                                : "已停用"}
                            </Badge>
                            <Badge variant="outline">
                              {user.localLoginMode === "pc"
                                ? "仅 PC"
                                : user.localLoginMode === "mobile"
                                  ? "仅手机"
                                  : "双端"}
                            </Badge>
                            <Badge variant="outline">
                              公众号：{bindingLabel}
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500">
                            密码已设置 · 最近登录：
                            {displayDate(user.lastSignedIn)}
                          </p>
                        </div>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button
                            size="sm"
                            className="bg-[#203c48] text-white hover:bg-[#17313b]"
                            disabled={user.localAccountStatus !== "active"}
                            onClick={() => {
                              setDraftUserPermissionIds([]);
                              setUserPermissionTarget(accountTarget);
                            }}
                          >
                            专属权限
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setLocalAccountEditForm({
                                userId: user.id,
                                username: user.localUsername || "",
                                displayName: accountTarget.name,
                                status: user.localAccountStatus,
                                loginMode: user.localLoginMode ?? "both",
                              })
                            }
                          >
                            编辑
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setPasswordResetTarget(accountTarget);
                              setResetPassword("");
                            }}
                          >
                            重置密码
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={setLocalUserStatus.isPending}
                            onClick={() =>
                              setLocalUserStatus.mutate({
                                userId: user.id,
                                status:
                                  user.localAccountStatus === "active"
                                    ? "disabled"
                                    : "active",
                              })
                            }
                          >
                            {user.localAccountStatus === "active"
                              ? "停用"
                              : "启用"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                            onClick={() => setDeleteTarget(accountTarget)}
                          >
                            删除
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  text={
                    personnelSearch
                      ? "未找到匹配的普通管理账号。"
                      : "尚未创建普通管理人员本地账号。"
                  }
                />
              )}
            </CardContent>
          </Card>
          <Dialog
            open={employeeProfileDialogOpen}
            onOpenChange={open => {
              setEmployeeProfileDialogOpen(open);
              if (!open) setEmployeeProfileForm(EMPTY_EMPLOYEE_PROFILE_FORM);
            }}
          >
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl xl:max-w-5xl">
              <DialogHeader>
                <DialogTitle>
                  {employeeProfileForm.id ? "编辑员工档案" : "新建员工档案"}
                </DialogTitle>
                <DialogDescription>
                  员工档案只能关联一名公司账号或一条施工队劳务档案；实际工资结算仍使用考勤与工资条流程。
                </DialogDescription>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={event => {
                  event.preventDefault();
                  saveEmployeeProfile.mutate({
                    id: employeeProfileForm.id,
                    userId:
                      employeeProfileForm.employeeType === "construction_worker"
                        ? null
                        : Number(employeeProfileForm.userId || 0) || null,
                    laborWorkerId:
                      employeeProfileForm.employeeType === "construction_worker"
                        ? Number(employeeProfileForm.laborWorkerId || 0) || null
                        : null,
                    projectId:
                      Number(employeeProfileForm.projectId || 0) || null,
                    employeeType: employeeProfileForm.employeeType,
                    teamName: employeeProfileForm.teamName || null,
                    employmentStatus: employeeProfileForm.employmentStatus,
                    joinedAt: employeeProfileForm.joinedAt || null,
                    leftAt: employeeProfileForm.leftAt || null,
                    salaryBasis: employeeProfileForm.salaryBasis,
                    baseSalary: employeeProfileForm.baseSalary
                      ? Number(employeeProfileForm.baseSalary)
                      : null,
                    remarks: employeeProfileForm.remarks || null,
                  });
                }}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="人员类型">
                    <Select
                      value={employeeProfileForm.employeeType}
                      onValueChange={value =>
                        setEmployeeProfileForm(current => ({
                          ...current,
                          employeeType: value as EmployeeType,
                          userId:
                            value === "construction_worker"
                              ? ""
                              : current.userId,
                          laborWorkerId:
                            value === "construction_worker"
                              ? current.laborWorkerId
                              : "",
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="management">公司管理人员</SelectItem>
                        <SelectItem value="operator">机械操作员</SelectItem>
                        <SelectItem value="construction_worker">
                          施工队工人
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  {employeeProfileForm.employeeType ===
                  "construction_worker" ? (
                    <Field label="关联施工队工人">
                      {employeeOptions.isLoading ? (
                        <p className="text-sm text-slate-500">
                          正在读取可关联的施工队工人…
                        </p>
                      ) : constructionWorkerOptions.length ? (
                        <Select
                          value={
                            employeeProfileForm.laborWorkerId || "UNASSIGNED"
                          }
                          onValueChange={value => {
                            const worker = constructionWorkerOptions.find(
                              item => String(item.id) === value
                            );
                            setEmployeeProfileForm(current => ({
                              ...current,
                              laborWorkerId:
                                value === "UNASSIGNED" ? "" : value,
                              projectId: worker
                                ? String(worker.projectId)
                                : current.projectId,
                              teamName: worker?.teamName ?? current.teamName,
                            }));
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="选择已有劳务档案" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="UNASSIGNED">请选择</SelectItem>
                            {constructionWorkerOptions.map(worker => (
                              <SelectItem
                                key={worker.id}
                                value={String(worker.id)}
                              >
                                {worker.realName}
                                {worker.teamName ? ` · ${worker.teamName}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-sm leading-5 text-slate-600">
                          <p>
                            暂无可关联的施工队工人。员工档案窗口只能关联已有真实劳务档案，不能在此创建工人。
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-2"
                            onClick={() => {
                              setEmployeeProfileDialogOpen(false);
                              setEmployeeProfileForm(
                                EMPTY_EMPLOYEE_PROFILE_FORM
                              );
                              setLocation("/admin/labor");
                            }}
                          >
                            前往劳务工资工作台新建实名制施工队工人
                          </Button>
                        </div>
                      )}
                    </Field>
                  ) : (
                    <Field label="关联公司账号">
                      <Select
                        value={employeeProfileForm.userId || "UNASSIGNED"}
                        onValueChange={value =>
                          setEmployeeProfileForm(current => ({
                            ...current,
                            userId: value === "UNASSIGNED" ? "" : value,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="选择账号" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="UNASSIGNED">请选择</SelectItem>
                          {employeeOptions.data?.users.map(user => (
                            <SelectItem key={user.id} value={String(user.id)}>
                              {user.name || `用户 #${user.id}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                  <Field label="归属项目">
                    <Select
                      value={employeeProfileForm.projectId || "UNASSIGNED"}
                      onValueChange={value =>
                        setEmployeeProfileForm(current => ({
                          ...current,
                          projectId: value === "UNASSIGNED" ? "" : value,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="选择项目（可选）" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="UNASSIGNED">不设置项目</SelectItem>
                        {projects.data?.map(project => (
                          <SelectItem
                            key={project.id}
                            value={String(project.id)}
                          >
                            {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="归属队伍">
                    <Input
                      value={employeeProfileForm.teamName}
                      onChange={event =>
                        setEmployeeProfileForm(current => ({
                          ...current,
                          teamName: event.target.value,
                        }))
                      }
                      placeholder="例如：路基施工一队"
                    />
                  </Field>
                  <Field label="入职日期">
                    <Input
                      type="date"
                      value={employeeProfileForm.joinedAt}
                      onChange={event =>
                        setEmployeeProfileForm(current => ({
                          ...current,
                          joinedAt: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="在职状态">
                    <Select
                      value={employeeProfileForm.employmentStatus}
                      onValueChange={value =>
                        setEmployeeProfileForm(current => ({
                          ...current,
                          employmentStatus:
                            value as EmployeeProfileForm["employmentStatus"],
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">在职</SelectItem>
                        <SelectItem value="suspended">停用</SelectItem>
                        <SelectItem value="left">已离职</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="计薪口径">
                    <Select
                      value={employeeProfileForm.salaryBasis}
                      onValueChange={value =>
                        setEmployeeProfileForm(current => ({
                          ...current,
                          salaryBasis:
                            value as EmployeeProfileForm["salaryBasis"],
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
                  </Field>
                  <Field label="基础工资 / 单价">
                    <Input
                      inputMode="decimal"
                      value={employeeProfileForm.baseSalary}
                      onChange={event =>
                        setEmployeeProfileForm(current => ({
                          ...current,
                          baseSalary: event.target.value,
                        }))
                      }
                      placeholder="仅作台账与预算参考"
                    />
                  </Field>
                  <Field label="离职日期">
                    <Input
                      type="date"
                      value={employeeProfileForm.leftAt}
                      onChange={event =>
                        setEmployeeProfileForm(current => ({
                          ...current,
                          leftAt: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>
                <Field label="备注">
                  <Textarea
                    value={employeeProfileForm.remarks}
                    onChange={event =>
                      setEmployeeProfileForm(current => ({
                        ...current,
                        remarks: event.target.value,
                      }))
                    }
                    placeholder="岗位说明、交接或其他不含敏感证件原文的说明"
                  />
                </Field>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEmployeeProfileDialogOpen(false)}
                  >
                    取消
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      saveEmployeeProfile.isPending ||
                      (employeeProfileForm.employeeType ===
                      "construction_worker"
                        ? !employeeProfileForm.laborWorkerId
                        : !employeeProfileForm.userId)
                    }
                  >
                    {saveEmployeeProfile.isPending
                      ? "正在保存…"
                      : "保存员工档案"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <Dialog
            open={employeeInsuranceDialogOpen}
            onOpenChange={open => {
              setEmployeeInsuranceDialogOpen(open);
              if (!open) {
                setEmployeeInsuranceForm(EMPTY_EMPLOYEE_INSURANCE_FORM);
                setEmployeeInsurancePolicyFile(null);
              }
            }}
          >
            <DialogContent className="sm:max-w-3xl xl:max-w-4xl">
              <DialogHeader>
                <DialogTitle>登记员工保险</DialogTitle>
                <DialogDescription>
                  到期提醒在后台加载时实时计算；请填写真实购买日与到期日。
                </DialogDescription>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={async event => {
                  event.preventDefault();
                  try {
                    let evidenceId = employeeInsuranceForm.evidenceId ?? null;
                    if (employeeInsurancePolicyFile) {
                      if (
                        ![
                          "image/jpeg",
                          "image/png",
                          "application/pdf",
                        ].includes(employeeInsurancePolicyFile.type)
                      ) {
                        toast.error("保单仅支持 JPG、PNG 或 PDF 文件");
                        return;
                      }
                      const uploaded =
                        await uploadEmployeeInsurancePolicy.mutateAsync({
                          employeeProfileId: Number(
                            employeeInsuranceForm.employeeProfileId
                          ),
                          fileName: employeeInsurancePolicyFile.name,
                          mimeType: employeeInsurancePolicyFile.type as
                            | "image/jpeg"
                            | "image/png"
                            | "application/pdf",
                          base64Data: await readImageAsBase64(
                            employeeInsurancePolicyFile
                          ),
                        });
                      evidenceId = uploaded.evidenceId;
                    }
                    saveEmployeeInsurance.mutate({
                      id: employeeInsuranceForm.id,
                      employeeProfileId: Number(
                        employeeInsuranceForm.employeeProfileId
                      ),
                      insuranceType: employeeInsuranceForm.insuranceType,
                      providerName: employeeInsuranceForm.providerName || null,
                      policyReference:
                        employeeInsuranceForm.policyReference || null,
                      evidenceId,
                      premiumAmount: employeeInsuranceForm.premiumAmount
                        ? Number(employeeInsuranceForm.premiumAmount)
                        : null,
                      coverageAmount: employeeInsuranceForm.coverageAmount
                        ? Number(employeeInsuranceForm.coverageAmount)
                        : null,
                      purchasedAt: employeeInsuranceForm.purchasedAt,
                      expiresAt: employeeInsuranceForm.expiresAt,
                      status: employeeInsuranceForm.status,
                      remarks: employeeInsuranceForm.remarks || null,
                    });
                  } catch (error) {
                    toast.error(
                      getUserFacingErrorMessage(
                        error,
                        "保单附件上传失败，请重试"
                      )
                    );
                  }
                }}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="保险类型">
                    <Select
                      value={employeeInsuranceForm.insuranceType}
                      onValueChange={value =>
                        setEmployeeInsuranceForm(current => ({
                          ...current,
                          insuranceType:
                            value as EmployeeInsuranceForm["insuranceType"],
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="work_injury">工伤保险</SelectItem>
                        <SelectItem value="accident">意外险</SelectItem>
                        <SelectItem value="medical">医疗保险</SelectItem>
                        <SelectItem value="employer_liability">
                          雇主责任险
                        </SelectItem>
                        <SelectItem value="other">其他</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="保险状态">
                    <Select
                      value={employeeInsuranceForm.status}
                      onValueChange={value =>
                        setEmployeeInsuranceForm(current => ({
                          ...current,
                          status: value as EmployeeInsuranceForm["status"],
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">有效</SelectItem>
                        <SelectItem value="expired">已到期</SelectItem>
                        <SelectItem value="cancelled">已取消</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="保险公司">
                    <Input
                      value={employeeInsuranceForm.providerName}
                      onChange={event =>
                        setEmployeeInsuranceForm(current => ({
                          ...current,
                          providerName: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="保单编号 / 参考号">
                    <Input
                      value={employeeInsuranceForm.policyReference}
                      onChange={event =>
                        setEmployeeInsuranceForm(current => ({
                          ...current,
                          policyReference: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="本期保费（元，可选）">
                    <Input
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      type="number"
                      value={employeeInsuranceForm.premiumAmount}
                      onChange={event =>
                        setEmployeeInsuranceForm(current => ({
                          ...current,
                          premiumAmount: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="保险保额（元，可选）">
                    <Input
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      type="number"
                      value={employeeInsuranceForm.coverageAmount}
                      onChange={event =>
                        setEmployeeInsuranceForm(current => ({
                          ...current,
                          coverageAmount: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="购买日期">
                    <Input
                      type="date"
                      value={employeeInsuranceForm.purchasedAt}
                      onChange={event =>
                        setEmployeeInsuranceForm(current => ({
                          ...current,
                          purchasedAt: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="到期日期">
                    <Input
                      type="date"
                      value={employeeInsuranceForm.expiresAt}
                      onChange={event =>
                        setEmployeeInsuranceForm(current => ({
                          ...current,
                          expiresAt: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>
                <Field label="保单附件（JPG / PNG / PDF，可选）">
                  <Input
                    type="file"
                    accept="image/jpeg,image/png,application/pdf"
                    onChange={event =>
                      setEmployeeInsurancePolicyFile(
                        event.target.files?.[0] ?? null
                      )
                    }
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    文件最大
                    15MB；保存时先校验格式并受控归档。续保请新增保险记录，历史保单不会被覆盖。
                  </p>
                  {employeeInsurancePolicyFile ? (
                    <p className="mt-1 text-xs font-medium text-[#467067]">
                      已选择：{employeeInsurancePolicyFile.name}
                    </p>
                  ) : employeeInsuranceForm.evidenceId ? (
                    <p className="mt-1 text-xs text-[#467067]">
                      当前记录已有受控保单附件；重新选择文件会更新本记录关联。
                    </p>
                  ) : null}
                </Field>
                <Field label="备注">
                  <Textarea
                    value={employeeInsuranceForm.remarks}
                    onChange={event =>
                      setEmployeeInsuranceForm(current => ({
                        ...current,
                        remarks: event.target.value,
                      }))
                    }
                  />
                </Field>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEmployeeInsuranceDialogOpen(false)}
                  >
                    取消
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      saveEmployeeInsurance.isPending ||
                      !employeeInsuranceForm.employeeProfileId ||
                      !employeeInsuranceForm.purchasedAt ||
                      !employeeInsuranceForm.expiresAt
                    }
                  >
                    {saveEmployeeInsurance.isPending
                      ? "正在保存…"
                      : "保存保险台账"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <Dialog
            open={Boolean(localAccountEditForm)}
            onOpenChange={open => {
              if (!open) setLocalAccountEditForm(null);
            }}
          >
            <DialogContent className="sm:max-w-3xl xl:max-w-4xl">
              <DialogHeader>
                <DialogTitle>编辑普通管理人员账号</DialogTitle>
                <DialogDescription>
                  可修改登录账号、显示姓名和启停状态；角色及数据范围请在“人员授权”中维护。
                </DialogDescription>
              </DialogHeader>
              {localAccountEditForm ? (
                <form
                  className="space-y-4"
                  onSubmit={event => {
                    event.preventDefault();
                    updateLocalUser.mutate(localAccountEditForm);
                  }}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="edit-local-account-username">
                        登录手机号
                      </Label>
                      <Input
                        id="edit-local-account-username"
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel"
                        value={localAccountEditForm.username}
                        onChange={event =>
                          setLocalAccountEditForm({
                            ...localAccountEditForm,
                            username: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="edit-local-account-name">显示姓名</Label>
                      <Input
                        id="edit-local-account-name"
                        value={localAccountEditForm.displayName}
                        onChange={event =>
                          setLocalAccountEditForm({
                            ...localAccountEditForm,
                            displayName: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label>账号状态</Label>
                      <Select
                        value={localAccountEditForm.status}
                        onValueChange={value =>
                          setLocalAccountEditForm({
                            ...localAccountEditForm,
                            status: value as LocalAccountStatus,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">启用</SelectItem>
                          <SelectItem value="disabled">停用</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label>登录方式</Label>
                      <Select
                        value={localAccountEditForm.loginMode}
                        onValueChange={value =>
                          setLocalAccountEditForm({
                            ...localAccountEditForm,
                            loginMode: value as LocalLoginMode,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pc">仅 PC 端</SelectItem>
                          <SelectItem value="mobile">仅手机端</SelectItem>
                          <SelectItem value="both">PC 端＋手机端</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setLocalAccountEditForm(null)}
                    >
                      取消
                    </Button>
                    <Button
                      type="submit"
                      className="bg-[#203c48] hover:bg-[#17313b]"
                      disabled={
                        !localAccountEditForm.username ||
                        !localAccountEditForm.displayName ||
                        updateLocalUser.isPending
                      }
                    >
                      {updateLocalUser.isPending ? "正在保存…" : "保存修改"}
                    </Button>
                  </DialogFooter>
                </form>
              ) : null}
            </DialogContent>
          </Dialog>
          <Dialog
            open={Boolean(passwordResetTarget)}
            onOpenChange={open => {
              if (!open) {
                setPasswordResetTarget(null);
                setResetPassword("");
              }
            }}
          >
            <DialogContent className="sm:max-w-3xl xl:max-w-4xl">
              <DialogHeader>
                <DialogTitle>重置普通管理人员密码</DialogTitle>
                <DialogDescription>
                  新密码至少 6 位，系统仅保存不可逆摘要，设置后不会再次显示。
                </DialogDescription>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={event => {
                  event.preventDefault();
                  if (passwordResetTarget)
                    resetLocalUserPassword.mutate({
                      userId: passwordResetTarget.id,
                      newPassword: resetPassword,
                    });
                }}
              >
                <div className="grid gap-1.5">
                  <Label htmlFor="reset-local-account-password">新密码</Label>
                  <Input
                    id="reset-local-account-password"
                    type="password"
                    autoComplete="new-password"
                    value={resetPassword}
                    onChange={event => setResetPassword(event.target.value)}
                    placeholder="至少 6 位，任意数字或字符"
                  />
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setPasswordResetTarget(null);
                      setResetPassword("");
                    }}
                  >
                    取消
                  </Button>
                  <Button
                    type="submit"
                    className="bg-[#203c48] hover:bg-[#17313b]"
                    disabled={
                      resetPassword.length < 6 ||
                      resetLocalUserPassword.isPending
                    }
                  >
                    {resetLocalUserPassword.isPending
                      ? "正在重置…"
                      : "确认重置密码"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <Dialog
            open={Boolean(userPermissionTarget)}
            onOpenChange={open => {
              if (!open) {
                setUserPermissionTarget(null);
                setDraftUserPermissionIds([]);
              }
            }}
          >
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl xl:max-w-6xl">
              <DialogHeader>
                <DialogTitle>分配用户专属操作权限</DialogTitle>
                <DialogDescription>
                  专属权限只覆盖该用户在对应模块的具体操作，不扩大其部门、项目范围或账号状态权限。
                </DialogDescription>
              </DialogHeader>
              {userPermissionIds.isLoading ? (
                <EmptyState text="正在读取该用户的专属权限…" />
              ) : (
                <div className="space-y-2">
                  {permissionGroups.map(([module, items], index) => (
                    <details
                      key={module}
                      open={
                        index === 0 ||
                        items.some(item =>
                          draftUserPermissionIds.includes(item.id)
                        )
                      }
                      className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                    >
                      <summary className="cursor-pointer list-none">
                        <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
                          <div>
                            <p className="text-sm font-semibold text-slate-800">
                              {permissionModuleLabels[module] ?? module}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              已选{" "}
                              {
                                items.filter(item =>
                                  draftUserPermissionIds.includes(item.id)
                                ).length
                              }{" "}
                              / {items.length} 项；未勾选时沿用角色权限
                            </p>
                          </div>
                          <div className="flex gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8"
                              onClick={event => {
                                event.preventDefault();
                                setDraftUserPermissionIds(current =>
                                  Array.from(
                                    new Set([
                                      ...current,
                                      ...items.map(item => item.id),
                                    ])
                                  )
                                );
                              }}
                            >
                              全选
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 text-slate-600"
                              onClick={event => {
                                event.preventDefault();
                                setDraftUserPermissionIds(current =>
                                  current.filter(
                                    id => !items.some(item => item.id === id)
                                  )
                                );
                              }}
                            >
                              清空
                            </Button>
                          </div>
                        </div>
                      </summary>
                      <div className="mt-3 grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">
                        {items.map(permission => (
                          <label
                            key={permission.id}
                            className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-white p-2 hover:border-[#9ab6ad] hover:bg-[#f7fbf8]"
                          >
                            <Checkbox
                              checked={draftUserPermissionIds.includes(
                                permission.id
                              )}
                              onCheckedChange={checked =>
                                setDraftUserPermissionIds(current =>
                                  checked
                                    ? Array.from(
                                        new Set([...current, permission.id])
                                      )
                                    : current.filter(id => id !== permission.id)
                                )
                              }
                            />
                            <span>
                              <span className="block text-sm font-medium text-slate-700">
                                {permission.name}
                              </span>
                              <span className="mt-1 inline-flex rounded bg-[#edf4f1] px-1.5 py-0.5 text-[11px] font-medium text-[#355c52]">
                                操作：
                                {permissionActionLabels[permission.action] ??
                                  permission.action}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setUserPermissionTarget(null);
                    setDraftUserPermissionIds([]);
                  }}
                >
                  取消
                </Button>
                <Button
                  className="bg-[#203c48] hover:bg-[#17313b]"
                  disabled={
                    !userPermissionTarget || setUserPermissions.isPending
                  }
                  onClick={() =>
                    userPermissionTarget &&
                    setUserPermissions.mutate({
                      userId: userPermissionTarget.id,
                      permissionIds: draftUserPermissionIds,
                    })
                  }
                >
                  {setUserPermissions.isPending
                    ? "正在保存…"
                    : "保存该用户权限"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <AlertDialog
            open={Boolean(deleteTarget)}
            onOpenChange={open => {
              if (!open) setDeleteTarget(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确认删除管理人员账号？</AlertDialogTitle>
                <AlertDialogDescription>
                  将删除“{deleteTarget?.name}（{deleteTarget?.username}
                  ）”的本地登录能力，并撤销其角色授权。系统会保留必要审计索引；如账号仍关联业务单据、资源责任或组织负责人信息，服务端会拒绝删除并提示需交接的事项。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-rose-600 text-white hover:bg-rose-700"
                  disabled={deleteLocalUser.isPending}
                  onClick={() => {
                    if (deleteTarget)
                      deleteLocalUser.mutate({ userId: deleteTarget.id });
                  }}
                >
                  {deleteLocalUser.isPending ? "正在删除…" : "确认删除"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>

        <TabsContent value="roles" className="mt-0 space-y-4">
          <div className="grid min-w-0 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
            <Card className="h-fit border-[#d8e3e0] shadow-sm">
              <CardHeader className="border-b border-slate-100 pb-3">
                <CardTitle className="text-base">角色选择</CardTitle>
                <CardDescription className="mt-1">
                  日常优先使用标准岗位模板；只在新增或维护自定义角色时编辑角色参数。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 pt-3">
                {roles.data?.map(role => (
                  <button
                    key={role.id}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${selectedRoleId === role.id ? "border-[#203c48] bg-[#edf4f1]" : "border-slate-100 hover:bg-slate-50"}`}
                    onClick={() => {
                      setSelectedRoleId(role.id);
                      setRolePermissionModule("all");
                      setRoleForm(
                        role.isSystem
                          ? EMPTY_ROLE_FORM
                          : {
                              id: role.id,
                              code: role.code,
                              name: role.name,
                              category: role.category,
                              description: role.description ?? "",
                              status: role.status,
                              isSystem: role.isSystem,
                            }
                      );
                    }}
                  >
                    <p className="text-sm font-medium">{role.name}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {role.category === "system" ? "系统角色" : "业务角色"} ·{" "}
                      {role.status === "active" ? "启用" : "停用"}
                    </p>
                  </button>
                ))}
                <details className="mt-3 rounded-lg border border-[#d8e3e0] bg-[#f7faf9] p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-[#203c48]">
                    {roleForm.id ? "维护自定义角色" : "新增自定义角色"}
                  </summary>
                  <div className="mt-3 space-y-2">
                    <Input
                      className="h-9"
                      value={roleForm.code}
                      placeholder="角色编码，例如 CONTRACT_MANAGER"
                      onChange={event =>
                        setRoleForm({
                          ...roleForm,
                          code: event.target.value.toUpperCase(),
                        })
                      }
                    />
                    <Input
                      className="h-9"
                      value={roleForm.name}
                      placeholder="角色名称"
                      onChange={event =>
                        setRoleForm({ ...roleForm, name: event.target.value })
                      }
                    />
                    <Input
                      className="h-9"
                      value={roleForm.description}
                      placeholder="职责说明（可选）"
                      onChange={event =>
                        setRoleForm({
                          ...roleForm,
                          description: event.target.value,
                        })
                      }
                    />
                    <Select
                      value={roleForm.status}
                      onValueChange={(value: OrganizationStatus) =>
                        setRoleForm({ ...roleForm, status: value })
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">启用</SelectItem>
                        <SelectItem value="disabled">停用</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          !roleForm.code || !roleForm.name || saveRole.isPending
                        }
                        onClick={() => {
                          const { isSystem, ...input } = roleForm;
                          saveRole.mutate(input);
                        }}
                      >
                        {roleForm.id ? "保存变更" : "保存角色"}
                      </Button>
                      {roleForm.id ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-rose-200 text-rose-700 hover:bg-rose-50"
                          onClick={() =>
                            setMasterDataDeleteTarget({
                              resource: "role",
                              id: roleForm.id!,
                              label: roleForm.name,
                              description: `确认删除自定义角色“${roleForm.name}”？系统内置角色和已有授权历史的角色不可删除，应改为停用并撤销现有授权。`,
                            })
                          }
                        >
                          删除
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </details>
              </CardContent>
            </Card>
            <Card className="min-w-0 border-[#d8e3e0] shadow-sm">
              <CardHeader className="flex flex-col gap-3 space-y-0 border-b border-slate-100 pb-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold tracking-wide text-[#467067]">
                    角色权限矩阵
                  </p>
                  <CardTitle className="mt-1 text-base">
                    角色详细操作权限
                  </CardTitle>
                  <CardDescription className="mt-1">
                    勾选一个模块后仅开放该模块已选动作。菜单可见性还需要部门业务菜单与项目范围共同满足。
                  </CardDescription>
                </div>
                <div className="shrink-0 text-xs text-slate-500">
                  已选 {draftPermissionIds.length} 项
                </div>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                {selectedRoleId === undefined ? (
                  <EmptyState text="正在加载可分配角色…" />
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={
                          rolePermissionModule === "all" ? "default" : "outline"
                        }
                        className={
                          rolePermissionModule === "all"
                            ? "bg-[#203c48] hover:bg-[#17313b]"
                            : ""
                        }
                        onClick={() => setRolePermissionModule("all")}
                      >
                        全部模块
                      </Button>
                      {permissionGroups.map(([module]) => (
                        <Button
                          key={module}
                          size="sm"
                          variant={
                            rolePermissionModule === module
                              ? "default"
                              : "outline"
                          }
                          className={
                            rolePermissionModule === module
                              ? "bg-[#203c48] hover:bg-[#17313b]"
                              : ""
                          }
                          onClick={() => setRolePermissionModule(module)}
                        >
                          {permissionModuleLabels[module] ?? module}
                        </Button>
                      ))}
                    </div>
                    <div className="space-y-2">
                      {permissionGroups
                        .filter(
                          ([module]) =>
                            rolePermissionModule === "all" ||
                            rolePermissionModule === module
                        )
                        .map(([module, items]) => (
                          <section
                            key={module}
                            className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                          >
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-slate-800">
                                  {permissionModuleLabels[module] ?? module}
                                </p>
                                <p className="mt-0.5 text-xs text-slate-500">
                                  已选{" "}
                                  {
                                    items.filter(item =>
                                      draftPermissionIds.includes(item.id)
                                    ).length
                                  }{" "}
                                  / {items.length} 项；未选动作会被服务端拒绝。
                                </p>
                              </div>
                              <div className="flex gap-1.5">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 px-2 text-xs"
                                  onClick={() =>
                                    setDraftPermissionIds(current =>
                                      Array.from(
                                        new Set([
                                          ...current,
                                          ...items.map(item => item.id),
                                        ])
                                      )
                                    )
                                  }
                                >
                                  全选本模块
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 px-2 text-xs text-slate-600"
                                  onClick={() =>
                                    setDraftPermissionIds(current =>
                                      current.filter(
                                        id =>
                                          !items.some(item => item.id === id)
                                      )
                                    )
                                  }
                                >
                                  清空
                                </Button>
                              </div>
                            </div>
                            <div className="grid gap-1.5 sm:grid-cols-2 2xl:grid-cols-3">
                              {items.map(permission => (
                                <label
                                  key={permission.id}
                                  className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-white p-2 hover:border-[#9ab6ad] hover:bg-[#f7fbf8]"
                                >
                                  <Checkbox
                                    checked={draftPermissionIds.includes(
                                      permission.id
                                    )}
                                    onCheckedChange={checked =>
                                      setDraftPermissionIds(current =>
                                        checked
                                          ? Array.from(
                                              new Set([
                                                ...current,
                                                permission.id,
                                              ])
                                            )
                                          : current.filter(
                                              id => id !== permission.id
                                            )
                                      )
                                    }
                                  />
                                  <span>
                                    <span className="block text-sm font-medium text-slate-700">
                                      {permission.name}
                                    </span>
                                    <span className="mt-1 inline-flex rounded bg-[#edf4f1] px-1.5 py-0.5 text-[11px] font-medium text-[#355c52]">
                                      操作：
                                      {permissionActionLabels[
                                        permission.action
                                      ] ?? permission.action}
                                    </span>
                                  </span>
                                </label>
                              ))}
                            </div>
                          </section>
                        ))}
                    </div>
                    <div className="sticky bottom-3 flex justify-end">
                      <Button
                        className="bg-[#203c48] shadow-lg hover:bg-[#17313b]"
                        disabled={savePermissions.isPending}
                        onClick={() =>
                          selectedRoleId &&
                          savePermissions.mutate({
                            roleId: selectedRoleId,
                            permissionIds: draftPermissionIds,
                          })
                        }
                      >
                        {savePermissions.isPending
                          ? "正在保存…"
                          : "保存当前角色权限"}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="department" className="mt-0 space-y-4">
          <Card className="border-[#d8e3e0] shadow-sm">
            <CardHeader className="border-b border-slate-100 pb-3">
              <p className="text-xs font-semibold tracking-wide text-[#467067]">
                菜单可见性 · 项目与部门范围
              </p>
              <CardTitle className="mt-1 text-base">
                项目或部门可办理业务
              </CardTitle>
              <CardDescription className="mt-1">
                已有项目可直接配置业务菜单，无需先建立组织节点；部门/项目部配置继续保留。人员仍须同时具备该项目或部门范围内的角色授权，此处不增加数据范围或操作权限。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                <Select
                  value={departmentScopeForm.scopeTarget}
                  disabled={departmentScopePickerState.disabled}
                  onValueChange={value =>
                    setDepartmentScopeForm({
                      ...departmentScopeForm,
                      scopeTarget: value,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={departmentScopePickerState.placeholder}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {departmentScopeProjects.map(project => (
                      <SelectItem
                        key={`project:${project.id}`}
                        value={`project:${project.id}`}
                      >
                        项目 · {project.name}
                        {project.code ? `（${project.code}）` : ""}
                      </SelectItem>
                    ))}
                    {departmentNodes.map(node => (
                      <SelectItem
                        key={`organization:${node.id}`}
                        value={`organization:${node.id}`}
                      >
                        部门 · {node.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={departmentScopeForm.module}
                  onValueChange={value =>
                    setDepartmentScopeForm({
                      ...departmentScopeForm,
                      module: value as DepartmentModuleCode,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择业务模块" />
                  </SelectTrigger>
                  <SelectContent>
                    {departmentModules.data?.map(module => (
                      <SelectItem key={module.code} value={module.code}>
                        {module.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  disabled={
                    !departmentScopeForm.scopeTarget ||
                    !departmentScopeForm.module ||
                    saveDepartmentScope.isPending
                  }
                  onClick={() => {
                    const [scopeType, rawScopeId] =
                      departmentScopeForm.scopeTarget.split(":");
                    const scopeId = Number(rawScopeId);
                    if (
                      departmentScopeForm.module &&
                      (scopeType === "organization" ||
                        scopeType === "project") &&
                      Number.isSafeInteger(scopeId) &&
                      scopeId > 0
                    )
                      saveDepartmentScope.mutate({
                        scopeType,
                        scopeId,
                        module: departmentScopeForm.module,
                        status: "active",
                      });
                  }}
                >
                  启用业务
                </Button>
              </div>
              {departmentScopePickerState.needsScopeSetup ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-amber-200 bg-amber-50/70 p-3">
                  <div>
                    <p className="text-sm font-medium text-amber-950">
                      尚无可选择的项目或部门范围
                    </p>
                    <p className="mt-1 text-xs leading-5 text-amber-800">
                      请先建立未归档项目，或建立启用的部门/项目部节点。
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-300 bg-white text-amber-950 hover:bg-amber-100"
                    onClick={() => setLocation("/admin/organization")}
                  >
                    建立项目或组织节点
                  </Button>
                </div>
              ) : null}
              {departmentScopes.data?.length ? (
                <div className="grid gap-2 lg:grid-cols-2">
                  {departmentScopes.data.map(scope => {
                    const module = departmentModules.data?.find(
                      item => item.code === scope.module
                    );
                    return (
                      <div
                        key={scope.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2 shadow-sm"
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-800">
                            {scope.scopeType === "project" ? "项目" : "部门"} ·{" "}
                            {scope.scopeName} · {module?.name ?? scope.module}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {scope.status === "active" ? "已启用" : "已停用"} ·
                            更新于 {displayDate(scope.updatedAt)}
                          </p>
                        </div>
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={saveDepartmentScope.isPending}
                            onClick={() =>
                              saveDepartmentScope.mutate({
                                scopeType: scope.scopeType,
                                scopeId: scope.scopeId,
                                module: scope.module,
                                status:
                                  scope.status === "active"
                                    ? "disabled"
                                    : "active",
                              })
                            }
                          >
                            {scope.status === "active" ? "停用" : "启用"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-rose-200 text-rose-700 hover:bg-rose-50"
                            onClick={() =>
                              setMasterDataDeleteTarget({
                                resource: "department_scope",
                                id: scope.id,
                                label: `${scope.scopeType === "project" ? "项目" : "部门"} · ${scope.scopeName} · ${module?.name ?? scope.module}`,
                                description: `确认删除“${scope.scopeName}”的“${module?.name ?? scope.module}”业务范围？删除后该${scope.scopeType === "project" ? "项目" : "部门"}不再拥有该模块入口，可重新启用创建。`,
                              })
                            }
                          >
                            删除
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState text="尚未配置项目或部门可办理业务。请选择已有项目或部门，再按实际职责启用业务模块。" />
              )}
            </CardContent>
          </Card>
          <Card className="border-[#d8e3e0] bg-[#f8fbfa]">
            <CardContent className="grid gap-3 p-4 md:grid-cols-3">
              <div>
                <p className="text-sm font-semibold text-[#203c48]">菜单</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  部门业务模块与岗位模板共同投影可见菜单。
                </p>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#203c48]">页面数据</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  项目范围与账号有效期决定可读取的数据。
                </p>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#203c48]">具体操作</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  角色或专属权限控制新增、审核、结算、导出和打印。
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );

  const renderSettings = () => {
    const settingsMeta: Record<
      SettingsCategory,
      { label: string; description: string }
    > = {
      business: {
        label: "业务规则",
        description: "考勤设备、每日汇总与审核规则",
      },
      integrations: {
        label: "通知与接入",
        description: "短信、公众号、外部 AI 与受控连接",
      },
      media: { label: "影像与资料", description: "照片存储与现场水印" },
      governance: {
        label: "版本与治理",
        description: "配置清单、发布记录与安全回滚",
      },
    };
    const activeSettingsMeta = settingsMeta[settingsCategory];
    const publishedSettingsCount = allSettings.filter(
      item => item.status === "published"
    ).length;
    const draftSettingsCount = allSettings.filter(
      item => item.status === "draft"
    ).length;

    return (
      <div className="space-y-4">
        <Card className="overflow-hidden border-[#cfdfda] bg-[linear-gradient(135deg,#f6fbf9_0%,#f9fbfa_62%,#edf5f2_100%)] shadow-sm">
          <CardContent className="space-y-4 p-4 lg:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold tracking-[0.13em] text-[#467067]">
                  平台治理 / 系统设置
                </p>
                <h1 className="mt-1 text-xl font-semibold tracking-tight text-[#173a3a] lg:text-2xl">
                  {activeSettingsMeta.label}
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  {activeSettingsMeta.description}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800">
                  已发布 {publishedSettingsCount}
                </span>
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-medium text-amber-800">
                  草稿 {draftSettingsCount}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600">
                  敏感值均加密托管
                </span>
              </div>
            </div>
            <Tabs
              value={settingsCategory}
              onValueChange={value =>
                setSettingsCategory(value as SettingsCategory)
              }
              className="w-full"
            >
              <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl bg-white/85 p-1 shadow-inner sm:grid-cols-4">
                <TabsTrigger
                  value="business"
                  className="min-h-10 px-3 text-xs sm:text-sm"
                >
                  业务规则
                </TabsTrigger>
                <TabsTrigger
                  value="integrations"
                  className="min-h-10 px-3 text-xs sm:text-sm"
                >
                  通知与接入
                </TabsTrigger>
                <TabsTrigger
                  value="media"
                  className="min-h-10 px-3 text-xs sm:text-sm"
                >
                  影像与资料
                </TabsTrigger>
                <TabsTrigger
                  value="governance"
                  className="min-h-10 px-3 text-xs sm:text-sm"
                >
                  版本与治理
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </CardContent>
        </Card>
        <div
          className={
            settingsCategory === "integrations" ||
            settingsCategory === "governance"
              ? "grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(380px,.72fr)]"
              : "max-w-6xl"
          }
        >
          <section className="space-y-4">
            {/* 通知与接入中的短信组件必须可见；不改变其他系统配置布局。 */}
            {settingsCategory === "business" ? (
              <Card className="border-amber-200 bg-amber-50/60">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base text-[#203c48]">
                    考勤设备绑定上限
                  </CardTitle>
                  <CardDescription>
                    控制每个账号同时启用的手机考勤设备数量。默认3台，支持1至50台；修改后需发布才会影响新设备绑定，已有设备不会自动停用。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="w-40">
                      <Label>允许设备台数</Label>
                      <Input
                        className="mt-1 bg-white"
                        type="number"
                        min={1}
                        max={50}
                        step={1}
                        value={attendanceDeviceLimitDraft}
                        onChange={event =>
                          setAttendanceDeviceLimitDraft(event.target.value)
                        }
                      />
                    </div>
                    <Button
                      className="bg-[#203c48] hover:bg-[#17313b]"
                      disabled={
                        !/^([1-9]|[1-4][0-9]|50)$/.test(
                          attendanceDeviceLimitDraft
                        ) || saveAttendanceDeviceLimit.isPending
                      }
                      onClick={() =>
                        saveAttendanceDeviceLimit.mutate({
                          ...(attendanceDeviceLimitSetting
                            ? {
                                id: attendanceDeviceLimitSetting.id,
                                expectedVersion:
                                  attendanceDeviceLimitSetting.version,
                              }
                            : {}),
                          category: "业务参数",
                          settingKey: "ATTENDANCE_DEVICE_BINDING_LIMIT",
                          displayName: "考勤设备绑定上限",
                          value: attendanceDeviceLimitDraft,
                          isSensitive: false,
                          remarks:
                            "每个账号允许同时保持启用状态的考勤设备数量；取值范围1至50台。修改并发布后仅影响后续新设备绑定，已有设备不自动停用。",
                        })
                      }
                    >
                      {saveAttendanceDeviceLimit.isPending
                        ? "保存中…"
                        : "保存草稿"}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={
                        !attendanceDeviceLimitSetting ||
                        attendanceDeviceLimitSetting.status !== "draft" ||
                        publishSetting.isPending
                      }
                      onClick={() =>
                        attendanceDeviceLimitSetting &&
                        publishSetting.mutate({
                          id: attendanceDeviceLimitSetting.id,
                          expectedVersion: attendanceDeviceLimitSetting.version,
                        })
                      }
                    >
                      {publishSetting.isPending ? "发布中…" : "发布生效"}
                    </Button>
                  </div>
                  <p className="text-xs text-amber-900">
                    当前状态：
                    {attendanceDeviceLimitSetting?.status === "published"
                      ? "已发布生效"
                      : attendanceDeviceLimitSetting?.status === "draft"
                        ? "有未发布草稿"
                        : "尚未创建，保存后可发布"}{" "}
                    · 配置键：ATTENDANCE_DEVICE_BINDING_LIMIT
                  </p>
                </CardContent>
              </Card>
            ) : null}
            {settingsCategory === "integrations" ? (
              <Suspense
                fallback={
                  <Card className="border-[#d8e3e0] bg-[#f7faf9]">
                    <CardContent className="py-5 text-sm text-slate-600">
                      正在加载短信与通知通道配置…
                    </CardContent>
                  </Card>
                }
              >
                <NotificationChannelSettings />
              </Suspense>
            ) : null}
            {settingsCategory === "media" ? (
              <SettingsDisclosure
                title="阿里云 OSS 照片存储"
                description="仅用于后续上传的现场照片、柴油小票、采购与财务影像。密钥加密托管，历史照片和非影像附件不迁移、不删除。"
                defaultOpen
              >
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#d8e9e5] bg-[#f4faf8] px-3 py-2.5">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      <Checkbox
                        checked={aliyunOssPhotoStorageForm.enabled}
                        onCheckedChange={checked =>
                          setAliyunOssPhotoStorageForm(current => ({
                            ...current,
                            enabled: checked === true,
                          }))
                        }
                      />
                      启用阿里云 OSS 作为新照片存储
                    </label>
                    <Badge
                      variant="outline"
                      className={
                        aliyunOssPhotoStorageConfiguration.data?.configured &&
                        aliyunOssPhotoStorageConfiguration.data?.enabled
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-slate-300 bg-white text-slate-600"
                      }
                    >
                      {aliyunOssPhotoStorageConfiguration.data?.configured
                        ? aliyunOssPhotoStorageConfiguration.data.enabled
                          ? "已启用"
                          : "已保存，未启用"
                        : "待完整配置"}
                    </Badge>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="OSS 地域">
                      <Input
                        value={aliyunOssPhotoStorageForm.region}
                        placeholder="例如 oss-cn-hangzhou"
                        autoComplete="off"
                        onChange={event =>
                          setAliyunOssPhotoStorageForm(current => ({
                            ...current,
                            region: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="OSS Endpoint">
                      <Input
                        type="url"
                        value={aliyunOssPhotoStorageForm.endpoint}
                        placeholder="https://oss-cn-hangzhou.aliyuncs.com"
                        autoComplete="off"
                        onChange={event =>
                          setAliyunOssPhotoStorageForm(current => ({
                            ...current,
                            endpoint: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="Bucket 名称">
                      <Input
                        value={aliyunOssPhotoStorageForm.bucket}
                        placeholder="仅填写 Bucket 名称"
                        autoComplete="off"
                        onChange={event =>
                          setAliyunOssPhotoStorageForm(current => ({
                            ...current,
                            bucket: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="照片对象前缀">
                      <Input
                        value={aliyunOssPhotoStorageForm.objectPrefix}
                        placeholder="photos"
                        autoComplete="off"
                        onChange={event =>
                          setAliyunOssPhotoStorageForm(current => ({
                            ...current,
                            objectPrefix: event.target.value,
                          }))
                        }
                      />
                    </Field>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="AccessKey ID">
                      <Input
                        type="password"
                        value={aliyunOssPhotoStorageForm.accessKeyId}
                        placeholder={
                          aliyunOssPhotoStorageConfiguration.data
                            ?.accessKeyIdConfigured
                            ? "已加密托管；留空保持不变"
                            : "首次配置必填"
                        }
                        autoComplete="new-password"
                        onChange={event =>
                          setAliyunOssPhotoStorageForm(current => ({
                            ...current,
                            accessKeyId: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="AccessKey Secret">
                      <Input
                        type="password"
                        value={aliyunOssPhotoStorageForm.accessKeySecret}
                        placeholder={
                          aliyunOssPhotoStorageConfiguration.data
                            ?.accessKeySecretConfigured
                            ? "已加密托管；留空保持不变"
                            : "首次配置必填"
                        }
                        autoComplete="new-password"
                        onChange={event =>
                          setAliyunOssPhotoStorageForm(current => ({
                            ...current,
                            accessKeySecret: event.target.value,
                          }))
                        }
                      />
                    </Field>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                    请填写标准 Bucket 公网 Endpoint（例如
                    `https://oss-cn-地域.aliyuncs.com`），不要填写 OSS 接入点
                    Endpoint。建议 Bucket
                    保持私有读；系统会为受权用户生成短时预览地址。RAM
                    账号仅需限定到该
                    Bucket/对象前缀的读取与写入权限。保存后密钥不回显、不会出现在配置列表、历史、审计或
                    GitHub 中；编辑时两个密钥留空即可保持原值。
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      className="bg-[#203c48] hover:bg-[#17313b]"
                      disabled={
                        saveAliyunOssPhotoStorageConfiguration.isPending ||
                        !aliyunOssPhotoStorageForm.region.trim() ||
                        !aliyunOssPhotoStorageForm.endpoint.trim() ||
                        !aliyunOssPhotoStorageForm.bucket.trim() ||
                        !aliyunOssPhotoStorageForm.objectPrefix.trim()
                      }
                      onClick={() =>
                        saveAliyunOssPhotoStorageConfiguration.mutate(
                          aliyunOssPhotoStorageForm
                        )
                      }
                    >
                      {saveAliyunOssPhotoStorageConfiguration.isPending
                        ? "正在加密保存…"
                        : aliyunOssPhotoStorageForm.enabled
                          ? "保存并启用照片 OSS"
                          : "保存 OSS 配置"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        testAliyunOssPhotoStorageConnection.isPending ||
                        !aliyunOssPhotoStorageConfiguration.data?.configured
                      }
                      onClick={() => {
                        setAliyunOssPhotoStorageValidation(null);
                        testAliyunOssPhotoStorageConnection.mutate();
                      }}
                    >
                      {testAliyunOssPhotoStorageConnection.isPending
                        ? "正在测试…"
                        : "测试 OSS 连接"}
                    </Button>
                    <span className="text-xs text-slate-500">
                      测试只读取保留探测对象元数据，不上传、覆盖或删除业务照片。
                    </span>
                  </div>
                  {aliyunOssPhotoStorageValidation && (
                    <div
                      role="status"
                      className={
                        aliyunOssPhotoStorageValidation.success
                          ? "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800"
                          : "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900"
                      }
                    >
                      {aliyunOssPhotoStorageValidation.message}
                    </div>
                  )}
                </div>
              </SettingsDisclosure>
            ) : null}
            {settingsCategory === "business" ? (
              <Card className="border-[#d8e3e0]">
                <CardHeader>
                  <CardTitle className="text-base">每日项目站内汇总</CardTitle>
                  <CardDescription>
                    每天按中国标准时间汇总施工日报、收入开支、计量申报与运输装卸数据，并写入项目负责人的站内消息中心。定时任务、运行结果和配置修改均保留审计记录。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-[1.1fr_.8fr_.8fr]">
                    <label className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                      <Checkbox
                        checked={dailyDigestForm.enabled}
                        onCheckedChange={checked =>
                          setDailyDigestForm(current => ({
                            ...current,
                            enabled: Boolean(checked),
                          }))
                        }
                      />
                      启用每日自动汇总
                    </label>
                    <div>
                      <Label>汇总时</Label>
                      <Select
                        value={dailyDigestForm.deliveryHour}
                        onValueChange={value =>
                          setDailyDigestForm(current => ({
                            ...current,
                            deliveryHour: value,
                          }))
                        }
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 24 }, (_, hour) => (
                            <SelectItem
                              key={hour}
                              value={String(hour).padStart(2, "0")}
                            >
                              {String(hour).padStart(2, "0")} 时
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>汇总分</Label>
                      <Select
                        value={dailyDigestForm.deliveryMinute}
                        onValueChange={value =>
                          setDailyDigestForm(current => ({
                            ...current,
                            deliveryMinute: value,
                          }))
                        }
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["00", "15", "30", "45"].map(minute => (
                            <SelectItem key={minute} value={minute}>
                              {minute} 分
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <Checkbox
                      checked={dailyDigestForm.includeEmptyProjects}
                      onCheckedChange={checked =>
                        setDailyDigestForm(current => ({
                          ...current,
                          includeEmptyProjects: Boolean(checked),
                        }))
                      }
                    />
                    无业务数据的项目也生成“无新增数据”站内汇总
                  </label>
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <BusinessStatusBadge
                      status={
                        dailyDigestSettings.data?.enabled
                          ? "active"
                          : "disabled"
                      }
                    />
                    <span>
                      最近尝试：
                      {displayDate(dailyDigestSettings.data?.lastAttemptedAt)}
                    </span>
                    <span>
                      最近完整业务日：
                      {dailyDigestSettings.data?.lastSuccessfulBusinessDate
                        ? new Date(
                            dailyDigestSettings.data.lastSuccessfulBusinessDate
                          )
                            .toISOString()
                            .slice(0, 10)
                        : "—"}
                    </span>
                    {dailyDigestSettings.data?.scheduleCronTaskUid ? (
                      <span className="font-mono">任务已登记</span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="bg-[#203c48] hover:bg-[#17313b]"
                      disabled={saveDailyDigest.isPending}
                      onClick={() =>
                        saveDailyDigest.mutate({
                          enabled: dailyDigestForm.enabled,
                          deliveryHour: Number(dailyDigestForm.deliveryHour),
                          deliveryMinute: Number(
                            dailyDigestForm.deliveryMinute
                          ),
                          includeEmptyProjects:
                            dailyDigestForm.includeEmptyProjects,
                        })
                      }
                    >
                      {dailyDigestForm.enabled
                        ? "保存并启用站内汇总"
                        : "保存并停用站内汇总"}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={
                        !dailyDigestSettings.data?.enabled ||
                        runDailyDigestNow.isPending
                      }
                      onClick={() =>
                        runDailyDigestNow.mutate({
                          businessDate: dailyDigestPreviewDate || undefined,
                        })
                      }
                    >
                      立即生成所选日期站内汇总
                    </Button>
                  </div>
                  <div className="grid gap-3 rounded-xl border border-slate-100 p-3 lg:grid-cols-[1fr_180px_auto]">
                    <div>
                      <Label>预览项目</Label>
                      <Select
                        value={dailyDigestPreviewProjectId || "UNASSIGNED"}
                        onValueChange={value =>
                          setDailyDigestPreviewProjectId(
                            value === "UNASSIGNED" ? "" : value
                          )
                        }
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder="选择项目" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="UNASSIGNED">请选择项目</SelectItem>
                          {(projects.data ?? [])
                            .filter(project => project.status === "active")
                            .map(project => (
                              <SelectItem
                                key={project.id}
                                value={String(project.id)}
                              >
                                {project.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>业务日期</Label>
                      <Input
                        className="mt-1"
                        type="date"
                        value={dailyDigestPreviewDate}
                        onChange={event =>
                          setDailyDigestPreviewDate(event.target.value)
                        }
                      />
                    </div>
                    <Button
                      className="self-end"
                      variant="outline"
                      disabled={
                        !dailyDigestPreviewProjectId ||
                        dailyDigestPreview.isFetching
                      }
                      onClick={() => dailyDigestPreview.refetch()}
                    >
                      刷新预览
                    </Button>
                  </div>
                  {dailyDigestPreview.data ? (
                    <div className="grid gap-2 rounded-xl bg-[#f7faf9] p-3 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <b>施工日报</b>
                        <p className="mt-1">
                          {dailyDigestPreview.data.construction.reportCount} 份
                          · 进度{" "}
                          {
                            dailyDigestPreview.data.construction
                              .averageProgressPercent
                          }
                          %
                        </p>
                      </div>
                      <div>
                        <b>收入 / 开支</b>
                        <p className="mt-1">
                          ¥
                          {displayMoney(
                            dailyDigestPreview.data.finance.incomeAmount
                          )}{" "}
                          / ¥
                          {displayMoney(
                            dailyDigestPreview.data.finance.expenseAmount
                          )}
                        </p>
                      </div>
                      <div>
                        <b>计量申报</b>
                        <p className="mt-1">
                          {dailyDigestPreview.data.measurement.claimCount} 笔 ·
                          ¥
                          {displayMoney(
                            dailyDigestPreview.data.measurement.declaredAmount
                          )}
                        </p>
                      </div>
                      <div>
                        <b>运输闭环</b>
                        <p className="mt-1">
                          {dailyDigestPreview.data.transport.tripCount} 趟 ·
                          装/卸{" "}
                          {dailyDigestPreview.data.transport.loadConfirmedCount}
                          /
                          {
                            dailyDigestPreview.data.transport
                              .unloadConfirmedCount
                          }{" "}
                          · 异常{" "}
                          {dailyDigestPreview.data.transport.exceptionTripCount}
                        </p>
                      </div>
                    </div>
                  ) : dailyDigestPreviewProjectId &&
                    !dailyDigestPreview.isLoading ? (
                    <p className="text-xs text-slate-500">
                      选择项目和业务日期后可查看真实聚合结果；预览不会发送通知。
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
            {settingsCategory === "business" ? (
              <Card className="border-[#d4e2de] bg-[#f5faf8]">
                <CardHeader>
                  <CardTitle className="text-base">统一上级主管审核</CardTitle>
                  <CardDescription>
                    对所有配置为“上级主管审核”的业务统一生效。开启后，施工日报、采购申请和清单采购等主管审核节点会自动通过；关闭后必须由项目上级主管人工审核。会计审核、付款、收入确认、终态锁定和项目权限范围不会被此开关绕过。
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center justify-between gap-4">
                  <label className="flex items-center gap-3">
                    <Checkbox
                      checked={supervisorReviewAutoApproveEnabled}
                      disabled={setSupervisorReviewAutoApprove.isPending}
                      onCheckedChange={checked =>
                        setSupervisorReviewAutoApprove.mutate({
                          enabled: Boolean(checked),
                        })
                      }
                    />
                    <span>
                      <b className="block text-sm text-slate-800">
                        {supervisorReviewAutoApproveEnabled
                          ? "已开启自动通过"
                          : "已关闭，需人工审核"}
                      </b>
                      <span className="mt-1 block text-xs text-slate-600">
                        每次切换即时发布，并写入配置版本与审计日志。
                      </span>
                    </span>
                  </label>
                  <Badge
                    variant="outline"
                    className={
                      supervisorReviewAutoApproveEnabled
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-amber-300 bg-amber-50 text-amber-700"
                    }
                  >
                    {supervisorReviewAutoApproveEnabled
                      ? "自动审核通过"
                      : "人工主管审核"}
                  </Badge>
                </CardContent>
              </Card>
            ) : null}
            {settingsCategory === "media" ? (
              <Card className="border-[#cbddea] bg-[#f8fbff]">
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Camera className="h-4 w-4 text-[#2177d3]" />
                        工程水印信息模板
                      </CardTitle>
                      <CardDescription className="mt-1">
                        按参考图以工程信息卡覆盖在现场照片左下角。此处仅维护字段、顺序和文案；拍摄时间、负责人、项目、定位与天气均由现场采集生成并受审计。
                      </CardDescription>
                    </div>
                    <Badge
                      variant="outline"
                      className="border-[#b8d3eb] bg-white text-[#276da7]"
                    >
                      {evidenceWatermarkTemplate.data?.status === "published"
                        ? `已发布 v${evidenceWatermarkTemplate.data.version}`
                        : "默认模板"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-5 lg:grid-cols-[1.08fr_.92fr]">
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label>水印标题</Label>
                        <Input
                          className="mt-1 bg-white"
                          value={watermarkTemplateForm.title}
                          maxLength={24}
                          onChange={event =>
                            setWatermarkTemplateForm(current => ({
                              ...current,
                              title: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div>
                        <Label>施工单位</Label>
                        <Input
                          className="mt-1 bg-white"
                          value={watermarkTemplateForm.organizationLabel}
                          maxLength={48}
                          onChange={event =>
                            setWatermarkTemplateForm(current => ({
                              ...current,
                              organizationLabel: event.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>
                    <div>
                      <Label>底部防伪文案</Label>
                      <Input
                        className="mt-1 bg-white"
                        value={watermarkTemplateForm.footerLabel}
                        maxLength={48}
                        onChange={event =>
                          setWatermarkTemplateForm(current => ({
                            ...current,
                            footerLabel: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <Label>显示字段与顺序</Label>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        勾选决定是否显示；使用“上移 /
                        下移”控制卡片内顺序。至少保留两项。
                      </p>
                      <div className="mt-2 space-y-2">
                        {WATERMARK_FIELD_OPTIONS.map(option => {
                          const index = watermarkTemplateForm.fields.indexOf(
                            option.id
                          );
                          const selected = index >= 0;
                          return (
                            <div
                              key={option.id}
                              className="flex flex-wrap items-center gap-2 rounded-lg border border-[#d9e6ef] bg-white px-3 py-2"
                            >
                              <Checkbox
                                checked={selected}
                                onCheckedChange={checked =>
                                  setWatermarkTemplateForm(current => {
                                    if (checked)
                                      return {
                                        ...current,
                                        fields: [...current.fields, option.id],
                                      };
                                    if (current.fields.length <= 2) {
                                      toast.error("工程水印至少保留两项信息");
                                      return current;
                                    }
                                    return {
                                      ...current,
                                      fields: current.fields.filter(
                                        field => field !== option.id
                                      ),
                                    };
                                  })
                                }
                              />
                              <span className="min-w-24 flex-1 text-sm font-medium text-slate-700">
                                {option.label}
                              </span>
                              {selected ? (
                                <>
                                  <Badge
                                    variant="outline"
                                    className="border-slate-200"
                                  >
                                    第 {index + 1} 项
                                  </Badge>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={index === 0}
                                    onClick={() =>
                                      setWatermarkTemplateForm(current => {
                                        const fields = [...current.fields];
                                        [fields[index - 1], fields[index]] = [
                                          fields[index],
                                          fields[index - 1],
                                        ];
                                        return { ...current, fields };
                                      })
                                    }
                                  >
                                    上移
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={
                                      index ===
                                      watermarkTemplateForm.fields.length - 1
                                    }
                                    onClick={() =>
                                      setWatermarkTemplateForm(current => {
                                        const fields = [...current.fields];
                                        [fields[index + 1], fields[index]] = [
                                          fields[index],
                                          fields[index + 1],
                                        ];
                                        return { ...current, fields };
                                      })
                                    }
                                  >
                                    下移
                                  </Button>
                                </>
                              ) : (
                                <span className="text-xs text-slate-400">
                                  不显示
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <Button
                      className="bg-[#2177d3] hover:bg-[#185fae]"
                      disabled={
                        saveEvidenceWatermarkTemplate.isPending ||
                        watermarkTemplateForm.fields.length < 2 ||
                        !watermarkTemplateForm.title.trim() ||
                        !watermarkTemplateForm.organizationLabel.trim() ||
                        !watermarkTemplateForm.footerLabel.trim()
                      }
                      onClick={() =>
                        saveEvidenceWatermarkTemplate.mutate({
                          title: watermarkTemplateForm.title,
                          organizationLabel:
                            watermarkTemplateForm.organizationLabel,
                          footerLabel: watermarkTemplateForm.footerLabel,
                          fields: watermarkTemplateForm.fields,
                        })
                      }
                    >
                      {saveEvidenceWatermarkTemplate.isPending
                        ? "正在发布水印模板…"
                        : "保存并发布水印模板"}
                    </Button>
                  </div>
                  <div className="rounded-2xl bg-[linear-gradient(145deg,#c9e4f8,#578fbe_55%,#235176)] p-5 shadow-inner">
                    <p className="mb-3 text-xs font-semibold tracking-[0.12em] text-white/85">
                      现场照片水印预览
                    </p>
                    <div className="min-h-72 rounded-xl bg-[radial-gradient(circle_at_75%_20%,#eaf7ff,transparent_25%),linear-gradient(135deg,#85c5f0,#24689d)] p-4">
                      <div className="mt-24 max-w-[280px] overflow-hidden rounded-md border border-white/80 bg-white/90 shadow-lg">
                        <div className="bg-[#2177d3] px-3 py-2 text-sm font-bold text-white">
                          {watermarkTemplateForm.title || "工程水印"}
                        </div>
                        <div className="space-y-1.5 px-3 py-3 text-xs font-medium leading-5 text-[#263846]">
                          {watermarkTemplateForm.fields.map(field => (
                            <p key={field}>
                              {
                                (
                                  {
                                    capturedAt: "拍摄时间：2026/08/16 13:31",
                                    principal: "施工负责人：现场管理员",
                                    weather: "天气：晴 33℃",
                                    location: "详细地点：当前现场地址",
                                    coordinates: "详细地点：当前现场地址",
                                    organization: `施工单位：${watermarkTemplateForm.organizationLabel || "悦信云智管"}`,
                                    project: "项目名称：当前授权项目",
                                    antiCounterfeit: "防伪编号：归档时生成",
                                  } as Record<string, string>
                                )[field]
                              }
                            </p>
                          ))}
                        </div>
                        <div className="bg-[#2177d3] px-3 py-1.5 text-[10px] font-semibold text-white">
                          {watermarkTemplateForm.footerLabel ||
                            "防伪水印 · 真实时间"}
                        </div>
                      </div>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-slate-600">
                      预览仅展示样式。实际照片将以拍摄当时的管理员、项目、时间、天气和中文详细地址逐张写入像素水印，并同步保存审计元数据。
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : null}
            {settingsCategory === "governance" ? (
              <SettingsDisclosure
                title="配置清单、版本与回滚"
                description="查看非成组配置、选择条目并回溯已发布版本。敏感值仅展示掩码，不提供明文导出。"
              >
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">配置项清单</CardTitle>
                    <CardDescription>
                      敏感值仅以掩码展示。发布后生成版本与审计日志；不提供明文导出。
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {visibleSettings.length ? (
                      visibleSettings.map(item => (
                        <div
                          key={item.id}
                          className={`flex flex-col gap-3 rounded-xl border p-4 transition-colors ${selectedSettingId === item.id ? "border-[#203c48] bg-[#f7faf9]" : "border-slate-100"}`}
                        >
                          <button
                            className="text-left"
                            onClick={() => setSelectedSettingId(item.id)}
                          >
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium">
                                {item.displayName}
                              </p>
                              {item.isSensitive ? (
                                <Badge variant="outline">加密托管</Badge>
                              ) : null}
                              <Badge
                                variant={
                                  item.status === "published"
                                    ? "secondary"
                                    : "outline"
                                }
                              >
                                {item.status === "published"
                                  ? "已发布"
                                  : item.status === "draft"
                                    ? "草稿"
                                    : "已禁用"}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {item.category} · {item.settingKey} · v
                              {item.version} · {item.valuePreview || "未设置值"}
                            </p>
                          </button>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedSettingId(item.id);
                                setSettingForm({
                                  id: item.id,
                                  expectedVersion: item.version,
                                  category: item.category,
                                  settingKey: item.settingKey,
                                  displayName: item.displayName,
                                  value: item.isSensitive
                                    ? ""
                                    : (item.valueJson ?? ""),
                                  isSensitive: item.isSensitive,
                                  remarks: item.remarks ?? "",
                                });
                              }}
                            >
                              编辑
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                item.status === "published" ||
                                publishSetting.isPending
                              }
                              onClick={() =>
                                publishSetting.mutate({
                                  id: item.id,
                                  expectedVersion: item.version,
                                })
                              }
                            >
                              发布
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={testSetting.isPending}
                              onClick={() =>
                                testSetting.mutate({ id: item.id })
                              }
                            >
                              {item.settingKey.startsWith("WECHAT_OFFICIAL_")
                                ? getOfficialAccountTestLabel(item.settingKey)
                                : "校验 / 测试"}
                            </Button>
                            {item.status !== "disabled" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-rose-700 hover:text-rose-800"
                                disabled={disableSetting.isPending}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `确认停用“${item.displayName}”？停用后将保留密文和历史版本，但不再参与业务调用。`
                                    )
                                  )
                                    disableSetting.mutate({
                                      id: item.id,
                                      expectedVersion: item.version,
                                    });
                                }}
                              >
                                停用
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-rose-700 hover:text-rose-800"
                              disabled={removeSetting.isPending}
                              onClick={() =>
                                setSettingDeleteTarget({
                                  id: item.id,
                                  displayName: item.displayName,
                                  settingKey: item.settingKey,
                                  version: item.version,
                                  isSensitive: item.isSensitive,
                                })
                              }
                            >
                              删除
                            </Button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <EmptyState text="暂无有效配置项。已停用配置仅保留在发布历史与审计中，不参与系统调用。" />
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      配置版本与安全回滚
                    </CardTitle>
                    <CardDescription>
                      历史版本不展示密钥明文；回滚后会生成新的已发布版本，并全程记录审计日志。
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {selectedSettingId === undefined ? (
                      <EmptyState text="请选择一条配置查看其发布历史。" />
                    ) : settingHistory.data?.length ? (
                      settingHistory.data.map(item => (
                        <div
                          key={item.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-3"
                        >
                          <div>
                            <p className="text-sm font-medium">
                              {item.operation === "publish"
                                ? "发布版本"
                                : item.operation === "update"
                                  ? "草稿修订"
                                  : "回滚版本"}{" "}
                              · v{item.version}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {formatChinaDateTime(item.createdAt, "时间未知")}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              !selectedSetting || rollbackSetting.isPending
                            }
                            onClick={() => {
                              if (
                                selectedSetting &&
                                window.confirm(
                                  "确认将当前配置回滚至此历史版本？此操作会创建新的发布版本。"
                                )
                              )
                                rollbackSetting.mutate({
                                  settingId: selectedSettingId,
                                  publishLogId: item.id,
                                  expectedVersion: selectedSetting.version,
                                });
                            }}
                          >
                            回滚至此版本
                          </Button>
                        </div>
                      ))
                    ) : (
                      <EmptyState text="该配置尚无已发布历史；发布后即可在此回滚。" />
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">统一配置分类</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {[
                      "基础品牌与多语言",
                      "账号安全与密码策略",
                      "微信公众号服务号与消息模板",
                      "地图 / OCR / 定位连接器",
                      "油卡 / 地磅 / 外部 API",
                      "业务参数与编号规则",
                      "文档影像与归档规则",
                      "运行监控与审计",
                      "发布、回滚与版本",
                    ].map(item => (
                      <div
                        key={item}
                        className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600"
                      >
                        {item}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </SettingsDisclosure>
            ) : null}
          </section>
          <aside
            className={
              settingsCategory === "integrations" ||
              settingsCategory === "governance"
                ? "space-y-4"
                : "hidden"
            }
          >
            <Card
              className={
                settingsCategory === "integrations"
                  ? "border-[#cbded9] bg-[#f4faf8]"
                  : "hidden"
              }
            >
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">
                      新版微信开发者平台接入状态
                    </CardTitle>
                    <CardDescription className="mt-1">
                      服务号开发配置已迁移至“微信开发者平台 → 我的业务 →
                      服务号”。运营、模板选用和网页授权域名仍按微信各业务后台当前可见能力配置。
                    </CardDescription>
                  </div>
                  <a
                    className="inline-flex items-center gap-1 text-xs font-medium text-[#1b5c54] hover:underline"
                    href="https://developers.weixin.qq.com/platform/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开开发者平台
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="rounded-lg border border-[#d7e8e3] bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 font-medium text-slate-800">
                      <KeyRound className="h-4 w-4 text-[#1f6b60]" />
                      开发密钥
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        officialCredentialsReady
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-amber-300 bg-amber-50 text-amber-700"
                      }
                    >
                      {officialCredentialsReady
                        ? "AppID / AppSecret 已发布"
                        : "待发布"}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-xs leading-5 text-slate-600">
                    路径：基础信息 → 开发密钥。AppSecret
                    必须为“启用”状态；重置后旧密钥立即失效。
                  </p>
                </div>
                <div className="rounded-lg border border-[#d7e8e3] bg-white p-3">
                  <div className="flex items-center gap-2 font-medium text-slate-800">
                    <ShieldCheck className="h-4 w-4 text-[#1f6b60]" />
                    API IP 白名单
                  </div>
                  <p className="mt-1.5 text-xs leading-5 text-slate-600">
                    系统已使用受控固定出口。微信后台仅需保留固定出口 IP{" "}
                    <span className="font-mono">35.237.214.196</span>
                    ；无需继续追加托管环境的动态 IP。
                  </p>
                </div>
                <div className="rounded-lg border border-[#d7e8e3] bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-slate-800">
                      网页授权与跳转域名
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        officialBindingReady
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-amber-300 bg-amber-50 text-amber-700"
                      }
                    >
                      {officialBindingReady
                        ? "可发起员工绑定"
                        : "待发布 HTTPS 地址"}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-xs leading-5 text-slate-600">
                    系统跳转地址须发布为
                    HTTPS。网页授权域名在微信公众平台“设置与开发 → 账号设置 →
                    功能设置”中配置，只填域名，不填协议和路径。
                  </p>
                </div>
                <div className="rounded-lg border border-[#d7e8e3] bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-slate-800">
                      模板消息通知
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        officialTemplateReady
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-slate-300 bg-slate-50 text-slate-600"
                      }
                    >
                      {officialTemplateReady
                        ? "业务通知已就绪"
                        : "待开通或选用模板"}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-xs leading-5 text-slate-600">
                    范围通知和每日汇总使用站内消息，不依赖服务号模板。仅在刷卡、审核或状态变更等具体业务即时提醒需要服务号时，才选择符合微信规则的业务模板；员工
                    OAuth 绑定不依赖模板 ID。
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={checkOfficialTemplateCapability.isPending}
                      onClick={() => checkOfficialTemplateCapability.mutate()}
                    >
                      {checkOfficialTemplateCapability.isPending
                        ? "正在检测模板功能…"
                        : "检测模板消息功能插件"}
                    </Button>
                    <Button
                      size="sm"
                      className="bg-[#1f6b60] hover:bg-[#18564e]"
                      disabled={listOfficialTemplates.isPending}
                      onClick={() => listOfficialTemplates.mutate()}
                    >
                      {listOfficialTemplates.isPending
                        ? "正在读取私有模板…"
                        : "读取并选择私有模板"}
                    </Button>
                  </div>
                  {officialTemplateOptions.length ? (
                    <div className="mt-3 space-y-2 rounded-md border border-[#d7e8e3] bg-[#f8fbfa] p-2">
                      {officialTemplateOptions.map(template => {
                        const module =
                          officialTemplateModuleById[template.templateId] ??
                          "transport";
                        return (
                          <div
                            key={template.templateId}
                            className="rounded border border-slate-200 bg-white p-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="font-medium text-slate-800">
                                {template.title}
                              </div>
                              <Badge
                                variant="outline"
                                className={
                                  template.persistentBusinessEligible === false
                                    ? "border-amber-300 bg-amber-50 text-amber-700"
                                    : "border-emerald-300 bg-emerald-50 text-emerald-700"
                                }
                              >
                                {template.persistentBusinessEligible === false
                                  ? "不可用于持续业务通知"
                                  : "可按模块自动映射"}
                              </Badge>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">
                              {template.content}
                            </p>
                            <p className="mt-1 text-[11px] text-slate-500">
                              微信字段：
                              {Object.keys(template.fieldMapping).join("、") ||
                                "未识别"}
                            </p>
                            {template.eligibilityMessage ? (
                              <p className="mt-1 text-[11px] leading-5 text-amber-700">
                                {template.eligibilityMessage}
                              </p>
                            ) : null}
                            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                              <Select
                                value={module}
                                onValueChange={value =>
                                  setOfficialTemplateModuleById(current => ({
                                    ...current,
                                    [template.templateId]:
                                      value as typeof module,
                                  }))
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="transport">
                                    运输刷卡与趟次
                                  </SelectItem>
                                  <SelectItem value="machinery">
                                    机械/车辆维保审核
                                  </SelectItem>
                                  <SelectItem value="purchasing">
                                    采购申请与订单审核
                                  </SelectItem>
                                  <SelectItem value="measurement">
                                    收方、计量与回款
                                  </SelectItem>
                                  <SelectItem value="finance">
                                    财务流水与审计
                                  </SelectItem>
                                  <SelectItem value="labor">
                                    劳务实名与工资
                                  </SelectItem>
                                  <SelectItem value="construction">
                                    施工日报与现场审核
                                  </SelectItem>
                                  <SelectItem value="security">
                                    系统安全与连接告警
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={
                                  bindOfficialModuleTemplate.isPending ||
                                  template.persistentBusinessEligible === false
                                }
                                onClick={() =>
                                  bindOfficialModuleTemplate.mutate({
                                    templateId: template.templateId,
                                    module,
                                  })
                                }
                              >
                                {bindOfficialModuleTemplate.isPending
                                  ? "正在绑定…"
                                  : template.persistentBusinessEligible ===
                                      false
                                    ? "该模板不可用"
                                    : "绑定并自动映射"}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
                <div className="rounded-lg border border-[#d7e8e3] bg-[#f8fbfa] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-slate-800">
                      业务通知模板矩阵
                    </p>
                    <Badge
                      variant="outline"
                      className={
                        officialTemplateCoverage.data?.configured
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-amber-300 bg-amber-50 text-amber-700"
                      }
                    >
                      {officialTemplateCoverage.data?.configured
                        ? "已发布模块模板"
                        : "待绑定业务模板"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    每个业务模块可绑定自己的服务号模板，系统按模板 `.DATA`
                    字段自动映射，不再要求手填内部占位符；范围通知和每日汇总继续使用站内消息。
                  </p>
                  <div className="mt-3 space-y-2">
                    {officialTemplateCoverage.isLoading ? (
                      <p className="text-xs text-slate-500">
                        正在核验各业务模板…
                      </p>
                    ) : (
                      (officialTemplateCoverage.data?.matrix.map(item => (
                        <div
                          key={item.module}
                          className="rounded-md border border-slate-200 bg-white px-3 py-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-slate-800">
                              {item.name}
                            </p>
                            <Badge
                              variant="outline"
                              className={
                                item.ready
                                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                  : "border-amber-300 bg-amber-50 text-amber-700"
                              }
                            >
                              {item.ready ? "已绑定模板" : "待绑定对应模板"}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-slate-600">
                            {item.purpose}
                          </p>
                          {item.templateTitle ? (
                            <p
                              className={`mt-1 text-[11px] ${item.semanticMismatch ? "text-red-700" : "text-emerald-700"}`}
                            >
                              当前模板：{item.templateTitle}
                              {item.semanticMismatch
                                ? "（语义不匹配，已暂停服务号投递）"
                                : ""}
                            </p>
                          ) : (
                            <p className="mt-1 text-[11px] text-amber-700">
                              请从上方私有模板列表选择该业务模块并点击“绑定并自动映射”。
                            </p>
                          )}
                          <p className="mt-1 text-[11px] text-slate-500">
                            事件：{item.events.join("、")}
                          </p>
                        </div>
                      )) ?? (
                        <p className="text-xs text-slate-500">
                          模板矩阵暂不可读取，请先检查已发布服务号配置。
                        </p>
                      ))
                    )}
                  </div>
                </div>
                <p className="rounded-lg bg-[#e8f2ef] px-3 py-2 text-xs leading-5 text-[#28584f]">
                  “绑定关系 → 开放平台”仅在需要与小程序、网站应用或 UnionID
                  体系打通时配置；当前服务号通知与员工网页授权不以此为前置条件。
                </p>
              </CardContent>
            </Card>
            <Card
              className={
                settingsCategory === "integrations"
                  ? "border-[#d8e3e0] bg-[#f7faf9]"
                  : "hidden"
              }
            >
              <CardHeader>
                <CardTitle className="text-base">系统内服务号配置</CardTitle>
                <CardDescription>
                  五项基础参数在此一次填写、一次保存并自动校验。首次配置请完整填写；后续只修改公开参数时，两个密钥留空即可保留已加密的现有值。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="space-y-3"
                  onSubmit={event => {
                    event.preventDefault();
                    setOfficialAccountConfigurationValidation(null);
                    saveOfficialAccountConfiguration.mutate(
                      officialAccountConfigurationForm
                    );
                  }}
                >
                  <Field label="微信公众服务号 AppID">
                    <Input
                      value={officialAccountConfigurationForm.appId}
                      placeholder="填写服务号 AppID"
                      autoComplete="off"
                      onChange={event =>
                        setOfficialAccountConfigurationForm(current => ({
                          ...current,
                          appId: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="微信公众服务号 AppSecret">
                    <Input
                      type="password"
                      value={officialAccountConfigurationForm.appSecret}
                      placeholder={
                        publishedOfficialSettingKeys.has(
                          "WECHAT_OFFICIAL_APP_SECRET"
                        )
                          ? "已安全托管；留空保持不变"
                          : "首次必填"
                      }
                      autoComplete="new-password"
                      onChange={event =>
                        setOfficialAccountConfigurationForm(current => ({
                          ...current,
                          appSecret: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="公众号业务跳转地址">
                    <Input
                      type="url"
                      value={officialAccountConfigurationForm.appUrl}
                      placeholder="https://example.com"
                      onChange={event =>
                        setOfficialAccountConfigurationForm(current => ({
                          ...current,
                          appUrl: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="微信 API 固定出口网关地址">
                    <Input
                      type="url"
                      value={officialAccountConfigurationForm.egressUrl}
                      placeholder="https://wechat-egress.example.com"
                      onChange={event =>
                        setOfficialAccountConfigurationForm(current => ({
                          ...current,
                          egressUrl: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="固定出口网关签名密钥">
                    <Input
                      type="password"
                      value={
                        officialAccountConfigurationForm.egressSigningSecret
                      }
                      placeholder={
                        publishedOfficialSettingKeys.has(
                          "WECHAT_OFFICIAL_EGRESS_SHARED_SECRET"
                        )
                          ? "已安全托管；留空保持不变"
                          : "首次必填"
                      }
                      autoComplete="new-password"
                      onChange={event =>
                        setOfficialAccountConfigurationForm(current => ({
                          ...current,
                          egressSigningSecret: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <p className="rounded-lg bg-white/80 px-3 py-2 text-xs leading-5 text-slate-600">
                    密钥仅在服务端加密保存，不会回显、写入日志或出现在版本记录中。保存后系统会自动校验服务号凭据，不会向员工发送测试消息。
                  </p>
                  <Button
                    type="submit"
                    className="min-h-11 w-full bg-[#203c48] hover:bg-[#17313b]"
                    disabled={
                      saveOfficialAccountConfiguration.isPending ||
                      !officialAccountConfigurationForm.appId.trim() ||
                      !officialAccountConfigurationForm.appUrl.trim() ||
                      !officialAccountConfigurationForm.egressUrl.trim()
                    }
                  >
                    {saveOfficialAccountConfiguration.isPending
                      ? "正在保存并校验…"
                      : "保存并校验服务号配置"}
                  </Button>
                  {officialAccountConfigurationValidation ? (
                    <div
                      className={`rounded-lg border px-3 py-2 text-xs leading-5 ${officialAccountConfigurationValidation.success ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}
                    >
                      {officialAccountConfigurationValidation.success
                        ? "校验通过："
                        : "需要处理："}
                      {officialAccountConfigurationValidation.message}
                    </div>
                  ) : null}
                </form>
              </CardContent>
            </Card>
            <Card
              className={
                settingsCategory === "integrations"
                  ? "border-[#cbded9] bg-[#f4faf8]"
                  : "hidden"
              }
            >
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">
                      域名与消息推送配置
                    </CardTitle>
                    <CardDescription className="mt-1">
                      对应微信公众平台“域名与消息推送配置 →
                      消息推送”。以后更换服务号或重置
                      Token，可直接在这里维护，不再依赖服务器临时改配置。
                    </CardDescription>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      officialMessagePushConfiguration.data?.configured
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-amber-300 bg-amber-50 text-amber-700"
                    }
                  >
                    {officialMessagePushConfiguration.data?.configured
                      ? "可保存微信后台"
                      : "待配置"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-xl border border-[#d7e8e3] bg-white p-3 text-sm text-slate-700">
                  <div className="grid gap-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-500">
                        微信后台 URL
                      </p>
                      <p className="mt-1 break-all font-mono text-xs text-[#1f5e55]">
                        {officialMessagePushConfiguration.data?.callbackUrl ||
                          "请先发布公众号业务跳转地址"}
                      </p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <p>
                        <span className="text-slate-400">Token：</span>
                        {officialMessagePushConfiguration.data?.tokenConfigured
                          ? officialMessagePushConfiguration.data
                              .tokenPreview || "已加密托管"
                          : "未配置"}
                      </p>
                      <p>
                        <span className="text-slate-400">EncodingAESKey：</span>
                        {officialMessagePushConfiguration.data
                          ?.encodingAesKeyConfigured
                          ? officialMessagePushConfiguration.data
                              .encodingAesKeyPreview || "已加密托管"
                          : "明文模式可留空"}
                      </p>
                      <p>
                        <span className="text-slate-400">加解密方式：</span>
                        {officialMessagePushConfiguration.data?.mode ||
                          "明文模式"}
                      </p>
                      <p>
                        <span className="text-slate-400">数据格式：</span>
                        {officialMessagePushConfiguration.data?.dataFormat ||
                          "XML"}
                      </p>
                    </div>
                    <p className="rounded-lg bg-[#eef7f4] px-3 py-2 text-xs leading-5 text-[#28584f]">
                      微信后台保存时，URL 填上方地址，Token 和 EncodingAESKey
                      填本系统保存的同一组值，消息加解密方式选择“明文模式”，数据格式选择“XML”。明文模式下
                      EncodingAESKey
                      不参与验签，但保留配置入口便于微信页面强制填写或后续切换加密模式。
                    </p>
                    <p className="text-xs text-slate-500">
                      当前状态：
                      {officialMessagePushConfiguration.data?.statusText ||
                        "正在读取配置状态…"}
                    </p>
                  </div>
                </div>
                <form
                  className="space-y-3"
                  onSubmit={event => {
                    event.preventDefault();
                    setOfficialAccountMessagePushValidation(null);
                    saveOfficialAccountMessagePushConfiguration.mutate(
                      officialAccountMessagePushForm
                    );
                  }}
                >
                  <Field label="消息推送 Token">
                    <Input
                      type="password"
                      value={officialAccountMessagePushForm.eventToken}
                      placeholder={
                        officialMessagePushConfiguration.data?.tokenConfigured
                          ? "已安全托管；留空保持不变"
                          : "填写 3–32 位英文或数字"
                      }
                      autoComplete="new-password"
                      maxLength={32}
                      onChange={event =>
                        setOfficialAccountMessagePushForm(current => ({
                          ...current,
                          eventToken: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="EncodingAESKey">
                    <Input
                      type="password"
                      value={officialAccountMessagePushForm.encodingAesKey}
                      placeholder={
                        officialMessagePushConfiguration.data
                          ?.encodingAesKeyConfigured
                          ? "已安全托管；留空保持不变"
                          : "明文模式可留空；微信页面要求时填 43 位英文数字"
                      }
                      autoComplete="new-password"
                      maxLength={43}
                      onChange={event =>
                        setOfficialAccountMessagePushForm(current => ({
                          ...current,
                          encodingAesKey: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="submit"
                      className="bg-[#203c48] hover:bg-[#17313b]"
                      disabled={
                        saveOfficialAccountMessagePushConfiguration.isPending ||
                        (!officialAccountMessagePushForm.eventToken.trim() &&
                          !officialMessagePushConfiguration.data
                            ?.tokenConfigured)
                      }
                    >
                      {saveOfficialAccountMessagePushConfiguration.isPending
                        ? "正在保存…"
                        : "保存三项参数"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        !officialMessagePushConfiguration.data?.configured ||
                        testOfficialAccountMessagePushConfiguration.isPending
                      }
                      onClick={() =>
                        testOfficialAccountMessagePushConfiguration.mutate()
                      }
                    >
                      {testOfficialAccountMessagePushConfiguration.isPending
                        ? "正在校验…"
                        : "校验回调 200"}
                    </Button>
                  </div>
                  {officialAccountMessagePushValidation ? (
                    <div
                      className={`rounded-lg border px-3 py-2 text-xs leading-5 ${officialAccountMessagePushValidation.success ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}
                    >
                      {officialAccountMessagePushValidation.success
                        ? "校验通过："
                        : "需要处理："}
                      {officialAccountMessagePushValidation.message}
                    </div>
                  ) : null}
                </form>
              </CardContent>
            </Card>
            <Card
              className={
                settingsCategory === "integrations"
                  ? "border-[#d4ddeb] bg-[#f8faff]"
                  : "hidden"
              }
            >
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Sparkles className="h-4 w-4 text-[#445dd1]" />
                      AI 模型 API 接入
                    </CardTitle>
                    <CardDescription className="mt-1">
                      用于 AI 项目风控的管理摘要。支持兼容 OpenAI Chat
                      Completions 的公开 HTTPS
                      API；风险扫描、通知和整改不依赖该接口，调用失败会自动回退。
                    </CardDescription>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      externalAiConfiguration.data?.enabled
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : externalAiConfiguration.data?.configured
                          ? "border-amber-300 bg-amber-50 text-amber-700"
                          : "border-slate-300 bg-white text-slate-600"
                    }
                  >
                    {externalAiConfiguration.data?.enabled
                      ? "已启用外部 AI"
                      : externalAiConfiguration.data?.configured
                        ? "已配置，未启用"
                        : "待配置"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <form
                  className="space-y-3"
                  onSubmit={event => {
                    event.preventDefault();
                    setExternalAiApiValidation(null);
                    saveExternalAiConfiguration.mutate(
                      externalAiApiConfigurationForm
                    );
                  }}
                >
                  <Field label="AI API 基础地址">
                    <Input
                      type="url"
                      value={externalAiApiConfigurationForm.baseUrl}
                      placeholder="https://api.example.com/v1"
                      autoComplete="off"
                      onChange={event =>
                        setExternalAiApiConfigurationForm(current => ({
                          ...current,
                          baseUrl: event.target.value,
                        }))
                      }
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      填写兼容 OpenAI 的 v1 根地址；系统会调用其{" "}
                      <code>/models</code> 和 <code>/chat/completions</code>{" "}
                      端点。
                    </p>
                  </Field>
                  <Field label="模型名称">
                    <Input
                      value={externalAiApiConfigurationForm.model}
                      placeholder="例如：gpt-4o-mini 或您的模型 ID"
                      autoComplete="off"
                      onChange={event =>
                        setExternalAiApiConfigurationForm(current => ({
                          ...current,
                          model: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="AI API Key">
                    <Input
                      type="password"
                      value={externalAiApiConfigurationForm.apiKey}
                      placeholder={
                        externalAiConfiguration.data?.apiKeyConfigured
                          ? `已安全托管（${externalAiConfiguration.data.apiKeyPreview ?? "已配置"}）；留空保持不变`
                          : "首次配置必须填写 API Key"
                      }
                      autoComplete="new-password"
                      onChange={event =>
                        setExternalAiApiConfigurationForm(current => ({
                          ...current,
                          apiKey: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <label className="flex items-start gap-2 rounded-lg border border-[#d9e3f6] bg-white/80 px-3 py-2 text-sm text-slate-700">
                    <Checkbox
                      className="mt-0.5"
                      checked={externalAiApiConfigurationForm.enabled}
                      onCheckedChange={checked =>
                        setExternalAiApiConfigurationForm(current => ({
                          ...current,
                          enabled: checked === true,
                        }))
                      }
                    />
                    <span>
                      <b>启用外部 AI 摘要</b>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">
                        启用后，AI
                        风控仅发送脱敏风险计数和费用分类金额；连接失败时会改用系统内置
                        AI，再降级为规则摘要。
                      </span>
                    </span>
                  </label>
                  <p className="rounded-lg bg-white/80 px-3 py-2 text-xs leading-5 text-slate-600">
                    API Key 采用服务端 AES-GCM
                    加密保存，不会回显、写入前端代码、导出文件或审计明文。连接校验仅请求模型目录，不发送任何项目业务数据。
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="submit"
                      className="min-h-11 flex-1 bg-[#445dd1] hover:bg-[#364bb2]"
                      disabled={
                        saveExternalAiConfiguration.isPending ||
                        !externalAiApiConfigurationForm.baseUrl.trim() ||
                        !externalAiApiConfigurationForm.model.trim() ||
                        (!externalAiApiConfigurationForm.apiKey.trim() &&
                          !externalAiConfiguration.data?.apiKeyConfigured)
                      }
                    >
                      {saveExternalAiConfiguration.isPending
                        ? "正在加密保存…"
                        : "保存 AI API 配置"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 sm:w-auto"
                      disabled={
                        testExternalAiConfiguration.isPending ||
                        !externalAiConfiguration.data?.configured
                      }
                      onClick={() => {
                        setExternalAiApiValidation(null);
                        testExternalAiConfiguration.mutate();
                      }}
                    >
                      {testExternalAiConfiguration.isPending
                        ? "正在校验…"
                        : "校验 API 连接"}
                    </Button>
                  </div>
                  {externalAiApiValidation ? (
                    <div className="rounded-lg border border-[#c9d9f5] bg-[#edf3ff] px-3 py-2 text-xs leading-5 text-[#294b89]">
                      {externalAiApiValidation}
                    </div>
                  ) : null}
                </form>
              </CardContent>
            </Card>
            <Card
              className={
                settingsCategory === "integrations"
                  ? "border-[#d8e3e0] bg-[#f7faf9]"
                  : "hidden"
              }
            >
              <CardHeader>
                <CardTitle className="text-base">企业身份账号恢复</CardTitle>
                <CardDescription>
                  仅配置身份提供方公开 HTTPS
                  恢复页面。系统不保存企业密码，登录页和个人中心将通过受控端点跳转至该地址。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  className="w-full border-[#203c48] text-[#203c48]"
                  onClick={() =>
                    setSettingForm({
                      category: "账号安全",
                      settingKey: "IDENTITY_PROVIDER_RECOVERY_URL",
                      displayName: "企业身份平台账号恢复地址",
                      value: "",
                      isSensitive: false,
                      remarks:
                        "仅限企业统一身份提供方的账号找回或密码重置页面；保存草稿后需发布才会对用户生效。",
                    })
                  }
                >
                  填入身份恢复地址模板
                </Button>
              </CardContent>
            </Card>
            <Card
              className={
                settingsCategory === "governance"
                  ? "border-[#d8e3e0]"
                  : "hidden"
              }
            >
              <CardHeader>
                <CardTitle className="text-base">其它系统参数</CardTitle>
                <CardDescription>
                  服务号五项配置请使用上方统一表单；这里仅用于按需维护其它系统参数、业务规则或外部连接器。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <details className="group">
                  <summary className="flex min-h-11 cursor-pointer items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-[#203c48] marker:hidden">
                    {settingForm.id
                      ? "正在编辑其它配置草稿"
                      : "展开维护其它系统参数"}
                    <span className="text-xs text-slate-500 group-open:hidden">
                      按需展开
                    </span>
                    <span className="hidden text-xs text-slate-500 group-open:inline">
                      收起
                    </span>
                  </summary>
                  <div className="mt-3 space-y-3">
                    <div>
                      <Label>配置分类</Label>
                      <Select
                        value={settingForm.category}
                        onValueChange={value =>
                          setSettingForm({ ...settingForm, category: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="账号安全">
                            账号安全与身份平台
                          </SelectItem>
                          <SelectItem value="微信公众号服务号">
                            微信公众号服务号
                          </SelectItem>
                          <SelectItem value="公众号消息模板">
                            公众号消息模板
                          </SelectItem>
                          <SelectItem value="外部API">
                            外部 API 连接器
                          </SelectItem>
                          <SelectItem value="业务参数">
                            业务参数与计价规则
                          </SelectItem>
                          <SelectItem value="文档影像">
                            文档影像与归档
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>配置键</Label>
                      <Input
                        value={settingForm.settingKey}
                        disabled={Boolean(settingForm.id)}
                        placeholder="WECHAT_OFFICIAL_APP_ID"
                        onChange={event => {
                          const settingKey = event.target.value.toUpperCase();
                          setSettingForm({
                            ...settingForm,
                            settingKey,
                            isSensitive: resolveOfficialAccountSensitivity(
                              settingKey,
                              settingForm.isSensitive
                            ),
                          });
                        }}
                      />
                    </div>
                    <div>
                      <Label>显示名称（仅系统内标签）</Label>
                      <Input
                        value={settingForm.displayName}
                        placeholder="微信公众号服务号 AppID"
                        onChange={event =>
                          setSettingForm({
                            ...settingForm,
                            displayName: event.target.value,
                          })
                        }
                      />
                      <p className="mt-1 text-xs text-slate-500">
                        不要将 AppID、AppSecret、模板 ID
                        填在这里；请填入下方“配置值”。
                      </p>
                    </div>
                    <div>
                      <Label>配置值</Label>
                      <Input
                        value={settingForm.value}
                        type={settingForm.isSensitive ? "password" : "text"}
                        placeholder={
                          settingForm.id && settingForm.isSensitive
                            ? "留空保留现有加密值；输入完整新值以替换"
                            : "输入值或密钥"
                        }
                        onChange={event =>
                          setSettingForm({
                            ...settingForm,
                            value: event.target.value,
                          })
                        }
                      />
                      {settingForm.id && settingForm.isSensitive ? (
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          为保护密钥，系统不会回显现有值。留空仅更新名称、分类或备注；填写完整新值才会替换。
                        </p>
                      ) : null}
                    </div>
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <Checkbox
                        checked={settingForm.isSensitive}
                        disabled={
                          Boolean(settingForm.id) ||
                          settingForm.settingKey.startsWith("WECHAT_OFFICIAL_")
                        }
                        onCheckedChange={checked =>
                          setSettingForm({
                            ...settingForm,
                            isSensitive: Boolean(checked),
                          })
                        }
                      />
                      按敏感密钥加密托管
                      {settingForm.settingKey.startsWith("WECHAT_OFFICIAL_") ? (
                        <span className="text-xs text-slate-400">
                          （服务号字段按安全规则自动设置）
                        </span>
                      ) : null}
                    </label>
                    <div>
                      <Label>备注</Label>
                      <Input
                        value={settingForm.remarks}
                        placeholder="用途、回调地址或维护说明"
                        onChange={event =>
                          setSettingForm({
                            ...settingForm,
                            remarks: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        className="flex-1 bg-[#203c48] hover:bg-[#17313b]"
                        disabled={
                          !settingForm.settingKey ||
                          !settingForm.displayName ||
                          (!settingForm.value &&
                            !(settingForm.id && settingForm.isSensitive)) ||
                          saveSetting.isPending
                        }
                        onClick={() => saveSetting.mutate(settingForm)}
                      >
                        {settingForm.id ? "保存修订草稿" : "保存草稿"}
                      </Button>
                      {settingForm.id ? (
                        <Button
                          variant="outline"
                          onClick={() => setSettingForm(EMPTY_SETTING_FORM)}
                        >
                          取消编辑
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </details>
              </CardContent>
            </Card>
            <AlertDialog
              open={Boolean(settingDeleteTarget)}
              onOpenChange={open => {
                if (!open) setSettingDeleteTarget(null);
              }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认删除配置？</AlertDialogTitle>
                  <AlertDialogDescription>
                    将删除“{settingDeleteTarget?.displayName}”（
                    {settingDeleteTarget?.settingKey}）。
                    {settingDeleteTarget?.isSensitive
                      ? "系统会同步抹除当前密文及历史快照中的可恢复内容；"
                      : "系统会同步抹除当前值及历史快照中的可恢复内容；"}
                    保留的审计记录仅包含操作标识，不含配置值。此操作不可恢复。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={removeSetting.isPending}>
                    取消
                  </AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-rose-700 hover:bg-rose-800"
                    disabled={!settingDeleteTarget || removeSetting.isPending}
                    onClick={() => {
                      if (settingDeleteTarget)
                        removeSetting.mutate({
                          id: settingDeleteTarget.id,
                          expectedVersion: settingDeleteTarget.version,
                        });
                    }}
                  >
                    确认删除
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </aside>
        </div>
      </div>
    );
  };

  const renderAudit = () => (
    <AdminAuditWorkspace
      audits={audits.data ?? []}
      integrity={auditIntegrity.data}
      isIntegrityLoading={auditIntegrity.isLoading}
      isRefreshing={auditIntegrity.isFetching || sensitiveAccesses.isFetching}
      sensitiveAccesses={sensitiveAccesses.data ?? []}
      onRefresh={() => {
        void auditIntegrity.refetch();
        void sensitiveAccesses.refetch();
      }}
    />
  );

  /** 微信登录台账只展示可读状态和业务范围；OpenID、令牌及设备原始指纹始终不进入浏览器。 */
  const renderWechatLogin = () => {
    const rows = wechatLogins.data ?? [];
    const activeCount = rows.filter(
      item => item.bindingStatus === "active"
    ).length;
    const needsActionCount = rows.filter(item =>
      ["unsubscribed", "revoked", "disabled"].includes(item.bindingStatus)
    ).length;
    const statusLabel = new Proxy<Record<string, string>>(
      {
        active: "已绑定",
        pending: "待完成",
        unsubscribed: "未关注服务号",
        revoked: "已解除",
        disabled: "已停用",
      },
      {
        get: (labels, status) =>
          typeof status === "string" ? (labels[status] ?? "待核验") : undefined,
      }
    );
    const loginModeLabel: Record<string, string> = {
      pc: "仅 PC",
      mobile: "仅手机",
      both: "PC + 手机",
    };
    return (
      <div className="space-y-6">
        <div>
          <p className="text-sm font-medium text-[#203c48]">
            微信公众号服务号 · 身份治理
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            微信登录管理
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            集中核验微信 OAuth
            授权、服务号关注状态、岗位范围和匿名设备摘要。仅超级管理员可解除绑定；解除后人员须在微信内重新授权。
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard
            title="已绑定账号"
            value={activeCount}
            description="可接收服务号业务通知"
            icon={KeyRound}
          />
          <MetricCard
            title="需处理状态"
            value={needsActionCount}
            description="未关注、已解除或已停用"
            icon={ShieldCheck}
          />
          <MetricCard
            title="绑定台账"
            value={rows.length}
            description="不展示 OpenID、令牌或设备指纹"
            icon={UsersRound}
          />
        </div>
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">微信授权与登录台账</CardTitle>
              <CardDescription>
                姓名、职务、角色、部门/项目范围和最近状态均为服务端投影；设备仅显示可读摘要。
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => wechatLogins.refetch()}
              disabled={wechatLogins.isFetching}
            >
              刷新台账
            </Button>
          </CardHeader>
          <CardContent>
            {wechatLogins.isLoading ? (
              <EmptyState text="正在读取微信授权登录台账…" />
            ) : wechatLogins.isError ? (
              <EmptyState text="暂无法读取微信登录台账，请确认当前账号具有超级管理员权限后重试。" />
            ) : rows.length ? (
              <div className="space-y-3">
                {rows.map(item => (
                  <div
                    key={item.userId}
                    className="rounded-xl border border-slate-200 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-slate-900">
                            {item.displayName ||
                              item.localUsername ||
                              "未命名人员"}
                          </p>
                          <Badge
                            className={
                              item.bindingStatus === "active"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-amber-50 text-amber-700"
                            }
                          >
                            {statusLabel[item.bindingStatus] ??
                              getBusinessStatusLabel(item.bindingStatus)}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          职务：{item.positionName || "未配置"} · 登录终端：
                          {loginModeLabel[item.loginMode] ?? "按账号策略"} ·
                          身份来源：
                          {item.bindingSource === "wechat_oauth"
                            ? "微信 OAuth"
                            : "管理员核验"}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-rose-200 text-rose-700 hover:bg-rose-50"
                        disabled={
                          item.bindingStatus === "revoked" ||
                          revokeWechatBinding.isPending
                        }
                        onClick={() =>
                          setWechatBindingActionTarget({
                            userId: item.userId,
                            displayName:
                              item.displayName ||
                              item.localUsername ||
                              "该人员",
                          })
                        }
                      >
                        解除绑定
                      </Button>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-slate-600 md:grid-cols-2 xl:grid-cols-4">
                      <p>
                        <span className="text-slate-400">岗位：</span>
                        {item.roleNames.length
                          ? item.roleNames.join("、")
                          : "未授权"}
                      </p>
                      <p>
                        <span className="text-slate-400">范围：</span>
                        {item.scopeNames.length
                          ? item.scopeNames.join("、")
                          : "未配置"}
                      </p>
                      <p>
                        <span className="text-slate-400">最近登录：</span>
                        {displayDate(item.lastSignedIn)}
                      </p>
                      <p>
                        <span className="text-slate-400">最近核验：</span>
                        {displayDate(item.lastVerifiedAt)}
                      </p>
                      <p>
                        <span className="text-slate-400">绑定时间：</span>
                        {displayDate(item.boundAt)}
                      </p>
                      <p>
                        <span className="text-slate-400">设备摘要：</span>
                        {item.deviceLabel || "未绑定考勤设备"}
                      </p>
                      <p>
                        <span className="text-slate-400">设备最近使用：</span>
                        {displayDate(item.deviceLastUsedAt)}
                      </p>
                      <p>
                        <span className="text-slate-400">投递异常：</span>
                        {item.failureCount
                          ? `${item.failureCount} 次，最近 ${displayDate(item.lastFailureAt)}`
                          : "无"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="尚无微信授权绑定记录。人员可在移动端“我的”中完成服务号 OAuth 绑定后在此出现。" />
            )}
          </CardContent>
        </Card>
        <AlertDialog
          open={Boolean(wechatBindingActionTarget)}
          onOpenChange={open => {
            if (!open) setWechatBindingActionTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认解除微信授权绑定？</AlertDialogTitle>
              <AlertDialogDescription>
                将解除“{wechatBindingActionTarget?.displayName}
                ”的微信服务号身份关联。该人员将无法继续接收服务号业务通知，直到其在移动端重新完成微信授权绑定。岗位、项目范围和业务数据不会被修改。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={revokeWechatBinding.isPending}>
                取消
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-rose-700 hover:bg-rose-800"
                disabled={
                  !wechatBindingActionTarget || revokeWechatBinding.isPending
                }
                onClick={() => {
                  if (wechatBindingActionTarget)
                    revokeWechatBinding.mutate({
                      userId: wechatBindingActionTarget.userId,
                    });
                }}
              >
                确认解除
              </AlertDialogAction>
            </AlertDialogFooter>
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
          <Select
            value={businessWorkspaceProjectId || "UNASSIGNED"}
            onValueChange={value => {
              if (
                constructionReportEditor ||
                machineDialogOpen ||
                machineDailyOperationDialogOpen ||
                machineCostDialogOpen ||
                machineStatementDialogOpen ||
                inventoryTransactionDialogOpen ||
                purchaseSpreadsheetImportOpen ||
                machineryPaymentFormOpen ||
                hasWorkspaceDraft
              ) {
                toast.info(
                  "请先保存或关闭当前录入窗口，再切换项目，避免资料关联到错误项目"
                );
                return;
              }
              setBusinessWorkspaceProjectId(
                value === "UNASSIGNED" ? "" : value
              );
            }}
          >
            <SelectTrigger id="business-workspace-project" className="mt-1">
              <SelectValue placeholder="选择已授权项目" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="UNASSIGNED">请选择项目</SelectItem>
              {(projects.data ?? [])
                .filter(project => project.status !== "archived")
                .map(project => (
                  <SelectItem key={project.id} value={String(project.id)}>
                    {project.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[260px] flex-[2]">
          <p className="text-sm font-medium text-slate-800">{title}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => projects.refetch()}
          disabled={projects.isFetching}
        >
          刷新项目
        </Button>
      </CardContent>
    </Card>
  );

  const renderConstruction = () => {
    const editorCanEdit =
      isEditableConstructionReport(constructionReportEditor) &&
      (constructionReportEditor?.id
        ? Boolean(constructionEditorCapabilities.data?.canEdit)
        : Boolean(constructionEditorCapabilities.data?.canCreate)) &&
      constructionReportEditor?.projectId === workspaceProjectId;
    const openConstructionEditor = (item?: ConstructionWorkspaceReport) => {
      const next: ConstructionReportEditor = item
        ? {
            id: item.id,
            projectId: workspaceProjectId,
            status: item.status,
            reportDate: toBusinessDateInput(item.reportDate),
            workArea: item.workArea,
            weather: item.weather,
            workContent: item.workContent,
            safetyNotes: item.safetyNotes ?? "",
            issueNotes: item.issueNotes ?? "",
            progressPercent: String(item.progressPercent),
          }
        : {
            projectId: workspaceProjectId,
            status: "draft",
            reportDate: toChinaDateInput(),
            workArea: "",
            weather: "other",
            workContent: "",
            safetyNotes: "",
            issueNotes: "",
            progressPercent: "0",
          };
      setConstructionEditorSnapshot(JSON.stringify(next));
      setConstructionReportEditor(next);
    };
    const closeConstructionEditor = () => {
      if (saveConstructionReport.isPending) return;
      if (
        constructionEditorDirty &&
        !window.confirm("施工日报有未保存修改，关闭将放弃本次内容，是否继续？")
      )
        return;
      setConstructionReportEditor(null);
      setConstructionEditorSnapshot("");
    };
    return (
      <div className="w-full min-w-0 space-y-6">
        <div>
          <p className="text-sm font-medium text-[#203c48]">
            施工执行 · 真实业务台账
          </p>
          <h1 className="mt-1 text-2xl font-semibold">施工日报与现场进度</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            四栏目使用同一服务端授权筛选。保留原日报录入与状态流程，不重写历史。
          </p>
        </div>
        <Card>
          <CardContent className="grid w-full min-w-0 gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <Label htmlFor="construction-workspace-project">当前项目</Label>
              <Select
                value={businessWorkspaceProjectId || "UNASSIGNED"}
                onValueChange={value => {
                  if (
                    saveConstructionReport.isPending ||
                    transitionConstructionReport.isPending
                  ) {
                    toast.info("施工日报正在保存或处理，请完成后再切换项目");
                    return;
                  }
                  if (
                    constructionEditorDirty &&
                    !window.confirm(
                      "施工日报有未保存修改，切换项目将放弃本次内容，是否继续？"
                    )
                  )
                    return;
                  setConstructionReportEditor(null);
                  setConstructionEditorSnapshot("");
                  setBusinessWorkspaceProjectId(
                    value === "UNASSIGNED" ? "" : value
                  );
                }}
              >
                <SelectTrigger
                  id="construction-workspace-project"
                  className="mt-1 w-full min-w-0"
                >
                  <SelectValue placeholder="选择已授权项目" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UNASSIGNED">请选择项目</SelectItem>
                  {(projects.data ?? []).map(project => (
                    <SelectItem key={project.id} value={String(project.id)}>
                      {project.name}
                      {project.status === "archived" ? "（归档项目）" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={projects.isFetching}
              onClick={() => void projects.refetch()}
            >
              刷新项目
            </Button>
          </CardContent>
        </Card>
        <ConstructionWorkspace
          projectId={workspaceProjectId}
          projectName={selectedWorkspaceProject?.name}
          active={canQuery && isConstruction && hasBusinessWorkspaceProject}
          onCreate={() => openConstructionEditor()}
          onEdit={openConstructionEditor}
          transitionPending={transitionConstructionReport.isPending}
          onTransition={(report, nextStatus) => {
            const labels = {
              submitted: "提交审核",
              approved: "审核通过",
              rejected: "退回修改",
              locked: "归档锁定",
              draft: "草稿",
            };
            if (
              window.confirm(
                `确认对“${report.workArea}”执行${labels[nextStatus]}？状态变更仍由服务端复核原权限。`
              )
            )
              transitionConstructionReport.mutate({
                id: report.id,
                projectId: workspaceProjectId,
                nextStatus,
              });
          }}
        />
        <Dialog
          open={Boolean(constructionReportEditor)}
          onOpenChange={open => {
            if (!open) closeConstructionEditor();
          }}
        >
          <DialogContent className="max-h-[88vh] w-[calc(100vw-3rem)] max-w-5xl xl:max-w-6xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {constructionReportEditor?.id
                  ? "施工日报查看与编辑"
                  : "新建施工日报"}
              </DialogTitle>
              <DialogDescription>
                {editorCanEdit
                  ? "保留原日报表单。保存后服务端重新校验权限、项目范围和草稿/退回状态。"
                  : "当前账号或日报状态不允许修改，仅只读查看；完整审核与影像请使用列表详情。"}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="日报日期">
                  <Input
                    type="date"
                    value={constructionReportEditor?.reportDate ?? ""}
                    disabled={!editorCanEdit}
                    onChange={event =>
                      setConstructionReportEditor(current =>
                        current
                          ? { ...current, reportDate: event.target.value }
                          : current
                      )
                    }
                  />
                </Field>
                <Field label="天气">
                  <Select
                    value={constructionReportEditor?.weather ?? "other"}
                    disabled={!editorCanEdit}
                    onValueChange={weather =>
                      setConstructionReportEditor(current =>
                        current
                          ? {
                              ...current,
                              weather: weather as ConstructionWeather,
                            }
                          : current
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        Object.keys(
                          CONSTRUCTION_WEATHER_LABELS
                        ) as ConstructionWeather[]
                      ).map(weather => (
                        <SelectItem key={weather} value={weather}>
                          {CONSTRUCTION_WEATHER_LABELS[weather]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
                <Field label="施工部位 / 作业面">
                  <Input
                    maxLength={200}
                    value={constructionReportEditor?.workArea ?? ""}
                    disabled={!editorCanEdit}
                    onChange={event =>
                      setConstructionReportEditor(current =>
                        current
                          ? { ...current, workArea: event.target.value }
                          : current
                      )
                    }
                  />
                </Field>
                <Field label="累计完成比例（%）">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={constructionReportEditor?.progressPercent ?? ""}
                    disabled={!editorCanEdit}
                    onChange={event =>
                      setConstructionReportEditor(current =>
                        current
                          ? {
                              ...current,
                              progressPercent: event.target.value,
                            }
                          : current
                      )
                    }
                  />
                </Field>
              </div>
              <Field label="当日施工内容">
                <Textarea
                  className="min-h-32"
                  maxLength={8000}
                  value={constructionReportEditor?.workContent ?? ""}
                  disabled={!editorCanEdit}
                  onChange={event =>
                    setConstructionReportEditor(current =>
                      current
                        ? { ...current, workContent: event.target.value }
                        : current
                    )
                  }
                />
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="安全记录（可选）">
                  <Textarea
                    maxLength={1000}
                    value={constructionReportEditor?.safetyNotes ?? ""}
                    disabled={!editorCanEdit}
                    onChange={event =>
                      setConstructionReportEditor(current =>
                        current
                          ? { ...current, safetyNotes: event.target.value }
                          : current
                      )
                    }
                  />
                </Field>
                <Field label="问题记录（可选）">
                  <Textarea
                    maxLength={1000}
                    value={constructionReportEditor?.issueNotes ?? ""}
                    disabled={!editorCanEdit}
                    onChange={event =>
                      setConstructionReportEditor(current =>
                        current
                          ? { ...current, issueNotes: event.target.value }
                          : current
                      )
                    }
                  />
                </Field>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={closeConstructionEditor}
                disabled={saveConstructionReport.isPending}
              >
                关闭
              </Button>
              {editorCanEdit ? (
                <Button
                  disabled={
                    !constructionReportEditor ||
                    !constructionReportEditor.reportDate ||
                    constructionReportEditor.workArea.trim().length < 2 ||
                    constructionReportEditor.workContent.trim().length < 4 ||
                    !Number.isFinite(
                      Number(constructionReportEditor.progressPercent)
                    ) ||
                    saveConstructionReport.isPending
                  }
                  onClick={() =>
                    constructionReportEditor &&
                    saveConstructionReport.mutate({
                      id: constructionReportEditor.id,
                      projectId: constructionReportEditor.projectId,
                      reportDate: constructionReportEditor.reportDate,
                      workArea: constructionReportEditor.workArea.trim(),
                      weather: constructionReportEditor.weather,
                      workContent: constructionReportEditor.workContent.trim(),
                      safetyNotes:
                        constructionReportEditor.safetyNotes.trim() || null,
                      issueNotes:
                        constructionReportEditor.issueNotes.trim() || null,
                      progressPercent: Number(
                        constructionReportEditor.progressPercent
                      ),
                    })
                  }
                >
                  {saveConstructionReport.isPending
                    ? "正在保存…"
                    : constructionReportEditor.id
                      ? "保存修改"
                      : "保存日报"}
                </Button>
              ) : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  };

  const renderPurchasing = () => (
    <div className="w-full min-w-0 space-y-4">
      {renderWorkspaceProjectFilter(
        "采购仓储项目范围",
        "所有申请、订单、验收、收发与采购结算均限定已授权项目。"
      )}
      {hasBusinessWorkspaceProject ? (
        <PurchasingWorkspace
          onDirtyChange={onPurchasingDirtyChange}
          projectId={workspaceProjectId}
          projectName={selectedWorkspaceProject?.name ?? "已授权项目"}
          active={canQuery && isPurchasing}
          isSuperAdmin={purchasingIsSuperAdmin}
          onOpenLegacyImport={() => setPurchaseSpreadsheetImportOpen(true)}
          onDownloadLegacyTemplate={() => {
            void downloadPurchaseSpreadsheetTemplate(
              (purchasingCategories.data ?? []).map(category => ({
                name: category.name,
              }))
            );
          }}
        />
      ) : (
        <EmptyState text="请先选择已授权项目，读取采购仓储业务。" />
      )}
      <Dialog
        open={purchaseSpreadsheetImportOpen}
        onOpenChange={open => {
          setPurchaseSpreadsheetImportOpen(open);
          if (!open) setPurchaseSpreadsheetImportPreview(null);
        }}
      >
        <DialogContent className="max-h-[90vh] w-[calc(100vw-3rem)] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>导入采购仓储 Excel 数据</DialogTitle>
            <DialogDescription>
              请先下载系统模板。选择文件后会在本地预检；确认导入时，服务端会再次校验项目范围、标准类别、时间、金额和重复单号。采购订单一律作为“历史
              Excel
              导入草稿”写入，不自动审核、结算、通知或扣款；库存流水将写入不可变台账。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border border-dashed border-[#b7cfca] bg-[#f7fbf9] p-4">
              <Label htmlFor="purchase-spreadsheet-import">
                选择 .xlsx Excel 文件
              </Label>
              <Input
                id="purchase-spreadsheet-import"
                className="mt-2 cursor-pointer bg-white"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={event => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = "";
                  if (!file) return;
                  void parsePurchaseSpreadsheetImport(
                    file,
                    (purchasingCategories.data ?? []).map(
                      category => category.name
                    )
                  )
                    .then(preview => {
                      setPurchaseSpreadsheetImportPreview(preview);
                      toast.success(
                        `文件预检通过：采购订单 ${preview.orders.length} 条、库存流水 ${preview.inventoryTransactions.length} 条`
                      );
                    })
                    .catch(error => {
                      setPurchaseSpreadsheetImportPreview(null);
                      toast.error(
                        getUserFacingErrorMessage(
                          error,
                          "文件预检失败，请检查模板内容后重试"
                        )
                      );
                    });
                }}
              />
              <p className="mt-2 text-xs leading-5 text-slate-600">
                不支持图片/PDF随 Excel
                直接上传；有发票的订单导入后，请在订单详情补传附件。单次最多 500
                条，导入中任一行不通过校验则整批不写入。
              </p>
            </div>
            {purchaseSpreadsheetImportPreview ? (
              <div className="space-y-3 rounded-xl border border-[#d8e3e0] bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-[#203c48]">
                      已预检：{purchaseSpreadsheetImportPreview.fileName}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      采购订单{" "}
                      <strong>
                        {purchaseSpreadsheetImportPreview.orders.length}
                      </strong>{" "}
                      条（均导入为草稿） · 库存流水{" "}
                      <strong>
                        {
                          purchaseSpreadsheetImportPreview.inventoryTransactions
                            .length
                        }
                      </strong>{" "}
                      条
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="border-amber-200 bg-amber-50 text-amber-800"
                  >
                    确认后整批写入
                  </Badge>
                </div>
                <div className="max-h-52 overflow-auto rounded-lg border border-slate-100">
                  <Table className="min-w-[780px] text-xs">
                    <TableHeader className="bg-[#edf1ed]">
                      <TableRow>
                        <TableHead>类型</TableHead>
                        <TableHead>单据号</TableHead>
                        <TableHead>内容</TableHead>
                        <TableHead>金额 / 数量</TableHead>
                        <TableHead>业务时间</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[
                        ...purchaseSpreadsheetImportPreview.orders.map(
                          item => ({
                            type: "采购订单",
                            no: item.orderNo || "系统自动生成",
                            content: `${item.purchaserName} · ${item.categoryName} · ${item.itemDescription}`,
                            amount: `¥${item.amount.toFixed(2)}`,
                            occurredAt: item.orderedAt,
                          })
                        ),
                        ...purchaseSpreadsheetImportPreview.inventoryTransactions.map(
                          item => ({
                            type:
                              item.transactionType === "inbound"
                                ? "库存入库"
                                : item.transactionType === "outbound"
                                  ? "库存领用出库"
                                  : "库存退库",
                            no: item.transactionNo || "系统自动生成",
                            content: `${item.itemName} · ${item.unit}`,
                            amount: `${item.quantity} × ¥${item.unitCost.toFixed(2)}`,
                            occurredAt: item.occurredAt,
                          })
                        ),
                      ]
                        .slice(0, 20)
                        .map((item, index) => (
                          <TableRow key={`${item.type}-${item.no}-${index}`}>
                            <TableCell>{item.type}</TableCell>
                            <TableCell className="font-medium text-[#203c48]">
                              {item.no}
                            </TableCell>
                            <TableCell>{item.content}</TableCell>
                            <TableCell>{item.amount}</TableCell>
                            <TableCell>
                              {formatChinaDateTime(item.occurredAt)}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
                {purchaseSpreadsheetImportPreview.orders.length +
                  purchaseSpreadsheetImportPreview.inventoryTransactions
                    .length >
                20 ? (
                  <p className="text-xs text-slate-500">
                    仅预览前 20 条，确认时将导入全部{" "}
                    {purchaseSpreadsheetImportPreview.orders.length +
                      purchaseSpreadsheetImportPreview.inventoryTransactions
                        .length}{" "}
                    条。
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-500">
                尚未选择通过预检的 Excel 文件。
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPurchaseSpreadsheetImportOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={
                !purchaseSpreadsheetImportPreview ||
                importPurchaseSpreadsheet.isPending
              }
              onClick={() => {
                if (!purchaseSpreadsheetImportPreview || !workspaceProjectId)
                  return;
                importPurchaseSpreadsheet.mutate({
                  projectId: workspaceProjectId,
                  orders: purchaseSpreadsheetImportPreview.orders,
                  inventoryTransactions:
                    purchaseSpreadsheetImportPreview.inventoryTransactions,
                });
              }}
            >
              {importPurchaseSpreadsheet.isPending
                ? "正在整批导入…"
                : "确认导入并写入台账"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  const renderSubcontract = () => {
    const teams = subcontractTeams.data ?? [];
    const packages = subcontractPackages.data ?? [];
    const summary = subcontractSummary.data;
    const takeoffs = (subcontractTakeoffs.data ?? []).filter(item =>
      ["approved", "locked"].includes(item.status)
    );
    const capabilities = subcontractCapabilities.data;
    const summaryByStatus = new Map(
      (summary?.byStatus ?? []).map(item => [item.status, item])
    );
    const linkedTakeoff = subcontractPackageForm.measurementTakeoffId
      ? takeoffs.find(
          item =>
            String(item.id) === subcontractPackageForm.measurementTakeoffId
        )
      : undefined;
    const amountPreview = {
      upstream:
        Number(subcontractPackageForm.quantity || 0) *
        Number(subcontractPackageForm.upstreamUnitPrice || 0),
      subcontract:
        Number(subcontractPackageForm.quantity || 0) *
        Number(subcontractPackageForm.subcontractUnitPrice || 0),
    };
    const openTeamEditor = (team?: (typeof teams)[number]) => {
      setSubcontractTeamForm(
        team
          ? {
              id: Number(team.id),
              projectId: String(team.projectId),
              teamName: team.teamName,
              contactName: team.contactName ?? "",
              contactPhone: "",
              status: team.status,
              remarks: team.remarks ?? "",
            }
          : {
              ...EMPTY_SUBCONTRACT_TEAM_FORM,
              projectId: String(workspaceProjectId),
            }
      );
      setSubcontractTeamDialogOpen(true);
    };
    const openPackageEditor = (item?: (typeof packages)[number]) => {
      setSubcontractPackageForm(
        item
          ? {
              id: Number(item.id),
              projectId: String(item.projectId),
              measurementTakeoffId: item.measurementTakeoffId
                ? String(item.measurementTakeoffId)
                : "",
              subcontractTeamId: String(item.subcontractTeamId),
              workItem: item.workItem,
              workLocation: item.workLocation ?? "",
              unit: item.unit,
              quantity: String(item.quantity),
              upstreamUnitPrice: String(item.upstreamUnitPrice),
              subcontractUnitPrice: String(item.subcontractUnitPrice),
              priceExceptionReason: item.priceExceptionReason ?? "",
              remarks: item.remarks ?? "",
            }
          : {
              ...EMPTY_SUBCONTRACT_PACKAGE_FORM,
              projectId: String(workspaceProjectId),
            }
      );
      setSubcontractPackageDialogOpen(true);
    };
    const openTakeoffEditor = () => {
      setMeasurementTakeoffForm({
        ...EMPTY_MEASUREMENT_TAKEOFF_FORM,
        projectId: String(workspaceProjectId),
        takeoffDate: toLocalDateInput(),
      });
      setMeasurementTakeoffDialogOpen(true);
    };
    const setLinkedTakeoff = (value: string) => {
      if (value === "UNLINKED") {
        setSubcontractPackageForm(current => ({
          ...current,
          measurementTakeoffId: "",
        }));
        return;
      }
      const takeoff = takeoffs.find(item => String(item.id) === value);
      if (!takeoff) return;
      setSubcontractPackageForm(current => ({
        ...current,
        measurementTakeoffId: value,
        workItem: takeoff.workItem,
        workLocation: takeoff.workLocation ?? "",
        unit: takeoff.unit,
        quantity: String(takeoff.quantity),
        upstreamUnitPrice: String(takeoff.unitPrice),
      }));
    };
    const statusDescription = (status: string) =>
      status === "draft"
        ? "草稿，尚未向施工队下达"
        : status === "allocated"
          ? "已分配，待计量/项目复核"
          : status === "confirmed"
            ? "已确认，须在分包应付结算台账完成付款"
            : status === "settled"
              ? "已付款结算，金额快照已锁定"
              : "已作废，不计入有效测算";
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium text-[#203c48]">
              工程结算与分包 · 真实业务台账
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
              工程量分包与结算测算
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              以项目部已审核或已锁定收方为工程量依据，按施工队拆分批次，并在服务端固化上游金额、分包金额和测算差额。分配、复核和结算由不同岗位办理，已结算批次不可修改。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => setLocation("/admin/measurement-tools")}
            >
              打开计量工具
            </Button>
            <Button
              variant="outline"
              onClick={openTakeoffEditor}
              disabled={
                !hasBusinessWorkspaceProject ||
                !measurementTakeoffCapabilities.data?.canSubmit
              }
            >
              项目部工程量录入
            </Button>
            <Button
              variant="outline"
              onClick={() => openTeamEditor()}
              disabled={
                !hasBusinessWorkspaceProject || !capabilities?.canMaintainDraft
              }
            >
              维护施工队
            </Button>
            <Button
              onClick={() => openPackageEditor()}
              disabled={
                !hasBusinessWorkspaceProject ||
                !capabilities?.canMaintainDraft ||
                !teams.some(team => team.status === "active")
              }
            >
              新建分包批次
            </Button>
          </div>
        </div>
        {renderWorkspaceProjectFilter(
          "分包项目范围",
          "选择项目后，读取该项目施工队、已审核工程量收方和分包批次。未选择项目不会加载或展示工程量与金额数据。"
        )}
        {hasBusinessWorkspaceProject ? (
          <SubcontractPaymentSettlementManager projectId={workspaceProjectId} />
        ) : null}
        {!hasBusinessWorkspaceProject ? (
          <EmptyState text="请先选择已授权项目，以读取施工队、收方工程量和分包结算台账。" />
        ) : subcontractTeams.isLoading ||
          subcontractPackages.isLoading ||
          subcontractSummary.isLoading ||
          subcontractTakeoffs.isLoading ? (
          <EmptyState text="正在读取工程结算与分包台账…" />
        ) : subcontractTeams.isError ||
          subcontractPackages.isError ||
          subcontractSummary.isError ||
          subcontractTakeoffs.isError ? (
          <EmptyState text="暂无法读取工程结算与分包数据，请确认当前账号的计量/财务部门、岗位与项目范围授权。" />
        ) : (
          <>
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                title="有效上游金额"
                value={`¥${displayMoney(summary?.upstreamAmount ?? 0)}`}
                description="不含已作废分包批次"
                icon={BarChart3}
              />
              <MetricCard
                title="有效分包金额"
                value={`¥${displayMoney(summary?.subcontractAmount ?? 0)}`}
                description={`共 ${summary?.packageCount ?? 0} 个有效批次`}
                icon={UsersRound}
              />
              <MetricCard
                title="测算差额"
                value={`¥${displayMoney(summary?.marginAmount ?? 0)}`}
                description="上游金额 − 分包金额"
                icon={FolderKanban}
              />
              <MetricCard
                title="待财务结算"
                value={summaryByStatus.get("confirmed")?.packageCount ?? 0}
                description={`已结算 ${summaryByStatus.get("settled")?.packageCount ?? 0} 个批次`}
                icon={ShieldCheck}
              />
            </section>
            <Dialog
              open={measurementTakeoffDialogOpen}
              onOpenChange={open => {
                setMeasurementTakeoffDialogOpen(open);
                if (!open)
                  setMeasurementTakeoffForm(EMPTY_MEASUREMENT_TAKEOFF_FORM);
              }}
            >
              <DialogContent className="w-[calc(100vw-3rem)] max-w-4xl xl:max-w-5xl">
                <DialogHeader>
                  <DialogTitle>项目部工程量收方录入</DialogTitle>
                  <DialogDescription>
                    保存后形成项目部收方草稿；由计量/项目负责人提交、复核后，才能在分包批次中关联分配。工程量与上游单价由服务端重新计算申报金额。
                  </DialogDescription>
                </DialogHeader>
                <form
                  className="space-y-4"
                  onSubmit={event => {
                    event.preventDefault();
                    saveMeasurementTakeoff.mutate({
                      id: measurementTakeoffForm.id,
                      projectId: Number(measurementTakeoffForm.projectId),
                      measurementClaimId: null,
                      workItem: measurementTakeoffForm.workItem.trim(),
                      workLocation: measurementTakeoffForm.workLocation.trim(),
                      unit: measurementTakeoffForm.unit,
                      quantity: Number(measurementTakeoffForm.quantity),
                      unitPrice: Number(measurementTakeoffForm.unitPrice),
                      takeoffDate: measurementTakeoffForm.takeoffDate,
                    });
                  }}
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="当前项目">
                      <Input
                        value={selectedWorkspaceProject?.name ?? ""}
                        disabled
                      />
                    </Field>
                    <Field label="收方日期">
                      <Input
                        type="date"
                        value={measurementTakeoffForm.takeoffDate}
                        onChange={event =>
                          setMeasurementTakeoffForm(current => ({
                            ...current,
                            takeoffDate: event.target.value,
                          }))
                        }
                      />
                    </Field>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="工程项目">
                      <Input
                        value={measurementTakeoffForm.workItem}
                        maxLength={200}
                        placeholder="例如：K12+340 圆管涵 C20 混凝土"
                        onChange={event =>
                          setMeasurementTakeoffForm(current => ({
                            ...current,
                            workItem: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="里程 / 作业位置">
                      <Input
                        value={measurementTakeoffForm.workLocation}
                        maxLength={200}
                        placeholder="例如：K12+340 左侧"
                        onChange={event =>
                          setMeasurementTakeoffForm(current => ({
                            ...current,
                            workLocation: event.target.value,
                          }))
                        }
                      />
                    </Field>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <Field label="计量单位">
                      <Select
                        value={measurementTakeoffForm.unit}
                        onValueChange={value =>
                          setMeasurementTakeoffForm(current => ({
                            ...current,
                            unit: value as MeasurementTakeoffForm["unit"],
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="m3">m³</SelectItem>
                          <SelectItem value="m2">m²</SelectItem>
                          <SelectItem value="m">m</SelectItem>
                          <SelectItem value="t">t</SelectItem>
                          <SelectItem value="piece">件</SelectItem>
                          <SelectItem value="set">套</SelectItem>
                          <SelectItem value="other">其他</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="工程量">
                      <Input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={measurementTakeoffForm.quantity}
                        placeholder="输入收方量"
                        onChange={event =>
                          setMeasurementTakeoffForm(current => ({
                            ...current,
                            quantity: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="业主单价（元）">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={measurementTakeoffForm.unitPrice}
                        placeholder="输入上游单价"
                        onChange={event =>
                          setMeasurementTakeoffForm(current => ({
                            ...current,
                            unitPrice: event.target.value,
                          }))
                        }
                      />
                    </Field>
                  </div>
                  <div className="rounded-xl border border-[#d8e3e0] bg-[#f5f9f8] p-4">
                    <p className="text-xs text-slate-500">
                      收方申报金额（服务端复算）
                    </p>
                    <p className="mt-1 text-xl font-semibold text-[#203c48]">
                      ¥
                      {displayMoney(
                        Number(measurementTakeoffForm.quantity || 0) *
                          Number(measurementTakeoffForm.unitPrice || 0)
                      )}
                    </p>
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setMeasurementTakeoffDialogOpen(false)}
                    >
                      取消
                    </Button>
                    <Button
                      type="submit"
                      disabled={
                        !measurementTakeoffForm.projectId ||
                        measurementTakeoffForm.workItem.trim().length < 2 ||
                        measurementTakeoffForm.workLocation.trim().length < 2 ||
                        !measurementTakeoffForm.takeoffDate ||
                        !Number.isFinite(
                          Number(measurementTakeoffForm.quantity)
                        ) ||
                        Number(measurementTakeoffForm.quantity) <= 0 ||
                        !Number.isFinite(
                          Number(measurementTakeoffForm.unitPrice)
                        ) ||
                        Number(measurementTakeoffForm.unitPrice) < 0 ||
                        saveMeasurementTakeoff.isPending
                      }
                    >
                      {saveMeasurementTakeoff.isPending
                        ? "正在保存…"
                        : "保存收方草稿"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
            <Card className="border-[#d8e3e0]">
              <CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="text-base">施工队台账</CardTitle>
                  <CardDescription>
                    施工队联系人电话加密保存并按授权完整显示；停用或关闭的施工队不可承接新的分包批次，但保留历史结算责任链。
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => subcontractTeams.refetch()}
                  disabled={subcontractTeams.isFetching}
                >
                  刷新施工队
                </Button>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-xl border border-[#e1e8e4]">
                  <Table className="min-w-[860px] text-xs">
                    <TableHeader className="bg-[#edf1ed]">
                      <TableRow>
                        <TableHead>施工队</TableHead>
                        <TableHead>联系人</TableHead>
                        <TableHead>联系电话</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>备注</TableHead>
                        <TableHead>更新时间</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {teams.length ? (
                        teams.map(team => (
                          <TableRow key={team.id}>
                            <TableCell className="font-medium text-[#203c48]">
                              {team.teamName}
                            </TableCell>
                            <TableCell>{team.contactName || "—"}</TableCell>
                            <TableCell>
                              {team.contactPhoneMasked || "未登记"}
                            </TableCell>
                            <TableCell>
                              <BusinessStatusBadge status={team.status} />
                            </TableCell>
                            <TableCell className="max-w-[220px] truncate">
                              {team.remarks || "—"}
                            </TableCell>
                            <TableCell>{displayDate(team.updatedAt)}</TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openTeamEditor(team)}
                                disabled={!capabilities?.canMaintainDraft}
                              >
                                编辑
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell
                            colSpan={7}
                            className="h-24 text-center text-slate-500"
                          >
                            当前项目尚无施工队台账。请先建立施工队，再按批次分配工程量。
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
            <Card className="border-[#d8e3e0]">
              <CardHeader className="flex flex-wrap items-end justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="text-base">
                    分包批次与金额测算台账
                  </CardTitle>
                  <CardDescription>
                    每个批次保存工程量、上游单价、分包单价和测算差额；关联收方后，仅已审核或锁定工程量可分配，且累计分配量不能超过收方工程量。
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Select
                    value={subcontractTeamFilter}
                    onValueChange={setSubcontractTeamFilter}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部施工队</SelectItem>
                      {teams.map(team => (
                        <SelectItem key={team.id} value={String(team.id)}>
                          {team.teamName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={subcontractStatusFilter}
                    onValueChange={setSubcontractStatusFilter}
                  >
                    <SelectTrigger className="w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部状态</SelectItem>
                      <SelectItem value="draft">草稿</SelectItem>
                      <SelectItem value="allocated">已分配</SelectItem>
                      <SelectItem value="confirmed">已确认</SelectItem>
                      <SelectItem value="settled">已结算</SelectItem>
                      <SelectItem value="void">已作废</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      Promise.all([
                        subcontractPackages.refetch(),
                        subcontractSummary.refetch(),
                        subcontractTakeoffs.refetch(),
                      ])
                    }
                    disabled={subcontractPackages.isFetching}
                  >
                    刷新台账
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-xl border border-[#e1e8e4]">
                  <Table className="min-w-[1380px] text-xs">
                    <TableHeader className="bg-[#edf1ed]">
                      <TableRow>
                        <TableHead>批次 / 施工队</TableHead>
                        <TableHead>关联收方</TableHead>
                        <TableHead>工作项 / 位置</TableHead>
                        <TableHead>工程量</TableHead>
                        <TableHead>上游金额</TableHead>
                        <TableHead>分包金额</TableHead>
                        <TableHead>测算差额</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {packages.length ? (
                        packages.map(item => (
                          <TableRow key={item.id}>
                            <TableCell>
                              <p className="font-semibold text-[#203c48]">
                                {item.packageNo}
                              </p>
                              <p className="mt-1 text-slate-500">
                                {item.teamName}
                              </p>
                            </TableCell>
                            <TableCell>
                              {item.takeoffNo ? (
                                <>
                                  <p>{item.takeoffNo}</p>
                                  <p className="mt-1 text-slate-500">
                                    {item.takeoffStatus === "locked"
                                      ? "已锁定收方"
                                      : "已审核收方"}
                                  </p>
                                </>
                              ) : (
                                "独立分包测算"
                              )}
                            </TableCell>
                            <TableCell className="max-w-[240px]">
                              <p className="font-medium">{item.workItem}</p>
                              <p className="mt-1 truncate text-slate-500">
                                {item.workLocation || "未登记位置"}
                              </p>
                            </TableCell>
                            <TableCell>
                              {displayMoney(item.quantity)} {item.unit}
                            </TableCell>
                            <TableCell>
                              <p>¥{displayMoney(item.upstreamAmount)}</p>
                              <p className="mt-1 text-slate-500">
                                ¥{displayMoney(item.upstreamUnitPrice)}/
                                {item.unit}
                              </p>
                            </TableCell>
                            <TableCell>
                              <p>¥{displayMoney(item.subcontractAmount)}</p>
                              <p className="mt-1 text-slate-500">
                                ¥{displayMoney(item.subcontractUnitPrice)}/
                                {item.unit}
                              </p>
                            </TableCell>
                            <TableCell
                              className={
                                Number(item.marginAmount) >= 0
                                  ? "font-semibold text-emerald-700"
                                  : "font-semibold text-rose-700"
                              }
                            >
                              ¥{displayMoney(item.marginAmount)}
                            </TableCell>
                            <TableCell>
                              <BusinessStatusBadge status={item.status} />
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    setDesktopRecordDetail({
                                      title: `分包批次详情 · ${item.packageNo}`,
                                      description: statusDescription(
                                        item.status
                                      ),
                                      fields: [
                                        {
                                          label: "施工队",
                                          value: item.teamName,
                                        },
                                        {
                                          label: "关联收方",
                                          value: item.takeoffNo || "未关联",
                                        },
                                        {
                                          label: "工程量",
                                          value: `${displayMoney(item.quantity)} ${item.unit}`,
                                        },
                                        {
                                          label: "上游金额",
                                          value: `¥ ${displayMoney(item.upstreamAmount)}`,
                                        },
                                        {
                                          label: "分包金额",
                                          value: `¥ ${displayMoney(item.subcontractAmount)}`,
                                        },
                                        {
                                          label: "测算差额",
                                          value: `¥ ${displayMoney(item.marginAmount)}`,
                                        },
                                        {
                                          label: "备注",
                                          value: item.remarks || "—",
                                        },
                                      ],
                                    })
                                  }
                                >
                                  详情
                                </Button>
                                {item.status === "draft" ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openPackageEditor(item)}
                                    disabled={!capabilities?.canMaintainDraft}
                                  >
                                    编辑
                                  </Button>
                                ) : null}
                                {item.status === "draft" &&
                                capabilities?.canMaintainDraft ? (
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      transitionSubcontractPackage.mutate({
                                        id: Number(item.id),
                                        projectId: workspaceProjectId,
                                        targetStatus: "allocated",
                                        remarks: null,
                                      })
                                    }
                                    disabled={
                                      transitionSubcontractPackage.isPending
                                    }
                                  >
                                    分配
                                  </Button>
                                ) : null}
                                {item.status === "allocated" &&
                                capabilities?.canConfirm ? (
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      transitionSubcontractPackage.mutate({
                                        id: Number(item.id),
                                        projectId: workspaceProjectId,
                                        targetStatus: "confirmed",
                                        remarks: null,
                                      })
                                    }
                                    disabled={
                                      transitionSubcontractPackage.isPending
                                    }
                                  >
                                    复核确认
                                  </Button>
                                ) : null}
                                {item.status === "confirmed" &&
                                capabilities?.canSettle ? (
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      transitionSubcontractPackage.mutate({
                                        id: Number(item.id),
                                        projectId: workspaceProjectId,
                                        targetStatus: "settled",
                                        remarks: null,
                                      })
                                    }
                                    disabled={
                                      transitionSubcontractPackage.isPending
                                    }
                                  >
                                    财务结算
                                  </Button>
                                ) : null}
                                {["draft", "allocated", "confirmed"].includes(
                                  item.status
                                ) ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-rose-200 text-rose-700"
                                    onClick={() =>
                                      transitionSubcontractPackage.mutate({
                                        id: Number(item.id),
                                        projectId: workspaceProjectId,
                                        targetStatus: "void",
                                        remarks: "后台作废",
                                      })
                                    }
                                    disabled={
                                      transitionSubcontractPackage.isPending ||
                                      (item.status === "confirmed"
                                        ? !capabilities?.canSettle
                                        : !(
                                            capabilities?.canMaintainDraft ||
                                            capabilities?.canConfirm
                                          ))
                                    }
                                  >
                                    作废
                                  </Button>
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell
                            colSpan={9}
                            className="h-24 text-center text-slate-500"
                          >
                            当前筛选范围暂无分包批次。请先维护施工队，再关联已审核收方或建立独立分包测算草稿。
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
        <Dialog
          open={subcontractTeamDialogOpen}
          onOpenChange={open => {
            setSubcontractTeamDialogOpen(open);
            if (!open) setSubcontractTeamForm(EMPTY_SUBCONTRACT_TEAM_FORM);
          }}
        >
          <DialogContent className="w-[calc(100vw-3rem)] max-w-3xl xl:max-w-4xl">
            <DialogHeader>
              <DialogTitle>
                {subcontractTeamForm.id ? "维护施工队台账" : "新建施工队台账"}
              </DialogTitle>
              <DialogDescription>
                联系人电话号码在服务端加密保存，后台列表按授权显示完整号码；停用施工队不会影响历史分包批次。
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={event => {
                event.preventDefault();
                saveSubcontractTeam.mutate({
                  id: subcontractTeamForm.id,
                  projectId: Number(subcontractTeamForm.projectId),
                  teamName: subcontractTeamForm.teamName.trim(),
                  contactName: subcontractTeamForm.contactName.trim() || null,
                  contactPhone:
                    subcontractTeamForm.contactPhone.trim() || undefined,
                  status: subcontractTeamForm.status,
                  remarks: subcontractTeamForm.remarks.trim() || null,
                });
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="所属项目">
                  <Input
                    value={selectedWorkspaceProject?.name ?? ""}
                    disabled
                  />
                </Field>
                <Field label="施工队状态">
                  <Select
                    value={subcontractTeamForm.status}
                    onValueChange={value =>
                      setSubcontractTeamForm(current => ({
                        ...current,
                        status: value as SubcontractTeamForm["status"],
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">启用</SelectItem>
                      <SelectItem value="suspended">暂停</SelectItem>
                      <SelectItem value="closed">已关闭</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="施工队名称">
                  <Input
                    value={subcontractTeamForm.teamName}
                    maxLength={200}
                    placeholder="例如：路基一队"
                    onChange={event =>
                      setSubcontractTeamForm(current => ({
                        ...current,
                        teamName: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="联系人姓名">
                  <Input
                    value={subcontractTeamForm.contactName}
                    maxLength={100}
                    placeholder="可选"
                    onChange={event =>
                      setSubcontractTeamForm(current => ({
                        ...current,
                        contactName: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
              <Field
                label={
                  subcontractTeamForm.id
                    ? "联系人电话（留空保持原号码）"
                    : "联系人电话（可选）"
                }
              >
                <Input
                  value={subcontractTeamForm.contactPhone}
                  inputMode="tel"
                  maxLength={32}
                  placeholder={
                    subcontractTeamForm.id
                      ? "已加密保存；如需更新请输入新号码"
                      : "例如 13800000000"
                  }
                  onChange={event =>
                    setSubcontractTeamForm(current => ({
                      ...current,
                      contactPhone: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="备注">
                <Textarea
                  value={subcontractTeamForm.remarks}
                  maxLength={500}
                  placeholder="可填写班组能力、合同或现场协作说明"
                  onChange={event =>
                    setSubcontractTeamForm(current => ({
                      ...current,
                      remarks: event.target.value,
                    }))
                  }
                />
              </Field>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSubcontractTeamDialogOpen(false)}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  disabled={
                    !subcontractTeamForm.projectId ||
                    subcontractTeamForm.teamName.trim().length < 2 ||
                    saveSubcontractTeam.isPending
                  }
                >
                  {saveSubcontractTeam.isPending ? "正在保存…" : "保存施工队"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog
          open={subcontractPackageDialogOpen}
          onOpenChange={open => {
            setSubcontractPackageDialogOpen(open);
            if (!open)
              setSubcontractPackageForm(EMPTY_SUBCONTRACT_PACKAGE_FORM);
          }}
        >
          <DialogContent className="max-h-[90vh] w-[calc(100vw-3rem)] max-w-5xl xl:max-w-6xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {subcontractPackageForm.id
                  ? "维护分包批次草稿"
                  : "新建分包批次"}
              </DialogTitle>
              <DialogDescription>
                关联收方时，系统锁定收方的工作项、位置、单位、工程量与上游单价，并校验累计分配量；金额和测算差额均由服务端重新计算。
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={event => {
                event.preventDefault();
                saveSubcontractPackage.mutate({
                  id: subcontractPackageForm.id,
                  projectId: Number(subcontractPackageForm.projectId),
                  measurementTakeoffId:
                    subcontractPackageForm.measurementTakeoffId
                      ? Number(subcontractPackageForm.measurementTakeoffId)
                      : null,
                  subcontractTeamId: Number(
                    subcontractPackageForm.subcontractTeamId
                  ),
                  workItem: subcontractPackageForm.workItem.trim(),
                  workLocation:
                    subcontractPackageForm.workLocation.trim() || null,
                  unit: subcontractPackageForm.unit,
                  quantity: Number(subcontractPackageForm.quantity),
                  upstreamUnitPrice: Number(
                    subcontractPackageForm.upstreamUnitPrice
                  ),
                  subcontractUnitPrice: Number(
                    subcontractPackageForm.subcontractUnitPrice
                  ),
                  remarks: subcontractPackageForm.remarks.trim() || null,
                });
              }}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="承接施工队">
                  <Select
                    value={
                      subcontractPackageForm.subcontractTeamId || "UNASSIGNED"
                    }
                    onValueChange={value =>
                      setSubcontractPackageForm(current => ({
                        ...current,
                        subcontractTeamId: value === "UNASSIGNED" ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择启用施工队" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UNASSIGNED">请选择施工队</SelectItem>
                      {teams
                        .filter(team => team.status === "active")
                        .map(team => (
                          <SelectItem key={team.id} value={String(team.id)}>
                            {team.teamName}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="关联项目收方（可选）">
                  <Select
                    value={
                      subcontractPackageForm.measurementTakeoffId || "UNLINKED"
                    }
                    onValueChange={setLinkedTakeoff}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UNLINKED">不关联，独立测算</SelectItem>
                      {takeoffs.map(takeoff => (
                        <SelectItem key={takeoff.id} value={String(takeoff.id)}>
                          {takeoff.takeoffNo} · {takeoff.workItem} · 可分配{" "}
                          {displayMoney(takeoff.quantity)} {takeoff.unit}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="分包工作项">
                  <Input
                    value={subcontractPackageForm.workItem}
                    disabled={Boolean(linkedTakeoff)}
                    maxLength={200}
                    onChange={event =>
                      setSubcontractPackageForm(current => ({
                        ...current,
                        workItem: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="施工位置">
                  <Input
                    value={subcontractPackageForm.workLocation}
                    disabled={Boolean(linkedTakeoff)}
                    maxLength={200}
                    placeholder="可选"
                    onChange={event =>
                      setSubcontractPackageForm(current => ({
                        ...current,
                        workLocation: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-4">
                <Field label="计量单位">
                  <Select
                    value={subcontractPackageForm.unit}
                    disabled={Boolean(linkedTakeoff)}
                    onValueChange={value =>
                      setSubcontractPackageForm(current => ({
                        ...current,
                        unit: value as SubcontractPackageForm["unit"],
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="m3">m³</SelectItem>
                      <SelectItem value="m2">m²</SelectItem>
                      <SelectItem value="m">m</SelectItem>
                      <SelectItem value="t">t</SelectItem>
                      <SelectItem value="piece">件</SelectItem>
                      <SelectItem value="set">套</SelectItem>
                      <SelectItem value="other">其他</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="工程量">
                  <Input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={subcontractPackageForm.quantity}
                    disabled={Boolean(linkedTakeoff)}
                    onChange={event =>
                      setSubcontractPackageForm(current => ({
                        ...current,
                        quantity: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="上游单价（元）">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={subcontractPackageForm.upstreamUnitPrice}
                    disabled={Boolean(linkedTakeoff)}
                    onChange={event =>
                      setSubcontractPackageForm(current => ({
                        ...current,
                        upstreamUnitPrice: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="分包单价（元）">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={subcontractPackageForm.subcontractUnitPrice}
                    onChange={event =>
                      setSubcontractPackageForm(current => ({
                        ...current,
                        subcontractUnitPrice: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
              <div className="grid gap-3 rounded-xl border border-[#d8e3e0] bg-[#f5f9f8] p-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-slate-500">上游金额测算</p>
                  <p className="mt-1 text-lg font-semibold text-[#203c48]">
                    ¥{displayMoney(amountPreview.upstream)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">分包金额测算</p>
                  <p className="mt-1 text-lg font-semibold text-[#203c48]">
                    ¥{displayMoney(amountPreview.subcontract)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">测算差额</p>
                  <p
                    className={`mt-1 text-lg font-semibold ${amountPreview.upstream - amountPreview.subcontract >= 0 ? "text-emerald-700" : "text-rose-700"}`}
                  >
                    ¥
                    {displayMoney(
                      amountPreview.upstream - amountPreview.subcontract
                    )}
                  </p>
                </div>
              </div>
              <Field label="备注">
                <Textarea
                  value={subcontractPackageForm.remarks}
                  maxLength={500}
                  placeholder="可填写分包边界、质量要求或结算说明"
                  onChange={event =>
                    setSubcontractPackageForm(current => ({
                      ...current,
                      remarks: event.target.value,
                    }))
                  }
                />
              </Field>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSubcontractPackageDialogOpen(false)}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  disabled={
                    !subcontractPackageForm.projectId ||
                    !subcontractPackageForm.subcontractTeamId ||
                    subcontractPackageForm.workItem.trim().length < 2 ||
                    !Number.isFinite(Number(subcontractPackageForm.quantity)) ||
                    Number(subcontractPackageForm.quantity) <= 0 ||
                    !Number.isFinite(
                      Number(subcontractPackageForm.upstreamUnitPrice)
                    ) ||
                    Number(subcontractPackageForm.upstreamUnitPrice) < 0 ||
                    !Number.isFinite(
                      Number(subcontractPackageForm.subcontractUnitPrice)
                    ) ||
                    Number(subcontractPackageForm.subcontractUnitPrice) < 0 ||
                    saveSubcontractPackage.isPending
                  }
                >
                  {saveSubcontractPackage.isPending
                    ? "正在保存…"
                    : "保存分包草稿"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    );
  };

  const renderLaborContent = ({
    filters,
    queries,
  }: LaborWorkspaceRenderState) => {
    const {
      laborPeriod,
      setLaborPeriod,
      laborAttendanceDate,
      setLaborAttendanceDate,
      laborPayrollSearch,
      setLaborPayrollSearch,
      laborPayrollTeam,
      setLaborPayrollTeam,
      laborPayrollStatus,
      setLaborPayrollStatus,
      laborAttendanceFilter,
      setLaborAttendanceFilter,
    } = filters;
    const {
      laborWorkers,
      laborAttendance,
      laborCheckIns,
      payrollStatements,
      laborDailyWages,
      payrollWorkbookExport,
      payrollPaymentListExport,
    } = queries;
    const workers = laborWorkers.data ?? [];
    const attendance = laborAttendance.data ?? [];
    const workerById = new Map(workers.map(worker => [worker.id, worker]));
    const attendanceTeams = getAttendanceTeams(attendance);
    const visibleAttendance = filterAttendanceRows(
      attendance,
      workerById,
      laborAttendanceFilter
    );
    const payrolls = payrollStatements.data ?? [];
    const dailyWages = laborDailyWages.data ?? [];
    const checkIns = laborCheckIns.data ?? [];
    const visiblePayrolls = filterPayrollRows(payrolls, {
      search: laborPayrollSearch,
      team: laborPayrollTeam,
      status: laborPayrollStatus,
    });
    const payrollSummary = summarizePayrollAmounts(visiblePayrolls);
    const payrollCategories = summarizeLaborPayrollCategories(
      payrolls,
      new Map(workers.map(worker => [worker.id, worker.workerCategory]))
    );
    const companyPayrollSummary = payrollCategories.company;
    const laborTeamPayrollSummary = payrollCategories.laborTeam;
    const temporaryDailySummary = summarizePayrollAmounts(dailyWages);
    const laborTeamAuditRows = payrollCategories.laborTeamRows;
    const payrollTeams = getPayrollTeams(payrolls);
    const dailyWageSummary = dailyWages.reduce(
      (summary, item) => ({
        actual: summary.actual + Number(item.actualAmount || 0),
        reviewing: summary.reviewing + (item.status === "reviewing" ? 1 : 0),
        approved: summary.approved + (item.status === "approved" ? 1 : 0),
        paid: summary.paid + (item.status === "paid" ? 1 : 0),
      }),
      { actual: 0, reviewing: 0, approved: 0, paid: 0 }
    );
    const laborWorkspaceQueryEnabled =
      canQuery && isLabor && hasBusinessWorkspaceProject;
    const laborWorkspaceLoading =
      laborWorkspaceQueryEnabled &&
      (laborWorkers.isLoading ||
        laborAttendance.isLoading ||
        laborCheckIns.isLoading ||
        payrollStatements.isLoading ||
        laborDailyWages.isLoading);
    const laborWorkspaceHasError =
      laborWorkspaceQueryEnabled &&
      (laborWorkers.isError ||
        laborAttendance.isError ||
        laborCheckIns.isError ||
        payrollStatements.isError ||
        laborDailyWages.isError);
    const laborWorkspaceRefreshing =
      laborWorkers.isFetching ||
      laborAttendance.isFetching ||
      laborCheckIns.isFetching ||
      payrollStatements.isFetching ||
      laborDailyWages.isFetching;
    const retryLaborWorkspace = () =>
      Promise.all([
        laborWorkers.refetch(),
        laborAttendance.refetch(),
        laborCheckIns.refetch(),
        payrollStatements.refetch(),
        laborDailyWages.refetch(),
      ]);
    return (
      <Tabs
        value={scopedSection ? "operations" : laborWorkspaceTab}
        onValueChange={setLaborWorkspaceTab}
        className="space-y-4"
      >
        {!scopedSection ? (
          <>
            <TabsList className="grid h-auto w-full grid-cols-2 rounded-xl bg-[#e9f0ed] p-1">
              <TabsTrigger value="personnel" className="py-2">
                人员档案
              </TabsTrigger>
              <TabsTrigger value="operations" className="py-2">
                考勤与工资结算
              </TabsTrigger>
            </TabsList>
            <TabsContent value="personnel" className="mt-0">
              <UnifiedPersonnelDirectory
                openLegacySource={personnelOpenSource}
                openCreateSignal={personnelCreateSignal}
                initialProjectId={
                  hasBusinessWorkspaceProject
                    ? Number(businessWorkspaceProjectId)
                    : undefined
                }
                onSaved={async () => {
                  await Promise.all([
                    companyPersonnelRoster.refetch(),
                    employeeProfiles.refetch(),
                    audits.refetch(),
                  ]);
                }}
              />
            </TabsContent>
          </>
        ) : null}
        <TabsContent value="operations" className="mt-0">
          <LaborWorkspaceShell
            projectFilter={renderWorkspaceProjectFilter(
              "劳务项目范围",
              "选择项目后按真实人员、考勤和工资条加载。每个工资状态操作仍由劳务、会计和财务角色在服务端二次核验。"
            )}
            hasProject={hasBusinessWorkspaceProject}
            queryEnabled={laborWorkspaceQueryEnabled}
            loading={laborWorkspaceLoading}
            hasError={laborWorkspaceHasError}
            refreshing={laborWorkspaceRefreshing}
            onRetry={() => void retryLaborWorkspace()}
          >
            {!laborWorkspaceLoading &&
            !laborWorkspaceHasError &&
            laborWorkspaceQueryEnabled &&
            hasBusinessWorkspaceProject ? (
              <>
                <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <MetricCard
                    title="实名制人员"
                    value={workers.length}
                    description="已按授权显示业务资料"
                    icon={UsersRound}
                  />
                  <MetricCard
                    title="在场人员"
                    value={
                      workers.filter(item => item.attendanceStatus === "active")
                        .length
                    }
                    description="可计入当前项目考勤"
                    icon={ShieldCheck}
                  />
                  <MetricCard
                    title="今日已上班"
                    value={checkIns.length}
                    description={`${checkIns.filter(item => item.checkedOutAt).length} 人已完成下班打卡`}
                    icon={ScrollText}
                  />
                  <MetricCard
                    title="待会计处理"
                    value={
                      payrolls.filter(item => item.status === "reviewing")
                        .length
                    }
                    description="审核中工资条"
                    icon={BarChart3}
                  />
                </section>
                <LaborCheckInLedger
                  checkIns={checkIns}
                  businessDate={laborAttendanceDate}
                  onBusinessDateChange={setLaborAttendanceDate}
                  fallbackBusinessDate={toChinaBusinessDateInput()}
                  displayDate={displayDate}
                  formatAttendanceLocation={formatAttendanceLocation}
                  onExportCsv={downloadCsvFile}
                />
                <LaborPayrollHeadline
                  summary={payrollSummary}
                  formatMoney={displayMoney}
                />
                <LaborTeamAuditSummary
                  companyActual={companyPayrollSummary.actual}
                  companyPayable={companyPayrollSummary.payable}
                  companyPaid={companyPayrollSummary.paid}
                  laborActual={laborTeamPayrollSummary.actual}
                  laborPayable={laborTeamPayrollSummary.payable}
                  laborPaid={laborTeamPayrollSummary.paid}
                  temporaryActual={temporaryDailySummary.actual}
                  temporaryApproved={temporaryDailySummary.approved}
                  temporaryPaid={temporaryDailySummary.paid}
                  rows={laborTeamAuditRows}
                  formatMoney={displayMoney}
                />
                <DailyWageLedger
                  summary={dailyWageSummary}
                  rows={dailyWages}
                  refreshing={laborDailyWages.isFetching}
                  workbookPending={payrollWorkbookExport.isFetching}
                  paymentListPending={payrollPaymentListExport.isFetching}
                  submitPending={submitDailyWage.isPending}
                  reviewPending={reviewDailyWage.isPending}
                  formatMoney={displayMoney}
                  displayDate={displayDate}
                  toBusinessDateInput={toBusinessDateInput}
                  onRefresh={() => laborDailyWages.refetch()}
                  onExportWorkbook={async () => {
                    const response = await payrollWorkbookExport.refetch();
                    const data = response.data;
                    if (!data) return toast.error("工资分类报表数据读取失败");
                    const standardHeaders = [
                      "人员",
                      "班组",
                      "期间/日期",
                      "应发",
                      "扣款",
                      "实发",
                      "开户行",
                      "银行卡",
                      "状态",
                      "实际付款日期",
                    ];
                    const toPayrollRows = (rows: typeof data.payrollRows) =>
                      rows.map(row => [
                        row.workerName,
                        row.teamName || "",
                        row.period,
                        row.payableAmount,
                        row.deductionAmount,
                        row.actualAmount,
                        row.bankName || "",
                        row.bankAccountMasked || "",
                        getBusinessStatusLabel(row.status),
                        row.paidAt ? displayDate(row.paidAt) : "",
                      ]);
                    const toDailyRows = (rows: typeof data.dailyRows) =>
                      rows.map(row => [
                        row.workerName,
                        row.teamName || "",
                        toBusinessDateInput(row.settlementDate),
                        row.payableAmount,
                        row.deductionAmount,
                        row.actualAmount,
                        row.bankName || "",
                        row.bankAccountMasked || "",
                        getBusinessStatusLabel(row.status),
                        row.paidAt ? displayDate(row.paidAt) : "",
                      ]);
                    const laborTeamNames = Array.from(
                      new Set(
                        data.payrollRows
                          .filter(row => row.workerCategory === "labor_team")
                          .map(row => row.teamName || "未设置班组")
                      )
                    );
                    downloadXlsxWorkbook(
                      `工资分类报表-${laborPeriod || "全部期间"}.xlsx`,
                      [
                        {
                          name: "公司管理人员",
                          headers: standardHeaders,
                          rows: toPayrollRows(
                            data.payrollRows.filter(
                              row => row.workerCategory === "company_admin"
                            )
                          ),
                        },
                        {
                          name: "临时日结",
                          headers: standardHeaders,
                          rows: toDailyRows(data.dailyRows),
                        },
                        ...laborTeamNames.map(teamName => ({
                          name: `劳务队-${teamName}`,
                          headers: standardHeaders,
                          rows: toPayrollRows(
                            data.payrollRows.filter(
                              row =>
                                row.workerCategory === "labor_team" &&
                                (row.teamName || "未设置班组") === teamName
                            )
                          ),
                        })),
                      ]
                    );
                    toast.success("分类工资 Excel 已生成，普通报表仅含银行卡");
                  }}
                  onExportPaymentList={async () => {
                    const response = await payrollPaymentListExport.refetch();
                    const data = response.data;
                    if (!data)
                      return toast.error("付款专用清单无权限或数据读取失败");
                    const headers = [
                      "来源",
                      "人员",
                      "人员类型",
                      "班组",
                      "期间/日结日期",
                      "开户行",
                      "完整银行卡号",
                      "实发金额",
                      "状态",
                      "实际付款日期",
                    ];
                    const payrollRows = data.payrollRows.map(row => [
                      "月度工资",
                      row.workerName,
                      getPayrollWorkerCategoryLabel(row.workerCategory),
                      row.teamName || "",
                      toBusinessDateInput(row.settlementDate),
                      row.bankName || "",
                      row.bankAccount || "未登记",
                      row.actualAmount,
                      getBusinessStatusLabel(row.status),
                      row.paidAt ? displayDate(row.paidAt) : "",
                    ]);
                    const dailyRows = data.dailyRows.map(row => [
                      "临时日结",
                      row.workerName,
                      getPayrollWorkerCategoryLabel(row.workerCategory),
                      row.teamName || "",
                      toBusinessDateInput(row.settlementDate),
                      row.bankName || "",
                      row.bankAccount || "未登记",
                      row.actualAmount,
                      getBusinessStatusLabel(row.status),
                      row.paidAt ? displayDate(row.paidAt) : "",
                    ]);
                    downloadXlsxWorkbook(
                      `付款专用清单-${laborPeriod || "全部期间"}.xlsx`,
                      [
                        {
                          name: "付款专用清单",
                          headers,
                          rows: [...payrollRows, ...dailyRows],
                        },
                      ]
                    );
                    toast.success(
                      "付款专用 Excel 已生成，生成行为已写入审计日志"
                    );
                  }}
                  onSubmit={id => submitDailyWage.mutate({ id })}
                  onReturnDraft={id =>
                    reviewDailyWage.mutate({ id, decision: "returned" })
                  }
                  onApprove={id =>
                    reviewDailyWage.mutate({ id, decision: "approved" })
                  }
                  onRegisterPayment={item => {
                    setDailyWagePaymentTarget({
                      id: item.id,
                      workerName: item.workerName,
                    });
                  }}
                />
                <PayrollStatementLedger
                  period={laborPeriod}
                  onPeriodChange={setLaborPeriod}
                  search={laborPayrollSearch}
                  onSearchChange={setLaborPayrollSearch}
                  team={laborPayrollTeam}
                  onTeamChange={setLaborPayrollTeam}
                  status={laborPayrollStatus}
                  onStatusChange={setLaborPayrollStatus}
                  teams={payrollTeams}
                  rows={visiblePayrolls}
                  formatMoney={displayMoney}
                  onExport={() =>
                    downloadCsvFile(
                      `工资条-${laborPeriod || "全部期间"}.csv`,
                      [
                        "项目范围",
                        "筛选期间",
                        "人员",
                        "班组",
                        "工资期间",
                        "应发金额",
                        "扣款",
                        "实发金额",
                        "付款凭证",
                        "状态",
                      ],
                      visiblePayrolls.map(item => [
                        workspaceProjectId
                          ? `项目 #${workspaceProjectId}`
                          : "当前项目",
                        laborPeriod || "全部期间",
                        item.workerName,
                        item.teamName || "",
                        item.period,
                        item.payableAmount,
                        item.deductionAmount,
                        item.actualAmount,
                        item.paymentReference || "",
                        getBusinessStatusLabel(item.status),
                      ])
                    )
                  }
                  onOpenDetail={item =>
                    setDesktopRecordDetail({
                      title: `工资条明细 · ${item.workerName}`,
                      description:
                        "工资金额由服务端计算，付款凭证与敏感账户字段仅向获授权岗位展示。",
                      fields: [
                        { label: "工资期间", value: item.period },
                        {
                          label: "状态",
                          value: <BusinessStatusBadge status={item.status} />,
                        },
                        {
                          label: "应发金额",
                          value: `¥ ${displayMoney(item.payableAmount)}`,
                        },
                        {
                          label: "扣款金额",
                          value: `¥ ${displayMoney(item.deductionAmount)}`,
                        },
                        {
                          label: "实发金额",
                          value: `¥ ${displayMoney(item.actualAmount)}`,
                        },
                        {
                          label: "付款凭证",
                          value: item.paymentReference || "尚未发放",
                        },
                      ],
                    })
                  }
                  onRegisterPayment={item =>
                    setPayrollPaymentTarget({
                      id: item.id,
                      workerName: item.workerName,
                      period: item.period,
                    })
                  }
                />
                <LaborEntryActionCard
                  onAdd={() => {
                    setLaborWorkspaceTab("personnel");
                    setPersonnelCreateSignal(current => current + 1);
                  }}
                />
                <div className="grid gap-6 xl:grid-cols-2">
                  <LaborWorkerRoster
                    workers={workers}
                    displayDate={displayDate}
                    onCreateWorker={() => {
                      setLaborWorkspaceTab("personnel");
                      setPersonnelCreateSignal(current => current + 1);
                    }}
                    onOpenProfile={worker => {
                      setLaborWorkspaceTab("personnel");
                      setPersonnelOpenSource(current => ({
                        sourceType: "worker",
                        sourceId: worker.id,
                        requestKey: (current?.requestKey ?? 0) + 1,
                      }));
                    }}
                  />
                  <LaborAttendanceLedger
                    filter={laborAttendanceFilter}
                    onFilterChange={setLaborAttendanceFilter}
                    teams={attendanceTeams}
                    rows={visibleAttendance}
                    hasAttendance={attendance.length > 0}
                    getWorkerCategory={workerId =>
                      workerById.get(workerId)?.workerCategory
                    }
                    displayDate={displayDate}
                    onExport={() =>
                      downloadCsvFile(
                        `劳务考勤-${laborAttendanceDate || "全部日期"}.csv`,
                        [
                          "人员",
                          "班组",
                          "人员类型",
                          "考勤日期",
                          "正常工时",
                          "加班工时",
                          "来源",
                          "状态",
                          "备注",
                        ],
                        visibleAttendance.map(item => {
                          const worker = workerById.get(item.workerId);
                          return [
                            item.workerName,
                            item.teamName || "未设置班组",
                            worker?.workerCategory === "company_admin"
                              ? "公司管理人员"
                              : worker?.workerCategory === "temporary_daily"
                                ? "临时日结人员"
                                : "劳务队人员",
                            toBusinessDateInput(item.attendanceDate),
                            item.workHours,
                            item.overtimeHours,
                            getAttendanceSourceLabel(item.source),
                            getBusinessStatusLabel(item.status),
                            item.note || "",
                          ];
                        }),
                        {
                          module: "劳务考勤高级筛选导出",
                          filters: [
                            [
                              "项目",
                              selectedWorkspaceProject?.name ||
                                `项目 #${workspaceProjectId}`,
                            ],
                            ["考勤日期", laborAttendanceDate || "全部日期"],
                            [
                              "姓名/班组",
                              laborAttendanceFilter.workerName || "全部",
                            ],
                            [
                              "班组",
                              laborAttendanceFilter.team === "all"
                                ? "全部"
                                : laborAttendanceFilter.team,
                            ],
                            [
                              "人员类型",
                              laborAttendanceFilter.category === "all"
                                ? "全部"
                                : laborAttendanceFilter.category,
                            ],
                            [
                              "考勤状态",
                              laborAttendanceFilter.status === "all"
                                ? "全部"
                                : laborAttendanceFilter.status,
                            ],
                          ],
                        }
                      )
                    }
                  />
                </div>
                <Dialog
                  open={laborWorkerCreateDialogOpen}
                  onOpenChange={open => {
                    if (!open) closeLaborWorkerCreateDialog();
                  }}
                >
                  <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>新建实名制施工队工人</DialogTitle>
                      <DialogDescription>
                        仅建立当前项目的真实劳务人员档案，不创建系统账号或员工档案。身份证、联系电话和银行卡仅在本次安全提交时传送，关闭后不会保留或回显。
                      </DialogDescription>
                    </DialogHeader>
                    <form
                      className="space-y-4"
                      onSubmit={event => {
                        event.preventDefault();
                        submitLaborWorkerCreate();
                      }}
                    >
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="当前项目（必填）">
                          <Input
                            value={selectedWorkspaceProject?.name ?? ""}
                            placeholder="请先选择已授权项目"
                            disabled
                          />
                        </Field>
                        <Field label="实名姓名（必填）">
                          <Input
                            value={laborWorkerCreateForm.realName}
                            onChange={event =>
                              setLaborWorkerCreateForm(current => ({
                                ...current,
                                realName: event.target.value,
                              }))
                            }
                            autoComplete="off"
                            maxLength={64}
                          />
                        </Field>
                      </div>
                      <Field label="身份证号码（必填）">
                        <Input
                          value={laborWorkerCreateForm.identityNo}
                          onChange={event =>
                            setLaborWorkerCreateForm(current => ({
                              ...current,
                              identityNo: event.target.value,
                            }))
                          }
                          autoComplete="off"
                          inputMode="text"
                          maxLength={32}
                          placeholder="仅用于本次提交，由服务端加密保存"
                        />
                      </Field>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="班组（可选）">
                          <Input
                            value={laborWorkerCreateForm.teamName}
                            onChange={event =>
                              setLaborWorkerCreateForm(current => ({
                                ...current,
                                teamName: event.target.value,
                              }))
                            }
                            maxLength={128}
                            placeholder="例如：路基施工一队"
                          />
                        </Field>
                        <Field label="联系电话（可选）">
                          <Input
                            value={laborWorkerCreateForm.phone}
                            onChange={event =>
                              setLaborWorkerCreateForm(current => ({
                                ...current,
                                phone: event.target.value,
                              }))
                            }
                            autoComplete="off"
                            inputMode="tel"
                            maxLength={32}
                            placeholder="仅用于本次提交"
                          />
                        </Field>
                        <Field label="开户行（可选）">
                          <Input
                            value={laborWorkerCreateForm.bankName}
                            onChange={event =>
                              setLaborWorkerCreateForm(current => ({
                                ...current,
                                bankName: event.target.value,
                              }))
                            }
                            autoComplete="off"
                            maxLength={128}
                            placeholder="仅用于本次提交"
                          />
                        </Field>
                        <Field label="银行卡号（可选）">
                          <Input
                            value={laborWorkerCreateForm.bankAccount}
                            onChange={event =>
                              setLaborWorkerCreateForm(current => ({
                                ...current,
                                bankAccount: event.target.value,
                              }))
                            }
                            autoComplete="off"
                            inputMode="numeric"
                            maxLength={64}
                            placeholder="仅用于本次提交，由服务端加密保存"
                          />
                        </Field>
                        <Field label="进场日期（可选）">
                          <Input
                            type="date"
                            value={laborWorkerCreateForm.entryDate}
                            onChange={event =>
                              setLaborWorkerCreateForm(current => ({
                                ...current,
                                entryDate: event.target.value,
                              }))
                            }
                          />
                        </Field>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                        固定分类：施工队工人；实名核验：待核验；出勤状态：在场。实名核验须按既有受控流程完成。
                      </div>
                      <Field label="备注（可选）">
                        <Textarea
                          value={laborWorkerCreateForm.remarks}
                          onChange={event =>
                            setLaborWorkerCreateForm(current => ({
                              ...current,
                              remarks: event.target.value,
                            }))
                          }
                          maxLength={500}
                          placeholder="请勿填写身份证、银行卡等敏感原文"
                        />
                      </Field>
                      <DialogFooter>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={closeLaborWorkerCreateDialog}
                        >
                          取消
                        </Button>
                        <Button
                          type="submit"
                          disabled={
                            saveLaborWorker.isPending ||
                            !hasBusinessWorkspaceProject ||
                            !laborWorkerCreateForm.realName.trim() ||
                            !laborWorkerCreateForm.identityNo.trim()
                          }
                        >
                          {saveLaborWorker.isPending
                            ? "正在安全保存…"
                            : "安全保存施工队工人"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </>
            ) : null}
            <SettlementPaymentDialog
              open={Boolean(dailyWagePaymentTarget)}
              onOpenChange={open => {
                if (!open) setDailyWagePaymentTarget(null);
              }}
              projectId={workspaceProjectId ?? 0}
              settlementType="daily_wage"
              target={
                dailyWagePaymentTarget
                  ? {
                      id: dailyWagePaymentTarget.id,
                      label: `临时日结 · ${dailyWagePaymentTarget.workerName}`,
                      payeeName: dailyWagePaymentTarget.workerName,
                    }
                  : null
              }
              onCompleted={async () => {
                await Promise.all([
                  trpcUtils.labor.dailyWage.list.invalidate(),
                  trpcUtils.labor.payroll.list.invalidate(),
                  trpcUtils.labor.summary.invalidate(),
                ]);
              }}
            />
            <SettlementPaymentDialog
              open={Boolean(payrollPaymentTarget)}
              onOpenChange={open => {
                if (!open) setPayrollPaymentTarget(null);
              }}
              projectId={workspaceProjectId ?? 0}
              settlementType="payroll"
              target={
                payrollPaymentTarget
                  ? {
                      id: payrollPaymentTarget.id,
                      label: `${payrollPaymentTarget.period} 工资 · ${payrollPaymentTarget.workerName}`,
                      payeeName: payrollPaymentTarget.workerName,
                    }
                  : null
              }
              onCompleted={async () => {
                await Promise.all([
                  trpcUtils.labor.payroll.list.invalidate(),
                  trpcUtils.labor.summary.invalidate(),
                ]);
              }}
            />
          </LaborWorkspaceShell>
        </TabsContent>
      </Tabs>
    );
  };

  const renderLabor = () => (
    <LaborWorkspaceLoader
      enabled={canQuery && isLabor && hasBusinessWorkspaceProject}
      projectId={workspaceProjectId}
      initialAttendanceDate={toChinaBusinessDateInput()}
    >
      {renderLaborContent}
    </LaborWorkspaceLoader>
  );

  const renderMachinery = () => {
    const allMachines = machineryLedger.data ?? [];
    const machines = allMachines.filter(machine => {
      const keyword = machineLedgerFilter.search.trim().toLowerCase();
      return (
        (!keyword ||
          [
            machine.name,
            machine.code,
            machine.model,
            machine.supplierName,
            machine.plateOrAssetNo,
          ].some(value => value?.toLowerCase().includes(keyword))) &&
        (machineLedgerFilter.ownership === "all" ||
          machine.ownership === machineLedgerFilter.ownership) &&
        (machineLedgerFilter.status === "all" ||
          machine.status === machineLedgerFilter.status)
      );
    });
    const costs = machineCosts.data ?? [];
    const monthlyStatements = machineMonthlyStatements.data ?? [];
    const statementByMachineId = new Map(
      monthlyStatements.map(statement => [statement.machineId, statement])
    );
    const selectedMachine = machines.find(
      machine => String(machine.id) === selectedMachineId
    );
    const machineMaintenanceRows = (assetMaintenanceRecords.data ?? []).filter(
      item =>
        item.assetType === "machine" && item.projectId === workspaceProjectId
    );
    const machineMaintenanceAmountById = new Map<number, number>();
    machineMaintenanceRows
      .filter(item => item.status !== "void")
      .forEach(item =>
        machineMaintenanceAmountById.set(
          item.assetId,
          (machineMaintenanceAmountById.get(item.assetId) ?? 0) +
            Number(item.amount)
        )
      );
    const machineCostSummaryById = new Map(
      (machineCostSummaries.data ?? []).map(item => [item.machineId, item])
    );
    const openMachineEditor = (machine?: (typeof machines)[number]) => {
      setMachineForm(
        machine
          ? {
              id: machine.id,
              projectId: String(machine.projectId),
              operatorPersonId: machine.operatorPersonId
                ? String(machine.operatorPersonId)
                : "",
              operatorUserId: machine.operatorUserId
                ? String(machine.operatorUserId)
                : "",
              ownerUserId: machine.ownerUserId
                ? String(machine.ownerUserId)
                : "",
              code: machine.code,
              name: machine.name,
              model: machine.model ?? "",
              ownership: machine.ownership,
              supplierName: machine.supplierName ?? "",
              plateOrAssetNo: machine.plateOrAssetNo ?? "",
              driverName: machine.driverName ?? "",
              driverPhone: machine.driverPhone ?? "",
              fuelTankCapacityLiters: machine.fuelTankCapacityLiters
                ? String(machine.fuelTankCapacityLiters)
                : "",
              status: machine.status,
              leaseBillingType: machine.leaseTerms?.billingType ?? "monthly",
              leaseRate: machine.leaseTerms?.rate
                ? String(machine.leaseTerms.rate)
                : "",
              leaseStartDate: machine.leaseTerms?.effectiveFrom
                ? toLocalDateInput(machine.leaseTerms.effectiveFrom)
                : "",
              leaseEndDate: machine.leaseTerms?.effectiveTo
                ? toLocalDateInput(machine.leaseTerms.effectiveTo)
                : "",
            }
          : { ...EMPTY_MACHINE_FORM, projectId: String(workspaceProjectId) }
      );
      setMachineDialogOpen(true);
    };
    const openMachineCostEditor = (machine = selectedMachine) => {
      if (!machine) return toast.error("请先选择机械台账");
      setSelectedMachineId(String(machine.id));
      setMachineCostForm({
        ...EMPTY_MACHINE_COST_FORM,
        machineId: String(machine.id),
        projectId: String(workspaceProjectId),
        occurredAt: toLocalDateTimeInput(new Date()),
      });
      setMachineCostDialogOpen(true);
    };
    const openMachineDailyOperationEditor = (machine = selectedMachine) => {
      if (!machine) return toast.error("请先选择机械台账");
      setSelectedMachineId(String(machine.id));
      setMachineDailyOperationForm({
        ...EMPTY_MACHINE_DAILY_OPERATION_FORM,
        machineId: String(machine.id),
        projectId: String(workspaceProjectId),
        operatorUserId: machine.operatorUserId
          ? String(machine.operatorUserId)
          : "",
        shiftRate: "0",
      });
      setMachineDailyOperationDialogOpen(true);
    };
    const openMachineMaintenanceEditor = (
      machine: (typeof machines)[number]
    ) => {
      setSelectedMachineId(String(machine.id));
      setAssetMaintenanceForm({
        ...EMPTY_ASSET_MAINTENANCE_FORM,
        assetType: "machine",
        assetId: String(machine.id),
        projectId: String(machine.projectId),
        occurredAt: toLocalDateTimeInput(new Date()),
      });
      setAssetMaintenanceDialogOpen(true);
    };
    const openMachineDetail = (machine: (typeof machines)[number]) => {
      setSelectedMachineId(String(machine.id));
      setMachineDetailOpen(true);
    };
    const openMachineMonthlyStatement = (
      machine: (typeof machines)[number]
    ) => {
      setSelectedMachineId(String(machine.id));
      setMachineStatementForm({
        ...EMPTY_MACHINE_MONTHLY_STATEMENT_FORM,
        machineId: String(machine.id),
        projectId: String(machine.projectId),
        period: machineStatementPeriod,
        driverUserId: machine.operatorUserId
          ? String(machine.operatorUserId)
          : "",
        machineWorkDays: "0",
        driverWorkDays: "0",
      });
      setMachineStatementDialogOpen(true);
    };
    const getMachineLeaseBillingTypeLabel = (
      billingType: string | null | undefined
    ) =>
      billingType === "monthly"
        ? "月租"
        : billingType === "daily"
          ? "日租"
          : billingType === "hourly"
            ? "小时租"
            : billingType === "shift"
              ? "台班"
              : "计费方式待核对";
    const formatMachineLease = (machine: (typeof machines)[number]) =>
      machine.leaseTerms
        ? `${getMachineLeaseBillingTypeLabel(machine.leaseTerms.billingType)} ¥${displayMoney(machine.leaseTerms.rate)}`
        : machine.ownership === "owned"
          ? "未配置产值计价"
          : "外租 · 未登记有效租金";
    const formatLeaseDates = (machine: (typeof machines)[number]) =>
      machine.leaseTerms
        ? `${toLocalDateInput(machine.leaseTerms.effectiveFrom)} 至 ${machine.leaseTerms.effectiveTo ? toLocalDateInput(machine.leaseTerms.effectiveTo) : "长期"}`
        : "—";
    const machineryFormOpen =
      machineDialogOpen ||
      machineCostDialogOpen ||
      machineDailyOperationDialogOpen ||
      machineStatementDialogOpen ||
      assetMaintenanceDialogOpen ||
      machineryPaymentFormOpen;
    return (
      <div className="min-w-0 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">机械管理</h1>
          <p className="mt-1 text-sm text-slate-500">
            机械档案、司机加班、费用统计、租金结算；沿用原合同、月结依据和凭证分笔付款。
          </p>
        </div>
        <fieldset disabled={machineryFormOpen} className="min-w-0">
          {renderWorkspaceProjectFilter(
            "机械项目范围",
            "档案不绑定创建日期；列表、合计、打印与导出按同一授权筛选。表单未关闭时不可切项目。"
          )}
        </fieldset>
        {!hasBusinessWorkspaceProject ? (
          <EmptyState text="请先选择已授权项目。" />
        ) : (
          <Suspense fallback={<EmptyState text="正在载入机械工作区…" />}>
            <MachineryWorkspace
              projectId={workspaceProjectId}
              active={isMachinery}
              period={machineStatementPeriod}
              onPeriodChange={setMachineStatementPeriod}
              selectedMachineId={selectedMachineId}
              onSelectMachine={setSelectedMachineId}
              formOpen={machineryFormOpen}
              onPaymentFormOpenChange={setMachineryPaymentFormOpen}
              onCreate={() => openMachineEditor()}
              onEdit={openMachineEditor}
              onOvertime={openMachineDailyOperationEditor}
              onCost={openMachineCostEditor}
              onMonthly={openMachineMonthlyStatement}
              onMaintenance={openMachineMaintenanceEditor}
            />
          </Suspense>
        )}
      </div>
    );
  };

  const renderTransport = () => {
    const vehiclesForProject = transportVehicleLedger.data ?? [];
    const rights = transportWorkspaceAccess.data;
    const ledgerActive =
      transportWorkspaceTab === "ledger" || transportWorkspaceTab === "review";
    const openTripSettlement = (trip: any) => {
      setTransportSettlementFocusTrip({
        id: trip.id,
        vehicleId: trip.vehicleId,
        date: toChinaDateInput(trip.startAt),
        legacyUnlinkedSettled: trip.legacyUnlinkedSettled,
        requestId: Date.now(),
      });
      setTransportWorkspaceTab("settlements");
    };
    return (
      <div className="w-full min-w-0 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-[#203c48]">
              运输调度 · 真实业务台账
            </p>
            <h1 className="mt-1 text-2xl font-semibold">运单核验与运输结算</h1>
            <p className="mt-2 text-sm text-slate-500">
              日常运单默认业务当天；核验、结算单与实际付款独立处理。场站终端保留原双向刷卡、拍照与RFID全流程。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setLocation("/admin/vehicles")}
            >
              共用车辆档案 / 柴油分析
            </Button>
            {rights?.canManageResources ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setVehicleCreateRequest({
                    projectId: workspaceProjectId,
                    requestId: Date.now(),
                  });
                  setLocation("/admin/vehicles");
                }}
              >
                录入车辆档案
              </Button>
            ) : null}
          </div>
        </div>
        {renderWorkspaceProjectFilter(
          "运输项目范围",
          "项目范围由服务端授权；切换项目后请重新核对运单与待生成结算，不沿用其他项目草稿。"
        )}
        <TransportWorkspaceNavigation
          tabs={TRANSPORT_WORKSPACE_TABS}
          value={transportWorkspaceTab}
          onValueChange={setTransportWorkspaceTab}
          label="运输工作区栏目"
          disabled={!hasBusinessWorkspaceProject}
        />
        {!hasBusinessWorkspaceProject ? (
          <EmptyState text="请先选择已授权项目。" />
        ) : (
          <div key={workspaceProjectId} className="min-w-0">
            <TransportRetainedPanel
              active={ledgerActive}
              label={
                transportWorkspaceTab === "review"
                  ? "运输核验与异常"
                  : "运输运单台账"
              }
            >
              {transportTrips.isError || transportVehicleLedger.isError ? (
                <EmptyState text="运输台账读取失败，请确认授权后重试。" />
              ) : (
                <Suspense
                  fallback={<EmptyState text="正在加载运输运单台账…" />}
                >
                  <TransportTripLedger
                    filter={transportLedgerFilter}
                    onFilterChange={setTransportLedgerFilter}
                    trips={transportTrips.data ?? []}
                    vehicles={vehiclesForProject}
                    routePresets={transportRoutePresets.data ?? []}
                    loading={transportTrips.isLoading}
                    projectName={selectedWorkspaceProject?.name ?? "当前项目"}
                    active={ledgerActive}
                    reviewMode={transportWorkspaceTab === "review"}
                    reviewView={transportReviewView}
                    onReviewViewChange={setTransportReviewView}
                    canReview={rights?.canReview ?? false}
                    canCreateSettlement={rights?.canCreateSettlement ?? false}
                    canDirectSettle={rights?.canSettle ?? false}
                    onCreateSettlement={openTripSettlement}
                    onTransition={(
                      id,
                      nextStatus,
                      reviewRemarks,
                      reviewConfirmed
                    ) =>
                      transitionTransportTrip.mutate({
                        id,
                        projectId: workspaceProjectId,
                        nextStatus,
                        reviewRemarks,
                        reviewConfirmed,
                      })
                    }
                    transitionPending={transitionTransportTrip.isPending}
                    onExport={(headers, rows) =>
                      downloadCsvFile(
                        `运输车辆趟次台账-${toChinaDateInput(new Date())}.csv`,
                        headers,
                        rows
                      )
                    }
                  />
                </Suspense>
              )}
            </TransportRetainedPanel>
            <TransportRetainedPanel
              active={transportWorkspaceTab === "settlements"}
              label="运输运费结算"
            >
              <Suspense fallback={<EmptyState text="正在加载真实运输结算…" />}>
                <TransportVehicleSettlementManager
                  projectId={workspaceProjectId}
                  vehicles={vehiclesForProject}
                  active={transportWorkspaceTab === "settlements"}
                  canCreate={rights?.canCreateSettlement ?? false}
                  canApprove={rights?.canSettle ?? false}
                  focusTrip={transportSettlementFocusTrip}
                  onDirtyChange={onTransportSettlementDirtyChange}
                />
              </Suspense>
            </TransportRetainedPanel>
            <TransportRetainedPanel
              active={transportWorkspaceTab === "rates"}
              label="运输合同运价"
            >
              <Suspense fallback={<EmptyState text="正在加载合同运价…" />}>
                <TransportFreightRuleManager
                  onDirtyChange={onTransportRatesDirtyChange}
                  projectId={workspaceProjectId}
                  active={transportWorkspaceTab === "rates"}
                  canManage={rights?.canManageResources ?? false}
                />
              </Suspense>
            </TransportRetainedPanel>
            <TransportRetainedPanel
              active={transportWorkspaceTab === "terminals"}
              label="运输场站路线与终端"
            >
              <div className="space-y-4">
                <Suspense fallback={<EmptyState text="正在加载场站路线…" />}>
                  <TransportRouteConfigurationEditor
                    onDirtyChange={onTransportRoutesDirtyChange}
                    projectId={workspaceProjectId}
                    active={transportWorkspaceTab === "terminals"}
                    canManage={rights?.canManageSites ?? false}
                    canConfigureSafety={rights?.canConfigureSafety ?? false}
                  />
                </Suspense>
                <TransportReaderTerminalManager
                  onDirtyChange={onTransportTerminalsDirtyChange}
                  projectId={workspaceProjectId}
                  active={transportWorkspaceTab === "terminals"}
                  canManage={rights?.canManageResources ?? false}
                />
                {transportWorkspaceTab === "terminals"
                  ? renderRfidManagement()
                  : null}
              </div>
            </TransportRetainedPanel>
          </div>
        )}
      </div>
    );
  };

  const renderRfidManagement = () => {
    if (!hasBusinessWorkspaceProject) return null;
    const writerDevices = rfidWriterDevices.data ?? [];
    const cards = vehicleRfidCards.data ?? [];
    const renderVehicleRfidCard = (card: (typeof cards)[number]) => {
      const isInitialIssue = !card.lastWrittenAt;
      const canWrite =
        Boolean(card.vehicleId) &&
        (isInitialIssue
          ? card.status === "suspended" || card.status === "active"
          : card.status === "active");
      const canRebind = card.status === "revoked" && !card.vehicleId;
      const openRevokedUnboundCardRebind = () => {
        const firstVehicle =
          transportVehicleLedger.data?.find(
            vehicle => vehicle.status === "active"
          ) ?? transportVehicleLedger.data?.[0];
        setRfidCardForm({
          id: Number(card.id),
          vehicleId: firstVehicle ? String(firstVehicle.id) : "",
          writerDeviceId: card.writerDeviceId
            ? String(card.writerDeviceId)
            : writerDevices[0]
              ? String(writerDevices[0].id)
              : "",
          managementCode: card.managementCode || "",
          cardUid: "",
          driverPhone: firstVehicle?.driverPhone || "",
          status: "suspended",
          reuseRevokedUnboundCard: true,
        });
        setRfidCardDialogOpen(true);
      };
      return (
        <TableRow key={card.id}>
          <TableCell className="whitespace-nowrap font-medium text-slate-800">
            {card.plateNo || "未绑定车辆"}
          </TableCell>
          <TableCell className="whitespace-nowrap">
            {card.status === "suspended" && isInitialIssue ? (
              <Badge className="bg-amber-50 text-amber-700">待写入</Badge>
            ) : (
              <BusinessStatusBadge status={card.status} />
            )}
          </TableCell>
          <TableCell className="whitespace-nowrap font-mono text-xs font-semibold text-slate-800">
            {card.managementCode || "待补编号"}
          </TableCell>
          <TableCell className="whitespace-nowrap text-xs text-slate-500">
            UID 尾号 {card.cardUidMasked}
          </TableCell>
          <TableCell className="whitespace-nowrap text-xs text-slate-600">
            {card.driverPhoneMasked || "未登记"}
          </TableCell>
          <TableCell className="whitespace-nowrap text-xs text-slate-600">
            {card.writerName || "未指定"}
            {card.writerModel ? `（${card.writerModel}）` : ""}
          </TableCell>
          <TableCell className="whitespace-nowrap text-xs text-slate-600">
            {displayDate(card.lastWrittenAt)}
          </TableCell>
          <TableCell>
            <div className="flex min-w-max items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleRevokeVehicleRfidCard(Number(card.id))}
                disabled={
                  revokeVehicleRfidCard.isPending || card.status === "revoked"
                }
              >
                {revokeVehicleRfidCard.isPending ? "处理中…" : "挂失停用"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleUnbindVehicleRfidCard(Number(card.id))}
                disabled={unbindVehicleRfidCard.isPending || !card.vehicleId}
              >
                {unbindVehicleRfidCard.isPending ? "处理中…" : "解除绑定"}
              </Button>
              {canRebind ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={openRevokedUnboundCardRebind}
                  disabled={saveVehicleRfidCard.isPending}
                >
                  重新绑定
                </Button>
              ) : null}
              {card.confirmationRecoveryJobId ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void verifyAndConfirmWrittenRfidCard(
                      Number(card.confirmationRecoveryJobId)
                    )
                  }
                  disabled={
                    retryingRfidCardConfirmation ||
                    recoverRfidCardConfirmation.isPending
                  }
                >
                  {retryingRfidCardConfirmation ||
                  recoverRfidCardConfirmation.isPending
                    ? "只读复核中…"
                    : "只读复核并启用"}
                </Button>
              ) : null}
              <Button
                size="sm"
                onClick={() =>
                  prepareRfidCardWrite.mutate({
                    cardId: Number(card.id),
                    projectId: workspaceProjectId,
                    writerDeviceId: card.writerDeviceId ?? null,
                    action: isInitialIssue ? "issue" : "rewrite",
                    executionMode: "pc_bridge",
                  })
                }
                disabled={
                  prepareRfidCardWrite.isPending ||
                  !canWrite ||
                  Boolean(card.confirmationRecoveryJobId)
                }
              >
                {prepareRfidCardWrite.isPending
                  ? "生成中…"
                  : isInitialIssue
                    ? "PC 写入车辆卡"
                    : "PC 补写车辆卡"}
              </Button>
            </div>
          </TableCell>
        </TableRow>
      );
    };
    return (
      <div className="space-y-5">
        <Card className="border-[#d8e3e0] bg-[#f8fcfb]">
          <CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0">
            <div>
              <p className="text-sm font-medium text-[#203c48]">
                射频写卡 · 受控预留
              </p>
              <CardTitle className="mt-1 text-base">
                车辆卡绑定与写卡任务
              </CardTitle>
              <CardDescription className="mt-1 max-w-3xl">
                系统生成并审计车辆、车型、货厢、司机与联系电话载荷；电脑读卡器刷有效车辆卡时，可经本机桥接读取受控深链并进入对应运输页面。
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void openVehicleTransportFromBridge()}
                disabled={readingVehicleCardEntry}
              >
                {readingVehicleCardEntry ? "正在读取车辆卡…" : "开始刷车辆卡"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setRfidWriterDeviceForm(EMPTY_RFID_WRITER_DEVICE_FORM);
                  setRfidWriterDialogOpen(true);
                }}
              >
                登记写卡器
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const firstVehicle = transportVehicleLedger.data?.[0];
                  setRfidCardForm({
                    ...EMPTY_RFID_CARD_FORM,
                    vehicleId: firstVehicle ? String(firstVehicle.id) : "",
                    writerDeviceId: writerDevices[0]
                      ? String(writerDevices[0].id)
                      : "",
                    driverPhone: firstVehicle?.driverPhone || "",
                  });
                  setRfidCardDialogOpen(true);
                }}
                disabled={!transportVehicleLedger.data?.length}
              >
                绑定车辆卡
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <p className="mr-1 text-sm font-medium text-slate-800">
                  写卡器设备
                </p>
                {writerDevices.length ? (
                  writerDevices.map(device => (
                    <div
                      key={device.id}
                      className="flex items-center gap-2 text-xs text-slate-600"
                    >
                      <span className="font-medium text-slate-800">
                        {device.displayName}
                      </span>
                      <BusinessStatusBadge status={device.status} />
                      <span>
                        编号 {device.deviceCode} ·{" "}
                        {device.model || "待采购/未登记"}
                      </span>
                    </div>
                  ))
                ) : (
                  <span className="text-xs text-slate-500">
                    尚未登记写卡器。可先登记编号和型号。
                  </span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    换电脑首次使用写卡器
                  </p>
                  <p className="mt-0.5 text-xs text-slate-600">
                    下载并解压后，双击“Install-Yuexin-RFID-Bridge.cmd”（旧包可能显示“安装写卡桥接.cmd”），在系统权限窗口选择“是”。无需手动输入
                    PowerShell 命令；脚本会检查
                    Windows、读卡器组件和桥接版本，完成后登录 Windows
                    自动启动本机桥接。
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    window.open(
                      RFID_FIRST_INSTALL_PACKAGE_URL,
                      "_blank",
                      "noopener,noreferrer"
                    )
                  }
                >
                  <ExternalLink className="mr-1.5 h-4 w-4" />
                  下载一键安装包
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-800">车辆射频卡</p>
                <p className="text-xs text-slate-500">
                  管理编号完整显示；芯片 UID 仅显示受控尾号
                </p>
              </div>
              {cards.length ? (
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <Table className="min-w-[1120px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>车辆</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>车辆卡管理编号</TableHead>
                        <TableHead>芯片识别</TableHead>
                        <TableHead>司机电话</TableHead>
                        <TableHead>写卡器</TableHead>
                        <TableHead>最近写入</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>{cards.map(renderVehicleRfidCard)}</TableBody>
                  </Table>
                </div>
              ) : (
                <EmptyState text="尚未绑定车辆射频卡。请先登记车辆和司机，再读取卡 UID 完成绑定。" />
              )}
            </div>
          </CardContent>
        </Card>

        <Dialog
          open={rfidWriterDialogOpen}
          onOpenChange={setRfidWriterDialogOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>登记射频写卡器</DialogTitle>
              <DialogDescription>
                目前先记录写卡器型号与使用状态；未接入设备适配器前，系统只允许生成并人工确认写卡任务。
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="设备编号">
                  <Input
                    value={rfidWriterDeviceForm.deviceCode}
                    placeholder="例如 RFID-W-001"
                    onChange={event =>
                      setRfidWriterDeviceForm(current => ({
                        ...current,
                        deviceCode: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="显示名称">
                  <Input
                    value={rfidWriterDeviceForm.displayName}
                    placeholder="装土点写卡器"
                    onChange={event =>
                      setRfidWriterDeviceForm(current => ({
                        ...current,
                        displayName: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="型号（预留）">
                  <Input
                    value={rfidWriterDeviceForm.model}
                    placeholder="采购后填写"
                    onChange={event =>
                      setRfidWriterDeviceForm(current => ({
                        ...current,
                        model: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="连接方式">
                  <Select
                    value={rfidWriterDeviceForm.connectionMode}
                    onValueChange={value =>
                      setRfidWriterDeviceForm(current => ({
                        ...current,
                        connectionMode:
                          value as RfidWriterDeviceForm["connectionMode"],
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual_placeholder">
                        人工确认（当前）
                      </SelectItem>
                      <SelectItem value="usb">USB（预留）</SelectItem>
                      <SelectItem value="serial">串口（预留）</SelectItem>
                      <SelectItem value="network">网络（预留）</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field label="备注">
                <Input
                  value={rfidWriterDeviceForm.remarks}
                  onChange={event =>
                    setRfidWriterDeviceForm(current => ({
                      ...current,
                      remarks: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setRfidWriterDialogOpen(false)}
              >
                取消
              </Button>
              <Button
                disabled={
                  !rfidWriterDeviceForm.deviceCode.trim() ||
                  !rfidWriterDeviceForm.displayName.trim() ||
                  saveRfidWriterDevice.isPending
                }
                onClick={() =>
                  saveRfidWriterDevice.mutate({
                    projectId: workspaceProjectId,
                    deviceCode: rfidWriterDeviceForm.deviceCode,
                    displayName: rfidWriterDeviceForm.displayName,
                    model: rfidWriterDeviceForm.model || null,
                    connectionMode: rfidWriterDeviceForm.connectionMode,
                    status: rfidWriterDeviceForm.status,
                    remarks: rfidWriterDeviceForm.remarks || null,
                  })
                }
              >
                {saveRfidWriterDevice.isPending ? "保存中…" : "保存设备"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={rfidCardDialogOpen} onOpenChange={setRfidCardDialogOpen}>
          <DialogContent className="w-[calc(100vw-3rem)] max-w-4xl xl:max-w-5xl">
            <DialogHeader>
              <DialogTitle>
                {rfidCardForm.reuseRevokedUnboundCard
                  ? "重新绑定已解绑车辆卡"
                  : "绑定车辆射频卡"}
              </DialogTitle>
              <DialogDescription>
                {rfidCardForm.reuseRevokedUnboundCard
                  ? "此操作只适用于已挂失且已解绑的同一张实体卡。请读取当前卡 ID，选择新的目标车辆；系统会保留历史台账与审计、使旧深链失效，并将该卡恢复为待写入。"
                  : "此窗口的车牌、驾驶员姓名和电话来自当前选择的车辆台账预填，并非从实体卡读取。只有“卡 ID / UID”由读卡器读取；UID 是芯片出厂标识，不会因恢复初卡而改变。恢复初卡已清空的是 NDEF 用户区。服务端保存 UID 指纹和电话密文；业务资料按授权展示，卡片写入不会写入身份证、银行卡、路线或结算金额。"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="车辆（车牌号）">
                  <Select
                    value={rfidCardForm.vehicleId}
                    onValueChange={value => {
                      const vehicle = (transportVehicleLedger.data ?? []).find(
                        item => String(item.id) === value
                      );
                      setRfidCardForm(current => ({
                        ...current,
                        vehicleId: value,
                        driverPhone:
                          vehicle?.driverPhone || current.driverPhone,
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择车辆" />
                    </SelectTrigger>
                    <SelectContent>
                      {transportVehicleLedger.data?.map(vehicle => (
                        <SelectItem key={vehicle.id} value={String(vehicle.id)}>
                          {vehicle.plateNo}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="写卡器（用于审计）">
                  <Select
                    value={rfidCardForm.writerDeviceId || "UNASSIGNED"}
                    onValueChange={value =>
                      setRfidCardForm(current => ({
                        ...current,
                        writerDeviceId: value === "UNASSIGNED" ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择写卡器" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UNASSIGNED">暂不指定</SelectItem>
                      {writerDevices
                        .filter(device => device.status === "active")
                        .map(device => (
                          <SelectItem key={device.id} value={String(device.id)}>
                            {device.displayName} · {device.deviceCode}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid gap-3 rounded-xl border border-cyan-200 bg-cyan-50/60 p-3 sm:grid-cols-2">
                <Field label="车辆卡管理编号（后台完整显示）">
                  <Input
                    value={rfidCardForm.managementCode}
                    placeholder="例如 RFID-001 或 车队A-0389"
                    onChange={event =>
                      setRfidCardForm(current => ({
                        ...current,
                        managementCode: event.target.value,
                      }))
                    }
                  />
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    用于现场台账识别，不是芯片
                    UID，不写入实体卡；留空时系统自动生成。
                  </p>
                </Field>
                <Field label="车牌号（车辆表单预填）">
                  <Input
                    disabled
                    value={selectedRfidVehicle?.plateNo || "请先选择车辆"}
                  />
                </Field>
                <Field label="驾驶员姓名（车辆表单预填）">
                  <Input
                    disabled
                    value={
                      selectedRfidVehicle?.driverName ||
                      "车辆台账尚未填写驾驶员姓名"
                    }
                  />
                </Field>
                <Field label="驾驶员联系电话（车辆表单预填）">
                  <Input
                    value={rfidCardForm.driverPhone}
                    placeholder="选择车辆后自动带入，可按现场确认修改"
                    onChange={event =>
                      setRfidCardForm(current => ({
                        ...current,
                        driverPhone: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="卡 ID / UID（芯片固定标识）">
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={rfidCardForm.cardUid}
                      placeholder="请点击右侧读取卡 ID"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0"
                      onClick={readRfidBindingUid}
                      disabled={readingRfidBindingUid}
                    >
                      {readingRfidBindingUid ? "读取中…" : "读取卡 ID"}
                    </Button>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    “读取卡 ID”只适用于已安装并运行的 Windows
                    本机桥接程序。更换电脑后需重新安装/启动桥接程序，并在浏览器弹窗中允许本站访问本机设备；如果只是现场刷卡，请改用移动端
                    Android Chrome 的“刷 NFC 发票”或键盘式读卡器输出 UID。
                  </p>
                </Field>
                <Field label="卡片状态">
                  <Input
                    disabled
                    value={
                      rfidCardForm.status === "suspended"
                        ? "待写入（写入并回读确认后启用）"
                        : rfidCardForm.status === "active"
                          ? "已启用"
                          : "已停用"
                    }
                  />
                </Field>
                <Field label="签名版本">
                  <Input disabled value="RC3 · 服务端签名校验" />
                </Field>
              </div>
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                恢复初卡后，NDEF
                用户区已经清空；本窗口仍显示的车辆信息只用于准备下一次绑定，不代表卡内残留内容。UID
                始终保留为芯片固定标识。写入正式卡时，卡内仅包含车牌号、驾驶员姓名、联系电话、卡绑定引用、项目引用、修订号、随机挑战值与签名。路线、方量、单价、金额和结算状态不写入卡片。
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setRfidCardDialogOpen(false)}
              >
                取消
              </Button>
              <Button
                disabled={
                  !rfidCardForm.vehicleId ||
                  !rfidCardForm.cardUid.trim() ||
                  !rfidCardForm.driverPhone.trim() ||
                  saveVehicleRfidCard.isPending
                }
                onClick={() =>
                  saveVehicleRfidCard.mutate({
                    id: rfidCardForm.id,
                    projectId: workspaceProjectId,
                    vehicleId: Number(rfidCardForm.vehicleId),
                    writerDeviceId: rfidCardForm.writerDeviceId
                      ? Number(rfidCardForm.writerDeviceId)
                      : null,
                    managementCode: rfidCardForm.managementCode.trim() || null,
                    cardUid: rfidCardForm.cardUid,
                    driverPhone: rfidCardForm.driverPhone,
                    status: rfidCardForm.status,
                    reuseRevokedUnboundCard:
                      rfidCardForm.reuseRevokedUnboundCard,
                  })
                }
              >
                {saveVehicleRfidCard.isPending
                  ? "保存中…"
                  : rfidCardForm.reuseRevokedUnboundCard
                    ? "确认重新绑定"
                    : "保存绑定"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={Boolean(rfidWritePreview)}
          onOpenChange={open => {
            if (
              !open &&
              !writingRfidCard &&
              !retryingRfidCardConfirmation &&
              !checkingRfidBridgeReadiness
            )
              setRfidWritePreview(null);
          }}
        >
          <DialogContent className="w-[calc(100vw-3rem)] max-w-4xl xl:max-w-5xl">
            <DialogHeader>
              <DialogTitle>
                {rfidWritePreview?.hardwareMode === "pc_bridge"
                  ? "PC 受控车辆卡写入"
                  : "受控写卡载荷"}{" "}
                · {rfidWritePreview?.jobNo}
              </DialogTitle>
              <DialogDescription>
                {rfidWritePreview?.hardwareMode === "pc_bridge"
                  ? "请将已绑定的 NTAG216 保持在 uTrust 4701 F CL Reader 感应区。系统仅把一次性任务授权交给本机桥接；桥接将读取 UID、向服务器领取匹配载荷、写入 NDEF 并逐字节回读，全部成功后自动确认。"
                  : "请将下列载荷写入已绑定物理卡。写入成功后再确认；此处内容不保存到数据库，关闭窗口后需重新生成任务。"}
              </DialogDescription>
            </DialogHeader>
            {rfidWritePreview?.hardwareMode === "pc_bridge" ? (
              <>
                <RfidBridgeReadinessPanel
                  result={rfidBridgeReadiness}
                  checking={checkingRfidBridgeReadiness}
                  disabled={writingRfidCard || retryingRfidCardConfirmation}
                  onCheck={() => void checkRfidBridgeReadiness()}
                />
                <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4 text-sm leading-6 text-cyan-950">
                  <p className="font-semibold">
                    将卡片放在读卡器感应区后开始。
                  </p>
                  <p className="mt-1 text-xs">
                    不会向浏览器或桥接暴露签名密钥、可编辑载荷或写保护口令；写入失败会记录原因，不能被手工标记成功。
                  </p>
                  <p className="mt-2 text-xs">
                    若已完成写入和回读但确认暂未返回，可在当前任务有效期内使用“仅回传确认”；该操作不再次写入
                    NDEF，只会提交本机 DPAPI 加密短时收据。
                  </p>
                  <p className="mt-2 text-xs">
                    更换电脑后必须在新电脑启动 Windows
                    桥接程序并允许本站访问本机设备。手机不能连接此 Windows
                    本机桥接；手机端请使用 Android Chrome 的 Web NFC
                    入口，或使用 OTG 键盘式读卡器输出 UID。
                  </p>
                </div>
              </>
            ) : (
              <pre className="max-h-[45vh] overflow-auto rounded-xl bg-slate-950 p-3 text-xs leading-5 text-emerald-100">
                {rfidWritePreview
                  ? JSON.stringify(rfidWritePreview.payload, null, 2)
                  : ""}
              </pre>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() =>
                  rfidWritePreview &&
                  confirmRfidCardWrite.mutate({
                    id: rfidWritePreview.jobId,
                    projectId: workspaceProjectId,
                    success: false,
                    failureReason: "现场未完成物理写卡",
                  })
                }
                disabled={
                  confirmRfidCardWrite.isPending ||
                  writingRfidCard ||
                  retryingRfidCardConfirmation
                }
              >
                {rfidWritePreview?.hardwareMode === "pc_bridge"
                  ? "关闭并作废任务"
                  : "记录写卡失败"}
              </Button>
              {rfidWritePreview?.hardwareMode === "pc_bridge" ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => void confirmRfidCardWithBridgeReceipt()}
                    disabled={writingRfidCard || retryingRfidCardConfirmation}
                  >
                    {retryingRfidCardConfirmation
                      ? "正在回传确认…"
                      : "仅回传确认（不写卡）"}
                  </Button>
                  <Button
                    onClick={() => void writeRfidCardWithBridge()}
                    disabled={
                      writingRfidCard ||
                      retryingRfidCardConfirmation ||
                      checkingRfidBridgeReadiness
                    }
                  >
                    {writingRfidCard ? "正在写入并回读…" : "写入并回读确认"}
                  </Button>
                </>
              ) : (
                <Button
                  onClick={() =>
                    rfidWritePreview &&
                    confirmRfidCardWrite.mutate({
                      id: rfidWritePreview.jobId,
                      projectId: workspaceProjectId,
                      success: true,
                    })
                  }
                  disabled={confirmRfidCardWrite.isPending}
                >
                  {confirmRfidCardWrite.isPending
                    ? "确认中…"
                    : "已完成物理写卡"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  };

  const printBusinessGovernanceReport = () => {
    const dashboard = operatingDashboard.data;
    if (!dashboard) {
      toast.error("当前筛选范围的经营数据尚未就绪，请刷新统计后再打印");
      return;
    }
    const projectName = selectedBusinessProject?.name ?? "全部项目";
    const periodLabel = businessFilter.period || "全部期间";
    const categoryRows =
      dashboard.finance.categories
        .map(
          item =>
            `<tr><td>${escapePrintHtml(item.category)}</td><td class="right">¥${escapePrintHtml(displayMoney(item.amount))}</td><td class="right">¥${escapePrintHtml(displayMoney(item.unpaid))}</td><td class="right">¥${escapePrintHtml(displayMoney(item.paid))}</td></tr>`
        )
        .join("") ||
      '<tr><td colspan="4" class="center">当前范围暂无有效支出分类记录</td></tr>';
    const moduleRows =
      (businessStatistics.data ?? [])
        .map(
          module =>
            `<tr><td>${escapePrintHtml(module.name)}</td><td class="center">${escapePrintHtml(module.recordCount)}</td><td>${escapePrintHtml(module.code)}</td></tr>`
        )
        .join("") ||
      '<tr><td colspan="3" class="center">当前范围暂无业务模块统计</td></tr>';
    const percentage = (value: number | null) =>
      value === null ? "—" : `${Number(value).toFixed(1)}%`;
    openA4LandscapePrintDocument({
      title: `经营数据汇总-${businessFilter.period || "全部期间"}`,
      bodyHtml: `<h1>经营数据汇总与业务统计</h1><p class="sub">统计范围：${escapePrintHtml(projectName)} · ${escapePrintHtml(periodLabel)}　生成时间：${escapePrintHtml(formatChinaDateTime(new Date()))}</p><hr class="rule"><h2>资金、计量与资源汇总</h2><table><thead><tr><th>总收入</th><th>已开发票</th><th>应收余额</th><th>应付余额</th><th>有效支出</th><th>已付金额</th></tr></thead><tbody><tr><td class="right">¥${escapePrintHtml(displayMoney(dashboard.finance.totalIncome))}</td><td class="right">¥${escapePrintHtml(displayMoney(dashboard.finance.invoiceAmount))}</td><td class="right">¥${escapePrintHtml(displayMoney(dashboard.finance.receivable))}</td><td class="right">¥${escapePrintHtml(displayMoney(dashboard.finance.payable))}</td><td class="right">¥${escapePrintHtml(displayMoney(dashboard.finance.totalExpense))}</td><td class="right">¥${escapePrintHtml(displayMoney(dashboard.finance.paidAmount))}</td></tr></tbody></table><table class="section-table"><thead><tr><th>申报计量</th><th>核定计量</th><th>已结算产值</th><th>结算比</th><th>付款比</th><th>运输趟次</th><th>施工日报</th><th>待处理计量</th></tr></thead><tbody><tr><td class="right">¥${escapePrintHtml(displayMoney(dashboard.measurement.declaredAmount))}</td><td class="right">¥${escapePrintHtml(displayMoney(dashboard.measurement.approvedAmount))}</td><td class="right">¥${escapePrintHtml(displayMoney(dashboard.measurement.settledAmount))}</td><td class="right">${escapePrintHtml(percentage(dashboard.finance.settlementRatio))}</td><td class="right">${escapePrintHtml(percentage(dashboard.finance.paymentRatio))}</td><td class="right">${escapePrintHtml(dashboard.resources.transportTripCount)} 趟</td><td class="right">${escapePrintHtml(dashboard.progress.reportCount)} 条</td><td class="right">${escapePrintHtml(dashboard.measurement.pendingCount)} 笔</td></tr></tbody></table><h2>支出分类、待付与已付明细</h2><table><thead><tr><th>支出类别</th><th class="right">有效支出</th><th class="right">待付</th><th class="right">已付</th></tr></thead><tbody>${categoryRows}<tr class="summary"><td>分类合计</td><td class="right">¥${escapePrintHtml(displayMoney(dashboard.finance.categories.reduce((sum, item) => sum + Number(item.amount), 0)))}</td><td class="right">¥${escapePrintHtml(displayMoney(dashboard.finance.categories.reduce((sum, item) => sum + Number(item.unpaid), 0)))}</td><td class="right">¥${escapePrintHtml(displayMoney(dashboard.finance.categories.reduce((sum, item) => sum + Number(item.paid), 0)))}</td></tr></tbody></table><h2>业务模块记录统计</h2><table><thead><tr><th>业务模块</th><th>当前真实记录</th><th>模块编号</th></tr></thead><tbody>${moduleRows}</tbody></table><p class="footer-note">说明：本打印件仅反映以上项目与期间筛选内、由服务端实时聚合的真实台账；备份文件、权限配置、密钥、账号信息及其他系统设置不纳入打印。</p><div class="footer"><span>制表：系统按当前筛选生成</span><span>复核：________________</span></div>`,
    });
  };

  const renderBusiness = () => (
    <div className="space-y-6" id="business-governance-report">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[#203c48]">全业务治理</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            业务模块、统计与安全备份
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            超级管理员可从本页进入各业务模块维护真实数据。原有审批、状态流转、项目范围与敏感字段保护仍由服务端执行，不因后台入口而放宽。
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void businessStatistics.refetch();
              void operatingDashboard.refetch();
            }}
            disabled={
              businessStatistics.isFetching || operatingDashboard.isFetching
            }
          >
            刷新统计
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={printBusinessGovernanceReport}
            disabled={!operatingDashboard.data || operatingDashboard.isFetching}
          >
            <Printer className="mr-1.5 h-4 w-4" />
            打印当前筛选明细与汇总
          </Button>
        </div>
      </div>

      <Card className="print:border-0 print:shadow-none">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[220px] flex-1">
            <Label htmlFor="business-project-filter">统计项目</Label>
            <Select
              value={businessFilter.projectId}
              onValueChange={projectId =>
                setBusinessFilter(current => ({ ...current, projectId }))
              }
            >
              <SelectTrigger id="business-project-filter" className="mt-1">
                <SelectValue placeholder="选择项目" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部项目</SelectItem>
                {(projects.data ?? [])
                  .filter(project => project.status !== "archived")
                  .map(project => (
                    <SelectItem key={project.id} value={String(project.id)}>
                      {project.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[180px]">
            <Label htmlFor="business-period-filter">统计期间</Label>
            <Input
              id="business-period-filter"
              className="mt-1"
              type="month"
              value={businessFilter.period}
              onChange={event =>
                setBusinessFilter(current => ({
                  ...current,
                  period: event.target.value,
                }))
              }
            />
          </div>
          <Button
            className="print:hidden"
            size="sm"
            variant="outline"
            onClick={() => setBusinessFilter({ projectId: "all", period: "" })}
            disabled={
              businessFilter.projectId === "all" && !businessFilter.period
            }
          >
            清除筛选
          </Button>
          <p className="w-full text-xs text-slate-500">
            当前统计与打印口径：{businessFilterLabel}
            。基础档案按创建时间、业务单据按发生日期或结算期间统计。
          </p>
        </CardContent>
      </Card>

      <Card className="border-[#d8e3e0]" id="operating-dashboard">
        <CardHeader>
          <CardTitle className="text-base">经营数据汇总</CardTitle>
          <CardDescription>
            汇总当前项目和期间范围内的真实财务、发票、计量、施工日报、工资与运输台账。金额单位：元；结算比＝已结算计量÷核定计量，付款比＝已付支出÷有效支出。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isAuthenticated ? (
            <EmptyState text="请先登录超级管理员账号后读取经营数据。" />
          ) : operatingDashboard.isLoading ? (
            <EmptyState text="正在汇总真实经营数据…" />
          ) : operatingDashboard.isError || !operatingDashboard.data ? (
            <EmptyState text="暂无法读取经营数据，请确认超级管理员权限与真实台账连接。" />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  [
                    "总收入",
                    operatingDashboard.data.finance.totalIncome,
                    "/admin/finance",
                  ],
                  [
                    "已开发票",
                    operatingDashboard.data.finance.invoiceAmount,
                    "/admin/finance",
                  ],
                  [
                    "总欠款（应收+应付）",
                    operatingDashboard.data.finance.receivable +
                      operatingDashboard.data.finance.payable,
                    "/admin/finance",
                  ],
                  [
                    "各类已付",
                    operatingDashboard.data.finance.paidAmount,
                    "/admin/finance",
                  ],
                  [
                    "结算比",
                    operatingDashboard.data.finance.settlementRatio === null
                      ? "—"
                      : `${operatingDashboard.data.finance.settlementRatio}%`,
                    "/admin/measurement-tools",
                  ],
                  [
                    "付款比",
                    operatingDashboard.data.finance.paymentRatio === null
                      ? "—"
                      : `${operatingDashboard.data.finance.paymentRatio}%`,
                    "/admin/finance",
                  ],
                  [
                    "项目进度",
                    operatingDashboard.data.progress.averageProgressPercent ===
                    null
                      ? "未提交"
                      : `${operatingDashboard.data.progress.averageProgressPercent}%`,
                    "/admin/construction",
                  ],
                  [
                    "运输趟次",
                    operatingDashboard.data.resources.transportTripCount,
                    "/admin/transport",
                  ],
                ].map(([label, value, path]) => (
                  <button
                    key={String(label)}
                    type="button"
                    onClick={() => setLocation(String(path))}
                    className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-[#3e746a] hover:shadow"
                  >
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className="mt-2 text-xl font-semibold text-[#203c48]">
                      {typeof value === "number" &&
                      !String(label).includes("趟次")
                        ? `¥${displayMoney(value)}`
                        : value}
                    </p>
                    <p className="mt-1 text-xs text-[#3e746a]">点击查看明细</p>
                  </button>
                ))}
              </div>
              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="font-medium text-slate-800">
                    计量、产值与施工日报
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <p>
                      申报计量：
                      <b>
                        ¥
                        {displayMoney(
                          operatingDashboard.data.measurement.declaredAmount
                        )}
                      </b>
                    </p>
                    <p>
                      核定计量：
                      <b>
                        ¥
                        {displayMoney(
                          operatingDashboard.data.measurement.approvedAmount
                        )}
                      </b>
                    </p>
                    <p>
                      已结算：
                      <b>
                        ¥
                        {displayMoney(
                          operatingDashboard.data.measurement.settledAmount
                        )}
                      </b>
                    </p>
                    <p>
                      待处理：
                      <b>
                        {operatingDashboard.data.measurement.pendingCount} 笔
                      </b>
                    </p>
                    <p>
                      施工日报：
                      <b>{operatingDashboard.data.progress.reportCount} 条</b>
                    </p>
                    <p>
                      已审核日报：
                      <b>
                        {operatingDashboard.data.progress.approvedReportCount}{" "}
                        条
                      </b>
                    </p>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="font-medium text-slate-800">劳务与资源投入</p>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <p>
                      月度工资实发：
                      <b>
                        ¥
                        {displayMoney(
                          operatingDashboard.data.resources.payrollActualAmount
                        )}
                      </b>
                    </p>
                    <p>
                      临时日结实发：
                      <b>
                        ¥
                        {displayMoney(
                          operatingDashboard.data.resources
                            .dailyWageActualAmount
                        )}
                      </b>
                    </p>
                    <p>
                      运输趟次：
                      <b>
                        {operatingDashboard.data.resources.transportTripCount}{" "}
                        趟
                      </b>
                    </p>
                    <p>
                      当前范围：<b>{businessFilterLabel}</b>
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>支出类别</TableHead>
                      <TableHead className="text-right">有效支出</TableHead>
                      <TableHead className="text-right">待付</TableHead>
                      <TableHead className="text-right">已付</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {operatingDashboard.data.finance.categories.length ? (
                      operatingDashboard.data.finance.categories.map(item => (
                        <TableRow key={item.category}>
                          <TableCell>{item.category}</TableCell>
                          <TableCell className="text-right">
                            ¥{displayMoney(item.amount)}
                          </TableCell>
                          <TableCell className="text-right text-amber-700">
                            ¥{displayMoney(item.unpaid)}
                          </TableCell>
                          <TableCell className="text-right text-emerald-700">
                            ¥{displayMoney(item.paid)}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="h-20 text-center text-slate-500"
                        >
                          当前范围暂无有效支出分类记录。
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">全业务管理入口</CardTitle>
          <CardDescription>
            从此处进入对应的 PC
            业务工作区，保留后台导航与电脑宽版布局；超级管理员可维护记录，普通人员仍会受到角色、部门与项目范围限制。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isAuthenticated ? (
            <EmptyState text="请先登录超级管理员账号后读取真实业务统计。" />
          ) : businessStatistics.isLoading ? (
            <EmptyState text="正在汇总真实业务记录…" />
          ) : businessStatistics.isError ? (
            <EmptyState text="暂无法读取全业务统计，请确认当前账号具有超级管理员权限。" />
          ) : businessStatistics.data?.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {businessStatistics.data.map(module => {
                const pcRoute = getAdminBusinessRoute(module.code);
                return (
                  <div
                    key={module.code}
                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">
                          {module.name}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          当前真实记录
                        </p>
                      </div>
                      <Badge variant="secondary">{module.recordCount} 条</Badge>
                    </div>
                    <Button
                      className="mt-4 w-full print:hidden"
                      size="sm"
                      variant="outline"
                      disabled={!pcRoute}
                      aria-label={`进入${module.name}PC维护`}
                      onClick={() => {
                        if (!pcRoute) return;
                        requestDashboardNavigation(
                          location,
                          pcRoute,
                          setLocation,
                          () =>
                            !hasWorkspaceDraft ||
                            window.confirm(
                              "有尚未保存的业务资料，离开当前模块将放弃未保存内容。确认离开吗？"
                            )
                        );
                      }}
                    >
                      <ExternalLink className="mr-1.5 h-4 w-4" />
                      {pcRoute ? "进入维护" : "暂无 PC 维护入口"}
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState text="暂无业务模块统计结果。" />
          )}
        </CardContent>
      </Card>

      <Card className="border-[#d8e3e0]">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">业务数据逻辑备份</CardTitle>
            <CardDescription>
              创建只包含业务数据与关联元数据的 JSON
              快照；不包含口令摘要、接口密钥、敏感系统配置、审计日志或影像文件本体。在线恢复未开放，防止误覆盖生产数据。
            </CardDescription>
          </div>
          <Button
            className="shrink-0 print:hidden"
            size="sm"
            onClick={() => createBackup.mutate()}
            disabled={createBackup.isPending}
          >
            <DatabaseBackup className="mr-1.5 h-4 w-4" />
            {createBackup.isPending ? "正在归档…" : "创建备份"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {!isAuthenticated ? (
            <EmptyState text="请先登录超级管理员账号后读取已归档备份。" />
          ) : backups.isLoading ? (
            <EmptyState text="正在读取已归档备份…" />
          ) : backups.isError ? (
            <EmptyState text="暂无法读取备份目录，请稍后重试。" />
          ) : backups.data?.length ? (
            backups.data.map(backup => (
              <div
                key={backup.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {backup.fileName}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {displayDate(backup.createdAt)} · {backup.recordCount} 条 ·
                    SHA-256：{backup.sha256.slice(0, 12)}… · 范围{" "}
                    {backup.scopeVersion}
                  </p>
                </div>
                <Button
                  className="print:hidden"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    downloadBackup.mutate({ id: Number(backup.id) })
                  }
                  disabled={downloadBackup.isPending}
                >
                  下载
                </Button>
              </div>
            ))
          ) : (
            <EmptyState text="尚无已归档备份。首次创建备份前不会生成任何示例文件。" />
          )}
        </CardContent>
      </Card>

      <Card className="border-[#b7d3cc] bg-[#f7fcfa]">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">
              完整数据库灾备（服务器端）
            </CardTitle>
            <CardDescription>
              导出完整 MySQL
              数据库的全部表、表结构、触发器、例程和事件，并校验压缩、SHA-256
              与每张表定义。数据库凭据、服务器路径和恢复口令不会返回浏览器。
            </CardDescription>
          </div>
          <Button
            className="shrink-0 print:hidden"
            size="sm"
            onClick={() => createFullDatabaseBackup.mutate()}
            disabled={
              createFullDatabaseBackup.isPending ||
              !fullDatabaseBackup.data?.configured ||
              !fullDatabaseBackup.data?.executable
            }
          >
            <DatabaseBackup className="mr-1.5 h-4 w-4" />
            {createFullDatabaseBackup.isPending
              ? "正在执行完整备份…"
              : "执行完整备份"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {!isAuthenticated ? (
            <EmptyState text="请先登录超级管理员账号后读取完整数据库备份状态。" />
          ) : fullDatabaseBackup.isLoading ? (
            <EmptyState text="正在读取服务器端完整数据库备份状态…" />
          ) : fullDatabaseBackup.isError || !fullDatabaseBackup.data ? (
            <EmptyState text="暂无法读取完整数据库备份状态，请确认服务器备份组件已部署。" />
          ) : (
            <>
              {!fullDatabaseBackup.data.configured ||
              !fullDatabaseBackup.data.executable ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <p className="font-medium">服务器端完整备份尚未就绪</p>
                  <p className="mt-1 text-xs">
                    请由服务器管理员配置备份专用 MySQL
                    凭据、备份目录与定时任务；配置完成后本按钮才会启用。页面不会显示凭据或服务器路径。
                  </p>
                </div>
              ) : null}
              {fullDatabaseBackup.data.latestSuccess ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-emerald-900">
                      {fullDatabaseBackup.data.latestSuccess.verification
                        .gzipIntegrity === "passed" &&
                      fullDatabaseBackup.data.latestSuccess.verification
                        .allTableDefinitionsPresent
                        ? "最近可用完整备份（校验通过）"
                        : "最近可用完整备份需重新核验"}
                    </p>
                    <Badge
                      className={
                        fullDatabaseBackup.data.latestSuccess.verification
                          .gzipIntegrity === "passed" &&
                        fullDatabaseBackup.data.latestSuccess.verification
                          .allTableDefinitionsPresent
                          ? "bg-emerald-700"
                          : "bg-amber-700"
                      }
                    >
                      {fullDatabaseBackup.data.latestSuccess.verification
                        .gzipIntegrity === "passed" &&
                      fullDatabaseBackup.data.latestSuccess.verification
                        .allTableDefinitionsPresent
                        ? "逐表校验通过"
                        : "校验待确认"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-emerald-900">
                    {displayDate(
                      fullDatabaseBackup.data.latestSuccess.createdAt
                    )}{" "}
                    · {fullDatabaseBackup.data.latestSuccess.tableCount} 张表 ·
                    gzip{" "}
                    {fullDatabaseBackup.data.latestSuccess.verification
                      .gzipIntegrity === "passed"
                      ? "通过"
                      : "异常"}{" "}
                    · SHA-256{" "}
                    {fullDatabaseBackup.data.latestSuccess.sha256.slice(0, 12)}…
                  </p>
                  <p className="mt-1 text-xs text-emerald-800">
                    压缩备份大小：
                    {(
                      fullDatabaseBackup.data.latestSuccess.compressedBytes /
                      1024 /
                      1024
                    ).toFixed(2)}{" "}
                    MB
                  </p>
                  <p className="mt-1 text-xs text-emerald-800">
                    保留策略：
                    {
                      fullDatabaseBackup.data.latestSuccess.retention.keepDays
                    }{" "}
                    天；最近轮换清理{" "}
                    {
                      fullDatabaseBackup.data.latestSuccess.retention
                        .removedFiles.length
                    }{" "}
                    个过期文件。
                  </p>
                  {fullDatabaseBackup.data.browserDownload.enabled ? (
                    fullDatabaseBackup.data.browserDownload.available ? (
                      <Button
                        className="mt-3 print:hidden"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setFullBackupDownloadTarget({
                            backupId:
                              fullDatabaseBackup.data.latestSuccess!.backupId,
                            tableCount:
                              fullDatabaseBackup.data.latestSuccess!.tableCount,
                            compressedBytes:
                              fullDatabaseBackup.data.latestSuccess!
                                .compressedBytes,
                          })
                        }
                      >
                        下载已验证完整备份
                      </Button>
                    ) : (
                      <p className="mt-3 text-xs text-amber-800">
                        浏览器下载已启用，但当前备份未通过文件可用性复核或超过受控下载大小上限。
                      </p>
                    )
                  ) : (
                    <p className="mt-3 text-xs text-slate-600">
                      浏览器下载由服务器管理员单独启用；未启用时仍可在服务器端执行受控灾备与恢复演练。
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                  尚未生成经过逐表校验的完整数据库备份。首次执行完成后，此处将显示表数量、校验和保留状态。
                </div>
              )}
              {fullDatabaseBackup.data.latestFailure ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                  <p className="font-medium">最近一次完整备份未成功</p>
                  <p className="mt-1 text-xs">
                    {displayDate(
                      fullDatabaseBackup.data.latestFailure.failedAt
                    )}{" "}
                    · {fullDatabaseBackup.data.latestFailure.error}
                  </p>
                </div>
              ) : null}
              <FullDatabaseBackupHistory
                entries={fullDatabaseBackupHistory.data}
                loading={fullDatabaseBackupHistory.isFetching}
                error={fullDatabaseBackupHistory.isError}
                onRefresh={() => {
                  void fullDatabaseBackupHistory.refetch();
                  void fullDatabaseBackup.refetch();
                }}
              />
              <p className="text-xs text-slate-500">
                完整备份仅用于灾难恢复。下载前会再次校验超级管理员会话、文件清单、SHA-256
                和大小，并记录审计；系统始终不提供在线恢复，恢复必须在非生产演练库中由服务器管理员执行。
              </p>
            </>
          )}
        </CardContent>
      </Card>
      <AlertDialog
        open={Boolean(fullBackupDownloadTarget)}
        onOpenChange={open => {
          if (!open) setFullBackupDownloadTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              确认下载已验证的完整数据库备份？
            </AlertDialogTitle>
            <AlertDialogDescription>
              该压缩包包含完整业务数据，仅可保存到受控加密介质，不得转发、上传至个人网盘或在非受控电脑长期留存。本次下载会重新校验超级管理员会话、备份清单、SHA-256
              和文件大小，并记录审计；系统不提供在线恢复。
              {fullBackupDownloadTarget
                ? ` 当前备份：${fullBackupDownloadTarget.tableCount} 张表，约 ${(fullBackupDownloadTarget.compressedBytes / 1024 / 1024).toFixed(2)} MB。`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#203c48] text-white hover:bg-[#17313b]"
              onClick={() => {
                void confirmFullDatabaseBackupDownload();
              }}
            >
              确认下载并记录审计
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  const renderFinance = () => {
    const dieselProjectName =
      projects.data?.find(project => String(project.id) === financeProjectId)
        ?.name ?? "当前项目";
    const printDailyAccountingSnapshot = () => {
      const report = dailyAccountingReport.data;
      if (!report) return;
      const closure = report.closure;
      const projectName = selectedWorkspaceProject?.name ?? "当前项目";
      openA4LandscapePrintDocument({
        title: `会计日结装订页-${financeClosingDate}`,
        bodyHtml: `<h1>会计日结装订页</h1><p class="sub">项目：${escapePrintHtml(projectName)}　封存日期：${escapePrintHtml(financeClosingDate)}　生成时间：${escapePrintHtml(formatChinaDateTime(new Date()))}</p><hr class="rule"><table><thead><tr><th>日结单号</th><th>版本</th><th>封存状态</th><th>收入（元）</th><th>开支（元）</th><th>发票数量</th><th>发票金额（元）</th><th>快照指纹</th></tr></thead><tbody><tr><td>${escapePrintHtml(closure.closingNo)}</td><td class="center">第 ${escapePrintHtml(closure.revision ?? 1)} 版</td><td class="center">${escapePrintHtml(getBusinessStatusLabel(closure.status))}</td><td class="right">${escapePrintHtml(displayMoney(closure.totalIncome))}</td><td class="right">${escapePrintHtml(displayMoney(closure.totalExpense))}</td><td class="right">${escapePrintHtml(closure.invoiceCount)}</td><td class="right">${escapePrintHtml(displayMoney(closure.invoiceAmount))}</td><td>${escapePrintHtml(closure.snapshotHash)}</td></tr><tr class="summary"><td colspan="3">本次封存快照汇总</td><td class="right">${escapePrintHtml(displayMoney(closure.totalIncome))}</td><td class="right">${escapePrintHtml(displayMoney(closure.totalExpense))}</td><td class="right">${escapePrintHtml(closure.invoiceCount)}</td><td class="right">${escapePrintHtml(displayMoney(closure.invoiceAmount))}</td><td>以服务端封存快照为准</td></tr></tbody></table><div class="footer"><span>制表：系统按当前封存快照生成</span><span>审核：________________</span></div>`,
      });
    };
    const financePrintQuery =
      financePrintPreview === "ledger"
        ? financeSummary
        : financePrintPreview === "invoices"
          ? financeInvoices
          : riskFinanceAnalysis;
    const financePrintReady =
      !financePrintPreview ||
      (financePrintQuery.isSuccess && !financePrintQuery.isFetching);
    const financePrintError = financePrintPreview && financePrintQuery.error;
    const financeInvoiceRows = (financeInvoices.data?.invoices ?? []).filter(
      invoice => {
        if (
          financeInvoiceFilter.status !== "all" &&
          invoice.status !== financeInvoiceFilter.status
        )
          return false;
        const keyword = financeInvoiceFilter.keyword.trim().toLowerCase();
        return (
          !keyword ||
          `${invoice.invoiceNo} ${invoice.counterpartyName}`
            .toLowerCase()
            .includes(keyword)
        );
      }
    );
    const allFinanceRecords = financeSummary.data?.records ?? [];
    const financeCategories = Array.from(
      new Set(allFinanceRecords.map(record => record.category).filter(Boolean))
    ).sort();
    const financeSourceTypes = Array.from(
      new Set(
        allFinanceRecords
          .map(record => record.sourceType || "manual")
          .filter(Boolean)
      )
    ).sort();
    const financeLedgerRows = allFinanceRecords.filter(record => {
      if (
        financeLedgerFilter.direction !== "all" &&
        record.direction !== financeLedgerFilter.direction
      )
        return false;
      if (
        financeLedgerFilter.category !== "all" &&
        record.category !== financeLedgerFilter.category
      )
        return false;
      if (
        financeLedgerFilter.settlementStatus !== "all" &&
        record.settlementStatus !== financeLedgerFilter.settlementStatus
      )
        return false;
      const sourceType = record.sourceType || "manual";
      if (
        financeLedgerFilter.sourceType !== "all" &&
        sourceType !== financeLedgerFilter.sourceType
      )
        return false;
      const keyword = financeLedgerFilter.keyword.trim().toLowerCase();
      return (
        !keyword ||
        `${record.recordNo} ${record.category} ${record.sourceType ?? ""} ${record.remarks ?? ""}`
          .toLowerCase()
          .includes(keyword)
      );
    });
    const ledgerPage = Math.min(
      financeLedgerPage,
      Math.max(1, Math.ceil(financeLedgerRows.length / financeLedgerPageSize))
    );
    const financeLedgerPageRows = financeLedgerRows.slice(
      (ledgerPage - 1) * financeLedgerPageSize,
      ledgerPage * financeLedgerPageSize
    );
    const invoicePage = Math.min(
      financeInvoicePage,
      Math.max(1, Math.ceil(financeInvoiceRows.length / financeInvoicePageSize))
    );
    const financeInvoicePageRows = financeInvoiceRows.slice(
      (invoicePage - 1) * financeInvoicePageSize,
      invoicePage * financeInvoicePageSize
    );
    const expenseRows = expenseCategoryDetails.data?.records ?? [];
    const expensePage = Math.min(
      financeExpensePage,
      Math.max(1, Math.ceil(expenseRows.length / financeExpensePageSize))
    );
    const expensePageRows = expenseRows.slice(
      (expensePage - 1) * financeExpensePageSize,
      expensePage * financeExpensePageSize
    );
    const financeLedgerIncome = financeLedgerRows
      .filter(
        record =>
          record.direction === "income" && record.settlementStatus !== "void"
      )
      .reduce((sum, record) => sum + Number(record.amount), 0);
    const financeLedgerExpense = financeLedgerRows
      .filter(
        record =>
          record.direction === "expense" && record.settlementStatus !== "void"
      )
      .reduce((sum, record) => sum + Number(record.amount), 0);
    const settlementStatusLabel: Record<string, string> = {
      unpaid: "未结清",
      partial: "部分结清",
      paid: "已结清",
      void: "已作废",
    };
    const sourceTypeLabel: Record<string, string> = {
      manual: "人工财务流水",
      measurement_claim: "工程计量申报",
      measurement_payment: "工程计量回款",
      purchase_order_payable: "采购订单应付",
      purchase_order_settlement: "采购订单结算",
      financial_reversal: "财务冲销",
    };
    /** 任何未知内部枚举均不可直接回显到财务台账、CSV 或打印文档。 */
    const financeSettlementStatusDisplay = (
      status: string | null | undefined
    ) => settlementStatusLabel[status ?? ""] ?? "待处理";
    const financeSourceTypeDisplay = (sourceType: string | null | undefined) =>
      sourceTypeLabel[sourceType ?? ""] ?? "其他业务来源";
    const expenseCategoryDisplay = (categoryCode: string | null | undefined) =>
      expenseCategoryDetails.data?.categories.find(
        category => category.code === categoryCode
      )?.label ??
      riskFinanceAnalysis.data?.categories.find(
        category => category.code === categoryCode
      )?.label ??
      "未分类";
    const expenseSourceDisplay = (sourceCode: string | null | undefined) =>
      expenseCategoryDetails.data?.sources.find(
        source => source.code === sourceCode
      )?.label ?? "其他业务来源";
    const financeLedgerDetailedSummary = ["income", "expense"].flatMap(
      direction =>
        ["paid", "partial", "unpaid", "void"].map(status => {
          const rows = financeLedgerRows.filter(
            record =>
              record.direction === direction &&
              record.settlementStatus === status
          );
          return {
            direction,
            status,
            count: rows.length,
            amount: rows.reduce(
              (sum, record) => sum + Number(record.amount),
              0
            ),
          };
        })
    );
    const financeCategorySummary = Array.from(
      financeLedgerRows
        .reduce((map, record) => {
          const current = map.get(record.category) ?? {
            category: record.category,
            count: 0,
            income: 0,
            expense: 0,
          };
          current.count += 1;
          if (record.direction === "income")
            current.income += Number(record.amount);
          else current.expense += Number(record.amount);
          map.set(record.category, current);
          return map;
        }, new Map<string, { category: string; count: number; income: number; expense: number }>())
        .values()
    ).sort((a, b) => b.income + b.expense - (a.income + a.expense));
    const validInvoiceRows = financeInvoiceRows.filter(
      invoice => !["void", "red_flushed"].includes(invoice.status)
    );
    const invoiceDetailedSummary = {
      count: validInvoiceRows.length,
      amount: validInvoiceRows.reduce(
        (sum, invoice) =>
          sum + Number(invoice.allocatedAmount ?? invoice.amount),
        0
      ),
      tax: validInvoiceRows.reduce(
        (sum, invoice) => sum + Number(invoice.taxAmount ?? 0),
        0
      ),
      pending: validInvoiceRows
        .filter(
          invoice =>
            !["external_verified", "manual_verified", "not_required"].includes(
              invoice.original?.verificationStatus ?? "pending"
            )
        )
        .reduce(
          (sum, invoice) =>
            sum + Number(invoice.allocatedAmount ?? invoice.amount),
          0
        ),
    };
    const financeLedgerFilterLabel = `收支：${financeLedgerFilter.direction === "all" ? "全部" : financeLedgerFilter.direction === "income" ? "仅收入" : "仅支出"}；细项：${financeLedgerFilter.category === "all" ? "全部" : financeLedgerFilter.category}；结算：${financeLedgerFilter.settlementStatus === "all" ? "全部" : financeSettlementStatusDisplay(financeLedgerFilter.settlementStatus)}；来源：${financeLedgerFilter.sourceType === "all" ? "全部" : financeSourceTypeDisplay(financeLedgerFilter.sourceType)}；关键词：${financeLedgerFilter.keyword.trim() || "未限定"}`;
    const financeLedgerPrintRows = financeLedgerRows.map(record => ({
      id: String(record.id),
      cells: [
        record.recordNo,
        displayDate(record.occurredAt),
        record.direction === "income" ? "收入" : "支出",
        record.category,
        financeSourceTypeDisplay(record.sourceType),
        financeSettlementStatusDisplay(record.settlementStatus),
        `¥${displayMoney(record.amount)}`,
        record.remarks ?? "—",
      ],
    }));
    const invoicePrintRows = financeInvoiceRows.map(invoice => ({
      id: String(invoice.id),
      cells: [
        invoice.invoiceNo,
        invoice.counterpartyName,
        displayDate(invoice.issuedAt),
        getInvoiceTypeLabel(invoice.invoiceType),
        `¥${displayMoney(invoice.amount)}`,
        `¥${displayMoney(invoice.taxAmount)}`,
        getBusinessStatusLabel(invoice.status),
      ],
    }));
    const invoiceTotalTax = (financeInvoices.data?.invoices ?? [])
      .filter(invoice => invoice.status !== "void")
      .reduce((sum, invoice) => sum + Number(invoice.taxAmount ?? 0), 0);
    const financeCategoryPrintRows = (
      riskFinanceAnalysis.data?.categories ?? []
    ).map(item => ({
      id: item.code,
      cells: [
        item.label,
        `¥${displayMoney(item.amount)}`,
        `${item.percentage}%`,
        String(item.recordCount),
        item.sources.join("、"),
      ],
    }));
    const financeCategoryRecordCount = (
      riskFinanceAnalysis.data?.categories ?? []
    ).reduce((sum, item) => sum + Number(item.recordCount), 0);
    const financeSubcategoryPrintRows = (
      riskFinanceAnalysis.data?.subcategories ?? []
    ).map(item => ({
      id: item.code,
      cells: [
        expenseCategoryDisplay(item.parentCode),
        item.label,
        `¥${displayMoney(item.amount)}`,
        `${item.percentage}%`,
        String(item.recordCount),
        item.sources.join("、"),
      ],
    }));
    const financeSubcategoryRecordCount = (
      riskFinanceAnalysis.data?.subcategories ?? []
    ).reduce((sum, item) => sum + Number(item.recordCount), 0);
    return (
      <div
        className="space-y-5"
        onClickCapture={event => {
          const button = (event.target as HTMLElement).closest("button");
          if (button?.textContent?.trim() !== "打印日结装订页") return;
          event.preventDefault();
          event.stopPropagation();
          printDailyAccountingSnapshot();
        }}
      >
        {!isDiesel ? (
          <PaymentAccountBillPrintDialog
            open={paymentBillPrintOpen}
            onOpenChange={setPaymentBillPrintOpen}
            projectName={selectedWorkspaceProject?.name ?? "当前项目"}
          />
        ) : null}
        <Card className="border-[#d8e3e0] shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">
              {isDiesel ? "柴油管理与加油台账" : "审计级财务管理"}
            </CardTitle>
            <CardDescription>
              {isDiesel
                ? "管理员按每次加油的日期、升数和当天单价登记；系统在服务端固化金额快照并自动归集到机械、车辆、运输扣款和项目成本。"
                : "按项目和会计期间读取真实费用、成本、应收应付及发票状态。发票台账不重复计入成本；每日日结生成不可变快照，供会计审核与凭证装订打印。"}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
            <Select
              value={financeProjectId}
              onValueChange={changeFinanceProject}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择项目" />
              </SelectTrigger>
              <SelectContent>
                {projects.data
                  ?.filter(project => project.status !== "archived")
                  .map(project => (
                    <SelectItem key={project.id} value={String(project.id)}>
                      {project.code ? `${project.code} · ` : ""}
                      {project.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Input
              hidden={isDiesel && dieselTab !== "suppliers"}
              type="month"
              value={financePeriod}
              onChange={event => changeFinancePeriod(event.target.value)}
              aria-label={isDiesel ? "供应商对账月份" : "会计期间"}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (isDiesel) {
                    void refreshDieselLedger();
                    return;
                  }
                  void financeUtils.finance.invalidate();
                  void financeUtils.settlementPayment.invalidate();
                  void financeUtils.projectRisk.financeCategoryAnalysis.invalidate();
                  if (financeTab === "overview" || financeTab === "ledger")
                    void financeSummary.refetch();
                  if (financeTab === "overview")
                    void financeBusinessSummary.refetch();
                  if (financeTab === "overview" || financeTab === "invoices")
                    void financeInvoices.refetch();
                  if (financeTab === "overview" || financeTab === "costs")
                    void riskFinanceAnalysis.refetch();
                  if (
                    financeTab === "closing" &&
                    financeClosingView === "daily"
                  )
                    void dailyAccountingReport.refetch();
                }}
              >
                刷新统计
              </Button>
              {!isDiesel ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" disabled={!financeProjectId}>
                      <Printer className="mr-1.5 size-4" />
                      报表打印
                      <ChevronDown className="ml-1 size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>
                      当前项目与期间 · 全部筛选结果
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      onSelect={() => setFinancePrintPreview("ledger")}
                    >
                      资金总账明细与汇总
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setFinancePrintPreview("invoices")}
                    >
                      发票台账明细与汇总
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setFinancePrintPreview("categories")}
                    >
                      成本分类明细与汇总
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setFinancePrintPreview("subcategories")}
                    >
                      成本小类目明细与汇总
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => setPaymentBillPrintOpen(true)}
                    >
                      支付账号账单打印
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        setFinanceTab("settlements");
                        setFinanceSettlementView("records");
                      }}
                    >
                      付款凭证批量打印
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        setFinanceTab("closing");
                        setFinanceClosingView("reconciliation");
                      }}
                    >
                      月度内部对账与导出
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        setFinanceTab("closing");
                        setFinanceClosingView("daily");
                      }}
                    >
                      日结装订页打印
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          </CardContent>
        </Card>
        {!isDiesel ? (
          <>
            <FinanceWorkspaceNavigation
              value={financeTab}
              onValueChange={setFinanceTab}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#d8e3e0] bg-[#f8fbf9] px-3 py-2 text-xs text-slate-600">
              <span>
                当前项目：
                {projects.data?.find(
                  project => String(project.id) === financeProjectId
                )?.name || "未选择"}{" "}
                · 会计月份：{financePeriod}
              </span>
              <span>
                {financeTab === "settlements"
                  ? "结算余额按独立截至日；付款记录按实际付款月份"
                  : financeTab === "closing"
                    ? "日结按独立封存日期；月度对账按实际付款月份"
                    : financeTab === "costs"
                      ? "成本按会计月份；明细默认当天，可切本月"
                      : "统计、打印与导出遵循当前栏目筛选"}
              </span>
            </div>
          </>
        ) : null}
        {!financeProjectId ? (
          <EmptyState
            text={
              isDiesel
                ? "请选择项目后读取真实柴油指导价、每次加油金额和资源成本归集台账。"
                : "请选择项目后读取真实费用、成本和发票审计台账。"
            }
          />
        ) : (
          <>
            <FinanceRetainedPanel
              active={!isDiesel && financeTab === "overview"}
              label="财务总览"
            >
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <MetricCard
                  title="确认收入（资金总账）"
                  value={financeSummary.data?.incomeAmount}
                  description="不含重复回款口径"
                  icon={BarChart3}
                />
                <MetricCard
                  title="项目开支（资金总账）"
                  value={financeSummary.data?.expenseAmount}
                  description="已登记资金支出流水"
                  icon={ScrollText}
                />
                <MetricCard
                  title="已开票金额"
                  value={financeInvoices.data?.summary.totalAmount}
                  description="不含作废与红冲"
                  icon={ScrollText}
                />
                <MetricCard
                  title="待认证发票"
                  value={financeInvoices.data?.summary.pendingAmount}
                  description="须会计复核"
                  icon={ScrollText}
                />
              </div>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <MetricCard
                  title="应收余额"
                  value={financeSummary.data?.receivableAmount}
                  description="已确认收入待回款"
                  icon={BarChart3}
                />
                <MetricCard
                  title="应付余额"
                  value={financeSummary.data?.payableAmount}
                  description="已登记开支待结清"
                  icon={ScrollText}
                />
                <MetricCard
                  title="本期现金净流"
                  value={financeSummary.data?.netCashFlowAmount}
                  description={`流入 ¥${displayMoney(financeSummary.data?.cashInflowAmount ?? 0)} · 流出 ¥${displayMoney(financeSummary.data?.cashOutflowAmount ?? 0)}`}
                  icon={BarChart3}
                />
                <MetricCard
                  title="本期收支差额（资金总账）"
                  value={financeSummary.data?.profitAmount}
                  description="确认收入减已登记资金支出"
                  icon={ScrollText}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Button
                  variant="outline"
                  onClick={() => setFinanceTab("settlements")}
                >
                  查看结算待办
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setFinanceTab("costs")}
                >
                  查看成本明细
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setFinanceTab("invoices")}
                >
                  查看发票台账
                </Button>
              </div>
              <details className="rounded-xl border border-[#d8e3e0] bg-white p-3">
                <summary className="cursor-pointer text-sm font-semibold text-[#203c48]">
                  展开业务来源与运输待核验摘要
                </summary>
                <div className="mt-3">
                  {!isDiesel ? (
                    <Card className="border-[#d8e3e0] bg-[#fbfdfc] shadow-sm">
                      <CardHeader>
                        <p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">
                          财务管理 · 真实业务台账
                        </p>
                        <CardTitle className="mt-1 text-base">
                          本期业务数据总览
                        </CardTitle>
                        <CardDescription className="mt-1">
                          统一读取采购、柴油、工资、机械、维修、运输和资金总账。资金总账与各业务台账分层展示：不把同一笔采购结算、机械油料等重复相加，避免生成错误总额。
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {financeBusinessSummary.isLoading ? (
                          <p className="text-sm text-slate-500">
                            正在核对本期各业务台账…
                          </p>
                        ) : (
                          <>
                            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                              <div className="rounded-xl border border-[#d8e3e0] bg-white p-3">
                                <p className="text-xs text-slate-500">
                                  已归集业务成本
                                </p>
                                <p className="mt-1 text-xl font-semibold text-[#203c48]">
                                  ¥
                                  {displayMoney(
                                    riskFinanceAnalysis.data?.expenseAmount ?? 0
                                  )}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  按业务台账去重后的已登记成本
                                </p>
                              </div>
                              <div className="rounded-xl border border-[#d8e3e0] bg-white p-3">
                                <p className="text-xs text-slate-500">
                                  本期业务来源
                                </p>
                                <p className="mt-1 text-xl font-semibold text-[#203c48]">
                                  {
                                    (
                                      financeBusinessSummary.data?.sources ?? []
                                    ).filter(item => item.recordCount > 0)
                                      .length
                                  }{" "}
                                  类
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  仅统计当前项目、当前会计期间
                                </p>
                              </div>
                              <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3">
                                <p className="text-xs text-amber-800">
                                  待核验/待结算运输
                                </p>
                                <p className="mt-1 text-xl font-semibold text-amber-950">
                                  {financeBusinessSummary.data?.pendingTransport
                                    .count ?? 0}{" "}
                                  趟
                                </p>
                                <p className="mt-1 text-xs text-amber-800">
                                  应付预估 ¥
                                  {displayMoney(
                                    financeBusinessSummary.data
                                      ?.pendingTransport.amount ?? 0
                                  )}
                                  ；未进入成本或现金流
                                </p>
                              </div>
                              <div className="rounded-xl border border-[#d8e3e0] bg-white p-3">
                                <p className="text-xs text-slate-500">
                                  已审核运输结算
                                </p>
                                <p className="mt-1 text-xl font-semibold text-[#203c48]">
                                  ¥
                                  {displayMoney(
                                    financeBusinessSummary.data
                                      ?.settledTransport.amount ?? 0
                                  )}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {financeBusinessSummary.data?.settledTransport
                                    .count ?? 0}{" "}
                                  趟已办理运输结算
                                </p>
                              </div>
                            </div>
                            <details className="rounded-lg border border-[#e1e8e4] bg-white p-3">
                              <summary className="cursor-pointer text-xs font-semibold text-[#203c48]">
                                展开本期业务来源摘要
                              </summary>
                              <div className="mt-3">
                                {" "}
                                <div className="overflow-x-auto rounded-xl border border-[#e1e8e4] bg-white">
                                  <Table className="min-w-[940px] text-xs">
                                    <TableHeader className="bg-[#edf1ed]">
                                      <TableRow>
                                        <TableHead>业务台账</TableHead>
                                        <TableHead>本期记录</TableHead>
                                        <TableHead>有效/已审核</TableHead>
                                        <TableHead className="text-right">
                                          本期金额
                                        </TableHead>
                                        <TableHead>当前状态</TableHead>
                                        <TableHead>财务归集规则</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {(
                                        financeBusinessSummary.data?.sources ??
                                        []
                                      ).map(item => (
                                        <TableRow key={item.code}>
                                          <TableCell className="font-medium text-[#203c48]">
                                            {item.label}
                                          </TableCell>
                                          <TableCell>
                                            {item.recordCount} 笔
                                          </TableCell>
                                          <TableCell>
                                            {item.effectiveCount} 笔
                                          </TableCell>
                                          <TableCell className="text-right font-medium">
                                            ¥{displayMoney(item.amount)}
                                          </TableCell>
                                          <TableCell>
                                            {item.statusSummary}
                                          </TableCell>
                                          <TableCell className="whitespace-normal text-slate-600">
                                            {item.accountingLink}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              </div>
                            </details>{" "}
                            {!(
                              (financeBusinessSummary.data?.sources ?? []).some(
                                item => item.recordCount > 0
                              ) ||
                              (financeBusinessSummary.data?.pendingTransport
                                .count ?? 0) > 0
                            ) ? (
                              <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                当前会计期间未找到已登记业务记录。请通过上方月份切换至已有业务的期间，或先在对应业务模块完成登记、审核和结算。
                              </p>
                            ) : null}
                          </>
                        )}
                      </CardContent>
                    </Card>
                  ) : null}
                </div>
              </details>
            </FinanceRetainedPanel>
            <FinanceRetainedPanel
              active={!isDiesel && financeTab === "ledger"}
              label="收支账本"
            >
              <Card className="border-[#d8e3e0] shadow-sm">
                <CardHeader className="flex flex-col gap-3 space-y-0 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">
                      资金总账 · 审计口径
                    </p>
                    <CardTitle className="mt-1 text-base">
                      全部收入、支出、应收应付与现金流明细
                    </CardTitle>
                    <CardDescription className="mt-1">
                      本表只汇总已形成的真实财务流水；采购、工资、柴油、运输等业务成本在下方“成本类别分析”按权威来源归集，避免同一笔业务重复累计。可按大类、细项、收付状态、业务来源及关键词组合筛选。
                    </CardDescription>
                  </div>
                  <CurrentFilterPrintActions
                    disabled={!financeLedgerRows.length}
                    onPrint={() => setFinancePrintPreview("ledger")}
                    onExport={() =>
                      downloadCsvFile(
                        `项目资金总账-${financePeriod}.csv`,
                        [
                          "单号",
                          "发生时间",
                          "收支方向",
                          "资金大类/细项",
                          "业务来源",
                          "结算状态",
                          "金额",
                          "说明",
                        ],
                        financeLedgerRows.map(record => [
                          record.recordNo,
                          displayDate(record.occurredAt),
                          record.direction === "income" ? "收入" : "支出",
                          record.category,
                          financeSourceTypeDisplay(record.sourceType),
                          financeSettlementStatusDisplay(
                            record.settlementStatus
                          ),
                          Number(record.amount),
                          record.remarks ?? "",
                        ])
                      )
                    }
                    exportLabel="导出当前明细"
                  />
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                    <Select
                      value={financeLedgerFilter.direction}
                      onValueChange={direction =>
                        setFinanceLedgerFilter(current => ({
                          ...current,
                          direction,
                        }))
                      }
                    >
                      <SelectTrigger aria-label="资金收支方向">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部收支方向</SelectItem>
                        <SelectItem value="income">仅收入</SelectItem>
                        <SelectItem value="expense">仅支出</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={financeLedgerFilter.category}
                      onValueChange={category =>
                        setFinanceLedgerFilter(current => ({
                          ...current,
                          category,
                        }))
                      }
                    >
                      <SelectTrigger aria-label="财务细项">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部资金细项</SelectItem>
                        {financeCategories.map(category => (
                          <SelectItem key={category} value={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={financeLedgerFilter.settlementStatus}
                      onValueChange={settlementStatus =>
                        setFinanceLedgerFilter(current => ({
                          ...current,
                          settlementStatus,
                        }))
                      }
                    >
                      <SelectTrigger aria-label="资金结算状态">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部结算状态</SelectItem>
                        <SelectItem value="unpaid">未结清</SelectItem>
                        <SelectItem value="partial">部分结清</SelectItem>
                        <SelectItem value="paid">已结清</SelectItem>
                        <SelectItem value="void">已作废</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={financeLedgerFilter.sourceType}
                      onValueChange={sourceType =>
                        setFinanceLedgerFilter(current => ({
                          ...current,
                          sourceType,
                        }))
                      }
                    >
                      <SelectTrigger aria-label="财务业务来源">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部业务来源</SelectItem>
                        {financeSourceTypes.map(source => (
                          <SelectItem key={source} value={source}>
                            {financeSourceTypeDisplay(source)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={financeLedgerFilter.keyword}
                      aria-label="财务关键词筛选"
                      placeholder="单号、类别、说明"
                      onChange={event =>
                        setFinanceLedgerFilter(current => ({
                          ...current,
                          keyword: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e1e8e4] bg-[#f8fbf8] px-4 py-3 text-sm">
                    <span>
                      当前筛选：{financeLedgerRows.length} 笔 · 收入{" "}
                      <strong>¥{displayMoney(financeLedgerIncome)}</strong> ·
                      支出{" "}
                      <strong>¥{displayMoney(financeLedgerExpense)}</strong> ·
                      净额{" "}
                      <strong>
                        ¥
                        {displayMoney(
                          financeLedgerIncome - financeLedgerExpense
                        )}
                      </strong>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setFinanceLedgerFilter({
                          direction: "all",
                          category: "all",
                          settlementStatus: "all",
                          sourceType: "all",
                          keyword: "",
                        })
                      }
                    >
                      清除筛选
                    </Button>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-[#e1e8e4]">
                    <Table className="min-w-[1060px] text-xs">
                      <TableHeader className="bg-[#edf1ed]">
                        <TableRow>
                          <TableHead>单号 / 时间</TableHead>
                          <TableHead>收支</TableHead>
                          <TableHead>资金细项</TableHead>
                          <TableHead>业务来源</TableHead>
                          <TableHead>结算状态</TableHead>
                          <TableHead>金额</TableHead>
                          <TableHead>说明</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {financeLedgerRows.length ? (
                          financeLedgerPageRows.map(record => (
                            <TableRow key={record.id}>
                              <TableCell>
                                <p className="font-medium text-[#203c48]">
                                  {record.recordNo}
                                </p>
                                <p className="mt-1 text-[11px] text-slate-500">
                                  {displayDate(record.occurredAt)}
                                </p>
                              </TableCell>
                              <TableCell
                                className={
                                  record.direction === "income"
                                    ? "font-medium text-emerald-700"
                                    : "font-medium text-rose-700"
                                }
                              >
                                {record.direction === "income"
                                  ? "收入"
                                  : "支出"}
                              </TableCell>
                              <TableCell>{record.category}</TableCell>
                              <TableCell>
                                {financeSourceTypeDisplay(record.sourceType)}
                              </TableCell>
                              <TableCell>
                                <BusinessStatusBadge
                                  status={record.settlementStatus}
                                />
                              </TableCell>
                              <TableCell className="font-medium">
                                ¥{displayMoney(record.amount)}
                              </TableCell>
                              <TableCell className="max-w-[280px] whitespace-normal text-slate-600">
                                {record.remarks || "—"}
                              </TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell
                              colSpan={7}
                              className="py-10 text-center text-slate-500"
                            >
                              当前筛选范围暂无已登记资金流水。可检查项目、期间和筛选条件，或由财务按权限登记真实流水。
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="text-xs text-slate-600">
                    当前页 {financeLedgerPageRows.length} 笔；本页显示金额 ¥
                    {displayMoney(
                      financeLedgerPageRows.reduce(
                        (sum, row) => sum + Number(row.amount),
                        0
                      )
                    )}
                    。上方收入、支出及导出均为全部筛选结果。
                  </div>
                  <FinancePagination
                    page={ledgerPage}
                    pageSize={financeLedgerPageSize}
                    total={financeLedgerRows.length}
                    onPageChange={setFinanceLedgerPage}
                    onPageSizeChange={setFinanceLedgerPageSize}
                    label="资金总账"
                  />
                </CardContent>
              </Card>
              <details className="rounded-xl border bg-white p-3">
                <summary className="cursor-pointer text-sm font-semibold text-[#203c48]">
                  展开结算状态与资金细项汇总
                </summary>
                <div className="mt-3">
                  {!isDiesel ? (
                    <Card className="border-[#d8e3e0] bg-[#fbfdfc] shadow-sm">
                      <CardHeader>
                        <p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">
                          财务管理 · 详细汇总
                        </p>
                        <CardTitle className="mt-1 text-base">
                          各类账本明细与汇总信息
                        </CardTitle>
                        <CardDescription className="mt-1">
                          以下数据与当前项目、会计期间和资金总账明细保持同一服务端口径；金额不把发票、采购应付和实际结算重复相加。
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          {[
                            {
                              label: "资金流水",
                              count: financeLedgerRows.length,
                              amount:
                                financeLedgerIncome + financeLedgerExpense,
                              note: `收入 ¥${displayMoney(financeLedgerIncome)} · 支出 ¥${displayMoney(financeLedgerExpense)}`,
                            },
                            {
                              label: "未结清/部分结清",
                              count: financeLedgerDetailedSummary
                                .filter(
                                  item =>
                                    ["unpaid", "partial"].includes(
                                      item.status
                                    ) && item.status !== "void"
                                )
                                .reduce((sum, item) => sum + item.count, 0),
                              amount: financeLedgerDetailedSummary
                                .filter(item =>
                                  ["unpaid", "partial"].includes(item.status)
                                )
                                .reduce((sum, item) => sum + item.amount, 0),
                              note: `应收 ¥${displayMoney(financeSummary.data?.receivableAmount ?? 0)} · 应付 ¥${displayMoney(financeSummary.data?.payableAmount ?? 0)}`,
                            },
                            {
                              label: "发票台账",
                              count: invoiceDetailedSummary.count,
                              amount: invoiceDetailedSummary.amount,
                              note: `税额 ¥${displayMoney(invoiceDetailedSummary.tax)} · 待认证 ¥${displayMoney(invoiceDetailedSummary.pending)}`,
                            },
                            {
                              label: "成本分类",
                              count: financeCategorySummary.length,
                              amount:
                                riskFinanceAnalysis.data?.expenseAmount ??
                                financeSummary.data?.expenseAmount ??
                                0,
                              note: `${financeCategoryRecordCount} 笔业务 · 按类别归集`,
                            },
                          ].map(item => (
                            <div
                              key={item.label}
                              className="rounded-xl border border-[#d8e3e0] bg-white p-3"
                            >
                              <p className="text-xs text-slate-500">
                                {item.label}
                              </p>
                              <p className="mt-1 text-xl font-semibold text-[#203c48]">
                                ¥{displayMoney(item.amount)}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                {item.count} 项 · {item.note}
                              </p>
                            </div>
                          ))}
                        </div>
                        <div className="grid gap-4 xl:grid-cols-2">
                          <div className="overflow-x-auto rounded-xl border border-[#e1e8e4] bg-white">
                            <div className="border-b border-[#e1e8e4] px-3 py-2 text-sm font-semibold text-[#203c48]">
                              资金流水按结算状态
                            </div>
                            <Table className="min-w-[560px] text-xs">
                              <TableHeader className="bg-[#edf1ed]">
                                <TableRow>
                                  <TableHead>收支</TableHead>
                                  <TableHead>结算状态</TableHead>
                                  <TableHead>笔数</TableHead>
                                  <TableHead className="text-right">
                                    金额
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {financeLedgerDetailedSummary
                                  .filter(item => item.count > 0)
                                  .map(item => (
                                    <TableRow
                                      key={`${item.direction}-${item.status}`}
                                    >
                                      <TableCell>
                                        {item.direction === "income"
                                          ? "收入"
                                          : "支出"}
                                      </TableCell>
                                      <TableCell>
                                        {financeSettlementStatusDisplay(
                                          item.status
                                        )}
                                      </TableCell>
                                      <TableCell>{item.count}</TableCell>
                                      <TableCell className="text-right font-medium">
                                        ¥{displayMoney(item.amount)}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                {financeLedgerDetailedSummary.every(
                                  item => item.count === 0
                                ) ? (
                                  <TableRow>
                                    <TableCell
                                      colSpan={4}
                                      className="py-6 text-center text-slate-500"
                                    >
                                      当前期间暂无资金流水。
                                    </TableCell>
                                  </TableRow>
                                ) : null}
                              </TableBody>
                            </Table>
                          </div>
                          <div className="overflow-x-auto rounded-xl border border-[#e1e8e4] bg-white">
                            <div className="border-b border-[#e1e8e4] px-3 py-2 text-sm font-semibold text-[#203c48]">
                              资金细项分类汇总
                            </div>
                            <Table className="min-w-[560px] text-xs">
                              <TableHeader className="bg-[#edf1ed]">
                                <TableRow>
                                  <TableHead>资金细项</TableHead>
                                  <TableHead>笔数</TableHead>
                                  <TableHead className="text-right">
                                    收入
                                  </TableHead>
                                  <TableHead className="text-right">
                                    支出
                                  </TableHead>
                                  <TableHead className="text-right">
                                    合计
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {financeCategorySummary
                                  .slice(0, 12)
                                  .map(item => (
                                    <TableRow key={item.category}>
                                      <TableCell className="font-medium">
                                        {item.category}
                                      </TableCell>
                                      <TableCell>{item.count}</TableCell>
                                      <TableCell className="text-right text-emerald-700">
                                        ¥{displayMoney(item.income)}
                                      </TableCell>
                                      <TableCell className="text-right text-rose-700">
                                        ¥{displayMoney(item.expense)}
                                      </TableCell>
                                      <TableCell className="text-right font-medium">
                                        ¥
                                        {displayMoney(
                                          item.income + item.expense
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                {!financeCategorySummary.length ? (
                                  <TableRow>
                                    <TableCell
                                      colSpan={5}
                                      className="py-6 text-center text-slate-500"
                                    >
                                      当前期间暂无资金细项。
                                    </TableCell>
                                  </TableRow>
                                ) : null}
                              </TableBody>
                            </Table>
                            {financeCategorySummary.length > 12 ? (
                              <p className="px-3 py-2 text-xs text-slate-500">
                                已显示金额最高的12个细项，完整明细请使用下方筛选、导出和打印。
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ) : null}
                </div>
              </details>
            </FinanceRetainedPanel>
            {!isDiesel && financeTab === "settlements" ? (
              <Tabs
                value={financeSettlementView}
                onValueChange={value =>
                  setFinanceSettlementView(value as "board" | "records")
                }
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="board">待付款 / 待收补款</TabsTrigger>
                  <TabsTrigger value="records">付款记录 / 凭证</TabsTrigger>
                </TabsList>
              </Tabs>
            ) : null}
            {!isDiesel && financeTab === "closing" ? (
              <Tabs
                value={financeClosingView}
                onValueChange={value =>
                  setFinanceClosingView(value as "daily" | "reconciliation")
                }
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="daily">日结封存</TabsTrigger>
                  <TabsTrigger value="reconciliation">月度内部对账</TabsTrigger>
                </TabsList>
              </Tabs>
            ) : null}
            <FinanceRetainedPanel
              active={
                !isDiesel &&
                (financeTab === "settlements" ||
                  (financeTab === "closing" &&
                    financeClosingView === "reconciliation"))
              }
              label="结算收付与月度对账"
            >
              {!isDiesel ? (
                <SettlementPaymentFinancialBoard
                  projectId={Number(financeProjectId)}
                  view={
                    financeTab === "closing"
                      ? "reconciliation"
                      : financeSettlementView
                  }
                  enabled={
                    !isDiesel &&
                    (financeTab === "settlements" ||
                      (financeTab === "closing" &&
                        financeClosingView === "reconciliation"))
                  }
                  period={financePeriod}
                  onPeriodChange={changeFinancePeriod}
                  onNavigateToSettlement={row =>
                    setFinancePaymentTarget({
                      ...row,
                      readOnly: row.canRegisterSettlementPayment !== true,
                    })
                  }
                  projectLabel={
                    projects.data?.find(
                      project => String(project.id) === financeProjectId
                    )
                      ? projects.data.find(
                          project => String(project.id) === financeProjectId
                        )?.name
                      : undefined
                  }
                />
              ) : null}
            </FinanceRetainedPanel>
            <FinanceRetainedPanel
              active={!isDiesel && financeTab === "costs"}
              label="成本分析"
            >
              <Tabs
                value={financeCostsView}
                onValueChange={value =>
                  setFinanceCostsView(value as "categories" | "subcategories")
                }
              >
                <TabsList className="grid w-full grid-cols-2 bg-[#eaf2ee]">
                  <TabsTrigger value="categories">成本分类</TabsTrigger>
                  <TabsTrigger value="subcategories">小类目分析</TabsTrigger>
                </TabsList>
                <div className="mt-3">
                  <FinanceRetainedPanel
                    active={financeCostsView === "categories"}
                    label="成本分类"
                  >
                    {!isDiesel ? (
                      <Card className="border-[#d8e3e0] shadow-sm">
                        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                          <div>
                            <p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">
                              业财分析 · 权威业务来源
                            </p>
                            <CardTitle className="mt-1 text-base">
                              按成本类别分析汇总
                            </CardTitle>
                            <CardDescription className="mt-1">
                              完整展示生活开支、柴油油料、工资劳务、机械成本、车辆与运输、采购材料及其他开支。点击“查看明细”可按来源、状态、日期和关键词下钻真实业务单据；已关联柴油、采购结算与采购订单仍按防重复规则处理。
                            </CardDescription>
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setExpenseCategoryDetailFilter({
                                  category: "all",
                                  source: "all",
                                  status: "all",
                                  dateFrom: toLocalDateInput(),
                                  dateTo: toLocalDateInput(),
                                  keyword: "",
                                });
                                setExpenseCategoryDetailOpen(true);
                              }}
                            >
                              查看全部明细
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                !riskFinanceAnalysis.data?.categories.length
                              }
                              onClick={() =>
                                downloadCsvFile(
                                  `财务分类汇总-${financePeriod}.csv`,
                                  [
                                    "成本类别",
                                    "金额",
                                    "占比",
                                    "笔数",
                                    "权威来源",
                                  ],
                                  (
                                    riskFinanceAnalysis.data?.categories ?? []
                                  ).map(item => [
                                    item.label,
                                    item.amount,
                                    `${item.percentage}%`,
                                    item.recordCount,
                                    item.sources.join("、") || "—",
                                  ])
                                )
                              }
                            >
                              导出分类汇总
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent>
                          {riskFinanceAnalysis.isLoading ? (
                            <p className="text-sm text-slate-500">
                              正在汇总已登记的真实成本…
                            </p>
                          ) : riskFinanceAnalysis.data?.categories.length ? (
                            <div className="overflow-x-auto rounded-xl border border-[#e1e8e4]">
                              <Table className="min-w-[820px] text-xs">
                                <TableHeader className="bg-[#edf1ed]">
                                  <TableRow>
                                    <TableHead>成本类别</TableHead>
                                    <TableHead>金额</TableHead>
                                    <TableHead>占项目开支</TableHead>
                                    <TableHead>业务笔数</TableHead>
                                    <TableHead>权威来源</TableHead>
                                    <TableHead className="text-right">
                                      明细
                                    </TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {riskFinanceAnalysis.data.categories.map(
                                    item => (
                                      <TableRow key={item.code}>
                                        <TableCell className="font-medium text-[#203c48]">
                                          {item.label}
                                        </TableCell>
                                        <TableCell>
                                          ¥{displayMoney(item.amount)}
                                        </TableCell>
                                        <TableCell>
                                          {item.percentage}%
                                        </TableCell>
                                        <TableCell>
                                          {item.recordCount}
                                        </TableCell>
                                        <TableCell className="text-slate-600">
                                          {item.sources.join("、") ||
                                            "暂无记录"}
                                        </TableCell>
                                        <TableCell className="text-right">
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => {
                                              setExpenseCategoryDetailFilter({
                                                category: item.code,
                                                source: "all",
                                                status: "all",
                                                dateFrom: toLocalDateInput(),
                                                dateTo: toLocalDateInput(),
                                                keyword: "",
                                              });
                                              setExpenseCategoryDetailOpen(
                                                true
                                              );
                                            }}
                                          >
                                            查看明细
                                          </Button>
                                        </TableCell>
                                      </TableRow>
                                    )
                                  )}
                                  <TableRow className="bg-[#f8fbf8]">
                                    <TableCell className="font-semibold">
                                      合计
                                    </TableCell>
                                    <TableCell className="font-semibold">
                                      ¥
                                      {displayMoney(
                                        riskFinanceAnalysis.data.expenseAmount
                                      )}
                                    </TableCell>
                                    <TableCell>100%</TableCell>
                                    <TableCell>
                                      {financeCategoryRecordCount}
                                    </TableCell>
                                    <TableCell>
                                      统计期间：{financePeriod}
                                    </TableCell>
                                    <TableCell />
                                  </TableRow>
                                </TableBody>
                              </Table>
                            </div>
                          ) : (
                            <p className="text-sm text-slate-500">
                              当前期间暂无可分类的已登记成本。请先登记真实流水、柴油领用、工资、采购订单、机械成本或已审核运输结算。
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    ) : null}
                  </FinanceRetainedPanel>
                  <FinanceRetainedPanel
                    active={financeCostsView === "subcategories"}
                    label="小类目分析"
                  >
                    {!isDiesel ? (
                      <Card className="border-[#d8e3e0] shadow-sm">
                        <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">
                              业财分析 · 小类目
                            </p>
                            <CardTitle className="mt-1 text-base">
                              小类目成本占比与导出
                            </CardTitle>
                            <CardDescription className="mt-1">
                              在一级成本口径内细分生活、工资、油料、维修等已登记明细；占比均以当前项目、当前会计期间的真实项目开支为分母。采购订单应付与实际现金结算继续分开处理，不在本表重复累计。
                            </CardDescription>
                          </div>
                          <CurrentFilterPrintActions
                            disabled={
                              !riskFinanceAnalysis.data?.subcategories.length
                            }
                            onPrint={() =>
                              setFinancePrintPreview("subcategories")
                            }
                            onExport={() =>
                              downloadCsvFile(
                                `财务小类目汇总-${financePeriod}.csv`,
                                [
                                  "一级类别",
                                  "小类目",
                                  "金额",
                                  "占项目开支",
                                  "业务笔数",
                                  "权威来源",
                                ],
                                (
                                  riskFinanceAnalysis.data?.subcategories ?? []
                                ).map(item => [
                                  expenseCategoryDisplay(item.parentCode),
                                  item.label,
                                  item.amount,
                                  `${item.percentage}%`,
                                  item.recordCount,
                                  item.sources.join("、"),
                                ])
                              )
                            }
                            printLabel="打印当前小类目明细与汇总"
                            exportLabel="导出小类目汇总"
                          />
                        </CardHeader>
                        <CardContent>
                          {riskFinanceAnalysis.isLoading ? (
                            <p className="text-sm text-slate-500">
                              正在汇总小类目成本…
                            </p>
                          ) : riskFinanceAnalysis.data?.subcategories.length ? (
                            <div className="space-y-3">
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div className="rounded-lg border border-[#d8e3e0] bg-[#f8fbfa] p-3">
                                  <p className="text-xs text-slate-500">
                                    生活开支占项目开支
                                  </p>
                                  <p className="mt-1 text-lg font-semibold text-[#203c48]">
                                    {riskFinanceAnalysis.data.categories.find(
                                      item => item.code === "living"
                                    )?.percentage ?? 0}
                                    %
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    ¥{" "}
                                    {displayMoney(
                                      riskFinanceAnalysis.data.categories.find(
                                        item => item.code === "living"
                                      )?.amount ?? 0
                                    )}
                                  </p>
                                </div>
                                <div className="rounded-lg border border-[#d8e3e0] bg-[#f8fbfa] p-3">
                                  <p className="text-xs text-slate-500">
                                    工资劳务占项目开支
                                  </p>
                                  <p className="mt-1 text-lg font-semibold text-[#203c48]">
                                    {riskFinanceAnalysis.data.categories.find(
                                      item => item.code === "payroll"
                                    )?.percentage ?? 0}
                                    %
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    ¥{" "}
                                    {displayMoney(
                                      riskFinanceAnalysis.data.categories.find(
                                        item => item.code === "payroll"
                                      )?.amount ?? 0
                                    )}
                                  </p>
                                </div>
                              </div>
                              <div className="overflow-x-auto rounded-xl border border-[#e1e8e4]">
                                <Table className="min-w-[820px] text-xs">
                                  <TableHeader className="bg-[#edf1ed]">
                                    <TableRow>
                                      <TableHead>一级类别</TableHead>
                                      <TableHead>小类目</TableHead>
                                      <TableHead>金额</TableHead>
                                      <TableHead>占项目开支</TableHead>
                                      <TableHead>业务笔数</TableHead>
                                      <TableHead>权威来源</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {riskFinanceAnalysis.data.subcategories.map(
                                      item => (
                                        <TableRow key={item.code}>
                                          <TableCell>
                                            {expenseCategoryDisplay(
                                              item.parentCode
                                            )}
                                          </TableCell>
                                          <TableCell className="font-medium text-[#203c48]">
                                            {item.label}
                                          </TableCell>
                                          <TableCell>
                                            ¥{displayMoney(item.amount)}
                                          </TableCell>
                                          <TableCell>
                                            {item.percentage}%
                                          </TableCell>
                                          <TableCell>
                                            {item.recordCount}
                                          </TableCell>
                                          <TableCell className="text-slate-600">
                                            {item.sources.join("、")}
                                          </TableCell>
                                        </TableRow>
                                      )
                                    )}
                                  </TableBody>
                                </Table>
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-slate-500">
                              当前期间暂无可导出的已登记小类目成本。
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    ) : null}
                  </FinanceRetainedPanel>
                </div>
              </Tabs>
              <Card className="border-[#d8e3e0]">
                <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
                  <p className="text-sm text-slate-600">
                    柴油成本已纳入上方真实分类；完整加油登记、筛选、扣款与供应商对账在柴油管理办理。
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => setLocation("/admin/diesel")}
                  >
                    进入柴油管理
                  </Button>
                </CardContent>
              </Card>
            </FinanceRetainedPanel>
            {!isDiesel ? (
              <Dialog
                open={expenseCategoryDetailOpen}
                onOpenChange={setExpenseCategoryDetailOpen}
              >
                <DialogContent className="max-h-[90vh] w-[calc(100vw-3rem)] max-w-[1440px] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>项目支出分类明细</DialogTitle>
                    <DialogDescription>
                      明细严格对应当前项目、会计期间和所选筛选条件；分类来源为真实财务流水、柴油、工资、采购、机械、维修保养及运输结算。付款账户、电话和原始影像不在此列表展示。
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      <Field label="支出分类">
                        <Select
                          value={expenseCategoryDetailFilter.category}
                          onValueChange={category =>
                            setExpenseCategoryDetailFilter(current => ({
                              ...current,
                              category,
                            }))
                          }
                        >
                          <SelectTrigger aria-label="支出分类">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">全部支出分类</SelectItem>
                            {expenseCategoryDetails.data?.categories.map(
                              item => (
                                <SelectItem key={item.code} value={item.code}>
                                  {item.label}
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="业务来源">
                        <Select
                          value={expenseCategoryDetailFilter.source}
                          onValueChange={source =>
                            setExpenseCategoryDetailFilter(current => ({
                              ...current,
                              source,
                            }))
                          }
                        >
                          <SelectTrigger aria-label="支出业务来源">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">全部业务来源</SelectItem>
                            {expenseCategoryDetails.data?.sources.map(item => (
                              <SelectItem key={item.code} value={item.code}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="业务状态">
                        <Select
                          value={expenseCategoryDetailFilter.status}
                          onValueChange={status =>
                            setExpenseCategoryDetailFilter(current => ({
                              ...current,
                              status,
                            }))
                          }
                        >
                          <SelectTrigger aria-label="支出业务状态">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">全部业务状态</SelectItem>
                            {expenseCategoryDetails.data?.statuses.map(
                              status => (
                                <SelectItem key={status} value={status}>
                                  {getBusinessStatusLabel(status)}
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="开始日期（默认当天）">
                        <Input
                          type="date"
                          value={expenseCategoryDetailFilter.dateFrom}
                          onChange={event =>
                            setExpenseCategoryDetailFilter(current => ({
                              ...current,
                              dateFrom: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <Field label="结束日期（默认当天）">
                        <Input
                          type="date"
                          value={expenseCategoryDetailFilter.dateTo}
                          min={
                            expenseCategoryDetailFilter.dateFrom || undefined
                          }
                          onChange={event =>
                            setExpenseCategoryDetailFilter(current => ({
                              ...current,
                              dateTo: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <Field label="关键词">
                        <Input
                          value={expenseCategoryDetailFilter.keyword}
                          placeholder="单号、分类、说明或服务单位"
                          onChange={event =>
                            setExpenseCategoryDetailFilter(current => ({
                              ...current,
                              keyword: event.target.value,
                            }))
                          }
                        />
                      </Field>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <span>
                        明细日期范围：
                        {expenseCategoryDetailFilter.dateFrom || "月初"} 至{" "}
                        {expenseCategoryDetailFilter.dateTo || "月末"} ·
                        上方成本汇总为 {financePeriod} 整月
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setExpenseCategoryDetailFilter(current => ({
                            ...current,
                            dateFrom: toChinaDateInput(),
                            dateTo: toChinaDateInput(),
                          }))
                        }
                      >
                        当天
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setExpenseCategoryDetailFilter(current => ({
                            ...current,
                            dateFrom: `${financePeriod}-01`,
                            dateTo: `${financePeriod}-${String(new Date(Number(financePeriod.slice(0, 4)), Number(financePeriod.slice(5, 7)), 0).getDate()).padStart(2, "0")}`,
                          }))
                        }
                      >
                        查看本月
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#d8e3e0] bg-[#f7fbf9] px-4 py-3">
                      <p className="text-sm text-slate-700">
                        当前筛选：
                        <strong>
                          {expenseCategoryDetails.data?.summary.count ?? 0}
                        </strong>{" "}
                        笔 · 支出合计{" "}
                        <strong>
                          ¥
                          {displayMoney(
                            expenseCategoryDetails.data?.summary.amount ?? 0
                          )}
                        </strong>
                      </p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setExpenseCategoryDetailFilter({
                              category: "all",
                              source: "all",
                              status: "all",
                              dateFrom: toLocalDateInput(),
                              dateTo: toLocalDateInput(),
                              keyword: "",
                            })
                          }
                        >
                          清除筛选
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            !expenseCategoryDetails.data?.records.length
                          }
                          onClick={() =>
                            downloadCsvFile(
                              `项目支出分类明细-${financePeriod}.csv`,
                              [
                                "支出分类",
                                "业务来源",
                                "单据号",
                                "业务时间",
                                "小类目",
                                "状态",
                                "金额",
                                "说明",
                              ],
                              (expenseCategoryDetails.data?.records ?? []).map(
                                item => [
                                  expenseCategoryDisplay(item.category),
                                  expenseSourceDisplay(item.source),
                                  item.documentNo,
                                  displayDate(item.occurredAt),
                                  item.subcategory,
                                  getBusinessStatusLabel(item.status),
                                  item.amount,
                                  item.details,
                                ]
                              )
                            )
                          }
                        >
                          导出当前明细
                        </Button>
                      </div>
                    </div>
                    {expenseCategoryDetails.isLoading ? (
                      <EmptyState text="正在读取分类明细…" />
                    ) : (
                      <div className="overflow-x-auto rounded-xl border border-[#e1e8e4]">
                        <Table className="min-w-[1040px] text-xs">
                          <TableHeader className="bg-[#edf1ed]">
                            <TableRow>
                              <TableHead>支出分类 / 来源</TableHead>
                              <TableHead>单据号 / 业务时间</TableHead>
                              <TableHead>小类目</TableHead>
                              <TableHead>状态</TableHead>
                              <TableHead className="text-right">金额</TableHead>
                              <TableHead>说明</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {expenseCategoryDetails.data?.records.length ? (
                              expensePageRows.map(item => (
                                <TableRow key={item.id}>
                                  <TableCell>
                                    <p className="font-medium text-[#203c48]">
                                      {expenseCategoryDisplay(item.category)}
                                    </p>
                                    <p className="mt-1 text-[11px] text-slate-500">
                                      {expenseSourceDisplay(item.source)}
                                    </p>
                                  </TableCell>
                                  <TableCell>
                                    <p className="font-medium text-slate-800">
                                      {item.documentNo}
                                    </p>
                                    <p className="mt-1 text-[11px] text-slate-500">
                                      {displayDate(item.occurredAt)}
                                    </p>
                                  </TableCell>
                                  <TableCell>{item.subcategory}</TableCell>
                                  <TableCell>
                                    <BusinessStatusBadge status={item.status} />
                                  </TableCell>
                                  <TableCell className="text-right font-medium">
                                    ¥{displayMoney(item.amount)}
                                  </TableCell>
                                  <TableCell className="max-w-sm whitespace-normal text-slate-600">
                                    {item.details || "—"}
                                  </TableCell>
                                </TableRow>
                              ))
                            ) : (
                              <TableRow>
                                <TableCell
                                  colSpan={6}
                                  className="py-10 text-center text-slate-500"
                                >
                                  当前筛选范围没有可展示的真实支出业务明细。
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                    <FinancePagination
                      page={expensePage}
                      pageSize={financeExpensePageSize}
                      total={expenseRows.length}
                      onPageChange={setFinanceExpensePage}
                      onPageSizeChange={setFinanceExpensePageSize}
                      label="支出分类明细"
                    />
                  </div>
                  <DialogFooter>
                    <Button onClick={() => setExpenseCategoryDetailOpen(false)}>
                      关闭
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ) : null}
            <FinanceRetainedPanel active={isDiesel} label="柴油管理">
              <Tabs
                value={dieselTab}
                onValueChange={value => {
                  if (dieselRefuelDialogOpen || dieselPriceDialogOpen) return;
                  setDieselTab(value as typeof dieselTab);
                  setDieselPrintOpen(false);
                }}
              >
                <TabsList
                  aria-label="柴油工作区栏目"
                  className="grid h-auto w-full grid-cols-2 gap-2 bg-muted/40 p-2 lg:grid-cols-4"
                >
                  <TabsTrigger value="ledger">加油台账</TabsTrigger>
                  <TabsTrigger value="prices">油价与预警</TabsTrigger>
                  <TabsTrigger value="suppliers">供应商对账</TabsTrigger>
                  <TabsTrigger value="receipts">柴油票据</TabsTrigger>
                </TabsList>
              </Tabs>
              <Card className="border-[#d8e3e0] shadow-sm">
                <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">
                      项目部供油 · 运输扣款 · 机械油料成本
                    </p>
                    <CardTitle className="mt-1 text-base">
                      柴油业务工作台
                    </CardTitle>
                    <CardDescription className="mt-1">
                      项目部供油按有效指导单价计价；加油站加油按实际单价入账。关联渣土车趟次且勾选“结算扣油”后，财务结算自动从总运费扣除油款并锁定明细。
                    </CardDescription>
                  </div>
                  <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                    <Button
                      className="min-h-11 sm:min-h-8"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setDieselPriceForm({
                          ...EMPTY_DIESEL_PRICE_FORM,
                          projectId: financeProjectId,
                          effectiveFrom: dieselDate,
                        });
                        setDieselPriceDialogOpen(true);
                      }}
                    >
                      维护指导价
                    </Button>
                    <Button
                      className="min-h-11 sm:min-h-8"
                      size="sm"
                      onClick={() => {
                        resetDieselReceiptCapture();
                        setDieselRefuelForm({
                          ...EMPTY_DIESEL_REFUEL_FORM,
                          projectId: financeProjectId,
                          refueledAt: toDeviceDateTimeInput(),
                        });
                        setDieselRefuelDialogOpen(true);
                      }}
                    >
                      登记柴油领用
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FinanceRetainedPanel
                    active={
                      isDiesel &&
                      (dieselTab === "ledger" || dieselTab === "receipts")
                    }
                    label="柴油共同筛选与汇总"
                  >
                    <div
                      className="rounded-xl border border-[#d8e3e0] bg-[#f8fbf8] p-3"
                      data-diesel-current-print
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-[#29483e]">
                            柴油组合筛选
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            首次进入与恢复筛选后默认显示当天；可按需改为日期范围、车牌、机械、供油方式或供应商，再直接打印当前真实筛选结果。
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const today = toLocalDateInput();
                            setDieselLedgerFilter({
                              plateNo: "",
                              dateFrom: today,
                              dateTo: today,
                              month: "",
                              supplyMethod: "all",
                              assetType: "all",
                              supplierName: "",
                            });
                            setDieselMachineName("");
                          }}
                        >
                          恢复当天筛选
                        </Button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        <Select
                          value={dieselLedgerFilter.plateNo || "ALL_VEHICLES"}
                          disabled={dieselLedgerFilter.assetType === "machine"}
                          onValueChange={value =>
                            setDieselLedgerFilter(current => ({
                              ...current,
                              plateNo: value === "ALL_VEHICLES" ? "" : value,
                              assetType:
                                value === "ALL_VEHICLES"
                                  ? current.assetType
                                  : "vehicle",
                            }))
                          }
                        >
                          <SelectTrigger aria-label="柴油筛选车牌">
                            <SelectValue placeholder="全部车辆" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ALL_VEHICLES">
                              全部车辆
                            </SelectItem>
                            {(dieselVehicleOptions.data ?? [])
                              .filter(
                                vehicle =>
                                  String(vehicle.projectId) === financeProjectId
                              )
                              .map(vehicle => (
                                <SelectItem
                                  key={vehicle.id}
                                  value={vehicle.plateNo}
                                >
                                  {vehicle.plateNo}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="date"
                          max={dieselLedgerFilter.dateTo || undefined}
                          value={dieselLedgerFilter.dateFrom}
                          aria-label="柴油加油开始日期"
                          onChange={event =>
                            setDieselLedgerFilter(current => ({
                              ...current,
                              dateFrom: event.target.value,
                            }))
                          }
                        />
                        <Input
                          type="date"
                          min={dieselLedgerFilter.dateFrom || undefined}
                          value={dieselLedgerFilter.dateTo}
                          aria-label="柴油加油结束日期"
                          onChange={event =>
                            setDieselLedgerFilter(current => ({
                              ...current,
                              dateTo: event.target.value,
                            }))
                          }
                        />
                        <Input
                          type="month"
                          value={dieselLedgerFilter.month}
                          aria-label="柴油加油月份"
                          onChange={event =>
                            setDieselLedgerFilter(current => ({
                              ...current,
                              month: event.target.value,
                            }))
                          }
                        />
                        <Select
                          value={dieselLedgerFilter.supplyMethod}
                          onValueChange={value =>
                            setDieselLedgerFilter(current => ({
                              ...current,
                              supplyMethod: value,
                            }))
                          }
                        >
                          <SelectTrigger aria-label="柴油供油方式">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">全部供油方式</SelectItem>
                            <SelectItem value="project_supply">
                              项目部供油
                            </SelectItem>
                            <SelectItem value="external_station">
                              加油站现金加油
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <Select
                          value={dieselLedgerFilter.assetType}
                          onValueChange={value =>
                            setDieselLedgerFilter(current => ({
                              ...current,
                              assetType: value,
                              plateNo:
                                value === "machine" ? "" : current.plateNo,
                            }))
                          }
                        >
                          <SelectTrigger aria-label="柴油车辆机械">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">全部车辆 / 机械</SelectItem>
                            <SelectItem value="vehicle">仅车辆</SelectItem>
                            <SelectItem value="machine">仅机械</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          value={dieselMachineName}
                          aria-label="柴油顶部机械名称筛选"
                          placeholder="机械名称 / 编号（可选）"
                          disabled={dieselLedgerFilter.assetType === "vehicle"}
                          onChange={event => {
                            setDieselMachineName(event.target.value);
                            if (event.target.value.trim())
                              setDieselLedgerFilter(current => ({
                                ...current,
                                assetType: "machine",
                                plateNo: "",
                              }));
                          }}
                        />
                        <Input
                          value={dieselLedgerFilter.supplierName}
                          aria-label="柴油筛选供应商"
                          placeholder="供应商 / 加油站（可选）"
                          onChange={event =>
                            setDieselLedgerFilter(current => ({
                              ...current,
                              supplierName: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#d8e3e0] pt-3 print:hidden">
                        <p className="text-xs text-slate-500">
                          打印、导出和台账始终使用以上当前筛选条件。
                        </p>
                        <Button
                          disabled={!dieselRefuelRecords.data?.length}
                          onClick={() => {
                            setDieselPrintMode(
                              dieselLedgerFilter.assetType === "vehicle"
                                ? "vehicle"
                                : dieselLedgerFilter.assetType === "machine"
                                  ? "machine"
                                  : "current"
                            );
                            setDieselPrintOpen(true);
                          }}
                        >
                          打印当前筛选明细与汇总
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          void refreshDieselLedger();
                        }}
                      >
                        刷新当前筛选台账
                      </Button>
                      <Button
                        variant="outline"
                        disabled={!dieselRefuelRecords.data?.length}
                        onClick={() =>
                          downloadCsvFile(
                            `柴油领用明细-${dieselLedgerFilter.month || dieselLedgerFilter.dateFrom || "当前筛选"}.csv`,
                            [
                              "单号",
                              "资源",
                              "资源类型",
                              "供油方式",
                              "供应商/供油点",
                              "加油员",
                              "升数",
                              "适用单价",
                              "金额",
                              "是否扣运费",
                              "加油时间",
                              "状态",
                            ],
                            (dieselRefuelRecords.data ?? []).map(item => [
                              item.recordNo,
                              item.assetName,
                              item.assetType === "vehicle" ? "车辆" : "机械",
                              item.supplyMethod === "project_supply"
                                ? "项目部供油"
                                : "加油站加油",
                              item.stationOrSupplierName ?? "",
                              item.refuelerName ?? "未登记",
                              Number(item.liters),
                              Number(item.appliedUnitPrice),
                              Number(item.amount),
                              item.deductFromFreight ? "是" : "否",
                              displayDate(item.refueledAt),
                              getBusinessStatusLabel(item.status),
                            ])
                          )
                        }
                      >
                        导出当前筛选明细
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                      <MetricCard
                        title="当前筛选供油量"
                        value={`${dieselCurrentSummary.totalLiters.toFixed(2)} L`}
                        description={`项目部 ${dieselCurrentSummary.projectSupplyLiters.toFixed(2)} L · 加油站 ${dieselCurrentSummary.stationLiters.toFixed(2)} L`}
                        icon={Truck}
                      />
                      <MetricCard
                        title="当前筛选柴油金额"
                        value={dieselCurrentSummary.totalAmount}
                        description={`有效 ${dieselCurrentSummary.effectiveRecordCount} 笔；作废不计入`}
                        icon={BarChart3}
                      />
                      <MetricCard
                        title="车辆 / 机械领用"
                        value={`${dieselCurrentSummary.vehicleLiters.toFixed(2)} / ${dieselCurrentSummary.machineLiters.toFixed(2)} L`}
                        description="同当前筛选；车辆可关联趟次，机械自动进入成本台账"
                        icon={Settings2}
                      />
                      <MetricCard
                        title="待扣运费油款"
                        value={dieselCurrentSummary.deductibleAmount}
                        description="同当前筛选；结算运输趟次时从总运费扣减"
                        icon={ScrollText}
                      />
                    </div>
                  </FinanceRetainedPanel>
                  <FinanceRetainedPanel
                    active={isDiesel && dieselTab === "ledger"}
                    label="加油台账"
                  >
                    <div className="rounded-xl border border-[#d8e3e0] bg-[#f8fbf8] p-3 text-sm text-[#29483e]">
                      <p>
                        <span className="font-medium">项目部供油：</span>
                        {dieselGuidelinePrices.data?.find(
                          price => price.status === "active"
                        )
                          ? `¥ ${displayMoney(dieselGuidelinePrices.data.find(price => price.status === "active")?.pricePerLiter)} / L（生效 ${toBusinessDateInput(dieselGuidelinePrices.data.find(price => price.status === "active")?.effectiveFrom)}，按加油日期由服务端匹配并固化）`
                          : "尚未维护有效指导价；项目部供油登记前请先维护。"}
                      </p>
                      <p className="mt-1">
                        <span className="font-medium">加油站现金加油：</span>
                        每次登记当天实际单价和升数，系统自动计算金额并固化现金油价快照。
                      </p>
                    </div>
                    <LedgerTable
                      title="每日柴油领用明细"
                      description="项目部供油按指导价快照，加油站现金加油按实际单价快照；小票影像、价格预警和供应商对账均保留审计链。已结算车辆油款会锁定并在运输净结算中体现。"
                      loading={
                        dieselRefuelRecords.isLoading ||
                        dieselRefuelRecords.isFetching
                      }
                      columns={[
                        "单号/资源",
                        "供油方式",
                        "油量 / 单价",
                        "金额",
                        "凭证 / 预警",
                        "运输扣油",
                        "加油时间",
                        "状态",
                      ]}
                      rows={dieselLedgerPagination.pageRows.map(item => ({
                        id: Number(item.id),
                        cells: [
                          <div>
                            <p>{item.recordNo}</p>
                            <p className="mt-1 text-[11px] text-slate-500">
                              {item.assetName}
                            </p>
                          </div>,
                          item.supplyMethod === "project_supply"
                            ? "项目部供油"
                            : `加油站 · ${item.stationOrSupplierName ?? "未填写"}`,
                          `${Number(item.liters).toFixed(2)} L / ¥${displayMoney(item.appliedUnitPrice)}`,
                          `¥ ${displayMoney(item.amount)}`,
                          <div className="space-y-1">
                            {item.receiptEvidence?.url ? (
                              <ProtectedImagePreview
                                file={{
                                  url: item.receiptEvidence.url!,
                                  fileName: item.receiptEvidence.fileName,
                                  mimeType: item.receiptEvidence.mimeType,
                                }}
                                title="柴油加油小票"
                                description="小票照片仅在当前授权范围内站内预览。"
                                className="text-xs font-medium text-[#2b6660] underline"
                              >
                                查看小票照片
                              </ProtectedImagePreview>
                            ) : (
                              <p className="text-xs text-slate-500">
                                无小票照片
                              </p>
                            )}
                            {item.priceAlert?.isAlert ? (
                              <p className="text-xs font-medium text-rose-700">
                                价格波动 {item.priceAlert.deviationPercent}%
                              </p>
                            ) : item.supplyMethod === "external_station" ? (
                              <p className="text-xs text-emerald-700">
                                价格正常
                              </p>
                            ) : null}
                          </div>,
                          item.deductFromFreight
                            ? item.tripNo
                              ? `扣 ${item.tripNo}`
                              : "待关联趟次"
                            : "不扣",
                          displayDate(item.refueledAt),
                          <BusinessStatusBadge status={item.status} />,
                        ],
                        onOpen: () =>
                          setDesktopRecordDetail({
                            title: `柴油领用 ${item.recordNo}`,
                            description:
                              "领用金额、计价方式、小票影像和运输扣款均以服务端快照为准。",
                            fields: [
                              { label: "资源", value: item.assetName },
                              {
                                label: "供油方式",
                                value:
                                  item.supplyMethod === "project_supply"
                                    ? "项目部供油"
                                    : "加油站现金加油",
                              },
                              {
                                label: "加油量",
                                value: `${Number(item.liters).toFixed(2)} L`,
                              },
                              {
                                label: "适用单价",
                                value: `¥ ${displayMoney(item.appliedUnitPrice)}/L`,
                              },
                              {
                                label: "金额",
                                value: `¥ ${displayMoney(item.amount)}`,
                              },
                              {
                                label: "价格预警",
                                value: item.priceAlert?.isAlert
                                  ? `异常波动 ${item.priceAlert.deviationPercent}%（基准 ¥${displayMoney(item.priceAlert.referenceUnitPrice)}/L，阈值 ${item.priceAlert.thresholdPercent}%）`
                                  : item.supplyMethod === "external_station"
                                    ? "未触发预警"
                                    : "项目部指导价供油，不参与现金价格预警",
                              },
                              {
                                label: "现金小票",
                                value: item.receiptEvidence?.url ? (
                                  <ProtectedImagePreview
                                    file={{
                                      url: item.receiptEvidence.url!,
                                      fileName: item.receiptEvidence.fileName,
                                      mimeType: item.receiptEvidence.mimeType,
                                    }}
                                    title="柴油加油小票"
                                    description="小票照片仅在当前授权范围内站内预览。"
                                    className="font-medium text-[#2b6660] underline"
                                  >
                                    查看受控小票影像：
                                    {item.receiptEvidence.fileName}
                                  </ProtectedImagePreview>
                                ) : (
                                  "未关联小票照片"
                                ),
                              },
                              {
                                label: "运输扣款",
                                value: item.deductFromFreight
                                  ? (item.tripNo ?? "待关联趟次")
                                  : "不扣减运费",
                              },
                              {
                                label: "时间",
                                value: displayDate(item.refueledAt),
                              },
                              {
                                label: "状态",
                                value: getBusinessStatusLabel(item.status),
                              },
                            ],
                          }),
                      }))}
                    />
                    <FinancePagination
                      page={dieselLedgerPagination.page}
                      pageSize={dieselLedgerPagination.pageSize}
                      total={dieselLedgerPagination.total}
                      onPageChange={dieselLedgerPagination.setPage}
                      onPageSizeChange={dieselLedgerPagination.setPageSize}
                      label="加油台账"
                    />
                  </FinanceRetainedPanel>
                  <FinanceRetainedPanel
                    active={isDiesel && dieselTab === "prices"}
                    label="油价与预警"
                  >
                    <div className="rounded-xl border border-[#d8e3e0] bg-[#f8fbf8] p-3 text-sm text-[#29483e]">
                      <p>
                        <span className="font-medium">项目部供油：</span>
                        {dieselGuidelinePrices.data?.find(
                          price => price.status === "active"
                        )
                          ? `¥ ${displayMoney(dieselGuidelinePrices.data.find(price => price.status === "active")?.pricePerLiter)} / L（生效 ${toBusinessDateInput(dieselGuidelinePrices.data.find(price => price.status === "active")?.effectiveFrom)}，按加油日期由服务端匹配并固化）`
                          : "尚未维护有效指导价；项目部供油登记前请先维护。"}
                      </p>
                      <p className="mt-1">
                        <span className="font-medium">加油站现金加油：</span>
                        每次登记当天实际单价和升数，系统自动计算金额并固化现金油价快照。
                      </p>
                    </div>
                    <Card className="border-amber-200 bg-amber-50/50 shadow-none">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm">
                          现金油价异常预警
                        </CardTitle>
                        <CardDescription>
                          同项目、同一供应商当前价格相对上一笔有效现金价格的波动达到阈值时，柴油记录和采购对账将显示预警并写入审计。
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex flex-wrap items-end gap-2">
                        <div className="grid gap-1.5">
                          <Label>波动阈值（%）</Label>
                          <Input
                            className="w-36"
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={dieselAlertThreshold}
                            onChange={event =>
                              setDieselAlertThreshold(event.target.value)
                            }
                          />
                        </div>
                        <Button
                          size="sm"
                          disabled={
                            saveDieselPriceAlertRule.isPending ||
                            !Number(dieselAlertThreshold)
                          }
                          onClick={() =>
                            saveDieselPriceAlertRule.mutate({
                              projectId: Number(financeProjectId),
                              thresholdPercent: Number(dieselAlertThreshold),
                              enabled:
                                dieselPriceAlertRule.data?.enabled ?? true,
                            })
                          }
                        >
                          {saveDieselPriceAlertRule.isPending
                            ? "正在保存…"
                            : `保存${dieselPriceAlertRule.data?.enabled === false ? "并启用" : "阈值"}`}
                        </Button>
                        <p className="basis-full text-xs text-amber-900">
                          当前：
                          {dieselPriceAlertRule.data?.enabled === false
                            ? "已停用预警"
                            : `波动达到 ${dieselPriceAlertRule.data?.thresholdPercent ?? 10}% 时预警`}
                        </p>
                      </CardContent>
                    </Card>
                    <DieselPriceHistory
                      rows={dieselGuidelinePrices.data ?? []}
                      loading={
                        dieselGuidelinePrices.isLoading ||
                        dieselGuidelinePrices.isFetching
                      }
                      error={dieselGuidelinePrices.isError}
                      projectName={dieselProjectName}
                      enabled={isDiesel && dieselTab === "prices"}
                    />
                  </FinanceRetainedPanel>
                  <FinanceRetainedPanel
                    active={isDiesel && dieselTab === "suppliers"}
                    label="供应商对账"
                  >
                    <DieselSupplierReport
                      rows={dieselSupplierReconciliation.data ?? []}
                      loading={
                        dieselSupplierReconciliation.isLoading ||
                        dieselSupplierReconciliation.isFetching
                      }
                      error={dieselSupplierReconciliation.isError}
                      projectName={dieselProjectName}
                      period={financePeriod}
                      enabled={isDiesel && dieselTab === "suppliers"}
                    />
                  </FinanceRetainedPanel>
                  <FinanceRetainedPanel
                    active={isDiesel && dieselTab === "receipts"}
                    label="柴油票据"
                  >
                    <DieselReceiptLedger
                      records={dieselRefuelRecords.data ?? []}
                      loading={
                        dieselRefuelRecords.isLoading ||
                        dieselRefuelRecords.isFetching
                      }
                      error={dieselRefuelRecords.isError}
                      projectName={dieselProjectName}
                      filterLabel={dieselCurrentFilterLabel}
                      enabled={isDiesel && dieselTab === "receipts"}
                    />
                  </FinanceRetainedPanel>
                  <DieselRefuelPrintDialog
                    open={
                      dieselPrintOpen &&
                      isDiesel &&
                      (dieselTab === "ledger" || dieselTab === "receipts")
                    }
                    onOpenChange={setDieselPrintOpen}
                    mode={dieselPrintMode}
                    projectName={dieselProjectName}
                    dateLabel={dieselCurrentFilterLabel}
                    records={
                      (dieselRefuelRecords.data ?? []) as DieselPrintRecord[]
                    }
                  />
                  <p className="rounded-lg border bg-slate-50 p-3 text-xs text-slate-600">
                    柴油台账统计不等同于全项目会计日结；加油小票不等同于正式发票或已抵扣凭证。财务发票、封账和财税资料统一在财务管理维护。
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setFinanceTab("invoices");
                      setLocation("/admin/finance");
                    }}
                  >
                    前往财务发票管理
                  </Button>
                </CardContent>
              </Card>
            </FinanceRetainedPanel>
            <FinanceRetainedPanel
              active={!isDiesel && financeTab === "invoices"}
              label="发票管理"
            >
              <Card className="w-full border-[#d8e3e0] shadow-sm">
                <CardHeader>
                  <p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">
                    财务审计 · 综合台账
                  </p>
                  <CardTitle className="mt-1 text-base">
                    发票、成本与审计台账
                  </CardTitle>
                  <CardDescription className="mt-1">
                    发票行内集中展示往来单位、开票日期、金额、税额与状态；柴油领用和会计日结保留为关联业务台账，不重复展示发票列表。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)_auto]">
                    <Select
                      value={financeInvoiceFilter.status}
                      onValueChange={status =>
                        setFinanceInvoiceFilter(current => ({
                          ...current,
                          status,
                        }))
                      }
                    >
                      <SelectTrigger aria-label="发票状态筛选">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部发票状态</SelectItem>
                        {Array.from(
                          new Set(
                            (financeInvoices.data?.invoices ?? []).map(
                              invoice => invoice.status
                            )
                          )
                        ).map(status => (
                          <SelectItem key={status} value={status}>
                            {getBusinessStatusLabel(status)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      aria-label="发票关键词筛选"
                      value={financeInvoiceFilter.keyword}
                      onChange={event =>
                        setFinanceInvoiceFilter(current => ({
                          ...current,
                          keyword: event.target.value,
                        }))
                      }
                      placeholder="发票号码、往来单位"
                    />
                    <CurrentFilterPrintActions
                      disabled={!financeInvoiceRows.length}
                      onPrint={() => setFinancePrintPreview("invoices")}
                      onExport={() =>
                        downloadCsvFile(
                          `发票台账-${financePeriod}.csv`,
                          [
                            "发票号码",
                            "往来单位",
                            "日期",
                            "类型",
                            "金额",
                            "税额",
                            "状态",
                          ],
                          financeInvoiceRows.map(invoice => [
                            invoice.invoiceNo,
                            invoice.counterpartyName,
                            displayDate(invoice.issuedAt),
                            getInvoiceTypeLabel(invoice.invoiceType),
                            invoice.amount,
                            invoice.taxAmount ?? 0,
                            getBusinessStatusLabel(invoice.status),
                          ])
                        )
                      }
                    />
                  </div>
                  <p className="rounded-lg border bg-[#f8fbf9] px-3 py-2 text-xs text-slate-600">
                    当前月份 {financePeriod} · 全部筛选{" "}
                    {financeInvoiceRows.length} 张 · 有效开票金额 ¥
                    {displayMoney(invoiceDetailedSummary.amount)} · 有效税额 ¥
                    {displayMoney(invoiceDetailedSummary.tax)}（不含作废与红冲）
                  </p>
                  {financeInvoices.isLoading ? (
                    <EmptyState text="正在读取发票台账…" />
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-[#e1e8e4]">
                      <Table className="min-w-[1080px] text-xs">
                        <TableHeader className="bg-[#edf1ed]">
                          <TableRow className="border-[#dce3de] hover:bg-[#edf1ed]">
                            <TableHead className="h-11 px-4 font-semibold text-[#46615a]">
                              发票号码
                            </TableHead>
                            <TableHead className="h-11 px-4 font-semibold text-[#46615a]">
                              往来单位
                            </TableHead>
                            <TableHead className="h-11 px-4 font-semibold text-[#46615a]">
                              开票日期
                            </TableHead>
                            <TableHead className="h-11 px-4 font-semibold text-[#46615a]">
                              发票类型
                            </TableHead>
                            <TableHead className="h-11 px-4 font-semibold text-[#46615a]">
                              金额
                            </TableHead>
                            <TableHead className="h-11 px-4 font-semibold text-[#46615a]">
                              税额
                            </TableHead>
                            <TableHead className="h-11 px-4 font-semibold text-[#46615a]">
                              状态
                            </TableHead>
                            <TableHead className="h-11 px-4 text-right font-semibold text-[#46615a]">
                              操作
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {financeInvoiceRows.length ? (
                            financeInvoicePageRows.map(invoice => (
                              <TableRow
                                key={invoice.id}
                                className="border-[#edf0ee] hover:bg-[#fbfaf1]"
                              >
                                <TableCell className="px-4 py-3 font-semibold text-[#203c48]">
                                  {invoice.invoiceNo}
                                </TableCell>
                                <TableCell className="px-4 py-3 text-slate-700">
                                  {invoice.counterpartyName}
                                </TableCell>
                                <TableCell className="px-4 py-3 text-slate-700">
                                  {displayDate(invoice.issuedAt)}
                                </TableCell>
                                <TableCell className="px-4 py-3 text-slate-700">
                                  {getInvoiceTypeLabel(invoice.invoiceType)}
                                </TableCell>
                                <TableCell className="px-4 py-3 font-medium text-slate-800">
                                  ¥{displayMoney(invoice.amount)}
                                </TableCell>
                                <TableCell className="px-4 py-3 text-slate-700">
                                  ¥{displayMoney(invoice.taxAmount)}
                                </TableCell>
                                <TableCell className="px-4 py-3">
                                  <BusinessStatusBadge
                                    status={invoice.status}
                                  />
                                </TableCell>
                                <TableCell className="px-4 py-3 text-right">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      setDesktopRecordDetail({
                                        title: `发票审计 · ${invoice.invoiceNo}`,
                                        description:
                                          "发票详情仍受会计、财务负责人及项目范围的服务端校验。",
                                        fields: [
                                          {
                                            label: "往来单位",
                                            value: invoice.counterpartyName,
                                          },
                                          {
                                            label: "开票日期",
                                            value: displayDate(
                                              invoice.issuedAt
                                            ),
                                          },
                                          {
                                            label: "发票类型",
                                            value: getInvoiceTypeLabel(
                                              invoice.invoiceType
                                            ),
                                          },
                                          {
                                            label: "金额",
                                            value: `¥ ${displayMoney(invoice.amount)}`,
                                          },
                                          {
                                            label: "税额",
                                            value: `¥ ${displayMoney(invoice.taxAmount)}`,
                                          },
                                          {
                                            label: "状态",
                                            value: (
                                              <BusinessStatusBadge
                                                status={invoice.status}
                                              />
                                            ),
                                          },
                                        ],
                                      })
                                    }
                                  >
                                    详情
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))
                          ) : (
                            <TableRow>
                              <TableCell
                                colSpan={8}
                                className="px-4 py-10 text-center text-slate-500"
                              >
                                当前期间暂无发票，财务岗位可通过发票台账接口登记真实凭证。
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  <FinancePagination
                    page={invoicePage}
                    pageSize={financeInvoicePageSize}
                    total={financeInvoiceRows.length}
                    onPageChange={setFinanceInvoicePage}
                    onPageSizeChange={setFinanceInvoicePageSize}
                    label="发票台账"
                  />
                </CardContent>
              </Card>
            </FinanceRetainedPanel>
            <FinanceRetainedPanel
              active={
                !isDiesel &&
                financeTab === "closing" &&
                financeClosingView === "daily"
              }
              label="日结封存"
            >
              <Card className="print:border-0 print:shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">
                    后勤每日开支会计日结与打印
                  </CardTitle>
                  <CardDescription>
                    日结时由服务端重新汇总当日流水与发票，生成 SHA-256
                    快照；封存后不可重复日结，可作为每日凭证装订页打印。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="grid gap-1.5">
                      <Label>日结日期</Label>
                      <Input
                        type="date"
                        value={financeClosingDate}
                        onChange={event =>
                          setFinanceClosingDate(event.target.value)
                        }
                      />
                    </div>
                    <Button
                      className="bg-[#203c48] hover:bg-[#17313b]"
                      disabled={closeDailyAccount.isPending}
                      onClick={() =>
                        closeDailyAccount.mutate({
                          projectId: Number(financeProjectId),
                          closingDate: financeClosingDate,
                        })
                      }
                    >
                      {closeDailyAccount.isPending
                        ? "正在日结…"
                        : "执行日结并封存"}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!dailyAccountingReport.data}
                      onClick={printDailyAccountingSnapshot}
                    >
                      打印日结装订页
                    </Button>
                  </div>
                  {dailyAccountingReport.data ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-wrap justify-between gap-3">
                        <div>
                          <p className="font-medium text-slate-900">
                            日结单：
                            {dailyAccountingReport.data.closure.closingNo}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            封存日期：{financeClosingDate} · 快照指纹：
                            {dailyAccountingReport.data.closure.snapshotHash.slice(
                              0,
                              16
                            )}
                            …
                          </p>
                        </div>
                        <div className="text-right text-sm">
                          <p>
                            收入：¥{" "}
                            {displayMoney(
                              dailyAccountingReport.data.closure.totalIncome
                            )}
                          </p>
                          <p>
                            开支：¥{" "}
                            {displayMoney(
                              dailyAccountingReport.data.closure.totalExpense
                            )}
                          </p>
                          <p>
                            发票：
                            {dailyAccountingReport.data.closure.invoiceCount} 张
                            · ¥{" "}
                            {displayMoney(
                              dailyAccountingReport.data.closure.invoiceAmount
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">
                      尚未封存该日期，执行日结后将显示可打印的审计快照。
                    </p>
                  )}
                </CardContent>
              </Card>
              <Card className="border-amber-200 bg-amber-50/40 shadow-sm">
                <CardHeader>
                  <p className="text-xs font-semibold tracking-[0.12em] text-amber-800">
                    财务期间控制 · 调整链
                  </p>
                  <CardTitle className="mt-1 text-base">
                    日结封存、授权反结账与版本快照
                  </CardTitle>
                  <CardDescription className="mt-1">
                    已封存日期的流水、发票、采购结算和冲销会由服务端拦截。仅财务负责人可填写原因授权反结账；重新封存后生成新版本，旧快照与反结账原因永久保留。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {dailyAccountingReport.data ? (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white/80 p-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {dailyAccountingReport.data.closure.closingNo} · 第{" "}
                            {dailyAccountingReport.data.closure.revision ?? 1}{" "}
                            版
                          </p>
                          <p className="mt-1 text-xs text-slate-600">
                            当前状态：
                            {dailyAccountingReport.data.closure.status ===
                            "reopened"
                              ? "已授权反结账，允许补充后重新封存"
                              : "已封存，写入已锁定"}{" "}
                            · 快照{" "}
                            {dailyAccountingReport.data.closure.snapshotHash.slice(
                              0,
                              16
                            )}
                            …
                          </p>
                        </div>
                        <BusinessStatusBadge
                          status={dailyAccountingReport.data.closure.status}
                        />
                      </div>
                      {dailyAccountingReport.data.closure.status ===
                      "closed" ? (
                        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                          <Input
                            value={financeReopenReason}
                            maxLength={500}
                            placeholder="反结账原因（至少 5 个字，例如：补充已核实的原始凭证）"
                            onChange={event =>
                              setFinanceReopenReason(event.target.value)
                            }
                          />
                          <Button
                            variant="outline"
                            disabled={
                              reopenDailyAccount.isPending ||
                              financeReopenReason.trim().length < 5
                            }
                            onClick={() =>
                              reopenDailyAccount.mutate({
                                projectId: Number(financeProjectId),
                                closingDate: financeClosingDate,
                                reason: financeReopenReason.trim(),
                              })
                            }
                          >
                            {reopenDailyAccount.isPending
                              ? "正在授权…"
                              : "授权反结账"}
                          </Button>
                        </div>
                      ) : (
                        <p className="text-sm text-amber-900">
                          当前日期已反结账。请完成受控调整后重新执行日结，系统会生成下一版本快照。
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-slate-600">
                      选择已封存日期后可查看版本快照和受控调整状态。
                    </p>
                  )}
                </CardContent>
              </Card>
            </FinanceRetainedPanel>
            <FinanceRetainedPanel
              active={!isDiesel && financeTab === "tax"}
              label="财税交接"
            >
              <TaxAccountingHandoffManager
                projectId={Number(financeProjectId)}
                period={financePeriod}
                enabled={financeTab === "tax" && !isDiesel}
                onDirtyChange={setFinanceTaxDirty}
              />
            </FinanceRetainedPanel>
            {!isDiesel ? (
              <FinancialLedgerPrintPreviewDialogs
                activeBook={financePrintReady ? financePrintPreview : null}
                onActiveBookChange={setFinancePrintPreview}
                projectName={selectedWorkspaceProject?.name ?? "当前项目"}
                period={financePeriod}
                books={[
                  {
                    id: "ledger",
                    title: "项目资金总账明细与汇总表",
                    filterLabel: financeLedgerFilterLabel,
                    columns: [
                      { label: "单号", width: "12%" },
                      { label: "发生时间", width: "12%" },
                      { label: "收支", width: "7%" },
                      { label: "资金细项", width: "12%" },
                      { label: "业务来源", width: "13%" },
                      { label: "结算状态", width: "10%" },
                      { label: "金额", width: "12%" },
                      { label: "说明", width: "22%" },
                    ],
                    rows: financeLedgerPrintRows,
                    summaryLabel: `合计：当前筛选 ${financeLedgerPrintRows.length} 笔；收入 ¥${displayMoney(financeLedgerIncome)}；支出 ¥${displayMoney(financeLedgerExpense)}；净额 ¥${displayMoney(financeLedgerIncome - financeLedgerExpense)}`,
                  },
                  {
                    id: "invoices",
                    title: "财务发票台账明细与汇总表",
                    filterLabel: "当前项目、当前会计期间的发票审计台账",
                    columns: [
                      { label: "发票号码", width: "15%" },
                      { label: "往来单位", width: "22%" },
                      { label: "开票日期", width: "12%" },
                      { label: "发票类型", width: "14%" },
                      { label: "金额", width: "13%" },
                      { label: "税额", width: "12%" },
                      { label: "状态", width: "12%" },
                    ],
                    rows: invoicePrintRows,
                    summaryLabel: `合计：发票 ${invoicePrintRows.length} 张；有效分摊金额 ¥${displayMoney(financeInvoices.data?.summary.totalAmount ?? 0)}；有效税额 ¥${displayMoney(invoiceTotalTax)}；待认证金额 ¥${displayMoney(financeInvoices.data?.summary.pendingAmount ?? 0)}`,
                  },
                  {
                    id: "categories",
                    title: "项目成本分类明细与汇总表",
                    filterLabel: "当前项目、当前会计期间的已登记真实成本分类",
                    columns: [
                      { label: "成本类别", width: "24%" },
                      { label: "金额", width: "18%" },
                      { label: "占项目开支", width: "16%" },
                      { label: "业务笔数", width: "16%" },
                      { label: "权威来源", width: "26%" },
                    ],
                    rows: financeCategoryPrintRows,
                    summaryLabel: `合计：分类 ${financeCategoryPrintRows.length} 类；业务 ${financeCategoryRecordCount} 笔；项目成本 ¥${displayMoney(riskFinanceAnalysis.data?.expenseAmount ?? 0)}；占比 100%`,
                  },
                  {
                    id: "subcategories",
                    title: "项目成本小类目明细与汇总表",
                    filterLabel: "当前项目、当前会计期间的已登记真实成本小类目",
                    columns: [
                      { label: "一级类别", width: "17%" },
                      { label: "小类目", width: "19%" },
                      { label: "金额", width: "16%" },
                      { label: "占项目开支", width: "16%" },
                      { label: "业务笔数", width: "14%" },
                      { label: "权威来源", width: "18%" },
                    ],
                    rows: financeSubcategoryPrintRows,
                    summaryLabel: `合计：小类目 ${financeSubcategoryPrintRows.length} 项；业务 ${financeSubcategoryRecordCount} 笔；项目成本 ¥${displayMoney(riskFinanceAnalysis.data?.expenseAmount ?? 0)}；占比按当前项目开支口径计算`,
                  },
                ]}
              />
            ) : null}
            {!isDiesel && financePrintPreview && !financePrintReady ? (
              <Dialog
                open
                onOpenChange={open => {
                  if (!open) setFinancePrintPreview(null);
                }}
              >
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>财务报表预览</DialogTitle>
                    <DialogDescription>
                      {financePrintError
                        ? "报表数据暂时无法读取，请稍后重试。"
                        : "正在读取当前项目、期间及全部筛选结果，请稍候…"}
                    </DialogDescription>
                  </DialogHeader>
                  {financePrintError ? (
                    <Button
                      variant="outline"
                      onClick={() => void financePrintQuery.refetch()}
                    >
                      重新读取
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    onClick={() => setFinancePrintPreview(null)}
                  >
                    关闭
                  </Button>
                </DialogContent>
              </Dialog>
            ) : null}
            {financePaymentTarget ? (
              <SettlementPaymentDialog
                open
                onOpenChange={open => {
                  if (!open) setFinancePaymentTarget(null);
                }}
                projectId={financePaymentTarget.projectId}
                settlementType={financePaymentTarget.sourceType}
                target={{
                  id: financePaymentTarget.settlementId,
                  label: financePaymentTarget.settlementNo,
                }}
                readOnly={financePaymentTarget.readOnly}
                onCompleted={async () => {
                  await Promise.all([
                    financeUtils.settlementPayment.board.invalidate(),
                    financeUtils.settlementPayment.monthlyReconciliation.invalidate(),
                    financeUtils.finance.summary.invalidate(),
                  ]);
                }}
              />
            ) : null}
          </>
        )}
      </div>
    );
  };

  const renderRisk = () => {
    const alerts = riskAlerts.data ?? [];
    const openCount = alerts.filter(item => item.status === "open").length;
    const criticalCount = alerts.filter(
      item =>
        item.severity === "critical" &&
        ["open", "acknowledged"].includes(item.status)
    ).length;
    const validateRule = () => {
      const values = [
        riskRuleForm.maxFuelFillRatio,
        riskRuleForm.maxTransportSpeedKmh,
        riskRuleForm.maxTransportDurationMinutes,
        riskRuleForm.maxOpenCheckInHours,
        riskRuleForm.maxPendingReportHours,
      ].map(Number);
      const escalationHour = Number(riskRuleForm.overdueEscalationHourChina);
      if (values.some(value => !Number.isFinite(value) || value <= 0))
        return toast.error("请填写有效的正数风险阈值");
      if (
        !Number.isInteger(escalationHour) ||
        escalationHour < 0 ||
        escalationHour > 23
      )
        return toast.error("逾期升级检查时间必须为 0—23 点（中国标准时间）");
      if (!financeProjectId) return toast.error("请先选择项目");
      saveRiskRule.mutate({
        projectId: Number(financeProjectId),
        enabled: riskRuleForm.enabled,
        maxFuelFillRatio: values[0],
        maxTransportSpeedKmh: values[1],
        maxTransportDurationMinutes: Math.round(values[2]),
        maxOpenCheckInHours: Math.round(values[3]),
        maxPendingReportHours: Math.round(values[4]),
        overdueEscalationEnabled: riskRuleForm.overdueEscalationEnabled,
        overdueEscalationHourChina: escalationHour,
      });
    };
    const severityLabel: Record<string, string> = {
      notice: "提示",
      warning: "预警",
      critical: "严重",
    };
    const categoryLabel: Record<string, string> = {
      construction: "施工日报",
      attendance: "考勤",
      fuel: "柴油",
      transport: "运输",
    };
    const riskAlertStatusLabel: Record<string, string> = {
      open: "待处置",
      acknowledged: "已确认",
      in_rectification: "整改中",
      resolved: "已解决",
      ignored: "已忽略",
    };
    const displayRiskAlertCategory = (category: string) =>
      categoryLabel[category] ?? "其他风险";
    const displayRiskAlertSeverity = (severity: string) =>
      severityLabel[severity] ?? "提示";
    const displayRiskAlertStatus = (status: string) =>
      riskAlertStatusLabel[status] ?? "待处置";
    const pendingRectifications = alerts.filter(item =>
      ["open", "acknowledged", "in_rectification"].includes(item.status)
    );
    return (
      <div className="space-y-5">
        {financeProjectId ? (
          <Card className="border-[#d8e3e0] shadow-sm">
            <CardHeader className="flex flex-col gap-3 space-y-0 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">
                  真实配置与整改治理
                </p>
                <CardTitle className="mt-1 text-base">
                  设备容量、整改期限与逾期升级
                </CardTitle>
                <CardDescription className="mt-1">
                  请维护现场核定油箱容量。未配置容量的车辆或机械不会触发加油超量规则；逾期升级启用后会在每日指定中国标准时间检查未解决整改并向责任人与项目管理岗位发送站内提醒。
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setLocation("/admin/vehicles");
                  }}
                >
                  维护车辆容量
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setLocation("/admin/machinery");
                  }}
                >
                  维护机械容量
                </Button>
                <Button
                  size="sm"
                  disabled={runOverdueRiskEscalation.isPending}
                  onClick={() =>
                    runOverdueRiskEscalation.mutate({
                      projectId: Number(financeProjectId),
                    })
                  }
                >
                  {runOverdueRiskEscalation.isPending
                    ? "正在验收…"
                    : "执行逾期升级验收"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  title="车辆容量已配置"
                  value={`${riskCapacityReadiness.data?.vehicleConfigured ?? 0} / ${riskCapacityReadiness.data?.vehicleTotal ?? 0}`}
                  description="加油超量检测前置条件"
                  icon={Truck}
                />
                <MetricCard
                  title="机械容量已配置"
                  value={`${riskCapacityReadiness.data?.machineConfigured ?? 0} / ${riskCapacityReadiness.data?.machineTotal ?? 0}`}
                  description="加油超量检测前置条件"
                  icon={Settings2}
                />
                <MetricCard
                  title="待整改风险"
                  value={pendingRectifications.length}
                  description="可分配责任人与期限"
                  icon={ShieldCheck}
                />
                <MetricCard
                  title="逾期升级"
                  value={
                    riskRuleForm.overdueEscalationEnabled
                      ? `每日 ${riskRuleForm.overdueEscalationHourChina.padStart(2, "0")}:00`
                      : "未启用"
                  }
                  description="中国标准时间"
                  icon={ScrollText}
                />
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                <div className="grid gap-3 md:grid-cols-[1fr_160px_auto]">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="risk-overdue-escalation"
                      checked={riskRuleForm.overdueEscalationEnabled}
                      onCheckedChange={checked =>
                        setRiskRuleForm(current => ({
                          ...current,
                          overdueEscalationEnabled: checked === true,
                        }))
                      }
                    />
                    <Label htmlFor="risk-overdue-escalation">
                      启用每日整改逾期升级
                    </Label>
                  </div>
                  <Field label="检查时间（中国标准时间）">
                    <Input
                      type="number"
                      min="0"
                      max="23"
                      step="1"
                      value={riskRuleForm.overdueEscalationHourChina}
                      onChange={event =>
                        setRiskRuleForm(current => ({
                          ...current,
                          overdueEscalationHourChina: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button
                      className="w-full"
                      variant="outline"
                      disabled={saveRiskRule.isPending}
                      onClick={validateRule}
                    >
                      保存升级计划
                    </Button>
                  </div>
                </div>
                <p className="mt-2 text-xs text-amber-900">
                  任务由平台 Heartbeat
                  运行，支持重试与同日去重；停用后会暂停该项目调度，不会删除历史整改和升级审计。
                </p>
              </div>
              {riskCapacityReadiness.data?.unconfiguredAssets.length ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3">
                  <p className="text-sm font-semibold text-rose-900">
                    以下资源尚未维护核定油箱容量，柴油超量检测会跳过：
                  </p>
                  <p className="mt-1 text-sm text-rose-800">
                    {riskCapacityReadiness.data.unconfiguredAssets
                      .map(
                        item =>
                          `${item.assetType === "vehicle" ? "车辆" : "机械"}·${item.label}`
                      )
                      .join("；")}
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-emerald-800">
                  车辆与机械核定油箱容量均已配置，可参与柴油加油量合理性检测。
                </div>
              )}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      整改派单
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      仅可选择当前项目范围内的有效管理人员；到期未解决将按已保存的升级计划提醒责任人与管理岗位。
                    </p>
                  </div>
                </div>
                {pendingRectifications.length ? (
                  <div className="mt-3 grid gap-2 lg:grid-cols-2">
                    {pendingRectifications.map(item => (
                      <div
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"
                        key={item.id}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-800">
                            {item.title}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            状态：
                            {item.status === "in_rectification"
                              ? "整改中"
                              : item.status === "acknowledged"
                                ? "已确认"
                                : "待处置"}
                            {item.dueAt
                              ? ` · 期限 ${displayDate(item.dueAt)}`
                              : " · 尚未设置期限"}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setRiskRectificationTarget({
                              id: Number(item.id),
                              title: item.title,
                              assigneeUserId: item.assigneeUserId
                                ? String(item.assigneeUserId)
                                : "",
                              dueAt: item.dueAt
                                ? new Date(item.dueAt)
                                    .toISOString()
                                    .slice(0, 16)
                                : "",
                              rectificationNote: item.rectificationNote ?? "",
                            })
                          }
                        >
                          分配整改
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">
                    当前没有待派单风险。先执行真实数据扫描后再分配整改责任。
                  </p>
                )}
              </div>
              {riskRectificationTarget ? (
                <div className="rounded-xl border border-[#c9dbd6] bg-[#f5f9f8] p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[#203c48]">
                        分配整改：{riskRectificationTarget.title}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        责任人、期限和整改说明均会写入审计；期限必须晚于当前时间。
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setRiskRectificationTarget(null)}
                    >
                      取消
                    </Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <Field label="整改责任人">
                      <Select
                        value={
                          riskRectificationTarget.assigneeUserId || "UNASSIGNED"
                        }
                        onValueChange={value =>
                          setRiskRectificationTarget(current =>
                            current
                              ? {
                                  ...current,
                                  assigneeUserId:
                                    value === "UNASSIGNED" ? "" : value,
                                }
                              : current
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="选择项目管理人员" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="UNASSIGNED">
                            请选择责任人
                          </SelectItem>
                          {riskAssignees.data?.map(item => (
                            <SelectItem key={item.id} value={String(item.id)}>
                              {item.name || `管理人员 #${item.id}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="整改期限">
                      <Input
                        type="datetime-local"
                        value={riskRectificationTarget.dueAt}
                        onChange={event =>
                          setRiskRectificationTarget(current =>
                            current
                              ? { ...current, dueAt: event.target.value }
                              : current
                          )
                        }
                      />
                    </Field>
                    <Field label="整改说明">
                      <Input
                        value={riskRectificationTarget.rectificationNote}
                        placeholder="例如：核对原始记录并补齐影像"
                        onChange={event =>
                          setRiskRectificationTarget(current =>
                            current
                              ? {
                                  ...current,
                                  rectificationNote: event.target.value,
                                }
                              : current
                          )
                        }
                      />
                    </Field>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button
                      disabled={
                        !riskRectificationTarget.assigneeUserId ||
                        !riskRectificationTarget.dueAt ||
                        assignRiskRectification.isPending
                      }
                      onClick={() => {
                        if (!riskRectificationTarget) return;
                        assignRiskRectification.mutate({
                          id: riskRectificationTarget.id,
                          projectId: Number(financeProjectId),
                          assigneeUserId: Number(
                            riskRectificationTarget.assigneeUserId
                          ),
                          dueAt: new Date(
                            riskRectificationTarget.dueAt
                          ).toISOString(),
                          rectificationNote:
                            riskRectificationTarget.rectificationNote.trim() ||
                            null,
                        });
                      }}
                    >
                      {assignRiskRectification.isPending
                        ? "正在派单…"
                        : "保存责任人与整改期限"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
        <Card className="border-[#d8e3e0] shadow-sm">
          <CardHeader>
            <p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">
              AI 辅助 · 规则可解释 · 人工可处置
            </p>
            <CardTitle className="mt-1 text-base">
              AI 项目风险预警中心
            </CardTitle>
            <CardDescription className="mt-1">
              系统先以真实业务记录执行确定性规则：施工日报待办、上下班考勤缺口、加油量与核定油箱容量不符、运输里程与时长/速度不匹配。仅将授权范围内的风险计数和费用分类提交给
              AI 生成管理摘要；所有预警均可回到原始单据核验。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-[1fr_180px_180px_auto]">
            <Select
              value={financeProjectId}
              onValueChange={setFinanceProjectId}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择项目" />
              </SelectTrigger>
              <SelectContent>
                {projects.data
                  ?.filter(project => project.status !== "archived")
                  .map(project => (
                    <SelectItem key={project.id} value={String(project.id)}>
                      {project.code} · {project.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Input
              type="month"
              value={financePeriod}
              aria-label="风险统计期间"
              onChange={event => setFinancePeriod(event.target.value)}
            />
            <Input
              type="date"
              value={riskScanDate}
              aria-label="风险扫描日期"
              onChange={event => setRiskScanDate(event.target.value)}
            />
            <Button
              disabled={!financeProjectId || scanProjectRisks.isPending}
              onClick={() =>
                scanProjectRisks.mutate({
                  projectId: Number(financeProjectId),
                  businessDate: riskScanDate,
                })
              }
            >
              {scanProjectRisks.isPending ? "正在扫描…" : "立即扫描并提醒"}
            </Button>
          </CardContent>
        </Card>
        {!financeProjectId ? (
          <EmptyState text="请选择项目后配置风险阈值、扫描真实施工/考勤/柴油/运输记录，并查看本期财务分类。" />
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                title="本期未处置预警"
                value={openCount}
                description="可确认、解决或忽略"
                icon={ShieldCheck}
              />
              <MetricCard
                title="严重风险"
                value={criticalCount}
                description="请优先回到原始单据核验"
                icon={ShieldCheck}
              />
              <MetricCard
                title="本期成本"
                value={riskFinanceAnalysis.data?.expenseAmount}
                description="分类汇总的真实业务成本"
                icon={BarChart3}
              />
              <MetricCard
                title="风险扫描日期"
                value={riskScanDate}
                description="点击立即扫描生成/刷新风险清单"
                icon={ScrollText}
              />
            </div>
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
              <Card className="border-[#d8e3e0] shadow-sm">
                <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                  <div>
                    <CardTitle className="text-base">风险检测阈值</CardTitle>
                    <CardDescription>
                      阈值按项目独立保存。未维护核定油箱容量的车辆/机械不会产生“加油超量”结论，需先补全档案。
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id="risk-enabled"
                      checked={riskRuleForm.enabled}
                      onCheckedChange={checked =>
                        setRiskRuleForm(current => ({
                          ...current,
                          enabled: checked === true,
                        }))
                      }
                    />
                    <Label htmlFor="risk-enabled">启用扫描</Label>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="单次加油最大容量比例">
                      <Input
                        type="number"
                        min="1"
                        max="3"
                        step="0.01"
                        value={riskRuleForm.maxFuelFillRatio}
                        onChange={event =>
                          setRiskRuleForm(current => ({
                            ...current,
                            maxFuelFillRatio: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="运输最大平均速度（km/h）">
                      <Input
                        type="number"
                        min="20"
                        max="180"
                        step="1"
                        value={riskRuleForm.maxTransportSpeedKmh}
                        onChange={event =>
                          setRiskRuleForm(current => ({
                            ...current,
                            maxTransportSpeedKmh: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="运输最长合理耗时（分钟）">
                      <Input
                        type="number"
                        min="15"
                        max="1440"
                        step="1"
                        value={riskRuleForm.maxTransportDurationMinutes}
                        onChange={event =>
                          setRiskRuleForm(current => ({
                            ...current,
                            maxTransportDurationMinutes: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="上班未下班打卡阈值（小时）">
                      <Input
                        type="number"
                        min="2"
                        max="72"
                        step="1"
                        value={riskRuleForm.maxOpenCheckInHours}
                        onChange={event =>
                          setRiskRuleForm(current => ({
                            ...current,
                            maxOpenCheckInHours: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="日报待办阈值（小时）">
                      <Input
                        type="number"
                        min="1"
                        max="720"
                        step="1"
                        value={riskRuleForm.maxPendingReportHours}
                        onChange={event =>
                          setRiskRuleForm(current => ({
                            ...current,
                            maxPendingReportHours: event.target.value,
                          }))
                        }
                      />
                    </Field>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      disabled={saveRiskRule.isPending}
                      onClick={validateRule}
                    >
                      {saveRiskRule.isPending
                        ? "正在保存…"
                        : "保存项目风险阈值"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-[#d8e3e0] shadow-sm">
                <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                  <div>
                    <CardTitle className="text-base">财务分类成本</CardTitle>
                    <CardDescription>
                      以已登记的财务流水、柴油、工资、机械成本和维修保养为准，避免用
                      AI 推测成本。
                    </CardDescription>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!riskFinanceAnalysis.data?.categories.length}
                    onClick={() =>
                      downloadCsvFile(
                        `项目成本分类-${financePeriod}.csv`,
                        ["类别", "金额", "占比", "笔数", "来源"],
                        (riskFinanceAnalysis.data?.categories ?? []).map(
                          item => [
                            item.label,
                            item.amount,
                            `${item.percentage}%`,
                            item.recordCount,
                            item.sources.join("、"),
                          ]
                        )
                      )
                    }
                  >
                    导出
                  </Button>
                </CardHeader>
                <CardContent>
                  {riskFinanceAnalysis.data?.categories.length ? (
                    <div className="space-y-2">
                      {riskFinanceAnalysis.data.categories.map(item => (
                        <div
                          className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                          key={item.code}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-slate-800">
                              {item.label}
                            </p>
                            <p className="text-sm font-semibold text-[#203c48]">
                              ¥{displayMoney(item.amount)}
                            </p>
                          </div>
                          <div className="mt-1 flex justify-between text-xs text-slate-500">
                            <span>
                              {item.percentage}% · {item.recordCount} 笔
                            </span>
                            <span>{item.sources.join("、")}</span>
                          </div>
                        </div>
                      ))}
                      <div className="flex justify-between border-t pt-3 text-sm font-semibold">
                        <span>本期分类成本</span>
                        <span>
                          ¥
                          {displayMoney(riskFinanceAnalysis.data.expenseAmount)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">
                      当前期间暂无可分类的真实成本记录。
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
            <Card className="border-[#d8e3e0] shadow-sm">
              <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-base">
                    风险预警台账与管理提醒
                  </CardTitle>
                  <CardDescription>
                    新发现的预警会按项目范围向有效项目主管、财务、施工、运输和安全管理人员发送幂等站内提醒；同一单据同一规则同一日期不会重复创建。
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Select
                    value={riskAlertStatus}
                    onValueChange={value =>
                      setRiskAlertStatus(value as typeof riskAlertStatus)
                    }
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部状态</SelectItem>
                      <SelectItem value="open">待处置</SelectItem>
                      <SelectItem value="acknowledged">已确认</SelectItem>
                      <SelectItem value="resolved">已解决</SelectItem>
                      <SelectItem value="ignored">已忽略</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => riskAlerts.refetch()}
                  >
                    刷新
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!alerts.length}
                    onClick={() =>
                      downloadCsvFile(
                        `项目风险预警-${financePeriod}.csv`,
                        ["日期", "类别", "等级", "规则", "预警内容", "状态"],
                        alerts.map(item => [
                          toBusinessDateInput(item.businessDate),
                          displayRiskAlertCategory(item.category),
                          displayRiskAlertSeverity(item.severity),
                          item.ruleCode,
                          item.summary,
                          displayRiskAlertStatus(item.status),
                        ])
                      )
                    }
                  >
                    导出
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {riskAlerts.isLoading ? (
                  <EmptyState text="正在读取风险预警…" />
                ) : alerts.length ? (
                  <div className="overflow-x-auto rounded-xl border border-[#e1e8e4]">
                    <Table className="min-w-[1040px] text-xs">
                      <TableHeader className="bg-[#edf1ed]">
                        <TableRow>
                          <TableHead>业务日期</TableHead>
                          <TableHead>类别 / 等级</TableHead>
                          <TableHead>预警内容</TableHead>
                          <TableHead>计算规则</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead className="text-right">处置</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {alerts.map(item => (
                          <TableRow key={item.id}>
                            <TableCell>
                              {toBusinessDateInput(item.businessDate)}
                            </TableCell>
                            <TableCell>
                              <p>{displayRiskAlertCategory(item.category)}</p>
                              <p
                                className={
                                  item.severity === "critical"
                                    ? "mt-1 font-medium text-rose-700"
                                    : item.severity === "warning"
                                      ? "mt-1 font-medium text-amber-700"
                                      : "mt-1 text-slate-500"
                                }
                              >
                                {displayRiskAlertSeverity(item.severity)}
                              </p>
                            </TableCell>
                            <TableCell className="max-w-xl whitespace-normal">
                              <p className="font-medium text-slate-800">
                                {item.title}
                              </p>
                              <p className="mt-1 text-slate-600">
                                {item.summary}
                              </p>
                            </TableCell>
                            <TableCell>{item.ruleCode}</TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {displayRiskAlertStatus(item.status)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {["open", "acknowledged"].includes(
                                item.status
                              ) ? (
                                <div className="flex justify-end gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={updateRiskAlertStatus.isPending}
                                    onClick={() =>
                                      updateRiskAlertStatus.mutate({
                                        id: Number(item.id),
                                        projectId: Number(financeProjectId),
                                        status: "acknowledged",
                                        resolutionNote: null,
                                      })
                                    }
                                  >
                                    确认
                                  </Button>
                                  <Button
                                    size="sm"
                                    disabled={updateRiskAlertStatus.isPending}
                                    onClick={() =>
                                      updateRiskAlertStatus.mutate({
                                        id: Number(item.id),
                                        projectId: Number(financeProjectId),
                                        status: "resolved",
                                        resolutionNote: "已由管理人员核验处理",
                                      })
                                    }
                                  >
                                    解决
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={updateRiskAlertStatus.isPending}
                                    onClick={() =>
                                      updateRiskAlertStatus.mutate({
                                        id: Number(item.id),
                                        projectId: Number(financeProjectId),
                                        status: "ignored",
                                        resolutionNote:
                                          "经管理人员核验不构成异常",
                                      })
                                    }
                                  >
                                    忽略
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-slate-500">
                                  已完成处置
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <EmptyState text="当前期间暂无风险预警。请点击“立即扫描并提醒”对选定日期的真实业务记录执行检测。" />
                )}
              </CardContent>
            </Card>
            <Card className="border-[#d8e3e0] shadow-sm">
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="text-base">AI 管理摘要</CardTitle>
                  <CardDescription>
                    AI
                    仅读取本期风险类别/等级/状态的计数与财务分类金额，不读取姓名、手机号、定位、车牌、影像或凭证内容。摘要仅作辅助管理判断。
                  </CardDescription>
                </div>
                <Button
                  disabled={generateRiskBriefing.isPending}
                  onClick={() =>
                    generateRiskBriefing.mutate({
                      projectId: Number(financeProjectId),
                      period: financePeriod,
                    })
                  }
                >
                  {generateRiskBriefing.isPending
                    ? "正在分析…"
                    : "生成 AI 管理摘要"}
                </Button>
              </CardHeader>
              <CardContent>
                {riskBriefing ? (
                  <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-indigo-950">
                        {riskBriefing.source === "external"
                          ? "外部 AI 辅助摘要"
                          : riskBriefing.source === "builtin"
                            ? "系统内置 AI 辅助摘要"
                            : "规则汇总摘要（AI 服务降级）"}
                      </p>
                      <Badge variant="outline">{riskBriefing.model}</Badge>
                    </div>
                    <p className="text-sm leading-6 text-slate-700">
                      {riskBriefing.executiveSummary}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-xs font-semibold text-slate-600">
                          优先处理
                        </p>
                        <ul className="mt-1 space-y-1 text-sm text-slate-700">
                          {riskBriefing.priorityActions.map(item => (
                            <li key={item}>· {item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-600">
                          持续关注
                        </p>
                        <ul className="mt-1 space-y-1 text-sm text-slate-700">
                          {riskBriefing.watchItems.map(item => (
                            <li key={item}>· {item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500">
                      {riskBriefing.disclaimer}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">
                    生成后将展示本期风险与成本结构的管理摘要。系统不会让 AI
                    替代现场核验、财务审核或责任认定。
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    );
  };

  const renderBroadcast = () => {
    const scopeOptions =
      broadcastForm.audienceType === "project"
        ? (broadcastOptions.data?.projects ?? []).map(item => ({
            value: String(item.id),
            label: `${item.code} · ${item.name}`,
          }))
        : broadcastForm.audienceType === "organization"
          ? (broadcastOptions.data?.organizations ?? []).map(item => ({
              value: String(item.id),
              label: `${item.code} · ${item.name}`,
            }))
          : (broadcastOptions.data?.roles ?? []).map(item => ({
              value: item.code,
              label: `${item.code} · ${item.name}`,
            }));
    const scopeTitle =
      broadcastForm.audienceType === "project"
        ? "收件项目"
        : broadcastForm.audienceType === "organization"
          ? "收件组织"
          : "收件岗位";
    const describeScope = (
      item: NonNullable<typeof broadcasts.data>[number]
    ) =>
      item.audienceType === "project"
        ? ((broadcastOptions.data?.projects ?? []).find(
            project => project.id === item.projectId
          )?.name ?? "项目范围")
        : item.audienceType === "organization"
          ? ((broadcastOptions.data?.organizations ?? []).find(
              organization => organization.id === item.organizationId
            )?.name ?? "组织范围")
          : ((broadcastOptions.data?.roles ?? []).find(
              role => role.code === item.roleCode
            )?.name ?? "岗位范围");
    const directSendable = (status: string) =>
      ["draft", "rejected", "submitted", "approved"].includes(status);
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-[#203c48]">
              范围通知与确认中心
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              范围内站内通知
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-500">
              获授权管理员选择单一项目、组织或岗位范围后，可直接向系统消息中心发送通知。此功能不发送微信服务号消息；微信服务号仅用于具体业务事件的合规即时提醒。
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setBroadcastForm(EMPTY_BROADCAST_FORM);
              setSelectedBroadcastId(undefined);
            }}
          >
            新建通知
          </Button>
        </div>
        <Card className="border-[#d8e3e0]">
          <CardHeader>
            <CardTitle className="text-base">站内通知内容与发送范围</CardTitle>
            <CardDescription>
              保存后即向当前授权范围的系统消息中心投递，并可要求收件人“确认收到”。本页的成功数量不代表微信服务号已送达。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <Label>通知标题</Label>
                <Input
                  className="mt-1"
                  value={broadcastForm.title}
                  maxLength={80}
                  placeholder="例如：本周施工计划调整通知"
                  onChange={event =>
                    setBroadcastForm(current => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label>系统跳转地址（可选）</Label>
                <Input
                  className="mt-1"
                  value={broadcastForm.deepLink}
                  placeholder="/mobile/messages"
                  onChange={event =>
                    setBroadcastForm(current => ({
                      ...current,
                      deepLink: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div>
              <Label>通知内容</Label>
              <textarea
                className="mt-1 min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                value={broadcastForm.content}
                maxLength={1000}
                placeholder="请填写不含身份证、银行卡、完整电话号码或其他敏感个人信息的业务通知。"
                onChange={event =>
                  setBroadcastForm(current => ({
                    ...current,
                    content: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <Label>范围类型</Label>
                <Select
                  value={broadcastForm.audienceType}
                  onValueChange={value =>
                    setBroadcastForm(current => ({
                      ...current,
                      audienceType: value as BroadcastAudienceType,
                      scopeValue: "",
                    }))
                  }
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="project">按项目</SelectItem>
                    <SelectItem value="organization">
                      按组织及下级组织
                    </SelectItem>
                    <SelectItem value="role">按岗位</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{scopeTitle}</Label>
                <Select
                  value={broadcastForm.scopeValue || undefined}
                  onValueChange={value =>
                    setBroadcastForm(current => ({
                      ...current,
                      scopeValue: value,
                    }))
                  }
                  disabled={broadcastOptions.isLoading || !scopeOptions.length}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue
                      placeholder={
                        broadcastOptions.isLoading
                          ? "正在读取范围选项…"
                          : `选择${scopeTitle}`
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {scopeOptions.map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-slate-500">范围内有效人员</p>
                <p className="mt-1 text-xl font-semibold text-slate-800">
                  {validBroadcastScope
                    ? (broadcastAudiencePreview.data?.qualifiedCount ?? "—")
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">已绑定服务号</p>
                <p className="mt-1 text-xl font-semibold text-emerald-700">
                  {validBroadcastScope
                    ? (broadcastAudiencePreview.data?.boundRecipientCount ??
                      "—")
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">未绑定服务号</p>
                <p className="mt-1 text-xl font-semibold text-amber-700">
                  {validBroadcastScope
                    ? (broadcastAudiencePreview.data?.unboundCount ?? "—")
                    : "—"}
                </p>
              </div>
            </div>
            {broadcastAudiencePreview.isError ? (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
                范围预览失败：
                {getUserFacingErrorMessage(
                  broadcastAudiencePreview.error,
                  "暂无法预览发送范围，请稍后重试"
                )}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setBroadcastForm(EMPTY_BROADCAST_FORM)}
              >
                清空
              </Button>
              <Button
                className="bg-[#203c48] hover:bg-[#17313b]"
                disabled={
                  !broadcastForm.title.trim() ||
                  !broadcastForm.content.trim() ||
                  !validBroadcastScope ||
                  saveBroadcastDraft.isPending ||
                  publishBroadcast.isPending
                }
                onClick={() =>
                  saveBroadcastDraft.mutate({
                    id: broadcastForm.id,
                    title: broadcastForm.title.trim(),
                    content: broadcastForm.content.trim(),
                    deepLink: broadcastForm.deepLink.trim() || null,
                    ...getBroadcastAudienceInput(broadcastForm),
                  })
                }
              >
                {saveBroadcastDraft.isPending || publishBroadcast.isPending
                  ? "正在发送…"
                  : "保存并发送站内通知"}
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card className="w-full border-[#d8e3e0] shadow-sm">
          <CardHeader>
            <p className="text-xs font-semibold tracking-[0.12em] text-[#467067]">
              范围通知 · 综合台账
            </p>
            <CardTitle className="mt-1 text-base">
              站内通知、投递与确认台账
            </CardTitle>
            <CardDescription className="mt-1">
              每条通知行内展示发送范围、计划收件、送达、失败与确认数量；投递明细在同一行下方展开，不再另设重复通知列表。微信服务号业务事件不在本表重复计入。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {broadcasts.isLoading ? (
              <EmptyState text="正在读取范围通知台账…" />
            ) : broadcasts.isError ? (
              <EmptyState text="无法读取范围通知台账，请确认当前账号具有超级管理员权限。" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[#e1e8e4]">
                <Table className="min-w-[1280px] text-xs">
                  <TableHeader className="bg-[#edf1ed]">
                    <TableRow className="border-[#dce3de] hover:bg-[#edf1ed]">
                      <TableHead className="h-11 px-4 font-semibold text-[#46615a]">
                        通知 / 内容
                      </TableHead>
                      <TableHead className="h-11 px-4 font-semibold text-[#46615a]">
                        发送范围
                      </TableHead>
                      <TableHead className="h-11 px-4 font-semibold text-[#46615a]">
                        计划收件
                      </TableHead>
                      <TableHead className="h-11 px-4 font-semibold text-[#46615a]">
                        已送达
                      </TableHead>
                      <TableHead className="h-11 px-4 font-semibold text-[#46615a]">
                        失败 / 跳过
                      </TableHead>
                      <TableHead className="h-11 px-4 font-semibold text-[#46615a]">
                        已确认
                      </TableHead>
                      <TableHead className="h-11 px-4 font-semibold text-[#46615a]">
                        状态
                      </TableHead>
                      <TableHead className="h-11 px-4 font-semibold text-[#46615a]">
                        创建时间
                      </TableHead>
                      <TableHead className="h-11 px-4 text-right font-semibold text-[#46615a]">
                        操作
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {broadcasts.data?.length ? (
                      broadcasts.data.map(item => {
                        const isExpanded = isInlineBroadcastDeliveryExpanded(
                          selectedBroadcastId,
                          Number(item.id)
                        );
                        return (
                          <>
                            <TableRow
                              key={item.id}
                              className={
                                isExpanded
                                  ? "border-[#c9dbd6] bg-[#f5f9f8]"
                                  : "border-[#edf0ee] hover:bg-[#fbfaf1]"
                              }
                            >
                              <TableCell className="max-w-[300px] px-4 py-3">
                                <p className="font-semibold text-[#203c48]">
                                  {item.title}
                                </p>
                                <p className="mt-1 line-clamp-2 text-slate-500">
                                  {item.content}
                                </p>
                              </TableCell>
                              <TableCell className="px-4 py-3 text-slate-700">
                                {describeScope(item)}
                              </TableCell>
                              <TableCell className="px-4 py-3 text-slate-700">
                                {item.recipientCount}
                              </TableCell>
                              <TableCell className="px-4 py-3 text-emerald-700">
                                {item.deliveredCount}
                              </TableCell>
                              <TableCell className="px-4 py-3">
                                <p className="text-rose-700">
                                  失败 {item.failedCount}
                                </p>
                                <p className="mt-1 text-amber-700">
                                  跳过 {item.skippedCount}
                                </p>
                              </TableCell>
                              <TableCell className="px-4 py-3 text-[#80543d]">
                                {item.acknowledgedCount ?? 0}
                              </TableCell>
                              <TableCell className="px-4 py-3">
                                <BusinessStatusBadge status={item.status} />
                              </TableCell>
                              <TableCell className="px-4 py-3 text-slate-700">
                                {displayDate(item.createdAt)}
                              </TableCell>
                              <TableCell className="px-4 py-3 text-right">
                                <div className="flex justify-end gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      setSelectedBroadcastId(
                                        isExpanded ? undefined : Number(item.id)
                                      )
                                    }
                                  >
                                    {isExpanded ? "收起明细" : "投递明细"}
                                  </Button>
                                  {directSendable(item.status) ? (
                                    <Button
                                      size="sm"
                                      className="bg-[#8b3f20] hover:bg-[#6d3421]"
                                      onClick={() =>
                                        publishBroadcast.mutate({
                                          id: Number(item.id),
                                        })
                                      }
                                      disabled={publishBroadcast.isPending}
                                    >
                                      按范围发送
                                    </Button>
                                  ) : null}
                                </div>
                              </TableCell>
                            </TableRow>
                            {isExpanded ? (
                              <TableRow
                                key={`${item.id}-deliveries`}
                                className="border-[#c9dbd6] bg-[#f8fbf8]"
                              >
                                <TableCell colSpan={9} className="px-4 py-4">
                                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                      <p className="text-sm font-semibold text-slate-800">
                                        投递明细与确认状态
                                      </p>
                                      <p className="mt-1 text-xs text-slate-500">
                                        显示姓名、岗位、授权范围、投递结果、失败原因和“收到”确认时间；不展示内部编号或敏感身份信息。
                                      </p>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        broadcastDeliveries.refetch()
                                      }
                                      disabled={broadcastDeliveries.isFetching}
                                    >
                                      {broadcastDeliveries.isFetching
                                        ? "正在刷新…"
                                        : "刷新明细"}
                                    </Button>
                                  </div>
                                  {broadcastDeliveries.isLoading ? (
                                    <EmptyState text="正在读取投递明细…" />
                                  ) : broadcastDeliveries.data?.length ? (
                                    <div className="grid gap-2 lg:grid-cols-2">
                                      {broadcastDeliveries.data.map(
                                        delivery => (
                                          <div
                                            key={delivery.id}
                                            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
                                          >
                                            <div className="min-w-0">
                                              <p className="text-sm font-medium text-slate-800">
                                                {delivery.recipientName}
                                              </p>
                                              <p className="mt-1 text-xs text-slate-600">
                                                {delivery.recipientRole ??
                                                  "岗位信息待同步"}{" "}
                                                ·{" "}
                                                {delivery.recipientScope ??
                                                  "授权范围待同步"}
                                              </p>
                                              <p className="mt-1 text-xs text-slate-500">
                                                最近尝试：
                                                {displayDate(
                                                  delivery.attemptedAt
                                                )}
                                                {delivery.deliveryReason
                                                  ? ` · 原因：${delivery.deliveryReason}`
                                                  : ""}
                                              </p>
                                              {delivery.failureGuidance ? (
                                                <p className="mt-1 text-xs text-amber-800">
                                                  处理建议：
                                                  {delivery.failureGuidance}
                                                </p>
                                              ) : null}
                                              <p className="mt-1 text-xs text-[#80543d]">
                                                确认状态：
                                                {delivery.acknowledgementStatus ===
                                                "acknowledged"
                                                  ? `已确认收到（${displayDate(delivery.acknowledgedAt)}）`
                                                  : delivery.acknowledgementStatus ===
                                                      "pending"
                                                    ? "待确认收到"
                                                    : "无需确认"}
                                              </p>
                                            </div>
                                            <BusinessStatusBadge
                                              status={delivery.deliveryStatus}
                                            />
                                          </div>
                                        )
                                      )}
                                    </div>
                                  ) : (
                                    <EmptyState text="该通知尚未生成逐收件人投递记录。" />
                                  )}
                                </TableCell>
                              </TableRow>
                            ) : null}
                          </>
                        );
                      })
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={9}
                          className="px-4 py-10 text-center text-slate-500"
                        >
                          尚无范围通知记录。填写通知内容并选择范围后可发送站内通知。
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  const content =
    activeSection === "organization" ? (
      renderOrganization()
    ) : activeSection === "vehicles" ? (
      renderVehicles()
    ) : activeSection === "construction" ? (
      renderConstruction()
    ) : activeSection === "labor" ? (
      renderLabor()
    ) : activeSection === "machinery" ? (
      renderMachinery()
    ) : activeSection === "transport" ? (
      renderTransport()
    ) : activeSection === "purchasing" ? (
      renderPurchasing()
    ) : activeSection === "evidence" ? (
      <EvidenceWorkspace mode="pc" onDirtyChange={onEvidenceDirtyChange} />
    ) : activeSection === "measurement-tools" ? (
      <AdminMeasurementToolsPanel />
    ) : activeSection === "subcontract" ? (
      renderSubcontract()
    ) : activeSection === "contracts" ? (
      <ContractManagementPanel
        projects={(projects.data ?? []).map(project => ({
          id: project.id,
          name: project.name,
        }))}
      />
    ) : activeSection === "permission" ? (
      renderPermissions()
    ) : activeSection === "administrators" && !scopedSection ? (
      <Suspense fallback={<EmptyState text="正在读取管理员管理…" />}>
        <AdministratorManagement
          currentUserId={user?.id ?? 0}
          canChangeOwnPassword={user?.loginMethod === "local_manager"}
          onDirtyChange={onAdministratorManagementDirtyChange}
        />
      </Suspense>
    ) : activeSection === "risk" ? (
      renderRisk()
    ) : activeSection === "finance" || activeSection === "diesel" ? (
      renderFinance()
    ) : activeSection === "broadcast" ? (
      renderBroadcast()
    ) : activeSection === "wechat-login" ? (
      renderWechatLogin()
    ) : activeSection === "business" ? (
      renderBusiness()
    ) : activeSection === "settings" ? (
      renderSettings()
    ) : activeSection === "audit" ? (
      renderAudit()
    ) : (
      renderOverview()
    );

  return (
    <DashboardLayout
      title={
        scopedSection ? "悦信云智管 · 统一业务工作区" : "悦信云智管 · 管理后台"
      }
      menuItems={scopedMenuItems}
      accessLabel={
        scopedSection ? "PC 业务管理 · 已授权" : "PC 超级治理 · 已授权"
      }
      fallbackSectionLabel={scopedSection ? "业务工作台" : "系统治理"}
      onBeforeNavigate={() =>
        !hasWorkspaceDraft ||
        window.confirm(
          "有尚未保存的业务资料，离开当前模块将放弃未保存内容。确认离开吗？"
        )
      }
    >
      <div className="mx-auto max-w-7xl space-y-6 py-3">
        {!scopedSection ? (
          <Tabs
            value={activeSection}
            onValueChange={value =>
              setLocation(value === "overview" ? "/admin" : `/admin/${value}`)
            }
            className="lg:hidden"
          >
            <TabsList
              aria-label="超级管理后台业务菜单"
              className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-[#dce3de] bg-[#f8f8f4] p-1 shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <TabsTrigger
                className="h-10 shrink-0 whitespace-nowrap px-3 text-xs"
                value="overview"
              >
                概览
              </TabsTrigger>
              <TabsTrigger
                className="h-10 shrink-0 whitespace-nowrap px-3 text-xs"
                value="organization"
              >
                组织
              </TabsTrigger>
              <TabsTrigger
                className="h-10 shrink-0 whitespace-nowrap px-3 text-xs"
                value="vehicles"
              >
                车辆
              </TabsTrigger>
              <TabsTrigger
                className="h-10 shrink-0 whitespace-nowrap px-3 text-xs"
                value="construction"
              >
                施工
              </TabsTrigger>
              <TabsTrigger
                className="h-10 shrink-0 whitespace-nowrap px-3 text-xs"
                value="labor"
              >
                劳务
              </TabsTrigger>
              <TabsTrigger
                className="h-10 shrink-0 whitespace-nowrap px-3 text-xs"
                value="machinery"
              >
                机械
              </TabsTrigger>
              <TabsTrigger
                className="h-10 shrink-0 whitespace-nowrap px-3 text-xs"
                value="transport"
              >
                运输
              </TabsTrigger>
              <TabsTrigger
                className="h-10 shrink-0 whitespace-nowrap px-3 text-xs"
                value="permission"
              >
                权限
              </TabsTrigger>
              <TabsTrigger
                className="h-10 shrink-0 whitespace-nowrap px-3 text-xs"
                value="finance"
              >
                财务
              </TabsTrigger>
              <TabsTrigger
                className="h-10 shrink-0 whitespace-nowrap px-3 text-xs"
                value="subcontract"
              >
                分包
              </TabsTrigger>
              <TabsTrigger
                className="h-10 shrink-0 whitespace-nowrap px-3 text-xs"
                value="risk"
              >
                AI 风控
              </TabsTrigger>
              <TabsTrigger
                className="h-10 shrink-0 whitespace-nowrap px-3 text-xs"
                value="broadcast"
              >
                群发
              </TabsTrigger>
              <TabsTrigger
                className="h-10 shrink-0 whitespace-nowrap px-3 text-xs"
                value="wechat-login"
              >
                微信登录
              </TabsTrigger>
              <TabsTrigger
                className="h-10 shrink-0 whitespace-nowrap px-3 text-xs"
                value="business"
              >
                业务治理
              </TabsTrigger>
              <TabsTrigger
                className="h-10 shrink-0 whitespace-nowrap px-3 text-xs"
                value="settings"
              >
                设置
              </TabsTrigger>
              <TabsTrigger
                className="h-10 shrink-0 whitespace-nowrap px-3 text-xs"
                value="audit"
              >
                审计
              </TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
        {activeSection !== "overview" ? <DuplicateEntryNotice /> : null}
        <Suspense
          fallback={
            <Card className="border-[#d8e3e0] bg-[#f8fcfb]">
              <CardContent className="p-6 text-sm text-slate-600">
                正在加载当前管理工作区…
              </CardContent>
            </Card>
          }
        >
          {content}
          {activeSection === "transport" &&
          transportWorkspaceTab === "terminals" &&
          workspaceProjectId ? (
            <RfidLocalWriterPanel
              projectId={workspaceProjectId}
              onUidRead={uid => {
                const activeWriter = (rfidWriterDevices.data ?? []).find(
                  device => device.status === "active"
                );
                const defaultVehicle = transportVehicleLedger.data?.[0];
                setRfidPendingUid(uid);
                setRfidCardForm({
                  ...EMPTY_RFID_CARD_FORM,
                  vehicleId: defaultVehicle ? String(defaultVehicle.id) : "",
                  writerDeviceId: activeWriter ? String(activeWriter.id) : "",
                  cardUid: uid,
                  driverPhone: defaultVehicle?.driverPhone || "",
                });
                setRfidCardDialogOpen(true);
              }}
            />
          ) : null}
        </Suspense>
        <AlertDialog
          open={Boolean(masterDataDeleteTarget)}
          onOpenChange={open => {
            if (!open) setMasterDataDeleteTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {masterDataDeleteTarget?.resource === "role_assignment"
                  ? "确认撤销角色授权？"
                  : "确认删除主数据？"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {masterDataDeleteTarget?.description ??
                  "系统将在服务端校验关联业务数据。仍被引用的记录将被拒绝删除，并提示改为停用或归档。"}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={removeMasterData.isPending}>
                取消
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-rose-700 hover:bg-rose-800"
                disabled={!masterDataDeleteTarget || removeMasterData.isPending}
                onClick={() => {
                  if (masterDataDeleteTarget)
                    removeMasterData.mutate({
                      resource: masterDataDeleteTarget.resource,
                      id: masterDataDeleteTarget.id,
                    });
                }}
              >
                {masterDataDeleteTarget?.resource === "role_assignment"
                  ? "确认撤销"
                  : "确认删除"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Dialog
          open={Boolean(desktopRecordDetail)}
          onOpenChange={open => {
            if (!open) setDesktopRecordDetail(null);
          }}
        >
          <DialogContent
            className={
              desktopRecordDetail?.title.startsWith("单车收益支出分析")
                ? "flex h-[min(92vh,920px)] w-[calc(100vw-2rem)] max-w-[1320px] flex-col overflow-hidden p-0 sm:max-w-[1320px]"
                : "max-h-[88vh] w-[calc(100vw-3rem)] max-w-5xl overflow-y-auto xl:max-w-6xl"
            }
          >
            <DialogHeader
              className={
                desktopRecordDetail?.title.startsWith("单车收益支出分析")
                  ? "shrink-0 border-b border-slate-200 px-6 py-5"
                  : undefined
              }
            >
              <DialogTitle>{desktopRecordDetail?.title}</DialogTitle>
              <DialogDescription>
                {desktopRecordDetail?.description}
              </DialogDescription>
            </DialogHeader>
            {desktopRecordDetail?.title.startsWith("单车收益支出分析") ? (
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <dl className="grid content-start gap-4 md:grid-cols-3 xl:grid-cols-4">
                  {desktopRecordDetail.fields.map(field => {
                    const isDetailTable =
                      field.label === "按月汇总" || field.label === "按日明细";
                    return (
                      <div
                        key={field.label}
                        className={
                          isDetailTable
                            ? "overflow-hidden rounded-xl border border-slate-200 bg-white md:col-span-3 xl:col-span-4"
                            : "rounded-xl border border-slate-100 bg-slate-50 p-4"
                        }
                      >
                        <dt
                          className={
                            isDetailTable
                              ? "px-4 pt-3 text-xs font-medium text-slate-600"
                              : "text-xs text-slate-500"
                          }
                        >
                          {field.label}
                        </dt>
                        <dd
                          className={
                            isDetailTable
                              ? "mt-2 text-sm font-medium text-slate-800"
                              : "mt-1 text-sm font-medium text-slate-800"
                          }
                        >
                          {field.value}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
                {desktopRecordDetail.note ? (
                  <p className="mt-4 rounded-xl bg-amber-50 p-4 text-xs leading-5 text-amber-800">
                    {desktopRecordDetail.note}
                  </p>
                ) : null}
              </div>
            ) : (
              <>
                <dl className="grid gap-3 py-2 sm:grid-cols-2">
                  {desktopRecordDetail?.fields.map(field => (
                    <div
                      key={field.label}
                      className="rounded-lg border border-slate-100 bg-slate-50 p-3"
                    >
                      <dt className="text-xs text-slate-500">{field.label}</dt>
                      <dd className="mt-1 text-sm font-medium text-slate-800">
                        {field.value}
                      </dd>
                    </div>
                  ))}
                </dl>
                {desktopRecordDetail?.note ? (
                  <p className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                    {desktopRecordDetail.note}
                  </p>
                ) : null}
              </>
            )}
            <DialogFooter
              className={
                desktopRecordDetail?.title.startsWith("单车收益支出分析")
                  ? "shrink-0 border-t border-slate-200 bg-white px-6 py-4"
                  : undefined
              }
            >
              {desktopRecordDetail?.onPrint ? (
                <Button variant="outline" onClick={desktopRecordDetail.onPrint}>
                  <Printer className="mr-1.5 h-4 w-4" />
                  打印详单
                </Button>
              ) : null}
              <Button onClick={() => setDesktopRecordDetail(null)}>关闭</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={machineDialogOpen}
          onOpenChange={open => {
            if (!open && !confirmMachineryFormClose()) return;
            if (!open) {
              setMachineDialogOpen(false);
              setMachineForm(EMPTY_MACHINE_FORM);
            }
          }}
        >
          <DialogContent className="max-h-[88vh] w-[calc(100vw-3rem)] max-w-5xl xl:max-w-6xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {machineForm.id ? "维护机械档案" : "新建机械档案"}
              </DialogTitle>
              <DialogDescription>
                项目、操作员、产权/租赁、资产标识与状态均由超级管理后台受控维护；已退役机械仅改变状态，不物理删除历史成本与责任记录。
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={event => {
                event.preventDefault();
                saveMachine.mutate({
                  id: machineForm.id,
                  projectId: Number(machineForm.projectId),
                  operatorPersonId: machineForm.operatorPersonId
                    ? Number(machineForm.operatorPersonId)
                    : null,
                  operatorUserId: machineForm.operatorUserId
                    ? Number(machineForm.operatorUserId)
                    : null,
                  ownerUserId: machineForm.ownerUserId
                    ? Number(machineForm.ownerUserId)
                    : null,
                  code: machineForm.code.trim(),
                  name: machineForm.name.trim(),
                  model: machineForm.model.trim() || null,
                  ownership: machineForm.ownership,
                  supplierName: machineForm.supplierName.trim() || null,
                  plateOrAssetNo: machineForm.plateOrAssetNo.trim() || null,
                  driverName: machineForm.driverName.trim() || null,
                  driverPhone: machineForm.driverPhone.trim() || null,
                  fuelTankCapacityLiters: machineForm.fuelTankCapacityLiters
                    ? Number(machineForm.fuelTankCapacityLiters)
                    : null,
                  status: machineForm.status,
                  leaseTerms:
                    machineForm.leaseRate && machineForm.leaseStartDate
                      ? {
                          billingType: machineForm.leaseBillingType,
                          rate: Number(machineForm.leaseRate),
                          effectiveFrom: machineForm.leaseStartDate,
                          effectiveTo: machineForm.leaseEndDate || null,
                        }
                      : null,
                });
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="所属项目">
                  <Select
                    value={machineForm.projectId || "UNASSIGNED"}
                    onValueChange={value =>
                      setMachineForm(current => ({
                        ...current,
                        projectId: value === "UNASSIGNED" ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择项目" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UNASSIGNED">请选择项目</SelectItem>
                      {projects.data
                        ?.filter(project => project.status !== "archived")
                        .map(project => (
                          <SelectItem
                            key={project.id}
                            value={String(project.id)}
                          >
                            {project.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="机械状态">
                  <Select
                    value={machineForm.status}
                    onValueChange={value =>
                      setMachineForm(current => ({
                        ...current,
                        status: value as MachineStatus,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="idle">闲置</SelectItem>
                      <SelectItem value="working">作业中</SelectItem>
                      <SelectItem value="repairing">维修中</SelectItem>
                      <SelectItem value="offsite">场外</SelectItem>
                      <SelectItem value="retired">已退役</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="机械编号">
                  <Input
                    value={machineForm.code}
                    placeholder="例如 EXC-001"
                    onChange={event =>
                      setMachineForm(current => ({
                        ...current,
                        code: event.target.value.toUpperCase(),
                      }))
                    }
                  />
                </Field>
                <Field label="机械名称">
                  <Input
                    value={machineForm.name}
                    placeholder="例如 挖掘机"
                    onChange={event =>
                      setMachineForm(current => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="型号">
                  <Input
                    value={machineForm.model}
                    placeholder="可选"
                    onChange={event =>
                      setMachineForm(current => ({
                        ...current,
                        model: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="资产编号 / 车牌">
                  <Input
                    value={machineForm.plateOrAssetNo}
                    placeholder="可选"
                    onChange={event =>
                      setMachineForm(current => ({
                        ...current,
                        plateOrAssetNo: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="核定油箱容量（L）">
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={machineForm.fuelTankCapacityLiters}
                    placeholder="用于柴油合理性检测"
                    onChange={event =>
                      setMachineForm(current => ({
                        ...current,
                        fuelTankCapacityLiters: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="产权类型">
                  <Select
                    value={machineForm.ownership}
                    onValueChange={value =>
                      setMachineForm(current => ({
                        ...current,
                        ownership: value as MachineOwnership,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="owned">自有</SelectItem>
                      <SelectItem value="leased">外租</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="供应商 / 出租方">
                  <Input
                    value={machineForm.supplierName}
                    placeholder="自有可不填"
                    onChange={event =>
                      setMachineForm(current => ({
                        ...current,
                        supplierName: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="操作员人员档案">
                  <PersonnelResourceSelect
                    projectId={Number(machineForm.projectId) || undefined}
                    role="operator"
                    value={
                      machineForm.operatorPersonId
                        ? Number(machineForm.operatorPersonId)
                        : null
                    }
                    fallbackLabel={machineForm.driverName}
                    onChange={person =>
                      setMachineForm(current => ({
                        ...current,
                        operatorPersonId: person ? String(person.id) : "",
                        operatorUserId: person?.userId
                          ? String(person.userId)
                          : "",
                        driverName: person?.name ?? "",
                        driverPhone: "",
                      }))
                    }
                  />
                </Field>
                <Field label="机械老板（只读费用）">
                  <Select
                    value={machineForm.ownerUserId || "UNASSIGNED_OWNER"}
                    onValueChange={value =>
                      setMachineForm(current => ({
                        ...current,
                        ownerUserId: value === "UNASSIGNED_OWNER" ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择机械老板账号" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UNASSIGNED_OWNER">暂不绑定</SelectItem>
                      {users.data
                        ?.filter(user => user.loginMethod !== "local_driver")
                        .map(user => (
                          <SelectItem key={user.id} value={String(user.id)}>
                            {user.name || `用户 #${user.id}`}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-2 w-full"
                    onClick={() => {
                      setLocalAccountForm({
                        username: "",
                        displayName: "",
                        initialPassword: "",
                        status: "active",
                        loginMode: "mobile",
                      });
                      setMachineOwnerAccountDialogOpen(true);
                    }}
                  >
                    新增机械老板账号
                  </Button>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    老板登录后只查看绑定设备的汇总、费用明细、月结和付款账单，不能录入、审核或管理设备。
                  </p>
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="驾驶员姓名">
                  <Input
                    readOnly={Boolean(machineForm.operatorPersonId)}
                    value={machineForm.driverName}
                    maxLength={128}
                    placeholder="可选"
                    onChange={event =>
                      setMachineForm(current => ({
                        ...current,
                        driverName: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="驾驶员手机">
                  <Input
                    readOnly={Boolean(machineForm.operatorPersonId)}
                    value={machineForm.driverPhone}
                    inputMode="tel"
                    maxLength={32}
                    placeholder="加密保存，仅授权范围可见"
                    onChange={event =>
                      setMachineForm(current => ({
                        ...current,
                        driverPhone: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
              <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                <div>
                  <p className="text-sm font-semibold text-amber-950">
                    会计产值计价规则
                  </p>
                  <p className="mt-1 text-xs text-amber-800">
                    自有与外租机械均可维护固定月租、日租、小时或台班计价，供会计月度明细按真实出勤与加班核算。外租机械仍须同时填写出租方、计价和租期。
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="计费方式">
                    <Select
                      value={machineForm.leaseBillingType}
                      onValueChange={value =>
                        setMachineForm(current => ({
                          ...current,
                          leaseBillingType: value as LeaseBillingType,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly">固定月租</SelectItem>
                        <SelectItem value="daily">日租</SelectItem>
                        <SelectItem value="hourly">小时租</SelectItem>
                        <SelectItem value="shift">台班</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="固定租金 / 单价（元）">
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={machineForm.leaseRate}
                      placeholder={
                        machineForm.ownership === "leased"
                          ? "外租必填"
                          : "会计月结需要时填写"
                      }
                      onChange={event =>
                        setMachineForm(current => ({
                          ...current,
                          leaseRate: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="生效 / 起租日期">
                    <Input
                      type="date"
                      value={machineForm.leaseStartDate}
                      onChange={event =>
                        setMachineForm(current => ({
                          ...current,
                          leaseStartDate: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="截止日期">
                    <Input
                      type="date"
                      min={machineForm.leaseStartDate || undefined}
                      value={machineForm.leaseEndDate}
                      onChange={event =>
                        setMachineForm(current => ({
                          ...current,
                          leaseEndDate: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>
              </section>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (!confirmMachineryFormClose()) return;
                    setMachineDialogOpen(false);
                    setMachineForm(EMPTY_MACHINE_FORM);
                  }}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  disabled={
                    !machineForm.projectId ||
                    machineForm.code.trim().length < 2 ||
                    machineForm.name.trim().length < 2 ||
                    (machineForm.ownership === "leased" &&
                      (!machineForm.supplierName ||
                        !machineForm.leaseRate ||
                        !machineForm.leaseStartDate)) ||
                    saveMachine.isPending
                  }
                >
                  {saveMachine.isPending
                    ? "正在保存…"
                    : machineForm.id
                      ? "保存机械档案"
                      : "建立机械档案"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog
          open={machineOwnerAccountDialogOpen}
          onOpenChange={open => {
            setMachineOwnerAccountDialogOpen(open);
            if (!open) {
              setLocalAccountForm({
                username: "",
                displayName: "",
                initialPassword: "",
                status: "active",
                loginMode: "both",
              });
            }
          }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>新增机械老板账号</DialogTitle>
              <DialogDescription>
                创建后返回机械档案，在“机械老板”下拉框中选择并保存。该账号仅用于查看已绑定设备的汇总、费用明细、月结和付款账单，不自动获得任何管理权限。
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={event => {
                event.preventDefault();
                createLocalUser.mutate(localAccountForm);
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="老板手机号">
                  <Input
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    value={localAccountForm.username}
                    onChange={event =>
                      setLocalAccountForm(current => ({
                        ...current,
                        username: event.target.value,
                      }))
                    }
                    placeholder="11位大陆手机号"
                  />
                </Field>
                <Field label="老板姓名">
                  <Input
                    value={localAccountForm.displayName}
                    onChange={event =>
                      setLocalAccountForm(current => ({
                        ...current,
                        displayName: event.target.value,
                      }))
                    }
                    placeholder="请输入真实姓名或公司称呼"
                  />
                </Field>
              </div>
              <Field label="初始登录密码">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={localAccountForm.initialPassword}
                  onChange={event =>
                    setLocalAccountForm(current => ({
                      ...current,
                      initialPassword: event.target.value,
                    }))
                  }
                  placeholder="至少6位"
                />
              </Field>
              <p className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                账号创建成功后，还必须回到机械档案选择该账号并保存；未绑定设备前，老板登录只会看到“暂无名下机械”。
              </p>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setMachineOwnerAccountDialogOpen(false)}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  disabled={
                    createLocalUser.isPending ||
                    !localAccountForm.username.trim() ||
                    !localAccountForm.displayName.trim() ||
                    localAccountForm.initialPassword.length < 6
                  }
                >
                  {createLocalUser.isPending ? "正在创建…" : "创建老板账号"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog
          open={machineDailyOperationDialogOpen}
          onOpenChange={open => {
            if (!open && !confirmMachineryFormClose()) return;
            setMachineDailyOperationDialogOpen(open);
            if (!open)
              setMachineDailyOperationForm(EMPTY_MACHINE_DAILY_OPERATION_FORM);
          }}
        >
          <DialogContent className="max-h-[90vh] w-[calc(100vw-3rem)] max-w-5xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>登记机械加班</DialogTitle>
              <DialogDescription>
                填写加班小时、驾驶员和单价；金额由服务端按加班小时×单价核算，保存后进入草稿审核链路。
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={event => {
                event.preventDefault();
                if (
                  Number(machineDailyOperationForm.projectId) !==
                  workspaceProjectId
                ) {
                  toast.error("机械项目已变更，请关闭表单后重新录入");
                  return;
                }
                saveMachineDailyOperation.mutate({
                  id: machineDailyOperationForm.id,
                  machineId: Number(machineDailyOperationForm.machineId),
                  projectId: Number(machineDailyOperationForm.projectId),
                  occurredOn: machineDailyOperationForm.occurredOn,
                  operatorUserId: machineDailyOperationForm.operatorUserId
                    ? Number(machineDailyOperationForm.operatorUserId)
                    : null,
                  shiftCount: 0,
                  workHours: 0,
                  overtimeHours: Number(
                    machineDailyOperationForm.overtimeHours
                  ),
                  shiftRate: 0,
                  overtimeHourlyRate: Number(
                    machineDailyOperationForm.overtimeHourlyRate
                  ),
                  outputAmount: 0,
                  driverWageAmount: 0,
                  remarks: machineDailyOperationForm.remarks.trim() || null,
                });
              }}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="机械">
                  <Input
                    disabled
                    value={
                      machineDailyOperationForm.machineId
                        ? `机械编号 ${machineDailyOperationForm.machineId}`
                        : "未选择机械"
                    }
                  />
                </Field>
                <Field label="作业日期">
                  <Input
                    type="date"
                    value={machineDailyOperationForm.occurredOn}
                    onChange={event =>
                      setMachineDailyOperationForm(current => ({
                        ...current,
                        occurredOn: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="驾驶员（按机械档案自动关联）">
                  <Input
                    disabled
                    value={
                      selectedMachineForDialog?.driverName ||
                      "按机械档案 / 未登记"
                    }
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="加班小时">
                  <Input
                    type="number"
                    min="0"
                    max="24"
                    step="0.5"
                    value={machineDailyOperationForm.overtimeHours}
                    onChange={event =>
                      setMachineDailyOperationForm(current => ({
                        ...current,
                        overtimeHours: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="加班小时单价（元）">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={machineDailyOperationForm.overtimeHourlyRate}
                    onChange={event =>
                      setMachineDailyOperationForm(current => ({
                        ...current,
                        overtimeHourlyRate: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
              <Field label="备注">
                <Textarea
                  value={machineDailyOperationForm.remarks}
                  maxLength={500}
                  placeholder="可填写施工部位、班次说明或现场核对说明"
                  onChange={event =>
                    setMachineDailyOperationForm(current => ({
                      ...current,
                      remarks: event.target.value,
                    }))
                  }
                />
              </Field>
              <div className="rounded-lg bg-[#f8fcfb] p-3 text-sm text-slate-700">
                预计加班金额：¥
                {displayMoney(
                  Number(machineDailyOperationForm.overtimeHours || 0) *
                    Number(machineDailyOperationForm.overtimeHourlyRate || 0)
                )}
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (confirmMachineryFormClose())
                      setMachineDailyOperationDialogOpen(false);
                  }}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  disabled={
                    saveMachineDailyOperation.isPending ||
                    !machineDailyOperationForm.machineId ||
                    !machineDailyOperationForm.projectId ||
                    !machineDailyOperationForm.occurredOn ||
                    Number(machineDailyOperationForm.overtimeHours) <= 0 ||
                    Number(machineDailyOperationForm.overtimeHourlyRate) < 0
                  }
                >
                  {saveMachineDailyOperation.isPending
                    ? "正在保存…"
                    : "保存加班记录"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog
          open={machineCostDialogOpen}
          onOpenChange={open => {
            if (!open && !confirmMachineryFormClose()) return;
            if (!open) {
              setMachineCostDialogOpen(false);
              setMachineCostForm(EMPTY_MACHINE_COST_FORM);
            }
          }}
        >
          <DialogContent className="w-[calc(100vw-3rem)] max-w-4xl xl:max-w-5xl">
            <DialogHeader>
              <DialogTitle>录入机械成本</DialogTitle>
              <DialogDescription>
                成本金额仅由服务端按数量乘单价计算，保存后先进入草稿状态，再由受权岗位审核、结算或作废。
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={event => {
                event.preventDefault();
                saveMachineCost.mutate({
                  machineId: Number(machineCostForm.machineId),
                  projectId: Number(machineCostForm.projectId),
                  costType: machineCostForm.costType,
                  costName: machineCostForm.costName.trim(),
                  quantity: Number(machineCostForm.quantity),
                  unitPrice: Number(machineCostForm.unitPrice),
                  occurredAt: new Date(
                    machineCostForm.occurredAt
                  ).toISOString(),
                  evidenceId: null,
                  remarks: machineCostForm.remarks.trim() || null,
                });
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="机械">
                  <Input
                    value={
                      selectedMachineForDialog
                        ? `${selectedMachineForDialog.name}（${selectedMachineForDialog.code}）`
                        : ""
                    }
                    disabled
                  />
                </Field>
                <Field label="发生时间">
                  <Input
                    type="datetime-local"
                    value={machineCostForm.occurredAt}
                    onChange={event =>
                      setMachineCostForm(current => ({
                        ...current,
                        occurredAt: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="成本类别">
                  <Select
                    value={machineCostForm.costType}
                    onValueChange={value =>
                      setMachineCostForm(current => ({
                        ...current,
                        costType: value as MachineCostType,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fuel">油料</SelectItem>
                      <SelectItem value="repair">维修</SelectItem>
                      <SelectItem value="overtime">加班</SelectItem>
                      <SelectItem value="mobilization">进退场</SelectItem>
                      <SelectItem value="other">其他</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="数量">
                  <Input
                    type="number"
                    min="0"
                    step="0.001"
                    value={machineCostForm.quantity}
                    onChange={event =>
                      setMachineCostForm(current => ({
                        ...current,
                        quantity: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="单价（元）">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={machineCostForm.unitPrice}
                    onChange={event =>
                      setMachineCostForm(current => ({
                        ...current,
                        unitPrice: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="费用名称（必填）">
                  <Input
                    maxLength={128}
                    value={machineCostForm.costName}
                    placeholder="例如：液压油、发动机维修、进场拖运"
                    onChange={event =>
                      setMachineCostForm(current => ({
                        ...current,
                        costName: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="备注">
                  <Input
                    maxLength={500}
                    value={machineCostForm.remarks}
                    placeholder="可填写维修部位、供应商、票据或现场说明"
                    onChange={event =>
                      setMachineCostForm(current => ({
                        ...current,
                        remarks: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (!confirmMachineryFormClose()) return;
                    setMachineCostDialogOpen(false);
                    setMachineCostForm(EMPTY_MACHINE_COST_FORM);
                  }}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  disabled={
                    !machineCostForm.machineId ||
                    !machineCostForm.projectId ||
                    !machineCostForm.costName.trim() ||
                    !machineCostForm.occurredAt ||
                    !Number.isFinite(Number(machineCostForm.quantity)) ||
                    Number(machineCostForm.quantity) < 0 ||
                    !Number.isFinite(Number(machineCostForm.unitPrice)) ||
                    Number(machineCostForm.unitPrice) < 0 ||
                    saveMachineCost.isPending
                  }
                >
                  {saveMachineCost.isPending ? "正在保存…" : "保存成本草稿"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog
          open={machineStatementDialogOpen}
          onOpenChange={open => {
            if (!open && !confirmMachineryFormClose()) return;
            setMachineStatementDialogOpen(open);
            if (!open)
              setMachineStatementForm(EMPTY_MACHINE_MONTHLY_STATEMENT_FORM);
          }}
        >
          <DialogContent className="max-h-[90vh] w-[calc(100vw-3rem)] max-w-6xl 2xl:max-w-[1440px] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>会计机械月度明细</DialogTitle>
              <DialogDescription>
                按会计模板录入出勤、司机固定工资、加班与签字。机械产值、维修费、油耗、司机工资和机械分成始终由服务端按项目真实成本和生效计价规则生成。
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={event => {
                event.preventDefault();
                saveMachineMonthlyStatement.mutate({
                  machineId: Number(machineStatementForm.machineId),
                  projectId: Number(machineStatementForm.projectId),
                  period: machineStatementForm.period,
                  driverUserId: machineStatementForm.driverUserId
                    ? Number(machineStatementForm.driverUserId)
                    : null,
                  machineWorkDays: Number(machineStatementForm.machineWorkDays),
                  machineOvertimeHours: Number(
                    machineStatementForm.machineOvertimeHours
                  ),
                  driverMonthlyWage: Number(
                    machineStatementForm.driverMonthlyWage
                  ),
                  driverWorkDays: Number(machineStatementForm.driverWorkDays),
                  driverOvertimeHours: Number(
                    machineStatementForm.driverOvertimeHours
                  ),
                  signatureName:
                    machineStatementForm.signatureName.trim() || null,
                  remarks: machineStatementForm.remarks.trim() || null,
                });
              }}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="机械">
                  <Input
                    disabled
                    value={
                      machineMonthlyPreview.data?.machine
                        ? `${machineMonthlyPreview.data.machine.name}（${machineMonthlyPreview.data.machine.code}）`
                        : (machineryLedger.data ?? []).find(
                              item =>
                                String(item.id) ===
                                machineStatementForm.machineId
                            )
                          ? `${(machineryLedger.data ?? []).find(item => String(item.id) === machineStatementForm.machineId)?.name}（待核算）`
                          : "未选择机械"
                    }
                  />
                </Field>
                <Field label="结算期间">
                  <Input
                    type="month"
                    value={machineStatementForm.period}
                    onChange={event =>
                      setMachineStatementForm(current => ({
                        ...current,
                        period: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="司机 / 操作员">
                  <Select
                    value={machineStatementForm.driverUserId || "UNASSIGNED"}
                    onValueChange={value =>
                      setMachineStatementForm(current => ({
                        ...current,
                        driverUserId: value === "UNASSIGNED" ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UNASSIGNED">
                        按机械绑定操作员 / 未分配
                      </SelectItem>
                      {users.data?.map(user => (
                        <SelectItem key={user.id} value={String(user.id)}>
                          {user.name || `用户 #${user.id}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <section className="rounded-xl border border-[#d8e3e0] bg-[#f8fcfb] p-3">
                <div className="mb-3">
                  <p className="text-sm font-semibold text-[#203c48]">
                    机械产值口径
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    固定月租按“月租 ÷ 30 × 出勤天数”计算；机械加班默认按“月租 ÷
                    30 ÷ 10 × 小时”计算，存在合同加班单价时优先使用合同单价。
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="机械出勤天数">
                    <Input
                      type="number"
                      min="0"
                      max="31"
                      step="0.5"
                      value={machineStatementForm.machineWorkDays}
                      onChange={event =>
                        setMachineStatementForm(current => ({
                          ...current,
                          machineWorkDays: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="机械加班（小时）">
                    <Input
                      type="number"
                      min="0"
                      max="744"
                      step="0.5"
                      value={machineStatementForm.machineOvertimeHours}
                      onChange={event =>
                        setMachineStatementForm(current => ({
                          ...current,
                          machineOvertimeHours: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>
              </section>
              <section className="rounded-xl border border-[#d8e3e0] bg-[#f8fcfb] p-3">
                <div className="mb-3">
                  <p className="text-sm font-semibold text-[#203c48]">
                    司机工资口径
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    司机总工资按“固定工资 ÷ 30 × 出勤天数 + 固定工资 ÷ 30 ÷ 10 ×
                    加班小时”由服务端计算。
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="司机固定月工资（元）">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={machineStatementForm.driverMonthlyWage}
                      onChange={event =>
                        setMachineStatementForm(current => ({
                          ...current,
                          driverMonthlyWage: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="司机出勤天数">
                    <Input
                      type="number"
                      min="0"
                      max="31"
                      step="0.5"
                      value={machineStatementForm.driverWorkDays}
                      onChange={event =>
                        setMachineStatementForm(current => ({
                          ...current,
                          driverWorkDays: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="司机加班（小时）">
                    <Input
                      type="number"
                      min="0"
                      max="744"
                      step="0.5"
                      value={machineStatementForm.driverOvertimeHours}
                      onChange={event =>
                        setMachineStatementForm(current => ({
                          ...current,
                          driverOvertimeHours: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>
              </section>
              {machineMonthlyPreview.isLoading ? (
                <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                  正在按当前项目真实成本与计价规则核算会计明细…
                </div>
              ) : machineMonthlyPreview.error ? (
                <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800">
                  {getUserFacingErrorMessage(
                    machineMonthlyPreview.error,
                    "暂无法核算机械会计明细，请稍后重试"
                  )}
                  。请先在机械档案中维护当前期间的产值计价规则。
                </div>
              ) : machineMonthlyPreview.data ? (
                <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-amber-950">
                        服务端会计核算预览
                      </p>
                      <p className="mt-1 text-xs text-amber-800">
                        计价：
                        {machineMonthlyPreview.data.rule.billingType ===
                        "monthly"
                          ? "月租"
                          : machineMonthlyPreview.data.rule.billingType ===
                              "daily"
                            ? "日租"
                            : machineMonthlyPreview.data.rule.billingType ===
                                "hourly"
                              ? "小时租"
                              : "台班"}{" "}
                        ¥{displayMoney(machineMonthlyPreview.data.rule.rate)}
                        ；来源成本{" "}
                        {machineMonthlyPreview.data.source.costRecordCount}{" "}
                        笔、维修保养{" "}
                        {
                          machineMonthlyPreview.data.source
                            .maintenanceRecordCount
                        }{" "}
                        笔。
                      </p>
                    </div>
                    <Badge variant="outline">
                      {machineMonthlyPreview.data.machine.ownerName}
                    </Badge>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <p className="text-xs text-amber-800">机械总产值</p>
                      <p className="mt-1 font-semibold text-amber-950">
                        ¥
                        {displayMoney(
                          machineMonthlyPreview.data.statement.totalOutput
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-amber-800">司机总工资</p>
                      <p className="mt-1 font-semibold text-amber-950">
                        ¥
                        {displayMoney(
                          machineMonthlyPreview.data.statement.driverTotalWage
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-amber-800">维修 / 油费</p>
                      <p className="mt-1 font-semibold text-amber-950">
                        ¥
                        {displayMoney(
                          machineMonthlyPreview.data.statement.repairAmount
                        )}{" "}
                        / ¥
                        {displayMoney(
                          machineMonthlyPreview.data.statement.fuelAmount
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-amber-800">机械分成</p>
                      <p className="mt-1 font-semibold text-amber-950">
                        ¥
                        {displayMoney(
                          machineMonthlyPreview.data.statement
                            .machineShareAmount
                        )}
                      </p>
                    </div>
                  </div>
                </section>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="签字 / 经办人">
                  <Input
                    value={machineStatementForm.signatureName}
                    placeholder="例如：车主或经办会计"
                    onChange={event =>
                      setMachineStatementForm(current => ({
                        ...current,
                        signatureName: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="备注">
                  <Input
                    value={machineStatementForm.remarks}
                    placeholder="可填写核对说明或异常原因"
                    onChange={event =>
                      setMachineStatementForm(current => ({
                        ...current,
                        remarks: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (confirmMachineryFormClose())
                      setMachineStatementDialogOpen(false);
                  }}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  disabled={
                    saveMachineMonthlyStatement.isPending ||
                    !machineMonthlyPreview.data ||
                    !machineStatementForm.machineId ||
                    !machineStatementForm.projectId ||
                    !machineStatementForm.period
                  }
                >
                  {saveMachineMonthlyStatement.isPending
                    ? "正在生成…"
                    : "生成会计明细草稿"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog
          open={assetMaintenanceDialogOpen}
          onOpenChange={open => {
            if (
              !open &&
              assetMaintenanceForm.assetType === "machine" &&
              !confirmMachineryFormClose()
            )
              return;
            setAssetMaintenanceDialogOpen(open);
            if (!open) setAssetMaintenanceForm(EMPTY_ASSET_MAINTENANCE_FORM);
          }}
        >
          <DialogContent className="max-h-[90vh] w-[calc(100vw-3rem)] max-w-4xl overflow-y-auto xl:max-w-5xl">
            <DialogHeader>
              <DialogTitle>
                登记
                {assetMaintenanceForm.assetType === "vehicle" ? "车辆" : "机械"}
                维修保养费用
              </DialogTitle>
              <DialogDescription>
                费用会纳入单车/单设备及车辆、机械费用汇总；作废记录不参与金额统计。
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={event => {
                event.preventDefault();
                if (
                  assetMaintenanceForm.assetType === "machine" &&
                  Number(assetMaintenanceForm.projectId) !== workspaceProjectId
                ) {
                  toast.error("机械项目已变更，请关闭原表单后重新录入");
                  return;
                }
                saveAssetMaintenance.mutate({
                  id: assetMaintenanceForm.id,
                  assetType: assetMaintenanceForm.assetType,
                  assetId: Number(assetMaintenanceForm.assetId),
                  projectId: Number(assetMaintenanceForm.projectId),
                  costCategory: assetMaintenanceForm.costCategory,
                  amount: Number(assetMaintenanceForm.amount),
                  occurredAt: new Date(
                    assetMaintenanceForm.occurredAt
                  ).toISOString(),
                  serviceProvider: assetMaintenanceForm.serviceProvider || null,
                  meterReading: assetMaintenanceForm.meterReading
                    ? Number(assetMaintenanceForm.meterReading)
                    : null,
                  nextDueAt: assetMaintenanceForm.nextDueAt || null,
                  remarks: assetMaintenanceForm.remarks || null,
                  status: assetMaintenanceForm.status,
                });
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="资源">
                  <Input
                    disabled
                    value={
                      assetMaintenanceForm.assetType === "vehicle"
                        ? (vehicles.data?.find(
                            item =>
                              String(item.id) === assetMaintenanceForm.assetId
                          )?.plateNo ?? "未选择车辆")
                        : ((machineryLedger.data ?? []).find(
                            item =>
                              String(item.id) === assetMaintenanceForm.assetId
                          )?.name ?? "未选择机械")
                    }
                  />
                </Field>
                <Field label="费用类别">
                  <Select
                    value={assetMaintenanceForm.costCategory}
                    onValueChange={value =>
                      setAssetMaintenanceForm(current => ({
                        ...current,
                        costCategory:
                          value as AssetMaintenanceForm["costCategory"],
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="maintenance">保养</SelectItem>
                      <SelectItem value="repair">维修</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="发生时间">
                  <Input
                    type="datetime-local"
                    value={
                      assetMaintenanceForm.occurredAt
                        ? toLocalDateTimeInput(
                            new Date(assetMaintenanceForm.occurredAt)
                          )
                        : ""
                    }
                    onChange={event =>
                      setAssetMaintenanceForm(current => ({
                        ...current,
                        occurredAt: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="金额（元）">
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={assetMaintenanceForm.amount}
                    onChange={event =>
                      setAssetMaintenanceForm(current => ({
                        ...current,
                        amount: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="维修/保养服务商">
                  <Input
                    value={assetMaintenanceForm.serviceProvider}
                    onChange={event =>
                      setAssetMaintenanceForm(current => ({
                        ...current,
                        serviceProvider: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="里程 / 工时读数">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={assetMaintenanceForm.meterReading}
                    onChange={event =>
                      setAssetMaintenanceForm(current => ({
                        ...current,
                        meterReading: event.target.value,
                      }))
                    }
                    placeholder="可选"
                  />
                </Field>
                <Field label="下次保养日期">
                  <Input
                    type="date"
                    value={assetMaintenanceForm.nextDueAt}
                    onChange={event =>
                      setAssetMaintenanceForm(current => ({
                        ...current,
                        nextDueAt: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="费用状态">
                  <Select
                    value={assetMaintenanceForm.status}
                    onValueChange={value =>
                      setAssetMaintenanceForm(current => ({
                        ...current,
                        status: value as AssetMaintenanceForm["status"],
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">草稿</SelectItem>
                      <SelectItem value="approved">已核准</SelectItem>
                      <SelectItem value="settled">已结算</SelectItem>
                      <SelectItem value="void">作废</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field label="维修/保养说明">
                <Textarea
                  value={assetMaintenanceForm.remarks}
                  onChange={event =>
                    setAssetMaintenanceForm(current => ({
                      ...current,
                      remarks: event.target.value,
                    }))
                  }
                  placeholder="维修项目、零件或保养内容；不得填写不必要的个人敏感信息"
                />
              </Field>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (
                      assetMaintenanceForm.assetType !== "machine" ||
                      confirmMachineryFormClose()
                    )
                      setAssetMaintenanceDialogOpen(false);
                  }}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  disabled={
                    saveAssetMaintenance.isPending ||
                    !assetMaintenanceForm.assetId ||
                    !assetMaintenanceForm.projectId ||
                    !assetMaintenanceForm.amount ||
                    !assetMaintenanceForm.occurredAt
                  }
                >
                  {saveAssetMaintenance.isPending
                    ? "正在保存…"
                    : "保存费用台账"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog
          open={dieselPriceDialogOpen}
          onOpenChange={open => {
            setDieselPriceDialogOpen(open);
            if (!open) setDieselPriceForm(EMPTY_DIESEL_PRICE_FORM);
          }}
        >
          <DialogContent className="w-[calc(100vw-3rem)] max-w-4xl xl:max-w-5xl">
            <DialogHeader>
              <DialogTitle>
                {dieselPriceForm.id ? "维护柴油指导价" : "新增柴油指导价"}
              </DialogTitle>
              <DialogDescription>
                项目部供油在登记时按发生日期匹配有效指导单价；加油站加油则按实际单价入账。停用价格不会影响已有领用和运输结算快照。
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={event => {
                event.preventDefault();
                saveDieselGuidelinePrice.mutate({
                  id: dieselPriceForm.id,
                  projectId: Number(dieselPriceForm.projectId),
                  pricePerLiter: Number(dieselPriceForm.pricePerLiter),
                  effectiveFrom: dieselPriceForm.effectiveFrom,
                  effectiveTo: dieselPriceForm.effectiveTo || null,
                  status: dieselPriceForm.status,
                  remarks: dieselPriceForm.remarks || null,
                });
              }}
            >
              <div className="space-y-3">
                <div data-testid="diesel-guideline-project-field">
                  <Field label="项目">
                    <Select
                      value={dieselPriceForm.projectId || "UNASSIGNED"}
                      onValueChange={value =>
                        setDieselPriceForm(current => ({
                          ...current,
                          projectId: value === "UNASSIGNED" ? "" : value,
                        }))
                      }
                    >
                      <SelectTrigger className="w-full min-w-0">
                        <SelectValue placeholder="选择项目" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="UNASSIGNED">请选择项目</SelectItem>
                        {projects.data
                          ?.filter(project => project.status !== "archived")
                          .map(project => (
                            <SelectItem
                              key={project.id}
                              value={String(project.id)}
                            >
                              {project.code} · {project.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="指导单价（元/升）">
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={dieselPriceForm.pricePerLiter}
                      placeholder="例如 7.25"
                      onChange={event =>
                        setDieselPriceForm(current => ({
                          ...current,
                          pricePerLiter: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="生效日期">
                    <Input
                      type="date"
                      value={dieselPriceForm.effectiveFrom}
                      onChange={event =>
                        setDieselPriceForm(current => ({
                          ...current,
                          effectiveFrom: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="截止日期">
                    <Input
                      type="date"
                      min={dieselPriceForm.effectiveFrom || undefined}
                      value={dieselPriceForm.effectiveTo}
                      onChange={event =>
                        setDieselPriceForm(current => ({
                          ...current,
                          effectiveTo: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="状态">
                    <Select
                      value={dieselPriceForm.status}
                      onValueChange={value =>
                        setDieselPriceForm(current => ({
                          ...current,
                          status: value as DieselPriceForm["status"],
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">启用</SelectItem>
                        <SelectItem value="draft">草稿</SelectItem>
                        <SelectItem value="disabled">停用</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </div>
              <Field label="备注">
                <Textarea
                  value={dieselPriceForm.remarks}
                  placeholder="例如：项目部本周柴油核准指导价"
                  onChange={event =>
                    setDieselPriceForm(current => ({
                      ...current,
                      remarks: event.target.value,
                    }))
                  }
                />
              </Field>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDieselPriceDialogOpen(false)}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  disabled={
                    saveDieselGuidelinePrice.isPending ||
                    !dieselPriceForm.projectId ||
                    !dieselPriceForm.pricePerLiter ||
                    !dieselPriceForm.effectiveFrom
                  }
                >
                  {saveDieselGuidelinePrice.isPending
                    ? "正在保存…"
                    : "保存指导价"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog
          open={dieselRefuelDialogOpen}
          onOpenChange={open => {
            setDieselRefuelDialogOpen(open);
            if (!open) {
              setDieselRefuelForm(EMPTY_DIESEL_REFUEL_FORM);
              resetDieselReceiptCapture();
            }
          }}
        >
          <DialogContent className="max-h-[90vh] w-[calc(100vw-3rem)] max-w-4xl xl:max-w-5xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>登记柴油领用</DialogTitle>
              <DialogDescription>
                项目部供油按加油日期匹配有效指导价；加油站现金加油必须录入当天实际单价与升数。两种方式均由服务端计算并固化金额快照；每笔领用必须后置相机现场直拍加油表并自动归档工程水印。车辆扣油由该车辆运输结算总额统一归集，不再逐趟选择。
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={event => {
                event.preventDefault();
                void submitDieselRefuel();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="项目">
                  <Input
                    disabled
                    value={
                      projects.data?.find(
                        project =>
                          String(project.id) === dieselRefuelForm.projectId
                      )?.name ?? "未选择项目"
                    }
                  />
                </Field>
                <Field label="加油时间">
                  <Input
                    type="datetime-local"
                    value={dieselRefuelForm.refueledAt}
                    onChange={event =>
                      setDieselRefuelForm(current => ({
                        ...current,
                        refueledAt: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="领用对象">
                  <Select
                    value={dieselRefuelForm.assetType}
                    onValueChange={value =>
                      setDieselRefuelForm(current => ({
                        ...current,
                        assetType: value as DieselRefuelForm["assetType"],
                        vehicleId: "",
                        machineId: "",
                        transportTripId: "",
                        deductFromFreight: false,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="vehicle">渣土车 / 车辆</SelectItem>
                      <SelectItem value="machine">工程机械</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label={
                    dieselRefuelForm.assetType === "vehicle" ? "车辆" : "机械"
                  }
                >
                  <Select
                    value={
                      (dieselRefuelForm.assetType === "vehicle"
                        ? dieselRefuelForm.vehicleId
                        : dieselRefuelForm.machineId) || "UNASSIGNED"
                    }
                    onValueChange={value =>
                      setDieselRefuelForm(current =>
                        current.assetType === "vehicle"
                          ? {
                              ...current,
                              vehicleId: value === "UNASSIGNED" ? "" : value,
                              transportTripId: "",
                            }
                          : {
                              ...current,
                              machineId: value === "UNASSIGNED" ? "" : value,
                            }
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          dieselRefuelForm.assetType === "vehicle"
                            ? "选择车辆"
                            : "选择机械"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UNASSIGNED">请选择资源</SelectItem>
                      {dieselRefuelForm.assetType === "vehicle"
                        ? (dieselVehicleOptions.data ?? [])
                            .filter(
                              vehicle =>
                                String(vehicle.projectId) ===
                                dieselRefuelForm.projectId
                            )
                            .map(vehicle => (
                              <SelectItem
                                key={vehicle.id}
                                value={String(vehicle.id)}
                              >
                                {vehicle.plateNo}
                              </SelectItem>
                            ))
                        : (dieselMachineOptions.data ?? []).map(machine => (
                            <SelectItem
                              key={machine.id}
                              value={String(machine.id)}
                            >
                              {machine.name} · {machine.code}
                            </SelectItem>
                          ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="供油方式">
                  <Select
                    value={dieselRefuelForm.supplyMethod}
                    onValueChange={value =>
                      setDieselRefuelForm(current => ({
                        ...current,
                        supplyMethod: value as DieselRefuelForm["supplyMethod"],
                        actualUnitPrice: "",
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="project_supply">
                        项目部供油（当天指导价）
                      </SelectItem>
                      <SelectItem value="external_station">
                        加油站现金加油（当天实际价）
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label={
                    dieselRefuelForm.supplyMethod === "project_supply"
                      ? "供油点 / 说明"
                      : "加油站 / 现金供应商"
                  }
                >
                  <Input
                    value={dieselRefuelForm.stationOrSupplierName}
                    placeholder={
                      dieselRefuelForm.supplyMethod === "project_supply"
                        ? "例如：项目油库"
                        : "例如：中国石化 xx 加油站"
                    }
                    onChange={event =>
                      setDieselRefuelForm(current => ({
                        ...current,
                        stationOrSupplierName: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="加油量（升）">
                  <Input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={dieselRefuelForm.liters}
                    onChange={event =>
                      setDieselRefuelForm(current => ({
                        ...current,
                        liters: event.target.value,
                      }))
                    }
                  />
                </Field>
                {dieselRefuelForm.supplyMethod === "external_station" ? (
                  <Field label="当天现金单价（元/升）">
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={dieselRefuelForm.actualUnitPrice}
                      placeholder="必填"
                      onChange={event =>
                        setDieselRefuelForm(current => ({
                          ...current,
                          actualUnitPrice: event.target.value,
                        }))
                      }
                    />
                  </Field>
                ) : (
                  <Field label="当天指导单价">
                    <div className="flex gap-2">
                      <Input
                        disabled
                        value={
                          dieselGuidelinePrices.data?.find(
                            price => price.status === "active"
                          )
                            ? `¥ ${displayMoney(dieselGuidelinePrices.data.find(price => price.status === "active")?.pricePerLiter)} / L`
                            : "请先维护有效指导价"
                        }
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setDieselPriceForm({
                            ...EMPTY_DIESEL_PRICE_FORM,
                            projectId: dieselRefuelForm.projectId,
                            effectiveFrom: dieselRefuelForm.refueledAt.slice(
                              0,
                              10
                            ),
                            status: "active",
                          });
                          setDieselPriceDialogOpen(true);
                        }}
                      >
                        维护指导价
                      </Button>
                    </div>
                  </Field>
                )}
                <Field label="油表 / 里程读数">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={dieselRefuelForm.meterReading}
                    placeholder="可选"
                    onChange={event =>
                      setDieselRefuelForm(current => ({
                        ...current,
                        meterReading: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="小票 / 现金凭证号">
                  <Input
                    value={dieselRefuelForm.receiptNo}
                    placeholder={
                      dieselRefuelForm.supplyMethod === "external_station"
                        ? "建议填写现金小票号"
                        : "可选"
                    }
                    onChange={event =>
                      setDieselRefuelForm(current => ({
                        ...current,
                        receiptNo: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="加油表现场照片（必拍）">
                  <div className="space-y-2">
                    <p className="text-xs leading-5 text-emerald-700">
                      仅支持后置相机现场直拍，不提供相册选择；保存时自动写入项目、加油时间、详细地点、操作人与防伪编号水印。
                    </p>
                    {dieselCameraOpen ? (
                      <div className="overflow-hidden rounded-xl border border-[#79a57f] bg-[#18301d]">
                        <video
                          ref={dieselCameraVideoRef}
                          className="aspect-[4/3] w-full bg-black object-cover"
                          autoPlay
                          playsInline
                          muted
                        />
                        <div className="grid grid-cols-2 gap-2 p-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="border-[#c9dec9] bg-white text-[#47754d]"
                            onClick={stopDieselCamera}
                          >
                            取消拍照
                          </Button>
                          <Button
                            type="button"
                            className="bg-[#47754d] text-white hover:bg-[#39623e]"
                            onClick={captureDieselMeterPhoto}
                          >
                            <Camera className="mr-1 h-4 w-4" />
                            确认照片
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 w-full border-dashed border-[#79a57f] bg-[#f4fbf1] text-[#47754d] hover:bg-[#e7f1e5]"
                        onClick={() => void startDieselCamera()}
                      >
                        <Camera className="mr-2 h-4 w-4" />
                        打开后置相机拍摄加油表
                      </Button>
                    )}
                    {dieselReceiptPreview ? (
                      <div className="space-y-1">
                        <img
                          src={dieselReceiptPreview}
                          alt="待归档加油表现场照片"
                          className="max-h-56 w-full rounded-xl border border-[#c6ddc5] object-cover"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-[#47754d]"
                          onClick={() => void startDieselCamera()}
                        >
                          <Camera className="mr-1 h-3.5 w-3.5" />
                          重新拍摄
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </Field>
              </div>
              {dieselRefuelForm.supplyMethod === "external_station" ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                  <span className="font-medium">现金油费预览：</span>
                  {dieselRefuelForm.liters && dieselRefuelForm.actualUnitPrice
                    ? `${Number(dieselRefuelForm.liters).toFixed(3)} L × ¥${displayMoney(Number(dieselRefuelForm.actualUnitPrice))}/L = ¥${displayMoney(Number(dieselRefuelForm.liters) * Number(dieselRefuelForm.actualUnitPrice))}`
                    : "请填写当天现金单价和加油升数；最终金额以服务端保存的油价快照为准。"}
                </div>
              ) : null}
              {dieselRefuelForm.assetType === "vehicle" ? (
                <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="diesel-deduct-freight"
                      checked={dieselRefuelForm.deductFromFreight}
                      onCheckedChange={checked =>
                        setDieselRefuelForm(current => ({
                          ...current,
                          deductFromFreight: Boolean(checked),
                          transportTripId: "",
                        }))
                      }
                    />
                    <Label
                      htmlFor="diesel-deduct-freight"
                      className="cursor-pointer font-medium text-amber-950"
                    >
                      本次油款在渣土车运费结算时扣除
                    </Label>
                  </div>
                  {dieselRefuelForm.deductFromFreight ? (
                    <p className="text-xs leading-5 text-amber-800">
                      无需选择某一趟。系统将在该车辆生成运输结算单时，从本期可结算运输总额中统一归集扣减，并写入结算明细与审计记录。
                    </p>
                  ) : null}
                </section>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="记账状态">
                  <Select
                    value={dieselRefuelForm.status}
                    onValueChange={value =>
                      setDieselRefuelForm(current => ({
                        ...current,
                        status: value as DieselRefuelForm["status"],
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="approved">
                        已直接记账，立即纳入成本/结算
                      </SelectItem>
                      {dieselRefuelForm.id ? (
                        <SelectItem value="void">作废（仅限纠错）</SelectItem>
                      ) : null}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs leading-5 text-emerald-700">
                    柴油领用无需上级审核；保存后立即生效。价格异常、影像、项目范围和审计控制继续执行。
                  </p>
                </Field>
              </div>
              <Field label="说明">
                <Textarea
                  value={dieselRefuelForm.remarks}
                  placeholder="领用用途、油品说明或异常说明；不得填写不必要个人敏感信息"
                  onChange={event =>
                    setDieselRefuelForm(current => ({
                      ...current,
                      remarks: event.target.value,
                    }))
                  }
                />
              </Field>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDieselRefuelDialogOpen(false)}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  disabled={
                    saveDieselRefuelRecord.isPending ||
                    uploadDieselReceipt.isPending ||
                    !dieselRefuelForm.projectId ||
                    !dieselRefuelForm.refueledAt ||
                    !dieselRefuelForm.liters ||
                    (dieselRefuelForm.assetType === "vehicle" &&
                      !dieselRefuelForm.vehicleId) ||
                    (dieselRefuelForm.assetType === "machine" &&
                      !dieselRefuelForm.machineId) ||
                    (dieselRefuelForm.supplyMethod === "external_station" &&
                      !dieselRefuelForm.actualUnitPrice) ||
                    (!dieselRefuelForm.id &&
                      dieselRefuelForm.status !== "void" &&
                      !dieselReceiptFile)
                  }
                >
                  {uploadDieselReceipt.isPending
                    ? "正在归档加油表照片…"
                    : saveDieselRefuelRecord.isPending
                      ? "正在直接记账…"
                      : "保存并直接记账"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
