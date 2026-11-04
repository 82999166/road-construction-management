import { useState, type FormEvent } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { PersonnelResourceSelect } from "@/components/PersonnelResourceSelect";
import {
  VehicleField,
  VehicleFormFrame,
  VehicleSelectField,
  type VehicleNode,
} from "./VehicleManagementForms";
import {
  dateTimeEpoch,
  optionalNumber,
  requiredNumber,
  requireVehicleChoice,
  vehicleDate,
} from "@/lib/vehicleManagementWorkspace";
import { toChinaDateInput as toDeviceDateInput } from "@/lib/businessTime";
import { vehicleDateTimeInput as toDeviceDateTimeInput } from "@/lib/vehicleManagementWorkspace";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { toast } from "sonner";

export type VehicleCoreDetail =
  inferRouterOutputs<AppRouter>["vehicleManagement"]["detail"];
export type VehicleLifecycleFormKind =
  | "profile"
  | "state"
  | "assignment"
  | "contract"
  | "document"
  | "verify"
  | "inspection"
  | "workOrder"
  | "plan"
  | "special"
  | "grant"
  | "revoke"
  | "retire"
  | "remove";
export type VehicleLifecycleTarget = {
  kind: VehicleLifecycleFormKind;
  recordId?: number;
  action?: string;
};
const titles: Record<VehicleLifecycleFormKind, string> = {
  profile: "完善分类与档案",
  state: "维护调度状态",
  assignment: "司机交接 / 进退场 / 调配",
  contract: "新增合同生效版本",
  document: "上传新证照记录",
  verify: "核验证照",
  inspection: "出车检查与故障登记",
  workOrder: "维修闭环办理",
  plan: "日期 / 里程保养计划",
  special: "渣土专项 / 监控人工档案",
  grant: "显式车辆查账授权",
  revoke: "撤销查账授权",
  retire: "退场归档",
  remove: "关联检查与删除保护",
};
const inspectionKeys = [
  ["brakes", "制动"],
  ["tires", "轮胎"],
  ["lights", "灯光"],
  ["leaks", "漏油"],
  ["sealing", "密闭装置"],
] as const;
function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string")
        return reject(new Error("附件读取失败"));
      resolve(reader.result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(new Error("附件读取失败"));
    reader.readAsDataURL(file);
  });
}
export function VehicleLifecycleForm({
  detail,
  target,
  projects,
  vehicles,
  onClose,
  onSaved,
}: {
  detail: VehicleCoreDetail;
  target: VehicleLifecycleTarget;
  projects: readonly VehicleNode[];
  vehicles: ReadonlyArray<{ id: number; plateNo: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const profile = detail.profile;
  const plan =
    target.kind === "plan"
      ? detail.maintenancePlans.find(row => row.id === target.recordId)
      : undefined;
  const [form, setForm] = useState(() => ({
    purpose: profile?.purpose ?? "general",
    propertyType: profile?.propertyType ?? "company_owned",
    settlementMode: profile?.settlementMode ?? "none",
    vin: profile?.vin ?? "",
    brandModel: profile?.brandModel ?? "",
    registeredOn: profile?.registeredOn
      ? vehicleDate(profile.registeredOn)
      : "",
    energyType: profile?.energyType ?? "",
    emissionStandard: profile?.emissionStandard ?? "",
    effectiveCapacityM3: String(profile?.effectiveCapacityM3 ?? ""),
    trailerVehicleId: String(profile?.trailerVehicleId ?? ""),
    remarks: profile?.remarks ?? "",
    dispatchStatus: profile?.dispatchStatus ?? "standby",
    action: target.action ?? "handover",
    targetProjectId: String(detail.vehicle.projectId),
    occurredAt: toDeviceDateTimeInput(),
    meterReading: "",
    condition: "",
    reason: "",
    billingType: "daily",
    rate: "",
    supersedesContractId: "",
    effectiveFrom: toDeviceDateInput(),
    effectiveTo: "",
    kind: "insurance",
    title: plan?.title ?? "",
    validFrom: toDeviceDateInput(),
    validTo: "",
    applicable: "true",
    result: "verified",
    safetyFault: "false",
    notes: "",
    workAction: target.action ?? "start",
    serviceProvider: "",
    laborHours: "",
    partsDescription: "",
    costBearer: "company",
    maintenanceRecordId: "",
    purchaseOrderIds: "",
    dueOn: plan?.dueOn ? vehicleDate(plan.dueOn) : "",
    dueMileage: String(plan?.dueMileage ?? ""),
    lastMileage: String(plan?.lastMileage ?? ""),
    source: plan?.source ?? "",
    completed: "false",
    specialKind: "earthwork",
    operatorName: "",
    approvalNo: "",
    loadingSite: "",
    unloadingSite: "",
    allowedRoute: "",
    allowedTimeWindow: "",
    sealedDeviceCheck: "",
    exitCheck: "",
    unloadReceipt: "",
    exceptionHandling: "",
    provider: "",
    deviceNo: "",
    platformName: "",
    deviceStatus: "unknown",
    verifiedAt: "",
    verificationNote: "",
    userId: "",
    driverBindingId: "",
    role: "owner",
    scope: "service_period",
    grantFrom: toDeviceDateTimeInput(),
    grantTo: "",
  }));
  const [driver, setDriver] = useState<{
    id: number;
    name: string;
    userId: number | null;
  } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [checks, setChecks] = useState<Record<string, string>>(() =>
    Object.fromEntries(inspectionKeys.map(([key]) => [key, "unknown"]))
  );
  const [saving, setSaving] = useState(false);
  const api = trpc.vehicleManagement;
  const saveProfile = api.saveProfile.useMutation();
  const setState = api.setState.useMutation();
  const assign = api.assign.useMutation();
  const saveContract = api.saveContract.useMutation();
  const uploadDocument = api.uploadDocument.useMutation();
  const verifyDocument = api.verifyDocument.useMutation();
  const inspect = api.inspect.useMutation();
  const transition = api.transitionWorkOrder.useMutation();
  const savePlan = api.saveMaintenancePlan.useMutation();
  const saveSpecial = api.saveSpecialRecord.useMutation();
  const grant = api.grantAccess.useMutation();
  const revoke = api.revokeAccess.useMutation();
  const retire = api.retire.useMutation();
  const remove = api.remove.useMutation();
  const put = (key: keyof typeof form, value: string) =>
    setForm(previous => ({ ...previous, [key]: value }));
  const field = (
    key: keyof typeof form,
    label: string,
    type = "text",
    required = false,
    help?: string
  ) => (
    <VehicleField
      key={key}
      label={label}
      value={form[key]}
      onChange={value => put(key, value)}
      type={type}
      required={required}
      help={help}
    />
  );
  const select = (
    key: keyof typeof form,
    label: string,
    options: ReadonlyArray<readonly [string, string]>
  ) => (
    <VehicleSelectField
      key={key}
      label={label}
      value={form[key]}
      onChange={value => put(key, value)}
      options={options}
    />
  );
  const person = (
    <div className="space-y-1 text-sm">
      <span>本次驾驶员</span>
      <PersonnelResourceSelect
        projectId={
          target.kind === "assignment" && form.action === "transfer"
            ? Number(form.targetProjectId)
            : detail.vehicle.projectId
        }
        role="driver"
        value={driver?.id}
        fallbackLabel={driver?.name}
        onChange={setDriver}
      />
    </div>
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const base = {
      vehicleId: detail.vehicle.id,
      projectId: detail.vehicle.projectId,
      version: detail.version,
    };
    try {
      switch (target.kind) {
        case "profile":
          await saveProfile.mutateAsync({
            ...base,
            purpose: requireVehicleChoice(
              form.purpose,
              ["general", "trailer"] as const,
              "车辆用途"
            ),
            propertyType: requireVehicleChoice(
              form.propertyType,
              ["company_owned", "rented", "partner"] as const,
              "产权"
            ),
            settlementMode: requireVehicleChoice(
              form.settlementMode,
              [
                "monthly",
                "daily",
                "hourly",
                "shift",
                "trip",
                "ton",
                "volume",
                "none",
              ] as const,
              "结算方式"
            ),
            vin: form.vin || undefined,
            brandModel: form.brandModel || undefined,
            registeredOn: form.registeredOn || undefined,
            energyType: form.energyType || undefined,
            emissionStandard: form.emissionStandard || undefined,
            effectiveCapacityM3: optionalNumber(form.effectiveCapacityM3),
            trailerVehicleId: optionalNumber(form.trailerVehicleId),
            remarks: form.remarks || undefined,
          });
          break;
        case "state":
          await setState.mutateAsync({
            ...base,
            dispatchStatus: requireVehicleChoice(
              form.dispatchStatus,
              ["standby", "working", "paused"] as const,
              "调度状态"
            ),
            reason: form.reason,
          });
          break;
        case "assignment":
          await assign.mutateAsync({
            ...base,
            action: requireVehicleChoice(
              form.action,
              ["enter", "transfer", "exit", "handover"] as const,
              "交接动作"
            ),
            targetProjectId:
              form.action === "transfer"
                ? requiredNumber(form.targetProjectId, "目标项目")
                : undefined,
            driverPersonId: driver?.id,
            driverUserId: driver ? driver.userId : undefined,
            driverBindingId: optionalNumber(form.driverBindingId) ?? undefined,
            occurredAt: dateTimeEpoch(form.occurredAt),
            meterReading: optionalNumber(form.meterReading),
            condition: form.condition,
            reason: form.reason,
          });
          break;
        case "contract":
          await saveContract.mutateAsync({
            ...base,
            billingType: requireVehicleChoice(
              form.billingType,
              ["monthly", "daily", "hourly", "shift"] as const,
              "计价"
            ),
            rate: requiredNumber(form.rate, "单价"),
            effectiveFrom: form.effectiveFrom,
            effectiveTo: form.effectiveTo || undefined,
            supersedesContractId:
              optionalNumber(form.supersedesContractId) ?? undefined,
            reason: form.reason,
          });
          break;
        case "document": {
          if (!file) throw new Error("请选择证照原件");
          if (file.size > 8 * 1024 * 1024) throw new Error("附件请控制在8MB内");
          const mimeType = requireVehicleChoice(
            file.type,
            ["image/jpeg", "image/png", "application/pdf"] as const,
            "JPG/PNG/PDF附件"
          );
          await uploadDocument.mutateAsync({
            ...base,
            kind: requireVehicleChoice(
              form.kind,
              [
                "vehicle_registration",
                "transport_permit",
                "insurance",
                "inspection",
                "annual_review",
                "other",
              ] as const,
              "证照类型"
            ),
            title: form.title,
            validFrom: form.validFrom || undefined,
            validTo: form.validTo || undefined,
            applicable: form.applicable === "true",
            originalName: file.name,
            mimeType,
            base64: await readFile(file),
          });
          break;
        }
        case "verify":
          await verifyDocument.mutateAsync({
            ...base,
            documentId: requiredNumber(String(target.recordId ?? ""), "证照"),
            result: requireVehicleChoice(
              form.result,
              ["verified", "rejected", "not_applicable"] as const,
              "核验结果"
            ),
            reason: form.reason,
          });
          break;
        case "inspection":
          await inspect.mutateAsync({
            ...base,
            occurredAt: dateTimeEpoch(form.occurredAt),
            driverPersonId: driver?.id,
            meterReading: optionalNumber(form.meterReading),
            items: inspectionKeys.map(([key]) => ({
              key,
              result: requireVehicleChoice(
                checks[key],
                ["pass", "fail", "unknown"] as const,
                "检查结果"
              ),
              note: form.notes || undefined,
            })),
            safetyFault: form.safetyFault === "true",
            notes: form.notes,
          });
          break;
        case "workOrder":
          await transition.mutateAsync({
            ...base,
            workOrderId: requiredNumber(String(target.recordId ?? ""), "工单"),
            action: requireVehicleChoice(
              form.workAction,
              [
                "start",
                "submit_acceptance",
                "reject",
                "accept",
                "release",
              ] as const,
              "工单操作"
            ),
            reason: form.reason,
            serviceProvider: form.serviceProvider || undefined,
            laborHours: optionalNumber(form.laborHours) ?? undefined,
            partsDescription: form.partsDescription || undefined,
            costBearer: requireVehicleChoice(
              form.costBearer,
              ["company", "owner", "shared"] as const,
              "费用承担方"
            ),
            maintenanceRecordId:
              optionalNumber(form.maintenanceRecordId) ?? undefined,
            purchaseOrderIds: form.purchaseOrderIds.trim()
              ? form.purchaseOrderIds
                  .split(/[,，\s]+/)
                  .map(value => requiredNumber(value, "采购单ID"))
              : undefined,
          });
          break;
        case "plan":
          await savePlan.mutateAsync({
            ...base,
            id: target.recordId,
            title: form.title,
            dueOn: form.dueOn || null,
            dueMileage: optionalNumber(form.dueMileage),
            lastMileage: optionalNumber(form.lastMileage),
            source: form.source,
            completedAt: form.completed === "true" ? Date.now() : null,
          });
          break;
        case "special":
          await saveSpecial.mutateAsync({
            ...base,
            kind: requireVehicleChoice(
              form.specialKind,
              ["earthwork", "monitoring"] as const,
              "专项类型"
            ),
            recordedAt: dateTimeEpoch(form.occurredAt),
            data:
              form.specialKind === "earthwork"
                ? {
                    operatorName: form.operatorName,
                    approvalNo: form.approvalNo,
                    validTo: form.validTo || undefined,
                    loadingSite: form.loadingSite,
                    unloadingSite: form.unloadingSite,
                    allowedRoute: form.allowedRoute,
                    allowedTimeWindow: form.allowedTimeWindow,
                    sealedDeviceCheck: form.sealedDeviceCheck,
                    exitCheck: form.exitCheck,
                    unloadReceipt: form.unloadReceipt,
                    exceptionHandling: form.exceptionHandling,
                  }
                : {
                    applicable: form.applicable === "true",
                    provider: form.provider,
                    deviceNo: form.deviceNo,
                    platformName: form.platformName,
                    deviceStatus: requireVehicleChoice(
                      form.deviceStatus,
                      ["unknown", "active", "fault", "not_configured"] as const,
                      "设备状态"
                    ),
                    verifiedAt: form.verifiedAt
                      ? dateTimeEpoch(form.verifiedAt)
                      : undefined,
                    verificationNote: form.verificationNote,
                  },
            reason: form.reason,
          });
          break;
        case "grant":
          await grant.mutateAsync({
            ...base,
            userId: optionalNumber(form.userId) ?? undefined,
            driverBindingId: optionalNumber(form.driverBindingId) ?? undefined,
            role: requireVehicleChoice(
              form.role,
              ["owner", "driver"] as const,
              "授权角色"
            ),
            scope: requireVehicleChoice(
              form.scope,
              ["service_period", "all_history"] as const,
              "读取范围"
            ),
            effectiveFrom: dateTimeEpoch(form.grantFrom),
            effectiveTo: form.grantTo ? dateTimeEpoch(form.grantTo) : undefined,
            reason: form.reason,
          });
          break;
        case "revoke":
          await revoke.mutateAsync({
            ...base,
            grantId: requiredNumber(String(target.recordId ?? ""), "授权记录"),
            reason: form.reason,
          });
          break;
        case "retire":
          await retire.mutateAsync({ ...base, reason: form.reason });
          break;
        case "remove":
          await remove.mutateAsync({ ...base, reason: form.reason });
          break;
      }
      toast.success("车辆记录已保存；历史账务和付款仍保留原事实台账");
      onSaved();
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "登记失败，请刷新版本或核实填写内容")
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <VehicleFormFrame
      title={`${titles[target.kind]} · ${detail.vehicle.plateNo}`}
      description="保存采用当前档案版本校验；续办、新合同和交接保留历史。费用只关联原凭证，不重复登记付款。"
      pending={saving}
      onClose={onClose}
      onSubmit={event => void submit(event)}
    >
      {target.kind === "profile" && (
        <>
          {select("purpose", "车辆用途", [
            ["general", "普通车辆"],
            ["trailer", "挂车（独立建档）"],
          ])}
          {select("propertyType", "产权 / 合作方式", [
            ["company_owned", "公司自有"],
            ["rented", "租入"],
            ["partner", "外协合作"],
          ])}
          {select("settlementMode", "独立结算方式", [
            ["none", "不计价"],
            ["monthly", "按月"],
            ["daily", "按天"],
            ["hourly", "按小时"],
            ["shift", "按台班"],
            ["trip", "按趟"],
            ["ton", "按吨"],
            ["volume", "按方"],
          ])}
          {field("vin", "车辆识别代号 VIN")}
          {field("brandModel", "品牌型号")}
          {field("registeredOn", "登记日期", "date")}
          {field("energyType", "能源类型")}
          {field("emissionStandard", "排放标准")}
          {field("effectiveCapacityM3", "有效容量（立方米）", "number")}
          {select("trailerVehicleId", "关联挂车", [
            ["", "未关联"],
            ...vehicles
              .filter(vehicle => vehicle.id !== detail.vehicle.id)
              .map(vehicle => [String(vehicle.id), vehicle.plateNo] as const),
          ])}
          {field("remarks", "档案备注")}
        </>
      )}
      {target.kind === "state" &&
        select("dispatchStatus", "调度状态", [
          ["standby", "待命"],
          ["working", "作业中"],
          ["paused", "暂停调度"],
        ])}
      {target.kind === "assignment" && (
        <>
          {select("action", "办理动作", [
            ["handover", "司机交接"],
            ["enter", "进场"],
            ["transfer", "项目调配"],
            ["exit", "退场"],
          ])}
          {form.action === "transfer" &&
            select(
              "targetProjectId",
              "目标项目",
              projects
                .filter(project => project.status !== "archived")
                .map(project => [String(project.id), project.name] as const)
            )}
          {field("occurredAt", "实际交接时间", "datetime-local", true)}
          {person}
          {field(
            "driverBindingId",
            "司机服务号绑定ID（明确授权时填写）",
            "number"
          )}
          {field("meterReading", "交接里程（公里）", "number")}
          {field("condition", "交接车况", "text", true)}
          <p className="text-xs text-amber-800 sm:col-span-2">
            退场不等于结清。项目调配保留旧项目费用、合同与授权记录；服务端同时校验原、新项目权限。
          </p>
        </>
      )}
      {target.kind === "contract" && (
        <>
          {select("supersedesContractId", "需要终止的旧合同未发生期间", [
            ["", "不终止旧合同（独立新合同）"],
            ...detail.contracts
              .filter(r => r.status === "active")
              .map(
                r =>
                  [
                    String(r.id),
                    `合同 ${r.id} · ${r.rate}元 · ${vehicleDate(r.effectiveFrom)}起`,
                  ] as const
              ),
          ])}
          {select("billingType", "计价方式", [
            ["monthly", "按月"],
            ["daily", "按天"],
            ["hourly", "按小时"],
            ["shift", "按台班"],
          ])}
          {field("rate", "合同单价（元）", "number", true)}
          {field("effectiveFrom", "新版本生效日期", "date", true)}
          {field("effectiveTo", "新版本截止日期", "date")}
          <p className="text-xs text-amber-800 sm:col-span-2">
            新生效区间不能与旧合同重叠，已有结算事实不会被新单价覆盖。
          </p>
        </>
      )}
      {target.kind === "document" && (
        <>
          {select("kind", "证照类型", [
            ["vehicle_registration", "行驶证"],
            ["transport_permit", "道路运输证"],
            ["insurance", "保险"],
            ["inspection", "检验"],
            ["annual_review", "年度审验"],
            ["other", "其他"],
          ])}
          {field("title", "证照名称 / 编号", "text", true)}
          {field("validFrom", "有效开始日期", "date")}
          {field("validTo", "有效截止日期", "date")}
          {select("applicable", "是否适用", [
            ["true", "适用，待核验"],
            ["false", "不适用（须核实依据）"],
          ])}
          <label className="space-y-1 text-sm">
            <span>原件 JPG / PNG / PDF（≤8MB） *</span>
            <Input
              aria-label="证照附件"
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              required
              onChange={event => setFile(event.target.files?.[0] ?? null)}
            />
            <span className="block text-xs break-all">{file?.name}</span>
          </label>
        </>
      )}
      {target.kind === "verify" &&
        select("result", "证照核验结果", [
          ["verified", "已核验"],
          ["rejected", "拒绝"],
          ["not_applicable", "核实后不适用"],
        ])}
      {target.kind === "inspection" && (
        <>
          {field("occurredAt", "检查发生时间", "datetime-local", true)}
          {person}
          {field("meterReading", "检查里程（公里）", "number")}
          {inspectionKeys.map(([key, label]) => (
            <VehicleSelectField
              key={key}
              label={`${label}检查`}
              value={checks[key]}
              onChange={value =>
                setChecks(previous => ({ ...previous, [key]: value }))
              }
              options={[
                ["unknown", "未核实"],
                ["pass", "通过"],
                ["fail", "不通过"],
              ]}
            />
          ))}
          {select("safetyFault", "是否影响安全", [
            ["false", "未认定安全故障"],
            ["true", "存在安全故障，禁止调度"],
          ])}
          {field("notes", "检查说明 / 故障描述", "text", true)}
          <p className="text-xs text-amber-800 sm:col-span-2">
            安全故障自动进入工单与技术禁用；维修、验收和独立放行完成后才能恢复调度。
          </p>
        </>
      )}
      {target.kind === "workOrder" && (
        <>
          {select("workAction", "工单办理", [
            ["start", "开始维修"],
            ["submit_acceptance", "提交验收"],
            ["reject", "验收不通过"],
            ["accept", "验收通过（仍未放行）"],
            ["release", "复核放行"],
          ])}
          {field("serviceProvider", "维修服务商")}
          {field("laborHours", "维修工时", "number")}
          {field("partsDescription", "配件 / 更换情况")}
          {select("costBearer", "费用承担方", [
            ["company", "公司"],
            ["owner", "车主"],
            ["shared", "共同承担"],
          ])}
          {field("maintenanceRecordId", "关联原维修费用记录ID", "number")}
          {field(
            "purchaseOrderIds",
            "关联采购单ID（逗号分隔）",
            "text",
            false,
            "仅关联真实凭证，不在此新增费用或付款；ID归属与锁定由服务端校验。"
          )}
        </>
      )}
      {target.kind === "plan" && (
        <>
          {field("title", "保养计划名称", "text", true)}
          {field("dueOn", "到期日期", "date")}
          {field("dueMileage", "到期里程（公里）", "number")}
          {field("lastMileage", "最近真实里程（公里）", "number")}
          {field("source", "周期依据 / 厂家资料", "text", true)}
          {select("completed", "本次计划状态", [
            ["false", "待执行"],
            ["true", "记录本次已完成"],
          ])}
          <p className="text-xs text-muted-foreground sm:col-span-2">
            日期与里程分别判断，未登记真实里程时显示未知，不推断已达标。
          </p>
        </>
      )}
      {target.kind === "special" && (
        <>
          {select("specialKind", "人工专项档案", [
            ["earthwork", "渣土专项"],
            ["monitoring", "监控档案"],
          ])}
          {field("occurredAt", "登记发生时间", "datetime-local", true)}
          {form.specialKind === "earthwork" ? (
            <>
              {field("operatorName", "运输经营单位")}
              {field("approvalNo", "核准资料编号")}
              {field("validTo", "核准有效期", "date")}
              {field("loadingSite", "装载点")}
              {field("unloadingSite", "卸载点")}
              {field("allowedRoute", "允许路线")}
              {field("allowedTimeWindow", "允许运输时段")}
              {field("sealedDeviceCheck", "密闭装置核验")}
              {field("exitCheck", "出场检查")}
              {field("unloadReceipt", "卸点签收")}
              {field("exceptionHandling", "异常处置")}
            </>
          ) : (
            <>
              {select("applicable", "动态监控是否适用", [
                ["true", "适用"],
                ["false", "不适用（按用途核验）"],
              ])}
              {field("provider", "监控服务商")}
              {field("deviceNo", "设备编号")}
              {field("platformName", "监控平台名称")}
              {select("deviceStatus", "设备状态", [
                ["unknown", "未知 / 未核实"],
                ["active", "人工核实正常"],
                ["fault", "故障"],
                ["not_configured", "未配置"],
              ])}
              {field("verifiedAt", "实际核验时间", "datetime-local")}
              {field("verificationNote", "核验说明")}
            </>
          )}
          <p className="text-xs text-amber-800 sm:col-span-2">
            这是企业人工登记档案，不等于政府电子联单、连续车辆轨迹或已自动接入监管平台。
          </p>
        </>
      )}
      {target.kind === "grant" && (
        <>
          {field("userId", "明确用户账号ID", "number")}
          {field("driverBindingId", "明确司机绑定ID", "number")}
          {select("role", "授权身份", [
            ["owner", "车主"],
            ["driver", "司机"],
          ])}
          {select("scope", "查账范围", [
            ["service_period", "指定服务期间"],
            ["all_history", "本项目全部历史（明确授权）"],
          ])}
          {field("grantFrom", "授权生效时间", "datetime-local", true)}
          {field("grantTo", "授权截止时间", "datetime-local")}
          <p className="text-xs text-amber-800 sm:col-span-2">
            不按姓名或手机号匹配，不开放运输管理权限，也不默认允许新司机查看前任历史。
          </p>
        </>
      )}
      {["retire", "remove"].includes(target.kind) && (
        <p className="text-sm leading-6 text-amber-800 sm:col-span-2">
          有运单、维修、采购、卡片、合同、使用依据、授权或结算关联的车辆不能直接删除。归档仍保留未结账务，实际关联检查由服务端执行。
        </p>
      )}
      {!["profile", "document", "inspection", "plan"].includes(target.kind) &&
        field("reason", "办理依据 / 原因", "text", true)}
    </VehicleFormFrame>
  );
}
