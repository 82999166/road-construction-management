import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, MapPin, Pencil, Route } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type SiteDraft = {
  id: number;
  siteType: "load" | "unload";
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  status: "active" | "disabled";
};

type RouteDraft = {
  id: number;
  loadSiteId: string;
  unloadSiteId: string;
  freightRuleId: string;
  distanceKm: string;
  minimumTransitMinutes: string;
  minimumTransitEnabled: boolean;
  unloadGeofenceMeters: string;
  unloadGeofenceEnabled: boolean;
  isDefault: boolean;
  status: "active" | "disabled";
};

const displayCoordinate = (latitude: unknown, longitude: unknown) => {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) return "未配置定位坐标";
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "未配置定位坐标";
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
};

const hasCoordinates = (latitude: unknown, longitude: unknown) => latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined;

/**
 * PC 端统一维护装土点、卸土点与既有路线。地点坐标独立保存，路线只引用地点，
 * 使移动端卸土围栏、双设备刷卡和运输台账始终使用同一份现场基础数据。
 */
export function TransportRouteConfigurationEditor({ projectId }: { projectId?: number }) {
  const utils = trpc.useUtils();
  const queryInput = { projectId: projectId ?? 0 };
  const sites = trpc.transport.listSites.useQuery(queryInput, { enabled: Boolean(projectId) });
  const routes = trpc.transport.listRoutePresets.useQuery(queryInput, { enabled: Boolean(projectId) });
  const freightRules = trpc.transport.listFreightRules.useQuery(queryInput, { enabled: Boolean(projectId) });
  const [siteDraft, setSiteDraft] = useState<SiteDraft | null>(null);
  const [routeDraft, setRouteDraft] = useState<RouteDraft | null>(null);

  const saveSite = trpc.transport.saveSite.useMutation({
    onSuccess: async () => {
      toast.success("装卸土点已更新，路线与移动端将使用新坐标");
      setSiteDraft(null);
      await Promise.all([utils.transport.listSites.invalidate(), utils.transport.listRoutePresets.invalidate()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveRoute = trpc.transport.saveRoutePreset.useMutation({
    onSuccess: async () => {
      toast.success("运输路线已更新，下一张运单立即按新配置执行");
      setRouteDraft(null);
      await utils.transport.listRoutePresets.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  const siteById = useMemo(() => new Map((sites.data ?? []).map(site => [site.id, site])), [sites.data]);
  const activeLoadSites = useMemo(() => (sites.data ?? []).filter(site => site.siteType === "load" && site.status === "active"), [sites.data]);
  const activeUnloadSites = useMemo(() => (sites.data ?? []).filter(site => site.siteType === "unload" && site.status === "active"), [sites.data]);
  const activeFreightRules = useMemo(() => (freightRules.data ?? []).filter(rule => rule.status === "active"), [freightRules.data]);

  if (!projectId) return null;

  const openSiteEditor = (site: NonNullable<typeof sites.data>[number]) => setSiteDraft({
    id: site.id,
    siteType: site.siteType,
    name: site.name,
    address: site.address ?? "",
    latitude: site.latitude === null || site.latitude === undefined ? "" : String(site.latitude),
    longitude: site.longitude === null || site.longitude === undefined ? "" : String(site.longitude),
    status: site.status,
  });

  const openRouteEditor = (route: NonNullable<typeof routes.data>[number]) => setRouteDraft({
    id: route.id,
    loadSiteId: String(route.loadSiteId),
    unloadSiteId: String(route.unloadSiteId),
    freightRuleId: String(route.freightRuleId),
    distanceKm: String(route.presetDistanceKm),
    minimumTransitMinutes: String(route.minimumTransitMinutes),
    minimumTransitEnabled: route.minimumTransitEnabled,
    unloadGeofenceMeters: String(route.unloadGeofenceMeters),
    unloadGeofenceEnabled: route.unloadGeofenceEnabled,
    isDefault: route.isDefault,
    status: route.status,
  });

  const persistSite = () => {
    if (!siteDraft) return;
    const latitude = siteDraft.latitude.trim() ? Number(siteDraft.latitude) : null;
    const longitude = siteDraft.longitude.trim() ? Number(siteDraft.longitude) : null;
    if (!siteDraft.name.trim()) return toast.error("请填写装卸土点名称");
    if ((latitude === null) !== (longitude === null)) return toast.error("纬度和经度必须同时填写，或同时留空");
    if ((latitude !== null && !Number.isFinite(latitude)) || (longitude !== null && !Number.isFinite(longitude))) return toast.error("定位坐标必须是有效数字");
    saveSite.mutate({ id: siteDraft.id, projectId, siteType: siteDraft.siteType, name: siteDraft.name.trim(), address: siteDraft.address.trim() || null, latitude, longitude, administratorUserId: null, status: siteDraft.status });
  };

  const persistRoute = () => {
    if (!routeDraft) return;
    const loadSiteId = Number(routeDraft.loadSiteId);
    const unloadSiteId = Number(routeDraft.unloadSiteId);
    const freightRuleId = Number(routeDraft.freightRuleId);
    const presetDistanceKm = Number(routeDraft.distanceKm);
    const minimumTransitMinutes = Number(routeDraft.minimumTransitMinutes);
    const unloadGeofenceMeters = Number(routeDraft.unloadGeofenceMeters);
    if (!loadSiteId || !unloadSiteId || !freightRuleId) return toast.error("请完整选择装土点、卸土点与有效运价");
    if (loadSiteId === unloadSiteId) return toast.error("装土点和卸土点不能相同");
    if (!Number.isFinite(presetDistanceKm) || presetDistanceKm <= 0) return toast.error("预设公里数必须大于 0");
    if (!Number.isInteger(minimumTransitMinutes) || minimumTransitMinutes < 1) return toast.error("最短运输时间至少为 1 分钟");
    if (!Number.isInteger(unloadGeofenceMeters) || unloadGeofenceMeters < 30) return toast.error("卸土定位容差至少为 30 米");
    saveRoute.mutate({ id: routeDraft.id, projectId, loadSiteId, unloadSiteId, freightRuleId, presetDistanceKm, minimumTransitMinutes, minimumTransitEnabled: routeDraft.minimumTransitEnabled, unloadGeofenceMeters, unloadGeofenceEnabled: routeDraft.unloadGeofenceEnabled, isDefault: routeDraft.isDefault, status: routeDraft.status });
  };

  return <Card className="border-[#c8ddd9] bg-[#f7fcfb] shadow-sm"><CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0"><div><p className="text-xs font-semibold tracking-[0.12em] text-[#32665d]">路线基础资料 · 可直接维护</p><CardTitle className="mt-1 text-base">装卸土点坐标与既有路线编辑</CardTitle><CardDescription className="mt-1 max-w-3xl">坐标用于手机卸土围栏与双设备闭环。卸土点未填经纬度时，移动端不能安全确认卸土；请在本处点击“补录坐标”后保存。</CardDescription></div><div className="rounded-lg border border-[#f0c56f] bg-[#fff8e9] px-3 py-2 text-xs text-[#775116]"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />修改坐标仅影响后续卸土确认，不会改写历史运单。</div></CardHeader><CardContent className="space-y-4"><section><div className="mb-2 flex items-center gap-2"><MapPin className="h-4 w-4 text-[#266d73]" /><p className="text-sm font-semibold text-slate-800">装卸土点</p></div>{sites.isLoading ? <p className="rounded-lg bg-white p-3 text-sm text-slate-500">正在读取装卸土点…</p> : sites.data?.length ? <div className="grid gap-3 lg:grid-cols-2">{sites.data.map(site => { const coordinatesReady = hasCoordinates(site.latitude, site.longitude); return <div key={site.id} className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-medium text-slate-800">{site.siteType === "load" ? "装土点" : "卸土点"} · {site.name}</p><p className="mt-1 truncate text-xs text-slate-500">{site.address || "未填写中文地址"}</p><p className={`mt-1 text-xs ${coordinatesReady ? "text-[#30756d]" : "font-medium text-[#b45d25]"}`}>{coordinatesReady ? `坐标：${displayCoordinate(site.latitude, site.longitude)}` : "坐标未设置：移动端不能安全确认卸土"}</p><p className="mt-1 text-[11px] text-slate-400">状态：{site.status === "active" ? "启用" : "停用"} · 现场管理员：{site.administratorName || "未配置"}</p></div><Button size="sm" variant={coordinatesReady ? "outline" : "default"} className={coordinatesReady ? "shrink-0" : "shrink-0 bg-[#a65c26] text-white hover:bg-[#87491d]"} onClick={() => openSiteEditor(site)}>{coordinatesReady ? <><Pencil className="mr-1 h-3.5 w-3.5" />编辑</> : <><MapPin className="mr-1 h-3.5 w-3.5" />补录坐标</>}</Button></div></div>; })}</div> : <p className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-500">尚未配置装卸土点，请先使用下方“统一配置路线”新增路线。</p>}</section><section><div className="mb-2 flex items-center gap-2"><Route className="h-4 w-4 text-[#266d73]" /><p className="text-sm font-semibold text-slate-800">已设置的运输路线</p></div>{routes.isLoading ? <p className="rounded-lg bg-white p-3 text-sm text-slate-500">正在读取运输路线…</p> : routes.data?.length ? <div className="grid gap-3 lg:grid-cols-2">{routes.data.map(route => { const load = siteById.get(route.loadSiteId); const unload = siteById.get(route.unloadSiteId); const unloadReady = hasCoordinates(unload?.latitude, unload?.longitude); return <div key={route.id} className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-medium text-slate-800">{route.isDefault ? "默认路线 · " : ""}{load?.name ?? `装土点 #${route.loadSiteId}`} → {unload?.name ?? `卸土点 #${route.unloadSiteId}`}</p><p className="mt-1 text-xs text-slate-500">{route.presetDistanceKm} km · 运价 #{route.freightRuleId} · {route.status === "active" ? "启用" : "停用"}</p><p className={`mt-1 text-xs ${unloadReady ? "text-[#30756d]" : "font-medium text-[#b45d25]"}`}>{unloadReady ? `卸土坐标已配置 · 容差 ${route.unloadGeofenceMeters} 米` : "卸土点未配置坐标：请先补录坐标"}</p></div><Button size="sm" variant="outline" className="shrink-0" onClick={() => openRouteEditor(route)}><Pencil className="mr-1 h-3.5 w-3.5" />编辑路线</Button></div></div>; })}</div> : <p className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-500">尚未配置运输路线。</p>}</section></CardContent>
    <Dialog open={Boolean(siteDraft)} onOpenChange={open => !open && setSiteDraft(null)}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{siteDraft?.siteType === "load" ? "编辑装土点" : "编辑卸土点"}</DialogTitle><DialogDescription>请填写中文地址和准确经纬度。卸土坐标是手机卸土围栏与异常判断的基础数据。</DialogDescription></DialogHeader>{siteDraft ? <div className="grid gap-3 py-2"><div className="grid gap-3 sm:grid-cols-2"><div><Label>地点名称</Label><Input className="mt-1" value={siteDraft.name} onChange={event => setSiteDraft(current => current ? { ...current, name: event.target.value } : current)} /></div><div><Label>状态</Label><Select value={siteDraft.status} onValueChange={value => setSiteDraft(current => current ? { ...current, status: value as SiteDraft["status"] } : current)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">启用</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select></div></div><div><Label>中文地址</Label><Input className="mt-1" value={siteDraft.address} placeholder="如：南丰高速 K4 标陶沙01取土场" onChange={event => setSiteDraft(current => current ? { ...current, address: event.target.value } : current)} /></div><div className="grid gap-3 sm:grid-cols-2"><div><Label>纬度 Latitude</Label><Input className="mt-1" inputMode="decimal" value={siteDraft.latitude} placeholder="如 28.123456" onChange={event => setSiteDraft(current => current ? { ...current, latitude: event.target.value } : current)} /></div><div><Label>经度 Longitude</Label><Input className="mt-1" inputMode="decimal" value={siteDraft.longitude} placeholder="如 113.123456" onChange={event => setSiteDraft(current => current ? { ...current, longitude: event.target.value } : current)} /></div></div><p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">可在手机地图或现场定位工具中复制经纬度。纬度和经度必须成对填写；卸土点留空会阻止手机端安全确认卸土。</p></div> : null}<DialogFooter><Button variant="outline" onClick={() => setSiteDraft(null)}>取消</Button><Button disabled={saveSite.isPending} onClick={persistSite}>{saveSite.isPending ? "保存中…" : "保存地点与坐标"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(routeDraft)} onOpenChange={open => !open && setRouteDraft(null)}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>编辑运输路线</DialogTitle><DialogDescription>修改后仅影响后续开票与卸土校验；历史运单继续保留当时的路线与计价快照。</DialogDescription></DialogHeader>{routeDraft ? <div className="grid gap-3 py-2"><div className="grid gap-3 sm:grid-cols-2"><div><Label>装土点</Label><Select value={routeDraft.loadSiteId} onValueChange={value => setRouteDraft(current => current ? { ...current, loadSiteId: value } : current)}><SelectTrigger className="mt-1"><SelectValue placeholder="选择装土点" /></SelectTrigger><SelectContent>{activeLoadSites.map(site => <SelectItem key={site.id} value={String(site.id)}>{site.name}</SelectItem>)}</SelectContent></Select></div><div><Label>卸土点</Label><Select value={routeDraft.unloadSiteId} onValueChange={value => setRouteDraft(current => current ? { ...current, unloadSiteId: value } : current)}><SelectTrigger className="mt-1"><SelectValue placeholder="选择卸土点" /></SelectTrigger><SelectContent>{activeUnloadSites.map(site => <SelectItem key={site.id} value={String(site.id)}>{site.name}{hasCoordinates(site.latitude, site.longitude) ? "" : " · 未配坐标"}</SelectItem>)}</SelectContent></Select></div></div><div className="grid gap-3 sm:grid-cols-2"><div><Label>预设公里数</Label><Input className="mt-1" type="number" min="0.001" step="0.001" value={routeDraft.distanceKm} onChange={event => setRouteDraft(current => current ? { ...current, distanceKm: event.target.value } : current)} /></div><div><Label>有效运价</Label><Select value={routeDraft.freightRuleId} onValueChange={value => setRouteDraft(current => current ? { ...current, freightRuleId: value } : current)}><SelectTrigger className="mt-1"><SelectValue placeholder="选择有效运价" /></SelectTrigger><SelectContent>{activeFreightRules.map(rule => <SelectItem key={rule.id} value={String(rule.id)}>#{rule.id} · ¥{rule.basePricePerUnit}/方</SelectItem>)}</SelectContent></Select></div></div><div className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2"><label className="text-xs font-medium text-slate-700"><span className="flex items-center gap-2"><input type="checkbox" checked={routeDraft.minimumTransitEnabled} onChange={event => setRouteDraft(current => current ? { ...current, minimumTransitEnabled: event.target.checked } : current)} />最短运输时间：{routeDraft.minimumTransitEnabled ? "硬拦截" : "仅提示"}</span><Input className="mt-2" type="number" min="1" value={routeDraft.minimumTransitMinutes} onChange={event => setRouteDraft(current => current ? { ...current, minimumTransitMinutes: event.target.value } : current)} /></label><label className="text-xs font-medium text-slate-700"><span className="flex items-center gap-2"><input type="checkbox" checked={routeDraft.unloadGeofenceEnabled} onChange={event => setRouteDraft(current => current ? { ...current, unloadGeofenceEnabled: event.target.checked } : current)} />卸土定位范围：{routeDraft.unloadGeofenceEnabled ? "硬拦截" : "仅提示"}</span><Input className="mt-2" type="number" min="30" value={routeDraft.unloadGeofenceMeters} onChange={event => setRouteDraft(current => current ? { ...current, unloadGeofenceMeters: event.target.value } : current)} /></label></div><div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={routeDraft.isDefault} onChange={event => setRouteDraft(current => current ? { ...current, isDefault: event.target.checked } : current)} />设为默认路线</label><label className="flex items-center gap-2"><input type="checkbox" checked={routeDraft.status === "active"} onChange={event => setRouteDraft(current => current ? { ...current, status: event.target.checked ? "active" : "disabled" } : current)} />路线启用</label></div></div> : null}<DialogFooter><Button variant="outline" onClick={() => setRouteDraft(null)}>取消</Button><Button disabled={saveRoute.isPending} onClick={persistRoute}>{saveRoute.isPending ? "保存中…" : "保存路线修改"}</Button></DialogFooter></DialogContent></Dialog>
  </Card>;
}
