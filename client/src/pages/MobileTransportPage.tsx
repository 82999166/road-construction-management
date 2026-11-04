import { MobileAccessGate } from "@/components/MobileAccessGate";
import { MobileTransportLedger } from "@/components/MobileTransportLedger";
import { PersonnelResourceSelect } from "@/components/PersonnelResourceSelect";
import { TransportFreightPrintDialog } from "@/components/TransportFreightPrintDialog";
import { MobileTransportSiteManager } from "@/components/MobileTransportSiteManager";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatChinaDate, formatChinaDateTime, toDeviceDateInput, toDeviceDateTimeInput } from "@/lib/businessTime";
import { clearMobileDraft, hasMobileDraftContent, readMobileDraft, saveMobileDraft } from "@/lib/mobileDraftStorage";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { resolvePhotoUnloadLocation } from "@/lib/transportUnloadLocation";
import { useManagementPermissions } from "@/hooks/useManagementPermissions";
import { useTransportReceiptSpeech } from "@/hooks/useTransportReceiptSpeech";
import { useMobileFormProtection, useMobileSafeNavigate } from "@/contexts/MobileFormProtectionContext";
import { AlertTriangle, ArrowLeft, Bell, Camera, CircleCheck, CircleHelp, FileText, HardHat, LayoutDashboard, LocateFixed, MapPin, Pencil, Plus, Printer, RefreshCw, Route, Settings2, ShieldCheck, Truck, UserRound, Volume2 } from "lucide-react";
import { DEFAULT_EVIDENCE_WATERMARK_TEMPLATE, type EvidenceWatermarkTemplate } from "../../../shared/watermarkTemplate";
import { getSafeCardValidationReason } from "../../../shared/domain";
import { Component, lazy, Suspense, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "../_core/hooks/useAuth";

const MobileNfcTransportInvoice = lazy(() => import("@/components/MobileNfcTransportInvoice").then(module => ({ default: module.MobileNfcTransportInvoice })));
const TransportRouteSafetySettings = lazy(() => import("@/components/TransportRouteSafetySettings").then(module => ({ default: module.TransportRouteSafetySettings })));

class NfcInvoiceLoadBoundary extends Component<{ children: ReactNode; onClose: () => void }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return <Dialog open onOpenChange={open => { if (!open) this.props.onClose(); }}>
      <DialogContent className="max-w-sm"><DialogHeader><DialogTitle>刷卡发票页面加载失败</DialogTitle></DialogHeader><p className="text-sm leading-6 text-[#765544]">当前网络未能完整加载刷卡发票页面。请检查网络后重新打开；不会生成或修改任何运单。</p><DialogFooter><Button variant="outline" onClick={this.props.onClose}>暂不打开</Button><Button className="bg-[#9a5128] text-white hover:bg-[#7e3d1c]" onClick={() => window.location.reload()}>重新加载页面</Button></DialogFooter></DialogContent>
    </Dialog>;
  }
}

