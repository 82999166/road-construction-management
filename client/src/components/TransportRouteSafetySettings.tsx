import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type SafetyDraft = { minimumTransitMinutes: string; minimumTransitEnabled: boolean; unloadGeofenceMeters: string; unloadGeofenceEnabled: boolean };

export function TransportRouteSafetySettings({ projectId, compact = false }: { projectId?: number; compact?: boolean }) {
  const utils = trpc.useUtils();
  const routes = trpc.transport.listRoutePresets.useQuery({ projectId: projectId ?? 0 }, { enabled: Boolean(projectId) });
  const [drafts, setDrafts] = useState<Record<number, SafetyDraft>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const save = trpc.transport.saveRoutePreset.useMutation({
    onSuccess: async () => {
      toast.success("路线卸土安全阈值已保存");
      await utils.transport.listRoutePresets.invalidate();
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

  if (!projectId || !routes.data?.length) return null;
  return <><Card className="border border-[#d8bf91] bg-[#fffaf0] print:hidden"><CardContent className={`flex items-center justify-between gap-2 ${compact ? "min-h-20 p-2.5" : "p-4"}`}><div className="min-w-0"><p className={`flex items-center gap-1.5 font-semibold text-[#6d4217] ${compact ? "text-xs" : "text-sm"}`}><ShieldCheck className="h-4 w-4 shrink-0" />卸土安全阈值</p><p className={`mt-1 text-[#805d38] ${compact ? "line-clamp-2 text-[10px] leading-4" : "line-clamp-2 text-xs leading-5"}`}>{routes.data.filter(route => route.status === "active").length} 条启用路线；最短运输时间和定位范围均可单独设置。</p></div><Button size="sm" className={`shrink-0 bg-[#8a591f] text-white hover:bg-[#724610] ${compact ? "h-7 px-2 text-[11px]" : ""}`} onClick={() => setSettingsOpen(true)}>配置</Button></CardContent></Card><Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>卸土安全阈值</DialogTitle><DialogDescription>最短运输时间和卸土定位范围可分别设为“硬拦截”或“仅提示”；关闭开关后仍会留存实际耗时或距离供核验。</DialogDescription></DialogHeader><div className="mt-3 space-y-2">{routes.data.filter(route => route.status === "active").map(route => {
    const draft = drafts[route.id] ?? { minimumTransitMinutes: String(route.minimumTransitMinutes), minimumTransitEnabled: route.minimumTransitEnabled, unloadGeofenceMeters: String(route.unloadGeofenceMeters), unloadGeofenceEnabled: route.unloadGeofenceEnabled };
    const setDraft = (patch: Partial<SafetyDraft>) => setDrafts(current => ({ ...current, [route.id]: { ...draft, ...patch } }));
    const persist = () => {
      const minimumTransitMinutes = Number(draft.minimumTransitMinutes);
      const unloadGeofenceMeters = Number(draft.unloadGeofenceMeters);
      if (!Number.isInteger(minimumTransitMinutes) || minimumTransitMinutes < 1 || !Number.isInteger(unloadGeofenceMeters) || unloadGeofenceMeters < 30) return toast.error("最短时间至少 1 分钟，定位容差至少 30 米");
      save.mutate({ id: route.id, projectId: route.projectId, loadSiteId: route.loadSiteId, unloadSiteId: route.unloadSiteId, freightRuleId: route.freightRuleId, presetDistanceKm: Number(route.presetDistanceKm), minimumTransitMinutes, minimumTransitEnabled: draft.minimumTransitEnabled, unloadGeofenceMeters, unloadGeofenceEnabled: draft.unloadGeofenceEnabled, isDefault: route.isDefault, status: route.status });
    };
    return <div key={route.id} className="rounded-xl bg-white p-3"><p className="text-xs font-semibold text-[#5f4328]">路线 #{route.id} · {route.presetDistanceKm} km</p><div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><label className="flex items-center gap-2 text-[11px] font-medium text-[#765a49]"><input type="checkbox" checked={draft.minimumTransitEnabled} onChange={event => setDraft({ minimumTransitEnabled: event.target.checked })} />最短时间{draft.minimumTransitEnabled ? " · 硬拦截" : " · 仅提示"}<Input className="h-9" type="number" min="1" max="1440" value={draft.minimumTransitMinutes} onChange={event => setDraft({ minimumTransitMinutes: event.target.value })} /></label><label className="flex items-center gap-2 text-[11px] font-medium text-[#765a49]"><input type="checkbox" checked={draft.unloadGeofenceEnabled} onChange={event => setDraft({ unloadGeofenceEnabled: event.target.checked })} />定位范围{draft.unloadGeofenceEnabled ? " · 硬拦截" : " · 仅提示"}<Input className="h-9" type="number" min="30" max="5000" value={draft.unloadGeofenceMeters} onChange={event => setDraft({ unloadGeofenceMeters: event.target.value })} /></label><Button size="sm" className="h-9 self-end bg-[#8a591f] text-white hover:bg-[#724610]" disabled={save.isPending} onClick={persist}>保存</Button></div></div>;
  })}</div></DialogContent></Dialog></>;
}
