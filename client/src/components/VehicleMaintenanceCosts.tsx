import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { VehicleManagementReport } from "./VehicleManagementReport";
import {
  VehicleField,
  VehicleFormFrame,
  VehicleSelectField,
} from "./VehicleManagementForms";
import {
  confirmVehicleDiscard,
  vehicleDateTime,
  vehicleDate,
  vehicleLabel,
  requireVehicleChoice,
  dateTimeEpoch,
} from "@/lib/vehicleManagementWorkspace";
import { vehicleDateTimeInput as toDeviceDateTimeInput } from "@/lib/vehicleManagementWorkspace";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { toast } from "sonner";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
type Cost =
  inferRouterOutputs<AppRouter>["admin"]["assetMaintenance"]["list"][number];
export function VehicleMaintenanceCosts({
  vehicleId,
  projectId,
  active,
  onDirtyChange,
  onSaved,
}: {
  vehicleId: number;
  projectId: number;
  active: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
}) {
  const list = trpc.admin.assetMaintenance.list.useQuery(
    { assetType: "vehicle", assetId: vehicleId, projectId },
    { enabled: active, retry: false }
  );
  const [editing, setEditing] = useState<Cost | null | undefined>(undefined),
    utils = trpc.useUtils();
  const open = (row: Cost | null) => {
    setEditing(row);
    onDirtyChange(true);
  };
  const close = () =>
    confirmVehicleDiscard(true, () => {
      setEditing(undefined);
      onDirtyChange(false);
    });
  const saved = async () => {
    setEditing(undefined);
    onDirtyChange(false);
    await Promise.all([
      utils.admin.assetMaintenance.list.invalidate(),
      utils.transport.getVehicleAnalysis.invalidate(),
      utils.transport.listVehicleSummaries.invalidate(),
    ]);
    onSaved();
  };
  return (
    <div className="space-y-3">
      <Button size="sm" onClick={() => open(null)}>
        登记车辆维修 / 保养费用
      </Button>
      {list.isError ? (
        <p role="alert">维修费用读取失败，请刷新</p>
      ) : list.isLoading ? (
        <p>正在读取原维修台账…</p>
      ) : (
        <VehicleManagementReport
          report={{
            title: "车辆原维修保养费用台账",
            scope: "本车当前项目 · 全部记录",
            headers: [
              "费用编号",
              "日期",
              "类别",
              "金额",
              "服务商",
              "真实里程",
              "下次保养日期",
              "状态",
              "备注",
            ],
            rows: (list.data ?? []).map(r => [
              r.id,
              vehicleDateTime(r.occurredAt),
              vehicleLabel(r.costCategory),
              r.amount,
              r.serviceProvider,
              r.meterReading,
              vehicleDate(r.nextDueAt),
              vehicleLabel(r.status),
              r.remarks,
            ]),
            summary:
              "金额通过既有费用台账确认；已确认或已结算费用仅可维护非金额资料，不能直接覆盖金额、日期或标记已付款。历史项目费用可在费用分析中选择原项目查看。",
          }}
          actions={i => (
            <Button
              size="sm"
              variant="outline"
              disabled={list.data?.[i].status === "void"}
              onClick={() => open(list.data![i])}
            >
              维护记录
            </Button>
          )}
        />
      )}
      {editing !== undefined && (
        <CostForm
          row={editing}
          vehicleId={vehicleId}
          projectId={projectId}
          onClose={close}
          onSaved={() => void saved()}
        />
      )}
    </div>
  );
}
function CostForm({
  row,
  vehicleId,
  projectId,
  onClose,
  onSaved,
}: {
  row: Cost | null;
  vehicleId: number;
  projectId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const locked = !!row && ["approved", "settled"].includes(row.status);
  const [form, setForm] = useState({
    costCategory: row?.costCategory ?? "repair",
    amount: String(row?.amount ?? ""),
    occurredAt: row
      ? toDeviceDateTimeInput(row.occurredAt)
      : toDeviceDateTimeInput(),
    serviceProvider: row?.serviceProvider ?? "",
    meterReading: String(row?.meterReading ?? ""),
    nextDueAt: row?.nextDueAt ? vehicleDate(row.nextDueAt) : "",
    remarks: row?.remarks ?? "",
    status: row?.status ?? "draft",
  });
  const save = trpc.admin.assetMaintenance.save.useMutation();
  const put = (key: keyof typeof form, value: string) =>
    setForm(p => ({ ...p, [key]: value }));
  return (
    <VehicleFormFrame
      title="车辆维修保养费用"
      description="金额只写入原费用台账；工单引用此记录，不另外计费。"
      pending={save.isPending}
      onClose={onClose}
      onSubmit={event => {
        event.preventDefault();
        void (async () => {
          try {
            const amount = Number(form.amount),
              meter = form.meterReading.trim()
                ? Number(form.meterReading)
                : null;
            if (
              !(amount > 0) ||
              !Number.isFinite(amount) ||
              (meter !== null && (!Number.isFinite(meter) || meter < 0))
            )
              throw Error("请填写有效费用和里程");
            await save.mutateAsync({
              id: row?.id,
              assetType: "vehicle",
              assetId: vehicleId,
              projectId,
              costCategory: requireVehicleChoice(
                form.costCategory,
                ["repair", "maintenance"] as const,
                "费用类别"
              ),
              amount,
              occurredAt: locked
                ? new Date(row!.occurredAt).toISOString()
                : new Date(dateTimeEpoch(form.occurredAt)).toISOString(),
              serviceProvider: form.serviceProvider || null,
              meterReading: meter,
              nextDueAt: form.nextDueAt || null,
              remarks: form.remarks || null,
              status: locked
                ? row!.status
                : requireVehicleChoice(
                    form.status,
                    ["draft", "approved"] as const,
                    "费用状态"
                  ),
            });
            toast.success("费用台账已保存");
            onSaved();
          } catch (e) {
            toast.error(
              getUserFacingErrorMessage(e, "维修费用未保存，请检查输入")
            );
          }
        })();
      }}
    >
      <VehicleSelectField
        label="费用类别"
        value={form.costCategory}
        onChange={v => put("costCategory", v)}
        disabled={locked}
        options={[
          ["repair", "维修"],
          ["maintenance", "保养"],
        ]}
      />
      <VehicleField
        label="金额（元）"
        value={form.amount}
        onChange={v => put("amount", v)}
        type="number"
        required
        disabled={locked}
      />
      <VehicleField
        label="实际发生时间"
        value={form.occurredAt}
        onChange={v => put("occurredAt", v)}
        type="datetime-local"
        required
        disabled={locked}
      />
      <VehicleSelectField
        label="费用确认状态"
        value={form.status}
        onChange={v => put("status", v)}
        disabled={locked}
        options={
          locked
            ? [[form.status, vehicleLabel(form.status)]]
            : [
                ["draft", "草稿"],
                ["approved", "已确认费用（并非已付款）"],
              ]
        }
      />
      <VehicleField
        label="维修服务商"
        value={form.serviceProvider}
        onChange={v => put("serviceProvider", v)}
      />
      <VehicleField
        label="实际里程"
        value={form.meterReading}
        onChange={v => put("meterReading", v)}
        type="number"
      />
      <VehicleField
        label="下次保养日期"
        value={form.nextDueAt}
        onChange={v => put("nextDueAt", v)}
        type="date"
      />
      <VehicleField
        label="备注 / 维护说明"
        value={form.remarks}
        onChange={v => put("remarks", v)}
      />
    </VehicleFormFrame>
  );
}