function NfcInvoiceLoadingDialog({ onClose }: { onClose: () => void }) {
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-sm"><DialogHeader><DialogTitle>正在打开刷卡发票</DialogTitle></DialogHeader><p className="text-sm leading-6 text-[#765544]">正在加载 NFC 读卡与开票功能，请稍候。页面打开后，点击“开始读取车辆卡”再贴卡；已写入安全链接的车辆卡直接触碰手机也可打开本页。</p><DialogFooter><Button variant="outline" onClick={onClose}>取消</Button></DialogFooter></DialogContent>
  </Dialog>;
}

function getTodayText() {
  return toDeviceDateInput();
}

function formatMoney(value: string | number | null | undefined) {
  return `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatVehicleStageReceipt(plateNo: string | null | undefined, dailyVehicleTripOrdinal: number | null | undefined, eventType: "load" | "unload") {
  const ordinal = dailyVehicleTripOrdinal ?? 0;
  if (!plateNo || !Number.isInteger(ordinal) || ordinal < 1) return null;
  return `车牌 ${plateNo}，今日第 ${ordinal} 车${eventType === "load" ? "装土" : "卸土"}成功`;
}

function readImageAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("车牌照片读取失败"));
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ""));
    reader.readAsDataURL(file);
  });
}

/** 车牌直拍凭证必须先写入工程水印，避免未标记来源、时间与项目的原始照片直接进入业务档案。 */
function createWatermarkedTransportImage(file: File, watermarkLines: string[], template: EvidenceWatermarkTemplate) {
  return new Promise<File>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("车牌水印照片生成失败")); };
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("当前浏览器不支持车牌水印绘制");
        context.drawImage(image, 0, 0);
        const fontSize = Math.max(15, Math.round(Math.min(canvas.width, canvas.height) / 34));
        const lineHeight = Math.round(fontSize * 1.46);
        const padding = Math.round(fontSize * 0.72);
        const lines = watermarkLines.filter(Boolean).slice(0, 8);
        context.font = `600 ${fontSize}px sans-serif`;
        const textWidth = Math.min(canvas.width - padding * 2, Math.max(...lines.map(line => context.measureText(line).width), canvas.width * 0.42));
        const headerHeight = Math.round(lineHeight * 1.35);
        const footerHeight = Math.round(lineHeight * 1.1);
        const boxHeight = headerHeight + lines.length * lineHeight + footerHeight + padding * 2;
        const boxY = canvas.height - boxHeight - padding;
        context.fillStyle = "rgba(255,255,255,.88)";
        context.fillRect(padding, boxY, textWidth + padding * 2, boxHeight);
        context.fillStyle = "rgba(33,119,211,.9)";
        context.fillRect(padding, boxY, textWidth + padding * 2, headerHeight + padding);
        context.fillStyle = "#fff";
        context.font = `700 ${Math.round(fontSize * 1.08)}px sans-serif`;
        context.fillText(template.title, padding * 2, boxY + Math.round(padding * .55));
        context.fillStyle = "#26333d";
        context.font = `600 ${fontSize}px sans-serif`;
        context.textBaseline = "top";
        lines.forEach((line, index) => context.fillText(line, padding * 2, boxY + headerHeight + padding + index * lineHeight));
        context.fillStyle = "rgba(33,119,211,.92)";
        context.fillRect(padding, boxY + boxHeight - footerHeight - padding, textWidth + padding * 2, footerHeight + padding);
        context.fillStyle = "#fff";
        context.font = `600 ${Math.round(fontSize * .78)}px sans-serif`;
        context.fillText(template.footerLabel, padding * 2, boxY + boxHeight - footerHeight - Math.round(padding * .1));
        canvas.toBlob(blob => {
          URL.revokeObjectURL(objectUrl);
          if (!blob) return reject(new Error("车牌水印照片生成失败"));
          resolve(new File([blob], `${file.name.replace(/\.(jpe?g|png)$/i, "") || "transport-plate"}-watermark.jpg`, { type: "image/jpeg", lastModified: Date.now() }));
        }, "image/jpeg", .9);
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        reject(error instanceof Error ? error : new Error("车牌水印照片生成失败"));
      }
    };
    image.src = objectUrl;
  });
}

function getVehicleStatus(status: "active" | "suspended" | "disabled") {
  return {
    active: { label: "可调度", className: "bg-[#e6f1e4] text-[#47754d]" },
    suspended: { label: "暂缓", className: "bg-[#f8ead8] text-[#94603a]" },
    disabled: { label: "停用", className: "bg-[#eee8e2] text-[#806e60]" },
  }[status];
}

function getTripStatus(status: "draft" | "submitted" | "verified" | "settled" | "void") {
  return {
    draft: { label: "草稿", className: "bg-[#f8ead8] text-[#94603a]" },
    submitted: { label: "待核验", className: "bg-[#f9e6bd] text-[#9c6425]" },
    verified: { label: "已核验", className: "bg-[#e7f1e5] text-[#47754d]" },
    settled: { label: "已结算", className: "bg-[#e2f0ed] text-[#3e746a]" },
    void: { label: "已作废", className: "bg-[#eee8e2] text-[#857365]" },
  }[status];
}

type VehicleDraft = { plateNo: string; ownership: "owned" | "leased" | "trip_settlement"; ownerName: string; driverPersonId: string; driverUserId: string; driverName: string; driverPhone: string; boxLengthMeters: string; boxWidthMeters: string; boxHeightMeters: string; loadFactor: string; payloadTons: string; status: "active" | "suspended" | "disabled" };
const EMPTY_VEHICLE_DRAFT: VehicleDraft = { plateNo: "", ownership: "trip_settlement", ownerName: "", driverPersonId: "", driverUserId: "", driverName: "", driverPhone: "", boxLengthMeters: "", boxWidthMeters: "", boxHeightMeters: "", loadFactor: "1", payloadTons: "", status: "active" };
const EMPTY_RULE_DRAFT = { materialName: "", settlementUnit: "cubic_meter" as const, startDistanceKm: "1", basePricePerUnit: "", stepMeters: "500", stepIncreasePerUnit: "0", effectiveFrom: getTodayText(), effectiveTo: "", status: "active" as const };

type TripDraft = {
  invoiceMode: "nfc_card" | "plate_photo";
  routePresetId: string;
  freightRuleId: string;
  loadSiteId: string;
  unloadSiteId: string;
  tripNo: string;
  startAt: string;
  endAt: string;
  actualDistanceKm: string;
  volumeCubicMeters: string;
  weightTons: string;
  evidenceId: string;
  startLatitude: number | null;
  startLongitude: number | null;
  endLatitude: number | null;
  endLongitude: number | null;
};

/** 设备草稿仅包含可恢复的非敏感运单文字、数值与枚举；不包含影像、凭证编号或定位。 */
type TripLocalDraft = Pick<TripDraft, "routePresetId" | "freightRuleId" | "loadSiteId" | "unloadSiteId" | "tripNo" | "startAt" | "endAt" | "actualDistanceKm" | "volumeCubicMeters" | "weightTons"> & { mode: TripDraft["invoiceMode"]; vehicleId: string };

function createTripDraft(freightRuleId = "", invoiceMode: TripDraft["invoiceMode"] = "nfc_card"): TripDraft {
  return { invoiceMode, routePresetId: "", freightRuleId, loadSiteId: "", unloadSiteId: "", tripNo: "", startAt: toDeviceDateTimeInput(), endAt: "", actualDistanceKm: "", volumeCubicMeters: "", weightTons: "", evidenceId: "", startLatitude: null, startLongitude: null, endLatitude: null, endLongitude: null };
}

type TransportSiteDraft = { siteType: "load" | "unload"; name: string; address: string; administratorUserId: string; status: "active" | "disabled" };
const EMPTY_TRANSPORT_SITE_DRAFT: TransportSiteDraft = { siteType: "load", name: "", address: "", administratorUserId: "", status: "active" };

/** 移动端运输调度：原始坐标、影像编号与业务数据进入服务端后统一核验和计算。 */
export default function MobileTransportPage() {
  const { user, isAuthenticated, loading, authLoadingTimedOut, refresh } = useAuth();
  const navigate = useMobileSafeNavigate();
  const utils = trpc.useUtils();
  const { statusText: speechStatusText, lastMessage: lastSpeechReceipt, prepareSpeech, speakTransportReceipt, testSpeech, replaySpeech } = useTransportReceiptSpeech();
  const { isSuperAdmin } = useManagementPermissions();
  const [projectId, setProjectId] = useState<number | undefined>();
  // 台账筛选与新建运输表单必须使用独立状态，避免异步列表刷新覆盖拍照发票选择。
  const [vehicleId, setVehicleId] = useState<number | undefined>();
  const [tripVehicleId, setTripVehicleId] = useState<number | undefined>();
  const [workDate, setWorkDate] = useState(getTodayText);
  const [activeTab, setActiveTab] = useState("trips");
  const [vehicleDialogOpen, setVehicleDialogOpen] = useState(false);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [siteDialogOpen, setSiteDialogOpen] = useState(false);
  const [routeDialogOpen, setRouteDialogOpen] = useState(false);
  const [editingSiteId, setEditingSiteId] = useState<number | null>(null);
  const [tripDialogOpen, setTripDialogOpen] = useState(false);
  const [mobileNfcInvoiceOpen, setMobileNfcInvoiceOpen] = useState(false);
  const [expectedUnloadTripId, setExpectedUnloadTripId] = useState<number | undefined>();
  const [ticketDialogOpen, setTicketDialogOpen] = useState(false);
  const [ticketTripId, setTicketTripId] = useState<number | null>(null);
  const [freightPrintOpen, setFreightPrintOpen] = useState(false);
  const [startLoadAfterTripSave, setStartLoadAfterTripSave] = useState(false);
  const [cardCheckDialog, setCardCheckDialog] = useState<{ tripId: number; eventType: "load" | "unload"; siteId: number | null } | null>(null);
  const [fieldCardReceipt, setFieldCardReceipt] = useState<{ eventType: "load" | "unload"; needsReview: boolean; duplicate: boolean; reason: string | null; vehiclePlateNo: string | null; dailyVehicleTripOrdinal: number | null } | null>(null);
  const [fieldReaderDeviceId, setFieldReaderDeviceId] = useState(() => {
    try {
      return window.localStorage.getItem("yx.transport.fieldReaderDeviceId") || "FIELD-READER-01";
    } catch {
      return "FIELD-READER-01";
    }
  });
  const [nfcLinkToken] = useState(() => new URLSearchParams(window.location.search).get("nfc")?.trim() || "");
  /**
   * 只有受控读卡器桥接入口才允许携带设备编码并直接执行扫描状态机。
   * 车辆卡本身的签名链接不包含设备位置；若把任意启用设备当作默认值，
   * 手机触卡会既不弹出开票页，也可能被错误地解释为其它现场地点的扫描。
   */
  const [nfcLinkReaderDeviceCode] = useState(() => {
    const search = new URLSearchParams(window.location.search);
    return search.get("readerDeviceCode")?.trim() || search.get("reader")?.trim() || "";
  });
  const [nfcInvoiceResult, setNfcInvoiceResult] = useState<{ stage: "in_transit" | "completed"; singleScanClosed: boolean; duplicate: boolean; needsReview: boolean; reason: string | null; vehiclePlateNo: string | null; dailyVehicleTripOrdinal: number | null } | null>(null);
  const [fieldCardUid, setFieldCardUid] = useState("");
  const [editingVehicleId, setEditingVehicleId] = useState<number | null>(null);
  const [vehicleDraft, setVehicleDraft] = useState(EMPTY_VEHICLE_DRAFT);
  const [ruleDraft, setRuleDraft] = useState(EMPTY_RULE_DRAFT);
  const [siteDraft, setSiteDraft] = useState(EMPTY_TRANSPORT_SITE_DRAFT);
  const [routeDraft, setRouteDraft] = useState({ loadSiteId: "", unloadSiteId: "", freightRuleId: "", presetDistanceKm: "", minimumTransitMinutes: "10", unloadGeofenceMeters: "300", status: "active" as const });
  const [tripDraft, setTripDraft] = useState<TripDraft>(() => createTripDraft());
  const [plateVehicleSearch, setPlateVehicleSearch] = useState("");
  const [gpsStatus, setGpsStatus] = useState("打开趟次录入后将请求定位权限。");
  const [platePhotoFile, setPlatePhotoFile] = useState<File | null>(null);
  const [platePhotoPreview, setPlatePhotoPreview] = useState<string | null>(null);
  const [plateCameraOpen, setPlateCameraOpen] = useState(false);
  const plateCameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const plateCameraStreamRef = useRef<MediaStream | null>(null);
  const [plateUnloadDialogTripId, setPlateUnloadDialogTripId] = useState<number | null>(null);
  const [plateUnloadSiteId, setPlateUnloadSiteId] = useState<number | null>(null);
  const [unloadPreparing, setUnloadPreparing] = useState(false);
  const unloadSubmissionRef = useRef(false);
  const [unloadPhotoFile, setUnloadPhotoFile] = useState<File | null>(null);
  const [unloadPhotoPreview, setUnloadPhotoPreview] = useState<string | null>(null);
  const [unloadCameraOpen, setUnloadCameraOpen] = useState(false);
  const unloadCameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const unloadCameraStreamRef = useRef<MediaStream | null>(null);

  const projectOptions = trpc.transport.projectOptions.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  useEffect(() => { if (!projectId && projectOptions.data?.length) setProjectId(projectOptions.data[0].id); }, [projectId, projectOptions.data]);
  const selectedProjectId = projectId ?? 0;
  const tripDraftKey = `transport-trip:${selectedProjectId || "pending"}:new`;
  const toTripLocalDraft = (draft: TripDraft, selectedVehicleId: number | undefined): TripLocalDraft => ({
    mode: draft.invoiceMode,
    routePresetId: draft.routePresetId,
    freightRuleId: draft.freightRuleId,
    loadSiteId: draft.loadSiteId,
    unloadSiteId: draft.unloadSiteId,
    tripNo: draft.tripNo,
    startAt: draft.startAt,
    endAt: draft.endAt,
    actualDistanceKm: draft.actualDistanceKm,
    volumeCubicMeters: draft.volumeCubicMeters,
    weightTons: draft.weightTons,
    vehicleId: selectedVehicleId ? String(selectedVehicleId) : "",
  });
  const [tripInitialLocalDraft, setTripInitialLocalDraft] = useState<TripLocalDraft>(() => toTripLocalDraft(createTripDraft(), undefined));
  const [tripDraftRestored, setTripDraftRestored] = useState(false);
  const tripRestoreAttemptedRef = useRef("");
  const tripLocalDraft = useMemo(() => toTripLocalDraft(tripDraft, tripVehicleId), [tripDraft, tripVehicleId]);
  // 默认路线、开票方式和自动时间在打开表单时已记录为基线，避免默认值误报为未提交输入。
  const tripDraftDirty = tripDialogOpen && (tripDraftRestored || JSON.stringify(tripLocalDraft) !== JSON.stringify(tripInitialLocalDraft) || Boolean(platePhotoFile));
  function clearPendingTripMedia() {
    stopPlateCamera();
    if (platePhotoPreview) URL.revokeObjectURL(platePhotoPreview);
    setPlatePhotoPreview(null);
    setPlatePhotoFile(null);
  }
  function closeTripForm() {
    clearPendingTripMedia();
    setTripDialogOpen(false);
    setTripDraft(createTripDraft());
    setTripDraftRestored(false);
    tripRestoreAttemptedRef.current = "";
  }
  function saveTripLocalDraft() {
    if (!hasMobileDraftContent(tripLocalDraft, ["mode", "startAt"])) {
      clearMobileDraft(tripDraftKey);
      return true;
    }
    return saveMobileDraft(tripDraftKey, tripLocalDraft);
  }
  const { requestClose: requestTripClose } = useMobileFormProtection({
    id: "mobile-transport-trip-form",
    label: platePhotoFile ? "运输运单（已拍照片需重新拍摄）" : "运输运单",
    isDirty: tripDraftDirty,
    saveDraft: () => { if (!saveTripLocalDraft()) throw new Error("本机草稿保存失败"); clearPendingTripMedia(); },
    discard: () => { clearMobileDraft(tripDraftKey); closeTripForm(); },
  });
  useEffect(() => {
    if (!tripDialogOpen || tripRestoreAttemptedRef.current === tripDraftKey) return;
    tripRestoreAttemptedRef.current = tripDraftKey;
    const saved = readMobileDraft<TripLocalDraft>(tripDraftKey);
    if (!saved || !hasMobileDraftContent(saved.value, ["mode", "startAt"])) return;
    const { vehicleId: savedVehicleId, mode, ...savedTrip } = saved.value;
    setTripDraft(current => ({ ...current, ...savedTrip, ...(mode ? { invoiceMode: mode } : {}) }));
    const numericVehicleId = Number(savedVehicleId);
    if (Number.isInteger(numericVehicleId) && numericVehicleId > 0) setTripVehicleId(numericVehicleId);
    setTripDraftRestored(true);
    toast.info("已恢复这台设备上未提交的运单文字草稿；照片、凭证和定位需重新获取。");
  }, [tripDialogOpen, tripDraftKey]);
  const projectInput = useMemo(() => ({ projectId: selectedProjectId }), [selectedProjectId]);
  const tripsInput = useMemo(() => ({ projectId: selectedProjectId, date: workDate }), [selectedProjectId, workDate]);
  const vehicles = trpc.transport.listVehicles.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const freightRules = trpc.transport.listFreightRules.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const transportSites = trpc.transport.listSites.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const transportSiteManagementAccess = trpc.transport.siteManagementAccess.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const routePresets = trpc.transport.listRoutePresets.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const trips = trpc.transport.listTrips.useQuery(tripsInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const summary = trpc.transport.dailySummary.useQuery(tripsInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const unreadMessages = trpc.messages.unreadCount.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const captureConfig = trpc.evidence.captureConfig.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const evidenceUpload = trpc.evidence.upload.useMutation({ onError: error => toast.error(getUserFacingErrorMessage(error, "运输操作未完成，请稍后重试")) });
  const pendingCardTrips = useMemo(() => (trips.data ?? []).filter(trip => !["void", "settled"].includes(trip.status) && (!trip.loadConfirmedAt || !trip.unloadConfirmedAt)), [trips.data]);
  const activeLoadSites = useMemo(() => (transportSites.data ?? []).filter(site => site.siteType === "load" && site.status === "active"), [transportSites.data]);
  const activeUnloadSites = useMemo(() => (transportSites.data ?? []).filter(site => site.siteType === "unload" && site.status === "active"), [transportSites.data]);
  const platePhotoVehicleCandidates = useMemo(() => {
    const keyword = plateVehicleSearch.trim().toUpperCase();
    return (vehicles.data ?? []).filter(vehicle => vehicle.status === "active" && (!keyword || vehicle.plateNo.toUpperCase().includes(keyword)));
  }, [plateVehicleSearch, vehicles.data]);

  useEffect(() => {
    if (!vehicleId && vehicles.data?.length) setVehicleId(vehicles.data[0].id);
    if (vehicleId && vehicles.data && !vehicles.data.some(vehicle => vehicle.id === vehicleId)) setVehicleId(vehicles.data[0]?.id);
  }, [vehicleId, vehicles.data]);

  useEffect(() => {
    try {
      window.localStorage.setItem("yx.transport.fieldReaderDeviceId", fieldReaderDeviceId.trim() || "FIELD-READER-01");
    } catch {
      // 浏览器禁用本地存储时仍可正常手工输入 UID。
    }
  }, [fieldReaderDeviceId]);

  const nfcLinkScanStartedRef = useRef(false);
  const nfcLinkDialogOpenedRef = useRef(false);

  useEffect(() => {
    if (!nfcLinkToken || nfcLinkReaderDeviceCode || nfcLinkDialogOpenedRef.current) return;
    nfcLinkDialogOpenedRef.current = true;
    setMobileNfcInvoiceOpen(true);
  }, [nfcLinkReaderDeviceCode, nfcLinkToken]);

  useEffect(() => {
    if (!nfcLinkToken || !nfcLinkReaderDeviceCode || nfcLinkScanStartedRef.current) return;
    nfcLinkScanStartedRef.current = true;
    submitNfcLinkScan();
  }, [nfcLinkReaderDeviceCode, nfcLinkToken]);

  /** 定位仅在用户主动打开趟次录入后发起；初次坐标作为起点，持续更新作为终点。 */
  useEffect(() => {
    if (!tripDialogOpen) return;
    if (!("geolocation" in navigator)) {
      setGpsStatus("当前设备不支持浏览器定位，可继续录入但将产生定位完整性提示。");
      return;
    }
    setGpsStatus("正在获取 GPS 定位…");
    const watchId = navigator.geolocation.watchPosition(
      position => {
        const { latitude, longitude } = position.coords;
        setTripDraft(current => current.startLatitude === null || current.startLongitude === null
          ? { ...current, startLatitude: latitude, startLongitude: longitude, endLatitude: latitude, endLongitude: longitude }
          : { ...current, endLatitude: latitude, endLongitude: longitude });
        setGpsStatus(`已定位，精度约 ${Math.round(position.coords.accuracy)} 米；保存时将写入起终点快照。`);
      },
      () => setGpsStatus("未取得定位权限或定位失败，可继续录入；提交后将提示定位不完整。"),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 12_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [tripDialogOpen]);

  /** 车牌备用票据只允许现场直拍；关闭、取消或离开页面后立即释放相机权限。 */
  function stopPlateCamera() {
    plateCameraStreamRef.current?.getTracks().forEach(track => track.stop());
    plateCameraStreamRef.current = null;
    if (plateCameraVideoRef.current) plateCameraVideoRef.current.srcObject = null;
    setPlateCameraOpen(false);
  }

  async function startPlateCamera() {
    prepareSpeech();
    if (!navigator.mediaDevices?.getUserMedia) return toast.error("当前浏览器不支持直接调用相机，请使用支持相机权限的手机浏览器");
    try {
      stopPlateCamera();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      plateCameraStreamRef.current = stream;
      setPlateCameraOpen(true);
    } catch {
      toast.error("无法打开后置相机。请在浏览器设置中允许相机权限后重试");
    }
  }

  function capturePlatePhoto() {
    const video = plateCameraVideoRef.current;
    if (!video?.videoWidth || !video.videoHeight) return toast.error("相机仍在启动，请稍候再拍照");
    const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) return toast.error("当前浏览器不支持车牌照片处理");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (!blob) return toast.error("车牌照片生成失败，请重新拍摄");
      if (platePhotoPreview) URL.revokeObjectURL(platePhotoPreview);
      const file = new File([blob], `transport-plate-${Date.now()}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
      setPlatePhotoFile(file);
      setPlatePhotoPreview(URL.createObjectURL(file));
      stopPlateCamera();
    }, "image/jpeg", .92);
  }

  useEffect(() => {
    if (!plateCameraOpen || !plateCameraVideoRef.current || !plateCameraStreamRef.current) return;
    plateCameraVideoRef.current.srcObject = plateCameraStreamRef.current;
    void plateCameraVideoRef.current.play().catch(() => toast.error("相机预览启动失败，请重新打开相机"));
  }, [plateCameraOpen]);

  useEffect(() => () => {
    plateCameraStreamRef.current?.getTracks().forEach(track => track.stop());
    unloadCameraStreamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  function stopUnloadCamera() {
    unloadCameraStreamRef.current?.getTracks().forEach(track => track.stop());
    unloadCameraStreamRef.current = null;
    if (unloadCameraVideoRef.current) unloadCameraVideoRef.current.srcObject = null;
    setUnloadCameraOpen(false);
  }

  async function startUnloadCamera() {
    prepareSpeech();
    if (!navigator.mediaDevices?.getUserMedia) return toast.error("当前浏览器不支持直接调用相机，请使用支持相机权限的手机浏览器");
    try {
      stopUnloadCamera();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      unloadCameraStreamRef.current = stream;
      setUnloadCameraOpen(true);
    } catch {
      toast.error("无法打开后置相机。请在浏览器设置中允许相机权限后重试");
    }
  }

  function captureUnloadPhoto() {
    const video = unloadCameraVideoRef.current;
    if (!video?.videoWidth || !video.videoHeight) return toast.error("相机仍在启动，请稍候再拍照");
    const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) return toast.error("当前浏览器不支持卸土照片处理");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (!blob) return toast.error("卸土现场照片生成失败，请重新拍摄");
      if (unloadPhotoPreview) URL.revokeObjectURL(unloadPhotoPreview);
      const file = new File([blob], `transport-unload-${Date.now()}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
      setUnloadPhotoFile(file);
      setUnloadPhotoPreview(URL.createObjectURL(file));
      stopUnloadCamera();
    }, "image/jpeg", .92);
  }

  useEffect(() => {
    if (!unloadCameraOpen || !unloadCameraVideoRef.current || !unloadCameraStreamRef.current) return;
    unloadCameraVideoRef.current.srcObject = unloadCameraStreamRef.current;
    void unloadCameraVideoRef.current.play().catch(() => toast.error("卸土现场相机预览启动失败，请重新打开相机"));
  }, [unloadCameraOpen]);

  const saveVehicle = trpc.transport.saveVehicle.useMutation({ onSuccess: async data => { toast.success(`车辆台账已保存，理论方量 ${data.theoreticalVolumeCubicMeters} m³`); setVehicleDialogOpen(false); await utils.transport.listVehicles.invalidate(); }, onError: error => toast.error(getUserFacingErrorMessage(error, "运输操作未完成，请稍后重试")) });
  const saveRule = trpc.transport.saveFreightRule.useMutation({ onSuccess: async () => { toast.success("阶梯运价规则已保存"); setRuleDialogOpen(false); await utils.transport.listFreightRules.invalidate(); }, onError: error => toast.error(getUserFacingErrorMessage(error, "运输操作未完成，请稍后重试")) });
  const saveSite = trpc.transport.saveSite.useMutation({ onSuccess: async () => { toast.success("运输现场地点已保存"); setSiteDialogOpen(false); await utils.transport.listSites.invalidate(); }, onError: error => toast.error(getUserFacingErrorMessage(error, "运输操作未完成，请稍后重试")) });
  const saveRoutePreset = trpc.transport.saveRoutePreset.useMutation({ onSuccess: async () => { toast.success("运输路线已保存，发票将自动带入公里数和运价"); setRouteDialogOpen(false); await utils.transport.listRoutePresets.invalidate(); }, onError: error => toast.error(getUserFacingErrorMessage(error, "运输操作未完成，请稍后重试")) });
  const saveTrip = trpc.transport.saveTrip.useMutation({
    onSuccess: async (data, input) => {
      const receiptText = formatVehicleStageReceipt(data.vehiclePlateNo, data.dailyVehicleTripOrdinal, "load");
      const photoReceipt = receiptText?.replace("装土成功", "拍照发票成功") ?? `车牌 ${data.vehiclePlateNo ?? "车辆"}，拍照发票成功`;
      toast.success(input.invoiceMode === "plate_photo" ? `${photoReceipt}！${data.tripNo || "运单号已自动生成"}` : data.anomalies.length ? `运输票据已保存，发现 ${data.anomalies.length} 项待核验提示` : `运输票据已保存，系统核算 ${formatMoney(data.amount)}`);
      if (input.invoiceMode === "plate_photo") speakTransportReceipt(`${photoReceipt}，车辆已发车，请前往卸土点。`, `photo-load:${data.tripNo}`);
      clearMobileDraft(tripDraftKey);
      closeTripForm();
      await Promise.all([utils.transport.listTrips.invalidate(), utils.transport.dailySummary.invalidate()]);
      if (startLoadAfterTripSave) {
        setStartLoadAfterTripSave(false);
        toast.info("装土票据已生成，请在“刷卡票据”中选择该票据完成装土刷卡。");
        setTicketDialogOpen(true);
      }
    },
    onError: error => toast.error(getUserFacingErrorMessage(error, "运输操作未完成，请稍后重试")),
  });
  const transitionTrip = trpc.transport.transitionTrip.useMutation({ onSuccess: async () => { toast.success("趟次状态已更新"); await Promise.all([utils.transport.listTrips.invalidate(), utils.transport.dailySummary.invalidate()]); }, onError: error => toast.error(getUserFacingErrorMessage(error, "运输操作未完成，请稍后重试")) });
  const recordLoadEvent = trpc.transport.recordLoadEvent.useMutation({
    onSuccess: async result => {
      const vehiclePlateNo = "vehiclePlateNo" in result ? result.vehiclePlateNo ?? null : null;
      const dailyVehicleTripOrdinal = "dailyVehicleTripOrdinal" in result ? result.dailyVehicleTripOrdinal ?? null : null;
      const receiptText = formatVehicleStageReceipt(vehiclePlateNo, dailyVehicleTripOrdinal, "load");
      const safeReason = getSafeCardValidationReason(result.reason);
      setFieldCardReceipt({ eventType: "load", needsReview: result.needsReview, duplicate: result.duplicate, reason: safeReason, vehiclePlateNo, dailyVehicleTripOrdinal });
      toast.success(result.needsReview ? `装土刷卡已留痕，需人工复核：${safeReason ?? "请核对"}` : result.duplicate ? "装土刷卡已处理，无需重复确认" : `${receiptText ?? "装土刷卡已确认"}，请向司机展示现场回执`);
      setCardCheckDialog(null);
      setFieldCardUid("");
      await Promise.all([utils.transport.listTrips.invalidate(), utils.transport.dailySummary.invalidate()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error, "运输操作未完成，请稍后重试")),
  });
  const recordUnloadEvent = trpc.transport.recordUnloadEvent.useMutation({
    onSuccess: async result => {
      const vehiclePlateNo = "vehiclePlateNo" in result ? result.vehiclePlateNo ?? null : null;
      const dailyVehicleTripOrdinal = "dailyVehicleTripOrdinal" in result ? result.dailyVehicleTripOrdinal ?? null : null;
      const receiptText = formatVehicleStageReceipt(vehiclePlateNo, dailyVehicleTripOrdinal, "unload");
      const safeReason = getSafeCardValidationReason(result.reason);
      setFieldCardReceipt({ eventType: "unload", needsReview: result.needsReview, duplicate: result.duplicate, reason: safeReason, vehiclePlateNo, dailyVehicleTripOrdinal });
      toast.success(result.needsReview ? `卸土刷卡已留痕，需人工复核：${safeReason ?? "请核对"}` : result.duplicate ? "卸土刷卡已处理，无需重复确认" : `${receiptText ?? "卸土刷卡已确认"}，请向司机展示现场回执`);
      setCardCheckDialog(null);
      setFieldCardUid("");
      await Promise.all([utils.transport.listTrips.invalidate(), utils.transport.dailySummary.invalidate()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error, "运输操作未完成，请稍后重试")),
  });
  const confirmPlatePhotoUnload = trpc.transport.confirmPlatePhotoUnload.useMutation({
    onSuccess: async (result, input) => {
      const vehiclePlateNo = "vehiclePlateNo" in result ? result.vehiclePlateNo ?? null : null;
      const dailyVehicleTripOrdinal = "dailyVehicleTripOrdinal" in result ? result.dailyVehicleTripOrdinal ?? null : null;
      const receiptText = formatVehicleStageReceipt(vehiclePlateNo, dailyVehicleTripOrdinal, "unload");
      const safetyNotice = getSafeCardValidationReason(result.reason);
      const message = (result.duplicate ? `车牌 ${vehiclePlateNo ?? "车辆"}，卸土已确认，无需重复办理。` : `${receiptText ?? `车牌 ${vehiclePlateNo ?? "车辆"}，卸土成功`}，本趟运输已完成闭环。`) + (result.needsReview ? `存在安全提示，待人工核验：${safetyNotice ?? "请核对现场记录"}。` : "");
      toast.success(message);
      speakTransportReceipt(message, `photo-unload:${input.tripId}:${result.duplicate ? "acknowledged" : "completed"}`);
      unloadSubmissionRef.current = false;
      setUnloadPreparing(false);
      closePlatePhotoUnloadForm();
      await Promise.all([utils.transport.listTrips.invalidate(), utils.transport.dailySummary.invalidate()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error, "运输操作未完成，请稍后重试")),
  });
  const scanNfcLink = trpc.transport.scanNfcLink.useMutation({
    onSuccess: async result => {
      const singleScanClosed = Boolean(result.singleScanClosed);
      const eventType = result.stage === "in_transit" || singleScanClosed ? "load" : "unload";
      const vehiclePlateNo = "vehiclePlateNo" in result ? result.vehiclePlateNo ?? null : null;
      const dailyVehicleTripOrdinal = "dailyVehicleTripOrdinal" in result ? result.dailyVehicleTripOrdinal ?? null : null;
      const receiptText = formatVehicleStageReceipt(vehiclePlateNo, dailyVehicleTripOrdinal, eventType);
      const safeReason = getSafeCardValidationReason(result.reason);
      setNfcInvoiceResult({ stage: result.stage, singleScanClosed, duplicate: result.duplicate, needsReview: result.needsReview, reason: safeReason, vehiclePlateNo, dailyVehicleTripOrdinal });
      toast.success(result.needsReview ? `刷卡事件已留痕，需人工复核：${safeReason ?? "请核对"}` : result.duplicate ? singleScanClosed ? "该次单次刷卡闭环已处理，无需重复确认" : "该次刷卡已处理，无需重复确认" : `${receiptText ?? (eventType === "load" ? "装土刷卡成功" : "卸土成功")}，${singleScanClosed ? "本趟已直接完成闭环并进入待核验" : eventType === "load" ? "车辆已进入运输中" : "运输票据已进入待核验"}`);
      await Promise.all([utils.transport.listTrips.invalidate(), utils.transport.dailySummary.invalidate()]);
    },
    onError: error => toast.error(getUserFacingErrorMessage(error, "运输操作未完成，请稍后重试")),
  });

  function openVehicleDialog(vehicle?: NonNullable<typeof vehicles.data>[number]) {
    setEditingVehicleId(vehicle?.id ?? null);
    setVehicleDraft(vehicle ? { plateNo: vehicle.plateNo, ownership: vehicle.ownership, ownerName: vehicle.ownerName ?? "", driverPersonId: vehicle.driverPersonId ? String(vehicle.driverPersonId) : "", driverUserId: vehicle.driverUserId ? String(vehicle.driverUserId) : "", driverName: vehicle.driverName ?? "", driverPhone: vehicle.driverPhoneMasked ?? "", boxLengthMeters: String(vehicle.boxLengthMeters), boxWidthMeters: String(vehicle.boxWidthMeters), boxHeightMeters: String(vehicle.boxHeightMeters), loadFactor: String(vehicle.loadFactor), payloadTons: vehicle.payloadTons ? String(vehicle.payloadTons) : "", status: vehicle.status } : EMPTY_VEHICLE_DRAFT);
    setVehicleDialogOpen(true);
  }

  function submitVehicle() {
    if (!selectedProjectId) return toast.error("请先选择项目");
    if (!vehicleDraft.plateNo.trim() || !vehicleDraft.boxLengthMeters || !vehicleDraft.boxWidthMeters || !vehicleDraft.boxHeightMeters) return toast.error("请填写车牌和货厢长、宽、高");
    saveVehicle.mutate({ id: editingVehicleId ?? undefined, projectId: selectedProjectId, plateNo: vehicleDraft.plateNo.trim(), ownership: vehicleDraft.ownership, ownerName: vehicleDraft.ownerName.trim() || null, driverPersonId: vehicleDraft.driverPersonId ? Number(vehicleDraft.driverPersonId) : null, driverUserId: vehicleDraft.driverUserId ? Number(vehicleDraft.driverUserId) : null, driverName: vehicleDraft.driverName.trim() || null, driverPhone: vehicleDraft.driverPhone.trim() && !vehicleDraft.driverPhone.includes("*") ? vehicleDraft.driverPhone.trim() : undefined, boxLengthMeters: Number(vehicleDraft.boxLengthMeters), boxWidthMeters: Number(vehicleDraft.boxWidthMeters), boxHeightMeters: Number(vehicleDraft.boxHeightMeters), loadFactor: Number(vehicleDraft.loadFactor || 1), payloadTons: vehicleDraft.payloadTons ? Number(vehicleDraft.payloadTons) : null, status: vehicleDraft.status });
  }

  function submitRule() {
    if (!selectedProjectId || !ruleDraft.basePricePerUnit) return toast.error("请填写项目和基础运价");
    saveRule.mutate({ projectId: selectedProjectId, materialName: ruleDraft.materialName.trim() || null, settlementUnit: ruleDraft.settlementUnit, startDistanceKm: Number(ruleDraft.startDistanceKm), basePricePerUnit: Number(ruleDraft.basePricePerUnit), stepMeters: Number(ruleDraft.stepMeters), stepIncreasePerUnit: Number(ruleDraft.stepIncreasePerUnit), effectiveFrom: ruleDraft.effectiveFrom, effectiveTo: ruleDraft.effectiveTo || null, status: ruleDraft.status });
  }

  function openSiteDialog(site?: NonNullable<typeof transportSites.data>[number], newSiteType: TransportSiteDraft["siteType"] = "load") {
    setEditingSiteId(site?.id ?? null);
    setSiteDraft(site ? { siteType: site.siteType, name: site.name, address: site.address ?? "", administratorUserId: site.administratorUserId ? String(site.administratorUserId) : "", status: site.status } : { ...EMPTY_TRANSPORT_SITE_DRAFT, siteType: newSiteType });
    setSiteDialogOpen(true);
  }

  function submitSite() {
    if (!selectedProjectId || !siteDraft.name.trim()) return toast.error("请填写地点名称");
    if (!siteDraft.address.trim()) return toast.error("请填写可定位的中文详细地址");
    saveSite.mutate({ id: editingSiteId ?? undefined, projectId: selectedProjectId, siteType: siteDraft.siteType, name: siteDraft.name.trim(), address: siteDraft.address.trim(), administratorUserId: siteDraft.administratorUserId ? Number(siteDraft.administratorUserId) : null, status: siteDraft.status });
  }

  function submitRoutePreset() {
    if (!selectedProjectId || !routeDraft.loadSiteId || !routeDraft.unloadSiteId || !routeDraft.freightRuleId || !routeDraft.presetDistanceKm) return toast.error("请完整选择装土点、卸土点、生效运价并填写预设公里数");
    const minimumTransitMinutes = Number(routeDraft.minimumTransitMinutes);
    const unloadGeofenceMeters = Number(routeDraft.unloadGeofenceMeters);
    if (!Number.isInteger(minimumTransitMinutes) || minimumTransitMinutes < 1 || !Number.isInteger(unloadGeofenceMeters) || unloadGeofenceMeters < 30) return toast.error("请填写有效的最短运输时间和卸土定位容差");
    saveRoutePreset.mutate({ projectId: selectedProjectId, loadSiteId: Number(routeDraft.loadSiteId), unloadSiteId: Number(routeDraft.unloadSiteId), freightRuleId: Number(routeDraft.freightRuleId), presetDistanceKm: Number(routeDraft.presetDistanceKm), minimumTransitMinutes, unloadGeofenceMeters, status: routeDraft.status });
  }

  async function submitTrip() {
    if (tripDraft.invoiceMode === "plate_photo") prepareSpeech();
    if (!selectedProjectId || !tripVehicleId || !tripDraft.routePresetId) return toast.error("请先选择车牌和已设置的运输路线");
    if (tripDraft.invoiceMode === "nfc_card" && tripDraft.evidenceId && (!Number.isInteger(Number(tripDraft.evidenceId)) || Number(tripDraft.evidenceId) <= 0)) return toast.error("现场影像编号应为正整数");
    try {
      let evidenceId = tripDraft.evidenceId ? Number(tripDraft.evidenceId) : null;
      if (tripDraft.invoiceMode === "plate_photo") {
        if (!platePhotoFile) return toast.error("请先现场直拍清晰车牌照片");
        const location = tripDraft.startLatitude !== null && tripDraft.startLongitude !== null ? { latitude: tripDraft.startLatitude, longitude: tripDraft.startLongitude } : null;
        if (captureConfig.data?.location.required && !location) throw new Error("当前项目要求车牌直拍时读取现场定位");
        const capturedAt = new Date();
        const selectedVehicle = vehicles.data?.find(vehicle => vehicle.id === tripVehicleId);
        const template = captureConfig.data?.watermark ?? DEFAULT_EVIDENCE_WATERMARK_TEMPLATE;
        const antiCounterfeit = `${selectedProjectId}-${tripVehicleId}-${capturedAt.getTime().toString(36).toUpperCase()}`;
        const route = routePresets.data?.find(item => item.id === Number(tripDraft.routePresetId));
        const loadAddress = (transportSites.data ?? []).find(site => site.id === route?.loadSiteId)?.address;
        const detailedAddress = loadAddress || "现场详细地址待补充";
        const values: Record<string, string> = { capturedAt: `拍摄时间：${formatChinaDateTime(capturedAt)}`, principal: `票据录入人：${user?.name || "当前管理员"}`, weather: "票据方式：车牌直拍", location: `详细地点：${detailedAddress}`, coordinates: `详细地点：${detailedAddress}`, organization: `施工单位：${template.organizationLabel}`, project: `项目名称：${selectedProject?.name ?? `项目 #${selectedProjectId}`}`, antiCounterfeit: `防伪编号：${antiCounterfeit}` };
        const watermarkedFile = await createWatermarkedTransportImage(platePhotoFile, template.fields.map(field => values[field]).filter(Boolean), template);
        const upload = await evidenceUpload.mutateAsync({ projectId: selectedProjectId, sourceType: "transport", sourceId: `transport-plate-pending-${tripVehicleId}-${capturedAt.getTime()}`, description: `拍照车牌运输票据 · ${selectedVehicle?.plateNo ?? `车辆 #${tripVehicleId}`}`.slice(0, 500), capturedAt: capturedAt.toISOString(), longitude: location?.longitude ?? null, latitude: location?.latitude ?? null, fileName: watermarkedFile.name, mimeType: "image/jpeg", base64Data: await readImageAsBase64(watermarkedFile) });
        evidenceId = upload.id;
      }
      const systemIssuedAt = new Date().toISOString();
      saveTrip.mutate({ tripNo: tripDraft.tripNo.trim() || undefined, vehicleId: tripVehicleId, projectId: selectedProjectId, routePresetId: Number(tripDraft.routePresetId), invoiceMode: tripDraft.invoiceMode, startAt: tripDraft.invoiceMode === "plate_photo" ? systemIssuedAt : new Date(tripDraft.startAt).toISOString(), endAt: tripDraft.invoiceMode === "plate_photo" ? null : tripDraft.endAt ? new Date(tripDraft.endAt).toISOString() : null, weightTons: tripDraft.invoiceMode === "plate_photo" ? null : tripDraft.weightTons ? Number(tripDraft.weightTons) : null, evidenceId, startLatitude: tripDraft.startLatitude, startLongitude: tripDraft.startLongitude, endLatitude: tripDraft.endLatitude, endLongitude: tripDraft.endLongitude });
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "车牌直拍凭证处理失败，请稍后重试"));
    }
  }

  function openTripDialog(startLoadAfterSave = false, invoiceMode: TripDraft["invoiceMode"] = "nfc_card") {
    if (invoiceMode === "plate_photo") prepareSpeech();
    const defaultRoute = routePresets.data?.find(route => route.status === "active" && route.isDefault) ?? routePresets.data?.find(route => route.status === "active");
    clearPendingTripMedia();
    setPlateVehicleSearch("");
    const nextDraft = { ...createTripDraft(defaultRoute ? String(defaultRoute.freightRuleId) : "", invoiceMode), routePresetId: defaultRoute ? String(defaultRoute.id) : "", loadSiteId: defaultRoute ? String(defaultRoute.loadSiteId) : "", unloadSiteId: defaultRoute ? String(defaultRoute.unloadSiteId) : "", actualDistanceKm: defaultRoute ? String(defaultRoute.presetDistanceKm) : "" };
    setTripDraft(nextDraft);
    setTripVehicleId(undefined);
    setTripInitialLocalDraft(toTripLocalDraft(nextDraft, undefined));
    setTripDraftRestored(false);
    tripRestoreAttemptedRef.current = "";
    setStartLoadAfterTripSave(startLoadAfterSave);
    setGpsStatus("正在准备定位…");
    setTripDialogOpen(true);
  }

  function openTicketDialog() {
    const first = pendingCardTrips[0];
    setTicketTripId(first?.id ?? null);
    setTicketDialogOpen(true);
  }

  useEffect(() => {
    const openCardEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ tripId?: number; eventType?: "load" | "unload"; siteId?: number | null }>).detail;
      if (!detail?.tripId || !detail.eventType) return;
      setFieldCardUid("");
      setCardCheckDialog({ tripId: detail.tripId, eventType: detail.eventType, siteId: detail.siteId ?? null });
    };
    window.addEventListener("road-transport-card-event", openCardEvent);
    return () => window.removeEventListener("road-transport-card-event", openCardEvent);
  }, []);

  /** 读卡器通常以键盘方式输出 UID；原始 UID 仅在浏览器内生成 SHA-256 指纹后发送，避免进入事件审计和服务端明文。 */
  async function submitFieldCardEvent() {
    if (!cardCheckDialog || !selectedProjectId || !fieldCardUid.trim()) return toast.error("请读取或填写射频卡 UID");
    if (!window.crypto?.subtle) return toast.error("当前浏览器不支持安全卡片指纹，请使用受支持的现场终端");
    const bytes = new TextEncoder().encode(`road-rfid-card:v1:${fieldCardUid.trim().toUpperCase()}`);
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", bytes);
    const cardFingerprint = Array.from(new Uint8Array(hashBuffer)).map(value => value.toString(16).padStart(2, "0")).join("");
    const input = { tripId: cardCheckDialog.tripId, projectId: selectedProjectId, siteId: cardCheckDialog.siteId, idempotencyKey: `field-${cardCheckDialog.eventType}-${crypto.randomUUID()}`, deviceId: fieldReaderDeviceId.trim() || undefined, cardFingerprint, occurredAt: new Date().toISOString() };
    if (cardCheckDialog.eventType === "load") recordLoadEvent.mutate(input); else recordUnloadEvent.mutate(input);
  }

  function submitNfcLinkScan() {
    if (!nfcLinkToken) return;
    if (!nfcLinkReaderDeviceCode) return toast.error("读卡器入口未提供已登记设备编码，已改为打开刷卡发票页面");
    scanNfcLink.mutate({ token: nfcLinkToken, readerDeviceCode: nfcLinkReaderDeviceCode, idempotencyKey: `nfc-link-${crypto.randomUUID()}`, latitude: null, longitude: null, occurredAt: new Date().toISOString() });
  }

  function closePlatePhotoUnloadForm() {
    if (unloadSubmissionRef.current) return toast.info("正在读取定位并提交卸土，请完成后再关闭。");
    stopUnloadCamera();
    if (unloadPhotoPreview) URL.revokeObjectURL(unloadPhotoPreview);
    setUnloadPhotoFile(null);
    setUnloadPhotoPreview(null);
    setPlateUnloadDialogTripId(null);
    setPlateUnloadSiteId(null);
  }
  function openCardUnloadDialog(tripId: number) {
    setExpectedUnloadTripId(tripId);
    setMobileNfcInvoiceOpen(true);
  }
  function openPlatePhotoUnloadDialog(tripId: number, unloadSiteId?: number) {
    if (unloadSubmissionRef.current) return;
    prepareSpeech();
    if (unloadPhotoPreview) URL.revokeObjectURL(unloadPhotoPreview);
    setUnloadPhotoFile(null);
    setUnloadPhotoPreview(null);
    setPlateUnloadDialogTripId(tripId);
    setPlateUnloadSiteId(unloadSiteId ?? trips.data?.find(trip => trip.id === tripId)?.unloadSiteId ?? null);
  }

  async function confirmPlatePhotoTripUnload(tripId: number) {
    prepareSpeech();
    if (unloadSubmissionRef.current || confirmPlatePhotoUnload.isPending) return;
    if (!selectedProjectId || !unloadPhotoFile) return toast.error("请先使用后置相机拍摄卸土现场照片");
    const project = selectedProjectId;
    const photo = unloadPhotoFile;
    const trip = (trips.data ?? []).find(item => item.id === tripId);
    const unloadSite = (transportSites.data ?? []).find(site => site.id === (plateUnloadSiteId ?? trip?.unloadSiteId));
    unloadSubmissionRef.current = true;
    setUnloadPreparing(true);
    let confirmStarted = false;
    try {
      const location = await resolvePhotoUnloadLocation(unloadSite?.unloadGeofenceEnabled, navigator.geolocation);
      if (!location) toast.info("未取得现场定位；卸土点已关闭定位硬拦截，将提交照片并留待核验。服务端仍会复核当前规则。");
      const capturedAt = new Date();
      const template = captureConfig.data?.watermark ?? DEFAULT_EVIDENCE_WATERMARK_TEMPLATE;
      const antiCounterfeit = `${project}-${tripId}-UNLOAD-${capturedAt.getTime().toString(36).toUpperCase()}`;
      const values: Record<string, string> = { capturedAt: `拍摄时间：${formatChinaDateTime(capturedAt)}`, principal: `卸土确认人：${user?.name || "当前管理员"}`, weather: "现场环节：卸土确认", location: `详细地点：${unloadSite?.address || "卸土点地址待补充"}`, coordinates: location ? `现场定位：${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}` : "现场定位：未取得（待核验）", organization: `施工单位：${template.organizationLabel}`, project: `项目名称：${selectedProject?.name ?? `项目 #${project}`}`, antiCounterfeit: `防伪编号：${antiCounterfeit}` };
      const watermarkedFile = await createWatermarkedTransportImage(photo, template.fields.map(field => values[field]).filter(Boolean), template);
      const upload = await evidenceUpload.mutateAsync({ projectId: project, sourceType: "transport", sourceId: `transport-unload-pending-${tripId}-${capturedAt.getTime()}`, description: `直拍票据卸土现场照片 · ${trip?.tripNo ?? `运单 #${tripId}`}`.slice(0, 500), capturedAt: capturedAt.toISOString(), longitude: location?.longitude ?? null, latitude: location?.latitude ?? null, fileName: watermarkedFile.name, mimeType: "image/jpeg", base64Data: await readImageAsBase64(watermarkedFile) });
      if (!upload.id) throw new Error("卸土现场照片未取得归档编号，请重新拍摄后确认");
      confirmStarted = true;
      await confirmPlatePhotoUnload.mutateAsync({ tripId, projectId: project, unloadEvidenceId: upload.id, idempotencyKey: `plate-unload-${tripId}-${crypto.randomUUID()}`, latitude: location?.latitude ?? null, longitude: location?.longitude ?? null, occurredAt: capturedAt.toISOString() });
    } catch (error) {
      if (!confirmStarted) toast.error(getUserFacingErrorMessage(error, "卸土现场照片归档失败，请稍后重试"));
    } finally {
      unloadSubmissionRef.current = false;
      setUnloadPreparing(false);
    }
  }

  if (loading || !isAuthenticated || projectOptions.isLoading) return <MobileAccessGate isAuthenticated={isAuthenticated} isLoading={loading || (isAuthenticated && projectOptions.isLoading)} authLoadingTimedOut={authLoadingTimedOut} loadingText="正在加载运输管理权限…" title="运输管理" description="请使用企业统一身份进入已授权项目的运输调度数据。" Icon={Truck} onRetry={() => { void refresh(); void projectOptions.refetch(); }} />;

  const selectedProject = projectOptions.data?.find(item => item.id === selectedProjectId);
  const selectedTicketTrip = pendingCardTrips.find(trip => trip.id === ticketTripId) ?? null;
  const selectedTicketSiteId = selectedTicketTrip ? (selectedTicketTrip.loadConfirmedAt ? selectedTicketTrip.unloadSiteId : selectedTicketTrip.loadSiteId) : null;
  const selectedTicketSite = (transportSites.data ?? []).find(site => site.id === selectedTicketSiteId) ?? null;
  return <div className="min-h-screen bg-[#f8f1e7] text-[#3b2118]"><div className="mobile-viewport-shell mx-auto min-h-screen max-w-xl bg-[#fdf7ee] pb-24 shadow-[0_0_50px_rgba(74,42,29,.12)]">
    <header className="relative overflow-hidden bg-[#3a2117] px-5 pb-6 pt-5 text-[#fff7ea] print:hidden"><div className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(255,238,215,.32)_1px,transparent_1px),linear-gradient(90deg,rgba(255,238,215,.32)_1px,transparent_1px)] [background-size:24px_24px]" /><div className="relative flex items-center justify-between"><button aria-label="返回移动工作台" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 active:scale-95" onClick={() => navigate("/mobile")}><ArrowLeft className="h-5 w-5" /></button><div className="text-center"><p className="text-sm font-semibold">运输调度</p><p className="mt-0.5 text-[11px] text-[#e8cfb2]">刷卡票据 · GPS 趟次 · 阶梯运价</p></div><button aria-label="查看运输计价说明" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 active:scale-95" onClick={() => toast.info("装土、卸土刷卡均以车辆卡、GPS 与运价快照留痕；运费由服务端自动计算。") }><CircleHelp className="h-5 w-5" /></button></div><div className="relative mt-5 flex items-end justify-between"><div><p className="text-xs text-[#e8cfb2]">当前项目</p><p className="mt-1 text-lg font-semibold">{selectedProject?.name ?? "请选择项目"}</p></div><MobileTransportSiteManager projectId={selectedProjectId} canManage={isSuperAdmin || Boolean(transportSiteManagementAccess.data?.canManage)} onConfigureRoutes={() => setRouteDialogOpen(true)} triggerVariant="icon" /></div></header>
    <main className="space-y-5 px-5 py-5">
      {nfcLinkToken && nfcLinkReaderDeviceCode ? <Card aria-live="assertive" className={nfcInvoiceResult?.needsReview ? "border-[#e5b66d] bg-[#fff7e8]" : nfcInvoiceResult?.stage === "completed" ? "border-2 border-[#4f875a] bg-[#eef9ee]" : "border-[#b8d5df] bg-[#f1fbff]"}><CardContent className="p-5 text-center"><p className="text-xs font-semibold text-[#527487]">NFC 现场刷卡回执</p>{scanNfcLink.isPending ? <p className="mt-2 text-lg font-bold text-[#24546b]">正在核验现场位置与运输规则…</p> : nfcInvoiceResult?.needsReview ? <p className="mt-2 text-lg font-bold text-[#9c6425]">刷卡已提交，待人工核验</p> : nfcInvoiceResult ? <p className={`mt-2 font-black tracking-wide ${nfcInvoiceResult.stage === "completed" ? "text-2xl text-[#1f5f30]" : "text-xl text-[#24546b]"}`}>{formatVehicleStageReceipt(nfcInvoiceResult.vehiclePlateNo, nfcInvoiceResult.dailyVehicleTripOrdinal, nfcInvoiceResult.stage === "in_transit" || nfcInvoiceResult.singleScanClosed ? "load" : "unload") ?? (nfcInvoiceResult.singleScanClosed ? "单次刷卡闭环完成" : nfcInvoiceResult.stage === "completed" ? "卸土成功" : "装土刷卡成功，车辆已进入运输中")}</p> : <p className="mt-2 text-lg font-bold text-[#24546b]">正在读取车辆卡…</p>}{nfcInvoiceResult?.singleScanClosed && !nfcInvoiceResult.needsReview ? <p className="mt-2 text-xs font-medium text-[#1f5f30]">本趟已按管理员开启的单次刷卡规则自动完成闭环，等待后续核验。</p> : null}{nfcInvoiceResult?.reason ? <p className="mt-2 text-xs leading-5 text-[#80543d]">{nfcInvoiceResult.reason}</p> : null}</CardContent></Card> : null}
      {projectOptions.isError ? <Card className="border-[#f0d8c4] bg-[#fff7ef]"><CardContent className="p-8 text-center"><HardHat className="mx-auto h-8 w-8 text-[#ad6335]" /><h2 className="mt-3 font-semibold">项目授权加载失败</h2><p className="mt-2 text-xs leading-5 text-[#765544]">未能取得运输项目范围，请检查网络后重新获取；这不等同于没有项目权限。</p><Button className="mt-4 gap-1 bg-[#9a5128] text-white hover:bg-[#7e3d1c]" onClick={() => void projectOptions.refetch()}><RefreshCw className="h-4 w-4" />重新获取授权项目</Button></CardContent></Card> : !projectOptions.data?.length ? <Card className="border-0 bg-white"><CardContent className="p-8 text-center"><HardHat className="mx-auto h-8 w-8 text-[#ad6335]" /><h2 className="mt-3 font-semibold">暂无授权项目</h2><p className="mt-2 text-xs leading-5 text-[#765544]">请联系超级管理员为运输岗位配置项目或组织数据范围。</p><Button variant="outline" className="mt-4 gap-1 border-[#d6ae8e] text-[#7e4329]" onClick={() => void projectOptions.refetch()}><RefreshCw className="h-4 w-4" />重新获取授权项目</Button></CardContent></Card> : <>
        <section className="grid w-full max-w-full grid-cols-[minmax(0,1fr)_132px] gap-2 overflow-hidden print:hidden"><div className="min-w-0 overflow-hidden"><Label className="sr-only" htmlFor="transport-project-select">当前项目</Label><Select value={projectId ? String(projectId) : undefined} onValueChange={value => { setProjectId(Number(value)); setVehicleId(undefined); }}><SelectTrigger id="transport-project-select" className="h-11 min-w-0 max-w-full border-[#e9d8c6] bg-white text-[#4d2e22]"><SelectValue className="block truncate" placeholder="选择已授权项目" /></SelectTrigger><SelectContent>{projectOptions.data.map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select></div><div className="min-w-0"><Label className="mb-1 block px-1 text-[11px] font-medium text-[#765544]" htmlFor="transport-work-date">统计日期</Label><Input id="transport-work-date" aria-label="运输统计日期" className="h-8 w-[132px] min-w-[132px] border-[#e9d8c6] bg-white px-1 text-[12px]" type="date" value={workDate} onChange={event => setWorkDate(event.target.value)} /></div></section>
        {lastSpeechReceipt ? <section aria-label="运输成功语音回执" className="rounded-2xl border-2 border-[#79a57f] bg-[#eef9ee] p-4 text-[#1f5f30] print:hidden"><p className="text-lg font-bold">{lastSpeechReceipt}</p><p role="status" className="mt-2 text-xs">{speechStatusText}</p><Button type="button" variant="outline" className="mt-3 border-[#79a57f] bg-white" onClick={replaySpeech}><Volume2 className="mr-1 h-4 w-4" />播放成功语音</Button></section> : null}
        <section aria-label="运输发票主操作" className="rounded-2xl border border-[#e7c9a8] bg-[#f0dfc7] px-4 py-3 shadow-[0_6px_18px_rgba(71,42,30,.06)] print:hidden"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">发票快捷操作</p><p className="mt-1 text-xs leading-5 text-[#7d563d]">车辆卡随车优先刷 NFC；车辆卡未随车时使用后置相机直拍车牌。</p></div><span className="shrink-0 rounded-full bg-white/70 px-2 py-1 text-[10px] font-medium text-[#8b3f20]">{workDate}</span></div><div className="mt-3 grid grid-cols-2 gap-3"><button type="button" aria-label="新建 NFC 刷卡发票" className="min-h-28 rounded-2xl bg-[#9a5128] p-4 text-left text-white shadow-[0_8px_18px_rgba(128,66,31,.2)] active:scale-[.98]" onClick={() => { setExpectedUnloadTripId(undefined); setMobileNfcInvoiceOpen(true); }}><FileText className="h-6 w-6" /><p className="mt-3 text-base font-semibold">刷 NFC 发票</p><p className="mt-1 text-[11px] text-[#ffe5cd]">打开后点击开始读取 · 再贴车辆卡</p></button><button type="button" aria-label="新建拍照车牌发票" className="min-h-28 rounded-2xl bg-[#47754d] p-4 text-left text-white shadow-[0_8px_18px_rgba(49,94,57,.18)] active:scale-[.98]" onClick={() => openTripDialog(false, "plate_photo")}><Camera className="h-6 w-6" /><p className="mt-3 text-base font-semibold">拍照车牌发票</p><p className="mt-1 text-[11px] text-[#dff1dc]">车辆卡未随车 · 直拍后待核验</p></button></div><div className="mt-3 grid grid-cols-2 gap-2"><Button size="sm" variant="outline" className="h-9 gap-1 border-[#d9b88d] bg-white/70 px-2 text-[#8b3f20] hover:bg-[#fff8ed]" onClick={openTicketDialog}><FileText className="h-4 w-4" />处理待刷 NFC 票据{pendingCardTrips.length ? `（${pendingCardTrips.length}）` : ""}</Button><Button size="sm" variant="outline" className="h-9 gap-1 border-[#d9b88d] bg-white/70 px-2 text-[#8b3f20] hover:bg-[#fff8ed]" onClick={() => setFreightPrintOpen(true)}><Printer className="h-4 w-4" />打印运费明细</Button></div></section>
        <section className="grid grid-cols-3 gap-3 sm:grid-cols-6"><MetricCard label="当日发票" value={summary.data?.tripCount ?? 0} /><MetricCard label="NFC 票据" value={summary.data?.nfcCardTicketCount ?? 0} /><MetricCard label="直拍票据" value={summary.data?.platePhotoTicketCount ?? 0} /><MetricCard label="结算方量" value={`${summary.data?.volumeCubicMeters ?? 0} m³`} /><MetricCard label="待核验" value={summary.data?.submittedCount ?? 0} warning /><MetricCard label="当日运费" value={formatMoney(summary.data?.amount)} success /></section>
        <MobileTransportLedger projectId={selectedProjectId} workDate={workDate} vehicles={(vehicles.data ?? []).map(vehicle => ({ id: vehicle.id, plateNo: vehicle.plateNo }))} onConfirmPlatePhotoUnload={openPlatePhotoUnloadDialog} onConfirmCardUnload={openCardUnloadDialog} />
        {isSuperAdmin ? <section className="print:hidden"><div className="mb-2 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#8a591f]" /><p className="text-sm font-semibold text-[#5f3824]">超级管理员设置</p></div><p className="mb-2 text-xs leading-5 text-[#8f7566]">仅超级管理员可维护运输闭环和安全阈值；普通运输管理员不会显示此入口。</p><Suspense fallback={<Card className="border-0 bg-white"><CardContent className="p-4 text-sm text-[#8f7566]">正在加载运输安全设置…</CardContent></Card>}><TransportRouteSafetySettings projectId={selectedProjectId} compact /></Suspense></section> : null}
        <section className="hidden grid-cols-2 gap-3 print:hidden"><Card className="border border-[#e7c9a8] bg-[#fff8ed] shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-3"><div className="flex items-center gap-2 text-[#8a4b25]"><MapPin className="h-4 w-4" /><p className="text-xs font-semibold">装土点设置</p></div><p className="mt-2 truncate text-sm font-semibold">{activeLoadSites.length ? activeLoadSites.map(site => site.name).join("、") : "暂未配置"}</p><p className="mt-1 text-[11px] text-[#8f7566]">启用 {activeLoadSites.length} 个 · {activeLoadSites[0]?.administratorName || "待指定管理员"}</p>{isSuperAdmin ? <Button variant="ghost" size="sm" className="mt-2 h-7 px-0 text-xs text-[#8a4b25]" onClick={() => { setActiveTab("sites"); openSiteDialog(activeLoadSites[0]); }}><Settings2 className="mr-1 h-3.5 w-3.5" />设置装土点</Button> : null}</CardContent></Card><Card className="border border-[#bfd9c3] bg-[#f4fbf1] shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-3"><div className="flex items-center gap-2 text-[#47754d]"><MapPin className="h-4 w-4" /><p className="text-xs font-semibold">卸土点设置</p></div><p className="mt-2 truncate text-sm font-semibold">{activeUnloadSites.length ? activeUnloadSites.map(site => site.name).join("、") : "暂未配置"}</p><p className="mt-1 text-[11px] text-[#6c816d]">启用 {activeUnloadSites.length} 个 · {activeUnloadSites[0]?.administratorName || "待指定管理员"}</p>{isSuperAdmin ? <Button variant="ghost" size="sm" className="mt-2 h-7 px-0 text-xs text-[#47754d]" onClick={() => { setActiveTab("sites"); openSiteDialog(activeUnloadSites[0]); }}><Settings2 className="mr-1 h-3.5 w-3.5" />设置卸土点</Button> : null}</CardContent></Card></section>
        <section className="hidden print:block"><h1 className="text-center text-xl font-semibold">渣土运输运费日报</h1><p className="mt-2 text-center text-sm">项目：{selectedProject?.name ?? "—"}　日期：{workDate}　生成时间：{formatChinaDateTime(new Date())}</p><div className="mt-4 grid grid-cols-5 gap-2 text-center text-sm"><div>趟次<p className="mt-1 font-semibold">{summary.data?.tripCount ?? 0}</p></div><div>方量<p className="mt-1 font-semibold">{summary.data?.volumeCubicMeters ?? 0} m³</p></div><div>吨位<p className="mt-1 font-semibold">{summary.data?.weightTons ?? 0} t</p></div><div>预警<p className="mt-1 font-semibold">{summary.data?.alertTripCount ?? 0}</p></div><div>运费<p className="mt-1 font-semibold">{formatMoney(summary.data?.amount)}</p></div></div></section>
        {isSuperAdmin ? <Tabs value={activeTab} onValueChange={setActiveTab}><TabsList className="grid h-auto w-full grid-cols-4 rounded-2xl bg-[#f0e5d7] p-1 print:hidden"><TabsTrigger value="trips" onClick={() => { setActiveTab("trips"); window.setTimeout(() => document.getElementById("transport-ticket-list")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); }} className="rounded-xl data-[state=active]:bg-white data-[state=active]:text-[#81411f]">运输票据（后台）</TabsTrigger><TabsTrigger value="vehicles" className="rounded-xl data-[state=active]:bg-white data-[state=active]:text-[#81411f]">车辆台账</TabsTrigger><TabsTrigger value="rates" className="rounded-xl data-[state=active]:bg-white data-[state=active]:text-[#81411f]">阶梯运价</TabsTrigger><TabsTrigger value="sites" className="rounded-xl data-[state=active]:bg-white data-[state=active]:text-[#81411f]">现场地点</TabsTrigger></TabsList>
        <TabsContent value="trips" id="transport-ticket-list" className="mt-4 space-y-3"><div><h2 className="text-base font-semibold">按车辆日汇总</h2><p className="mt-0.5 text-xs text-[#8f7566]">每台车的发票数量、双模式来源、方量、运费与待核验数量均按当前日期统计。</p></div>{summary.data?.vehicleSummaries?.length ? <div className="space-y-2">{summary.data.vehicleSummaries.map(item => <Card key={item.vehicleId} className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-3"><div className="flex items-center justify-between"><p className="font-semibold">{item.plateNo}</p><p className="text-sm font-semibold text-[#6d3f2b]">{formatMoney(item.amount)}</p></div><div className="mt-2 grid grid-cols-4 gap-1 text-center text-[10px]"><span className="rounded-lg bg-[#f8ead8] px-1.5 py-1">发票 {item.ticketCount}</span><span className="rounded-lg bg-[#fff3e4] px-1.5 py-1">NFC {item.nfcCardTicketCount}</span><span className="rounded-lg bg-[#e7f1e5] px-1.5 py-1">直拍 {item.platePhotoTicketCount}</span><span className="rounded-lg bg-[#f0f3f7] px-1.5 py-1">待核 {item.pendingReviewCount}</span></div><p className="mt-2 text-[11px] text-[#8f7566]">方量 {item.volumeCubicMeters} m³ · 已核验 {item.verifiedCount} 笔</p></CardContent></Card>)}</div> : <Card className="border-0 bg-white"><CardContent className="p-5 text-center text-sm text-[#8f7566]">当前日期暂无车辆日汇总。</CardContent></Card>}<div className="flex items-center justify-between pt-2"><div><h2 className="text-base font-semibold">当日运输运单</h2><p className="mt-0.5 text-xs text-[#8f7566]">按车辆逐单查看里程、方量、模式、状态、影像和运费。</p></div></div><div className="grid grid-cols-[1fr_auto] gap-3 rounded-xl bg-white p-3 shadow-[0_6px_18px_rgba(71,42,30,.06)]"><Select value={vehicleId ? String(vehicleId) : undefined} onValueChange={value => setVehicleId(Number(value))}><SelectTrigger className="border-[#ead9c8] bg-[#fffaf5]"><SelectValue placeholder="选择车辆" /></SelectTrigger><SelectContent>{vehicles.data?.map(vehicle => <SelectItem key={vehicle.id} value={String(vehicle.id)}>{vehicle.plateNo}</SelectItem>)}</SelectContent></Select><span className="rounded-lg bg-[#f8ead8] px-3 py-2 text-xs text-[#80543d]">{workDate}</span></div>{trips.error ? <Card className="border-[#f0d8c4] bg-[#fff7ef]"><CardContent className="p-4 text-sm text-[#9c4d27]">运输票据加载失败：{getUserFacingErrorMessage(trips.error, "暂无法读取运输票据，请稍后重试")}</CardContent></Card> : !trips.data?.length && !trips.isLoading ? <Card className="border-0 bg-white"><CardContent className="p-6 text-center text-sm text-[#8f7566]">当前日期暂无运输票据。请通过上方任一发票方式创建票据。</CardContent></Card> : trips.data?.map(trip => <TripCard key={trip.id} trip={trip} projectId={selectedProjectId} canManage={isSuperAdmin} onTransition={(id, nextStatus) => transitionTrip.mutate({ id, projectId: selectedProjectId, nextStatus })} onConfirmPlatePhotoUnload={openPlatePhotoUnloadDialog} />)}</TabsContent>
          {isSuperAdmin ? <TabsContent value="vehicles" className="mt-4 space-y-3"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">渣土车辆档案</h2><p className="mt-0.5 text-xs text-[#8f7566]">货厢尺寸与装载系数用于方量核验</p></div><Button size="sm" className="bg-[#a85f30] text-white hover:bg-[#8e4b22]" onClick={() => openVehicleDialog()}><Plus className="mr-1 h-4 w-4" />录入车辆</Button></div>{!vehicles.data?.length && !vehicles.isLoading ? <Card className="border-0 bg-white"><CardContent className="p-6 text-center text-sm text-[#8f7566]">当前项目尚未录入车辆。</CardContent></Card> : vehicles.data?.map(vehicle => { const status = getVehicleStatus(vehicle.status); return <Card key={vehicle.id} className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-4"><div className="flex items-start justify-between"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{vehicle.plateNo}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] ${status.className}`}>{status.label}</span></div><p className="mt-1 text-xs text-[#8f7566]">{vehicle.ownerName || "未填车主"} · 司机 {vehicle.driverUserId ? `用户 #${vehicle.driverUserId}` : "未绑定"}</p></div><button aria-label={`编辑${vehicle.plateNo}档案`} className="grid h-8 w-8 place-items-center rounded-lg bg-[#f7ead8] text-[#975227] active:scale-95" onClick={() => openVehicleDialog(vehicle)}><Pencil className="h-4 w-4" /></button></div><div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-[#fcf8f2] p-2.5 text-[11px] text-[#765a49]"><span>货厢 {vehicle.boxLengthMeters} × {vehicle.boxWidthMeters} × {vehicle.boxHeightMeters} m</span><span>装载系数 {vehicle.loadFactor}</span><span>理论方量 {vehicle.theoreticalVolumeCubicMeters} m³</span><span>核载 {vehicle.payloadTons ?? "—"} t</span></div></CardContent></Card>; })}</TabsContent> : null}
          {isSuperAdmin ? <TabsContent value="rates" className="mt-4 space-y-3"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">阶梯运价规则</h2><p className="mt-0.5 text-xs text-[#8f7566]">1 公里起步 + 每增加步长递增</p></div><Button size="sm" className="bg-[#a85f30] text-white hover:bg-[#8e4b22]" onClick={() => { setRuleDraft(EMPTY_RULE_DRAFT); setRuleDialogOpen(true); }}><Settings2 className="mr-1 h-4 w-4" />配置运价</Button></div>{!freightRules.data?.length && !freightRules.isLoading ? <Card className="border-0 bg-white"><CardContent className="p-6 text-center text-sm text-[#8f7566]">当前项目尚未配置运价规则。</CardContent></Card> : freightRules.data?.map(rule => <Card key={rule.id} className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-4"><div className="flex items-start justify-between"><div><h3 className="text-sm font-semibold">{rule.materialName || "通用运输"}</h3><p className="mt-1 text-xs text-[#8f7566]">{rule.settlementUnit === "cubic_meter" ? "按方结算" : rule.settlementUnit === "ton" ? "按吨结算" : "按趟结算"} · {formatChinaDate(rule.effectiveFrom)} 起</p></div><span className={`rounded-full px-2 py-0.5 text-[10px] ${rule.status === "active" ? "bg-[#e6f1e4] text-[#47754d]" : "bg-[#eee8e2] text-[#806e60]"}`}>{rule.status === "active" ? "生效" : rule.status === "draft" ? "草稿" : "停用"}</span></div><div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[#fcf8f2] p-2.5 text-[11px] text-[#765a49]"><span>{rule.startDistanceKm} km 起步</span><span>{formatMoney(rule.basePricePerUnit)} / 单位</span><span>每 {rule.stepMeters} m + {formatMoney(rule.stepIncreasePerUnit)}</span></div></CardContent></Card>)}</TabsContent> : null}
          {isSuperAdmin ? <TabsContent value="sites" className="mt-4 space-y-3"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">装卸现场地点</h2><p className="mt-0.5 text-xs text-[#8f7566]">每个地点须指定一名现场刷卡管理员，票据才能进入刷卡闭环。</p></div><Button size="sm" className="bg-[#a85f30] text-white hover:bg-[#8e4b22]" onClick={() => openSiteDialog()}><Plus className="mr-1 h-4 w-4" />配置地点</Button></div>{!transportSites.data?.length && !transportSites.isLoading ? <Card className="border-0 bg-white"><CardContent className="p-6 text-center text-sm text-[#8f7566]">请先配置装土点和卸土点，并分别指定现场刷卡管理员。</CardContent></Card> : transportSites.data?.map(site => <Card key={site.id} className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{site.name}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] ${site.siteType === "load" ? "bg-[#f8ead8] text-[#94603a]" : "bg-[#e6f1e4] text-[#47754d]"}`}>{site.siteType === "load" ? "装土点" : "卸土点"}</span><span className={`rounded-full px-2 py-0.5 text-[10px] ${site.status === "active" ? "bg-[#e2f0ed] text-[#3e746a]" : "bg-[#eee8e2] text-[#857365]"}`}>{site.status === "active" ? "启用" : "停用"}</span></div><p className="mt-1 text-xs text-[#8f7566]">{site.address || "未填写地址"}</p><p className="mt-1 text-xs text-[#80543d]">现场管理员：{site.administratorName || "未配置"}{site.administratorUserId ? `（用户 #${site.administratorUserId}）` : ""}</p></div><button aria-label={`编辑${site.name}`} className="grid h-8 w-8 place-items-center rounded-lg bg-[#f7ead8] text-[#975227] active:scale-95" onClick={() => openSiteDialog(site)}><Pencil className="h-4 w-4" /></button></div></CardContent></Card>)}</TabsContent> : null}
        </Tabs> : null}
      </>}
    </main>
    {mobileNfcInvoiceOpen ? <NfcInvoiceLoadBoundary onClose={() => setMobileNfcInvoiceOpen(false)}><Suspense fallback={<NfcInvoiceLoadingDialog onClose={() => setMobileNfcInvoiceOpen(false)} />}><MobileNfcTransportInvoice open={mobileNfcInvoiceOpen} onOpenChange={open => { setMobileNfcInvoiceOpen(open); if (!open) setExpectedUnloadTripId(undefined); }} initialToken={expectedUnloadTripId ? undefined : nfcLinkToken} expectedUnloadTripId={expectedUnloadTripId} /></Suspense></NfcInvoiceLoadBoundary> : null}
    <TransportFreightPrintDialog open={freightPrintOpen} onOpenChange={setFreightPrintOpen} projectId={selectedProjectId} projectName={selectedProject?.name ?? "当前项目"} initialDate={workDate} vehicles={(vehicles.data ?? []).map(vehicle => ({ id: vehicle.id, plateNo: vehicle.plateNo }))} />
    <nav aria-label="移动运输导航" className="mobile-bottom-navigation fixed right-0 bottom-0 left-0 z-20 flex w-full max-w-none items-center justify-around border-t border-[#ead9c8] bg-[#fffaf2]/95 px-3 py-2 backdrop-blur print:hidden"><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate("/mobile")}><LayoutDashboard className="h-5 w-5" /><span className="text-[10px]">工作台</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#9f582b]"><Truck className="h-5 w-5" /><span className="text-[10px] font-medium">运输</span></button><button aria-label="进入消息中心" className="relative flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate("/mobile/messages")}><Bell className="h-5 w-5" />{(unreadMessages.data?.count ?? 0) > 0 ? <span className="absolute right-2 top-1 h-2 w-2 rounded-full bg-[#d96c37]" /> : null}<span className="text-[10px]">消息</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate("/mobile/profile")}><UserRound className="h-5 w-5" /><span className="text-[10px]">我的</span></button></nav>
    <Dialog open={Boolean(plateUnloadDialogTripId)} onOpenChange={open => { if (!open) closePlatePhotoUnloadForm(); }}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>卸土现场确认</DialogTitle></DialogHeader><TransportSpeechControls statusText={speechStatusText} onTest={testSpeech} /><div className="grid gap-3 py-2"><p className="rounded-xl bg-[#e7f1e5] p-3 text-xs leading-5 text-[#3f6845]">请在卸土点使用后置相机直拍卸土现场。系统将归档照片、当前时间、中文地址、定位和确认管理员；未上传照片不能完成卸土。时间与定位按卸土点的硬拦截开关校验，关闭的条件会留提示待核验。</p>{unloadCameraOpen ? <div className="overflow-hidden rounded-xl border border-[#79a57f] bg-[#18301d]"><video ref={unloadCameraVideoRef} className="aspect-[4/3] w-full bg-black object-cover" autoPlay playsInline muted /><div className="grid grid-cols-2 gap-2 p-2"><Button type="button" variant="outline" className="border-[#c9dec9] bg-white text-[#47754d]" onClick={stopUnloadCamera}>取消拍照</Button><Button type="button" className="bg-[#47754d] text-white hover:bg-[#39623e]" onClick={captureUnloadPhoto}><Camera className="mr-1 h-4 w-4" />确认照片</Button></div></div> : <Button type="button" variant="outline" className="h-11 w-full border-dashed border-[#79a57f] bg-[#f4fbf1] text-[#47754d] hover:bg-[#e7f1e5]" onClick={() => void startUnloadCamera()}><Camera className="mr-2 h-4 w-4" />拍摄卸土现场后上传</Button>}{unloadPhotoPreview ? <img src={unloadPhotoPreview} alt="待归档卸土现场照片预览" className="max-h-56 w-full rounded-xl border border-[#c6ddc5] object-cover" /> : null}</div><DialogFooter><Button variant="outline" onClick={closePlatePhotoUnloadForm}>取消</Button><Button className="bg-[#47754d] text-white hover:bg-[#39623e]" disabled={!unloadPhotoFile || unloadPreparing || evidenceUpload.isPending || confirmPlatePhotoUnload.isPending} onClick={() => { if (plateUnloadDialogTripId) void confirmPlatePhotoTripUnload(plateUnloadDialogTripId); }}>{unloadPreparing || evidenceUpload.isPending || confirmPlatePhotoUnload.isPending ? "正在定位归档确认…" : "上传照片并确认卸土"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={routeDialogOpen} onOpenChange={setRouteDialogOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>设置运输路线</DialogTitle><p className="text-sm text-muted-foreground">可连续添加多条装土点 → 卸土点路线；发票仅需选择其中一条启用路线。</p></DialogHeader>{(!activeLoadSites.length || !activeUnloadSites.length || !freightRules.data?.some(rule => rule.status === "active")) ? <div className="my-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><p>请先完成基础配置：装土点、卸土点和一条生效阶梯运价。</p><div className="mt-2 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setSiteDialogOpen(true)}>新增装卸土点</Button><Button type="button" size="sm" variant="outline" onClick={() => setRuleDialogOpen(true)}>配置阶梯运价</Button></div></div> : null}<div className="grid gap-3 py-2"><div className="grid grid-cols-2 gap-3"><Field label="装土点"><Select value={routeDraft.loadSiteId} onValueChange={value => setRouteDraft(current => ({ ...current, loadSiteId: value }))}><SelectTrigger><SelectValue placeholder="选择装土点" /></SelectTrigger><SelectContent>{activeLoadSites.map(site => <SelectItem key={site.id} value={String(site.id)}>{site.name}</SelectItem>)}</SelectContent></Select></Field><Field label="卸土点"><Select value={routeDraft.unloadSiteId} onValueChange={value => setRouteDraft(current => ({ ...current, unloadSiteId: value }))}><SelectTrigger><SelectValue placeholder="选择卸土点" /></SelectTrigger><SelectContent>{activeUnloadSites.map(site => <SelectItem key={site.id} value={String(site.id)}>{site.name}</SelectItem>)}</SelectContent></Select></Field></div><Field label="生效阶梯运价"><Select value={routeDraft.freightRuleId} onValueChange={value => setRouteDraft(current => ({ ...current, freightRuleId: value }))}><SelectTrigger><SelectValue placeholder="选择有效运价" /></SelectTrigger><SelectContent>{freightRules.data?.filter(rule => rule.status === "active").map(rule => <SelectItem key={rule.id} value={String(rule.id)}>{rule.materialName || "通用"} · 0–{rule.startDistanceKm} km {formatMoney(rule.basePricePerUnit)}/方，每 {rule.stepMeters} m +{formatMoney(rule.stepIncreasePerUnit)}/方</SelectItem>)}</SelectContent></Select></Field><Field label="预设公里数"><Input type="number" min="0.001" step="0.001" value={routeDraft.presetDistanceKm} placeholder="例如 6.5" onChange={event => setRouteDraft(current => ({ ...current, presetDistanceKm: event.target.value }))} /></Field><p className="rounded-xl bg-[#f9eddf] p-3 text-xs leading-5 text-[#80543d]">保存后可继续新增下一条路线。系统禁止同一项目重复配置相同装土点和卸土点组合，并在发票时锁定本路线公里数和有效运价。</p>{routePresets.data?.length ? <div className="space-y-1 rounded-xl bg-[#fcf8f2] p-3 text-xs text-[#765a49]">{routePresets.data.map(item => <p key={item.id}>{activeLoadSites.find(site => site.id === item.loadSiteId)?.name || `装土点 #${item.loadSiteId}`} → {activeUnloadSites.find(site => site.id === item.unloadSiteId)?.name || `卸土点 #${item.unloadSiteId}`} · {item.presetDistanceKm} km · {item.status === "active" ? "启用" : "停用"}</p>)}</div> : null}</div><DialogFooter><Button variant="outline" onClick={() => setRouteDialogOpen(false)}>取消</Button><Button className="bg-[#9a5128] hover:bg-[#7e3d1c]" disabled={saveRoutePreset.isPending} onClick={submitRoutePreset}>{saveRoutePreset.isPending ? "正在保存…" : "保存并继续添加"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={vehicleDialogOpen} onOpenChange={setVehicleDialogOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editingVehicleId ? "维护车辆档案" : "录入渣土车辆"}</DialogTitle></DialogHeader><div className="grid gap-3 py-2"><div className="grid grid-cols-2 gap-3"><Field label="车牌号"><Input value={vehicleDraft.plateNo} maxLength={32} onChange={event => setVehicleDraft(current => ({ ...current, plateNo: event.target.value }))} /></Field><Field label="资源性质"><Select value={vehicleDraft.ownership} onValueChange={value => setVehicleDraft(current => ({ ...current, ownership: value as VehicleDraft["ownership"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="owned">公司自有</SelectItem><SelectItem value="leased">外租车辆</SelectItem><SelectItem value="trip_settlement">渣土车（按趟结算）</SelectItem></SelectContent></Select></Field></div><Field label={vehicleDraft.ownership === "trip_settlement" ? "车主/车队（可选）" : "车主/单位"}><Input value={vehicleDraft.ownerName} maxLength={128} onChange={event => setVehicleDraft(current => ({ ...current, ownerName: event.target.value }))} /></Field>{vehicleDraft.ownership === "trip_settlement" ? <p className="rounded-xl bg-[#e7f1e5] p-3 text-xs leading-5 text-[#3f6845]">按趟结算渣土车不建立租赁日期、租金或租赁成本；运费只按有效运输趟次、路线运价和柴油扣款计算。</p> : null}<div className="grid grid-cols-2 gap-3"><Field label="驾驶员人员档案"><PersonnelResourceSelect projectId={selectedProjectId} role="driver" value={vehicleDraft.driverPersonId ? Number(vehicleDraft.driverPersonId) : null} fallbackLabel={vehicleDraft.driverName} onChange={person => setVehicleDraft(current => ({ ...current, driverPersonId: person ? String(person.id) : "", driverUserId: person?.userId ? String(person.userId) : "", driverName: person?.name ?? "", driverPhone: "" }))} /></Field><Field label="司机姓名"><Input readOnly={Boolean(vehicleDraft.driverPersonId)} value={vehicleDraft.driverName} placeholder="实际驾驶员姓名" onChange={event => setVehicleDraft(current => ({ ...current, driverName: event.target.value }))} /></Field><Field label="司机手机号"><Input readOnly={Boolean(vehicleDraft.driverPersonId)} inputMode="tel" value={vehicleDraft.driverPhone} placeholder="11 位手机号" onChange={event => setVehicleDraft(current => ({ ...current, driverPhone: event.target.value }))} /></Field><Field label="车辆状态"><Select value={vehicleDraft.status} onValueChange={value => setVehicleDraft(current => ({ ...current, status: value as typeof current.status }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">可调度</SelectItem><SelectItem value="suspended">暂缓</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select></Field></div><Field label="货厢尺寸（米）"><div className="grid grid-cols-3 gap-2"><Input type="number" min="0" placeholder="长" value={vehicleDraft.boxLengthMeters} onChange={event => setVehicleDraft(current => ({ ...current, boxLengthMeters: event.target.value }))} /><Input type="number" min="0" placeholder="宽" value={vehicleDraft.boxWidthMeters} onChange={event => setVehicleDraft(current => ({ ...current, boxWidthMeters: event.target.value }))} /><Input type="number" min="0" placeholder="高" value={vehicleDraft.boxHeightMeters} onChange={event => setVehicleDraft(current => ({ ...current, boxHeightMeters: event.target.value }))} /></div></Field><div className="grid grid-cols-2 gap-3"><Field label="装载系数"><Input type="number" min="0" max="1.5" step="0.01" value={vehicleDraft.loadFactor} onChange={event => setVehicleDraft(current => ({ ...current, loadFactor: event.target.value }))} /></Field><Field label="核载吨位"><Input type="number" min="0" value={vehicleDraft.payloadTons} placeholder="可选" onChange={event => setVehicleDraft(current => ({ ...current, payloadTons: event.target.value }))} /></Field></div></div><DialogFooter><Button variant="outline" onClick={() => setVehicleDialogOpen(false)}>取消</Button><Button className="bg-[#9a5128] hover:bg-[#7e3d1c]" disabled={saveVehicle.isPending} onClick={submitVehicle}>{saveVehicle.isPending ? "正在保存…" : "保存车辆"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>配置阶梯运价</DialogTitle></DialogHeader><div className="grid gap-3 py-2"><div className="grid grid-cols-2 gap-3"><Field label="物料名称"><Input value={ruleDraft.materialName} placeholder="可选" onChange={event => setRuleDraft(current => ({ ...current, materialName: event.target.value }))} /></Field><Field label="结算单位"><Select value={ruleDraft.settlementUnit} onValueChange={value => setRuleDraft(current => ({ ...current, settlementUnit: value as typeof current.settlementUnit }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cubic_meter">立方米</SelectItem><SelectItem value="ton">吨</SelectItem><SelectItem value="trip">趟</SelectItem></SelectContent></Select></Field></div><div className="grid grid-cols-2 gap-3"><Field label="起步里程（km）"><Input type="number" min="0" value={ruleDraft.startDistanceKm} onChange={event => setRuleDraft(current => ({ ...current, startDistanceKm: event.target.value }))} /></Field><Field label="基础单价"><Input type="number" min="0" value={ruleDraft.basePricePerUnit} onChange={event => setRuleDraft(current => ({ ...current, basePricePerUnit: event.target.value }))} /></Field></div><div className="grid grid-cols-2 gap-3"><Field label="递增步长（米）"><Input type="number" min="1" value={ruleDraft.stepMeters} onChange={event => setRuleDraft(current => ({ ...current, stepMeters: event.target.value }))} /></Field><Field label="每步增价"><Input type="number" min="0" value={ruleDraft.stepIncreasePerUnit} onChange={event => setRuleDraft(current => ({ ...current, stepIncreasePerUnit: event.target.value }))} /></Field></div><div className="grid grid-cols-2 gap-3"><Field label="生效日期"><Input type="date" value={ruleDraft.effectiveFrom} onChange={event => setRuleDraft(current => ({ ...current, effectiveFrom: event.target.value }))} /></Field><Field label="截止日期"><Input type="date" value={ruleDraft.effectiveTo} onChange={event => setRuleDraft(current => ({ ...current, effectiveTo: event.target.value }))} /></Field></div></div><DialogFooter><Button variant="outline" onClick={() => setRuleDialogOpen(false)}>取消</Button><Button className="bg-[#9a5128] hover:bg-[#7e3d1c]" disabled={saveRule.isPending} onClick={submitRule}>{saveRule.isPending ? "正在保存…" : "保存运价"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={tripDialogOpen} onOpenChange={open => { if (open) setTripDialogOpen(true); else requestTripClose(closeTripForm); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{tripDraft.invoiceMode === "nfc_card" ? "刷 NFC 卡发票" : "拍照车牌发票"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <p className={`rounded-xl p-3 text-xs leading-5 ${tripDraft.invoiceMode === "nfc_card" ? "bg-[#f9eddf] text-[#80543d]" : "bg-[#e7f1e5] text-[#3f6845]"}`}>{tripDraft.invoiceMode === "nfc_card" ? "车辆卡随车时使用：保存后必须在装土点、卸土点按顺序完成两次 NFC 刷卡。" : "车辆卡未随车时使用：必须现场直拍清晰车牌，系统写入水印后作为装土发票，卸土可选择刷车辆卡或现场拍照，同一趟运输只确认一次。"}</p>
          {tripDraft.invoiceMode === "plate_photo" ? <TransportSpeechControls statusText={speechStatusText} onTest={testSpeech} /> : null}
          {tripDraft.invoiceMode === "plate_photo" ? <Field label="搜索并选择车辆"><Input aria-label="拍照发票车牌搜索" value={tripVehicleId ? (vehicles.data?.find(vehicle => vehicle.id === tripVehicleId)?.plateNo || plateVehicleSearch) : plateVehicleSearch} inputMode="text" maxLength={32} placeholder="输入车牌后两位，例如 A8" onChange={event => { const value = event.target.value.toUpperCase(); setPlateVehicleSearch(value); if (tripVehicleId && value !== (vehicles.data?.find(vehicle => vehicle.id === tripVehicleId)?.plateNo || "")) setTripVehicleId(undefined); }} /><div className="mt-2 max-h-32 space-y-1 overflow-y-auto rounded-xl bg-[#fcf8f2] p-2">{platePhotoVehicleCandidates.length ? platePhotoVehicleCandidates.map(vehicle => <button key={vehicle.id} type="button" onClick={() => { setTripVehicleId(vehicle.id); setPlateVehicleSearch(vehicle.plateNo); }} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs ${tripVehicleId === vehicle.id ? "bg-[#47754d] text-white" : "bg-white text-[#4d2e22]"}`}><span className="font-semibold">{vehicle.plateNo}</span><span>{vehicle.driverName || "司机未录入"}</span></button>) : <p className="px-2 py-3 text-xs text-[#8f7566]">未找到符合车牌尾号的可调度车辆。</p>}</div><p className={`mt-1 rounded-lg px-2 py-1.5 text-[11px] ${tripVehicleId ? "bg-[#e7f1e5] font-semibold text-[#47754d]" : "text-[#6c816d]"}`}>{tripVehicleId ? `已选择车牌：${vehicles.data?.find(vehicle => vehicle.id === tripVehicleId)?.plateNo || "—"}` : "请先选择车辆"}</p></Field> : null}
          <div className="grid gap-3"><Field label="运单编号"><Input readOnly value="系统将在发票成功后自动生成" className="bg-[#fcf8f2] text-[#8f7566]" /></Field><Field label="运输路线"><Select value={tripDraft.routePresetId} onValueChange={value => { const preset = routePresets.data?.find(item => item.id === Number(value)); setTripDraft(current => ({ ...current, routePresetId: value, loadSiteId: preset ? String(preset.loadSiteId) : "", unloadSiteId: preset ? String(preset.unloadSiteId) : "", freightRuleId: preset ? String(preset.freightRuleId) : "", actualDistanceKm: preset ? String(preset.presetDistanceKm) : "" })); }}><SelectTrigger><SelectValue placeholder="选择已设置路线" /></SelectTrigger><SelectContent>{routePresets.data?.filter(item => item.status === "active").map(item => { const load = activeLoadSites.find(site => site.id === item.loadSiteId); const unload = activeUnloadSites.find(site => site.id === item.unloadSiteId); return <SelectItem key={item.id} value={String(item.id)}>{load?.name || "装土点"} → {unload?.name || "卸土点"} · {item.presetDistanceKm} km</SelectItem>; })}</SelectContent></Select></Field></div>
          {!routePresets.data?.some(item => item.status === "active") ? <p className="rounded-xl border border-[#f2d8bd] bg-[#fff9f3] p-3 text-xs leading-5 text-[#9c4d27]">请先在“现场地点”设置装土点、卸土点和管理员，再由运输负责人配置一条启用的运输路线（预设公里数与有效运价）。</p> : <div className="grid grid-cols-3 gap-2 rounded-xl bg-[#fcf8f2] p-3 text-xs text-[#765a49]"><span>装土：{activeLoadSites.find(site => String(site.id) === tripDraft.loadSiteId)?.name || "—"}</span><span>卸土：{activeUnloadSites.find(site => String(site.id) === tripDraft.unloadSiteId)?.name || "—"}</span><span>预设 {tripDraft.actualDistanceKm || "—"} km</span><span className="col-span-2">标准方量：{vehicles.data?.find(vehicle => vehicle.id === tripVehicleId)?.theoreticalVolumeCubicMeters ?? "—"} m³</span><span>运价自动锁定</span></div>}
          {tripDraft.invoiceMode === "plate_photo" ? <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#fcf8f2] p-3 text-xs text-[#765a49]"><span>发票时间：系统开票时自动生成</span><span>结算方量：车辆与路线自动带入</span></div> : <><div className="grid grid-cols-2 gap-3"><Field label="开始时间"><Input type="datetime-local" value={tripDraft.startAt} onChange={event => setTripDraft(current => ({ ...current, startAt: event.target.value }))} /></Field><Field label="结束时间"><Input type="datetime-local" value={tripDraft.endAt} onChange={event => setTripDraft(current => ({ ...current, endAt: event.target.value }))} /></Field></div><Field label="吨位 t（仅按吨结算路线需要）"><Input type="number" min="0" value={tripDraft.weightTons} onChange={event => setTripDraft(current => ({ ...current, weightTons: event.target.value }))} /></Field></>}
          {tripDraft.invoiceMode === "plate_photo" ? <Field label="车牌直拍凭证">{plateCameraOpen ? <div className="overflow-hidden rounded-xl border border-[#79a57f] bg-[#18301d]"><video ref={plateCameraVideoRef} className="aspect-[4/3] w-full bg-black object-cover" autoPlay playsInline muted /><div className="grid grid-cols-2 gap-2 p-2"><Button type="button" variant="outline" className="border-[#c9dec9] bg-white text-[#47754d]" onClick={stopPlateCamera}>取消拍照</Button><Button type="button" className="bg-[#47754d] text-white hover:bg-[#39623e]" onClick={capturePlatePhoto}><Camera className="mr-1 h-4 w-4" />确认拍照</Button></div></div> : <Button type="button" variant="outline" className="h-11 w-full border-dashed border-[#79a57f] bg-[#f4fbf1] text-[#47754d] hover:bg-[#e7f1e5]" onClick={() => void startPlateCamera()}><Camera className="mr-2 h-4 w-4" />拍清车牌后上传</Button>}<p className="mt-1 text-[11px] leading-5 text-[#6c816d]">仅支持后置相机现场直拍；请让完整车牌清晰、无遮挡地处于照片中心。系统不提供相册选择，照片将自动写入项目、时间、定位、操作人与防伪编号。</p>{platePhotoPreview ? <div className="mt-2"><img src={platePhotoPreview} alt="待归档车牌直拍预览" className="max-h-48 w-full rounded-lg border border-[#c6ddc5] object-cover" /><Button type="button" variant="ghost" size="sm" className="mt-1 h-7 px-2 text-xs text-[#47754d]" onClick={() => void startPlateCamera()}><Camera className="mr-1 h-3.5 w-3.5" />重新拍摄</Button></div> : null}</Field> : <Field label="现场影像编号"><Input inputMode="numeric" value={tripDraft.evidenceId} placeholder="可选，先在水印相机上传后填写编号" onChange={event => setTripDraft(current => ({ ...current, evidenceId: event.target.value }))} /></Field>}
          <div className="rounded-xl bg-[#f9eddf] p-3 text-xs leading-5 text-[#80543d]"><div className="flex items-start gap-2"><LocateFixed className="mt-0.5 h-4 w-4 shrink-0" /><p>{gpsStatus}</p></div><p className="mt-2">{tripDraft.invoiceMode === "nfc_card" ? "保存后将立即进入所选装土点刷卡。卸土点刷卡成功后，系统按已锁定的地点、里程、方量与有效运价自动核算运费并发送通知。" : "直拍车牌票据保存后，系统锁定地点、里程、方量、运价和影像；到卸土点后可刷车辆卡或拍照确认，闭环后再核验结算。"}</p></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => requestTripClose(closeTripForm)}>取消</Button><Button variant="secondary" onClick={() => { if (saveTripLocalDraft()) toast.success("运单文字内容已保存到本机草稿；照片、凭证和定位不会保存"); else toast.error("本机草稿保存失败，请检查设备存储权限"); }}>保存本机草稿</Button><Button className={tripDraft.invoiceMode === "nfc_card" ? "bg-[#9a5128] hover:bg-[#7e3d1c]" : "bg-[#47754d] hover:bg-[#39623e]"} disabled={saveTrip.isPending || evidenceUpload.isPending || plateCameraOpen || !tripVehicleId || !tripDraft.routePresetId || (tripDraft.invoiceMode === "plate_photo" && !platePhotoFile)} onClick={() => void submitTrip()}>{saveTrip.isPending || evidenceUpload.isPending ? "正在归档…" : tripDraft.invoiceMode === "nfc_card" ? "保存票据并刷卡" : "发票"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={ticketDialogOpen} onOpenChange={open => { setTicketDialogOpen(open); if (!open) setTicketTripId(null); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>运输刷卡票据</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <p className="rounded-xl bg-[#f9eddf] p-3 text-xs leading-5 text-[#80543d]">装土票据确认后通知司机与项目主管；卸土票据确认后自动依据已锁定的运价、里程与方量生成运费并发送结果通知。</p>
          {pendingCardTrips.length ? <>
            <Field label="选择待刷票据"><Select value={ticketTripId ? String(ticketTripId) : undefined} onValueChange={value => setTicketTripId(Number(value))}><SelectTrigger><SelectValue placeholder="选择运输票据" /></SelectTrigger><SelectContent>{pendingCardTrips.map(trip => <SelectItem key={trip.id} value={String(trip.id)}>{trip.tripNo} · {!trip.loadConfirmedAt ? "待装土刷卡" : "待卸土刷卡"} · {formatMoney(trip.calculatedAmount)}</SelectItem>)}</SelectContent></Select></Field>
            {selectedTicketTrip ? <div className="rounded-xl border border-[#ecd6bd] bg-[#fff9f3] p-3 text-xs leading-5 text-[#76503d]"><p className="font-semibold text-[#613b29]">{selectedTicketTrip.tripNo} · {!selectedTicketTrip.loadConfirmedAt ? "装土票据" : "卸土票据"}</p><p className="mt-1">里程 {selectedTicketTrip.actualDistanceKm ?? "—"} km，方量 {selectedTicketTrip.volumeCubicMeters ?? "—"} m³，当前自动核算运费 {formatMoney(selectedTicketTrip.calculatedAmount)}。</p><p className="mt-2 font-medium text-[#613b29]">本次刷卡地点：{selectedTicketSite?.name ?? "未配置地点"}</p><p>现场管理员：{selectedTicketSite?.administratorName ?? "未配置"}{selectedTicketSite?.administratorUserId ? `（用户 #${selectedTicketSite.administratorUserId}）` : ""}</p>{!selectedTicketSiteId ? <p className="mt-1 text-[#9c4d27]">该票据未配置对应地点，不能刷卡。请新建一张已选择装土点和卸土点的票据。</p> : null}</div> : null}
          </> : <div className="rounded-xl border border-dashed border-[#dcc6ac] bg-[#fffaf5] p-4 text-center text-sm text-[#80543d]">当前没有待刷卡票据，请先新建装土票据。</div>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => { setTicketDialogOpen(false); openTripDialog(true); }}><Plus className="mr-1 h-4 w-4" />新建装土票据</Button>{selectedTicketTrip ? <Button disabled={!selectedTicketSiteId} className={selectedTicketTrip.loadConfirmedAt ? "bg-[#47754d] hover:bg-[#39623e]" : "bg-[#9a5128] hover:bg-[#7e3d1c]"} onClick={() => { setTicketDialogOpen(false); setFieldCardUid(""); setCardCheckDialog({ tripId: selectedTicketTrip.id, eventType: selectedTicketTrip.loadConfirmedAt ? "unload" : "load", siteId: selectedTicketSiteId ?? null }); }}>{selectedTicketTrip.loadConfirmedAt ? "开始卸土刷卡" : "开始装土刷卡"}</Button> : null}</DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(cardCheckDialog)} onOpenChange={open => { if (!open) { setCardCheckDialog(null); setFieldCardUid(""); } }}><DialogContent><DialogHeader><DialogTitle>{cardCheckDialog?.eventType === "load" ? "装土点现场刷卡" : "卸土点现场刷卡"}</DialogTitle></DialogHeader><div className="grid gap-3 py-2"><p className="rounded-xl bg-[#f9eddf] p-3 text-xs leading-5 text-[#80543d]">请将已绑定车辆射频卡靠近读卡器。键盘模拟读卡器可直接在 UID 输入框输出并回车；原始 UID 仅在本机生成 SHA-256 指纹后提交。</p><p className="rounded-xl border border-[#b4d0db] bg-[#f4fbfe] p-3 text-xs leading-5 text-[#38677a]">更换电脑后，先让读卡器进入键盘输入模式并重新允许浏览器使用本页；在新电脑填写与原现场设备一致的“现场读卡器编号”，编号会记在本机浏览器。若使用手机：Android Chrome 支持 Web NFC 时，请直接点击上方“刷 NFC 发票”并把车辆卡贴近手机；USB 键盘式读卡器接手机 OTG 后，可将 UID 输出到下方输入框再确认。iPhone 或不支持 Web NFC 的浏览器不能在网页内直接读取 NFC，请使用 UID 输入备用方式。</p>{cardCheckDialog?.siteId ? <p className="rounded-xl border border-[#ecd6bd] bg-[#fff9f3] p-3 text-xs text-[#76503d]">本次刷卡地点：{(transportSites.data ?? []).find(site => site.id === cardCheckDialog.siteId)?.name ?? `地点 #${cardCheckDialog.siteId}`}</p> : <p className="rounded-xl border border-[#f2d8bd] bg-[#fff9f3] p-3 text-xs text-[#9c4d27]">未读取到地点配置，请返回票据选择正确的装土点或卸土点后再刷卡。</p>}<Field label="现场读卡器编号"><Input value={fieldReaderDeviceId} maxLength={128} onChange={event => setFieldReaderDeviceId(event.target.value)} /></Field><Field label="读取的卡 UID"><Input autoFocus value={fieldCardUid} placeholder="读卡器输出 UID 后粘贴/回车" onChange={event => setFieldCardUid(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void submitFieldCardEvent(); } }} /></Field></div><DialogFooter><Button variant="outline" onClick={() => setCardCheckDialog(null)}>取消</Button><Button className="bg-[#9a5128] hover:bg-[#7e3d1c]" disabled={!fieldCardUid.trim() || !cardCheckDialog?.siteId || recordLoadEvent.isPending || recordUnloadEvent.isPending} onClick={() => void submitFieldCardEvent()}>{recordLoadEvent.isPending || recordUnloadEvent.isPending ? "正在确认…" : "确认现场刷卡"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(fieldCardReceipt)} onOpenChange={open => { if (!open) setFieldCardReceipt(null); }}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>{fieldCardReceipt?.eventType === "load" ? "装土刷卡现场回执" : "卸土刷卡现场回执"}</DialogTitle></DialogHeader><div className="space-y-3 py-2"><div className={`rounded-xl p-4 text-sm leading-6 ${fieldCardReceipt?.needsReview ? "bg-[#fff4e8] text-[#9c4d27]" : "bg-[#eaf5e8] text-[#47754d]"}`}><p className="font-semibold">{fieldCardReceipt?.needsReview ? "刷卡已留痕，等待人工复核" : fieldCardReceipt?.duplicate ? "该次刷卡已确认，无需重复办理" : formatVehicleStageReceipt(fieldCardReceipt?.vehiclePlateNo, fieldCardReceipt?.dailyVehicleTripOrdinal, fieldCardReceipt?.eventType ?? "load") ?? "刷卡确认成功"}</p><p className="mt-1">{fieldCardReceipt?.needsReview ? fieldCardReceipt.reason ?? "请项目主管核对现场规则。" : "请将本回执展示给司机；运输状态已在系统中实时更新。"}</p></div><p className="text-xs leading-5 text-[#80543d]">服务号不会对运输持续状态自动外发。阿里云短信审核配置完成后，可在系统设置启用司机短信提醒。</p></div><DialogFooter><Button className="bg-[#9a5128] text-white hover:bg-[#7e3d1c]" onClick={() => setFieldCardReceipt(null)}>司机已确认</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={siteDialogOpen} onOpenChange={setSiteDialogOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editingSiteId ? "维护现场地点" : "配置现场地点"}</DialogTitle></DialogHeader><div className="grid gap-3 py-2"><div className="grid grid-cols-2 gap-3"><Field label="地点类型"><Select value={siteDraft.siteType} onValueChange={value => setSiteDraft(current => ({ ...current, siteType: value as TransportSiteDraft["siteType"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="load">装土点</SelectItem><SelectItem value="unload">卸土点</SelectItem></SelectContent></Select></Field><Field label="状态"><Select value={siteDraft.status} onValueChange={value => setSiteDraft(current => ({ ...current, status: value as TransportSiteDraft["status"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">启用</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select></Field></div><Field label="地点名称"><Input value={siteDraft.name} maxLength={128} placeholder="例如：一标段 K12 装土区" onChange={event => setSiteDraft(current => ({ ...current, name: event.target.value }))} /></Field><Field label="中文详细地址"><Input value={siteDraft.address} maxLength={255} placeholder="例如：江西省南丰县 XX 镇 K12+400 东侧装土区" onChange={event => setSiteDraft(current => ({ ...current, address: event.target.value }))} /></Field><Field label="现场管理员用户 ID"><Input inputMode="numeric" value={siteDraft.administratorUserId} placeholder="必填，例如 18" onChange={event => setSiteDraft(current => ({ ...current, administratorUserId: event.target.value }))} /></Field><p className="rounded-xl bg-[#f9eddf] p-3 text-xs leading-5 text-[#80543d]">请填写实际负责刷卡的管理员用户 ID，以及可定位的中文详细地址。服务端会校验地址并在后台保存围栏计算数据；业务页面不显示经纬度。</p></div><DialogFooter><Button variant="outline" onClick={() => setSiteDialogOpen(false)}>取消</Button><Button className="bg-[#9a5128] hover:bg-[#7e3d1c]" disabled={saveSite.isPending} onClick={submitSite}>{saveSite.isPending ? "正在校验地址…" : "保存详细地址"}</Button></DialogFooter></DialogContent></Dialog>
  </div></div>;
}

function MetricCard({ label, value, warning, success }: { label: string; value: string | number; warning?: boolean; success?: boolean }) {
  return <Card className={`border-0 shadow-[0_6px_18px_rgba(71,42,30,.06)] ${warning ? "bg-[#fff3e4]" : success ? "bg-[#e7f1e5]" : "bg-white"}`}><CardContent className="p-3.5"><p className={`text-sm font-semibold ${warning ? "text-[#9c4d27]" : success ? "text-[#47754d]" : ""}`}>{value}</p><p className="mt-1 text-[11px] text-[#8f7566]">{label}</p></CardContent></Card>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label>{label}</Label><div className="mt-1">{children}</div></div>;
}

function TripCard({ trip, projectId: _projectId, canManage, onTransition, onConfirmPlatePhotoUnload }: { trip: { id: number; tripNo: string; vehiclePlateNo: string; invoiceMode: "nfc_card" | "plate_photo"; evidenceId?: number | null; status: "draft" | "submitted" | "verified" | "settled" | "void"; startAt: Date; actualDistanceKm: string | null; calculatedAmount: string | null; volumeCubicMeters: string | null; weightTons: string | null; calculatedUnitPrice: string | null; loadSiteId?: number | null; unloadSiteId?: number | null; loadConfirmedAt?: Date | null; unloadConfirmedAt?: Date | null; routeSnapshot?: unknown; anomalies: { code: string; severity: "warning" | "notice"; label: string }[] }; projectId: number; canManage: boolean; onTransition: (id: number, nextStatus: "submitted" | "verified" | "settled" | "void") => void; onConfirmPlatePhotoUnload: (tripId: number) => void }) {
  const status = getTripStatus(trip.status);
  const singleScanClosed = Boolean((trip.routeSnapshot as { nfcSingleScanClosed?: boolean } | null | undefined)?.nfcSingleScanClosed);
  const canCard = trip.invoiceMode === "nfc_card" && !singleScanClosed && !["void", "settled"].includes(trip.status);
  const openCardEvent = (eventType: "load" | "unload") => window.dispatchEvent(new CustomEvent("road-transport-card-event", { detail: { tripId: trip.id, eventType, siteId: eventType === "load" ? trip.loadSiteId ?? null : trip.unloadSiteId ?? null } }));
  return <Card className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{trip.vehiclePlateNo}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] ${trip.invoiceMode === "nfc_card" ? "bg-[#f8ead8] text-[#94603a]" : "bg-[#e7f1e5] text-[#47754d]"}`}>{trip.invoiceMode === "nfc_card" ? "NFC 刷卡" : "车牌直拍"}</span>{singleScanClosed ? <span className="rounded-full bg-[#e9eefb] px-2 py-0.5 text-[10px] text-[#415c9b]">单次闭环</span> : null}<span className={`rounded-full px-2 py-0.5 text-[10px] ${status.className}`}>{status.label}</span></div><p className="mt-1 text-xs text-[#8f7566]">{trip.tripNo} · {formatChinaDateTime(trip.startAt)} · {trip.actualDistanceKm} km</p></div><p className="text-sm font-semibold text-[#6d3f2b]">{formatMoney(trip.calculatedAmount)}</p></div><div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[#fcf8f2] p-2.5 text-[11px] text-[#765a49]"><span>方量 {trip.volumeCubicMeters ?? "—"} m³</span><span>吨位 {trip.weightTons ?? "—"} t</span><span>单价 {formatMoney(trip.calculatedUnitPrice)}</span></div>{singleScanClosed ? <div className="mt-3 rounded-xl border border-[#b9c9ee] bg-[#f1f5ff] p-2.5 text-xs leading-5 text-[#415c9b]">本趟已按管理员开启的单次刷卡模式完成闭环并进入待核验；系统未记录实际卸土扫码或卸土定位确认。</div> : null}{trip.invoiceMode === "plate_photo" ? <div className="mt-3 rounded-xl border border-[#c6ddc5] bg-[#f4fbf1] p-2.5 text-xs leading-5 text-[#47754d]">车牌直拍已作为装土发票并进入在途，已关联水印照片{trip.evidenceId ? `（影像 #${trip.evidenceId}）` : ""}。卸土点可选择拍照或刷卡确认。</div> : null}{trip.loadConfirmedAt && !trip.unloadConfirmedAt && !singleScanClosed && !["void", "settled"].includes(trip.status) ? <Button size="sm" className="mt-3 h-8 bg-[#47754d] text-xs text-white hover:bg-[#39623e]" onClick={() => onConfirmPlatePhotoUnload(trip.id)}>拍照卸土并确认</Button> : null}{trip.unloadConfirmedAt ? <p className="mt-3 text-xs font-medium text-[#47754d]">已完成卸土确认，等待主管核验。</p> : null}{trip.anomalies.length ? <div className="mt-3 rounded-xl bg-[#fff4e8] p-2.5"><div className="flex items-center gap-1.5 text-xs font-semibold text-[#9c4d27]"><AlertTriangle className="h-3.5 w-3.5" />待核验提示</div><div className="mt-1 flex flex-wrap gap-1.5">{trip.anomalies.map(item => <span key={item.code} className={`rounded-full px-2 py-0.5 text-[10px] ${item.severity === "warning" ? "bg-[#f8d9c3] text-[#9c3d1f]" : "bg-[#f7e6c8] text-[#8d652f]"}`}>{item.label}</span>)}</div></div> : null}{canCard ? <div className="mt-3 rounded-xl border border-[#ecd6bd] bg-[#fff9f3] p-2.5"><p className="text-[11px] font-medium text-[#80543d]">现场刷卡确认</p><div className="mt-2 flex gap-2">{!trip.loadConfirmedAt ? <Button size="sm" className="h-7 bg-[#9a5128] text-xs text-white hover:bg-[#7e3d1c]" onClick={() => openCardEvent("load")}>装土点刷卡</Button> : !trip.unloadConfirmedAt ? <Button size="sm" className="h-7 bg-[#47754d] text-xs text-white hover:bg-[#39623e]" onClick={() => openCardEvent("unload")}>卸土点刷卡</Button> : <span className="text-xs text-[#47754d]">装土、卸土刷卡均已确认</span>}</div></div> : null}{canManage ? (trip.status === "draft" ? <div className="mt-3 flex gap-2"><Button size="sm" className="h-7 bg-[#9a5128] text-xs text-white hover:bg-[#7e3d1c]" onClick={() => onTransition(trip.id, "submitted")}>提交核验</Button><Button size="sm" variant="ghost" className="h-7 text-xs text-[#94604a]" onClick={() => onTransition(trip.id, "void")}>作废</Button></div> : trip.status === "submitted" ? <Button size="sm" variant="outline" className="mt-3 h-7 border-[#d7b392] text-xs text-[#8a4b25]" onClick={() => onTransition(trip.id, "verified")}>核验趟次</Button> : trip.status === "verified" ? <Button size="sm" className="mt-3 h-7 bg-[#47754d] text-xs text-white hover:bg-[#39623e]" onClick={() => onTransition(trip.id, "settled")}>财务确认结算</Button> : null) : null}</CardContent></Card>;
}

function TransportSpeechControls({ statusText, onTest }: { statusText: string; onTest: () => void }) {
  return <div className="rounded-xl border border-[#c6ddc5] bg-[#f4fbf1] p-3"><Button type="button" variant="outline" size="sm" className="w-full bg-white text-[#47754d]" onClick={onTest}><Volume2 className="mr-1 h-4 w-4" />测试语音播报（不提交发票）</Button><p role="status" className="mt-2 text-xs leading-5 text-[#47754d]">{statusText}</p></div>;
}
