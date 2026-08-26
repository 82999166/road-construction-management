import { MobileAccessGate } from "@/components/MobileAccessGate";
import { MobileTransportLedger } from "@/components/MobileTransportLedger";
import { MobileTransportSiteManager } from "@/components/MobileTransportSiteManager";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { useManagementPermissions } from "@/hooks/useManagementPermissions";
import { AlertTriangle, ArrowLeft, Camera, CircleCheck, CircleHelp, FileText, HardHat, LayoutDashboard, LocateFixed, MapPin, Pencil, Plus, Printer, Route, Settings2, ShieldCheck, Truck, UserRound } from "lucide-react";
import { DEFAULT_EVIDENCE_WATERMARK_TEMPLATE, type EvidenceWatermarkTemplate } from "../../../shared/watermarkTemplate";
import { Component, lazy, Suspense, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
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
    <DialogContent className="max-w-sm"><DialogHeader><DialogTitle>正在打开刷卡发票</DialogTitle></DialogHeader><p className="text-sm leading-6 text-[#765544]">正在加载 NFC 读卡与开票功能，请稍候。页面打开后再将车辆卡贴近手机。</p><DialogFooter><Button variant="outline" onClick={onClose}>取消</Button></DialogFooter></DialogContent>
  </Dialog>;
}

