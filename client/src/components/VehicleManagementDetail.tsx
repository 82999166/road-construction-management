import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { BusinessWorkspaceNavigation } from "./BusinessWorkspaceNavigation";
import { FinanceRetainedPanel } from "./FinanceWorkspaceNavigation";
import { VehicleManagementReport } from "./VehicleManagementReport";
import {
  VehicleRegistryForm,
  type VehicleNode,
  type VehicleRegistryRow,
} from "./VehicleManagementForms";
import {
  VehicleLifecycleForm,
  type VehicleLifecycleTarget,
  type VehicleCoreDetail,
} from "./VehicleManagementFormsLifecycle";
import TransportVehicleSettlementManager from "./TransportVehicleSettlementManager";
import { VehicleMaintenanceCosts } from "./VehicleMaintenanceCosts";
import { VehicleSettlementProfileDialog } from "./VehicleSettlementProfileDialog";
import { toChinaDateInput as toDeviceDateInput } from "@/lib/businessTime";
import {
  VEHICLE_DETAIL_TABS,
  vehicleDate,
  vehicleDateTime,
  vehicleLabel,
  vehicleMoney,
  vehicleDateReminder,
  vehicleMileageReminder,
  confirmVehicleDiscard,
  type VehicleDetailTab,
} from "@/lib/vehicleManagementWorkspace";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { toast } from "sonner";
const actionLabels: Record<string, string> = {
  saveProfile: "分类技术资料维护",
  setState: "调度状态变更",
  assign: "驾驶责任与进退场",
  saveContract: "新增合同版本",
  uploadDocument: "上传证照",
  verifyDocument: "证照核验",
  inspect: "出车检查",
  transitionWorkOrder: "维修工单办理",
  saveMaintenancePlan: "保养计划维护",
  saveSpecialRecord: "专项资料登记",
  grantAccess: "查账授权",
  revokeAccess: "撤销查账授权",
  retire: "车辆归档",
  remove: "关联核验与归档",
};
export default function VehicleManagementDetail({
  vehicleId,
  projects,
  organizations,
  vehicles,
  initialTab = "base",
  onClose,
  onDirtyChange,
  onChanged,
}: {
  vehicleId: number;
  projects: readonly VehicleNode[];
  organizations: readonly VehicleNode[];
  vehicles: ReadonlyArray<{ id: number; plateNo: string }>;
  initialTab?: VehicleDetailTab;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<VehicleDetailTab>(initialTab),
    [target, setTarget] = useState<VehicleLifecycleTarget | null>(null),
    [edit, setEdit] = useState<VehicleRegistryRow | null>(null),
    [payeeOpen, setPayeeOpen] = useState(false),
    [paymentDirty, setPaymentDirty] = useState(false),
    [maintenanceDirty, setMaintenanceDirty] = useState(false);
  const detail = trpc.vehicleManagement.detail.useQuery(
    { vehicleId },
    { retry: false }
  );
  const utils = trpc.useUtils();
  const dirty = Boolean(
    target || edit || payeeOpen || paymentDirty || maintenanceDirty
  );
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const close = () => confirmVehicleDiscard(dirty, onClose);
  async function refresh() {
    await Promise.all([
      utils.vehicleManagement.invalidate(),
      utils.transport.getVehicleAnalysis.invalidate(),
      utils.transport.listVehicleSummaries.invalidate(),
      utils.admin.vehicle.list.invalidate(),
    ]);
    onChanged();
    setTarget(null);
    setEdit(null);
  }
  async function editRegistry() {
    try {
      const all = await utils.admin.vehicle.list.fetch();
      const current = all.find(v => v.id === vehicleId);
      if (!current) throw Error("车辆档案不存在，请刷新");
      setEdit(current);
    } catch (e) {
      toast.error(getUserFacingErrorMessage(e, "车辆档案暂时不能编辑"));
    }
  }
  const d = detail.data;
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) close();
      }}
    >
      <DialogContent className="flex h-[min(94dvh,960px)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[min(96vw,1480px)] flex-col overflow-hidden p-3 sm:p-5">
        <DialogHeader className="shrink-0 pr-8 text-left">
          <DialogTitle>{d?.vehicle.plateNo ?? "车辆详情"}</DialogTitle>
          <DialogDescription>
            {d
              ? `${vehicleLabel(d.vehicle.status)} · ${vehicleLabel(d.profile?.technicalStatus)} · ${vehicleLabel(d.profile?.projectStatus)} · 档案版本 ${d.version}`
              : "正在读取真实车辆档案"}
          </DialogDescription>
        </DialogHeader>
        {detail.isError ? (
          <p role="alert">
            {getUserFacingErrorMessage(detail.error, "车辆详情读取失败")}
          </p>
        ) : !d ? (
          <p>正在加载车辆记录…</p>
        ) : (
          <>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={d.profile?.archived}
                onClick={() => void editRegistry()}
              >
                编辑主档
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={d.profile?.archived}
                onClick={() => setTarget({ kind: "profile" })}
              >
                完善分类与档案
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setTab("settlements")}
              >
                费用结算 / 付款凭证
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPayeeOpen(true)}
              >
                收款资料 / 使用依据
              </Button>
            </div>
            <BusinessWorkspaceNavigation
              tabs={VEHICLE_DETAIL_TABS}
              value={tab}
              onValueChange={setTab}
              label="单车详情栏目"
            />
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-1">
              <FinanceRetainedPanel
                active={tab === "base"}
                label="车辆基础资料"
              >
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    [
                      "项目",
                      projects.find(p => p.id === d.vehicle.projectId)?.name ??
                        "未登记",
                    ],
                    [
                      "车型",
                      d.profile?.purpose === "trailer"
                        ? "挂车"
                        : vehicleLabel(d.vehicle.vehicleType),
                    ],
                    ["产权 / 合作方式", vehicleLabel(d.profile?.propertyType)],
                    ["结算方式", vehicleLabel(d.profile?.settlementMode)],
                    ["常用驾驶员", d.vehicle.driverName ?? "未绑定"],
                    ["所属人 / 出租方", d.vehicle.ownerName ?? "未填写"],
                    ["司机联系", d.vehicle.driverPhoneMasked ?? "未登记"],
                    ["VIN", d.profile?.vin ?? "未登记"],
                    ["品牌型号", d.profile?.brandModel ?? "未登记"],
                    ["登记日期", vehicleDate(d.profile?.registeredOn)],
                    ["能源类型", d.profile?.energyType ?? "未登记"],
                    ["排放标准", d.profile?.emissionStandard ?? "未登记"],
                    [
                      "有效容量（m³）",
                      d.profile?.effectiveCapacityM3 ?? "未登记",
                    ],
                    ["核定载重（吨）", d.vehicle.payloadTons ?? "未登记"],
                    [
                      "关联挂车",
                      vehicles.find(v => v.id === d.profile?.trailerVehicleId)
                        ?.plateNo ?? "未关联",
                    ],
                    ["备注", d.profile?.remarks ?? "未填写"],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border bg-card p-3">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-1 break-words text-sm font-medium">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTarget({ kind: "state" })}
                  >
                    维护调度状态
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTarget({ kind: "retire" })}
                  >
                    退场归档
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTarget({ kind: "remove" })}
                  >
                    关联检查与删除保护
                  </Button>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  退场和停用均不代表结清；归档不会删除历史运单、费用、付款或责任记录。
                </p>
              </FinanceRetainedPanel>
              <FinanceRetainedPanel
                active={tab === "assignments"}
                label="驾驶责任与交接"
              >
                <div className="mb-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => setTarget({ kind: "assignment" })}
                  >
                    司机交接 / 进退场 / 调配
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTarget({ kind: "grant" })}
                  >
                    明确查账授权
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      window.open(
                        "/admin/labor",
                        "_blank",
                        "noopener,noreferrer"
                      )
                    }
                  >
                    维护驾驶员档案与资格
                  </Button>
                </div>
                <DetailRecords
                  d={d}
                  category="assignments"
                  setTarget={setTarget}
                />
                <VehicleManagementReport
                  report={{
                    title: "车辆查账授权",
                    scope: d.vehicle.plateNo,
                    headers: [
                      "账号 / 绑定编号",
                      "身份",
                      "读取范围",
                      "业务开始",
                      "业务结束",
                      "授权有效期",
                      "撤销状态",
                      "依据",
                    ],
                    rows: d.grants.map(g => [
                      g.userId
                        ? `账号 ${g.userId}`
                        : `司机绑定 ${g.driverBindingId}`,
                      vehicleLabel(g.role),
                      vehicleLabel(g.scope),
                      vehicleDateTime(g.effectiveFrom),
                      vehicleDateTime(g.effectiveTo),
                      g.validTo ? vehicleDateTime(g.validTo) : "有效至撤销",
                      g.revokedAt ? "已撤销" : "未撤销",
                      g.reason,
                    ]),
                    summary:
                      "账号、人员、驾驶员、车主和收款人分别关联；未授权历史不会开放给新司机。",
                  }}
                  actions={i =>
                    !d.grants[i].revokedAt ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setTarget({
                            kind: "revoke",
                            recordId: d.grants[i].id,
                          })
                        }
                      >
                        撤销授权
                      </Button>
                    ) : null
                  }
                />
              </FinanceRetainedPanel>
              <FinanceRetainedPanel
                active={tab === "operations"}
                label="真实车辆作业"
              >
                <VehicleOperations
                  vehicleId={vehicleId}
                  projectId={d.vehicle.projectId}
                  active={tab === "operations"}
                />
              </FinanceRetainedPanel>
              <FinanceRetainedPanel active={tab === "costs"} label="车辆费用">
                <div className="mb-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTarget({ kind: "contract" })}
                  >
                    新增合同生效版本
                  </Button>
                </div>
                <VehicleFinancialDetail
                  d={d}
                  active={tab === "costs"}
                  projects={projects}
                />
              </FinanceRetainedPanel>
              <FinanceRetainedPanel
                active={tab === "maintenance"}
                label="车辆维修与保养"
              >
                <div className="mb-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => setTarget({ kind: "inspection" })}
                  >
                    检查 / 报修登记
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTarget({ kind: "plan" })}
                  >
                    新增保养计划
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      window.open(
                        "/admin/purchasing",
                        "_blank",
                        "noopener,noreferrer"
                      )
                    }
                  >
                    关联采购与费用台账
                  </Button>
                </div>
                <DetailRecords
                  d={d}
                  category="maintenance"
                  setTarget={setTarget}
                />
                <VehicleMaintenanceCosts
                  vehicleId={vehicleId}
                  projectId={d.vehicle.projectId}
                  active={tab === "maintenance"}
                  onDirtyChange={setMaintenanceDirty}
                  onSaved={() => void refresh()}
                />
              </FinanceRetainedPanel>
              <FinanceRetainedPanel
                active={tab === "documents"}
                label="车辆证照与安全"
              >
                <div className="mb-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => setTarget({ kind: "document" })}
                  >
                    新增证照 / 续办
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTarget({ kind: "inspection" })}
                  >
                    出车检查
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTarget({ kind: "special" })}
                  >
                    渣土专项 / 监控人工资料
                  </Button>
                </div>
                <DetailRecords
                  d={d}
                  category="compliance"
                  setTarget={setTarget}
                />
              </FinanceRetainedPanel>
              <FinanceRetainedPanel
                active={tab === "settlements"}
                label="车辆费用与付款闭环"
              >
                <TransportVehicleSettlementManager
                  projectId={d.vehicle.projectId}
                  vehicles={[d.vehicle]}
                  scopeVehicleId={vehicleId}
                  active={tab === "settlements"}
                  onDirtyChange={setPaymentDirty}
                />
              </FinanceRetainedPanel>
              <FinanceRetainedPanel active={tab === "history"} label="车辆历史">
                <VehicleManagementReport
                  report={{
                    title: "车辆合同版本历史",
                    scope: d.vehicle.plateNo,
                    headers: [
                      "合同版本",
                      "项目",
                      "计费方式",
                      "原合同单价",
                      "生效开始",
                      "截止",
                      "状态",
                    ],
                    rows: d.contracts.map(r => [
                      r.id,
                      projects.find(p => p.id === r.projectId)?.name ??
                        r.projectId,
                      vehicleLabel(r.billingType),
                      r.rate,
                      vehicleDate(r.effectiveFrom),
                      vehicleDate(r.effectiveTo),
                      vehicleLabel(r.status),
                    ]),
                    summary:
                      "新合同仅调整明确未发生区间；旧单价、历史运单和已确认结算保持原快照。",
                  }}
                />
                <VehicleManagementReport
                  report={{
                    title: "车辆变更与审计记录",
                    scope: d.vehicle.plateNo,
                    headers: [
                      "版本",
                      "办理时间",
                      "项目",
                      "操作",
                      "依据 / 原因",
                    ],
                    rows: d.changes.map(r => [
                      r.version,
                      vehicleDateTime(r.createdAt),
                      projects.find(p => p.id === r.projectId)?.name ??
                        `项目 ${r.projectId}`,
                      actionLabels[r.action] ?? "车辆记录维护",
                      typeof r.changes.reason === "string"
                        ? r.changes.reason
                        : "资料详情见对应历史栏目",
                    ]),
                    summary:
                      "历史合同、作业快照、付款凭证和已确认费用不由新档案版本重算。",
                  }}
                />
                <div className="mt-3 rounded-xl border bg-muted/40 p-3 text-xs">
                  <p className="font-semibold">
                    退场前未办事项（不代表已结清）
                  </p>
                  <p className="mt-2">
                    在途票据 {d.exitChecks.openTrips} · 待处理维修{" "}
                    {d.exitChecks.pendingMaintenance} · 待办采购{" "}
                    {d.exitChecks.pendingPurchases} · 未办结结算{" "}
                    {d.exitChecks.unsettledStatements} · 活动车辆卡{" "}
                    {d.exitChecks.activeCards} · 未放行工单{" "}
                    {d.exitChecks.openWorkOrders} · 未结使用依据{" "}
                    {d.exitChecks.unsettledUsage}
                  </p>
                  <p className="mt-2">{d.exitChecks.note}</p>
                </div>
              </FinanceRetainedPanel>
            </div>
            {target && (
              <VehicleLifecycleForm
                key={`${target.kind}-${target.recordId ?? "new"}-${d.version}`}
                detail={d}
                target={target}
                projects={projects}
                vehicles={vehicles}
                onClose={() =>
                  confirmVehicleDiscard(true, () => setTarget(null))
                }
                onSaved={() => void refresh()}
              />
            )}
            {edit && (
              <VehicleRegistryForm
                vehicle={edit}
                fleetVersion={d.version}
                projects={projects}
                organizations={organizations}
                onClose={() => confirmVehicleDiscard(true, () => setEdit(null))}
                onSaved={() => void refresh()}
              />
            )}
            <VehicleSettlementProfileDialog
              open={payeeOpen}
              onOpenChange={open => {
                if (open) setPayeeOpen(true);
                else confirmVehicleDiscard(true, () => setPayeeOpen(false));
              }}
              projectId={d.vehicle.projectId}
              vehicles={[d.vehicle]}
              initialVehicleId={vehicleId}
              onRefresh={refresh}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
