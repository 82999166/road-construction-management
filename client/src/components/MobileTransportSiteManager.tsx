import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { LocateFixed, MapPin, Pencil, Plus, Route } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type SiteDraft = {
  id: number | null;
  siteType: "load" | "unload";
  name: string;
  address: string;
  administratorUserId: string;
  status: "active" | "disabled";
};

/** 手机端与PC端共用 transport.saveSite / transport.listSites，避免跨端地点与路线数据漂移。 */
export function MobileTransportSiteManager({ projectId, canManage, onConfigureRoutes }: { projectId: number; canManage: boolean; onConfigureRoutes?: () => void }) {
  const utils = trpc.useUtils();
  const sites = trpc.transport.listSites.useQuery({ projectId }, { enabled: Boolean(projectId) && canManage, retry: false });
  const [draft, setDraft] = useState<SiteDraft | null>(null);
  const [locationStatus, setLocationStatus] = useState("");
  const reverseGeocode = trpc.location.reverseGeocode.useMutation({ onError: error => setLocationStatus(error.message) });
  const saveSite = trpc.transport.saveSite.useMutation({
    onSuccess: async (_, variables) => {
      toast.success(variables.id ? "现场地点已更新，路线候选已刷新" : "新现场地点已添加，可立即用于设置路线");
      setDraft(null);
      await Promise.all([utils.transport.listSites.invalidate(), utils.transport.listRoutePresets.invalidate()]);
    },
    onError: error => toast.error(error.message),
  });

  if (!canManage || !projectId) return null;

  const openNew = (siteType: SiteDraft["siteType"]) => {
    setLocationStatus("");
    setDraft({ id: null, siteType, name: "", address: "", administratorUserId: "", status: "active" });
  };
  const openEdit = (site: NonNullable<typeof sites.data>[number]) => {
    setLocationStatus("");
    setDraft({ id: site.id, siteType: site.siteType, name: site.name, address: site.address ?? "", administratorUserId: site.administratorUserId ? String(site.administratorUserId) : "", status: site.status });
  };
  const persist = () => {
    if (!draft) return;
    if (!draft.name.trim()) return toast.error(`请填写${draft.siteType === "load" ? "装土点" : "卸土点"}名称`);
    if (!draft.address.trim()) return toast.error("请填写可定位的中文详细地址");
    saveSite.mutate({ id: draft.id ?? undefined, projectId, siteType: draft.siteType, name: draft.name.trim(), address: draft.address.trim(), administratorUserId: draft.administratorUserId ? Number(draft.administratorUserId) : null, status: draft.status });
  };
  const autoFillCurrentAddress = () => {
    if (!("geolocation" in navigator)) return setLocationStatus("当前浏览器不支持定位，请手工填写中文详细地址");
    setLocationStatus("正在获取当前位置…");
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        setLocationStatus("正在转换为中文详细地址…");
        const result = await reverseGeocode.mutateAsync({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setDraft(current => current ? { ...current, address: result.address } : current);
        setLocationStatus("已自动获取中文详细地址；请继续确认或补充道路、桩号和场地名称");
      } catch {
        // 失败信息已由 mutation 的 onError 写入，保留手工填写入口。
      }
    }, error => {
      const reason = error.code === error.PERMISSION_DENIED
        ? "定位权限未授权，请在浏览器站点设置中允许定位，或手工填写地址"
        : error.code === error.TIMEOUT
          ? "定位超时，请移至信号较好位置后重试，或手工填写地址"
          : "暂时无法获取当前位置，请手工填写地址";
      setLocationStatus(reason);
    }, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 });
  };

  const siteNameLabel = draft?.siteType === "unload" ? "卸土点名称" : "装土点名称";
  const siteNamePlaceholder = draft?.siteType === "unload" ? "例如：塔头02卸土场" : "例如：陶沙02取土场";

  return <Card className="border border-[#c8ddd9] bg-[#f7fcfb] shadow-[0_6px_18px_rgba(43,91,83,.08)] print:hidden">
    <CardContent className="p-4">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold text-[#245e56]"><MapPin className="h-4 w-4" />装卸土点与运输路线配置</p>
        <p className="mt-1 text-xs leading-5 text-[#5a766f]">在此维护地点、中文详细地址和路线；手机端与PC后台使用同一套数据。</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" className="border-[#3d776f] text-[#235d55]" onClick={() => openNew("load")}><Plus className="mr-1 h-3.5 w-3.5" />新增装土点</Button>
        <Button size="sm" className="bg-[#2d6f67] text-white hover:bg-[#245a54]" onClick={() => openNew("unload")}><Plus className="mr-1 h-3.5 w-3.5" />新增卸土点</Button>
      </div>
      {onConfigureRoutes ? <Button size="sm" variant="outline" className="mt-2 w-full border-[#3d776f] text-[#235d55]" onClick={onConfigureRoutes}><Route className="mr-1 h-3.5 w-3.5" />配置运输路线、公里数与运价</Button> : null}
      <div className="mt-3 space-y-2">
        {sites.isLoading ? <p className="rounded-lg bg-white p-3 text-center text-xs text-slate-500">正在读取现场地点…</p> : null}
        {!sites.isLoading && !sites.data?.length ? <p className="rounded-lg border border-dashed border-[#b9d0cb] bg-white p-3 text-center text-xs text-slate-500">暂无装卸土点。请使用上方按钮分别新增装土点和卸土点。</p> : null}
        {sites.data?.map(site => <div key={site.id} className="flex items-start justify-between gap-3 rounded-xl border border-[#dce9e6] bg-white p-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800">{site.siteType === "load" ? "装土点" : "卸土点"} · {site.name}</p>
            <p className="mt-1 truncate text-xs text-slate-600">详细地址：{site.address || "未填写"}</p>
            <p className={`mt-1 text-[11px] ${site.addressResolved ? "text-[#30756d]" : "font-medium text-[#ad632c]"}`}>{site.addressResolved ? "详细地址已完成地图校验" : "详细地址待校验，不能用于安全卸土"}</p>
          </div>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => openEdit(site)}><Pencil className="mr-1 h-3.5 w-3.5" />编辑</Button>
        </div>)}
      </div>
    </CardContent>
    <Dialog open={Boolean(draft)} onOpenChange={open => !open && setDraft(null)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{draft?.id ? (draft.siteType === "load" ? "编辑装土点" : "编辑卸土点") : (draft?.siteType === "load" ? "新增装土点" : "新增卸土点")}</DialogTitle>
          <DialogDescription>请依次填写地点名称和中文详细地址。系统会在后台校验地址并保存围栏计算数据，页面不显示经纬度。</DialogDescription>
        </DialogHeader>
        {draft ? <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>地点类型</Label><Select value={draft.siteType} onValueChange={value => setDraft(current => current ? { ...current, siteType: value as SiteDraft["siteType"] } : current)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="load">装土点</SelectItem><SelectItem value="unload">卸土点</SelectItem></SelectContent></Select></div>
            <div><Label>状态</Label><Select value={draft.status} onValueChange={value => setDraft(current => current ? { ...current, status: value as SiteDraft["status"] } : current)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">启用</SelectItem><SelectItem value="disabled">停用</SelectItem></SelectContent></Select></div>
          </div>
          <div>
            <Label>{siteNameLabel} <span className="text-[#b4532b]">*</span></Label>
            <Input className="mt-1" value={draft.name} placeholder={siteNamePlaceholder} onChange={event => setDraft(current => current ? { ...current, name: event.target.value } : current)} />
            <p className="mt-1 text-xs text-[#5a766f]">名称用于路线、运单和台账显示；自动获取定位不会修改此名称。</p>
          </div>
          <div>
            <div className="flex items-center justify-between gap-2"><Label>中文详细地址 <span className="text-[#b4532b]">*</span></Label><Button type="button" size="sm" variant="outline" className="h-8 border-[#3d776f] text-[#235d55]" disabled={reverseGeocode.isPending} onClick={autoFillCurrentAddress}><LocateFixed className="mr-1 h-3.5 w-3.5" />{reverseGeocode.isPending ? "正在获取…" : "自动获取定位"}</Button></div>
            <Input className="mt-1" value={draft.address} placeholder="省市区县 + 道路/桩号 + 场地名称" onChange={event => setDraft(current => current ? { ...current, address: event.target.value } : current)} />
            {locationStatus ? <p className="mt-1 text-xs leading-5 text-[#5a766f]">{locationStatus}</p> : <p className="mt-1 text-xs leading-5 text-[#5a766f]">点击“自动获取定位”后会回填中文详细地址；可继续手工补充道路、桩号或场地名称。</p>}
          </div>
          <div><Label>现场管理员用户 ID（可选）</Label><Input className="mt-1" inputMode="numeric" value={draft.administratorUserId} placeholder="例如：18" onChange={event => setDraft(current => current ? { ...current, administratorUserId: event.target.value } : current)} /></div>
        </div> : null}
        <DialogFooter><Button variant="outline" onClick={() => setDraft(null)}>取消</Button><Button className="bg-[#2d6f67] hover:bg-[#245a54]" disabled={saveSite.isPending} onClick={persist}>{saveSite.isPending ? "正在校验地址…" : draft?.id ? "保存地点" : "新增地点"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </Card>;
}
