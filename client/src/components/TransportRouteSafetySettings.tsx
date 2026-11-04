import {
  discardTransportDraft,
  useTransportDirty,
  type TransportDirtyChange,
} from "@/lib/transportDraft";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type SafetyDraft = {
  minimumTransitMinutes: string;
  minimumTransitEnabled: boolean;
  unloadGeofenceMeters: string;
  unloadGeofenceEnabled: boolean;
};
export function TransportRouteSafetySettings({
  projectId,
  compact = false,
  canConfigure = true,
  active = true,
  onDirtyChange,
}: {
  projectId?: number;
  compact?: boolean;
  canConfigure?: boolean;
  active?: boolean;
  onDirtyChange?: TransportDirtyChange;
}) {
  const utils = trpc.useUtils();
  const enabled = Boolean(projectId) && active && canConfigure;
  const routes = trpc.transport.listRoutePresets.useQuery(
    { projectId: projectId ?? 0 },
    { enabled }
  );
  const sites = trpc.transport.listSites.useQuery(
    { projectId: projectId ?? 0 },
    { enabled }
  );
  const singleScanCloseSetting =
    trpc.transport.getNfcSingleScanCloseSetting.useQuery(
      { projectId: projectId ?? 0 },
      { enabled }
    );
  const [drafts, setDrafts] = useState<Record<number, SafetyDraft>>({});
  const [dirty, setDirty] = useState<Record<number, boolean>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const draftDirty = Object.values(dirty).some(Boolean);
  useTransportDirty(draftDirty, onDirtyChange);
  const save = trpc.transport.saveSite.useMutation({
    onSuccess: async (_, variables) => {
      toast.success("卸土点统一安全阈值已保存，所有驶向该点的路线使用同一规则");
      setDirty(current => ({ ...current, [variables.id ?? 0]: false }));
      await Promise.all([
        utils.transport.listSites.invalidate(),
        utils.transport.listRoutePresets.invalidate(),
      ]);
    },
    onError: error =>
      toast.error(
        getUserFacingErrorMessage(error, "运输安全规则保存未完成，请稍后重试")
      ),
  });
  const saveRoute = trpc.transport.saveRoutePreset.useMutation({
    onSuccess: async () => {
      toast.success("路线特殊闭环策略已保存");
      await utils.transport.listRoutePresets.invalidate();
    },
    onError: error =>
      toast.error(
        getUserFacingErrorMessage(error, "运输闭环策略保存未完成，请稍后重试")
      ),
  });
  const saveSingleScanClose =
    trpc.transport.setNfcSingleScanCloseSetting.useMutation({
      onSuccess: async result => {
        toast.success(
          result.enabled
            ? "已开启刷卡发票单次闭环模式"
            : "已恢复刷卡装土、卸土确认的双刷闭环模式"
        );
        await utils.transport.getNfcSingleScanCloseSetting.invalidate();
      },
      onError: error =>
        toast.error(
          getUserFacingErrorMessage(error, "运输安全规则保存未完成，请稍后重试")
        ),
    });
  useEffect(() => {
    setDrafts(current => {
      const next = { ...current };
      for (const site of sites.data ?? [])
        if (!dirty[site.id])
          next[site.id] = {
            minimumTransitMinutes: String(site.minimumTransitMinutes),
            minimumTransitEnabled: site.minimumTransitEnabled,
            unloadGeofenceMeters: String(site.unloadGeofenceMeters),
            unloadGeofenceEnabled: site.unloadGeofenceEnabled,
          };
      return next;
    });
  }, [sites.data, dirty]);
  if (!canConfigure || !projectId) return null;
  const activeRoutes =
    routes.data?.filter(route => route.status === "active") ?? [];
  const singleScanCloseEnabled = Boolean(singleScanCloseSetting.data?.enabled);
  const changeSingleScanClose = (value: boolean) => {
    if (
      value &&
      !window.confirm(
        "开启后，NFC 刷卡发票会直接完成特殊运输闭环，不再要求卸土点二次刷卡，不代表实际卸土。同车连续开票仍按卸土点最短时间硬拦截。确认开启吗？"
      )
    )
      return;
    saveSingleScanClose.mutate({ projectId, enabled: value });
  };
  return (
    <>
      <Card className="border border-[#d8bf91] bg-[#fffaf0] print:hidden">
        <CardContent
          className={`flex flex-wrap items-center justify-between gap-2 ${compact ? "p-2" : "p-4"}`}
        >
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-[#6d4217]">
              <ShieldCheck className="h-4 w-4" />
              运输闭环与安全阈值
            </p>
            <p className="mt-1 text-xs text-[#805d38]">
              {activeRoutes.length} 条启用路线 ·{" "}
              {singleScanCloseEnabled ? "单次刷卡闭环已开启" : "默认双刷闭环"} ·
              阈值归属卸土点
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setSettingsOpen(true)}
            disabled={!active}
          >
            配置
          </Button>
        </CardContent>
      </Card>
      <Dialog
        open={settingsOpen}
        onOpenChange={open => {
          if (
            !open &&
            Object.values(dirty).some(Boolean) &&
            !window.confirm(
              "安全阈值尚未保存，确认关闭？下次打开仍保留本页草稿。"
            )
          )
            return;
          setSettingsOpen(open);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>运输闭环与安全阈值</DialogTitle>
            <DialogDescription>
              最短运输时间与定位范围统一使用卸土地点设置；路线仅关联地点和特殊闭环策略，历史运单不覆盖重算。
            </DialogDescription>
          </DialogHeader>
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-semibold">
              刷卡发票即完成整车运输闭环（特殊场景）
            </p>
            <p className="mt-1 text-xs leading-5">
              开启后形成单次刷卡闭环完成、待核验；不伪造卸土扫码，不称为卸土成功。系统仍以卸土点最短时间硬性拦截同车连续开票，即使平时关闭时间拦截此项仍生效。
            </p>
            <label className="mt-2 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={singleScanCloseEnabled}
                disabled={
                  !active ||
                  singleScanCloseSetting.isLoading ||
                  saveSingleScanClose.isPending
                }
                onChange={event => changeSingleScanClose(event.target.checked)}
              />
              {singleScanCloseEnabled ? "已开启" : "默认关闭"}
            </label>
          </section>
          {sites.isError || routes.isError ? (
            <p role="alert" className="text-sm text-red-700">
              安全规则读取失败，请重试。
            </p>
          ) : sites.isLoading ? (
            <p>正在读取地点安全阈值…</p>
          ) : (
            (sites.data ?? [])
              .filter(site => site.siteType === "unload")
              .map(site => {
                const draft = drafts[site.id];
                if (!draft) return null;
                const patch = (value: Partial<SafetyDraft>) => {
                  setDirty(current => ({ ...current, [site.id]: true }));
                  setDrafts(current => ({
                    ...current,
                    [site.id]: { ...draft, ...value },
                  }));
                };
                const persist = () => {
                  const minimumTransitMinutes = Number(
                      draft.minimumTransitMinutes
                    ),
                    unloadGeofenceMeters = Number(draft.unloadGeofenceMeters);
                  if (
                    !Number.isInteger(minimumTransitMinutes) ||
                    minimumTransitMinutes < 1 ||
                    minimumTransitMinutes > 1440 ||
                    !Number.isInteger(unloadGeofenceMeters) ||
                    unloadGeofenceMeters < 30 ||
                    unloadGeofenceMeters > 5000
                  )
                    return toast.error(
                      "最短时间须为1–1440分钟，定位容差须为30–5000米"
                    );
                  save.mutate({
                    id: site.id,
                    projectId,
                    siteType: site.siteType,
                    name: site.name,
                    address: site.address,
                    administratorUserId: site.administratorUserId,
                    minimumTransitMinutes,
                    minimumTransitEnabled: draft.minimumTransitEnabled,
                    unloadGeofenceMeters,
                    unloadGeofenceEnabled: draft.unloadGeofenceEnabled,
                    status: site.status,
                  });
                };
                return (
                  <section key={site.id} className="rounded-xl border p-3">
                    <p className="text-sm font-semibold">
                      卸土点 · {site.name} ·{" "}
                      {site.status === "active" ? "启用" : "停用"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {site.address || "未登记地址"} · 共用路线{" "}
                      {
                        activeRoutes.filter(
                          route => route.unloadSiteId === site.id
                        ).length
                      }{" "}
                      条
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="text-xs">
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={draft.minimumTransitEnabled}
                            onChange={event =>
                              patch({
                                minimumTransitEnabled: event.target.checked,
                              })
                            }
                          />
                          最短时间 ·{" "}
                          {draft.minimumTransitEnabled ? "硬拦截" : "仅提示"}
                        </span>
                        <Input
                          className="mt-2"
                          type="number"
                          min="1"
                          max="1440"
                          value={draft.minimumTransitMinutes}
                          onChange={event =>
                            patch({ minimumTransitMinutes: event.target.value })
                          }
                        />
                      </label>
                      <label className="text-xs">
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={draft.unloadGeofenceEnabled}
                            onChange={event =>
                              patch({
                                unloadGeofenceEnabled: event.target.checked,
                              })
                            }
                          />
                          定位范围 ·{" "}
                          {draft.unloadGeofenceEnabled ? "硬拦截" : "仅提示"}
                        </span>
                        <Input
                          className="mt-2"
                          type="number"
                          min="30"
                          max="5000"
                          value={draft.unloadGeofenceMeters}
                          onChange={event =>
                            patch({ unloadGeofenceMeters: event.target.value })
                          }
                        />
                      </label>
                    </div>
                    <Button
                      className="mt-3"
                      size="sm"
                      disabled={!active || !dirty[site.id] || save.isPending}
                      onClick={persist}
                    >
                      保存地点统一阈值
                    </Button>
                  </section>
                );
              })
          )}
          <section className="space-y-2">
            <p className="text-sm font-semibold">路线特殊闭环策略</p>
            {activeRoutes.map(route => (
              <div key={route.id} className="rounded-lg border p-3">
                <p className="text-xs">
                  路线 #{route.id} · {route.presetDistanceKm} km · 卸土点 #
                  {route.unloadSiteId}
                </p>
                <label className="mt-2 flex items-start gap-2 text-xs leading-5">
                  <input
                    type="checkbox"
                    checked={route.unloadOnlyCloseEnabled}
                    disabled={!active || saveRoute.isPending}
                    onChange={event => {
                      const value = event.target.checked;
                      if (
                        value &&
                        !window.confirm(
                          "允许装土未刷卡时在本路线卸土点补刷卡闭环，仍须通过地点安全校验，核验须说明现场依据。确认开启？"
                        )
                      )
                        return;
                      saveRoute.mutate({
                        ...route,
                        presetDistanceKm: Number(route.presetDistanceKm),
                        unloadOnlyCloseEnabled: value,
                      });
                    }}
                  />
                  <span>
                    卸土点补刷卡完成闭环。未记录装土刷卡，不伪造实际装土时间；连续间隔和定位仍由卸土点统一校验。
                  </span>
                </label>
              </div>
            ))}
            {!activeRoutes.length ? (
              <p className="text-xs text-slate-500">
                尚未配置启用运输路线，请先配置装卸土点、有效运价与路线。
              </p>
            ) : null}
          </section>
        </DialogContent>
      </Dialog>
    </>
  );
}
