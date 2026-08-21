import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, MapPin, Pencil, Plus, Route } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type SiteDraft = {
  id: number | null;
  siteType: "load" | "unload";
  name: string;
  address: string;
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

/** PC 端地点与路线统一维护；业务端只填中文详细地址，坐标仅在后台用于围栏计算。 */
export function TransportRouteConfigurationEditor({ projectId }: { projectId?: number }) {
  const utils = trpc.useUtils();
  const queryInput = { projectId: projectId ?? 0 };
  const sites = trpc.transport.listSites.useQuery(queryInput, { enabled: Boolean(projectId) });
  const routes = trpc.transport.listRoutePresets.useQuery(queryInput, { enabled: Boolean(projectId) });
  const freightRules = trpc.transport.listFreightRules.useQuery(queryInput, { enabled: Boolean(projectId) });
  const [siteDraft, setSiteDraft] = useState<SiteDraft | null>(null);
  const [routeDraft, setRouteDraft] = useState<RouteDraft | null>(null);

  const saveSite = trpc.transport.saveSite.useMutation({
    onSuccess: async (_, variables) => {
      toast.success(variables.id ? "装卸土点已更新，路线与移动端将使用新地址" : "新装卸土点已添加，可立即用于配置路线");
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

  const openNewSite = (siteType: SiteDraft["siteType"]) => setSiteDraft({ id: null, siteType, name: "", address: "", status: "active" });
  const openSiteEditor = (site: NonNullable<typeof sites.data>[number]) => setSiteDraft({ id: site.id, siteType: site.siteType, name: site.name, address: site.address ?? "", status: site.status });
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
    if (!siteDraft.name.trim()) return toast.error("请填写装卸土点名称");
    if (!siteDraft.address.trim()) return toast.error("请填写省、市、区县、道路/桩号或地标组成的中文详细地址");
    saveSite.mutate({ id: siteDraft.id ?? undefined, projectId, siteType: siteDraft.siteType, name: siteDraft.name.trim(), address: siteDraft.address.trim(), administratorUserId: null, status: siteDraft.status });
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

  return <Card className="border-[#c8ddd9] bg-[#f7fcfb] shadow-sm">
    <CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0">
      <div>
        <p className="text-xs font-semibold tracking-[0.12em] text-[#32665d]">路线基础资料 · 可直接维护</p>
        <CardTitle className="mt-1 text-base">装卸土点详细地址与既有路线编辑</CardTitle>
        <CardDescription className="mt-1 max-w-3xl">业务页面只显示中文详细地址。保存地点时，系统会在后台完成地图定位，用于手机卸土围栏与双设备闭环，不显示经纬度。</CardDescription>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" className="border-[#3d776f] text-[#235d55]" onClick={() => openNewSite("load")}><Plus className="mr-1 h-3.5 w-3.5" />新增装土点</Button>
        <Button size="sm" className="bg-[#2d6f67] text-white hover:bg-[#245a54]" onClick={() => openNewSite("unload")}><Plus className="mr-1 h-3.5 w-3.5" />新增卸土点</Button>
        <div className="rounded-lg border border-[#f0c56f] bg-[#fff8e9] px-3 py-2 text-xs text-[#775116]"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />修改详细地址仅影响后续卸土确认，不会改写历史运单。</div>
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      <section>
        <div className="mb-2 flex items-center gap-2"><MapPin className="h-4 w-4 text-[#266d73]" /><p className="text-sm font-semibold text-slate-800">装卸土点</p></div>
        {sites.isLoading ? <p className="rounded-lg bg-white p-3 text-sm text-slate-500">正在读取装卸土点…</p> : sites.data?.length ? <div className="grid gap-3 lg:grid-cols-2">{sites.data.map(site => {
          const addressReady = Boolean(site.address) && site.addressResolved;
          return <div key={site.id} className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-medium text-slate-800">{site.siteType === "load" ? "装土点" : "卸土点"} · {site.name}</p><p className="mt-1 truncate text-xs text-slate-600">详细地址：{site.address || "未填写"}</p><p className={`mt-1 text-xs ${addressReady ? "text-[#30756d]" : "font-medium text-[#b45d25]"}`}>{addressReady ? "详细地址已完成地图定位校验" : "详细地址未完成地图定位校验：移动端不能安全确认卸土"}</p><p className="mt-1 text-[11px] text-slate-400">状态：{site.status === "active" ? "启用" : "停用"} · 现场管理员：{site.administratorName || "未配置"}</p></div><Button size="sm" variant={addressReady ? "outline" : "default"} className={addressReady ? "shrink-0" : "shrink-0 bg-[#a65c26] text-white hover:bg-[#87491d]"} onClick={() => openSiteEditor(site)}>{addressReady ? <><Pencil className="mr-1 h-3.5 w-3.5" />编辑</> : <><MapPin className="mr-1 h-3.5 w-3.5" />补录详细地址</>}</Button></div></div>;
        })}</div> : <p className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-500">尚未配置装卸土点。请先点击上方“新增装土点”和“新增卸土点”，保存后即可配置路线。</p>}
      </section>
      <section>
        <div className="mb-2 flex items-center gap-2"><Route className="h-4 w-4 text-[#266d73]" /><p className="text-sm font-semibold text-slate-800">已设置的运输路线</p></div>
        {routes.isLoading ? <p className="rounded-lg bg-white p-3 text-sm text-slate-500">正在读取运输路线…</p> : routes.data?.length ? <div className="grid gap-3 lg:grid-cols-2">{routes.data.map(route => {
          const load = siteById.get(route.loadSiteId);
          const unload = siteById.get(route.unloadSiteId);
          const unloadReady = Boolean(unload?.address) && unload?.addressResolved;
          return <div key={route.id} className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-medium text-slate-800">{route.isDefault ? "默认路线 · " : ""}{load?.name ?? `装土点 #${route.loadSiteId}`} → {unload?.name ?? `卸土点 #${route.unloadSiteId}`}</p><p className="mt-1 text-xs text-slate-500">{route.presetDistanceKm} km · 运价 #{route.freightRuleId} · {route.status === "active" ? "启用" : "停用"}</p><p className={`mt-1 text-xs ${unloadReady ? "text-[#30756d]" : "font-medium text-[#b45d25]"}`}>{unloadReady ? `卸土详细地址已校验 · 容差 ${route.unloadGeofenceMeters} 米` : "卸土详细地址尚未完成地图定位校验：请先补录详细地址"}</p></div><Button size="sm" variant="outline" className="shrink-0" onClick={() => openRouteEditor(route)}><Pencil className="mr-1 h-3.5 w-3.5" />编辑路线</Button></div></div>;
        })}</div> : <p className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-500">尚未配置运输路线。请先新增装土点、卸土点和有效运价，再创建路线。</p>}
      </section>
    </CardContent>
    <Dialog open={Boolean(siteDraft)} onOpenChange={open => !open && setSiteDraft(null)}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{siteDraft?.id ? (siteDraft.siteType === "load" ? "编辑装土点" : "编辑卸土点") : (siteDraft?.siteType === "load" ? "新增装土点" : "新增卸土点")}</DialogTitle><DialogDescription>请填写可定位的中文详细地址。系统会在后台解析并保存围栏计算数据，页面不显示经纬度；保存后可立即在路线编辑中选择。</DialogDescription></DialogHeader>{siteDraft ? <div className="grid gap-3 py-2"><div className="grid gap-3 sm:grid-cols-2"><div><Label>地点名称</Label><Input className="mt-1" value={siteDraft.name} placeholder={siteDraft.siteType === "load" ? "如：陶沙02取土场" : "如：塔头02卸土场"} onChange={event => setSiteDraft(current => current ? { ...current, name: event.target.value } : current)} /></div><div><Label>状态</Label><Select value={siteDraft.status} onValueChange={value => setSiteDraft(current => current ? { ...current, status: value as SiteDraft["status"] } : current)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">启用</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select></div></div><div><Label>中文详细地址</Label><Input className="mt-1" value={siteDraft.address} placeholder="如：江西省南丰县 XX 镇南丰高速 K4 标陶沙01取土场" onChange={event => setSiteDraft(current => current ? { ...current, address: event.target.value } : current)} /></div><p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">请尽量填写“省市区县 + 道路/桩号 + 场地名称”。系统会后台校验该地址能否用于围栏；如无法定位，请补充更完整的中文地点描述。</p></div> : null}<DialogFooter><Button variant="outline" onClick={() => setSiteDraft(null)}>取消</Button><Button disabled={saveSite.isPending} onClick={persistSite}>{saveSite.isPending ? "正在校验地址…" : siteDraft?.id ? "保存详细地址" : "新增地点"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(routeDraft)} onOpenChange={open => !open && setRouteDraft(null)}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>编辑运输路线</DialogTitle><DialogDescription>修改后仅影响后续开票与卸土校验；历史运单继续保留当时的路线与计价快照。</DialogDescription></DialogHeader>{routeDraft ? <div className="grid gap-3 py-2"><div className="grid gap-3 sm:grid-cols-2"><div><Label>装土点</Label><Select value={routeDraft.loadSiteId} onValueChange={value => setRouteDraft(current => current ? { ...current, loadSiteId: value } : current)}><SelectTrigger className="mt-1"><SelectValue placeholder="选择装土点" /></SelectTrigger><SelectContent>{activeLoadSites.map(site => <SelectItem key={site.id} value={String(site.id)}>{site.name}</SelectItem>)}</SelectContent></Select></div><div><Label>卸土点</Label><Select value={routeDraft.unloadSiteId} onValueChange={value => setRouteDraft(current => current ? { ...current, unloadSiteId: value } : current)}><SelectTrigger className="mt-1"><SelectValue placeholder="选择卸土点" /></SelectTrigger><SelectContent>{activeUnloadSites.map(site => <SelectItem key={site.id} value={String(site.id)}>{site.name}{site.addressResolved ? "" : " · 详细地址待校验"}</SelectItem>)}</SelectContent></Select></div></div><div className="grid gap-3 sm:grid-cols-2"><div><Label>预设公里数</Label><Input className="mt-1" type="number" min="0.001" step="0.001" value={routeDraft.distanceKm} onChange={event => setRouteDraft(current => current ? { ...current, distanceKm: event.target.value } : current)} /></div><div><Label>有效运价</Label><Select value={routeDraft.freightRuleId} onValueChange={value => setRouteDraft(current => current ? { ...current, freightRuleId: value } : current)}><SelectTrigger className="mt-1"><SelectValue placeholder="选择有效运价" /></SelectTrigger><SelectContent>{activeFreightRules.map(rule => <SelectItem key={rule.id} value={String(rule.id)}>#{rule.id} · ¥{rule.basePricePerUnit}/方</SelectItem>)}</SelectContent></Select></div></div><div className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2"><label className="text-xs font-medium text-slate-700"><span className="flex items-center gap-2"><input type="checkbox" checked={routeDraft.minimumTransitEnabled} onChange={event => setRouteDraft(current => current ? { ...current, minimumTransitEnabled: event.target.checked } : current)} />最短运输时间：{routeDraft.minimumTransitEnabled ? "硬拦截" : "仅提示"}</span><Input className="mt-2" type="number" min="1" value={routeDraft.minimumTransitMinutes} onChange={event => setRouteDraft(current => current ? { ...current, minimumTransitMinutes: event.target.value } : current)} /></label><label className="text-xs font-medium text-slate-700"><span className="flex items-center gap-2"><input type="checkbox" checked={routeDraft.unloadGeofenceEnabled} onChange={event => setRouteDraft(current => current ? { ...current, unloadGeofenceEnabled: event.target.checked } : current)} />卸土定位范围：{routeDraft.unloadGeofenceEnabled ? "硬拦截" : "仅提示"}</span><Input className="mt-2" type="number" min="30" value={routeDraft.unloadGeofenceMeters} onChange={event => setRouteDraft(current => current ? { ...current, unloadGeofenceMeters: event.target.value } : current)} /></label></div><div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={routeDraft.isDefault} onChange={event => setRouteDraft(current => current ? { ...current, isDefault: event.target.checked } : current)} />设为默认路线</label><label className="flex items-center gap-2"><input type="checkbox" checked={routeDraft.status === "active"} onChange={event => setRouteDraft(current => current ? { ...current, status: event.target.checked ? "active" : "disabled" } : current)} />路线启用</label></div></div> : null}<DialogFooter><Button variant="outline" onClick={() => setRouteDraft(null)}>取消</Button><Button disabled={saveRoute.isPending} onClick={persistRoute}>{saveRoute.isPending ? "保存中…" : "保存路线修改"}</Button></DialogFooter></DialogContent></Dialog>
  </Card>;
}
