import { useState, type ReactNode, type FormEvent } from "react";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requiresVehicleCargoBox } from "@shared/vehicleCargo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PersonnelResourceSelect } from "@/components/PersonnelResourceSelect";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { toChinaDateInput as toDeviceDateInput } from "@/lib/businessTime";
import {
  VEHICLE_TYPE_LABELS,
  requireVehicleChoice,
  optionalNumber,
  requiredNumber,
  vehicleDate,
} from "@/lib/vehicleManagementWorkspace";
import { toast } from "sonner";

export type VehicleRegistryRow =
  inferRouterOutputs<AppRouter>["admin"]["vehicle"]["list"][number];
export type VehicleNode = { id: number; name: string; status?: string | null };
export function VehicleFormFrame({
  title,
  description,
  children,
  pending,
  onClose,
  onSubmit,
}: {
  title: string;
  description: string;
  children: ReactNode;
  pending: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        className="grid h-[min(90dvh,760px)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-3xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-3 sm:p-5"
        onEscapeKeyDown={event => {
          if (pending) event.preventDefault();
        }}
        onInteractOutside={event => {
          if (pending) event.preventDefault();
        }}
      >
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex min-h-0 flex-col gap-3">
          <fieldset
            disabled={pending}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1"
          >
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">{children}</div>
          </fieldset>
          <DialogFooter className="shrink-0 flex-row flex-wrap gap-2 border-t pt-3">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onClose}
            >
              取消
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "保存中…" : "保存登记"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function VehicleField({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  help,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  help?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block min-w-0 space-y-1 text-sm">
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      <Input
        aria-label={label}
        value={value}
        onChange={event => onChange(event.target.value)}
        type={type}
        required={required}
        disabled={disabled}
        step={type === "number" ? "any" : undefined}
        min={type === "number" ? "0" : undefined}
        className="w-full min-w-0"
      />
      {help && (
        <span className="block text-xs leading-5 text-muted-foreground">
          {help}
        </span>
      )}
    </label>
  );
}
export function VehicleSelectField({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<readonly [string, string]>;
  disabled?: boolean;
}) {
  return (
    <label className="block min-w-0 space-y-1 text-sm">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={event => onChange(event.target.value)}
        disabled={disabled}
        className="h-10 w-full min-w-0 rounded-md border bg-background px-2 text-foreground"
      >
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
export function VehicleRegistryForm({
  vehicle,
  projectId,
  projects,
  organizations,
  onClose,
  onSaved,
  fleetVersion,
}: {
  vehicle?: VehicleRegistryRow;
  fleetVersion?: number;
  projectId?: number;
  projects: readonly VehicleNode[];
  organizations: readonly VehicleNode[];
  onClose: () => void;
  onSaved: (vehicleId: number) => void;
}) {
  const [form, setForm] = useState(() => ({
    projectId: String(
      vehicle?.projectId ??
        projectId ??
        projects.find(project => project.status !== "archived")?.id ??
        ""
    ),
    organizationId: String(vehicle?.organizationId ?? ""),
    plateNo: vehicle?.plateNo ?? "",
    vehicleType: vehicle?.vehicleType ?? "dump_truck",
    ownership: vehicle?.ownership ?? "owned",
    ownerName: vehicle?.ownerName ?? "",
    driverName: vehicle?.driverName ?? "",
    driverPhone: "",
    boxLengthMeters: vehicle?.boxLengthMeters ?? "",
    boxWidthMeters: vehicle?.boxWidthMeters ?? "",
    boxHeightMeters: vehicle?.boxHeightMeters ?? "",
    loadFactor: vehicle?.loadFactor ?? "1",
    payloadTons: vehicle?.payloadTons ?? "",
    fuelTankCapacityLiters: vehicle?.fuelTankCapacityLiters ?? "",
    status: vehicle?.status ?? "active",
    billingType: vehicle?.leaseTerms?.billingType ?? "daily",
    rate: vehicle?.leaseTerms?.rate ?? "",
    effectiveFrom: vehicle?.leaseTerms
      ? vehicleDate(vehicle.leaseTerms.effectiveFrom)
      : toDeviceDateInput(),
    effectiveTo: vehicle?.leaseTerms?.effectiveTo
      ? vehicleDate(vehicle.leaseTerms.effectiveTo)
      : "",
  }));
  const [driver, setDriver] = useState<{
    id: number;
    name: string;
    userId: number | null;
  } | null>(
    vehicle?.driverPersonId
      ? {
          id: vehicle.driverPersonId,
          name: vehicle.driverName ?? "原关联司机",
          userId: vehicle.driverUserId,
        }
      : null
  );
  const save = trpc.admin.vehicle.save.useMutation();
  const utils = trpc.useUtils();
  const put = (key: keyof typeof form, value: string) =>
    setForm(previous => ({ ...previous, [key]: value }));
  const boxRequired = requiresVehicleCargoBox(form.vehicleType);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const input: inferRouterInputs<AppRouter>["admin"]["vehicle"]["save"] = {
        id: vehicle?.id,
        fleetVersion,
        projectId: requiredNumber(form.projectId, "项目"),
        organizationId: optionalNumber(form.organizationId),
        plateNo: form.plateNo.trim().toUpperCase(),
        vehicleType: requireVehicleChoice(
          form.vehicleType,
          [
            "dump_truck",
            "tractor",
            "mixer",
            "flatbed",
            "pickup",
            "suv",
            "other",
          ] as const,
          "车型"
        ),
        ownership: requireVehicleChoice(
          form.ownership,
          ["owned", "leased", "trip_settlement"] as const,
          "兼容资源性质"
        ),
        ownerName: form.ownerName.trim() || null,
        driverPersonId: vehicle ? vehicle.driverPersonId : (driver?.id ?? null),
        driverUserId: vehicle ? vehicle.driverUserId : (driver?.userId ?? null),
        driverName: driver?.name ?? (form.driverName.trim() || null),
        ...(form.driverPhone.trim()
          ? { driverPhone: form.driverPhone.trim() }
          : {}),
        boxLengthMeters: boxRequired
          ? requiredNumber(form.boxLengthMeters, "货厢长")
          : Number(vehicle?.boxLengthMeters ?? 0),
        boxWidthMeters: boxRequired
          ? requiredNumber(form.boxWidthMeters, "货厢宽")
          : Number(vehicle?.boxWidthMeters ?? 0),
        boxHeightMeters: boxRequired
          ? requiredNumber(form.boxHeightMeters, "货厢高")
          : Number(vehicle?.boxHeightMeters ?? 0),
        loadFactor: boxRequired
          ? requiredNumber(form.loadFactor, "装载系数")
          : Number(vehicle?.loadFactor ?? 1),
        payloadTons: boxRequired
          ? optionalNumber(form.payloadTons)
          : vehicle?.payloadTons
            ? Number(vehicle.payloadTons)
            : null,
        fuelTankCapacityLiters: optionalNumber(form.fuelTankCapacityLiters),
        status: requireVehicleChoice(
          form.status,
          ["active", "suspended", "disabled"] as const,
          "状态"
        ),
        leaseTerms:
          form.ownership === "leased"
            ? {
                billingType: requireVehicleChoice(
                  form.billingType,
                  ["monthly", "daily", "hourly", "shift"] as const,
                  "计价方式"
                ),
                rate: requiredNumber(form.rate, "租金"),
                effectiveFrom: form.effectiveFrom,
                effectiveTo: form.effectiveTo || null,
              }
            : null,
      };
      const result = await save.mutateAsync(input);
      await utils.admin.vehicle.list.invalidate();

      toast.success("车辆主档已保存，请在基础资料完善独立分类与技术档案");
      onSaved(result.vehicleId);
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "车辆保存失败"));
    }
  }
  return (
    <VehicleFormFrame
      title={vehicle ? `编辑车辆 · ${vehicle.plateNo}` : "新建车辆档案"}
      description="主档复用原车辆保存入口；历史车辆项目调配、司机交接、合同新版本请在对应栏目办理，不覆盖旧账。"
      pending={save.isPending}
      onClose={onClose}
      onSubmit={event => void submit(event)}
    >
      <VehicleSelectField
        label="项目"
        value={form.projectId}
        onChange={value => put("projectId", value)}
        disabled={Boolean(vehicle)}
        options={[
          ["", "请选择项目"],
          ...projects
            .filter(
              project =>
                project.status !== "archived" ||
                project.id === vehicle?.projectId
            )
            .map(project => [String(project.id), project.name] as const),
        ]}
      />
      <VehicleSelectField
        label="所属单位"
        value={form.organizationId}
        onChange={value => put("organizationId", value)}
        options={[
          ["", "未指定"],
          ...organizations
            .filter(
              org =>
                !org.status ||
                org.status === "active" ||
                org.id === vehicle?.organizationId
            )
            .map(org => [String(org.id), org.name] as const),
        ]}
      />
      <VehicleField
        label="车牌号"
        value={form.plateNo}
        onChange={value => put("plateNo", value)}
        required
      />
      <VehicleSelectField
        label="车型"
        value={form.vehicleType}
        onChange={value => put("vehicleType", value)}
        options={Object.entries(VEHICLE_TYPE_LABELS).filter(
          ([key]) => key !== "trailer"
        )}
      />
      <VehicleSelectField
        label="兼容资源性质"
        value={form.ownership}
        onChange={value => put("ownership", value)}
        disabled={Boolean(vehicle)}
        options={[
          ["owned", "公司自有"],
          ["leased", "租入"],
          ["trip_settlement", "旧按趟结算"],
        ]}
      />
      <VehicleField
        label="所属人 / 出租方"
        value={form.ownerName}
        onChange={value => put("ownerName", value)}
        required={form.ownership === "leased"}
      />
      <div className="min-w-0 space-y-1 text-sm">
        <span>常用驾驶员</span>
        {vehicle ? (
          <p className="rounded-md border bg-muted p-2">
            {vehicle.driverName ?? "未关联司机"}（责任变更请办理司机交接）
          </p>
        ) : (
          <PersonnelResourceSelect
            projectId={Number(form.projectId) || undefined}
            role="driver"
            value={driver?.id}
            fallbackLabel={driver?.name}
            onChange={setDriver}
          />
        )}
      </div>
      <VehicleField
        label="司机手机号（留空保留原值）"
        value={form.driverPhone}
        onChange={value => put("driverPhone", value)}
      />
      {boxRequired &&
        (["boxLengthMeters", "boxWidthMeters", "boxHeightMeters"] as const).map(
          (key, index) => (
            <VehicleField
              key={key}
              label={["货厢长（米）", "货厢宽（米）", "货厢高（米）"][index]}
              type="number"
              value={form[key]}
              onChange={value => put(key, value)}
              required
            />
          )
        )}
      {boxRequired && (
        <>
          <VehicleField
            label="装载系数"
            type="number"
            value={form.loadFactor}
            onChange={value => put("loadFactor", value)}
            required
          />
          <VehicleField
            label="核定载重（吨）"
            type="number"
            value={form.payloadTons}
            onChange={value => put("payloadTons", value)}
          />
        </>
      )}
      <VehicleField
        label="油箱容量（升）"
        type="number"
        value={form.fuelTankCapacityLiters}
        onChange={value => put("fuelTankCapacityLiters", value)}
      />
      <VehicleSelectField
        label="车辆启停状态"
        value={form.status}
        onChange={value => put("status", value)}
        options={[
          ["active", "启用"],
          ["suspended", "暂停"],
          ["disabled", "停用（服务端核验未结业务）"],
        ]}
      />
      {form.ownership === "leased" && (
        <>
          <VehicleSelectField
            label="兼容合同计价"
            disabled={Boolean(vehicle)}
            value={form.billingType}
            onChange={value => put("billingType", value)}
            options={[
              ["monthly", "按月"],
              ["daily", "按天"],
              ["hourly", "按小时"],
              ["shift", "按台班"],
            ]}
          />
          <VehicleField
            label="租金单价（元）"
            disabled={Boolean(vehicle)}
            type="number"
            value={form.rate}
            onChange={value => put("rate", value)}
            required
          />
          <VehicleField
            label="合同起租日期"
            disabled={Boolean(vehicle)}
            type="date"
            value={form.effectiveFrom}
            onChange={value => put("effectiveFrom", value)}
            required
          />
          <VehicleField
            label="合同截止日期"
            disabled={Boolean(vehicle)}
            type="date"
            value={form.effectiveTo}
            onChange={value => put("effectiveTo", value)}
          />
        </>
      )}
      {!boxRequired && (
        <p className="text-xs text-muted-foreground sm:col-span-2">
          该车型无需填写货厢尺寸、装载系数和核定载重，可直接保存；搅拌罐体有效容量、VIN、品牌型号及挂车组合在“基础资料
          → 完善分类与档案”维护。
        </p>
      )}
    </VehicleFormFrame>
  );
}
