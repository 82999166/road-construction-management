import { MobileAccessGate } from "@/components/MobileAccessGate";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { useManagementPermissions } from "@/hooks/useManagementPermissions";
import { AlertTriangle, ArrowLeft, CircleHelp, FileText, HardHat, LayoutDashboard, LocateFixed, MapPin, Pencil, Plus, Printer, Route, Settings2, Truck, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useAuth } from "../_core/hooks/useAuth";

function getTodayText() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function formatMoney(value: string | number | null | undefined) {
  return `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

type VehicleDraft = { plateNo: string; ownerName: string; driverUserId: string; boxLengthMeters: string; boxWidthMeters: string; boxHeightMeters: string; loadFactor: string; payloadTons: string; status: "active" | "suspended" | "disabled" };
const EMPTY_VEHICLE_DRAFT: VehicleDraft = { plateNo: "", ownerName: "", driverUserId: "", boxLengthMeters: "", boxWidthMeters: "", boxHeightMeters: "", loadFactor: "1", payloadTons: "", status: "active" };
const EMPTY_RULE_DRAFT = { materialName: "", settlementUnit: "cubic_meter" as const, startDistanceKm: "1", basePricePerUnit: "", stepMeters: "500", stepIncreasePerUnit: "0", effectiveFrom: getTodayText(), effectiveTo: "", status: "active" as const };

type TripDraft = {
  freightRuleId: string;
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

function createTripDraft(freightRuleId = ""): TripDraft {
  return { freightRuleId, tripNo: "", startAt: new Date().toISOString().slice(0, 16), endAt: "", actualDistanceKm: "", volumeCubicMeters: "", weightTons: "", evidenceId: "", startLatitude: null, startLongitude: null, endLatitude: null, endLongitude: null };
}

/** 移动端运输调度：原始坐标、影像编号与业务数据进入服务端后统一核验和计算。 */
export default function MobileTransportPage() {
  const { isAuthenticated, loading, authLoadingTimedOut, refresh } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { isSuperAdmin } = useManagementPermissions();
  const [projectId, setProjectId] = useState<number | undefined>();
  const [vehicleId, setVehicleId] = useState<number | undefined>();
  const [workDate, setWorkDate] = useState(getTodayText);
  const [activeTab, setActiveTab] = useState("trips");
  const [vehicleDialogOpen, setVehicleDialogOpen] = useState(false);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [tripDialogOpen, setTripDialogOpen] = useState(false);
  const [cardCheckDialog, setCardCheckDialog] = useState<{ tripId: number; eventType: "load" | "unload" } | null>(null);
  const [fieldReaderDeviceId, setFieldReaderDeviceId] = useState("FIELD-READER-01");
  const [fieldCardUid, setFieldCardUid] = useState("");
  const [editingVehicleId, setEditingVehicleId] = useState<number | null>(null);
  const [vehicleDraft, setVehicleDraft] = useState(EMPTY_VEHICLE_DRAFT);
  const [ruleDraft, setRuleDraft] = useState(EMPTY_RULE_DRAFT);
  const [tripDraft, setTripDraft] = useState<TripDraft>(() => createTripDraft());
  const [gpsStatus, setGpsStatus] = useState("打开趟次录入后将请求定位权限。");

  const projectOptions = trpc.transport.projectOptions.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  useEffect(() => { if (!projectId && projectOptions.data?.length) setProjectId(projectOptions.data[0].id); }, [projectId, projectOptions.data]);
  const selectedProjectId = projectId ?? 0;
  const projectInput = useMemo(() => ({ projectId: selectedProjectId }), [selectedProjectId]);
  const tripsInput = useMemo(() => ({ projectId: selectedProjectId, date: workDate }), [selectedProjectId, workDate]);
  const vehicles = trpc.transport.listVehicles.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const freightRules = trpc.transport.listFreightRules.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const trips = trpc.transport.listTrips.useQuery(tripsInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const summary = trpc.transport.dailySummary.useQuery(tripsInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });

  useEffect(() => {
    if (!vehicleId && vehicles.data?.length) setVehicleId(vehicles.data[0].id);
    if (vehicleId && vehicles.data && !vehicles.data.some(vehicle => vehicle.id === vehicleId)) setVehicleId(vehicles.data[0]?.id);
  }, [vehicleId, vehicles.data]);

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

  const saveVehicle = trpc.transport.saveVehicle.useMutation({ onSuccess: async data => { toast.success(`车辆台账已保存，理论方量 ${data.theoreticalVolumeCubicMeters} m³`); setVehicleDialogOpen(false); await utils.transport.listVehicles.invalidate(); }, onError: error => toast.error(error.message) });
  const saveRule = trpc.transport.saveFreightRule.useMutation({ onSuccess: async () => { toast.success("阶梯运价规则已保存"); setRuleDialogOpen(false); await utils.transport.listFreightRules.invalidate(); }, onError: error => toast.error(error.message) });
  const saveTrip = trpc.transport.saveTrip.useMutation({ onSuccess: async data => { toast.success(data.anomalies.length ? `趟次已保存，发现 ${data.anomalies.length} 项待核验提示` : `趟次已保存，系统核算 ${formatMoney(data.amount)}`); setTripDialogOpen(false); await Promise.all([utils.transport.listTrips.invalidate(), utils.transport.dailySummary.invalidate()]); }, onError: error => toast.error(error.message) });
  const transitionTrip = trpc.transport.transitionTrip.useMutation({ onSuccess: async () => { toast.success("趟次状态已更新"); await Promise.all([utils.transport.listTrips.invalidate(), utils.transport.dailySummary.invalidate()]); }, onError: error => toast.error(error.message) });
  const recordLoadEvent = trpc.transport.recordLoadEvent.useMutation({ onSuccess: async result => { toast.success(result.needsReview ? `装土刷卡已留痕，需人工复核：${result.reason ?? "请核对"}` : result.duplicate ? "装土刷卡已处理，无需重复通知" : "装土刷卡成功，已向司机和主管发送服务号提醒"); setCardCheckDialog(null); setFieldCardUid(""); await Promise.all([utils.transport.listTrips.invalidate(), utils.transport.dailySummary.invalidate()]); }, onError: error => toast.error(error.message) });
  const recordUnloadEvent = trpc.transport.recordUnloadEvent.useMutation({ onSuccess: async result => { toast.success(result.needsReview ? `卸土刷卡已留痕，需人工复核：${result.reason ?? "请核对"}` : result.duplicate ? "卸土刷卡已处理，无需重复通知" : "卸土刷卡成功，已向司机和主管发送服务号提醒"); setCardCheckDialog(null); setFieldCardUid(""); await Promise.all([utils.transport.listTrips.invalidate(), utils.transport.dailySummary.invalidate()]); }, onError: error => toast.error(error.message) });

  function openVehicleDialog(vehicle?: NonNullable<typeof vehicles.data>[number]) {
    setEditingVehicleId(vehicle?.id ?? null);
    setVehicleDraft(vehicle ? { plateNo: vehicle.plateNo, ownerName: vehicle.ownerName ?? "", driverUserId: vehicle.driverUserId ? String(vehicle.driverUserId) : "", boxLengthMeters: String(vehicle.boxLengthMeters), boxWidthMeters: String(vehicle.boxWidthMeters), boxHeightMeters: String(vehicle.boxHeightMeters), loadFactor: String(vehicle.loadFactor), payloadTons: vehicle.payloadTons ? String(vehicle.payloadTons) : "", status: vehicle.status } : EMPTY_VEHICLE_DRAFT);
    setVehicleDialogOpen(true);
  }

  function submitVehicle() {
    if (!selectedProjectId) return toast.error("请先选择项目");
    if (!vehicleDraft.plateNo.trim() || !vehicleDraft.boxLengthMeters || !vehicleDraft.boxWidthMeters || !vehicleDraft.boxHeightMeters) return toast.error("请填写车牌和货厢长、宽、高");
    saveVehicle.mutate({ id: editingVehicleId ?? undefined, projectId: selectedProjectId, plateNo: vehicleDraft.plateNo.trim(), ownerName: vehicleDraft.ownerName.trim() || null, driverUserId: vehicleDraft.driverUserId ? Number(vehicleDraft.driverUserId) : null, boxLengthMeters: Number(vehicleDraft.boxLengthMeters), boxWidthMeters: Number(vehicleDraft.boxWidthMeters), boxHeightMeters: Number(vehicleDraft.boxHeightMeters), loadFactor: Number(vehicleDraft.loadFactor || 1), payloadTons: vehicleDraft.payloadTons ? Number(vehicleDraft.payloadTons) : null, status: vehicleDraft.status });
  }

  function submitRule() {
    if (!selectedProjectId || !ruleDraft.basePricePerUnit) return toast.error("请填写项目和基础运价");
    saveRule.mutate({ projectId: selectedProjectId, materialName: ruleDraft.materialName.trim() || null, settlementUnit: ruleDraft.settlementUnit, startDistanceKm: Number(ruleDraft.startDistanceKm), basePricePerUnit: Number(ruleDraft.basePricePerUnit), stepMeters: Number(ruleDraft.stepMeters), stepIncreasePerUnit: Number(ruleDraft.stepIncreasePerUnit), effectiveFrom: ruleDraft.effectiveFrom, effectiveTo: ruleDraft.effectiveTo || null, status: ruleDraft.status });
  }

  function submitTrip() {
    if (!selectedProjectId || !vehicleId || !tripDraft.freightRuleId || !tripDraft.actualDistanceKm) return toast.error("请填写车辆、运价规则和实际里程");
    if (tripDraft.evidenceId && (!Number.isInteger(Number(tripDraft.evidenceId)) || Number(tripDraft.evidenceId) <= 0)) return toast.error("现场影像编号应为正整数");
    saveTrip.mutate({ tripNo: tripDraft.tripNo.trim() || undefined, vehicleId, projectId: selectedProjectId, freightRuleId: Number(tripDraft.freightRuleId), startAt: new Date(tripDraft.startAt).toISOString(), endAt: tripDraft.endAt ? new Date(tripDraft.endAt).toISOString() : null, actualDistanceKm: Number(tripDraft.actualDistanceKm), volumeCubicMeters: tripDraft.volumeCubicMeters ? Number(tripDraft.volumeCubicMeters) : null, weightTons: tripDraft.weightTons ? Number(tripDraft.weightTons) : null, evidenceId: tripDraft.evidenceId ? Number(tripDraft.evidenceId) : null, startLatitude: tripDraft.startLatitude, startLongitude: tripDraft.startLongitude, endLatitude: tripDraft.endLatitude, endLongitude: tripDraft.endLongitude });
  }

  function openTripDialog() {
    const activeRule = freightRules.data?.find(rule => rule.status === "active");
    setTripDraft(createTripDraft(activeRule ? String(activeRule.id) : ""));
    setGpsStatus("正在准备定位…");
    setTripDialogOpen(true);
  }

  useEffect(() => {
    const openCardEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ tripId?: number; eventType?: "load" | "unload" }>).detail;
      if (!detail?.tripId || !detail.eventType) return;
      setFieldCardUid("");
      setCardCheckDialog({ tripId: detail.tripId, eventType: detail.eventType });
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
    const input = { tripId: cardCheckDialog.tripId, projectId: selectedProjectId, idempotencyKey: `field-${cardCheckDialog.eventType}-${crypto.randomUUID()}`, deviceId: fieldReaderDeviceId.trim() || undefined, cardFingerprint, occurredAt: new Date().toISOString() };
    if (cardCheckDialog.eventType === "load") recordLoadEvent.mutate(input); else recordUnloadEvent.mutate(input);
  }

  if (loading || !isAuthenticated || projectOptions.isLoading) return <MobileAccessGate isAuthenticated={isAuthenticated} isLoading={loading || (isAuthenticated && projectOptions.isLoading)} authLoadingTimedOut={authLoadingTimedOut} loadingText="正在加载运输管理权限…" title="运输管理" description="请使用企业统一身份进入已授权项目的运输调度数据。" Icon={Truck} onRetry={() => { void refresh(); void projectOptions.refetch(); }} />;

  const selectedProject = projectOptions.data?.find(item => item.id === selectedProjectId);
  return <div className="min-h-screen bg-[#f8f1e7] text-[#3b2118]"><div className="mx-auto min-h-screen max-w-xl bg-[#fdf7ee] pb-24 shadow-[0_0_50px_rgba(74,42,29,.12)]">
    <header className="relative overflow-hidden bg-[#3a2117] px-5 pb-6 pt-5 text-[#fff7ea] print:hidden"><div className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(255,238,215,.32)_1px,transparent_1px),linear-gradient(90deg,rgba(255,238,215,.32)_1px,transparent_1px)] [background-size:24px_24px]" /><div className="relative flex items-center justify-between"><button aria-label="返回移动工作台" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 active:scale-95" onClick={() => navigate("/mobile")}><ArrowLeft className="h-5 w-5" /></button><div className="text-center"><p className="text-sm font-semibold">运输调度</p><p className="mt-0.5 text-[11px] text-[#e8cfb2]">车辆 · GPS 趟次 · 阶梯运价</p></div><button aria-label="查看运输计价说明" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 active:scale-95" onClick={() => toast.info("运费按项目阶梯规则自动计算；已结算趟次不可回退或重算。")}><CircleHelp className="h-5 w-5" /></button></div><div className="relative mt-5 flex items-end justify-between"><div><p className="text-xs text-[#e8cfb2]">当前项目</p><p className="mt-1 text-lg font-semibold">{selectedProject?.name ?? "请选择项目"}</p></div><Route className="h-6 w-6 text-[#e7b779]" /></div></header>
    <main className="space-y-5 px-5 py-5">
      {projectOptions.error ? <Card className="border-[#f0d8c4] bg-[#fff7ef]"><CardContent className="p-4 text-sm text-[#9c4d27]">模块权限加载失败：{projectOptions.error.message}</CardContent></Card> : null}
      {!projectOptions.data?.length ? <Card className="border-0 bg-white"><CardContent className="p-8 text-center"><HardHat className="mx-auto h-8 w-8 text-[#ad6335]" /><h2 className="mt-3 font-semibold">暂无授权项目</h2><p className="mt-2 text-xs leading-5 text-[#765544]">请联系超级管理员为运输岗位配置项目或组织数据范围。</p></CardContent></Card> : <>
        <section className="grid grid-cols-[1fr_auto] gap-3 print:hidden"><Select value={projectId ? String(projectId) : undefined} onValueChange={value => { setProjectId(Number(value)); setVehicleId(undefined); }}><SelectTrigger className="h-11 border-[#e9d8c6] bg-white text-[#4d2e22]"><SelectValue placeholder="选择已授权项目" /></SelectTrigger><SelectContent>{projectOptions.data.map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select><Input aria-label="运输统计日期" className="h-11 w-[136px] border-[#e9d8c6] bg-white" type="date" value={workDate} onChange={event => setWorkDate(event.target.value)} /></section>
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-5"><MetricCard label="当日趟次" value={summary.data?.tripCount ?? 0} /><MetricCard label="结算方量" value={`${summary.data?.volumeCubicMeters ?? 0} m³`} /><MetricCard label="已核验" value={summary.data?.verifiedCount ?? 0} /><MetricCard label="异常趟次" value={summary.data?.alertTripCount ?? 0} warning /><MetricCard label="当日运费" value={formatMoney(summary.data?.amount)} success /></section>
        <section className="rounded-2xl bg-[#f0dfc7] px-4 py-3 print:hidden"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">{workDate} 运费日报</p><p className="mt-1 text-xs text-[#7d563d]">GPS、影像与方量异常均由服务端根据历史快照提示。</p></div><Button size="sm" variant="ghost" className="gap-1 text-[#8b3f20] hover:bg-[#e8cda9]" onClick={() => window.print()}><Printer className="h-4 w-4" />打印</Button></div></section>
        <section className="hidden print:block"><h1 className="text-center text-xl font-semibold">渣土运输运费日报</h1><p className="mt-2 text-center text-sm">项目：{selectedProject?.name ?? "—"}　日期：{workDate}　生成时间：{new Date().toLocaleString("zh-CN")}</p><div className="mt-4 grid grid-cols-5 gap-2 text-center text-sm"><div>趟次<p className="mt-1 font-semibold">{summary.data?.tripCount ?? 0}</p></div><div>方量<p className="mt-1 font-semibold">{summary.data?.volumeCubicMeters ?? 0} m³</p></div><div>吨位<p className="mt-1 font-semibold">{summary.data?.weightTons ?? 0} t</p></div><div>预警<p className="mt-1 font-semibold">{summary.data?.alertTripCount ?? 0}</p></div><div>运费<p className="mt-1 font-semibold">{formatMoney(summary.data?.amount)}</p></div></div></section>
        <Tabs value={activeTab} onValueChange={setActiveTab}><TabsList className={`grid h-auto w-full ${isSuperAdmin ? "grid-cols-3" : "grid-cols-1"} rounded-2xl bg-[#f0e5d7] p-1 print:hidden`}><TabsTrigger value="trips" className="rounded-xl data-[state=active]:bg-white data-[state=active]:text-[#81411f]">运输趟次</TabsTrigger>{isSuperAdmin ? <TabsTrigger value="vehicles" className="rounded-xl data-[state=active]:bg-white data-[state=active]:text-[#81411f]">车辆台账</TabsTrigger> : null}{isSuperAdmin ? <TabsTrigger value="rates" className="rounded-xl data-[state=active]:bg-white data-[state=active]:text-[#81411f]">阶梯运价</TabsTrigger> : null}</TabsList>
          <TabsContent value="trips" className="mt-4 space-y-3"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">当日运输趟次</h2><p className="mt-0.5 text-xs text-[#8f7566]">里程、方量、定位与影像均可回溯核验</p></div><Button size="sm" disabled={!vehicleId || !freightRules.data?.some(rule => rule.status === "active")} className="bg-[#a85f30] text-white hover:bg-[#8e4b22]" onClick={openTripDialog}><Plus className="mr-1 h-4 w-4" />录入趟次</Button></div><div className="grid grid-cols-[1fr_auto] gap-3 rounded-xl bg-white p-3 shadow-[0_6px_18px_rgba(71,42,30,.06)]"><Select value={vehicleId ? String(vehicleId) : undefined} onValueChange={value => setVehicleId(Number(value))}><SelectTrigger className="border-[#ead9c8] bg-[#fffaf5]"><SelectValue placeholder="选择车辆" /></SelectTrigger><SelectContent>{vehicles.data?.map(vehicle => <SelectItem key={vehicle.id} value={String(vehicle.id)}>{vehicle.plateNo}</SelectItem>)}</SelectContent></Select><span className="rounded-lg bg-[#f8ead8] px-3 py-2 text-xs text-[#80543d]">{workDate}</span></div>{trips.error ? <Card className="border-[#f0d8c4] bg-[#fff7ef]"><CardContent className="p-4 text-sm text-[#9c4d27]">运输趟次加载失败：{trips.error.message}</CardContent></Card> : !trips.data?.length && !trips.isLoading ? <Card className="border-0 bg-white"><CardContent className="p-6 text-center text-sm text-[#8f7566]">当日暂无运输趟次。</CardContent></Card> : trips.data?.map(trip => <TripCard key={trip.id} trip={trip} projectId={selectedProjectId} canManage={isSuperAdmin} onTransition={(id, nextStatus) => transitionTrip.mutate({ id, projectId: selectedProjectId, nextStatus })} />)}</TabsContent>
          {isSuperAdmin ? <TabsContent value="vehicles" className="mt-4 space-y-3"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">渣土车辆档案</h2><p className="mt-0.5 text-xs text-[#8f7566]">货厢尺寸与装载系数用于方量核验</p></div><Button size="sm" className="bg-[#a85f30] text-white hover:bg-[#8e4b22]" onClick={() => openVehicleDialog()}><Plus className="mr-1 h-4 w-4" />录入车辆</Button></div>{!vehicles.data?.length && !vehicles.isLoading ? <Card className="border-0 bg-white"><CardContent className="p-6 text-center text-sm text-[#8f7566]">当前项目尚未录入车辆。</CardContent></Card> : vehicles.data?.map(vehicle => { const status = getVehicleStatus(vehicle.status); return <Card key={vehicle.id} className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-4"><div className="flex items-start justify-between"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{vehicle.plateNo}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] ${status.className}`}>{status.label}</span></div><p className="mt-1 text-xs text-[#8f7566]">{vehicle.ownerName || "未填车主"} · 司机 {vehicle.driverUserId ? `用户 #${vehicle.driverUserId}` : "未绑定"}</p></div><button aria-label={`编辑${vehicle.plateNo}档案`} className="grid h-8 w-8 place-items-center rounded-lg bg-[#f7ead8] text-[#975227] active:scale-95" onClick={() => openVehicleDialog(vehicle)}><Pencil className="h-4 w-4" /></button></div><div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-[#fcf8f2] p-2.5 text-[11px] text-[#765a49]"><span>货厢 {vehicle.boxLengthMeters} × {vehicle.boxWidthMeters} × {vehicle.boxHeightMeters} m</span><span>装载系数 {vehicle.loadFactor}</span><span>理论方量 {vehicle.theoreticalVolumeCubicMeters} m³</span><span>核载 {vehicle.payloadTons ?? "—"} t</span></div></CardContent></Card>; })}</TabsContent> : null}
          {isSuperAdmin ? <TabsContent value="rates" className="mt-4 space-y-3"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">阶梯运价规则</h2><p className="mt-0.5 text-xs text-[#8f7566]">1 公里起步 + 每增加步长递增</p></div><Button size="sm" className="bg-[#a85f30] text-white hover:bg-[#8e4b22]" onClick={() => { setRuleDraft(EMPTY_RULE_DRAFT); setRuleDialogOpen(true); }}><Settings2 className="mr-1 h-4 w-4" />配置运价</Button></div>{!freightRules.data?.length && !freightRules.isLoading ? <Card className="border-0 bg-white"><CardContent className="p-6 text-center text-sm text-[#8f7566]">当前项目尚未配置运价规则。</CardContent></Card> : freightRules.data?.map(rule => <Card key={rule.id} className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-4"><div className="flex items-start justify-between"><div><h3 className="text-sm font-semibold">{rule.materialName || "通用运输"}</h3><p className="mt-1 text-xs text-[#8f7566]">{rule.settlementUnit === "cubic_meter" ? "按方结算" : rule.settlementUnit === "ton" ? "按吨结算" : "按趟结算"} · {new Date(rule.effectiveFrom).toLocaleDateString("zh-CN")} 起</p></div><span className={`rounded-full px-2 py-0.5 text-[10px] ${rule.status === "active" ? "bg-[#e6f1e4] text-[#47754d]" : "bg-[#eee8e2] text-[#806e60]"}`}>{rule.status === "active" ? "生效" : rule.status === "draft" ? "草稿" : "停用"}</span></div><div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[#fcf8f2] p-2.5 text-[11px] text-[#765a49]"><span>{rule.startDistanceKm} km 起步</span><span>{formatMoney(rule.basePricePerUnit)} / 单位</span><span>每 {rule.stepMeters} m + {formatMoney(rule.stepIncreasePerUnit)}</span></div></CardContent></Card>)}</TabsContent> : null}
        </Tabs>
      </>}
    </main>
    <nav className="fixed bottom-0 left-1/2 z-20 flex w-full max-w-xl -translate-x-1/2 items-center justify-around border-t border-[#ead9c8] bg-[#fffaf2]/95 px-3 py-2 backdrop-blur print:hidden"><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate("/mobile")}><LayoutDashboard className="h-5 w-5" /><span className="text-[10px]">工作台</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#9f582b]"><Truck className="h-5 w-5" /><span className="text-[10px] font-medium">运输</span></button><button className="flex flex-col items-center gap-1 px-3 py-1 text-[#8f7566]" onClick={() => navigate("/")}><UserRound className="h-5 w-5" /><span className="text-[10px]">我的</span></button></nav>
    <Dialog open={vehicleDialogOpen} onOpenChange={setVehicleDialogOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editingVehicleId ? "维护车辆档案" : "录入渣土车辆"}</DialogTitle></DialogHeader><div className="grid gap-3 py-2"><div className="grid grid-cols-2 gap-3"><Field label="车牌号"><Input value={vehicleDraft.plateNo} maxLength={32} onChange={event => setVehicleDraft(current => ({ ...current, plateNo: event.target.value }))} /></Field><Field label="车主/单位"><Input value={vehicleDraft.ownerName} maxLength={128} onChange={event => setVehicleDraft(current => ({ ...current, ownerName: event.target.value }))} /></Field></div><div className="grid grid-cols-2 gap-3"><Field label="司机用户 ID"><Input inputMode="numeric" value={vehicleDraft.driverUserId} placeholder="可选" onChange={event => setVehicleDraft(current => ({ ...current, driverUserId: event.target.value }))} /></Field><Field label="车辆状态"><Select value={vehicleDraft.status} onValueChange={value => setVehicleDraft(current => ({ ...current, status: value as typeof current.status }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">可调度</SelectItem><SelectItem value="suspended">暂缓</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select></Field></div><Field label="货厢尺寸（米）"><div className="grid grid-cols-3 gap-2"><Input type="number" min="0" placeholder="长" value={vehicleDraft.boxLengthMeters} onChange={event => setVehicleDraft(current => ({ ...current, boxLengthMeters: event.target.value }))} /><Input type="number" min="0" placeholder="宽" value={vehicleDraft.boxWidthMeters} onChange={event => setVehicleDraft(current => ({ ...current, boxWidthMeters: event.target.value }))} /><Input type="number" min="0" placeholder="高" value={vehicleDraft.boxHeightMeters} onChange={event => setVehicleDraft(current => ({ ...current, boxHeightMeters: event.target.value }))} /></div></Field><div className="grid grid-cols-2 gap-3"><Field label="装载系数"><Input type="number" min="0" max="1.5" step="0.01" value={vehicleDraft.loadFactor} onChange={event => setVehicleDraft(current => ({ ...current, loadFactor: event.target.value }))} /></Field><Field label="核载吨位"><Input type="number" min="0" value={vehicleDraft.payloadTons} placeholder="可选" onChange={event => setVehicleDraft(current => ({ ...current, payloadTons: event.target.value }))} /></Field></div></div><DialogFooter><Button variant="outline" onClick={() => setVehicleDialogOpen(false)}>取消</Button><Button className="bg-[#9a5128] hover:bg-[#7e3d1c]" disabled={saveVehicle.isPending} onClick={submitVehicle}>{saveVehicle.isPending ? "正在保存…" : "保存车辆"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>配置阶梯运价</DialogTitle></DialogHeader><div className="grid gap-3 py-2"><div className="grid grid-cols-2 gap-3"><Field label="物料名称"><Input value={ruleDraft.materialName} placeholder="可选" onChange={event => setRuleDraft(current => ({ ...current, materialName: event.target.value }))} /></Field><Field label="结算单位"><Select value={ruleDraft.settlementUnit} onValueChange={value => setRuleDraft(current => ({ ...current, settlementUnit: value as typeof current.settlementUnit }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cubic_meter">立方米</SelectItem><SelectItem value="ton">吨</SelectItem><SelectItem value="trip">趟</SelectItem></SelectContent></Select></Field></div><div className="grid grid-cols-2 gap-3"><Field label="起步里程（km）"><Input type="number" min="0" value={ruleDraft.startDistanceKm} onChange={event => setRuleDraft(current => ({ ...current, startDistanceKm: event.target.value }))} /></Field><Field label="基础单价"><Input type="number" min="0" value={ruleDraft.basePricePerUnit} onChange={event => setRuleDraft(current => ({ ...current, basePricePerUnit: event.target.value }))} /></Field></div><div className="grid grid-cols-2 gap-3"><Field label="递增步长（米）"><Input type="number" min="1" value={ruleDraft.stepMeters} onChange={event => setRuleDraft(current => ({ ...current, stepMeters: event.target.value }))} /></Field><Field label="每步增价"><Input type="number" min="0" value={ruleDraft.stepIncreasePerUnit} onChange={event => setRuleDraft(current => ({ ...current, stepIncreasePerUnit: event.target.value }))} /></Field></div><div className="grid grid-cols-2 gap-3"><Field label="生效日期"><Input type="date" value={ruleDraft.effectiveFrom} onChange={event => setRuleDraft(current => ({ ...current, effectiveFrom: event.target.value }))} /></Field><Field label="截止日期"><Input type="date" value={ruleDraft.effectiveTo} onChange={event => setRuleDraft(current => ({ ...current, effectiveTo: event.target.value }))} /></Field></div></div><DialogFooter><Button variant="outline" onClick={() => setRuleDialogOpen(false)}>取消</Button><Button className="bg-[#9a5128] hover:bg-[#7e3d1c]" disabled={saveRule.isPending} onClick={submitRule}>{saveRule.isPending ? "正在保存…" : "保存运价"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={tripDialogOpen} onOpenChange={setTripDialogOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>录入运输趟次</DialogTitle></DialogHeader><div className="grid gap-3 py-2"><div className="grid grid-cols-2 gap-3"><Field label="趟次编号"><Input value={tripDraft.tripNo} maxLength={64} placeholder="留空自动生成" onChange={event => setTripDraft(current => ({ ...current, tripNo: event.target.value }))} /></Field><Field label="阶梯运价"><Select value={tripDraft.freightRuleId} onValueChange={value => setTripDraft(current => ({ ...current, freightRuleId: value }))}><SelectTrigger><SelectValue placeholder="选择生效运价" /></SelectTrigger><SelectContent>{freightRules.data?.filter(rule => rule.status === "active").map(rule => <SelectItem key={rule.id} value={String(rule.id)}>{rule.materialName || "通用"} · {formatMoney(rule.basePricePerUnit)}</SelectItem>)}</SelectContent></Select></Field></div><div className="grid grid-cols-2 gap-3"><Field label="开始时间"><Input type="datetime-local" value={tripDraft.startAt} onChange={event => setTripDraft(current => ({ ...current, startAt: event.target.value }))} /></Field><Field label="结束时间"><Input type="datetime-local" value={tripDraft.endAt} onChange={event => setTripDraft(current => ({ ...current, endAt: event.target.value }))} /></Field></div><div className="grid grid-cols-3 gap-3"><Field label="实际里程 km"><Input type="number" min="0" value={tripDraft.actualDistanceKm} onChange={event => setTripDraft(current => ({ ...current, actualDistanceKm: event.target.value }))} /></Field><Field label="方量 m³"><Input type="number" min="0" value={tripDraft.volumeCubicMeters} placeholder="按车厢" onChange={event => setTripDraft(current => ({ ...current, volumeCubicMeters: event.target.value }))} /></Field><Field label="吨位 t"><Input type="number" min="0" value={tripDraft.weightTons} onChange={event => setTripDraft(current => ({ ...current, weightTons: event.target.value }))} /></Field></div><Field label="现场影像编号"><Input inputMode="numeric" value={tripDraft.evidenceId} placeholder="可选，先在水印相机上传后填写编号" onChange={event => setTripDraft(current => ({ ...current, evidenceId: event.target.value }))} /></Field><div className="rounded-xl bg-[#f9eddf] p-3 text-xs leading-5 text-[#80543d]"><div className="flex items-start gap-2"><LocateFixed className="mt-0.5 h-4 w-4 shrink-0" /><p>{gpsStatus}</p></div><p className="mt-2">按方结算时方量留空将使用车辆理论方量；服务端会锁定 GPS、影像、里程和运价快照，并将异常提示交由核验人处理。</p></div></div><DialogFooter><Button variant="outline" onClick={() => setTripDialogOpen(false)}>取消</Button><Button className="bg-[#9a5128] hover:bg-[#7e3d1c]" disabled={saveTrip.isPending} onClick={submitTrip}>{saveTrip.isPending ? "正在计算…" : "保存趟次"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(cardCheckDialog)} onOpenChange={open => { if (!open) { setCardCheckDialog(null); setFieldCardUid(""); } }}><DialogContent><DialogHeader><DialogTitle>{cardCheckDialog?.eventType === "load" ? "装土点现场刷卡" : "卸土点现场刷卡"}</DialogTitle></DialogHeader><div className="grid gap-3 py-2"><p className="rounded-xl bg-[#f9eddf] p-3 text-xs leading-5 text-[#80543d]">请将已绑定车辆射频卡靠近读卡器。键盘模拟读卡器可直接在 UID 输入框输出并回车；原始 UID 仅在本机生成 SHA-256 指纹后提交。</p><Field label="现场读卡器编号"><Input value={fieldReaderDeviceId} maxLength={128} onChange={event => setFieldReaderDeviceId(event.target.value)} /></Field><Field label="读取的卡 UID"><Input autoFocus value={fieldCardUid} placeholder="读卡器输出 UID 后粘贴/回车" onChange={event => setFieldCardUid(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void submitFieldCardEvent(); } }} /></Field></div><DialogFooter><Button variant="outline" onClick={() => setCardCheckDialog(null)}>取消</Button><Button className="bg-[#9a5128] hover:bg-[#7e3d1c]" disabled={!fieldCardUid.trim() || recordLoadEvent.isPending || recordUnloadEvent.isPending} onClick={() => void submitFieldCardEvent()}>{recordLoadEvent.isPending || recordUnloadEvent.isPending ? "正在确认…" : "确认现场刷卡"}</Button></DialogFooter></DialogContent></Dialog>
  </div></div>;
}

function MetricCard({ label, value, warning, success }: { label: string; value: string | number; warning?: boolean; success?: boolean }) {
  return <Card className={`border-0 shadow-[0_6px_18px_rgba(71,42,30,.06)] ${warning ? "bg-[#fff3e4]" : success ? "bg-[#e7f1e5]" : "bg-white"}`}><CardContent className="p-3.5"><p className={`text-sm font-semibold ${warning ? "text-[#9c4d27]" : success ? "text-[#47754d]" : ""}`}>{value}</p><p className="mt-1 text-[11px] text-[#8f7566]">{label}</p></CardContent></Card>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label>{label}</Label><div className="mt-1">{children}</div></div>;
}

function TripCard({ trip, projectId: _projectId, canManage, onTransition }: { trip: { id: number; tripNo: string; status: "draft" | "submitted" | "verified" | "settled" | "void"; startAt: Date; actualDistanceKm: string | null; calculatedAmount: string | null; volumeCubicMeters: string | null; weightTons: string | null; calculatedUnitPrice: string | null; loadConfirmedAt?: Date | null; unloadConfirmedAt?: Date | null; anomalies: { code: string; severity: "warning" | "notice"; label: string }[] }; projectId: number; canManage: boolean; onTransition: (id: number, nextStatus: "submitted" | "verified" | "settled" | "void") => void }) {
  const status = getTripStatus(trip.status);
  const canCard = !["void", "settled"].includes(trip.status);
  const openCardEvent = (eventType: "load" | "unload") => window.dispatchEvent(new CustomEvent("road-transport-card-event", { detail: { tripId: trip.id, eventType } }));
  return <Card className="border-0 bg-white shadow-[0_6px_18px_rgba(71,42,30,.06)]"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{trip.tripNo}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] ${status.className}`}>{status.label}</span></div><p className="mt-1 text-xs text-[#8f7566]">{new Date(trip.startAt).toLocaleString("zh-CN")} · {trip.actualDistanceKm} km</p></div><p className="text-sm font-semibold text-[#6d3f2b]">{formatMoney(trip.calculatedAmount)}</p></div><div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[#fcf8f2] p-2.5 text-[11px] text-[#765a49]"><span>方量 {trip.volumeCubicMeters ?? "—"} m³</span><span>吨位 {trip.weightTons ?? "—"} t</span><span>单价 {formatMoney(trip.calculatedUnitPrice)}</span></div>{trip.anomalies.length ? <div className="mt-3 rounded-xl bg-[#fff4e8] p-2.5"><div className="flex items-center gap-1.5 text-xs font-semibold text-[#9c4d27]"><AlertTriangle className="h-3.5 w-3.5" />待核验提示</div><div className="mt-1 flex flex-wrap gap-1.5">{trip.anomalies.map(item => <span key={item.code} className={`rounded-full px-2 py-0.5 text-[10px] ${item.severity === "warning" ? "bg-[#f8d9c3] text-[#9c3d1f]" : "bg-[#f7e6c8] text-[#8d652f]"}`}>{item.label}</span>)}</div></div> : null}{canCard ? <div className="mt-3 rounded-xl border border-[#ecd6bd] bg-[#fff9f3] p-2.5"><p className="text-[11px] font-medium text-[#80543d]">现场刷卡确认</p><div className="mt-2 flex gap-2">{!trip.loadConfirmedAt ? <Button size="sm" className="h-7 bg-[#9a5128] text-xs text-white hover:bg-[#7e3d1c]" onClick={() => openCardEvent("load")}>装土点刷卡</Button> : !trip.unloadConfirmedAt ? <Button size="sm" className="h-7 bg-[#47754d] text-xs text-white hover:bg-[#39623e]" onClick={() => openCardEvent("unload")}>卸土点刷卡</Button> : <span className="text-xs text-[#47754d]">装土、卸土刷卡均已确认</span>}</div></div> : null}{canManage ? (trip.status === "draft" ? <div className="mt-3 flex gap-2"><Button size="sm" className="h-7 bg-[#9a5128] text-xs text-white hover:bg-[#7e3d1c]" onClick={() => onTransition(trip.id, "submitted")}>提交核验</Button><Button size="sm" variant="ghost" className="h-7 text-xs text-[#94604a]" onClick={() => onTransition(trip.id, "void")}>作废</Button></div> : trip.status === "submitted" ? <Button size="sm" variant="outline" className="mt-3 h-7 border-[#d7b392] text-xs text-[#8a4b25]" onClick={() => onTransition(trip.id, "verified")}>核验趟次</Button> : trip.status === "verified" ? <Button size="sm" className="mt-3 h-7 bg-[#47754d] text-xs text-white hover:bg-[#39623e]" onClick={() => onTransition(trip.id, "settled")}>财务确认结算</Button> : null) : null}</CardContent></Card>;
}