function getTodayText() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function formatMoney(value: string | number | null | undefined) {
  return `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

type VehicleDraft = { plateNo: string; ownership: "owned" | "leased" | "trip_settlement"; ownerName: string; driverUserId: string; driverName: string; driverPhone: string; boxLengthMeters: string; boxWidthMeters: string; boxHeightMeters: string; loadFactor: string; payloadTons: string; status: "active" | "suspended" | "disabled" };
const EMPTY_VEHICLE_DRAFT: VehicleDraft = { plateNo: "", ownership: "trip_settlement", ownerName: "", driverUserId: "", driverName: "", driverPhone: "", boxLengthMeters: "", boxWidthMeters: "", boxHeightMeters: "", loadFactor: "1", payloadTons: "", status: "active" };
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

function createTripDraft(freightRuleId = "", invoiceMode: TripDraft["invoiceMode"] = "nfc_card"): TripDraft {
  return { invoiceMode, routePresetId: "", freightRuleId, loadSiteId: "", unloadSiteId: "", tripNo: "", startAt: new Date().toISOString().slice(0, 16), endAt: "", actualDistanceKm: "", volumeCubicMeters: "", weightTons: "", evidenceId: "", startLatitude: null, startLongitude: null, endLatitude: null, endLongitude: null };
}

type TransportSiteDraft = { siteType: "load" | "unload"; name: string; address: string; administratorUserId: string; status: "active" | "disabled" };
const EMPTY_TRANSPORT_SITE_DRAFT: TransportSiteDraft = { siteType: "load", name: "", address: "", administratorUserId: "", status: "active" };

/** 移动端运输调度：原始坐标、影像编号与业务数据进入服务端后统一核验和计算。 */
export default function MobileTransportPage() {
  const { user, isAuthenticated, loading, authLoadingTimedOut, refresh } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { isSuperAdmin } = useManagementPermissions();
  const [projectId, setProjectId] = useState<number | undefined>();
  const [vehicleId, setVehicleId] = useState<number | undefined>();
  const [workDate, setWorkDate] = useState(getTodayText);
  const [activeTab, setActiveTab] = useState("trips");
  const [vehicleDialogOpen, setVehicleDialogOpen] = useState(false);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [siteDialogOpen, setSiteDialogOpen] = useState(false);
  const [routeDialogOpen, setRouteDialogOpen] = useState(false);
  const [editingSiteId, setEditingSiteId] = useState<number | null>(null);
  const [tripDialogOpen, setTripDialogOpen] = useState(false);
  const [mobileNfcInvoiceOpen, setMobileNfcInvoiceOpen] = useState(false);
  const [ticketDialogOpen, setTicketDialogOpen] = useState(false);
  const [ticketTripId, setTicketTripId] = useState<number | null>(null);
  const [startLoadAfterTripSave, setStartLoadAfterTripSave] = useState(false);
  const [cardCheckDialog, setCardCheckDialog] = useState<{ tripId: number; eventType: "load" | "unload"; siteId: number | null } | null>(null);
  const [fieldCardReceipt, setFieldCardReceipt] = useState<{ eventType: "load" | "unload"; needsReview: boolean; duplicate: boolean; reason: string | null } | null>(null);
  const [fieldReaderDeviceId, setFieldReaderDeviceId] = useState("FIELD-READER-01");
  const [nfcLinkToken] = useState(() => new URLSearchParams(window.location.search).get("nfc")?.trim() || "");
  const [nfcReaderDeviceCode, setNfcReaderDeviceCode] = useState("");
  const [nfcInvoiceResult, setNfcInvoiceResult] = useState<{ stage: "in_transit" | "completed"; singleScanClosed: boolean; duplicate: boolean; needsReview: boolean; reason: string | null } | null>(null);
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
  const [unloadPhotoFile, setUnloadPhotoFile] = useState<File | null>(null);
  const [unloadPhotoPreview, setUnloadPhotoPreview] = useState<string | null>(null);
  const [unloadCameraOpen, setUnloadCameraOpen] = useState(false);
  const unloadCameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const unloadCameraStreamRef = useRef<MediaStream | null>(null);

  const projectOptions = trpc.transport.projectOptions.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  useEffect(() => { if (!projectId && projectOptions.data?.length) setProjectId(projectOptions.data[0].id); }, [projectId, projectOptions.data]);
  const selectedProjectId = projectId ?? 0;
  const projectInput = useMemo(() => ({ projectId: selectedProjectId }), [selectedProjectId]);
  const tripsInput = useMemo(() => ({ projectId: selectedProjectId, date: workDate }), [selectedProjectId, workDate]);
  const vehicles = trpc.transport.listVehicles.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const freightRules = trpc.transport.listFreightRules.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const transportSites = trpc.transport.listSites.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const transportSiteManagementAccess = trpc.transport.siteManagementAccess.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const readerDevices = trpc.transport.listReaderDevices.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const routePresets = trpc.transport.listRoutePresets.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const trips = trpc.transport.listTrips.useQuery(tripsInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const summary = trpc.transport.dailySummary.useQuery(tripsInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const captureConfig = trpc.evidence.captureConfig.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const evidenceUpload = trpc.evidence.upload.useMutation({ onError: error => toast.error(error.message) });
  const pendingCardTrips = useMemo(() => (trips.data ?? []).filter(trip => trip.invoiceMode === "nfc_card" && !["void", "settled"].includes(trip.status) && (!trip.loadConfirmedAt || !trip.unloadConfirmedAt)), [trips.data]);
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
    const firstActiveReader = readerDevices.data?.find(device => device.status === "active");
    if (!nfcReaderDeviceCode && firstActiveReader) setNfcReaderDeviceCode(firstActiveReader.deviceCode);
  }, [nfcReaderDeviceCode, readerDevices.data]);

  useEffect(() => {
    if (nfcLinkToken) setMobileNfcInvoiceOpen(true);
  }, [nfcLinkToken]);

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

  const saveVehicle = trpc.transport.saveVehicle.useMutation({ onSuccess: async data => { toast.success(`车辆台账已保存，理论方量 ${data.theoreticalVolumeCubicMeters} m³`); setVehicleDialogOpen(false); await utils.transport.listVehicles.invalidate(); }, onError: error => toast.error(error.message) });
  const saveRule = trpc.transport.saveFreightRule.useMutation({ onSuccess: async () => { toast.success("阶梯运价规则已保存"); setRuleDialogOpen(false); await utils.transport.listFreightRules.invalidate(); }, onError: error => toast.error(error.message) });
  const saveSite = trpc.transport.saveSite.useMutation({ onSuccess: async () => { toast.success("运输现场地点已保存"); setSiteDialogOpen(false); await utils.transport.listSites.invalidate(); }, onError: error => toast.error(error.message) });
  const saveRoutePreset = trpc.transport.saveRoutePreset.useMutation({ onSuccess: async () => { toast.success("运输路线已保存，发票将自动带入公里数和运价"); setRouteDialogOpen(false); await utils.transport.listRoutePresets.invalidate(); }, onError: error => toast.error(error.message) });
  const saveTrip = trpc.transport.saveTrip.useMutation({ onSuccess: async data => { toast.success(tripDraft.invoiceMode === "plate_photo" ? `发票成功！${data.tripNo || "运单号已自动生成"}` : data.anomalies.length ? `运输票据已保存，发现 ${data.anomalies.length} 项待核验提示` : `运输票据已保存，系统核算 ${formatMoney(data.amount)}`); setTripDialogOpen(false); await Promise.all([utils.transport.listTrips.invalidate(), utils.transport.dailySummary.invalidate()]); if (startLoadAfterTripSave) { setStartLoadAfterTripSave(false); toast.info("装土票据已生成，请在“刷卡票据”中选择该票据完成装土刷卡。"); setTicketDialogOpen(true); } }, onError: error => toast.error(error.message) });
  const transitionTrip = trpc.transport.transitionTrip.useMutation({ onSuccess: async () => { toast.success("趟次状态已更新"); await Promise.all([utils.transport.listTrips.invalidate(), utils.transport.dailySummary.invalidate()]); }, onError: error => toast.error(error.message) });
  const recordLoadEvent = trpc.transport.recordLoadEvent.useMutation({ onSuccess: async result => { setFieldCardReceipt({ eventType: "load", needsReview: result.needsReview, duplicate: result.duplicate, reason: result.reason ?? null }); toast.success(result.needsReview ? `装土刷卡已留痕，需人工复核：${result.reason ?? "请核对"}` : result.duplicate ? "装土刷卡已处理，无需重复确认" : "装土刷卡已确认，请向司机展示现场回执"); setCardCheckDialog(null); setFieldCardUid(""); await Promise.all([utils.transport.listTrips.invalidate(), utils.transport.dailySummary.invalidate()]); }, onError: error => toast.error(error.message) });
  const recordUnloadEvent = trpc.transport.recordUnloadEvent.useMutation({ onSuccess: async result => { setFieldCardReceipt({ eventType: "unload", needsReview: result.needsReview, duplicate: result.duplicate, reason: result.reason ?? null }); toast.success(result.needsReview ? `卸土刷卡已留痕，需人工复核：${result.reason ?? "请核对"}` : result.duplicate ? "卸土刷卡已处理，无需重复确认" : "卸土刷卡已确认，请向司机展示现场回执"); setCardCheckDialog(null); setFieldCardUid(""); await Promise.all([utils.transport.listTrips.invalidate(), utils.transport.dailySummary.invalidate()]); }, onError: error => toast.error(error.message) });
  const confirmPlatePhotoUnload = trpc.transport.confirmPlatePhotoUnload.useMutation({ onSuccess: async result => { toast.success(result.duplicate ? "该直拍票据已完成卸土确认" : "卸土确认成功，直拍票据已形成运输闭环"); await Promise.all([utils.transport.listTrips.invalidate(), utils.transport.dailySummary.invalidate()]); }, onError: error => toast.error(error.message) });
  const scanNfcLink = trpc.transport.scanNfcLink.useMutation({ onSuccess: async result => { const singleScanClosed = Boolean(result.singleScanClosed); setNfcInvoiceResult({ stage: result.stage, singleScanClosed, duplicate: result.duplicate, needsReview: result.needsReview, reason: result.reason ?? null }); toast.success(result.needsReview ? `刷卡事件已留痕，需人工复核：${result.reason ?? "请核对"}` : result.duplicate ? singleScanClosed ? "该次单次刷卡闭环已处理，无需重复确认" : "该次发票已处理，无需重复确认" : result.stage === "in_transit" ? "装土发票成功，系统已创建唯一在途票据并通知相关人员" : singleScanClosed ? "发票成功，本趟已按单次刷卡完成闭环并进入待核验" : "卸土发票成功，运输票据已进入待核验"); await Promise.all([utils.transport.listTrips.invalidate(), utils.transport.dailySummary.invalidate()]); }, onError: error => toast.error(error.message) });

  function openVehicleDialog(vehicle?: NonNullable<typeof vehicles.data>[number]) {
    setEditingVehicleId(vehicle?.id ?? null);
    setVehicleDraft(vehicle ? { plateNo: vehicle.plateNo, ownership: vehicle.ownership, ownerName: vehicle.ownerName ?? "", driverUserId: vehicle.driverUserId ? String(vehicle.driverUserId) : "", driverName: vehicle.driverName ?? "", driverPhone: vehicle.driverPhoneMasked ?? "", boxLengthMeters: String(vehicle.boxLengthMeters), boxWidthMeters: String(vehicle.boxWidthMeters), boxHeightMeters: String(vehicle.boxHeightMeters), loadFactor: String(vehicle.loadFactor), payloadTons: vehicle.payloadTons ? String(vehicle.payloadTons) : "", status: vehicle.status } : EMPTY_VEHICLE_DRAFT);
    setVehicleDialogOpen(true);
  }

  function submitVehicle() {
    if (!selectedProjectId) return toast.error("请先选择项目");
    if (!vehicleDraft.plateNo.trim() || !vehicleDraft.boxLengthMeters || !vehicleDraft.boxWidthMeters || !vehicleDraft.boxHeightMeters) return toast.error("请填写车牌和货厢长、宽、高");
    saveVehicle.mutate({ id: editingVehicleId ?? undefined, projectId: selectedProjectId, plateNo: vehicleDraft.plateNo.trim(), ownership: vehicleDraft.ownership, ownerName: vehicleDraft.ownerName.trim() || null, driverUserId: vehicleDraft.driverUserId ? Number(vehicleDraft.driverUserId) : null, driverName: vehicleDraft.driverName.trim() || null, driverPhone: vehicleDraft.driverPhone.trim() && !vehicleDraft.driverPhone.includes("*") ? vehicleDraft.driverPhone.trim() : undefined, boxLengthMeters: Number(vehicleDraft.boxLengthMeters), boxWidthMeters: Number(vehicleDraft.boxWidthMeters), boxHeightMeters: Number(vehicleDraft.boxHeightMeters), loadFactor: Number(vehicleDraft.loadFactor || 1), payloadTons: vehicleDraft.payloadTons ? Number(vehicleDraft.payloadTons) : null, status: vehicleDraft.status });
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
    if (!selectedProjectId || !vehicleId || !tripDraft.routePresetId) return toast.error("请先选择已设置的运输路线");
    if (tripDraft.invoiceMode === "nfc_card" && tripDraft.evidenceId && (!Number.isInteger(Number(tripDraft.evidenceId)) || Number(tripDraft.evidenceId) <= 0)) return toast.error("现场影像编号应为正整数");
    try {
      let evidenceId = tripDraft.evidenceId ? Number(tripDraft.evidenceId) : null;
      if (tripDraft.invoiceMode === "plate_photo") {
        if (!platePhotoFile) return toast.error("请先现场直拍清晰车牌照片");
        const location = tripDraft.startLatitude !== null && tripDraft.startLongitude !== null ? { latitude: tripDraft.startLatitude, longitude: tripDraft.startLongitude } : null;
        if (captureConfig.data?.location.required && !location) throw new Error("当前项目要求车牌直拍时读取现场定位");
        const capturedAt = new Date();
        const selectedVehicle = vehicles.data?.find(vehicle => vehicle.id === vehicleId);
        const template = captureConfig.data?.watermark ?? DEFAULT_EVIDENCE_WATERMARK_TEMPLATE;
        const antiCounterfeit = `${selectedProjectId}-${vehicleId}-${capturedAt.getTime().toString(36).toUpperCase()}`;
        const route = routePresets.data?.find(item => item.id === Number(tripDraft.routePresetId));
        const loadAddress = (transportSites.data ?? []).find(site => site.id === route?.loadSiteId)?.address;
        const detailedAddress = loadAddress || "现场详细地址待补充";
        const values: Record<string, string> = { capturedAt: `拍摄时间：${capturedAt.toLocaleString("zh-CN")}`, principal: `票据录入人：${user?.name || "当前管理员"}`, weather: "票据方式：车牌直拍", location: `详细地点：${detailedAddress}`, coordinates: `详细地点：${detailedAddress}`, organization: `施工单位：${template.organizationLabel}`, project: `项目名称：${selectedProject?.name ?? `项目 #${selectedProjectId}`}`, antiCounterfeit: `防伪编号：${antiCounterfeit}` };
        const watermarkedFile = await createWatermarkedTransportImage(platePhotoFile, template.fields.map(field => values[field]).filter(Boolean), template);
        const upload = await evidenceUpload.mutateAsync({ projectId: selectedProjectId, sourceType: "transport", sourceId: `transport-plate-pending-${vehicleId}-${capturedAt.getTime()}`, description: `拍照车牌运输票据 · ${selectedVehicle?.plateNo ?? `车辆 #${vehicleId}`}`.slice(0, 500), capturedAt: capturedAt.toISOString(), longitude: location?.longitude ?? null, latitude: location?.latitude ?? null, fileName: watermarkedFile.name, mimeType: "image/jpeg", base64Data: await readImageAsBase64(watermarkedFile) });
        evidenceId = upload.id;
      }
      const systemIssuedAt = new Date().toISOString();
      saveTrip.mutate({ tripNo: tripDraft.tripNo.trim() || undefined, vehicleId, projectId: selectedProjectId, routePresetId: Number(tripDraft.routePresetId), invoiceMode: tripDraft.invoiceMode, startAt: tripDraft.invoiceMode === "plate_photo" ? systemIssuedAt : new Date(tripDraft.startAt).toISOString(), endAt: tripDraft.invoiceMode === "plate_photo" ? null : tripDraft.endAt ? new Date(tripDraft.endAt).toISOString() : null, weightTons: tripDraft.invoiceMode === "plate_photo" ? null : tripDraft.weightTons ? Number(tripDraft.weightTons) : null, evidenceId, startLatitude: tripDraft.startLatitude, startLongitude: tripDraft.startLongitude, endLatitude: tripDraft.endLatitude, endLongitude: tripDraft.endLongitude });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "车牌直拍凭证处理失败，请重试");
    }
  }

  function openTripDialog(startLoadAfterSave = false, invoiceMode: TripDraft["invoiceMode"] = "nfc_card") {
    const defaultRoute = routePresets.data?.find(route => route.status === "active" && route.isDefault) ?? routePresets.data?.find(route => route.status === "active");
    stopPlateCamera();
    if (platePhotoPreview) URL.revokeObjectURL(platePhotoPreview);
    setPlatePhotoFile(null);
    setPlatePhotoPreview(null);
    setPlateVehicleSearch("");
    setTripDraft({ ...createTripDraft(defaultRoute ? String(defaultRoute.freightRuleId) : "", invoiceMode), routePresetId: defaultRoute ? String(defaultRoute.id) : "", loadSiteId: defaultRoute ? String(defaultRoute.loadSiteId) : "", unloadSiteId: defaultRoute ? String(defaultRoute.unloadSiteId) : "", actualDistanceKm: defaultRoute ? String(defaultRoute.presetDistanceKm) : "" });
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
    if (!nfcReaderDeviceCode) return toast.error("请先选择当前装土点或卸土点的已登记读卡设备");
    scanNfcLink.mutate({ token: nfcLinkToken, readerDeviceCode: nfcReaderDeviceCode, idempotencyKey: `nfc-link-${crypto.randomUUID()}`, latitude: null, longitude: null, occurredAt: new Date().toISOString() });
  }

  async function confirmPlatePhotoTripUnload(tripId: number) {
    if (!selectedProjectId || !unloadPhotoFile) return toast.error("请先使用后置相机拍摄卸土现场照片");
    if (!("geolocation" in navigator)) return toast.error("当前设备不支持定位，不能确认直拍票据卸土");
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        const capturedAt = new Date();
        const trip = (trips.data ?? []).find(item => item.id === tripId);
        const unloadSite = (transportSites.data ?? []).find(site => site.id === trip?.unloadSiteId);
        const template = captureConfig.data?.watermark ?? DEFAULT_EVIDENCE_WATERMARK_TEMPLATE;
        const antiCounterfeit = `${selectedProjectId}-${tripId}-UNLOAD-${capturedAt.getTime().toString(36).toUpperCase()}`;
        const values: Record<string, string> = { capturedAt: `拍摄时间：${capturedAt.toLocaleString("zh-CN")}`, principal: `卸土确认人：${user?.name || "当前管理员"}`, weather: "现场环节：卸土确认", location: `详细地点：${unloadSite?.address || "卸土点地址待补充"}`, coordinates: `详细地点：${unloadSite?.address || "卸土点地址待补充"}`, organization: `施工单位：${template.organizationLabel}`, project: `项目名称：${selectedProject?.name ?? `项目 #${selectedProjectId}`}`, antiCounterfeit: `防伪编号：${antiCounterfeit}` };
        const watermarkedFile = await createWatermarkedTransportImage(unloadPhotoFile, template.fields.map(field => values[field]).filter(Boolean), template);
        const upload = await evidenceUpload.mutateAsync({ projectId: selectedProjectId, sourceType: "transport", sourceId: `transport-unload-pending-${tripId}-${capturedAt.getTime()}`, description: `直拍票据卸土现场照片 · ${trip?.tripNo ?? `运单 #${tripId}`}`.slice(0, 500), capturedAt: capturedAt.toISOString(), longitude: position.coords.longitude, latitude: position.coords.latitude, fileName: watermarkedFile.name, mimeType: "image/jpeg", base64Data: await readImageAsBase64(watermarkedFile) });
        if (!upload.id) throw new Error("卸土现场照片未取得归档编号，请重新拍摄后确认");
        confirmPlatePhotoUnload.mutate({ tripId, projectId: selectedProjectId, unloadEvidenceId: upload.id, idempotencyKey: `plate-unload-${tripId}-${crypto.randomUUID()}`, latitude: position.coords.latitude, longitude: position.coords.longitude, occurredAt: capturedAt.toISOString() });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "卸土现场照片归档失败，请重试");
      }
    }, () => toast.error("请允许定位权限后在卸土点确认直拍票据"), { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 });
  }

  if (loading || !isAuthenticated || projectOptions.isLoading) return <MobileAccessGate isAuthenticated={isAuthenticated} isLoading={loading || (isAuthenticated && projectOptions.isLoading)} authLoadingTimedOut={authLoadingTimedOut} loadingText="正在加载运输管理权限…" title="运输管理" description="请使用企业统一身份进入已授权项目的运输调度数据。" Icon={Truck} onRetry={() => { void refresh(); void projectOptions.refetch(); }} />;

  const selectedProject = projectOptions.data?.find(item => item.id === selectedProjectId);
  const selectedTicketTrip = pendingCardTrips.find(trip => trip.id === ticketTripId) ?? null;
  const selectedTicketSiteId = selectedTicketTrip ? (selectedTicketTrip.loadConfirmedAt ? selectedTicketTrip.unloadSiteId : selectedTicketTrip.loadSiteId) : null;
  const selectedTicketSite = (transportSites.data ?? []).find(site => site.id === selectedTicketSiteId) ?? null;
  return <div className="min-h-screen bg-[#f8f1e7] text-[#3b2118]"><div className="mx-auto min-h-screen max-w-xl bg-[#fdf7ee] pb-24 shadow-[0_0_50px_rgba(74,42,29,.12)]">
    <header className="relative overflow-hidden bg-[#3a2117] px-5 pb-6 pt-5 text-[#fff7ea] print:hidden"><div className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(255,238,215,.32)_1px,transparent_1px),linear-gradient(90deg,rgba(255,238,215,.32)_1px,transparent_1px)] [background-size:24px_24px]" /><div className="relative flex items-center justify-between"><button aria-label="返回移动工作台" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 active:scale-95" onClick={() => navigate("/mobile")}><ArrowLeft className="h-5 w-5" /></button><div className="text-center"><p className="text-sm font-semibold">运输调度</p><p className="mt-0.5 text-[11px] text-[#e8cfb2]">刷卡票据 · GPS 趟次 · 阶梯运价</p></div><button aria-label="查看运输计价说明" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 active:scale-95" onClick={() => toast.info("装土、卸土刷卡均以车辆卡、GPS 与运价快照留痕；运费由服务端自动计算。")}><CircleHelp className="h-5 w-5" /></button></div><div className="relative mt-5 flex items-end justify-between"><div><p className="text-xs text-[#e8cfb2]">当前项目</p><p className="mt-1 text-lg font-semibold">{selectedProject?.name ?? "请选择项目"}</p></div><button aria-label="设置运输路线" className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 active:scale-95" onClick={() => setRouteDialogOpen(true)}><Route className="h-5 w-5 text-[#e7b779]" /></button></div></header>
    <main className="space-y-5 px-5 py-5">
      {projectOptions.error ? <Card className="border-[#f0d8c4] bg-[#fff7ef]"><CardContent className="p-4 text-sm text-[#9c4d27]">模块权限加载失败：{projectOptions.error.message}</CardContent></Card> : null}
      {!projectOptions.data?.length ? <Card className="border-0 bg-white"><CardContent className="p-8 text-center"><HardHat className="mx-auto h-8 w-8 text-[#ad6335]" /><h2 className="mt-3 font-semibold">暂无授权项目</h2><p className="mt-2 text-xs leading-5 text-[#765544]">请联系超级管理员为运输岗位配置项目或组织数据范围。</p></CardContent></Card> : <>
        <section className="grid w-full max-w-full grid-cols-[minmax(0,1fr)_132px] gap-2 overflow-hidden print:hidden"><div className="min-w-0 overflow-hidden"><Select value={projectId ? String(projectId) : undefined} onValueChange={value => { setProjectId(Number(value)); setVehicleId(undefined); }}><SelectTrigger className="h-11 min-w-0 max-w-full border-[#e9d8c6] bg-white text-[#4d2e22]"><SelectValue className="block truncate" placeholder="选择已授权项目" /></SelectTrigger><SelectContent>{projectOptions.data.map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select></div><Input aria-label="运输统计日期" className="h-11 w-[132px] min-w-[132px] border-[#e9d8c6] bg-white px-1 text-[12px]" type="date" value={workDate} onChange={event => setWorkDate(event.target.value)} /></section>
        <section className="grid grid-cols-3 gap-3 sm:grid-cols-6"><MetricCard label="当日发票" value={summary.data?.tripCount ?? 0} /><MetricCard label="NFC 票据" value={summary.data?.nfcCardTicketCount ?? 0} /><MetricCard label="直拍票据" value={summary.data?.platePhotoTicketCount ?? 0} /><MetricCard label="结算方量" value={`${summary.data?.volumeCubicMeters ?? 0} m³`} /><MetricCard label="待核验" value={summary.data?.submittedCount ?? 0} warning /><MetricCard label="当日运费" value={formatMoney(summary.data?.amount)} success /></section>
        <section className="grid grid-cols-2 gap-2 print:hidden">
          <MobileTransportSiteManager projectId={selectedProjectId} canManage={Boolean(transportSiteManagementAccess.data?.canManage)} onConfigureRoutes={() => setRouteDialogOpen(true)} compact />
        </section>
        {isSuperAdmin ? <section className="print:hidden"><div className="mb-2 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#8a591f]" /><p className="text-sm font-semibold text-[#5f3824]">超级管理员设置</p></div><p className="mb-2 text-xs leading-5 text-[#8f7566]">仅超级管理员可维护运输闭环和安全阈值；普通运输管理员不会显示此入口。</p><Suspense fallback={<Card className="border-0 bg-white"><CardContent className="p-4 text-sm text-[#8f7566]">正在加载运输安全设置…</CardContent></Card>}><TransportRouteSafetySettings projectId={selectedProjectId} compact /></Suspense></section> : null}
        <section className="hidden grid-cols-2 gap-3 print:hidden"><Card className="border border-[#e7c9a8] bg-[#fff8ed] shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-3"><div className="flex items-center gap-2 text-[#8a4b25]"><MapPin className="h-4 w-4" /><p className="text-xs font-semibold">装土点设置</p></div><p className="mt-2 truncate text-sm font-semibold">{activeLoadSites.length ? activeLoadSites.map(site => site.name).join("、") : "暂未配置"}</p><p className="mt-1 text-[11px] text-[#8f7566]">启用 {activeLoadSites.length} 个 · {activeLoadSites[0]?.administratorName || "待指定管理员"}</p>{isSuperAdmin ? <Button variant="ghost" size="sm" className="mt-2 h-7 px-0 text-xs text-[#8a4b25]" onClick={() => { setActiveTab("sites"); openSiteDialog(activeLoadSites[0]); }}><Settings2 className="mr-1 h-3.5 w-3.5" />设置装土点</Button> : null}</CardContent></Card><Card className="border border-[#bfd9c3] bg-[#f4fbf1] shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-3"><div className="flex items-center gap-2 text-[#47754d]"><MapPin className="h-4 w-4" /><p className="text-xs font-semibold">卸土点设置</p></div><p className="mt-2 truncate text-sm font-semibold">{activeUnloadSites.length ? activeUnloadSites.map(site => site.name).join("、") : "暂未配置"}</p><p className="mt-1 text-[11px] text-[#6c816d]">启用 {activeUnloadSites.length} 个 · {activeUnloadSites[0]?.administratorName || "待指定管理员"}</p>{isSuperAdmin ? <Button variant="ghost" size="sm" className="mt-2 h-7 px-0 text-xs text-[#47754d]" onClick={() => { setActiveTab("sites"); openSiteDialog(activeUnloadSites[0]); }}><Settings2 className="mr-1 h-3.5 w-3.5" />设置卸土点</Button> : null}</CardContent></Card></section>
        <section className="rounded-2xl bg-[#f0dfc7] px-4 py-3 print:hidden"><div><p className="text-sm font-semibold">{workDate} 运输日报</p><p className="mt-1 text-xs text-[#7d563d]">打开刷卡发票页面后，车辆卡靠近手机会自动带出车辆；车牌直拍只在车辆卡未随车时使用。</p></div><div className="mt-3 grid grid-cols-2 gap-3"><button type="button" className="min-h-28 rounded-2xl bg-[#9a5128] p-4 text-left text-white shadow-[0_8px_18px_rgba(128,66,31,.2)] active:scale-[.98]" onClick={() => setMobileNfcInvoiceOpen(true)}><FileText className="h-6 w-6" /><p className="mt-3 text-base font-semibold">刷 NFC 卡发票</p><p className="mt-1 text-[11px] text-[#ffe5cd]">打开页面后直接贴卡 · 自动读取车辆</p></button><button type="button" className="min-h-28 rounded-2xl bg-[#47754d] p-4 text-left text-white shadow-[0_8px_18px_rgba(49,94,57,.18)] active:scale-[.98]" onClick={() => openTripDialog(false, "plate_photo")}><Camera className="h-6 w-6" /><p className="mt-3 text-base font-semibold">拍照车牌发票</p><p className="mt-1 text-[11px] text-[#dff1dc]">车辆卡未随车 · 直拍后待核验</p></button></div><div className="mt-3 grid grid-cols-2 gap-1"><Button size="sm" variant="ghost" className="h-8 gap-1 px-1 text-[#8b3f20] hover:bg-[#e8cda9]" onClick={openTicketDialog}><FileText className="h-4 w-4" />待刷 NFC 票据</Button><Button size="sm" variant="ghost" className="h-8 gap-1 px-1 text-[#8b3f20] hover:bg-[#e8cda9]" onClick={() => window.print()}><Printer className="h-4 w-4" />打印日汇总</Button></div></section>
        <MobileTransportLedger projectId={selectedProjectId} workDate={workDate} vehicles={(vehicles.data ?? []).map(vehicle => ({ id: vehicle.id, plateNo: vehicle.plateNo }))} />
        <section className="hidden print:block"><h1 className="text-center text-xl font-semibold">渣土运输运费日报</h1><p className="mt-2 text-center text-sm">项目：{selectedProject?.name ?? "—"}　日期：{workDate}　生成时间：{new Date().toLocaleString("zh-CN")}</p><div className="mt-4 grid grid-cols-5 gap-2 text-center text-sm"><div>趟次<p className="mt-1 font-semibold">{summary.data?.tripCount ?? 0}</p></div><div>方量<p className="mt-1 font-semibold">{summary.data?.volumeCubicMeters ?? 0} m³</p></div><div>吨位<p className="mt-1 font-semibold">{summary.data?.weightTons ?? 0} t</p></div><div>预警<p className="mt-1 font-semibold">{summary.data?.alertTripCount ?? 0}</p></div><div>运费<p className="mt-1 font-semibold">{formatMoney(summary.data?.amount)}</p></div></div></section>
        {isSuperAdmin ? <Tabs value={activeTab} onValueChange={setActiveTab}><TabsList className="grid h-auto w-full grid-cols-4 rounded-2xl bg-[#f0e5d7] p-1 print:hidden"><TabsTrigger value="trips" onClick={() => { setActiveTab("trips"); window.setTimeout(() => document.getElementById("transport-ticket-list")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); }} className="rounded-xl data-[state=active]:bg-white data-[state=active]:text-[#81411f]">运输票据（后台）</TabsTrigger><TabsTrigger value="vehicles" className="rounded-xl data-[state=active]:bg-white data-[state=active]:text-[#81411f]">车辆台账</TabsTrigger><TabsTrigger value="rates" className="rounded-xl data-[state=active]:bg-white data-[state=active]:text-[#81411f]">阶梯运价</TabsTrigger><TabsTrigger value="sites" className="rounded-xl data-[state=active]:bg-white data-[state=active]:text-[#81411f]">现场地点</TabsTrigger></TabsList>
        <TabsContent value="trips" id="transport-ticket-list" className="mt-4 space-y-3"><div><h2 className="text-base font-semibold">按车辆日汇总</h2><p className="mt-0.5 text-xs text-[#8f7566]">每台车的发票数量、双模式来源、方量、运费与待核验数量均按当前日期统计。</p></div>{summary.data?.vehicleSummaries?.length ? <div className="space-y-2">{summary.data.vehicleSummaries.map(item => <Card key={item.vehicleId} className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-3"><div className="flex items-center justify-between"><p className="font-semibold">{item.plateNo}</p><p className="text-sm font-semibold text-[#6d3f2b]">{formatMoney(item.amount)}</p></div><div className="mt-2 grid grid-cols-4 gap-1 text-center text-[10px]"><span className="rounded-lg bg-[#f8ead8] px-1.5 py-1">发票 {item.ticketCount}</span><span className="rounded-lg bg-[#fff3e4] px-1.5 py-1">NFC {item.nfcCardTicketCount}</span><span className="rounded-lg bg-[#e7f1e5] px-1.5 py-1">直拍 {item.platePhotoTicketCount}</span><span className="rounded-lg bg-[#f0f3f7] px-1.5 py-1">待核 {item.pendingReviewCount}</span></div><p className="mt-2 text-[11px] text-[#8f7566]">方量 {item.volumeCubicMeters} m³ · 已核验 {item.verifiedCount} 笔</p></CardContent></Card>)}</div> : <Card className="border-0 bg-white"><CardContent className="p-5 text-center text-sm text-[#8f7566]">当前日期暂无车辆日汇总。</CardContent></Card>}<div className="flex items-center justify-between pt-2"><div><h2 className="text-base font-semibold">当日运输运单</h2><p className="mt-0.5 text-xs text-[#8f7566]">按车辆逐单查看里程、方量、模式、状态、影像和运费。</p></div></div><div className="grid grid-cols-[1fr_auto] gap-3 rounded-xl bg-white p-3 shadow-[0_6px_18px_rgba(71,42,30,.06)]"><Select value={vehicleId ? String(vehicleId) : undefined} onValueChange={value => setVehicleId(Number(value))}><SelectTrigger className="border-[#ead9c8] bg-[#fffaf5]"><SelectValue placeholder="选择车辆" /></SelectTrigger><SelectContent>{vehicles.data?.map(vehicle => <SelectItem key={vehicle.id} value={String(vehicle.id)}>{vehicle.plateNo}</SelectItem>)}</SelectContent></Select><span className="rounded-lg bg-[#f8ead8] px-3 py-2 text-xs text-[#80543d]">{workDate}</span></div>{trips.error ? <Card className="border-[#f0d8c4] bg-[#fff7ef]"><CardContent className="p-4 text-sm text-[#9c4d27]">运输票据加载失败：{trips.error.message}</CardContent></Card> : !trips.data?.length && !trips.isLoading ? <Card className="border-0 bg-white"><CardContent className="p-6 text-center text-sm text-[#8f7566]">当前日期暂无运输票据。请通过上方任一发票方式创建票据。</CardContent></Card> : trips.data?.map(trip => <TripCard key={trip.id} trip={trip} projectId={selectedProjectId} canManage={isSuperAdmin} onTransition={(id, nextStatus) => transitionTrip.mutate({ id, projectId: selectedProjectId, nextStatus })} onConfirmPlatePhotoUnload={tripId => { if (unloadPhotoPreview) URL.revokeObjectURL(unloadPhotoPreview); setUnloadPhotoFile(null); setUnloadPhotoPreview(null); setPlateUnloadDialogTripId(tripId); }} />)}</TabsContent>
          {isSuperAdmin ? <TabsContent value="vehicles" className="mt-4 space-y-3"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">渣土车辆档案</h2><p className="mt-0.5 text-xs text-[#8f7566]">货厢尺寸与装载系数用于方量核验</p></div><Button size="sm" className="bg-[#a85f30] text-white hover:bg-[#8e4b22]" onClick={() => openVehicleDialog()}><Plus className="mr-1 h-4 w-4" />录入车辆</Button></div>{!vehicles.data?.length && !vehicles.isLoading ? <Card className="border-0 bg-white"><CardContent className="p-6 text-center text-sm text-[#8f7566]">当前项目尚未录入车辆。</CardContent></Card> : vehicles.data?.map(vehicle => { const status = getVehicleStatus(vehicle.status); return <Card key={vehicle.id} className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-4"><div className="flex items-start justify-between"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{vehicle.plateNo}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] ${status.className}`}>{status.label}</span></div><p className="mt-1 text-xs text-[#8f7566]">{vehicle.ownerName || "未填车主"} · 司机 {vehicle.driverUserId ? `用户 #${vehicle.driverUserId}` : "未绑定"}</p></div><button aria-label={`编辑${vehicle.plateNo}档案`} className="grid h-8 w-8 place-items-center rounded-lg bg-[#f7ead8] text-[#975227] active:scale-95" onClick={() => openVehicleDialog(vehicle)}><Pencil className="h-4 w-4" /></button></div><div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-[#fcf8f2] p-2.5 text-[11px] text-[#765a49]"><span>货厢 {vehicle.boxLengthMeters} × {vehicle.boxWidthMeters} × {vehicle.boxHeightMeters} m</span><span>装载系数 {vehicle.loadFactor}</span><span>理论方量 {vehicle.theoreticalVolumeCubicMeters} m³</span><span>核载 {vehicle.payloadTons ?? "—"} t</span></div></CardContent></Card>; })}</TabsContent> : null}
          {isSuperAdmin ? <TabsContent value="rates" className="mt-4 space-y-3"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">阶梯运价规则</h2><p className="mt-0.5 text-xs text-[#8f7566]">1 公里起步 + 每增加步长递增</p></div><Button size="sm" className="bg-[#a85f30] text-white hover:bg-[#8e4b22]" onClick={() => { setRuleDraft(EMPTY_RULE_DRAFT); setRuleDialogOpen(true); }}><Settings2 className="mr-1 h-4 w-4" />配置运价</Button></div>{!freightRules.data?.length && !freightRules.isLoading ? <Card className="border-0 bg-white"><CardContent className="p-6 text-center text-sm text-[#8f7566]">当前项目尚未配置运价规则。</CardContent></Card> : freightRules.data?.map(rule => <Card key={rule.id} className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-4"><div className="flex items-start justify-between"><div><h3 className="text-sm font-semibold">{rule.materialName || "通用运输"}</h3><p className="mt-1 text-xs text-[#8f7566]">{rule.settlementUnit === "cubic_meter" ? "按方结算" : rule.settlementUnit === "ton" ? "按吨结算" : "按趟结算"} · {new Date(rule.effectiveFrom).toLocaleDateString("zh-CN")} 起</p></div><span className={`rounded-full px-2 py-0.5 text-[10px] ${rule.status === "active" ? "bg-[#e6f1e4] text-[#47754d]" : "bg-[#eee8e2] text-[#806e60]"}`}>{rule.status === "active" ? "生效" : rule.status === "draft" ? "草稿" : "停用"}</span></div><div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[#fcf8f2] p-2.5 text-[11px] text-[#765a49]"><span>{rule.startDistanceKm} km 起步</span><span>{formatMoney(rule.basePricePerUnit)} / 单位</span><span>每 {rule.stepMeters} m + {formatMoney(rule.stepIncreasePerUnit)}</span></div></CardContent></Card>)}</TabsContent> : null}
          {isSuperAdmin ? <TabsContent value="sites" className="mt-4 space-y-3"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">装卸现场地点</h2><p className="mt-0.5 text-xs text-[#8f7566]">每个地点须指定一名现场刷卡管理员，票据才能进入刷卡闭环。</p></div><Button size="sm" className="bg-[#a85f30] text-white hover:bg-[#8e4b22]" onClick={() => openSiteDialog()}><Plus className="mr-1 h-4 w-4" />配置地点</Button></div>{!transportSites.data?.length && !transportSites.isLoading ? <Card className="border-0 bg-white"><CardContent className="p-6 text-center text-sm text-[#8f7566]">请先配置装土点和卸土点，并分别指定现场刷卡管理员。</CardContent></Card> : transportSites.data?.map(site => <Card key={site.id} className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{site.name}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] ${site.siteType === "load" ? "bg-[#f8ead8] text-[#94603a]" : "bg-[#e6f1e4] text-[#47754d]"}`}>{site.siteType === "load" ? "装土点" : "卸土点"}</span><span className={`rounded-full px-2 py-0.5 text-[10px] ${site.status === "active" ? "bg-[#e2f0ed] text-[#3e746a]" : "bg-[#eee8e2] text-[#857365]"}`}>{site.status === "active" ? "启用" : "停用"}</span></div><p className="mt-1 text-xs text-[#8f7566]">{site.address || "未填写地址"}</p><p className="mt-1 text-xs text-[#80543d]">现场管理员：{site.administratorName || "未配置"}{site.administratorUserId ? `（用户 #${site.administratorUserId}）` : ""}</p></div><button aria-label={`编辑${site.name}`} className="grid h-8 w-8 place-items-center rounded-lg bg-[#f7ead8] text-[#975227] active:scale-95" onClick={() => openSiteDialog(site)}><Pencil className="h-4 w-4" /></button></div></CardContent></Card>)}</TabsContent> : null}
        </Tabs> : null}
      </>}
    </main>
    {mobileNfcInvoiceOpen ? <NfcInvoiceLoadBoundary onClose={() => setMobileNfcInvoiceOpen(false)}><Suspense fallback={<NfcInvoiceLoadingDialog onClose={() => setMobileNfcInvoiceOpen(false)} />}><MobileNfcTransportInvoice open={mobileNfcInvoiceOpen} onOpenChange={setMobileNfcInvoiceOpen} initialToken={nfcLinkToken} /></Suspense></NfcInvoiceLoadBoundary> : null}
    <nav className="fixed bottom-0 left-1/2 z-20 flex w-full max-w-xl -translate-x-1/2 items-center justify-around border-t border-[#ead9c8] bg-[#fffaf2]/95 px-3 py-2 backdrop-blur print:hidden"><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate("/mobile")}><LayoutDashboard className="h-5 w-5" /><span className="text-[10px]">工作台</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#9f582b]"><Truck className="h-5 w-5" /><span className="text-[10px] font-medium">运输</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate("/mobile/profile")}><UserRound className="h-5 w-5" /><span className="text-[10px]">我的</span></button></nav>
    <Dialog open={Boolean(plateUnloadDialogTripId)} onOpenChange={open => { if (!open) { stopUnloadCamera(); if (unloadPhotoPreview) URL.revokeObjectURL(unloadPhotoPreview); setUnloadPhotoPreview(null); setUnloadPhotoFile(null); setPlateUnloadDialogTripId(null); } }}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>卸土现场确认</DialogTitle></DialogHeader><div className="grid gap-3 py-2"><p className="rounded-xl bg-[#e7f1e5] p-3 text-xs leading-5 text-[#3f6845]">请在卸土点使用后置相机直拍卸土现场。系统将归档照片、当前时间、中文地址、定位和确认管理员；未上传照片不能完成卸土。</p>{unloadCameraOpen ? <div className="overflow-hidden rounded-xl border border-[#79a57f] bg-[#18301d]"><video ref={unloadCameraVideoRef} className="aspect-[4/3] w-full bg-black object-cover" autoPlay playsInline muted /><div className="grid grid-cols-2 gap-2 p-2"><Button type="button" variant="outline" className="border-[#c9dec9] bg-white text-[#47754d]" onClick={stopUnloadCamera}>取消拍照</Button><Button type="button" className="bg-[#47754d] text-white hover:bg-[#39623e]" onClick={captureUnloadPhoto}><Camera className="mr-1 h-4 w-4" />确认照片</Button></div></div> : <Button type="button" variant="outline" className="h-11 w-full border-dashed border-[#79a57f] bg-[#f4fbf1] text-[#47754d] hover:bg-[#e7f1e5]" onClick={() => void startUnloadCamera()}><Camera className="mr-2 h-4 w-4" />拍摄卸土现场后上传</Button>}{unloadPhotoPreview ? <img src={unloadPhotoPreview} alt="待归档卸土现场照片预览" className="max-h-56 w-full rounded-xl border border-[#c6ddc5] object-cover" /> : null}</div><DialogFooter><Button variant="outline" onClick={() => setPlateUnloadDialogTripId(null)}>取消</Button><Button className="bg-[#47754d] text-white hover:bg-[#39623e]" disabled={!unloadPhotoFile || evidenceUpload.isPending || confirmPlatePhotoUnload.isPending} onClick={() => { if (plateUnloadDialogTripId) void confirmPlatePhotoTripUnload(plateUnloadDialogTripId); }}>{evidenceUpload.isPending || confirmPlatePhotoUnload.isPending ? "正在归档确认…" : "上传照片并确认卸土"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={routeDialogOpen} onOpenChange={setRouteDialogOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>设置运输路线</DialogTitle><p className="text-sm text-muted-foreground">可连续添加多条装土点 → 卸土点路线；发票仅需选择其中一条启用路线。</p></DialogHeader>{(!activeLoadSites.length || !activeUnloadSites.length || !freightRules.data?.some(rule => rule.status === "active")) ? <div className="my-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><p>请先完成基础配置：装土点、卸土点和一条生效阶梯运价。</p><div className="mt-2 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setSiteDialogOpen(true)}>新增装卸土点</Button><Button type="button" size="sm" variant="outline" onClick={() => setRuleDialogOpen(true)}>配置阶梯运价</Button></div></div> : null}<div className="grid gap-3 py-2"><div className="grid grid-cols-2 gap-3"><Field label="装土点"><Select value={routeDraft.loadSiteId} onValueChange={value => setRouteDraft(current => ({ ...current, loadSiteId: value }))}><SelectTrigger><SelectValue placeholder="选择装土点" /></SelectTrigger><SelectContent>{activeLoadSites.map(site => <SelectItem key={site.id} value={String(site.id)}>{site.name}</SelectItem>)}</SelectContent></Select></Field><Field label="卸土点"><Select value={routeDraft.unloadSiteId} onValueChange={value => setRouteDraft(current => ({ ...current, unloadSiteId: value }))}><SelectTrigger><SelectValue placeholder="选择卸土点" /></SelectTrigger><SelectContent>{activeUnloadSites.map(site => <SelectItem key={site.id} value={String(site.id)}>{site.name}</SelectItem>)}</SelectContent></Select></Field></div><Field label="生效阶梯运价"><Select value={routeDraft.freightRuleId} onValueChange={value => setRouteDraft(current => ({ ...current, freightRuleId: value }))}><SelectTrigger><SelectValue placeholder="选择有效运价" /></SelectTrigger><SelectContent>{freightRules.data?.filter(rule => rule.status === "active").map(rule => <SelectItem key={rule.id} value={String(rule.id)}>{rule.materialName || "通用"} · 0–{rule.startDistanceKm} km {formatMoney(rule.basePricePerUnit)}/方，每 {rule.stepMeters} m +{formatMoney(rule.stepIncreasePerUnit)}/方</SelectItem>)}</SelectContent></Select></Field><Field label="预设公里数"><Input type="number" min="0.001" step="0.001" value={routeDraft.presetDistanceKm} placeholder="例如 6.5" onChange={event => setRouteDraft(current => ({ ...current, presetDistanceKm: event.target.value }))} /></Field><p className="rounded-xl bg-[#f9eddf] p-3 text-xs leading-5 text-[#80543d]">保存后可继续新增下一条路线。系统禁止同一项目重复配置相同装土点和卸土点组合，并在发票时锁定本路线公里数和有效运价。</p>{routePresets.data?.length ? <div className="space-y-1 rounded-xl bg-[#fcf8f2] p-3 text-xs text-[#765a49]">{routePresets.data.map(item => <p key={item.id}>{activeLoadSites.find(site => site.id === item.loadSiteId)?.name || `装土点 #${item.loadSiteId}`} → {activeUnloadSites.find(site => site.id === item.unloadSiteId)?.name || `卸土点 #${item.unloadSiteId}`} · {item.presetDistanceKm} km · {item.status === "active" ? "启用" : "停用"}</p>)}</div> : null}</div><DialogFooter><Button variant="outline" onClick={() => setRouteDialogOpen(false)}>取消</Button><Button className="bg-[#9a5128] hover:bg-[#7e3d1c]" disabled={saveRoutePreset.isPending} onClick={submitRoutePreset}>{saveRoutePreset.isPending ? "正在保存…" : "保存并继续添加"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={vehicleDialogOpen} onOpenChange={setVehicleDialogOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editingVehicleId ? "维护车辆档案" : "录入渣土车辆"}</DialogTitle></DialogHeader><div className="grid gap-3 py-2"><div className="grid grid-cols-2 gap-3"><Field label="车牌号"><Input value={vehicleDraft.plateNo} maxLength={32} onChange={event => setVehicleDraft(current => ({ ...current, plateNo: event.target.value }))} /></Field><Field label="资源性质"><Select value={vehicleDraft.ownership} onValueChange={value => setVehicleDraft(current => ({ ...current, ownership: value as VehicleDraft["ownership"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="owned">公司自有</SelectItem><SelectItem value="leased">外租车辆</SelectItem><SelectItem value="trip_settlement">渣土车（按趟结算）</SelectItem></SelectContent></Select></Field></div><Field label={vehicleDraft.ownership === "trip_settlement" ? "车主/车队（可选）" : "车主/单位"}><Input value={vehicleDraft.ownerName} maxLength={128} onChange={event => setVehicleDraft(current => ({ ...current, ownerName: event.target.value }))} /></Field>{vehicleDraft.ownership === "trip_settlement" ? <p className="rounded-xl bg-[#e7f1e5] p-3 text-xs leading-5 text-[#3f6845]">按趟结算渣土车不建立租赁日期、租金或租赁成本；运费只按有效运输趟次、路线运价和柴油扣款计算。</p> : null}<div className="grid grid-cols-2 gap-3"><Field label="司机用户 ID"><Input inputMode="numeric" value={vehicleDraft.driverUserId} placeholder="可选" onChange={event => setVehicleDraft(current => ({ ...current, driverUserId: event.target.value }))} /></Field><Field label="司机姓名"><Input value={vehicleDraft.driverName} placeholder="实际驾驶员姓名" onChange={event => setVehicleDraft(current => ({ ...current, driverName: event.target.value }))} /></Field><Field label="司机手机号"><Input inputMode="tel" value={vehicleDraft.driverPhone} placeholder="11 位手机号" onChange={event => setVehicleDraft(current => ({ ...current, driverPhone: event.target.value }))} /></Field><Field label="车辆状态"><Select value={vehicleDraft.status} onValueChange={value => setVehicleDraft(current => ({ ...current, status: value as typeof current.status }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">可调度</SelectItem><SelectItem value="suspended">暂缓</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select></Field></div><Field label="货厢尺寸（米）"><div className="grid grid-cols-3 gap-2"><Input type="number" min="0" placeholder="长" value={vehicleDraft.boxLengthMeters} onChange={event => setVehicleDraft(current => ({ ...current, boxLengthMeters: event.target.value }))} /><Input type="number" min="0" placeholder="宽" value={vehicleDraft.boxWidthMeters} onChange={event => setVehicleDraft(current => ({ ...current, boxWidthMeters: event.target.value }))} /><Input type="number" min="0" placeholder="高" value={vehicleDraft.boxHeightMeters} onChange={event => setVehicleDraft(current => ({ ...current, boxHeightMeters: event.target.value }))} /></div></Field><div className="grid grid-cols-2 gap-3"><Field label="装载系数"><Input type="number" min="0" max="1.5" step="0.01" value={vehicleDraft.loadFactor} onChange={event => setVehicleDraft(current => ({ ...current, loadFactor: event.target.value }))} /></Field><Field label="核载吨位"><Input type="number" min="0" value={vehicleDraft.payloadTons} placeholder="可选" onChange={event => setVehicleDraft(current => ({ ...current, payloadTons: event.target.value }))} /></Field></div></div><DialogFooter><Button variant="outline" onClick={() => setVehicleDialogOpen(false)}>取消</Button><Button className="bg-[#9a5128] hover:bg-[#7e3d1c]" disabled={saveVehicle.isPending} onClick={submitVehicle}>{saveVehicle.isPending ? "正在保存…" : "保存车辆"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>配置阶梯运价</DialogTitle></DialogHeader><div className="grid gap-3 py-2"><div className="grid grid-cols-2 gap-3"><Field label="物料名称"><Input value={ruleDraft.materialName} placeholder="可选" onChange={event => setRuleDraft(current => ({ ...current, materialName: event.target.value }))} /></Field><Field label="结算单位"><Select value={ruleDraft.settlementUnit} onValueChange={value => setRuleDraft(current => ({ ...current, settlementUnit: value as typeof current.settlementUnit }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cubic_meter">立方米</SelectItem><SelectItem value="ton">吨</SelectItem><SelectItem value="trip">趟</SelectItem></SelectContent></Select></Field></div><div className="grid grid-cols-2 gap-3"><Field label="起步里程（km）"><Input type="number" min="0" value={ruleDraft.startDistanceKm} onChange={event => setRuleDraft(current => ({ ...current, startDistanceKm: event.target.value }))} /></Field><Field label="基础单价"><Input type="number" min="0" value={ruleDraft.basePricePerUnit} onChange={event => setRuleDraft(current => ({ ...current, basePricePerUnit: event.target.value }))} /></Field></div><div className="grid grid-cols-2 gap-3"><Field label="递增步长（米）"><Input type="number" min="1" value={ruleDraft.stepMeters} onChange={event => setRuleDraft(current => ({ ...current, stepMeters: event.target.value }))} /></Field><Field label="每步增价"><Input type="number" min="0" value={ruleDraft.stepIncreasePerUnit} onChange={event => setRuleDraft(current => ({ ...current, stepIncreasePerUnit: event.target.value }))} /></Field></div><div className="grid grid-cols-2 gap-3"><Field label="生效日期"><Input type="date" value={ruleDraft.effectiveFrom} onChange={event => setRuleDraft(current => ({ ...current, effectiveFrom: event.target.value }))} /></Field><Field label="截止日期"><Input type="date" value={ruleDraft.effectiveTo} onChange={event => setRuleDraft(current => ({ ...current, effectiveTo: event.target.value }))} /></Field></div></div><DialogFooter><Button variant="outline" onClick={() => setRuleDialogOpen(false)}>取消</Button><Button className="bg-[#9a5128] hover:bg-[#7e3d1c]" disabled={saveRule.isPending} onClick={submitRule}>{saveRule.isPending ? "正在保存…" : "保存运价"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={tripDialogOpen} onOpenChange={open => { if (!open) { stopPlateCamera(); if (platePhotoPreview) URL.revokeObjectURL(platePhotoPreview); setPlatePhotoPreview(null); setPlatePhotoFile(null); } setTripDialogOpen(open); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{tripDraft.invoiceMode === "nfc_card" ? "刷 NFC 卡发票" : "拍照车牌发票"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <p className={`rounded-xl p-3 text-xs leading-5 ${tripDraft.invoiceMode === "nfc_card" ? "bg-[#f9eddf] text-[#80543d]" : "bg-[#e7f1e5] text-[#3f6845]"}`}>{tripDraft.invoiceMode === "nfc_card" ? "车辆卡随车时使用：保存后必须在装土点、卸土点按顺序完成两次 NFC 刷卡。" : "车辆卡未随车时使用：必须现场直拍清晰车牌，系统写入水印后将票据直接送主管人工核验，不可代替 NFC 刷卡。"}</p>
          {tripDraft.invoiceMode === "plate_photo" ? <Field label="搜索并选择车辆"><Input value={plateVehicleSearch} inputMode="text" maxLength={8} placeholder="输入车牌后两位，例如 A8" onChange={event => setPlateVehicleSearch(event.target.value.toUpperCase())} /><div className="mt-2 max-h-32 space-y-1 overflow-y-auto rounded-xl bg-[#fcf8f2] p-2">{platePhotoVehicleCandidates.length ? platePhotoVehicleCandidates.map(vehicle => <button key={vehicle.id} type="button" onClick={() => setVehicleId(vehicle.id)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs ${vehicleId === vehicle.id ? "bg-[#47754d] text-white" : "bg-white text-[#4d2e22]"}`}><span className="font-semibold">{vehicle.plateNo}</span><span>{vehicle.driverName || "司机未录入"}</span></button>) : <p className="px-2 py-3 text-xs text-[#8f7566]">未找到符合车牌尾号的可调度车辆。</p>}</div><p className="mt-1 text-[11px] text-[#6c816d]">当前选择：{vehicles.data?.find(vehicle => vehicle.id === vehicleId)?.plateNo || "请先选择车辆"}</p></Field> : null}
          <div className="grid gap-3"><Field label="运单编号"><Input readOnly value="系统将在发票成功后自动生成" className="bg-[#fcf8f2] text-[#8f7566]" /></Field><Field label="运输路线"><Select value={tripDraft.routePresetId} onValueChange={value => { const preset = routePresets.data?.find(item => item.id === Number(value)); setTripDraft(current => ({ ...current, routePresetId: value, loadSiteId: preset ? String(preset.loadSiteId) : "", unloadSiteId: preset ? String(preset.unloadSiteId) : "", freightRuleId: preset ? String(preset.freightRuleId) : "", actualDistanceKm: preset ? String(preset.presetDistanceKm) : "" })); }}><SelectTrigger><SelectValue placeholder="选择已设置路线" /></SelectTrigger><SelectContent>{routePresets.data?.filter(item => item.status === "active").map(item => { const load = activeLoadSites.find(site => site.id === item.loadSiteId); const unload = activeUnloadSites.find(site => site.id === item.unloadSiteId); return <SelectItem key={item.id} value={String(item.id)}>{load?.name || "装土点"} → {unload?.name || "卸土点"} · {item.presetDistanceKm} km</SelectItem>; })}</SelectContent></Select></Field></div>
          {!routePresets.data?.some(item => item.status === "active") ? <p className="rounded-xl border border-[#f2d8bd] bg-[#fff9f3] p-3 text-xs leading-5 text-[#9c4d27]">请先在“现场地点”设置装土点、卸土点和管理员，再由运输负责人配置一条启用的运输路线（预设公里数与有效运价）。</p> : <div className="grid grid-cols-3 gap-2 rounded-xl bg-[#fcf8f2] p-3 text-xs text-[#765a49]"><span>装土：{activeLoadSites.find(site => String(site.id) === tripDraft.loadSiteId)?.name || "—"}</span><span>卸土：{activeUnloadSites.find(site => String(site.id) === tripDraft.unloadSiteId)?.name || "—"}</span><span>预设 {tripDraft.actualDistanceKm || "—"} km</span><span className="col-span-2">标准方量：{vehicles.data?.find(vehicle => vehicle.id === vehicleId)?.theoreticalVolumeCubicMeters ?? "—"} m³</span><span>运价自动锁定</span></div>}
          {tripDraft.invoiceMode === "plate_photo" ? <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#fcf8f2] p-3 text-xs text-[#765a49]"><span>发票时间：系统开票时自动生成</span><span>结算方量：车辆与路线自动带入</span></div> : <><div className="grid grid-cols-2 gap-3"><Field label="开始时间"><Input type="datetime-local" value={tripDraft.startAt} onChange={event => setTripDraft(current => ({ ...current, startAt: event.target.value }))} /></Field><Field label="结束时间"><Input type="datetime-local" value={tripDraft.endAt} onChange={event => setTripDraft(current => ({ ...current, endAt: event.target.value }))} /></Field></div><Field label="吨位 t（仅按吨结算路线需要）"><Input type="number" min="0" value={tripDraft.weightTons} onChange={event => setTripDraft(current => ({ ...current, weightTons: event.target.value }))} /></Field></>}
          {tripDraft.invoiceMode === "plate_photo" ? <Field label="车牌直拍凭证">{plateCameraOpen ? <div className="overflow-hidden rounded-xl border border-[#79a57f] bg-[#18301d]"><video ref={plateCameraVideoRef} className="aspect-[4/3] w-full bg-black object-cover" autoPlay playsInline muted /><div className="grid grid-cols-2 gap-2 p-2"><Button type="button" variant="outline" className="border-[#c9dec9] bg-white text-[#47754d]" onClick={stopPlateCamera}>取消拍照</Button><Button type="button" className="bg-[#47754d] text-white hover:bg-[#39623e]" onClick={capturePlatePhoto}><Camera className="mr-1 h-4 w-4" />确认拍照</Button></div></div> : <Button type="button" variant="outline" className="h-11 w-full border-dashed border-[#79a57f] bg-[#f4fbf1] text-[#47754d] hover:bg-[#e7f1e5]" onClick={() => void startPlateCamera()}><Camera className="mr-2 h-4 w-4" />拍清车牌后上传</Button>}<p className="mt-1 text-[11px] leading-5 text-[#6c816d]">仅支持后置相机现场直拍；请让完整车牌清晰、无遮挡地处于照片中心。系统不提供相册选择，照片将自动写入项目、时间、定位、操作人与防伪编号。</p>{platePhotoPreview ? <div className="mt-2"><img src={platePhotoPreview} alt="待归档车牌直拍预览" className="max-h-48 w-full rounded-lg border border-[#c6ddc5] object-cover" /><Button type="button" variant="ghost" size="sm" className="mt-1 h-7 px-2 text-xs text-[#47754d]" onClick={() => void startPlateCamera()}><Camera className="mr-1 h-3.5 w-3.5" />重新拍摄</Button></div> : null}</Field> : <Field label="现场影像编号"><Input inputMode="numeric" value={tripDraft.evidenceId} placeholder="可选，先在水印相机上传后填写编号" onChange={event => setTripDraft(current => ({ ...current, evidenceId: event.target.value }))} /></Field>}
          <div className="rounded-xl bg-[#f9eddf] p-3 text-xs leading-5 text-[#80543d]"><div className="flex items-start gap-2"><LocateFixed className="mt-0.5 h-4 w-4 shrink-0" /><p>{gpsStatus}</p></div><p className="mt-2">{tripDraft.invoiceMode === "nfc_card" ? "保存后将立即进入所选装土点刷卡。卸土点刷卡成功后，系统按已锁定的地点、里程、方量与有效运价自动核算运费并发送通知。" : "直拍车牌票据保存后，系统锁定地点、里程、方量、运价和影像，直接进入主管核验，核验通过后才可结算。"}</p></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setTripDialogOpen(false)}>取消</Button><Button className={tripDraft.invoiceMode === "nfc_card" ? "bg-[#9a5128] hover:bg-[#7e3d1c]" : "bg-[#47754d] hover:bg-[#39623e]"} disabled={saveTrip.isPending || evidenceUpload.isPending || plateCameraOpen || !vehicleId || !tripDraft.routePresetId || (tripDraft.invoiceMode === "plate_photo" && !platePhotoFile)} onClick={() => void submitTrip()}>{saveTrip.isPending || evidenceUpload.isPending ? "正在归档…" : tripDraft.invoiceMode === "nfc_card" ? "保存票据并刷卡" : "发票"}</Button></DialogFooter>
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
    <Dialog open={Boolean(cardCheckDialog)} onOpenChange={open => { if (!open) { setCardCheckDialog(null); setFieldCardUid(""); } }}><DialogContent><DialogHeader><DialogTitle>{cardCheckDialog?.eventType === "load" ? "装土点现场刷卡" : "卸土点现场刷卡"}</DialogTitle></DialogHeader><div className="grid gap-3 py-2"><p className="rounded-xl bg-[#f9eddf] p-3 text-xs leading-5 text-[#80543d]">请将已绑定车辆射频卡靠近读卡器。键盘模拟读卡器可直接在 UID 输入框输出并回车；原始 UID 仅在本机生成 SHA-256 指纹后提交。</p>{cardCheckDialog?.siteId ? <p className="rounded-xl border border-[#ecd6bd] bg-[#fff9f3] p-3 text-xs text-[#76503d]">本次刷卡地点：{(transportSites.data ?? []).find(site => site.id === cardCheckDialog.siteId)?.name ?? `地点 #${cardCheckDialog.siteId}`}</p> : <p className="rounded-xl border border-[#f2d8bd] bg-[#fff9f3] p-3 text-xs text-[#9c4d27]">未读取到地点配置，请返回票据选择正确的装土点或卸土点后再刷卡。</p>}<Field label="现场读卡器编号"><Input value={fieldReaderDeviceId} maxLength={128} onChange={event => setFieldReaderDeviceId(event.target.value)} /></Field><Field label="读取的卡 UID"><Input autoFocus value={fieldCardUid} placeholder="读卡器输出 UID 后粘贴/回车" onChange={event => setFieldCardUid(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void submitFieldCardEvent(); } }} /></Field></div><DialogFooter><Button variant="outline" onClick={() => setCardCheckDialog(null)}>取消</Button><Button className="bg-[#9a5128] hover:bg-[#7e3d1c]" disabled={!fieldCardUid.trim() || !cardCheckDialog?.siteId || recordLoadEvent.isPending || recordUnloadEvent.isPending} onClick={() => void submitFieldCardEvent()}>{recordLoadEvent.isPending || recordUnloadEvent.isPending ? "正在确认…" : "确认现场刷卡"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(fieldCardReceipt)} onOpenChange={open => { if (!open) setFieldCardReceipt(null); }}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>{fieldCardReceipt?.eventType === "load" ? "装土刷卡现场回执" : "卸土刷卡现场回执"}</DialogTitle></DialogHeader><div className="space-y-3 py-2"><div className={`rounded-xl p-4 text-sm leading-6 ${fieldCardReceipt?.needsReview ? "bg-[#fff4e8] text-[#9c4d27]" : "bg-[#eaf5e8] text-[#47754d]"}`}><p className="font-semibold">{fieldCardReceipt?.needsReview ? "刷卡已留痕，等待人工复核" : fieldCardReceipt?.duplicate ? "该次刷卡已确认，无需重复办理" : "刷卡确认成功"}</p><p className="mt-1">{fieldCardReceipt?.needsReview ? fieldCardReceipt.reason ?? "请项目主管核对现场规则。" : "请将本回执展示给司机；运输状态已在系统中实时更新。"}</p></div><p className="text-xs leading-5 text-[#80543d]">服务号不会对运输持续状态自动外发。腾讯云短信审核配置完成后，可在系统设置启用司机短信提醒。</p></div><DialogFooter><Button className="bg-[#9a5128] text-white hover:bg-[#7e3d1c]" onClick={() => setFieldCardReceipt(null)}>司机已确认</Button></DialogFooter></DialogContent></Dialog>
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
  return <Card className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{trip.vehiclePlateNo}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] ${trip.invoiceMode === "nfc_card" ? "bg-[#f8ead8] text-[#94603a]" : "bg-[#e7f1e5] text-[#47754d]"}`}>{trip.invoiceMode === "nfc_card" ? "NFC 刷卡" : "车牌直拍"}</span>{singleScanClosed ? <span className="rounded-full bg-[#e9eefb] px-2 py-0.5 text-[10px] text-[#415c9b]">单次闭环</span> : null}<span className={`rounded-full px-2 py-0.5 text-[10px] ${status.className}`}>{status.label}</span></div><p className="mt-1 text-xs text-[#8f7566]">{trip.tripNo} · {new Date(trip.startAt).toLocaleString("zh-CN")} · {trip.actualDistanceKm} km</p></div><p className="text-sm font-semibold text-[#6d3f2b]">{formatMoney(trip.calculatedAmount)}</p></div><div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[#fcf8f2] p-2.5 text-[11px] text-[#765a49]"><span>方量 {trip.volumeCubicMeters ?? "—"} m³</span><span>吨位 {trip.weightTons ?? "—"} t</span><span>单价 {formatMoney(trip.calculatedUnitPrice)}</span></div>{singleScanClosed ? <div className="mt-3 rounded-xl border border-[#b9c9ee] bg-[#f1f5ff] p-2.5 text-xs leading-5 text-[#415c9b]">本趟已按管理员开启的单次刷卡模式完成闭环并进入待核验；系统未记录实际卸土扫码或卸土定位确认。</div> : null}{trip.invoiceMode === "plate_photo" ? <div className="mt-3 rounded-xl border border-[#c6ddc5] bg-[#f4fbf1] p-2.5 text-xs leading-5 text-[#47754d]">车牌直拍已作为装土发票并进入在途，已关联水印照片{trip.evidenceId ? `（影像 #${trip.evidenceId}）` : ""}。到达卸土点后请由现场管理员确认卸土，不补做 NFC 刷卡。</div> : null}{trip.invoiceMode === "plate_photo" && !trip.unloadConfirmedAt && !["void", "settled"].includes(trip.status) ? <Button size="sm" className="mt-3 h-8 bg-[#47754d] text-xs text-white hover:bg-[#39623e]" onClick={() => onConfirmPlatePhotoUnload(trip.id)}>到达卸土点并确认</Button> : null}{trip.invoiceMode === "plate_photo" && trip.unloadConfirmedAt ? <p className="mt-3 text-xs font-medium text-[#47754d]">直拍票据已完成卸土确认，等待主管核验。</p> : null}{trip.anomalies.length ? <div className="mt-3 rounded-xl bg-[#fff4e8] p-2.5"><div className="flex items-center gap-1.5 text-xs font-semibold text-[#9c4d27]"><AlertTriangle className="h-3.5 w-3.5" />待核验提示</div><div className="mt-1 flex flex-wrap gap-1.5">{trip.anomalies.map(item => <span key={item.code} className={`rounded-full px-2 py-0.5 text-[10px] ${item.severity === "warning" ? "bg-[#f8d9c3] text-[#9c3d1f]" : "bg-[#f7e6c8] text-[#8d652f]"}`}>{item.label}</span>)}</div></div> : null}{canCard ? <div className="mt-3 rounded-xl border border-[#ecd6bd] bg-[#fff9f3] p-2.5"><p className="text-[11px] font-medium text-[#80543d]">现场刷卡确认</p><div className="mt-2 flex gap-2">{!trip.loadConfirmedAt ? <Button size="sm" className="h-7 bg-[#9a5128] text-xs text-white hover:bg-[#7e3d1c]" onClick={() => openCardEvent("load")}>装土点刷卡</Button> : !trip.unloadConfirmedAt ? <Button size="sm" className="h-7 bg-[#47754d] text-xs text-white hover:bg-[#39623e]" onClick={() => openCardEvent("unload")}>卸土点刷卡</Button> : <span className="text-xs text-[#47754d]">装土、卸土刷卡均已确认</span>}</div></div> : null}{canManage ? (trip.status === "draft" ? <div className="mt-3 flex gap-2"><Button size="sm" className="h-7 bg-[#9a5128] text-xs text-white hover:bg-[#7e3d1c]" onClick={() => onTransition(trip.id, "submitted")}>提交核验</Button><Button size="sm" variant="ghost" className="h-7 text-xs text-[#94604a]" onClick={() => onTransition(trip.id, "void")}>作废</Button></div> : trip.status === "submitted" ? <Button size="sm" variant="outline" className="mt-3 h-7 border-[#d7b392] text-xs text-[#8a4b25]" onClick={() => onTransition(trip.id, "verified")}>核验趟次</Button> : trip.status === "verified" ? <Button size="sm" className="mt-3 h-7 bg-[#47754d] text-xs text-white hover:bg-[#39623e]" onClick={() => onTransition(trip.id, "settled")}>财务确认结算</Button> : null) : null}</CardContent></Card>;
}