export function DetailRecords({
  d,
  category,
  setTarget,
}: {
  d: VehicleCoreDetail;
  category: "assignments" | "maintenance" | "compliance";
  setTarget: (target: VehicleLifecycleTarget) => void;
}) {
  const preview = trpc.vehicleManagement.previewDocument.useMutation(),
    [file, setFile] = useState<{
      url: string;
      mimeType: string;
      fileName: string;
    } | null>(null);
  const today = toDeviceDateInput();
  async function openDocument(id: number, projectId: number) {
    try {
      const value = await preview.mutateAsync({
        vehicleId: d.vehicle.id,
        projectId,
        documentId: id,
      });
      setFile(value);
    } catch (e) {
      toast.error(getUserFacingErrorMessage(e, "证照暂时不能预览"));
    }
  }
  const scope = d.vehicle.plateNo;
  return (
    <div className="space-y-5">
      {category === "assignments" && (
        <VehicleManagementReport
          report={{
            title: "司机交接与进退场记录",
            scope,
            headers: [
              "动作",
              "项目",
              "发生时间",
              "责任截止",
              "司机人员编号",
              "交接里程",
              "车况",
              "依据",
            ],
            rows: d.assignments.map(r => [
              r.action === "baseline"
                ? "历史基线（未推定责任）"
                : vehicleLabel(r.action),
              r.projectId,
              vehicleDateTime(r.effectiveFrom),
              vehicleDateTime(r.effectiveTo),
              r.driverPersonId ?? "未关联",
              r.meterReading,
              r.condition,
              r.reason,
            ]),
          }}
        />
      )}
      {category === "maintenance" && (
        <>
          <VehicleManagementReport
            report={{
              title: "维修工单与独立验收",
              scope,
              headers: [
                "工单编号",
                "故障",
                "状态",
                "服务商",
                "工时",
                "配件说明",
                "费用承担",
                "停驶",
                "维修完成",
                "验收",
                "放行",
              ],
              rows: d.workOrders.map(r => [
                r.id,
                r.fault,
                vehicleLabel(r.status),
                r.serviceProvider,
                r.laborHours,
                r.partsDescription,
                vehicleLabel(r.costBearer),
                vehicleDateTime(r.stoppedAt),
                vehicleDateTime(r.repairedAt),
                vehicleDateTime(r.acceptedAt),
                vehicleDateTime(r.releasedAt),
              ]),
              summary:
                "仅关联原维修费用和采购单，不重复计费；验收后仍须独立放行，再由调度恢复。",
            }}
            actions={i => {
              const r = d.workOrders[i],
                action: Record<string, string> = {
                  reported: "start",
                  repairing: "submit_acceptance",
                  awaiting_acceptance: "accept",
                  accepted: "release",
                };
              return r.status !== "released" ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setTarget({
                      kind: "workOrder",
                      recordId: r.id,
                      action: action[r.status],
                    })
                  }
                >
                  办理工单
                </Button>
              ) : null;
            }}
          />
          <VehicleManagementReport
            report={{
              title: "日期与里程保养计划",
              scope,
              headers: [
                "计划",
                "日期条件",
                "里程条件",
                "当前真实里程",
                "日期判断",
                "里程判断",
                "周期依据",
                "完成时间",
              ],
              rows: d.maintenancePlans.map(r => [
                r.title,
                vehicleDate(r.dueOn),
                r.dueMileage,
                r.lastMileage,
                r.completedAt ? "已完成" : vehicleDateReminder(r.dueOn, today),
                r.completedAt
                  ? "已完成"
                  : vehicleMileageReminder(r.dueMileage, r.lastMileage),
                r.source,
                vehicleDateTime(r.completedAt),
              ]),
            }}
            actions={i =>
              !d.maintenancePlans[i].completedAt ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setTarget({
                      kind: "plan",
                      recordId: d.maintenancePlans[i].id,
                    })
                  }
                >
                  维护计划
                </Button>
              ) : null
            }
          />
        </>
      )}
      {category === "compliance" && (
        <>
          <VehicleManagementReport
            report={{
              title: "证照有效期与核验",
              scope,
              headers: [
                "名称",
                "类型",
                "适用",
                "有效期开始",
                "截止",
                "核验状态",
                "到期判断",
                "核验时间",
                "依据",
              ],
              rows: d.documents.map(r => [
                r.title,
                vehicleLabel(r.kind),
                r.applicable ? "适用" : "申请不适用",
                vehicleDate(r.validFrom),
                vehicleDate(r.validTo),
                r.verificationStatus === "pending"
                  ? "待核验"
                  : vehicleLabel(r.verificationStatus),
                r.verificationStatus === "not_applicable"
                  ? "不适用"
                  : vehicleDateReminder(r.validTo, today),
                vehicleDateTime(r.verifiedAt),
                r.verificationNote,
              ]),
            }}
            actions={i => (
              <div className="flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={preview.isPending}
                  onClick={() =>
                    void openDocument(
                      d.documents[i].id,
                      d.documents[i].projectId
                    )
                  }
                >
                  预览原件
                </Button>
                {d.documents[i].verificationStatus === "pending" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setTarget({ kind: "verify", recordId: d.documents[i].id })
                    }
                  >
                    核验
                  </Button>
                )}
              </div>
            )}
          />
          <VehicleManagementReport
            report={{
              title: "出车检查",
              scope,
              headers: [
                "发生时间",
                "驾驶员编号",
                "真实里程",
                "检查项目",
                "安全故障",
                "说明",
              ],
              rows: d.inspections.map(r => [
                vehicleDateTime(r.occurredAt),
                r.driverPersonId,
                r.meterReading,
                r.items
                  .map(
                    x =>
                      `${({ brakes: "制动", tires: "轮胎", lights: "灯光", leaks: "漏油", sealing: "密闭装置" } as Record<string, string>)[x.key] ?? "其他"}：${vehicleLabel(x.result)}`
                  )
                  .join("；"),
                r.safetyFault ? "存在，已停调" : "未认定",
                r.notes,
              ]),
            }}
          />
          <VehicleManagementReport
            report={{
              title: "渣土与监控人工资料",
              scope,
              headers: ["类型", "登记时间", "核验资料", "依据", "来源"],
              rows: d.specialRecords.map(r => [
                vehicleLabel(r.kind),
                vehicleDateTime(r.recordedAt),
                Object.entries(r.data)
                  .map(
                    ([key, value]) =>
                      `${specialLabels[key] ?? "补充资料"}：${typeof value === "boolean" ? (value ? "是" : "否") : key === "deviceStatus" ? vehicleLabel(String(value)) : (value ?? "未填写")}`
                  )
                  .join("；"),
                r.reason,
                "人工登记",
              ]),
              summary:
                "人工资料不等同政府电子联单、连续车辆轨迹或已自动接入监管平台。",
            }}
          />
        </>
      )}
      {file && (
        <Dialog
          open
          onOpenChange={open => {
            if (!open) setFile(null);
          }}
        >
          <DialogContent className="flex h-[88dvh] w-[calc(100vw-1rem)] max-w-6xl flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle>车辆证照原件 · {file.fileName}</DialogTitle>
            </DialogHeader>
            {file.mimeType.startsWith("image/") ? (
              <div className="min-h-0 flex-1 overflow-auto">
                <img
                  src={file.url}
                  alt={file.fileName}
                  className="mx-auto max-h-full max-w-full object-contain"
                />
              </div>
            ) : (
              <iframe
                title="车辆PDF证照预览"
                src={file.url}
                className="min-h-0 w-full flex-1"
              />
            )}
            <p className="text-xs text-muted-foreground">
              同源短时授权预览，不自动下载；失效后请关闭重新打开。
            </p>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
const specialLabels: Record<string, string> = {
  operatorName: "经营单位",
  approvalNo: "核准编号",
  validTo: "核准有效期",
  loadingSite: "装载点",
  unloadingSite: "卸载点",
  allowedRoute: "允许路线",
  allowedTimeWindow: "运输时段",
  sealedDeviceCheck: "密闭核验",
  exitCheck: "出场检查",
  unloadReceipt: "卸点签收",
  exceptionHandling: "异常处置",
  applicable: "是否适用",
  provider: "服务商",
  deviceNo: "设备编号",
  platformName: "平台名称",
  deviceStatus: "设备状态",
  verifiedAt: "实际核验时间",
  verificationNote: "核验说明",
};
function VehicleOperations({
  vehicleId,
  projectId,
  active,
}: {
  vehicleId: number;
  projectId: number;
  active: boolean;
}) {
  const [from, setFrom] = useState(toDeviceDateInput),
    [to, setTo] = useState(toDeviceDateInput);
  const trips = trpc.transport.listTrips.useQuery(
    { projectId, vehicleId, dateFrom: from, dateTo: to },
    { enabled: active && from <= to, retry: false }
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <label className="text-xs">
          发生日期开始
          <Input
            type="date"
            aria-label="作业日期开始"
            value={from}
            onChange={e => setFrom(e.target.value)}
          />
        </label>
        <label className="text-xs">
          发生日期结束
          <Input
            type="date"
            aria-label="作业日期结束"
            value={to}
            onChange={e => setTo(e.target.value)}
          />
        </label>
      </div>
      {trips.isError ? (
        <p role="alert">作业台账读取失败，请刷新</p>
      ) : trips.isLoading ? (
        <p>正在读取作业记录…</p>
      ) : (
        <VehicleManagementReport
          report={{
            title: "车辆真实运输作业",
            scope: `${from} 至 ${to}`,
            headers: [
              "票号",
              "发票方式",
              "开始",
              "结束",
              "状态",
              "原票据运费",
              "原扣油",
              "原净应付",
            ],
            rows: (trips.data ?? []).map(t => [
              t.tripNo,
              t.invoiceMode === "plate_photo" ? "拍照发票" : "刷卡发票",
              vehicleDateTime(t.startAt),
              vehicleDateTime(t.endAt),
              vehicleLabel(t.status),
              vehicleMoney(t.calculatedAmount),
              vehicleMoney(t.fuelDeductionAmount),
              vehicleMoney(t.netSettlementAmount),
            ]),
            summary:
              "金额为原运单快照；状态和核验资格决定结算，不能直接视为实际收付。",
          }}
        />
      )}
    </div>
  );
}
function VehicleFinancialDetail({
  d,
  active,
  projects,
}: {
  d: VehicleCoreDetail;
  active: boolean;
  projects: readonly VehicleNode[];
}) {
  const [projectId, setProjectId] = useState(d.vehicle.projectId),
    [period, setPeriod] = useState(() => toDeviceDateInput().slice(0, 7)),
    [view, setView] = useState("daily");
  const analysis = trpc.transport.getVehicleAnalysis.useQuery(
    { vehicleId: d.vehicle.id, projectId, period },
    { enabled: active, retry: false }
  );
  const a = analysis.data;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <label className="text-xs">
          账务项目
          <select
            aria-label="单车账务项目"
            className="block h-10 rounded-md border bg-background px-2"
            value={projectId}
            onChange={e => setProjectId(Number(e.target.value))}
          >
            {d.historyProjectIds.map(id => (
              <option value={id} key={id}>
                {projects.find(p => p.id === id)?.name ?? `项目 ${id}`}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          业务月份
          <Input
            aria-label="单车费用月份"
            type="month"
            value={period}
            onChange={e => setPeriod(e.target.value)}
          />
        </label>
        <label className="text-xs">
          分析视图
          <select
            aria-label="费用分析视图"
            className="block h-10 rounded-md border bg-background px-2"
            value={view}
            onChange={e => setView(e.target.value)}
          >
            <option value="daily">本期每日</option>
            <option value="monthly">截至月末各月</option>
          </select>
        </label>
      </div>
      {analysis.isError ? (
        <p role="alert">
          {getUserFacingErrorMessage(analysis.error, "费用读取失败")}
        </p>
      ) : !a ? (
        <p>正在读取原始费用台账…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {[
              ["本期已核定运费", a.summary.confirmedTransportAmount],
              ["待核验金额", a.summary.pendingTransportAmount],
              [
                "合同估算（未核定部分）",
                a.summary.unconfirmedLeaseEstimateAmount,
              ],
              ["已核定租赁费用", a.summary.confirmedLeaseAmount],
              ["本期实际付款", a.summary.actualPaidAmount],
              ["截至月末待付款", a.cumulative.remainingPayableAmount],
              ["截至月末待收补款", a.cumulative.remainingReceivableAmount],
              ["本期已覆盖成本", a.summary.coveredCostAmount],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border bg-card p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 font-semibold">¥{vehicleMoney(value)}</p>
              </div>
            ))}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {a.summary.costCoverageNote} {a.summary.fuelMetricNote}{" "}
            {a.summary.leaseEstimatePending
              ? "租赁依据不完整，未核定部分不能解释为零成本，请核实历史合同和使用依据。"
              : ""}
          </p>
          <VehicleManagementReport
            report={{
              title:
                view === "daily" ? "单车本期每日费用" : "单车截至月末各月费用",
              scope: `${projects.find(p => p.id === projectId)?.name ?? "所选项目"} · ${period}`,
              headers: [
                "日期 / 月份",
                "已核定运费",
                "待核验运费",
                "油料",
                "维修",
                "保养",
                "配件",
                "已核定租赁",
                "未核定租赁估算",
                "实际付出",
                "实际收回",
              ],
              rows: (view === "daily" ? a.daily : a.monthly).map(r => [
                r.date,
                r.confirmedTransportAmount,
                r.pendingTransportAmount,
                r.fuelAmount,
                r.repairAmount,
                r.maintenanceAmount,
                r.partsAmount,
                r.confirmedLeaseAmount,
                r.unconfirmedLeaseEstimateAmount,
                r.actualPaidAmount,
                r.actualReceivedAmount,
              ]),
              summary:
                "同一项目和期间使用统一服务端事实口径；不是公司净利润，不按当前合同单价重算历史结算。",
            }}
          />
          <VehicleManagementReport
            report={{
              title: "本期已关联配件采购",
              scope: `${period}`,
              headers: [
                "采购单",
                "配件说明",
                "发生时间",
                "金额",
                "发票",
                "状态",
              ],
              rows: a.partsPurchases.map(r => [
                r.orderNo,
                r.itemDescription,
                vehicleDateTime(r.orderedAt),
                r.amount,
                r.hasInvoice ? "有发票" : "无发票",
                vehicleLabel(r.status),
              ]),
            }}
          />
        </>
      )}
    </div>
  );
}
