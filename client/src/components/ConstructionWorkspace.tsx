import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BusinessWorkspaceNavigation } from "@/components/BusinessWorkspaceNavigation";
import {
  FinancePagination,
  useFinancePagination,
} from "@/components/FinanceWorkspaceNavigation";
import BusinessStatusBadge, {
  getBusinessStatusLabel,
} from "@/components/BusinessStatusBadge";
import { ProtectedImagePreview } from "@/components/ProtectedImagePreview";
import {
  formatChinaDate,
  formatChinaDateTime,
  toChinaDateInput,
} from "@/lib/businessTime";
import { openA4LandscapePrintDocument } from "@/lib/a4Print";
import {
  assertConstructionOutputManifest,
  assertConstructionOutputSnapshot,
  constructionOutputBatchRows,
  constructionCsv,
  constructionPrintBody,
  downloadConstructionCsv,
  CONSTRUCTION_WEATHER,
  type ConstructionWorkspaceReport,
} from "@/lib/constructionOutput";
import {
  constructionFilterInput,
  constructionReviewDrillFilter,
  constructionRowActions,
  CONSTRUCTION_WORKSPACE_TABS,
  type ConstructionStatus,
  type ConstructionWorkspaceFilter,
  type ConstructionWorkspaceTab,
} from "@shared/constructionWorkspace";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { toast } from "sonner";

