import {
  discardTransportDraft,
  useTransportDirty,
  type TransportDirtyChange,
} from "@/lib/transportDraft";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toDeviceDateInput } from "@/lib/businessTime";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { formatAmount, formatQuantity } from "@shared/numberFormat";
import { Pencil, Plus, Settings2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type FreightRuleDraft = {
  id: number | null;
  materialName: string;
  settlementUnit: "cubic_meter" | "ton" | "trip";
  startDistanceKm: string;
  basePricePerUnit: string;
  stepMeters: string;
  stepIncreasePerUnit: string;
  effectiveFrom: string;
  effectiveTo: string;
  status: "draft" | "active" | "disabled";
};

const SETTLEMENT_UNIT_LABEL: Record<
  FreightRuleDraft["settlementUnit"],
  string
> = {
  cubic_meter: "立方米",
  ton: "吨",
  trip: "趟",
};

function createEmptyFreightRuleDraft(): FreightRuleDraft {
  return {
    id: null,
    materialName: "",
    settlementUnit: "cubic_meter",
    startDistanceKm: "1",
    basePricePerUnit: "",
    stepMeters: "500",
    stepIncreasePerUnit: "0",
    effectiveFrom: toDeviceDateInput(),
    effectiveTo: "",
    status: "active",
  };
}

function formatMoney(value: unknown) {
  return `¥${formatAmount(value as string | number | null | undefined)}`;
}

/**
 * PC 运输管理的合同运价唯一维护入口。
 * 路线配置只消费已生效运价；价格本身在本组件中独立维护，避免在路线表单中隐藏入口。
 */
export function TransportFreightRuleManager({
  projectId,
  active = true,
  canManage = true,
  onDirtyChange,
}: {
  projectId?: number;
  active?: boolean;
  canManage?: boolean;
  onDirtyChange?: TransportDirtyChange;
}) {
  const utils = trpc.useUtils();
  const input = { projectId: projectId ?? 0 };
  const freightRules = trpc.transport.listFreightRules.useQuery(input, {
    enabled: Boolean(projectId) && active,
  });
  const [draft, setDraft] = useState<FreightRuleDraft | null>(null);
  useTransportDirty(Boolean(draft), onDirtyChange);
  const closeDraft = () =>
    discardTransportDraft(Boolean(draft), () => setDraft(null));

  const saveRule = trpc.transport.saveFreightRule.useMutation({
    onSuccess: async (_, variables) => {
      toast.success(
        variables.id
          ? "运输运价规则已更新，后续新建运单将按新规则快照计价"
          : "运输运价规则已新增，可在运输路线中选择使用"
      );
      setDraft(null);
      await Promise.all([
        utils.transport.listFreightRules.invalidate(),
        utils.transport.listRoutePresets.invalidate(),
      ]);
    },
    onError: error =>
      toast.error(
        getUserFacingErrorMessage(error, "运价规则保存失败，请稍后重试")
      ),
  });

  if (!projectId) return null;

  const openNewRule = () => setDraft(createEmptyFreightRuleDraft());
  const openRuleEditor = (
    rule: NonNullable<typeof freightRules.data>[number]
  ) =>
    setDraft({
      id: rule.id,
      materialName: rule.materialName ?? "",
      settlementUnit: rule.settlementUnit,
      startDistanceKm: String(rule.startDistanceKm),
      basePricePerUnit: String(rule.basePricePerUnit),
      stepMeters: String(rule.stepMeters),
      stepIncreasePerUnit: String(rule.stepIncreasePerUnit),
      effectiveFrom: String(rule.effectiveFrom).slice(0, 10),
      effectiveTo: rule.effectiveTo
        ? String(rule.effectiveTo).slice(0, 10)
        : "",
      status: rule.status,
    });

  const persistRule = () => {
    if (!draft) return;
    const startDistanceKm = Number(draft.startDistanceKm);
    const basePricePerUnit = Number(draft.basePricePerUnit);
    const stepMeters = Number(draft.stepMeters);
    const stepIncreasePerUnit = Number(draft.stepIncreasePerUnit);
    if (!Number.isFinite(startDistanceKm) || startDistanceKm < 0)
      return toast.error("起步里程必须为不小于 0 的数字");
    if (!Number.isFinite(basePricePerUnit) || basePricePerUnit < 0)
      return toast.error("请填写有效基础单价");
    if (!Number.isInteger(stepMeters) || stepMeters < 1)
      return toast.error("递增步长必须为不小于 1 的整数（米）");
    if (!Number.isFinite(stepIncreasePerUnit) || stepIncreasePerUnit < 0)
      return toast.error("每步增价不能小于 0");
    if (!draft.effectiveFrom) return toast.error("请选择运价生效日期");
    if (draft.effectiveTo && draft.effectiveTo < draft.effectiveFrom)
      return toast.error("截止日期不能早于生效日期");
    saveRule.mutate({
      id: draft.id ?? undefined,
      projectId,
      materialName: draft.materialName.trim() || null,
      settlementUnit: draft.settlementUnit,
      startDistanceKm,
      basePricePerUnit,
      stepMeters,
      stepIncreasePerUnit,
      effectiveFrom: draft.effectiveFrom,
      effectiveTo: draft.effectiveTo || null,
      status: draft.status,
    });
  };

  return (
    <Card className="border-[#c8ddd9] bg-[#f7fcfb] shadow-sm">
      <CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <p className="text-xs font-semibold tracking-[0.12em] text-[#32665d]">
            运输合同计价 · 跨端共享
          </p>
          <CardTitle className="mt-1 text-base">阶梯运价设置</CardTitle>
          <CardDescription className="mt-1 max-w-3xl">
            维护项目运输的起步里程、结算单位、基础单价、递增步长和生效区间。已生成的运单保留当时运价快照，不会被后续修改改写。
          </CardDescription>
        </div>
        <Button
          size="sm"
          className="bg-[#2d6f67] text-white hover:bg-[#245a54]"
          disabled={!canManage}
          onClick={openNewRule}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          新增运价
        </Button>
      </CardHeader>
      <CardContent>
        {freightRules.isLoading ? (
          <p className="rounded-lg bg-white p-3 text-sm text-slate-500">
            正在读取项目运价规则…
          </p>
        ) : freightRules.isError ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            暂时无法读取项目运价规则，请刷新后重试。
          </p>
        ) : freightRules.data?.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {freightRules.data.map(rule => (
              <div
                key={rule.id}
                className="rounded-xl border border-slate-200 bg-white p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800">
                      {rule.materialName || "通用运输"}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      {SETTLEMENT_UNIT_LABEL[rule.settlementUnit]}结算 ·{" "}
                      {String(rule.effectiveFrom).slice(0, 10)} 起
                      {rule.effectiveTo
                        ? ` · 至 ${String(rule.effectiveTo).slice(0, 10)}`
                        : ""}
                    </p>
                    <p className="mt-1 text-xs text-[#32665d]">
                      {formatQuantity(rule.startDistanceKm)} km 起步 ·{" "}
                      {formatMoney(rule.basePricePerUnit)}/
                      {SETTLEMENT_UNIT_LABEL[rule.settlementUnit]} · 每{" "}
                      {rule.stepMeters} m 增{" "}
                      {formatMoney(rule.stepIncreasePerUnit)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${rule.status === "active" ? "bg-emerald-50 text-emerald-700" : rule.status === "draft" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}
                    >
                      {rule.status === "active"
                        ? "生效"
                        : rule.status === "draft"
                          ? "草稿"
                          : "已停用"}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canManage}
                      onClick={() => openRuleEditor(rule)}
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      编辑
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-center">
            <Settings2 className="mx-auto h-5 w-5 text-slate-400" />
            <p className="mt-2 text-sm font-medium text-slate-700">
              尚未配置运输运价
            </p>
            <p className="mt-1 text-xs text-slate-500">
              先新增一条生效运价，再在“装卸土点与运输路线配置”中建立运输路线。
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              disabled={!canManage}
              onClick={openNewRule}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              配置首条运价
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog
        open={Boolean(draft)}
        onOpenChange={open => {
          if (!open) closeDraft();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl xl:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {draft?.id ? "编辑阶梯运价" : "新增阶梯运价"}
            </DialogTitle>
            <DialogDescription>
              保存后仅影响后续新建运单；历史运单的运价快照和结算金额保持不变。
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="grid gap-3 py-2">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>物料名称（可选）</Label>
                  <Input
                    className="mt-1"
                    value={draft.materialName}
                    placeholder="如：土方、砂石、混凝土"
                    onChange={event =>
                      setDraft(current =>
                        current
                          ? { ...current, materialName: event.target.value }
                          : current
                      )
                    }
                  />
                </div>
                <div>
                  <Label>结算单位</Label>
                  <Select
                    value={draft.settlementUnit}
                    onValueChange={value =>
                      setDraft(current =>
                        current
                          ? {
                              ...current,
                              settlementUnit:
                                value as FreightRuleDraft["settlementUnit"],
                            }
                          : current
                      )
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cubic_meter">立方米</SelectItem>
                      <SelectItem value="ton">吨</SelectItem>
                      <SelectItem value="trip">趟</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>起步里程（km）</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    min="0"
                    step="0.001"
                    value={draft.startDistanceKm}
                    onChange={event =>
                      setDraft(current =>
                        current
                          ? { ...current, startDistanceKm: event.target.value }
                          : current
                      )
                    }
                  />
                </div>
                <div>
                  <Label>
                    基础单价（元 / {SETTLEMENT_UNIT_LABEL[draft.settlementUnit]}
                    ）
                  </Label>
                  <Input
                    className="mt-1"
                    type="number"
                    min="0"
                    step="0.01"
                    value={draft.basePricePerUnit}
                    onChange={event =>
                      setDraft(current =>
                        current
                          ? { ...current, basePricePerUnit: event.target.value }
                          : current
                      )
                    }
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>递增步长（米）</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    min="1"
                    step="1"
                    value={draft.stepMeters}
                    onChange={event =>
                      setDraft(current =>
                        current
                          ? { ...current, stepMeters: event.target.value }
                          : current
                      )
                    }
                  />
                </div>
                <div>
                  <Label>
                    每步增价（元 / {SETTLEMENT_UNIT_LABEL[draft.settlementUnit]}
                    ）
                  </Label>
                  <Input
                    className="mt-1"
                    type="number"
                    min="0"
                    step="0.01"
                    value={draft.stepIncreasePerUnit}
                    onChange={event =>
                      setDraft(current =>
                        current
                          ? {
                              ...current,
                              stepIncreasePerUnit: event.target.value,
                            }
                          : current
                      )
                    }
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label>生效日期</Label>
                  <Input
                    className="mt-1"
                    type="date"
                    value={draft.effectiveFrom}
                    onChange={event =>
                      setDraft(current =>
                        current
                          ? { ...current, effectiveFrom: event.target.value }
                          : current
                      )
                    }
                  />
                </div>
                <div>
                  <Label>截止日期（可选）</Label>
                  <Input
                    className="mt-1"
                    type="date"
                    value={draft.effectiveTo}
                    onChange={event =>
                      setDraft(current =>
                        current
                          ? { ...current, effectiveTo: event.target.value }
                          : current
                      )
                    }
                  />
                </div>
                <div>
                  <Label>状态</Label>
                  <Select
                    value={draft.status}
                    onValueChange={value =>
                      setDraft(current =>
                        current
                          ? {
                              ...current,
                              status: value as FreightRuleDraft["status"],
                            }
                          : current
                      )
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">草稿</SelectItem>
                      <SelectItem value="active">生效</SelectItem>
                      <SelectItem value="disabled">停用</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                运价可按合同分材料、按方/吨/趟设置。路线只能选择“生效”规则；请避免直接修改已结算期间的规则，推荐新增一条带生效日期的新规则。
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={closeDraft}>
              取消
            </Button>
            <Button
              disabled={!active || !canManage || saveRule.isPending}
              onClick={persistRule}
            >
              {saveRule.isPending
                ? "保存中…"
                : draft?.id
                  ? "保存运价修改"
                  : "保存运价"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
