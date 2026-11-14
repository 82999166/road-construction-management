import {
  FinancePagination,
  FinanceRetainedPanel,
  useFinancePagination,
} from "@/components/FinanceWorkspaceNavigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  taxScopeKey,
  taxWorkspaceQueryEnabled,
  useTaxDraft,
  useTaxDirtyReport,
  useTaxScopeAlive,
  type TaxWorkspaceSection,
} from "@/components/TaxAccountingDraftState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FinancialLedgerPrintPreviewDialog } from "@/components/FinancialLedgerPrintPreviewDialog";
import {
  Dialog,
  DialogContent,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import TaxComplianceControlPanel from "@/components/TaxComplianceControlPanel";
import { getBusinessStatusLabel } from "@/components/BusinessStatusBadge";
import { formatChinaDateTime } from "@/lib/businessTime";
import { formatAmount } from "@shared/numberFormat";
import {
  Download,
  FileCheck2,
  FileOutput,
  Landmark,
  Plus,
  Printer,
  ReceiptText,
  Send,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type TaxMethod = "general" | "small_scale" | "simplified" | "other";
type AuxiliaryType =
  | "vat_input"
  | "vat_output"
  | "subcontract_deduction"
  | "stamp_duty"
  | "payroll_handoff"
  | "cross_region_prepayment"
  | "book_tax_difference"
  | "other";
type HandoffType =
  | "vat_invoice"
  | "financial_ledger"
  | "payroll"
  | "contract_tax"
  | "cross_region"
  | "combined";

const taxMethodLabel: Record<TaxMethod, string> = {
  general: "一般计税",
  small_scale: "小规模纳税人",
  simplified: "简易计税",
  other: "其他",
};
const auxiliaryTypeLabel: Record<AuxiliaryType, string> = {
  vat_input: "进项资料",
  vat_output: "销项资料",
  subcontract_deduction: "分包扣除凭证",
  stamp_duty: "合同印花税资料",
  payroll_handoff: "薪税待处理",
  cross_region_prepayment: "跨地区预缴资料",
  book_tax_difference: "税会差异",
  other: "其他",
};
const handoffTypeLabel: Record<HandoffType, string> = {
  vat_invoice: "发票资料",
  financial_ledger: "资金流水",
  payroll: "薪税资料",
  contract_tax: "合同税费资料",
  cross_region: "跨地区预缴资料",
  combined: "综合交接包",
};
const statusLabel: Record<string, string> = {
  pending: "待交接",
  handed_off: "已交接",
  receipt_recorded: "已登记回执",
  generated: "已生成",
  void: "已作废",
};
const sourceTypeLabel: Record<string, string> = {
  financial_record: "资金流水",
  financial_invoice: "财务发票",
  financial_reversal: "财务冲销",
  purchase: "采购资料",
  purchase_order_settlement: "采购订单结算",
  purchase_order_payable: "采购订单应付",
  measurement_claim: "工程计量收入",
  measurement_payment: "工程计量回款",
  diesel_refuel: "柴油领用",
  transport_trip: "运输运单",
  subcontract_payment: "分包付款",
  contract: "合同资料",
  payroll_statement: "工资资料",
};

function formatMoney(value: string | number | null | undefined) {
  return `¥${formatAmount(value)}`;
}
function downloadCsv(fileName: string, csv: string) {
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
function sourceDocumentLabel(
  sourceType: string | null | undefined,
  sourceId: string | null | undefined
) {
  const label = sourceType
    ? (sourceTypeLabel[sourceType] ?? "业务资料")
    : "人工辅助资料";
  return sourceId ? `${label}：${sourceId}` : label;
}

/**
 * 本组件服务于正式财务软件与电子税务局前的资料准备：只归集真实业务与人工确认资料，
 * 不模拟税务机关回执、不自动算税、不承诺替代持证会计师或税务师的申报职责。
 */
export interface TaxAccountingHandoffManagerProps {
  projectId: number;
  period: string;
  projectLabel?: string;
  enabled?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}

/** Parent confirms dirty scope changes; keyed boundary can never bind old drafts to a new scope. */
export default function TaxAccountingHandoffManager(
  props: TaxAccountingHandoffManagerProps
) {
  return (
    <TaxAccountingHandoffScope
      key={taxScopeKey(props.projectId, props.period)}
      {...props}
    />
  );
}

function TaxAccountingHandoffScope({
  projectId,
  period,
  projectLabel,
  enabled = true,
  onDirtyChange,
}: TaxAccountingHandoffManagerProps) {
  const [section, setSection] = useState<TaxWorkspaceSection>("materials");
  const [reviewDirty, setReviewDirty] = useState(false);
  const scopeKey = taxScopeKey(projectId, period);
  const alive = useTaxScopeAlive();
  const utils = trpc.useUtils();
  const workspace = trpc.finance.taxWorkspace.useQuery(
    { projectId, period },
    {
      enabled: taxWorkspaceQueryEnabled(enabled, projectId, section, "handoff"),
    }
  );
  const [entityOpen, setEntityOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptBatchId, setReceiptBatchId] = useState<number | null>(null);
  const [historyBatchId, setHistoryBatchId] = useState<number | null>(null);
  const handoffTypeForm = useTaxDraft<HandoffType>("combined");
  const { draft: handoffType, setDraft: setHandoffType } = handoffTypeForm;
  const handoffNotesForm = useTaxDraft("");
  const { draft: handoffNotes, setDraft: setHandoffNotes } = handoffNotesForm;
  const [printBook, setPrintBook] = useState<"auxiliary" | "batches" | null>(
    null
  );
  const entityForm = useTaxDraft({
    entityName: "",
    taxpayerIdentifier: "",
    taxMethod: "general" as TaxMethod,
    registeredLocation: "",
    remarks: "",
  });
  const { draft: entityDraft, setDraft: setEntityDraft } = entityForm;
  const profileForm = useTaxDraft({
    taxEntityId: "",
    projectLocation: "",
    taxMethod: "general" as TaxMethod,
    contractExTaxAmount: "0",
    contractTaxRate: "0",
    crossRegionConstruction: false,
    subcontractDeductionMethod: "not_applicable" as
      | "not_applicable"
      | "supporting_document"
      | "other",
    remarks: "",
  });
  const { draft: profileDraft, setDraft: setProfileDraft } = profileForm;
  const entryForm = useTaxDraft({
    entryType: "subcontract_deduction" as AuxiliaryType,
    subject: "",
    amount: "",
    taxBaseAmount: "",
    referenceTaxRate: "",
    reportedTaxAmount: "",
    documentReference: "",
    notes: "",
  });
  const { draft: entryDraft, setDraft: setEntryDraft } = entryForm;
  const receiptForm = useTaxDraft("");
  const { draft: receiptReference, setDraft: setReceiptReference } =
    receiptForm;
  const historyDownload = trpc.finance.downloadTaxHandoffBatch.useQuery(
    { id: historyBatchId ?? 0, projectId },
    {
      enabled:
        enabled &&
        section === "batches" &&
        Boolean(historyBatchId && projectId),
      retry: false,
    }
  );
  const invalidate = async () => {
    await utils.finance.taxWorkspace.invalidate({ projectId, period });
  };
  const saveEntity = trpc.finance.saveTaxEntityProfile.useMutation({
    onMutate: () => entityForm.capture(),
    onSuccess: async () => {
      if (!alive.current) return;
      entityForm.commitAndReset();
      toast.success("纳税主体已保存");
      setEntityOpen(false);
      await invalidate();
    },
    onError: error =>
      toast.error(
        getUserFacingErrorMessage(error, "财税辅助操作未完成，请稍后重试")
      ),
  });
  const saveProfile = trpc.finance.saveProjectTaxProfile.useMutation({
    onMutate: () => profileForm.capture(),
    onSuccess: async () => {
      if (!alive.current) return;
      profileForm.commit();
      toast.success("项目税务辅助档案已保存");
      setProfileOpen(false);
      await invalidate();
    },
    onError: error =>
      toast.error(
        getUserFacingErrorMessage(error, "财税辅助操作未完成，请稍后重试")
      ),
  });
  const saveEntry = trpc.finance.saveTaxAuxiliaryEntry.useMutation({
    onMutate: () => entryForm.capture(),
    onSuccess: async () => {
      if (!alive.current) return;
      entryForm.commitAndReset();
      toast.success("财税辅助事项已保存");
      setEntryOpen(false);
      await invalidate();
    },
    onError: error =>
      toast.error(
        getUserFacingErrorMessage(error, "财税辅助操作未完成，请稍后重试")
      ),
  });
  const createHandoff = trpc.finance.createTaxHandoffBatch.useMutation({
    onMutate: () => {
      handoffTypeForm.capture();
      handoffNotesForm.capture();
    },
    onSuccess: async result => {
      if (!alive.current) return;
      handoffTypeForm.commit();
      handoffNotesForm.commitAndReset();
      downloadCsv(`财税资料交接-${result.batchNo}.csv`, result.csv);
      toast.success(`已生成 ${result.recordCount} 行真实资料并下载CSV`);
      await invalidate();
    },
    onError: error =>
      toast.error(
        getUserFacingErrorMessage(error, "财税辅助操作未完成，请稍后重试")
      ),
  });
  const transitionBatch = trpc.finance.transitionTaxHandoffBatch.useMutation({
    onSuccess: async () => {
      if (!alive.current) return;
      receiptForm.load("");
      toast.success("交接批次状态已更新");
      setReceiptOpen(false);
      setReceiptBatchId(null);
      setReceiptReference("");
      await invalidate();
    },
    onError: error =>
      toast.error(
        getUserFacingErrorMessage(error, "财税辅助操作未完成，请稍后重试")
      ),
  });

  useEffect(() => {
    if (
      !enabled ||
      section !== "batches" ||
      !alive.current ||
      !historyDownload.data ||
      !historyBatchId
    )
      return;
    downloadCsv(
      `财税资料交接-${historyDownload.data.batchNo}.csv`,
      historyDownload.data.csv
    );
    toast.success("已按生成时快照下载历史交接资料");
    setHistoryBatchId(null);
  }, [enabled, section, historyBatchId, historyDownload.data, alive]);

  const hydratedProfile = useRef<
    NonNullable<typeof workspace.data>["projectProfile"] | undefined
  >(undefined);
  useEffect(() => {
    const profile = workspace.data?.projectProfile;
    if (
      !profile ||
      profile === hydratedProfile.current ||
      profileForm.dirty ||
      saveProfile.isPending
    )
      return;
    hydratedProfile.current = profile;
    profileForm.load({
      taxEntityId: String(profile.taxEntityId),
      projectLocation: profile.projectLocation,
      taxMethod: profile.taxMethod as TaxMethod,
      contractExTaxAmount: String(profile.contractExTaxAmount),
      contractTaxRate: String(profile.contractTaxRate),
      crossRegionConstruction: profile.crossRegionConstruction,
      subcontractDeductionMethod: profile.subcontractDeductionMethod,
      remarks: profile.remarks ?? "",
    });
  }, [
    workspace.data?.projectProfile,
    profileForm.dirty,
    profileForm.load,
    saveProfile.isPending,
  ]);

  const pending =
    saveEntity.isPending ||
    saveProfile.isPending ||
    saveEntry.isPending ||
    createHandoff.isPending ||
    transitionBatch.isPending;
  const localDirty =
    entityForm.dirty ||
    profileForm.dirty ||
    entryForm.dirty ||
    handoffTypeForm.dirty ||
    handoffNotesForm.dirty ||
    receiptForm.dirty;
  useTaxDirtyReport(localDirty || reviewDirty || pending, onDirtyChange);
  const discardDrafts = () => {
    if (
      localDirty &&
      !window.confirm(
        "放弃当前项目、月份的未保存财税资料？此操作不会删除已保存台账。"
      )
    )
      return;
    entityForm.reset();
    profileForm.reset();
    entryForm.reset();
    handoffTypeForm.reset();
    handoffNotesForm.reset();
    receiptForm.reset();
    setEntityOpen(false);
    setProfileOpen(false);
    setEntryOpen(false);
    setReceiptOpen(false);
    setReceiptBatchId(null);
  };
  const entryPagination = useFinancePagination(
    workspace.data?.entries ?? [],
    scopeKey
  );
  const batchPagination = useFinancePagination(
    workspace.data?.handoffBatches ?? [],
    scopeKey
  );

  const activeEntities = useMemo(
    () =>
      workspace.data?.entityOptions.filter(
        entity => entity.status === "active"
      ) ?? [],
    [workspace.data?.entityOptions]
  );
  const profile = workspace.data?.projectProfile;
  const auxiliaryRows = (workspace.data?.entries ?? []).map(entry => ({
    id: String(entry.id),
    cells: [
      auxiliaryTypeLabel[entry.entryType as AuxiliaryType],
      entry.subject,
      entry.period,
      sourceDocumentLabel(entry.sourceType, entry.sourceId),
      formatMoney(entry.amount),
      entry.reportedTaxAmount === null
        ? "未录入"
        : formatMoney(entry.reportedTaxAmount),
      statusLabel[entry.status] ?? getBusinessStatusLabel(entry.status),
      entry.documentReference ?? "待补充",
    ],
  }));
  const auxiliaryAmount = (workspace.data?.entries ?? [])
    .filter(entry => entry.status !== "void")
    .reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0);
  const auxiliaryTaxAmount = (workspace.data?.entries ?? [])
    .filter(entry => entry.status !== "void")
    .reduce((sum, entry) => sum + Number(entry.reportedTaxAmount ?? 0), 0);
  const batchRows = (workspace.data?.handoffBatches ?? []).map(batch => ({
    id: String(batch.id),
    cells: [
      batch.batchNo,
      handoffTypeLabel[batch.handoffType as HandoffType],
      String(batch.recordCount),
      formatChinaDateTime(batch.generatedAt),
      statusLabel[batch.status] ?? getBusinessStatusLabel(batch.status),
      batch.receiptReference ?? "未登记",
    ],
  }));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-background px-4 py-3">
        <p className="text-sm font-semibold">
          当前项目：{projectLabel || `项目 #${projectId}`} · 当前月份：{period}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          仅准备内部资料和登记真实交接回执，不自动申报或缴税。合同税费档案为项目级资料，其他本期台账按当前月份。
        </p>
      </div>
      <Tabs
        value={section}
        onValueChange={value => setSection(value as TaxWorkspaceSection)}
      >
        <TabsList className="grid h-auto w-full grid-cols-3">
          <TabsTrigger value="materials" disabled={!enabled}>
            内部资料
          </TabsTrigger>
          <TabsTrigger value="batches" disabled={!enabled}>
            交接批次
          </TabsTrigger>
          <TabsTrigger value="review" disabled={!enabled}>
            专业复核
          </TabsTrigger>
        </TabsList>
        <TabsContent value={section} className="space-y-4">
          {localDirty && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <p>
                当前范围有未保存输入，切换子页仍保留；重新打开表单可继续编辑。
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={discardDrafts}
              >
                放弃本区草稿
              </Button>
            </div>
          )}
          <div hidden={section === "review"} inert={section === "review"}>
            <Card className="border-sky-200 bg-sky-50/30 shadow-sm">
              <CardHeader className="flex flex-col gap-3 space-y-0 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <p className="text-xs font-semibold tracking-[0.12em] text-sky-800">
                    财税辅助 · 对外资料交接
                  </p>
                  <CardTitle className="mt-1 text-base">
                    纳税主体、税务辅助台账与受控导出
                  </CardTitle>
                  <CardDescription className="mt-1 max-w-4xl">
                    {workspace.data?.disclaimer ??
                      "本区仅归集真实业务资料和外部回执引用。"}
                  </CardDescription>
                </div>
                <div
                  hidden={section !== "materials"}
                  className={`${section !== "materials" ? "hidden" : "flex"} flex-wrap gap-2 print:hidden`}
                >
                  <Button
                    size="sm"
                    onClick={() => {
                      if (!profile)
                        return toast.error("请先维护项目税务辅助档案");
                      setEntryOpen(true);
                    }}
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    辅助事项
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {workspace.error ? (
                  <div
                    role="alert"
                    className="rounded-lg border border-destructive/30 p-3 text-sm"
                  >
                    <p>
                      {getUserFacingErrorMessage(
                        workspace.error,
                        "财税辅助资料读取失败"
                      )}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!enabled || section === "review"}
                      onClick={() => workspace.refetch()}
                    >
                      重试读取
                    </Button>
                  </div>
                ) : workspace.isLoading ? (
                  <p className="text-sm text-slate-500">
                    正在读取财税辅助资料…
                  </p>
                ) : (
                  <>
                    <div className="space-y-4">
                      <details
                        className="rounded-xl border border-sky-200 bg-white/90 p-4 text-sm"
                        hidden={section !== "materials"}
                      >
                        <summary className="cursor-pointer text-sm font-semibold">
                          低频配置：纳税主体与项目税务档案 ·{" "}
                          {profile ? "已配置" : "待配置，请先维护"}
                        </summary>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {" "}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEntityOpen(true);
                            }}
                          >
                            <Landmark className="mr-1.5 h-4 w-4" />
                            纳税主体
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (!activeEntities.length)
                                return toast.error("请先维护并启用纳税主体");
                              setProfileOpen(true);
                            }}
                          >
                            <FileCheck2 className="mr-1.5 h-4 w-4" />
                            项目税务档案
                          </Button>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold text-slate-900">
                            项目税务辅助档案
                          </p>
                          <Badge
                            variant={
                              profile?.status === "active"
                                ? "default"
                                : "secondary"
                            }
                          >
                            {profile
                              ? profile.status === "active"
                                ? "已配置"
                                : "已归档"
                              : "待配置"}
                          </Badge>
                        </div>
                        {profile ? (
                          <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
                            <div>
                              <dt className="text-slate-500">纳税主体</dt>
                              <dd className="mt-0.5 font-medium">
                                {workspace.data?.entityOptions.find(
                                  entity => entity.id === profile.taxEntityId
                                )?.entityName ?? "—"}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-slate-500">项目实际所在地</dt>
                              <dd className="mt-0.5 font-medium">
                                {profile.projectLocation}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-slate-500">
                                计税方法 / 合同不含税金额
                              </dt>
                              <dd className="mt-0.5 font-medium">
                                {taxMethodLabel[profile.taxMethod as TaxMethod]}{" "}
                                / {formatMoney(profile.contractExTaxAmount)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-slate-500">
                                跨地区建筑 / 分包扣除
                              </dt>
                              <dd className="mt-0.5 font-medium">
                                {profile.crossRegionConstruction
                                  ? "需要资料准备"
                                  : "否"}{" "}
                                /{" "}
                                {profile.subcontractDeductionMethod ===
                                "supporting_document"
                                  ? "凭证扣除"
                                  : profile.subcontractDeductionMethod ===
                                      "other"
                                    ? "其他方式"
                                    : "不适用"}
                              </dd>
                            </div>
                          </dl>
                        ) : (
                          <p className="mt-3 text-xs leading-5 text-slate-600">
                            先绑定纳税主体并登记项目实际所在地、合同不含税口径及跨地区建筑标记，之后才能生成受控交接资料。
                          </p>
                        )}
                      </details>
                      <div
                        hidden={section !== "batches"}
                        className="rounded-xl border border-sky-200 bg-white/90 p-4 text-sm"
                      >
                        <p className="font-semibold text-slate-900">
                          本期交接CSV
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-600">
                          生成后立即下载，并在系统保存字段快照与SHA-256。历史批次下载始终返回当时快照，不会被后续台账修改覆盖。
                        </p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                          <Select
                            value={handoffType}
                            onValueChange={value =>
                              setHandoffType(value as HandoffType)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(handoffTypeLabel).map(
                                ([value, label]) => (
                                  <SelectItem key={value} value={value}>
                                    {label}
                                  </SelectItem>
                                )
                              )}
                            </SelectContent>
                          </Select>
                          <Button
                            disabled={!profile || createHandoff.isPending}
                            onClick={() =>
                              createHandoff.mutate({
                                projectId,
                                period,
                                handoffType,
                                notes: handoffNotes.trim() || null,
                              })
                            }
                          >
                            <FileOutput className="mr-1.5 h-4 w-4" />
                            {createHandoff.isPending
                              ? "正在生成…"
                              : "生成并导出"}
                          </Button>
                        </div>
                        <Input
                          className="mt-2"
                          maxLength={500}
                          placeholder="交接备注（可选，例如：提交外部财务软件处理）"
                          value={handoffNotes}
                          onChange={event =>
                            setHandoffNotes(event.target.value)
                          }
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2 print:hidden">
                      <Button
                        size="sm"
                        variant="outline"
                        hidden={section !== "materials"}
                        disabled={!auxiliaryRows.length}
                        onClick={() => setPrintBook("auxiliary")}
                      >
                        <Printer className="mr-1.5 h-4 w-4" />
                        打印当前辅助事项明细与汇总
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        hidden={section !== "batches"}
                        disabled={!batchRows.length}
                        onClick={() => setPrintBook("batches")}
                      >
                        <Printer className="mr-1.5 h-4 w-4" />
                        打印当前交接批次明细与汇总
                      </Button>
                    </div>
                    <div
                      hidden={section !== "materials"}
                      className="overflow-x-auto rounded-xl border border-sky-100 bg-white"
                    >
                      <Table className="min-w-[920px] text-xs">
                        <TableHeader className="bg-sky-50">
                          <TableRow>
                            <TableHead>辅助事项</TableHead>
                            <TableHead>期间 / 来源</TableHead>
                            <TableHead>金额 / 已确认税额</TableHead>
                            <TableHead>凭证 / 说明</TableHead>
                            <TableHead>状态</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {workspace.data?.entries.length ? (
                            entryPagination.pageRows.map(entry => (
                              <TableRow key={entry.id}>
                                <TableCell>
                                  <p className="font-medium text-slate-800">
                                    {entry.subject}
                                  </p>
                                  <p className="mt-1 text-[11px] text-slate-500">
                                    {
                                      auxiliaryTypeLabel[
                                        entry.entryType as AuxiliaryType
                                      ]
                                    }
                                  </p>
                                </TableCell>
                                <TableCell>
                                  {entry.period}
                                  <p className="mt-1 text-[11px] text-slate-500">
                                    {sourceDocumentLabel(
                                      entry.sourceType,
                                      entry.sourceId
                                    )}
                                  </p>
                                </TableCell>
                                <TableCell>
                                  {formatMoney(entry.amount)}
                                  <p className="mt-1 text-[11px] text-slate-500">
                                    已确认税额：
                                    {entry.reportedTaxAmount === null
                                      ? "未录入"
                                      : formatMoney(entry.reportedTaxAmount)}
                                  </p>
                                </TableCell>
                                <TableCell className="max-w-[260px] whitespace-normal">
                                  {entry.documentReference ?? "待补充"}
                                  <p className="mt-1 text-[11px] text-slate-500">
                                    {entry.notes ?? "—"}
                                  </p>
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      entry.status === "receipt_recorded"
                                        ? "default"
                                        : "secondary"
                                    }
                                  >
                                    {statusLabel[entry.status] ??
                                      getBusinessStatusLabel(entry.status)}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))
                          ) : (
                            <TableRow>
                              <TableCell
                                colSpan={5}
                                className="py-8 text-center text-slate-500"
                              >
                                本期暂无人工补充的财税辅助事项。发票、资金流水、工资和合同仍会在导出时从真实业务数据自动归集。
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    <div hidden={section !== "materials"}>
                      <FinancePagination
                        {...entryPagination}
                        onPageChange={entryPagination.setPage}
                        onPageSizeChange={entryPagination.setPageSize}
                        label="财税辅助事项"
                      />
                    </div>
                    <div
                      hidden={section !== "batches"}
                      className="overflow-x-auto rounded-xl border border-sky-100 bg-white"
                    >
                      <Table className="min-w-[920px] text-xs">
                        <TableHeader className="bg-sky-50">
                          <TableRow>
                            <TableHead>交接批次</TableHead>
                            <TableHead>资料类型 / 行数</TableHead>
                            <TableHead>生成时间 / 快照</TableHead>
                            <TableHead>外部回执</TableHead>
                            <TableHead className="text-right">操作</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {workspace.data?.handoffBatches.length ? (
                            batchPagination.pageRows.map(batch => (
                              <TableRow key={batch.id}>
                                <TableCell>
                                  <p className="font-medium text-slate-800">
                                    {batch.batchNo}
                                  </p>
                                  <p className="mt-1 text-[11px] text-slate-500">
                                    {statusLabel[batch.status] ??
                                      getBusinessStatusLabel(batch.status)}
                                  </p>
                                </TableCell>
                                <TableCell>
                                  {
                                    handoffTypeLabel[
                                      batch.handoffType as HandoffType
                                    ]
                                  }
                                  <p className="mt-1 text-[11px] text-slate-500">
                                    {batch.recordCount} 行 · CSV
                                  </p>
                                </TableCell>
                                <TableCell>
                                  {formatChinaDateTime(batch.generatedAt)}
                                  <p className="mt-1 text-[11px] text-slate-500">
                                    SHA-256：{batch.snapshotHash.slice(0, 16)}…
                                  </p>
                                </TableCell>
                                <TableCell>
                                  {batch.receiptReference ?? "未登记"}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-1">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={historyDownload.isFetching}
                                      onClick={() =>
                                        setHistoryBatchId(Number(batch.id))
                                      }
                                    >
                                      <Download className="mr-1 h-3.5 w-3.5" />
                                      下载
                                    </Button>
                                    {batch.status === "generated" ? (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={transitionBatch.isPending}
                                        onClick={() =>
                                          transitionBatch.mutate({
                                            id: Number(batch.id),
                                            projectId,
                                            targetStatus: "handed_off",
                                            receiptReference: null,
                                            receiptEvidenceId: null,
                                            notes: null,
                                          })
                                        }
                                      >
                                        <Send className="mr-1 h-3.5 w-3.5" />
                                        标记已交接
                                      </Button>
                                    ) : null}
                                    {batch.status === "handed_off" ? (
                                      <Button
                                        size="sm"
                                        disabled={transitionBatch.isPending}
                                        onClick={() => {
                                          if (
                                            receiptForm.dirty &&
                                            receiptBatchId !==
                                              Number(batch.id) &&
                                            !window.confirm(
                                              "放弃未保存的回执引用并打开另一批次？"
                                            )
                                          )
                                            return;
                                          if (
                                            receiptBatchId !== Number(batch.id)
                                          )
                                            receiptForm.load("");
                                          setReceiptBatchId(Number(batch.id));
                                          setReceiptOpen(true);
                                        }}
                                      >
                                        <ReceiptText className="mr-1 h-3.5 w-3.5" />
                                        登记回执
                                      </Button>
                                    ) : null}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))
                          ) : (
                            <TableRow>
                              <TableCell
                                colSpan={5}
                                className="py-8 text-center text-slate-500"
                              >
                                尚未生成交接批次；系统不会创建示例文件或虚构外部系统处理结果。
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    <div hidden={section !== "batches"}>
                      <FinancePagination
                        {...batchPagination}
                        onPageChange={batchPagination.setPage}
                        onPageSizeChange={batchPagination.setPageSize}
                        label="交接批次"
                      />
                    </div>
                  </>
                )}
              </CardContent>

              <FinancialLedgerPrintPreviewDialog
                open={
                  enabled &&
                  section === "materials" &&
                  printBook === "auxiliary"
                }
                onOpenChange={open => !open && setPrintBook(null)}
                title="财税辅助事项明细与汇总表"
                projectName={profile?.projectLocation || "当前项目"}
                period={period}
                filterLabel="当前项目、当前会计期间的财税辅助事项"
                columns={[
                  { label: "事项类型", width: "13%" },
                  { label: "事项摘要", width: "20%" },
                  { label: "期间", width: "9%" },
                  { label: "真实来源", width: "15%" },
                  { label: "资料金额", width: "12%" },
                  { label: "已确认税额", width: "12%" },
                  { label: "状态", width: "9%" },
                  { label: "凭证参考", width: "10%" },
                ]}
                rows={auxiliaryRows}
                summaryLabel={`合计：当前期间 ${auxiliaryRows.length} 项；有效资料金额 ${formatMoney(auxiliaryAmount)}；已确认税额 ${formatMoney(auxiliaryTaxAmount)}；作废资料不计入金额汇总`}
              />
              <FinancialLedgerPrintPreviewDialog
                open={
                  enabled && section === "batches" && printBook === "batches"
                }
                onOpenChange={open => !open && setPrintBook(null)}
                title="财税资料交接批次明细与汇总表"
                projectName={profile?.projectLocation || "当前项目"}
                period={period}
                filterLabel="当前项目、当前会计期间已生成的资料交接批次"
                columns={[
                  { label: "交接批次", width: "20%" },
                  { label: "资料类型", width: "18%" },
                  { label: "行数", width: "10%" },
                  { label: "生成时间", width: "20%" },
                  { label: "状态", width: "14%" },
                  { label: "外部回执", width: "18%" },
                ]}
                rows={batchRows}
                summaryLabel={`合计：当前期间 ${batchRows.length} 个交接批次；资料行数 ${(workspace.data?.handoffBatches ?? []).reduce((sum, batch) => sum + Number(batch.recordCount ?? 0), 0)} 行；历史下载仍以各批次生成时快照为准`}
              />
              <Dialog
                open={enabled && section === "materials" && entityOpen}
                onOpenChange={setEntityOpen}
              >
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>维护纳税主体</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label>主体名称</Label>
                      <Input
                        className="mt-1"
                        value={entityDraft.entityName}
                        onChange={event =>
                          setEntityDraft(current => ({
                            ...current,
                            entityName: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <Label>纳税人识别号</Label>
                      <Input
                        className="mt-1"
                        value={entityDraft.taxpayerIdentifier}
                        onChange={event =>
                          setEntityDraft(current => ({
                            ...current,
                            taxpayerIdentifier:
                              event.target.value.toUpperCase(),
                          }))
                        }
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label>计税方法</Label>
                        <Select
                          value={entityDraft.taxMethod}
                          onValueChange={value =>
                            setEntityDraft(current => ({
                              ...current,
                              taxMethod: value as TaxMethod,
                            }))
                          }
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(taxMethodLabel).map(
                              ([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  {label}
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>注册地（可选）</Label>
                        <Input
                          className="mt-1"
                          value={entityDraft.registeredLocation}
                          onChange={event =>
                            setEntityDraft(current => ({
                              ...current,
                              registeredLocation: event.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>
                    <div>
                      <Label>备注（可选）</Label>
                      <Textarea
                        className="mt-1"
                        value={entityDraft.remarks}
                        onChange={event =>
                          setEntityDraft(current => ({
                            ...current,
                            remarks: event.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setEntityOpen(false)}
                    >
                      取消
                    </Button>
                    <Button
                      disabled={saveEntity.isPending}
                      onClick={() =>
                        saveEntity.mutate({
                          ...entityDraft,
                          registeredLocation:
                            entityDraft.registeredLocation.trim() || null,
                          remarks: entityDraft.remarks.trim() || null,
                          status: "active",
                        })
                      }
                    >
                      保存主体
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Dialog
                open={enabled && section === "materials" && profileOpen}
                onOpenChange={setProfileOpen}
              >
                <DialogContent className="max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>维护项目税务辅助档案</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label>纳税主体</Label>
                      <Select
                        value={profileDraft.taxEntityId}
                        onValueChange={value =>
                          setProfileDraft(current => ({
                            ...current,
                            taxEntityId: value,
                          }))
                        }
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder="选择已启用主体" />
                        </SelectTrigger>
                        <SelectContent>
                          {activeEntities.map(entity => (
                            <SelectItem
                              key={entity.id}
                              value={String(entity.id)}
                            >
                              {entity.entityName} · {entity.taxpayerIdentifier}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>项目实际所在地</Label>
                      <Input
                        className="mt-1"
                        value={profileDraft.projectLocation}
                        onChange={event =>
                          setProfileDraft(current => ({
                            ...current,
                            projectLocation: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label>计税方法</Label>
                        <Select
                          value={profileDraft.taxMethod}
                          onValueChange={value =>
                            setProfileDraft(current => ({
                              ...current,
                              taxMethod: value as TaxMethod,
                            }))
                          }
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(taxMethodLabel).map(
                              ([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  {label}
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>合同不含税金额</Label>
                        <Input
                          className="mt-1"
                          inputMode="decimal"
                          value={profileDraft.contractExTaxAmount}
                          onChange={event =>
                            setProfileDraft(current => ({
                              ...current,
                              contractExTaxAmount: event.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label>合同参考税率（小数）</Label>
                        <Input
                          className="mt-1"
                          inputMode="decimal"
                          value={profileDraft.contractTaxRate}
                          onChange={event =>
                            setProfileDraft(current => ({
                              ...current,
                              contractTaxRate: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div>
                        <Label>分包扣除资料方式</Label>
                        <Select
                          value={profileDraft.subcontractDeductionMethod}
                          onValueChange={value =>
                            setProfileDraft(current => ({
                              ...current,
                              subcontractDeductionMethod:
                                value as typeof current.subcontractDeductionMethod,
                            }))
                          }
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="not_applicable">
                              不适用
                            </SelectItem>
                            <SelectItem value="supporting_document">
                              凭证扣除
                            </SelectItem>
                            <SelectItem value="other">其他方式</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                      <input
                        type="checkbox"
                        checked={profileDraft.crossRegionConstruction}
                        onChange={event =>
                          setProfileDraft(current => ({
                            ...current,
                            crossRegionConstruction: event.target.checked,
                          }))
                        }
                      />
                      跨地区建筑服务（仅提示需准备预缴资料，不代表已预缴）
                    </label>
                    <div>
                      <Label>备注（可选）</Label>
                      <Textarea
                        className="mt-1"
                        value={profileDraft.remarks}
                        onChange={event =>
                          setProfileDraft(current => ({
                            ...current,
                            remarks: event.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setProfileOpen(false)}
                    >
                      取消
                    </Button>
                    <Button
                      disabled={
                        saveProfile.isPending || !profileDraft.taxEntityId
                      }
                      onClick={() =>
                        saveProfile.mutate({
                          projectId,
                          taxEntityId: Number(profileDraft.taxEntityId),
                          projectLocation: profileDraft.projectLocation.trim(),
                          taxMethod: profileDraft.taxMethod,
                          contractExTaxAmount: Number(
                            profileDraft.contractExTaxAmount || 0
                          ),
                          contractTaxRate: Number(
                            profileDraft.contractTaxRate || 0
                          ),
                          crossRegionConstruction:
                            profileDraft.crossRegionConstruction,
                          subcontractDeductionMethod:
                            profileDraft.subcontractDeductionMethod,
                          remarks: profileDraft.remarks.trim() || null,
                          status: "active",
                        })
                      }
                    >
                      保存档案
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Dialog
                open={enabled && section === "materials" && entryOpen}
                onOpenChange={setEntryOpen}
              >
                <DialogContent className="max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>新增财税辅助事项</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      仅填写已由业务资料或持证人员确认的事实；“已确认税额”为空时不表示零税额，系统不会自动补算。
                    </p>
                    <div>
                      <Label>事项类型</Label>
                      <Select
                        value={entryDraft.entryType}
                        onValueChange={value =>
                          setEntryDraft(current => ({
                            ...current,
                            entryType: value as AuxiliaryType,
                          }))
                        }
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(auxiliaryTypeLabel).map(
                            ([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>事项摘要</Label>
                      <Input
                        className="mt-1"
                        value={entryDraft.subject}
                        onChange={event =>
                          setEntryDraft(current => ({
                            ...current,
                            subject: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label>资料金额</Label>
                        <Input
                          className="mt-1"
                          inputMode="decimal"
                          value={entryDraft.amount}
                          onChange={event =>
                            setEntryDraft(current => ({
                              ...current,
                              amount: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div>
                        <Label>计税依据（可选）</Label>
                        <Input
                          className="mt-1"
                          inputMode="decimal"
                          value={entryDraft.taxBaseAmount}
                          onChange={event =>
                            setEntryDraft(current => ({
                              ...current,
                              taxBaseAmount: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div>
                        <Label>已确认税额（可选）</Label>
                        <Input
                          className="mt-1"
                          inputMode="decimal"
                          value={entryDraft.reportedTaxAmount}
                          onChange={event =>
                            setEntryDraft(current => ({
                              ...current,
                              reportedTaxAmount: event.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label>参考税率（小数，可选）</Label>
                        <Input
                          className="mt-1"
                          inputMode="decimal"
                          value={entryDraft.referenceTaxRate}
                          onChange={event =>
                            setEntryDraft(current => ({
                              ...current,
                              referenceTaxRate: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div>
                        <Label>外部/凭证参考号（可选）</Label>
                        <Input
                          className="mt-1"
                          value={entryDraft.documentReference}
                          onChange={event =>
                            setEntryDraft(current => ({
                              ...current,
                              documentReference: event.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>
                    <div>
                      <Label>说明（可选）</Label>
                      <Textarea
                        className="mt-1"
                        value={entryDraft.notes}
                        onChange={event =>
                          setEntryDraft(current => ({
                            ...current,
                            notes: event.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setEntryOpen(false)}
                    >
                      取消
                    </Button>
                    <Button
                      disabled={saveEntry.isPending}
                      onClick={() =>
                        saveEntry.mutate({
                          projectId,
                          period,
                          entryType: entryDraft.entryType,
                          sourceType: null,
                          sourceId: null,
                          subject: entryDraft.subject.trim(),
                          amount: Number(entryDraft.amount || 0),
                          taxBaseAmount: entryDraft.taxBaseAmount
                            ? Number(entryDraft.taxBaseAmount)
                            : null,
                          referenceTaxRate: entryDraft.referenceTaxRate
                            ? Number(entryDraft.referenceTaxRate)
                            : null,
                          reportedTaxAmount: entryDraft.reportedTaxAmount
                            ? Number(entryDraft.reportedTaxAmount)
                            : null,
                          documentReference:
                            entryDraft.documentReference.trim() || null,
                          evidenceId: null,
                          notes: entryDraft.notes.trim() || null,
                        })
                      }
                    >
                      保存待交接事项
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Dialog
                open={enabled && section === "batches" && receiptOpen}
                onOpenChange={setReceiptOpen}
              >
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>登记外部回执引用</DialogTitle>
                  </DialogHeader>
                  <p className="text-sm text-slate-600">
                    只登记已真实取得的外部财务软件、电子税务局或内部交接回执编号；未取得回执请保持“已交接”。
                  </p>
                  <div>
                    <Label>回执引用</Label>
                    <Input
                      className="mt-1"
                      value={receiptReference}
                      onChange={event =>
                        setReceiptReference(event.target.value)
                      }
                      placeholder="例如：外部系统批次号/受理回执号"
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setReceiptOpen(false)}
                    >
                      取消
                    </Button>
                    <Button
                      disabled={
                        transitionBatch.isPending ||
                        !receiptReference.trim() ||
                        !receiptBatchId
                      }
                      onClick={() =>
                        receiptBatchId &&
                        transitionBatch.mutate({
                          id: receiptBatchId,
                          projectId,
                          targetStatus: "receipt_recorded",
                          receiptReference: receiptReference.trim(),
                          receiptEvidenceId: null,
                          notes: null,
                        })
                      }
                    >
                      登记真实回执
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </Card>
          </div>
          <FinanceRetainedPanel active={section === "review"} label="专业复核">
            <TaxComplianceControlPanel
              projectId={projectId}
              period={period}
              projectLabel={projectLabel}
              enabled={enabled && section === "review"}
              onDirtyChange={setReviewDirty}
              onConfigure={() => setSection("materials")}
            />
          </FinanceRetainedPanel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