export type { ConstructionWorkspaceReport } from "@/lib/constructionOutput";
function initialFilter(
  tab: ConstructionWorkspaceTab
): ConstructionWorkspaceFilter {
  const date = tab === "ledger" ? toChinaDateInput() : "";
  return {
    dateFrom: date,
    dateTo: date,
    createdBy: "all",
    keyword: "",
    status: "all",
    issueScope: "all",
  };
}
export interface ConstructionWorkspaceProps {
  projectId: number;
  projectName?: string;
  active?: boolean;
  mobile?: boolean;
  onCreate?: () => void;
  onEdit?: (report: ConstructionWorkspaceReport) => void;
  onTransition?: (
    report: ConstructionWorkspaceReport,
    nextStatus: ConstructionStatus
  ) => void;
  transitionPending?: boolean;
  renderMobileActions?: (
    report: ConstructionWorkspaceReport,
    capabilities: { canSupervisorReview: boolean }
  ) => ReactNode;
}
export function ConstructionReportDetail({
  report,
  active = true,
}: {
  report: ConstructionWorkspaceReport;
  active?: boolean;
}) {
  const evidenceInput = useMemo(
    () => ({ projectId: report.projectId, reportIds: [report.id] }),
    [report.projectId, report.id]
  );
  const evidence = trpc.construction.reportEvidence.useQuery(evidenceInput, {
    enabled: active && report.projectId > 0 && report.id > 0,
    retry: false,
    staleTime: 0,
  });
  return (
    <div className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
      <section className="rounded-lg border bg-muted/30 p-3">
        <h3 className="font-semibold">日报基本信息</h3>
        <p className="mt-2 whitespace-pre-wrap">
          {formatChinaDate(report.reportDate)} · {report.workArea}
        </p>
        <p className="mt-1 text-sm">
          填报管理员：{report.createdByName} · 天气：
          {CONSTRUCTION_WEATHER[report.weather]} · 累计进度：
          {Number(report.progressPercent).toFixed(2)}%
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          创建：{formatChinaDateTime(report.createdAt)} · 更新：
          {formatChinaDateTime(report.updatedAt)}
        </p>
      </section>
      <section>
        <h3 className="font-semibold">当日施工内容</h3>
        <p className="mt-2 whitespace-pre-wrap rounded-lg border p-3 text-sm leading-6">
          {report.workContent}
        </p>
      </section>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <section className="rounded-lg border p-3">
          <h3 className="font-semibold">安全情况</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
            {report.safetyNotes || "未记录"}
          </p>
        </section>
        <section className="rounded-lg border p-3">
          <h3 className="font-semibold">质量 / 协调问题</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
            {report.issueNotes || "未记录"}
          </p>
        </section>
      </div>
      <section className="rounded-lg border bg-muted/30 p-3">
        <h3 className="font-semibold">审核结果与回复</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <BusinessStatusBadge status={report.status} />
          <span className="text-sm">
            审核人：
            {report.reviewedByName ||
              (report.reviewedBy ? `管理员 #${report.reviewedBy}` : "未审核")}
          </span>
        </div>
        <p className="mt-2 text-sm">
          审核时间：
          {report.reviewedAt
            ? formatChinaDateTime(report.reviewedAt)
            : "未审核"}
        </p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
          {report.reviewReply || "未填写审核回复"}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          归档状态不代表问题已整改；保留原问题与审核记录。
        </p>
      </section>
      <section>
        <h3 className="font-semibold">关联现场照片</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          仅在本详情打开时申请短时签名影像，站内预览；不进入打印或导出。
        </p>
        {evidence.isError ? (
          <div className="mt-2 rounded border p-3 text-sm" role="alert">
            关联照片读取失败，不能视为无照片。
            <Button
              size="sm"
              variant="outline"
              onClick={() => void evidence.refetch()}
            >
              重试照片
            </Button>
          </div>
        ) : evidence.isFetching ? (
          <p className="mt-2 text-sm">正在读取关联现场照片…</p>
        ) : !evidence.data?.length ? (
          <p className="mt-2 text-sm text-muted-foreground">
            该日报暂未关联照片。
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3">
            {evidence.data.map((photo, index) => (
              <ProtectedImagePreview
                key={photo.id}
                file={{ url: photo.url, fileName: photo.fileName }}
                title={`施工日报照片 ${index + 1}`}
                description="现场照片仅在授权项目范围内站内预览。"
                className="block min-w-0 rounded-lg border p-2"
              >
                <img
                  src={photo.url}
                  alt={photo.description || `施工日报照片 ${index + 1}`}
                  className="aspect-square w-full rounded object-cover"
                />
                <p className="mt-1 whitespace-pre-wrap text-xs leading-5">
                  {photo.description} · {formatChinaDateTime(photo.capturedAt)}{" "}
                  · 点击预览
                </p>
              </ProtectedImagePreview>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default function ConstructionWorkspace({
  projectId,
  projectName = "当前项目",
  active = true,
  mobile = false,
  onCreate,
  onEdit,
  onTransition,
  transitionPending = false,
  renderMobileActions,
}: ConstructionWorkspaceProps) {
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<ConstructionWorkspaceTab>("ledger");
  const [filters, setFilters] = useState<
    Record<ConstructionWorkspaceTab, ConstructionWorkspaceFilter>
  >(() => ({
    ledger: initialFilter("ledger"),
    review: initialFilter("review"),
    issues: initialFilter("issues"),
    archive: initialFilter("archive"),
  }));
  const [detail, setDetail] = useState<ConstructionWorkspaceReport | null>(
    null
  );
  const [outputBusy, setOutputBusy] = useState(false);
  const [outputPlan, setOutputPlan] = useState<{
    action: "print" | "export";
    total: number;
    contextRevision: number;
    input: ReturnType<typeof constructionFilterInput>;
    filterText: string;
    projectName: string;
    batches: Array<{ batch: number; ids: number[]; from: number; to: number }>;
    completed: number[];
  } | null>(null);
  const filter = filters[tab];
  const input = useMemo(
    () => constructionFilterInput(projectId, tab, filter),
    [projectId, tab, filter]
  );
  const outputContext = useRef({ key: "", revision: 0 });
  const outputLock = useRef(false);
  const outputBatchLock = useRef(false);
  const enabled =
    active &&
    projectId > 0 &&
    !(filter.dateFrom && filter.dateTo && filter.dateFrom > filter.dateTo);
  const reports = trpc.construction.listReports.useQuery(input, {
    enabled,
    retry: false,
  });
  const summary = trpc.construction.summary.useQuery(input, {
    enabled,
    retry: false,
  });
  const submitterInput = useMemo(() => ({ projectId }), [projectId]);
  const submitters = trpc.construction.reportSubmitterOptions.useQuery(
    submitterInput,
    { enabled: active && projectId > 0, retry: false }
  );
  const capabilityInput = useMemo(
    () => ({
      projectId,
      surface: mobile ? ("mobile" as const) : ("pc" as const),
    }),
    [projectId, mobile]
  );
  const capabilities = trpc.construction.capabilities.useQuery(
    capabilityInput,
    { enabled: active && projectId > 0, retry: false }
  );
  const caps = capabilities.isError ? undefined : capabilities.data;
  const outputContextKey = JSON.stringify([
    active,
    projectName,
    input,
    caps?.canPrint,
    caps?.canExport,
  ]);
  // 渲染即取消旧上下文；单调版本使A→B→A也不能恢复迟到请求。
  if (outputContext.current.key !== outputContextKey)
    outputContext.current = {
      key: outputContextKey,
      revision: outputContext.current.revision + 1,
    };
  useEffect(() => {
    setOutputPlan(null);
  }, [outputContextKey]);
  const rows = reports.data ?? [];
  const pagination = useFinancePagination(rows, JSON.stringify(input));
  useEffect(() => {
    setDetail(null);
    setOutputPlan(null);
    setFilters({
      ledger: initialFilter("ledger"),
      review: initialFilter("review"),
      issues: initialFilter("issues"),
      archive: initialFilter("archive"),
    });
  }, [projectId]);
  useEffect(() => {
    if (!active) {
      setDetail(null);
      setOutputPlan(null);
    }
  }, [active]);
  useEffect(() => {
    setDetail(null);
    setOutputPlan(null);
  }, [input]);
  const patchFilter = (patch: Partial<ConstructionWorkspaceFilter>) =>
    setFilters(current => ({
      ...current,
      [tab]: { ...current[tab], ...patch },
    }));
  const filterText = `${CONSTRUCTION_WORKSPACE_TABS.find(item => item.value === tab)?.label}；日期 ${filter.dateFrom || "不限"} 至 ${filter.dateTo || "不限"}；提交管理员 ${submitters.data?.find(item => String(item.id) === filter.createdBy)?.name || "全部"}；状态 ${filter.status === "all" ? "全部（按栏目范围）" : getBusinessStatusLabel(filter.status)}；问题范围 ${{ all: "全部（按栏目范围）", recorded: "仅有问题/安全记录", quality: "质量/协调问题", safety: "安全记录", unreplied: "未回复", replied: "已有回复" }[filter.issueScope]}；关键词 ${filter.keyword.trim() || "全部"}`;
  function drillReview() {
    setFilters(current => ({
      ...current,
      review: constructionReviewDrillFilter(tab, filter),
    }));
    setTab("review");
  }
  async function outputBatch(
    plan: NonNullable<typeof outputPlan>,
    batch: NonNullable<typeof outputPlan>["batches"][number]
  ) {
    if (
      outputBatchLock.current ||
      !enabled ||
      !(plan.action === "print" ? caps?.canPrint : caps?.canExport) ||
      plan.contextRevision !== outputContext.current.revision
    )
      return;
    outputBatchLock.current = true;
    const contextRevision = plan.contextRevision;
    setOutputBusy(true);
    try {
      const currentManifest = await utils.construction.outputManifest.fetch({
        ...plan.input,
        action: plan.action,
      });
      if (outputContext.current.revision !== contextRevision) {
        toast.info("项目、栏目、筛选或权限已变化，本批输出已取消，请重新生成");
        return;
      }
      assertConstructionOutputSnapshot(plan, currentManifest);
      const request = { ...plan.input, reportIds: batch.ids };
      const fetchedRows =
        plan.action === "print"
          ? await utils.construction.printReports.fetch(request)
          : await utils.construction.exportReports.fetch(request);
      if (outputContext.current.revision !== contextRevision) {
        toast.info(
          "项目、栏目、筛选或权限已变化，本次迟到输出已取消，请在当前范围重新生成"
        );
        return;
      }
      const outputRows = constructionOutputBatchRows(
        fetchedRows,
        batch.ids,
        plan.input.projectId
      );
      const metadata = {
        projectName: plan.projectName,
        filterText: plan.filterText,
        total: plan.total,
        offset: batch.from - 1,
        batchLabel: `第${batch.batch}/${plan.batches.length}批（${batch.from}–${batch.to}）`,
      };
      if (plan.action === "print")
        openA4LandscapePrintDocument({
          title: "施工日报筛选明细表",
          bodyHtml: constructionPrintBody(outputRows, metadata),
        });
      else
        downloadConstructionCsv(
          `施工日报-${plan.input.dateFrom || "不限日期"}-第${batch.batch}批.csv`,
          constructionCsv(outputRows, metadata)
        );
      setOutputPlan(current =>
        current === plan
          ? {
              ...current,
              completed: Array.from(
                new Set([...current.completed, batch.batch])
              ),
            }
          : current
      );
      toast.success(
        plan.action === "print"
          ? `第${batch.batch}批已送交打印，请核对打印对话框是否完成`
          : `第${batch.batch}批已生成下载，共${outputRows.length}份`
      );
    } catch (error) {
      const code =
        (error as { code?: string; data?: { code?: string } } | null)?.data
          ?.code ?? (error as { code?: string } | null)?.code;
      if (code === "CONFLICT" || code === "FORBIDDEN") setOutputPlan(null);
      toast.error(
        getUserFacingErrorMessage(error, "本批输出未生成，请刷新清单后重试")
      );
    } finally {
      outputBatchLock.current = false;
      setOutputBusy(false);
    }
  }
  async function beginOutput(action: "print" | "export") {
    if (
      outputLock.current ||
      outputBatchLock.current ||
      !enabled ||
      !(action === "print" ? caps?.canPrint : caps?.canExport)
    )
      return;
    outputLock.current = true;
    const contextRevision = outputContext.current.revision;
    setOutputPlan(null);
    setOutputBusy(true);
    try {
      const manifest = await utils.construction.outputManifest.fetch({
        ...input,
        action,
      });
      if (outputContext.current.revision !== contextRevision) {
        toast.info(
          "项目、栏目、筛选或权限已变化，本次输出清单已取消，请重新生成"
        );
        return;
      }
      assertConstructionOutputManifest(manifest);
      if (!manifest.total) {
        toast.info("当前筛选暂无可输出的日报");
        return;
      }
      const plan = {
        action,
        total: manifest.total,
        contextRevision,
        input: { ...input },
        filterText,
        projectName,
        batches: manifest.batches.map(batch => ({
          ...batch,
          ids: [...batch.ids],
        })),
        completed: [] as number[],
      };
      if (manifest.total > 250) setOutputPlan(plan);
      else await outputBatch(plan, manifest.batches[0]);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "施工输出清单读取失败，请检查授权后重试"
        )
      );
    } finally {
      outputLock.current = false;
      setOutputBusy(false);
    }
  }
  const selectClass =
    "min-h-10 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-sm";
  function actions(report: ConstructionWorkspaceReport) {
    const permission = constructionRowActions(report.status, {
      canEdit: Boolean(caps?.canEdit),
      canTransition: true,
    });
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setDetail(report)}>
          查看详情 / 照片
        </Button>
        {!mobile && onEdit && permission.edit ? (
          <Button size="sm" variant="outline" onClick={() => onEdit(report)}>
            编辑日报
          </Button>
        ) : null}
        {!mobile && onTransition ? (
          <>
            {permission.submit && caps?.canSubmit ? (
              <Button
                size="sm"
                disabled={transitionPending}
                onClick={() => onTransition(report, "submitted")}
              >
                提交
              </Button>
            ) : null}
            {permission.approve && caps?.canReview ? (
              <>
                <Button
                  size="sm"
                  disabled={transitionPending}
                  onClick={() => onTransition(report, "approved")}
                >
                  审核
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={transitionPending}
                  onClick={() => onTransition(report, "rejected")}
                >
                  退回
                </Button>
              </>
            ) : null}
            {permission.archive && caps?.canArchive ? (
              <Button
                size="sm"
                variant="outline"
                disabled={transitionPending}
                onClick={() => onTransition(report, "locked")}
              >
                归档
              </Button>
            ) : null}
          </>
        ) : null}
        {mobile &&
          renderMobileActions?.(report, {
            canSupervisorReview: Boolean(caps?.canSupervisorReview),
          })}
      </div>
    );
  }
  return (
    <section
      className="w-full min-w-0 space-y-4 [overflow-wrap:anywhere]"
      aria-label="施工四栏目工作区"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            施工日报、现场影像与审核台账
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            按当前栏目读取授权数据。问题视图仅说明原日报记录了问题或安全情况；不猜测整改结论。
          </p>
        </div>
        {onCreate && caps?.canCreate ? (
          <Button disabled={!enabled} onClick={onCreate}>
            新建施工日报
          </Button>
        ) : null}
      </div>
      <BusinessWorkspaceNavigation
        tabs={CONSTRUCTION_WORKSPACE_TABS}
        value={tab}
        onValueChange={setTab}
        label="施工工作区栏目"
      />
      {!projectId ? (
        <p className="rounded-lg border p-4 text-sm">
          请先选择已授权项目，未选择项目不会加载施工记录。
        </p>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <Label htmlFor="construction-date-from">日报开始日期</Label>
                  <Input
                    id="construction-date-from"
                    className="mt-1 min-w-0"
                    type="date"
                    value={filter.dateFrom}
                    max={filter.dateTo || undefined}
                    onChange={event =>
                      patchFilter({ dateFrom: event.target.value })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="construction-date-to">日报结束日期</Label>
                  <Input
                    id="construction-date-to"
                    className="mt-1 min-w-0"
                    type="date"
                    value={filter.dateTo}
                    min={filter.dateFrom || undefined}
                    onChange={event =>
                      patchFilter({ dateTo: event.target.value })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="construction-submitter">提交管理员</Label>
                  <select
                    id="construction-submitter"
                    className={`${selectClass} mt-1`}
                    value={filter.createdBy}
                    onChange={event =>
                      patchFilter({ createdBy: event.target.value })
                    }
                  >
                    <option value="all">全部管理员</option>
                    {submitters.data?.map(item => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  {submitters.isError ? (
                    <p role="alert" className="text-xs">
                      管理员选项读取失败
                    </p>
                  ) : null}
                </div>
                <div>
                  <Label htmlFor="construction-status">日报状态</Label>
                  <select
                    id="construction-status"
                    className={`${selectClass} mt-1`}
                    value={filter.status}
                    disabled={tab === "review" || tab === "archive"}
                    onChange={event =>
                      patchFilter({
                        status: event.target
                          .value as ConstructionWorkspaceFilter["status"],
                      })
                    }
                  >
                    <option value="all">
                      {tab === "review"
                        ? "仅待审核"
                        : tab === "archive"
                          ? "仅已归档"
                          : "全部状态"}
                    </option>
                    {(
                      [
                        "draft",
                        "submitted",
                        "approved",
                        "rejected",
                        "locked",
                      ] as const
                    ).map(status => (
                      <option key={status} value={status}>
                        {getBusinessStatusLabel(status)}
                      </option>
                    ))}
                  </select>
                </div>
                {tab === "issues" || filter.issueScope !== "all" ? (
                  <div>
                    <Label htmlFor="construction-issue-scope">
                      问题视图范围
                    </Label>
                    <select
                      id="construction-issue-scope"
                      className={`${selectClass} mt-1`}
                      value={filter.issueScope}
                      onChange={event =>
                        patchFilter({
                          issueScope: event.target
                            .value as ConstructionWorkspaceFilter["issueScope"],
                        })
                      }
                    >
                      <option value="all">
                        {tab === "issues" ? "全部问题 / 安全记录" : "全部日报"}
                      </option>
                      <option value="recorded">仅有问题 / 安全记录</option>
                      <option value="quality">质量 / 协调问题</option>
                      <option value="safety">安全记录</option>
                      <option value="unreplied">未填写审核回复</option>
                      <option value="replied">已填写审核回复</option>
                    </select>
                  </div>
                ) : null}
                <div>
                  <Label htmlFor="construction-keyword">关键字查询</Label>
                  <Input
                    id="construction-keyword"
                    className="mt-1"
                    value={filter.keyword}
                    maxLength={100}
                    placeholder="作业面、内容、安全、问题或回复"
                    onChange={event =>
                      patchFilter({ keyword: event.target.value })
                    }
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    patchFilter({
                      dateFrom: toChinaDateInput(),
                      dateTo: toChinaDateInput(),
                    })
                  }
                >
                  恢复当天
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => patchFilter({ dateFrom: "", dateTo: "" })}
                >
                  不限日期
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setFilters(current => ({
                      ...current,
                      [tab]: initialFilter(tab),
                    }))
                  }
                >
                  重置本栏筛选
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!enabled || reports.isFetching}
                  onClick={() =>
                    void Promise.all([
                      reports.refetch(),
                      summary.refetch(),
                      submitters.refetch(),
                      capabilities.refetch(),
                    ])
                  }
                >
                  刷新台账
                </Button>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                列表、统计、打印及导出都采用当前栏目的完整服务端筛选；每页条数只改变屏幕，不改变输出范围。
                {tab === "archive" || tab === "review"
                  ? "本栏目默认不限业务日期，避免遗漏历史待办/归档。"
                  : ""}
              </p>
              {filter.dateFrom &&
              filter.dateTo &&
              filter.dateFrom > filter.dateTo ? (
                <p role="alert" className="text-sm text-destructive">
                  开始日期不能晚于结束日期
                </p>
              ) : null}
            </CardContent>
          </Card>
          {capabilities.isError ? (
            <p role="alert" className="rounded border p-3 text-sm">
              操作授权暂无法读取，已隐藏操作入口；请刷新重试。
            </p>
          ) : !mobile && capabilities.data && !capabilities.data.canEdit ? (
            <p className="rounded border bg-muted/30 p-3 text-xs">
              普通管理人员仅可在授权范围内新增和查看。PC
              历史编辑、提交、审核、退回、归档入口仅对符合原权限的超级管理员显示，服务端仍逐次校验。
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">当前筛选日报</p>
                <p className="mt-1 text-xl font-semibold">
                  {summary.data?.total ?? 0}
                </p>
              </CardContent>
            </Card>
            <button
              type="button"
              aria-label="下钻当前筛选待审核日报"
              disabled={
                !enabled || summary.isFetching || !summary.data?.submitted
              }
              onClick={drillReview}
              className="rounded-xl border bg-card p-3 text-left shadow-sm focus-visible:ring-2 focus-visible:ring-ring"
            >
              <p className="text-xs text-muted-foreground">
                待审核日报 · 点击下钻
              </p>
              <p className="mt-1 text-xl font-semibold">
                {summary.data?.submitted ?? 0}
              </p>
            </button>
            <Card>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">已归档 / 已退回</p>
                <p className="mt-1 text-xl font-semibold">
                  {summary.data?.locked ?? 0} / {summary.data?.rejected ?? 0}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">
                  平均申报累计进度
                </p>
                <p className="mt-1 text-xl font-semibold">
                  {summary.data?.averageProgressPercent ?? 0}%
                </p>
                <p className="text-xs text-muted-foreground">
                  平均申报值，非项目实际综合进度
                </p>
              </CardContent>
            </Card>
          </div>
          <div className="flex flex-wrap gap-2">
            {caps?.canPrint ? (
              <Button
                size="sm"
                variant="outline"
                disabled={!enabled || outputBusy || reports.isFetching}
                onClick={() => void beginOutput("print")}
              >
                批量打印当前筛选日报
              </Button>
            ) : null}
            {caps?.canExport ? (
              <Button
                size="sm"
                variant="outline"
                disabled={!enabled || outputBusy || reports.isFetching}
                onClick={() => void beginOutput("export")}
              >
                导出当前筛选 CSV
              </Button>
            ) : null}
            {outputBusy ? (
              <span role="status" className="text-sm">
                正在读取受控输出…
              </span>
            ) : null}
          </div>
          {reports.isError || summary.isError ? (
            <div role="alert" className="rounded border p-4 text-sm">
              施工数据读取失败，不能视为空台账。请确认授权后点击“刷新台账”。
            </div>
          ) : reports.isFetching || summary.isFetching ? (
            <p role="status" className="rounded border p-4 text-sm">
              正在读取当前栏目真实施工日报…
            </p>
          ) : enabled && !rows.length ? (
            <p className="rounded border border-dashed p-5 text-sm text-muted-foreground">
              当前筛选暂无施工日报，请调整栏目或筛选。不会生成演示记录。
            </p>
          ) : enabled ? (
            mobile ? (
              <div className="space-y-3">
                {pagination.pageRows.map(report => (
                  <Card key={report.id}>
                    <CardContent className="min-w-0 space-y-3 p-4">
                      <div className="flex flex-wrap justify-between gap-2">
                        <h3 className="whitespace-pre-wrap font-semibold">
                          {formatChinaDate(report.reportDate)} ·{" "}
                          {report.workArea}
                        </h3>
                        <BusinessStatusBadge status={report.status} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {report.createdByName} ·{" "}
                        {CONSTRUCTION_WEATHER[report.weather]} · 累计{" "}
                        {Number(report.progressPercent).toFixed(2)}%
                      </p>
                      <p className="whitespace-pre-wrap text-sm leading-6">
                        {report.workContent}
                      </p>
                      {report.safetyNotes ? (
                        <p className="whitespace-pre-wrap rounded border p-2 text-sm leading-6">
                          安全：{report.safetyNotes}
                        </p>
                      ) : null}
                      {report.issueNotes ? (
                        <p className="whitespace-pre-wrap rounded border p-2 text-sm leading-6">
                          问题：{report.issueNotes}
                        </p>
                      ) : null}
                      {report.reviewReply ? (
                        <p className="whitespace-pre-wrap rounded border p-2 text-sm leading-6">
                          主管回复：{report.reviewReply}
                        </p>
                      ) : null}
                      {actions(report)}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="w-full min-w-0 overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[860px] text-left text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      {[
                        "日期 / 提交人",
                        "作业面 / 天气",
                        "累计进度",
                        "状态 / 问题",
                        "操作",
                      ].map(label => (
                        <th key={label} className="p-3 font-medium">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagination.pageRows.map(report => (
                      <tr key={report.id} className="border-t align-top">
                        <td className="p-3">
                          {formatChinaDate(report.reportDate)}
                          <p className="mt-1 text-xs text-muted-foreground">
                            {report.createdByName}
                          </p>
                        </td>
                        <td className="max-w-[280px] p-3">
                          <p className="whitespace-pre-wrap">
                            {report.workArea}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {CONSTRUCTION_WEATHER[report.weather]}
                          </p>
                        </td>
                        <td className="p-3 tabular-nums">
                          {Number(report.progressPercent).toFixed(2)}%
                        </td>
                        <td className="p-3">
                          <BusinessStatusBadge status={report.status} />
                          <p className="mt-1 text-xs text-muted-foreground">
                            {report.issueNotes?.trim() ||
                            report.safetyNotes?.trim()
                              ? report.reviewReply?.trim()
                                ? "有记录 · 已回复"
                                : "有记录 · 未回复"
                              : "未记录问题"}
                          </p>
                        </td>
                        <td className="p-3">{actions(report)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
          <FinancePagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
            label="施工日报"
          />
        </>
      )}
      <Dialog
        open={active && Boolean(detail) && detail?.projectId === projectId}
        onOpenChange={open => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent className="max-h-[92dvh] w-[calc(100vw-2rem)] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>施工日报详情</DialogTitle>
            <DialogDescription>
              只读集中查看日报、审核人及时间、完整问题与回复、关联照片；详情不授予编辑或审核权限。
            </DialogDescription>
          </DialogHeader>
          {detail && detail.projectId === projectId ? (
            <ConstructionReportDetail report={detail} active={active} />
          ) : null}
          <DialogFooter>
            <Button onClick={() => setDetail(null)}>关闭详情</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={active && Boolean(outputPlan)}
        onOpenChange={open => {
          if (!open && !outputBusy) setOutputPlan(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              施工日报受控分批{outputPlan?.action === "print" ? "打印" : "导出"}
            </DialogTitle>
            <DialogDescription>
              全部筛选超过250份，已生成覆盖全部记录的清单。请逐批操作；未生成的批次不会标记完成。打印“已送交”仅说明打开打印对话框，请核对是否实际完成。可重复输出或关闭后重新生成清单。
            </DialogDescription>
          </DialogHeader>
          {outputPlan ? (
            <div className="space-y-3">
              <p className="text-sm">
                全筛选 {outputPlan.total} 份 / {outputPlan.batches.length}{" "}
                批；已生成 {outputPlan.completed.length} 批。
              </p>
              <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                {outputPlan.filterText}
              </p>
              {outputPlan.batches.map(batch => (
                <div
                  key={batch.batch}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"
                >
                  <p className="text-sm">
                    第 {batch.batch} 批 · 第 {batch.from}–{batch.to} 份（
                    {batch.ids.length} 份）
                    {outputPlan.completed.includes(batch.batch)
                      ? " · 已生成"
                      : " · 未生成"}
                  </p>
                  <Button
                    size="sm"
                    disabled={outputBusy}
                    onClick={() => void outputBatch(outputPlan, batch)}
                  >
                    {outputPlan.action === "print" ? "打印" : "导出"}第{" "}
                    {batch.batch} 批
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={outputBusy}
              onClick={() => setOutputPlan(null)}
            >
              关闭清单
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
