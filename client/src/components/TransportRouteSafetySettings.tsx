import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type SafetyDraft = { minimumTransitMinutes: string; unloadGeofenceMeters: string };

export function TransportRouteSafetySettings({ projectId }: { projectId?: number }) {
  const utils = trpc.useUtils();
  const routes = trpc.transport.listRoutePresets.useQuery({ projectId: projectId ?? 0 }, { enabled: Boolean(projectId) });
  const [drafts, setDrafts] = useState<Record<number, SafetyDraft>>({});
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
        if (!next[route.id]) next[route.id] = { minimumTransitMinutes: String(route.minimumTransitMinutes), unloadGeofenceMeters: String(route.unloadGeofenceMeters) };
      }
      return next;
    });
  }, [routes.data]);

  if (!projectId || !routes.data?.length) return null;
  return <Card className="border border-[#d8bf91] bg-[#fffaf0] print:hidden"><CardContent className="p-3"><div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 text-[#8a591f]" /><div><p className="text-sm font-semibold text-[#6d4217]">卸土安全阈值</p><p className="mt-1 text-xs leading-5 text-[#805d38]">卸土必须同时满足最短运输时间和卸土点定位容差；不符合时系统只记录异常，运单继续保持运输中。</p></div></div><div className="mt-3 space-y-2">{routes.data.filter(route => route.status === "active").map(route => {
    const draft = drafts[route.id] ?? { minimumTransitMinutes: String(route.minimumTransitMinutes), unloadGeofenceMeters: String(route.unloadGeofenceMeters) };
    const setDraft = (patch: Partial<SafetyDraft>) => setDrafts(current => ({ ...current, [route.id]: { ...draft, ...patch } }));
    const persist = () => {
      const minimumTransitMinutes = Number(draft.minimumTransitMinutes);
      const unloadGeofenceMeters = Number(draft.unloadGeofenceMeters);
      if (!Number.isInteger(minimumTransitMinutes) || minimumTransitMinutes < 1 || !Number.isInteger(unloadGeofenceMeters) || unloadGeofenceMeters < 30) return toast.error("最短时间至少 1 分钟，定位容差至少 30 米");
      save.mutate({ id: route.id, projectId: route.projectId, loadSiteId: route.loadSiteId, unloadSiteId: route.unloadSiteId, freightRuleId: route.freightRuleId, presetDistanceKm: Number(route.presetDistanceKm), minimumTransitMinutes, unloadGeofenceMeters, isDefault: route.isDefault, status: route.status });
    };
    return <div key={route.id} className="rounded-xl bg-white p-3"><p className="text-xs font-semibold text-[#5f4328]">路线 #{route.id} · {route.presetDistanceKm} km</p><div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2"><label className="text-[11px] text-[#765a49]">最短分钟<Input className="mt-1 h-9" type="number" min="1" max="1440" value={draft.minimumTransitMinutes} onChange={event => setDraft({ minimumTransitMinutes: event.target.value })} /></label><label className="text-[11px] text-[#765a49]">卸土容差米<Input className="mt-1 h-9" type="number" min="30" max="5000" value={draft.unloadGeofenceMeters} onChange={event => setDraft({ unloadGeofenceMeters: event.target.value })} /></label><Button size="sm" className="mt-5 h-9 bg-[#8a591f] text-white hover:bg-[#724610]" disabled={save.isPending} onClick={persist}>保存</Button></div></div>;
  })}</div></CardContent></Card>;
}
