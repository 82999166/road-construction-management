import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type SafetyDraft = { minimumTransitMinutes: string; minimumTransitEnabled: boolean; unloadGeofenceMeters: string; unloadGeofenceEnabled: boolean };

export function TransportRouteSafetySettings({ projectId, compact = false, canConfigure = true }: { projectId?: number; compact?: boolean; canConfigure?: boolean }) {
  const utils = trpc.useUtils();
  const routes = trpc.transport.listRoutePresets.useQuery({ projectId: projectId ?? 0 }, { enabled: Boolean(projectId) });
  const singleScanCloseSetting = trpc.transport.getNfcSingleScanCloseSetting.useQuery({ projectId: projectId ?? 0 }, { enabled: Boolean(projectId) });
  const [drafts, setDrafts] = useState<Record<number, SafetyDraft>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const save = trpc.transport.saveRoutePreset.useMutation({
    onSuccess: async () => {
      toast.success("路线卸土安全阈值已保存");
      await utils.transport.listRoutePresets.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const saveSingleScanClose = trpc.transport.setNfcSingleScanCloseSetting.useMutation({
    onSuccess: async result => {
      toast.success(result.enabled ? "已开启刷卡发票单次闭环模式" : "已恢复刷卡装土、卸土确认的双刷闭环模式");
      await utils.transport.getNfcSingleScanCloseSetting.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    if (!routes.data) return;
    setDrafts(current => {
      const next = { ...current };
      for (const route of routes.data) {
        if (!next[route.id]) next[route.id] = { minimumTransitMinutes: String(route.minimumTransitMinutes), minimumTransitEnabled: route.minimumTransitEnabled, unloadGeofenceMeters: String(route.unloadGeofenceMeters), unloadGeofenceEnabled: route.unloadGeofenceEnabled };
      }
      return next;
    });
  }, [routes.data]);

  if (!canConfigure || !projectId || !routes.data?.length) return null;
  const singleScanCloseEnabled = Boolean(singleScanCloseSetting.data?.enabled);
  const changeSingleScanClose = (enabled: boolean) => {
    if (enabled && !window.confirm("开启后，NFC 刷卡发票会直接完成本趟运输闭环，不再要求卸土点二次刷卡。系统仍会强制拦截同车未达到路线最短时间的连续开票。确认开启吗？")) return;
    saveSingleScanClose.mutate({ projectId, enabled });
  };

  return <>
    <Card className="border border-[#d8bf91] bg-[#fffaf0] print:hidden">
      <CardContent className={`flex items-center justify-between gap-2 ${compact ? "min-h-14 p-2" : "p-4"}`}>
        <div className="min-w-0"><p className={`flex items-center gap-1.5 font-semibold text-[#6d4217] ${compact ? "text-xs" : "text-sm"}`}><ShieldCheck className="h-4 w-4 shrink-0" />运输闭环与安全阈值</p><p className={`mt-0.5 text-[#805d38] ${compact ? "text-[10px] leading-3" : "text-xs leading-5"}`}>{routes.data.filter(route => route.status === "active").length} 条启用路线 · {singleScanCloseEnabled ? "单次刷卡闭环已开启" : "默认双刷闭环"}</p></div>
        <Button size="sm" className={`shrink-0 bg-[#8a591f] text-white hover:bg-[#724610] ${compact ? "h-7 px-2 text-[11px]" : ""}`} onClick={() => setSettingsOpen(true)}>配置</Button>
      </CardContent>
    </Card>
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>运输闭环与安全阈值</DialogTitle><DialogDescription>最短运输时间和卸土定位范围可分别设为“硬拦截”或“仅提示”；关闭安全开关后仍会留存实际耗时或距离供核验。</DialogDescription></DialogHeader>
        <div className="mt-3 space-y-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0"><p className="text-sm font-semibold text-[#6d4217]">刷卡发票即完成整车运输闭环（特殊场景）</p><p className="mt-1 text-xs leading-5 text-[#805d38]">开启后，NFC 刷卡发票会直接标记为“单次刷卡闭环完成、待核验”，不伪造卸土扫码，也不会把该状态称为卸土成功。系统仍会以每条路线设置的最短运输时间，硬性拦截同车的连续刷卡开票；即使该路线平时关闭了卸土最短时间拦截，此项间隔控制仍会生效。</p></div>
              <label className="flex shrink-0 items-center gap-2 text-xs font-semibold text-[#6d4217]"><input type="checkbox" checked={singleScanCloseEnabled} disabled={singleScanCloseSetting.isLoading || saveSingleScanClose.isPending} onChange={event => changeSingleScanClose(event.target.checked)} />{singleScanCloseEnabled ? "已开启" : "默认关闭"}</label>
            </div>
          </div>
          <div className="space-y-2">{routes.data.filter(route => route.status === "active").map(route => {
            const draft = drafts[route.id] ?? { minimumTransitMinutes: String(route.minimumTransitMinutes), minimumTransitEnabled: route.minimumTransitEnabled, unloadGeofenceMeters: String(route.unloadGeofenceMeters), unloadGeofenceEnabled: route.unloadGeofenceEnabled };
            const setDraft = (patch: Partial<SafetyDraft>) => setDrafts(current => ({ ...current, [route.id]: { ...draft, ...patch } }));
            const persist = () => {
              const minimumTransitMinutes = Number(draft.minimumTransitMinutes);
              const unloadGeofenceMeters = Number(draft.unloadGeofenceMeters);
              if (!Number.isInteger(minimumTransitMinutes) || minimumTransitMinutes < 1 || !Number.isInteger(unloadGeofenceMeters) || unloadGeofenceMeters < 30) return toast.error("最短时间至少 1 分钟，定位容差至少 30 米");
              save.mutate({ id: route.id, projectId: route.projectId, loadSiteId: route.loadSiteId, unloadSiteId: route.unloadSiteId, freightRuleId: route.freightRuleId, presetDistanceKm: Number(route.presetDistanceKm), minimumTransitMinutes, minimumTransitEnabled: draft.minimumTransitEnabled, unloadGeofenceMeters, unloadGeofenceEnabled: draft.unloadGeofenceEnabled, isDefault: route.isDefault, status: route.status });
            };
            return <div key={route.id} className="rounded-xl bg-white p-3"><p className="text-xs font-semibold text-[#5f4328]">路线 #{route.id} · {route.presetDistanceKm} km</p><div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><label className="flex items-center gap-2 text-[11px] font-medium text-[#765a49]"><input type="checkbox" checked={draft.minimumTransitEnabled} onChange={event => setDraft({ minimumTransitEnabled: event.target.checked })} />最短时间{draft.minimumTransitEnabled ? " · 硬拦截" : " · 仅提示"}<Input className="h-9" type="number" min="1" max="1440" value={draft.minimumTransitMinutes} onChange={event => setDraft({ minimumTransitMinutes: event.target.value })} /></label><label className="flex items-center gap-2 text-[11px] font-medium text-[#765a49]"><input type="checkbox" checked={draft.unloadGeofenceEnabled} onChange={event => setDraft({ unloadGeofenceEnabled: event.target.checked })} />定位范围{draft.unloadGeofenceEnabled ? " · 硬拦截" : " · 仅提示"}<Input className="h-9" type="number" min="30" max="5000" value={draft.unloadGeofenceMeters} onChange={event => setDraft({ unloadGeofenceMeters: event.target.value })} /></label><Button size="sm" className="h-9 self-end bg-[#8a591f] text-white hover:bg-[#724610]" disabled={save.isPending} onClick={persist}>保存</Button></div></div>;
          })}</div>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
