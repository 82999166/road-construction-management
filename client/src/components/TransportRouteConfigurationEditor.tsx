import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, MapPin, Pencil, Plus, Route, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type SiteDraft = {
  id: number | null;
  siteType: "load" | "unload";
  name: string;
  address: string;
  status: "active" | "disabled";
  minimumTransitMinutes: string;
  minimumTransitEnabled: boolean;
  unloadGeofenceMeters: string;
  unloadGeofenceEnabled: boolean;
};

type RouteDraft = {
  id: number | null;
  loadSiteId: string;
  unloadSiteId: string;
  freightRuleId: string;
  distanceKm: string;
  isDefault: boolean;
  status: "active" | "disabled";
};

/**
 * PC 端唯一的地点与路线配置入口。
 * 卸土安全阈值归属卸土点，所有进入该点的路线自动共用，避免同一地点多条路线配置冲突。
 */
export function TransportRouteConfigurationEditor({ projectId }: { projectId?: number }) {
  const utils = trpc.useUtils();
  const input = { projectId: projectId ?? 0 };
  const sites = trpc.transport.listSites.useQuery(input, { enabled: Boolean(projectId) });
  const routes = trpc.transport.listRoutePresets.useQuery(input, { enabled: Boolean(projectId) });
  const freightRules = trpc.transport.listFreightRules.useQuery(input, { enabled: Boolean(projectId) });
  const [siteDraft, setSiteDraft] = useState<SiteDraft | null>(null);
  const [routeDraft, setRouteDraft] = useState<RouteDraft | null>(null);

  const siteById = useMemo(() => new Map((sites.data ?? []).map(site => [site.id, site])), [sites.data]);
  const activeLoadSites = useMemo(() => (sites.data ?? []).filter(site => site.siteType === "load" && site.status === "active"), [sites.data]);
  const activeUnloadSites = useMemo(() => (sites.data ?? []).filter(site => site.siteType === "unload" && site.status === "active"), [sites.data]);
  const activeFreightRules = useMemo(() => (freightRules.data ?? []).filter(rule => rule.status === "active"), [freightRules.data]);

  const saveSite = trpc.transport.saveSite.useMutation({
    onSuccess: async (_, variables) => {
      toast.success(variables.id ? "装卸土点已更新，后续路线与手机端立即使用新规则" : "新装卸土点已添加，可立即配置运输路线");
      setSiteDraft(null);
      await Promise.all([utils.transport.listSites.invalidate(), utils.transport.listRoutePresets.invalidate()]);
    },
    onError: error => toast.error(error.message),
  });
  const saveRoute = trpc.transport.saveRoutePreset.useMutation({
    onSuccess: async () => {
      toast.success("运输路线已更新；卸土安全规则继续统一使用所选卸土点设置");
      setRouteDraft(null);
      await utils.transport.listRoutePresets.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  if (!projectId) return null;

  const openNewSite = (siteType: SiteDraft["siteType"]) => setSiteDraft({
    id: null,
    siteType,
    name: "",
    address: "",
    status: "active",
    minimumTransitMinutes: "10",
    minimumTransitEnabled: true,
    unloadGeofenceMeters: "300",
    unloadGeofenceEnabled: true,
  });

  const openSiteEditor = (site: NonNullable<typeof sites.data>[number]) => setSiteDraft({
    id: site.id,
    siteType: site.siteType,
    name: site.name,
    address: site.address ?? "",
    status: site.status,
    minimumTransitMinutes: String(site.minimumTransitMinutes),
    minimumTransitEnabled: site.minimumTransitEnabled,
    unloadGeofenceMeters: String(site.unloadGeofenceMeters),
    unloadGeofenceEnabled: site.unloadGeofenceEnabled,
  });

  const openNewRoute = () => {
    if (!activeLoadSites.length || !activeUnloadSites.length) return toast.error("请先新增并启用至少一个装土点和卸土点");
    if (!activeFreightRules.length) return toast.error("请先配置一条有效运输运价");
    setRouteDraft({
      id: null,
      loadSiteId: String(activeLoadSites[0].id),
      unloadSiteId: String(activeUnloadSites[0].id),
      freightRuleId: String(activeFreightRules[0].id),
      distanceKm: "",
      isDefault: !(routes.data ?? []).some(route => route.isDefault),
      status: "active",
    });
  };

  const openRouteEditor = (route: NonNullable<typeof routes.data>[number]) => setRouteDraft({
    id: route.id,
    loadSiteId: String(route.loadSiteId),
    unloadSiteId: String(route.unloadSiteId),
    freightRuleId: String(route.freightRuleId),
    distanceKm: String(route.presetDistanceKm),
    isDefault: route.isDefault,
    status: route.status,
  });

  const persistSite = () => {
    if (!siteDraft) return;
    if (!siteDraft.name.trim()) return toast.error("请填写装土点或卸土点名称");
    if (!siteDraft.address.trim()) return toast.error("请填写省、市、区县、道路/桩号或地标组成的中文详细地址");
    const minimumTransitMinutes = Number(siteDraft.minimumTransitMinutes);
    const unloadGeofenceMeters = Number(siteDraft.unloadGeofenceMeters);
    if (siteDraft.siteType === "unload" && (!Number.isInteger(minimumTransitMinutes) || minimumTransitMinutes < 1)) return toast.error("最短运输时间至少为 1 分钟");
    if (siteDraft.siteType === "unload" && (!Number.isInteger(unloadGeofenceMeters) || unloadGeofenceMeters < 30)) return toast.error("卸土定位容差至少为 30 米");
    saveSite.mutate({
      id: siteDraft.id ?? undefined,
      projectId,
      siteType: siteDraft.siteType,
      name: siteDraft.name.trim(),
      address: siteDraft.address.trim(),
      administratorUserId: null,
      minimumTransitMinutes,
      minimumTransitEnabled: siteDraft.minimumTransitEnabled,
      unloadGeofenceMeters,
      unloadGeofenceEnabled: siteDraft.unloadGeofenceEnabled,
      status: siteDraft.status,
    });
  };

  const persistRoute = () => {
    if (!routeDraft) return;
    const loadSiteId = Number(routeDraft.loadSiteId);
    const unloadSiteId = Number(routeDraft.unloadSiteId);
    const freightRuleId = Number(routeDraft.freightRuleId);
    const presetDistanceKm = Number(routeDraft.distanceKm);
    const unloadSite = siteById.get(unloadSiteId);
    if (!loadSiteId || !unloadSiteId || !freightRuleId) return toast.error("请完整选择装土点、卸土点与有效运价");
    if (loadSiteId === unloadSiteId) return toast.error("装土点和卸土点不能相同");
    if (!Number.isFinite(presetDistanceKm) || presetDistanceKm <= 0) return toast.error("预设公里数必须大于 0");
    if (!unloadSite) return toast.error("所选卸土点不存在，请刷新后重试");
    saveRoute.mutate({
      id: routeDraft.id ?? undefined,
      projectId,
      loadSiteId,
      unloadSiteId,
      freightRuleId,
      presetDistanceKm,
      // 路线表仅保留历史兼容字段；真实卸土校验统一读取卸土点设置。
      minimumTransitMinutes: unloadSite.minimumTransitMinutes,
      minimumTransitEnabled: unloadSite.minimumTransitEnabled,
      unloadGeofenceMeters: unloadSite.unloadGeofenceMeters,
      unloadGeofenceEnabled: unloadSite.unloadGeofenceEnabled,
      isDefault: routeDraft.isDefault,
      status: routeDraft.status,
    });
  };

  return <Card className="border-[#c8ddd9] bg-[#f7fcfb] shadow-sm">
    <CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0">
      <div>
        <p className="text-xs font-semibold tracking-[0.12em] text-[#32665d]">运输基础资料 · 跨端共享</p>
        <CardTitle className="mt-1 text-base">装卸土点与运输路线配置</CardTitle>
        <CardDescription className="mt-1 max-w-3xl">地点、中文详细地址、线路、公里数、运价和默认路线集中维护。卸土安全阈值只在卸土点设置一次，所有驶向该点的路线自动共用。</CardDescription>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" className="border-[#3d776f] text-[#235d55]" onClick={() => openNewSite("load")}><Plus className="mr-1 h-3.5 w-3.5" />新增装土点</Button>
        <Button size="sm" className="bg-[#2d6f67] text-white hover:bg-[#245a54]" onClick={() => openNewSite("unload")}><Plus className="mr-1 h-3.5 w-3.5" />新增卸土点</Button>
        <Button size="sm" variant="outline" className="border-[#2d6f67] text-[#245e56]" onClick={openNewRoute}><Route className="mr-1 h-3.5 w-3.5" />新建运输路线</Button>
        <div className="rounded-lg border border-[#f0c56f] bg-[#fff8e9] px-3 py-2 text-xs text-[#775116]"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />修改地点或安全规则仅影响后续卸土确认，不改写历史运单。</div>
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      <section>
        <div className="mb-2 flex items-center gap-2"><MapPin className="h-4 w-4 text-[#266d73]" /><p className="text-sm font-semibold text-slate-800">装卸土点</p></div>
        {sites.isLoading ? <p className="rounded-lg bg-white p-3 text-sm text-slate-500">正在读取装卸土点…</p> : sites.data?.length ? <div className="grid gap-3 lg:grid-cols-2">{sites.data.map(site => {
          const addressReady = Boolean(site.address) && site.addressResolved;
          return <div key={site.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-slate-800">{site.siteType === "load" ? "装土点" : "卸土点"} · {site.name}</p>
                <p className="mt-1 truncate text-xs text-slate-600">详细地址：{site.address || "未填写"}</p>
                <p className={`mt-1 text-xs ${addressReady ? "text-[#30756d]" : "font-medium text-[#b45d25]"}`}>{addressReady ? "详细地址已完成地图定位校验" : "详细地址未完成地图定位校验：移动端不能安全确认卸土"}</p>
                {site.siteType === "unload" ? <p className="mt-1 text-xs text-[#32665d]">统一安全阈值：最短 {site.minimumTransitMinutes} 分钟（{site.minimumTransitEnabled ? "硬拦截" : "仅提示"}）· 容差 {site.unloadGeofenceMeters} 米（{site.unloadGeofenceEnabled ? "硬拦截" : "仅提示"}）</p> : null}
                <p className="mt-1 text-[11px] text-slate-400">状态：{site.status === "active" ? "启用" : "停用"} · 现场管理员：{site.administratorName || "未配置"}</p>
              </div>
              <Button size="sm" variant={addressReady ? "outline" : "default"} className={addressReady ? "shrink-0" : "shrink-0 bg-[#a65c26] text-white hover:bg-[#87491d]"} onClick={() => openSiteEditor(site)}>{addressReady ? <><Pencil className="mr-1 h-3.5 w-3.5" />编辑</> : <><MapPin className="mr-1 h-3.5 w-3.5" />补录详细地址</>}</Button>
            </div>
          </div>;
        })}</div> : <p className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-500">尚未配置装卸土点。请先新增装土点和卸土点，再创建路线。</p>}
      </section>

      <section>
        <div className="mb-2 flex items-center gap-2"><Route className="h-4 w-4 text-[#266d73]" /><p className="text-sm font-semibold text-slate-800">已设置的运输路线</p></div>
        {routes.isLoading ? <p className="rounded-lg bg-white p-3 text-sm text-slate-500">正在读取运输路线…</p> : routes.data?.length ? <div className="grid gap-3 lg:grid-cols-2">{routes.data.map(route => {
          const load = siteById.get(route.loadSiteId);
          const unload = siteById.get(route.unloadSiteId);
          const unloadReady = Boolean(unload?.address) && unload?.addressResolved;
          return <div key={route.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0">
              <p className="font-medium text-slate-800">{route.isDefault ? "默认路线 · " : ""}{load?.name ?? `装土点 #${route.loadSiteId}`} → {unload?.name ?? `卸土点 #${route.unloadSiteId}`}</p>
              <p className="mt-1 text-xs text-slate-500">{route.presetDistanceKm} km · 运价 #{route.freightRuleId} · {route.status === "active" ? "启用" : "停用"}</p>
              <p className={`mt-1 text-xs ${unloadReady ? "text-[#30756d]" : "font-medium text-[#b45d25]"}`}>{unloadReady ? `卸土点统一容差 ${unload?.unloadGeofenceMeters} 米 · 最短 ${unload?.minimumTransitMinutes} 分钟` : "卸土详细地址尚未完成地图定位校验：请先补录详细地址"}</p>
            </div><Button size="sm" variant="outline" className="shrink-0" onClick={() => openRouteEditor(route)}><Pencil className="mr-1 h-3.5 w-3.5" />编辑路线</Button></div>
          </div>;
        })}</div> : <p className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-500">尚未配置运输路线。请先新增装土点、卸土点和有效运价，再创建路线。</p>}
      </section>
    </CardContent>

    <Dialog open={Boolean(siteDraft)} onOpenChange={open => !open && setSiteDraft(null)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{siteDraft?.id ? (siteDraft.siteType === "load" ? "编辑装土点" : "编辑卸土点") : (siteDraft?.siteType === "load" ? "新增装土点" : "新增卸土点")}</DialogTitle>
          <DialogDescription>{siteDraft?.siteType === "unload" ? "卸土点的安全阈值在此统一维护，所有驶向本点的路线自动使用。" : "请填写可定位的中文详细地址；坐标仅在后台用于围栏计算，业务页面不显示经纬度。"}</DialogDescription>
        </DialogHeader>
        {siteDraft ? <div className="grid gap-3 py-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>地点名称</Label><Input className="mt-1" value={siteDraft.name} placeholder={siteDraft.siteType === "load" ? "如：陶沙02取土场" : "如：塔头02卸土场"} onChange={event => setSiteDraft(current => current ? { ...current, name: event.target.value } : current)} /></div>
            <div><Label>状态</Label><Select value={siteDraft.status} onValueChange={value => setSiteDraft(current => current ? { ...current, status: value as SiteDraft["status"] } : current)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">启用</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select></div>
          </div>
          <div><Label>中文详细地址</Label><Input className="mt-1" value={siteDraft.address} placeholder="如：江西省南丰县 XX 镇南丰高速 K4 标陶沙01取土场" onChange={event => setSiteDraft(current => current ? { ...current, address: event.target.value } : current)} /></div>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">请尽量填写“省市区县 + 道路/桩号 + 场地名称”。系统会后台校验该地址能否用于围栏；如无法定位，请补充更完整的中文地点描述。</p>
          {siteDraft.siteType === "unload" ? <section className="rounded-xl border border-[#b9d9d2] bg-[#f0faf7] p-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-[#245e56]"><ShieldCheck className="h-4 w-4" />本卸土点统一安全阈值</p>
            <p className="mt-1 text-xs leading-5 text-[#5a766f]">此处修改后，所有驶向本卸土点的路线都会立即使用同一规则；不影响历史运单。</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-slate-700"><span className="flex items-center gap-2"><input type="checkbox" checked={siteDraft.minimumTransitEnabled} onChange={event => setSiteDraft(current => current ? { ...current, minimumTransitEnabled: event.target.checked } : current)} />最短运输时间：{siteDraft.minimumTransitEnabled ? "硬拦截" : "仅提示"}</span><Input className="mt-2" type="number" min="1" value={siteDraft.minimumTransitMinutes} onChange={event => setSiteDraft(current => current ? { ...current, minimumTransitMinutes: event.target.value } : current)} /></label>
              <label className="text-xs font-medium text-slate-700"><span className="flex items-center gap-2"><input type="checkbox" checked={siteDraft.unloadGeofenceEnabled} onChange={event => setSiteDraft(current => current ? { ...current, unloadGeofenceEnabled: event.target.checked } : current)} />卸土定位范围：{siteDraft.unloadGeofenceEnabled ? "硬拦截" : "仅提示"}</span><Input className="mt-2" type="number" min="30" value={siteDraft.unloadGeofenceMeters} onChange={event => setSiteDraft(current => current ? { ...current, unloadGeofenceMeters: event.target.value } : current)} /></label>
            </div>
          </section> : null}
        </div> : null}
        <DialogFooter><Button variant="outline" onClick={() => setSiteDraft(null)}>取消</Button><Button disabled={saveSite.isPending} onClick={persistSite}>{saveSite.isPending ? "正在校验地址…" : siteDraft?.id ? "保存地点与规则" : "新增地点"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(routeDraft)} onOpenChange={open => !open && setRouteDraft(null)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{routeDraft?.id ? "编辑运输路线" : "新建运输路线"}</DialogTitle><DialogDescription>路线只配置装卸点、公里数、运价和默认状态。卸土最短时间与定位范围统一由所选卸土点维护。</DialogDescription></DialogHeader>
        {routeDraft ? <div className="grid gap-3 py-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>装土点</Label><Select value={routeDraft.loadSiteId} onValueChange={value => setRouteDraft(current => current ? { ...current, loadSiteId: value } : current)}><SelectTrigger className="mt-1"><SelectValue placeholder="选择装土点" /></SelectTrigger><SelectContent>{activeLoadSites.map(site => <SelectItem key={site.id} value={String(site.id)}>{site.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>卸土点</Label><Select value={routeDraft.unloadSiteId} onValueChange={value => setRouteDraft(current => current ? { ...current, unloadSiteId: value } : current)}><SelectTrigger className="mt-1"><SelectValue placeholder="选择卸土点" /></SelectTrigger><SelectContent>{activeUnloadSites.map(site => <SelectItem key={site.id} value={String(site.id)}>{site.name}{site.addressResolved ? ` · 最短 ${site.minimumTransitMinutes} 分钟 / 容差 ${site.unloadGeofenceMeters} 米` : " · 详细地址待校验"}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>预设公里数</Label><Input className="mt-1" type="number" min="0.001" step="0.001" value={routeDraft.distanceKm} onChange={event => setRouteDraft(current => current ? { ...current, distanceKm: event.target.value } : current)} /></div>
            <div><Label>有效运价</Label><Select value={routeDraft.freightRuleId} onValueChange={value => setRouteDraft(current => current ? { ...current, freightRuleId: value } : current)}><SelectTrigger className="mt-1"><SelectValue placeholder="选择有效运价" /></SelectTrigger><SelectContent>{activeFreightRules.map(rule => <SelectItem key={rule.id} value={String(rule.id)}>#{rule.id} · ¥{rule.basePricePerUnit}/方</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={routeDraft.isDefault} onChange={event => setRouteDraft(current => current ? { ...current, isDefault: event.target.checked } : current)} />设为默认路线</label><label className="flex items-center gap-2"><input type="checkbox" checked={routeDraft.status === "active"} onChange={event => setRouteDraft(current => current ? { ...current, status: event.target.checked ? "active" : "disabled" } : current)} />路线启用</label></div>
        </div> : null}
        <DialogFooter><Button variant="outline" onClick={() => setRouteDraft(null)}>取消</Button><Button disabled={saveRoute.isPending} onClick={persistRoute}>{saveRoute.isPending ? "保存中…" : routeDraft?.id ? "保存路线修改" : "新建运输路线"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </Card>;
}
