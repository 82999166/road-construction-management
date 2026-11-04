import {
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
import {
  transportSafetySummary,
  validateTransportSafetyDraft,
  type TransportSafetyDraft,
} from "@/lib/transportSafetySettings";
import { ShieldCheck } from "lucide-react";
import React, { useEffect, useState } from "react";
import { toast } from "sonner";

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
  const [drafts, setDrafts] = useState<Record<number, TransportSafetyDraft>>(
    {}
  );
  const [dirty, setDirty] = useState<Record<number, boolean>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const draftDirty = Object.values(dirty).some(Boolean);
  useTransportDirty(draftDirty, onDirtyChange);
  const save = trpc.transport.saveSite.useMutation({
    onSuccess: async (_, variables) => {
      // 保持草稿为dirty直到服务器回读完成，避免旧缓存将刚保存的阈值回滚到旧值。
      await Promise.all([
        utils.transport.listSites.invalidate(),
        utils.transport.listRoutePresets.invalidate(),
      ]);
      setDirty(current => ({ ...current, [variables.id ?? 0]: false }));
      toast.success("卸土点统一安全阈值已保存，所有驶向该点的路线使用同一规则");
    },
    onError: error =>
      toast.error(
        getUserFacingErrorMessage(
          error,
          "运输安全规则保存未完成，输入已保留，请重试"
        )
      ),
  });
  const saveRoute = trpc.transport.saveRoutePreset.useMutation({
    onSuccess: async () => {
      await utils.transport.listRoutePresets.invalidate();
      toast.success("路线特殊闭环策略已保存");
    },
    onError: error =>
      toast.error(
        getUserFacingErrorMessage(error, "运输闭环策略保存未完成，请稍后重试")
      ),
  });
  const saveSingleScanClose =
    trpc.transport.setNfcSingleScanCloseSetting.useMutation({
      onSuccess: async result => {
        await utils.transport.getNfcSingleScanCloseSetting.invalidate();
        toast.success(
          result.enabled
            ? "已开启刷卡发票单次闭环模式"
            : "已恢复刷卡装土、卸土确认的双刷闭环模式"
        );
      },
      onError: error =>
        toast.error(
          getUserFacingErrorMessage(error, "运输安全规则保存未完成，请稍后重试")
        ),
    });
  const saving =
    save.isPending || saveRoute.isPending || saveSingleScanClose.isPending;
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
    if (saving || !active || singleScanCloseSetting.isError) return;
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
              阈值归属卸土点{draftDirty ? " · 有未保存修改" : ""}
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
          if (!open && saving) {
            toast.info("正在保存并回读规则，请完成后再关闭。");
            return;
          }
          if (
            !open &&
            draftDirty &&
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
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
            <p className="font-semibold">
              设置说明：时间单位为分钟，定位允许偏差单位为米（不是路线长度）。
            </p>
            <p>
              勾选“硬拦截”后，未达到时间或超出卸土点范围不能完成卸土；不勾选为“仅提示”，异常会留待核验但不阻止闭环。两项可单独启用，也可同时启用。
            </p>
            <p>
              时间与定位修改后须点击“保存地点统一阈值”。下方特殊闭环开关单独即时保存，不会替您保存上方阈值。
            </p>
          </div>
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-semibold">
              刷卡发票即完成整车运输闭环（特殊场景）
            </p>
            <p className="mt-1 text-xs leading-5">
              开启后形成单次刷卡闭环完成、待核验；不伪造卸土扫码，不称为卸土成功。系统仍以卸土点最短时间硬性拦截同车连续开票，即使平时关闭时间拦截此项仍生效。
            </p>
            {singleScanCloseSetting.isError ? (
              <p role="alert" className="mt-2 text-xs text-red-700">
                特殊闭环设置读取失败，请重新读取后再修改。
              </p>
            ) : null}
            <label className="mt-2 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                aria-label="刷卡发票单次闭环"
                checked={singleScanCloseEnabled}
                disabled={
                  !active ||
                  singleScanCloseSetting.isLoading ||
                  singleScanCloseSetting.isError ||
                  saving
                }
                onChange={event => changeSingleScanClose(event.target.checked)}
              />
              {singleScanCloseEnabled ? "已开启" : "默认关闭"} · 即时保存
            </label>
          </section>
          {sites.isError || routes.isError ? (
            <div role="alert" className="text-sm text-red-700">
              安全规则读取失败，请重试。
              <Button
                variant="outline"
                size="sm"
                className="ml-2"
                onClick={() => {
                  void sites.refetch();
                  void routes.refetch();
                  void singleScanCloseSetting.refetch();
                }}
              >
                重新读取
              </Button>
            </div>
          ) : sites.isLoading ? (
            <p>正在读取地点安全阈值…</p>
          ) : (
            (sites.data ?? [])
              .filter(site => site.siteType === "unload")
              .map(site => {
                const draft = drafts[site.id];
                if (!draft) return null;
                const validation = validateTransportSafetyDraft(draft);
                const patch = (value: Partial<TransportSafetyDraft>) => {
                  if (!active || saving) return;
                  setDirty(current => ({ ...current, [site.id]: true }));
                  setDrafts(current => ({
                    ...current,
                    [site.id]: { ...draft, ...value },
                  }));
                };
                const persist = () => {
                  if (!active || saving || !dirty[site.id]) return;
                  if (!validation.valid)
                    return toast.error(
                      validation.minimumTransitError ??
                        validation.unloadGeofenceError
                    );
                  save.mutate({
                    id: site.id,
                    projectId,
                    siteType: site.siteType,
                    name: site.name,
                    address: site.address,
                    administratorUserId: site.administratorUserId,
                    minimumTransitMinutes: validation.minutes,
                    minimumTransitEnabled: draft.minimumTransitEnabled,
                    unloadGeofenceMeters: validation.meters,
                    unloadGeofenceEnabled: draft.unloadGeofenceEnabled,
                    status: site.status,
                  });
                };
                return (
                  <section
                    key={site.id}
                    className="rounded-xl border p-3"
                    aria-label={`卸土点安全设置：${site.name}`}
                  >
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
                    <p
                      className="mt-2 rounded-md bg-slate-50 p-2 text-xs leading-5 text-slate-700"
                      aria-label={`已保存规则：${site.name}`}
                    >
                      已保存规则：{transportSafetySummary(site)}
                    </p>
                    {!site.addressResolved ? (
                      <p className="mt-1 text-xs text-amber-800">
                        卸土点尚无有效地图坐标；开启定位硬拦截后将无法直接确认卸土，请先在地点档案补齐定位。
                      </p>
                    ) : null}
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="text-xs">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            aria-label={`${site.name}最短时间硬拦截`}
                            checked={draft.minimumTransitEnabled}
                            disabled={!active || saving}
                            onChange={event =>
                              patch({
                                minimumTransitEnabled: event.target.checked,
                              })
                            }
                          />
                          最短时间 ·{" "}
                          {draft.minimumTransitEnabled
                            ? "硬拦截"
                            : "仅提示、不拦截"}
                        </label>
                        <label
                          htmlFor={`site-${site.id}-minutes`}
                          className="mt-2 block"
                        >
                          最短运输时间（分钟） · 1～1440
                        </label>
                        <Input
                          id={`site-${site.id}-minutes`}
                          aria-label={`${site.name}最短运输时间（分钟）`}
                          aria-invalid={Boolean(validation.minimumTransitError)}
                          aria-describedby={`site-${site.id}-minutes-help`}
                          className="mt-1"
                          type="number"
                          inputMode="numeric"
                          min="1"
                          max="1440"
                          step="1"
                          disabled={!active || saving}
                          value={draft.minimumTransitMinutes}
                          onChange={event =>
                            patch({ minimumTransitMinutes: event.target.value })
                          }
                        />
                        <p
                          id={`site-${site.id}-minutes-help`}
                          className={`mt-1 leading-5 ${validation.minimumTransitError ? "text-red-700" : "text-slate-500"}`}
                        >
                          {validation.minimumTransitError ??
                            "从实际装土确认起计算；关闭硬拦截时仍保留异常提示。"}
                        </p>
                      </div>
                      <div className="text-xs">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            aria-label={`${site.name}定位范围硬拦截`}
                            checked={draft.unloadGeofenceEnabled}
                            disabled={!active || saving}
                            onChange={event =>
                              patch({
                                unloadGeofenceEnabled: event.target.checked,
                              })
                            }
                          />
                          定位范围 ·{" "}
                          {draft.unloadGeofenceEnabled
                            ? "硬拦截"
                            : "仅提示、不拦截"}
                        </label>
                        <label
                          htmlFor={`site-${site.id}-meters`}
                          className="mt-2 block"
                        >
                          卸土点定位允许偏差（米） · 30～5000
                        </label>
                        <Input
                          id={`site-${site.id}-meters`}
                          aria-label={`${site.name}定位允许偏差（米）`}
                          aria-invalid={Boolean(validation.unloadGeofenceError)}
                          aria-describedby={`site-${site.id}-meters-help`}
                          className="mt-1"
                          type="number"
                          inputMode="numeric"
                          min="30"
                          max="5000"
                          step="1"
                          disabled={!active || saving}
                          value={draft.unloadGeofenceMeters}
                          onChange={event =>
                            patch({ unloadGeofenceMeters: event.target.value })
                          }
                        />
                        <p
                          id={`site-${site.id}-meters-help`}
                          className={`mt-1 leading-5 ${validation.unloadGeofenceError ? "text-red-700" : "text-slate-500"}`}
                        >
                          {validation.unloadGeofenceError ??
                            "以卸土点坐标为中心的允许偏差；500米是0.5公里，5000米是5公里。"}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        disabled={
                          !active ||
                          !dirty[site.id] ||
                          saving ||
                          !validation.valid
                        }
                        onClick={persist}
                      >
                        {save.isPending && save.variables?.id === site.id
                          ? "正在保存并回读…"
                          : "保存地点统一阈值"}
                      </Button>
                      <span
                        role="status"
                        className={`text-xs ${dirty[site.id] ? "text-amber-800" : "text-green-700"}`}
                      >
                        {dirty[site.id]
                          ? validation.valid
                            ? "尚未保存：保存后才使用新规则"
                            : "输入不符合范围，未提交；已保存规则保持不变"
                          : "当前显示已保存规则"}
                      </span>
                    </div>
                  </section>
                );
              })
          )}
          <section className="space-y-2">
            <p className="text-sm font-semibold">路线特殊闭环策略 · 即时保存</p>
            {activeRoutes.map(route => (
              <div key={route.id} className="rounded-lg border p-3">
                <p className="text-xs">
                  路线 #{route.id} · {route.presetDistanceKm} km · 卸土点 #
                  {route.unloadSiteId}
                </p>
                <label className="mt-2 flex items-start gap-2 text-xs leading-5">
                  <input
                    type="checkbox"
                    aria-label={`路线${route.id}卸土点补刷卡闭环`}
                    checked={route.unloadOnlyCloseEnabled}
                    disabled={!active || saving || routes.isError}
                    onChange={event => {
                      if (saving || !active) return;
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
                    卸土点补刷卡完成闭环。未记录装土刷卡，不伪造实际装土时间；连续间隔和定位仍由卸土点统一校验。当前已保存：
                    {route.unloadOnlyCloseEnabled ? "开启" : "关闭"}。
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
