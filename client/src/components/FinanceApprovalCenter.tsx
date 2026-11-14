import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { CircleHelp, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FinancePagination,
  useFinancePagination,
} from "@/components/FinanceWorkspaceNavigation";
import { formatChinaDate, formatChinaDateTime } from "@/lib/businessTime";
import { formatAmount } from "@shared/numberFormat";

/** A server-authorized, project-scoped snapshot. Never contains payment credentials. */
export type FinanceApprovalItem = {
  sourceType: "transport_vehicle" | "machine" | "payroll" | "daily_wage" | "subcontract";
  settlementId: number;
  settlementNo: string;
  sourceLabel: string;
  counterpartyDisplay: string;
  periodLabel: string;
  businessStatus: string;
  grossAmount: number;
  deductionAmount: number;
  netAmount: number;
  submittedAt?: string | null;
  canApprove: boolean;
  fingerprint: string;
};

export type FinanceApprovalCenterProps = {
  items: FinanceApprovalItem[];
  active: boolean;
  loading: boolean;
  fetching: boolean;
  error?: string | null;
  onRefresh: () => void;
  onApprove: (item: FinanceApprovalItem) => Promise<void>;
  pending: boolean;
  projectLabel: string;
  scopeKey: string;
  /** Notify the parent about approval details only, not the help dialog. */
  onOpenChange?: (open: boolean) => void;
  /** Optional parent-owned desktop business-ledger navigation; no mobile routes here. */
  onNavigateToSource?: (item: FinanceApprovalItem) => void;
};

const SOURCE_TABS = [
  { value: "all", label: "全部" },
  { value: "transport_vehicle", label: "车辆运费" },
  { value: "machine", label: "机械结算" },
  { value: "payroll", label: "人员工资" },
  { value: "daily_wage", label: "临时日结" },
  { value: "subcontract", label: "分包结算" },
] as const;
type SourceFilter = (typeof SOURCE_TABS)[number]["value"];

// These are the existing business modules' submitted-awaiting-review statuses.
// Eligibility and project/permission/fingerprint checks remain authoritative on the server.
const awaitingReview = (item: FinanceApprovalItem) =>
  item.businessStatus === "submitted" || item.businessStatus === "reviewing";
const sourceLabel = (item: FinanceApprovalItem) =>
  SOURCE_TABS.find(tab => tab.value === item.sourceType)?.label ?? item.sourceLabel;
const statusLabel = (item: FinanceApprovalItem) =>
  item.businessStatus === "submitted" ? "已提交待审" : "审核中（待财务审核）";
const money = (amount: number) =>
  Number.isFinite(amount)
    ? `¥${formatAmount(amount)}`
    : "—";
const amountNote = (amount: number) =>
  amount < 0 ? "待收补款" : amount === 0 ? "无现金收付" : "待付金额（审核不等于付款）";
const hasValidAmounts = (item: FinanceApprovalItem) =>
  [item.grossAmount, item.deductionAmount, item.netAmount].every(Number.isFinite);

type Selection = {
  item: FinanceApprovalItem;
  items: FinanceApprovalItem[];
  scopeKey: string;
};

/** Presentational approval only: data, permissions, mutation and refresh belong to the parent. */
export function FinanceApprovalCenter(props: FinanceApprovalCenterProps) {
  const {
    items, active, loading, fetching, error, onRefresh, pending, projectLabel, scopeKey,
    onNavigateToSource,
  } = props;
  const [source, setSource] = useState<SourceFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const confirmationId = useId();
  const searchId = useId();
  const inFlight = useRef<Selection | null>(null);
  const mounted = useRef(true);
  const notifiedOpen = useRef(false);

  // Invalidate synchronously, before effects commit: never render or approve a stale snapshot.
  const selected = selection?.items === items && selection.scopeKey === scopeKey
    ? selection : null;
  const live = useRef({ props, selected, confirmed });
  live.current = { props, selected, confirmed };
  const busy = pending || submitting;
  const reviewBlocked = !active || loading || fetching || Boolean(error) || busy;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (notifiedOpen.current) {
        notifiedOpen.current = false;
        live.current.props.onOpenChange?.(false);
      }
    };
  }, []);
  const detailsOpen = Boolean(selected) && active;
  useEffect(() => {
    if (notifiedOpen.current === detailsOpen) return;
    notifiedOpen.current = detailsOpen;
    live.current.props.onOpenChange?.(detailsOpen);
  }, [detailsOpen]);
  useEffect(() => {
    setSelection(null);
    setConfirmed(false);
    setApprovalError(null);
    setRefreshError(false);
  }, [items, scopeKey]);
  useEffect(() => {
    setSource("all");
    setKeyword("");
    setHelpOpen(false);
  }, [scopeKey]);

  const awaitingItems = useMemo(() => items.filter(awaitingReview), [items]);
  const filteredItems = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase("zh-CN");
    return awaitingItems.filter(item =>
      (source === "all" || item.sourceType === source) &&
      (!query || [item.settlementNo, item.counterpartyDisplay, item.periodLabel,
        item.sourceLabel, sourceLabel(item), statusLabel(item)]
        .join(" ").toLocaleLowerCase("zh-CN").includes(query))
    );
  }, [awaitingItems, source, keyword]);
  const pagination = useFinancePagination(
    filteredItems, JSON.stringify([scopeKey, source, keyword.trim()])
  );

  function openDetail(item: FinanceApprovalItem) {
    const current = live.current.props;
    if (!current.active || current.loading || current.pending || inFlight.current ||
      !current.items.includes(item) || !awaitingReview(item)) return;
    setSelection({ item, items: current.items, scopeKey: current.scopeKey });
    setConfirmed(false);
    setApprovalError(null);
  }
  function closeDetail() {
    if (live.current.props.pending || inFlight.current) return;
    setSelection(null);
    setConfirmed(false);
    setApprovalError(null);
  }
  function refresh() {
    const current = live.current.props;
    if (!current.active || current.loading || current.fetching || current.pending || inFlight.current) return;
    setRefreshError(false);
    try { current.onRefresh(); } catch { setRefreshError(true); }
  }
  async function approveSelected() {
    // Check live props as well as a synchronous lock: disabled UI is not authorization.
    const current = live.current;
    const snapshot = current.selected;
    const currentProps = current.props;
    if (!snapshot || !current.confirmed || !currentProps.active || currentProps.loading ||
      currentProps.fetching || currentProps.error || currentProps.pending || inFlight.current ||
      !snapshot.item.canApprove || !awaitingReview(snapshot.item) ||
      !hasValidAmounts(snapshot.item) || !currentProps.items.includes(snapshot.item)) return;
    inFlight.current = snapshot;
    setSubmitting(true);
    setApprovalError(null);
    let approved = false;
    try {
      // Preserve the exact item, including source identity and server fingerprint.
      await currentProps.onApprove(snapshot.item);
      approved = true;
    } catch {
      if (mounted.current && live.current.selected === snapshot) {
        // Do not display arbitrary backend errors, account information or credentials.
        setApprovalError("财务审核未完成，请核对当前结算记录与权限后重试；如数据已变化，请刷新后重新逐单核对。");
      }
    } finally {
      inFlight.current = null;
      if (mounted.current) setSubmitting(false);
    }
    if (!approved || !mounted.current) return;
    const latest = live.current;
    const sameScope = latest.props.scopeKey === snapshot.scopeKey;
    if (latest.selected === snapshot) {
      setSelection(null);
      setConfirmed(false);
      setApprovalError(null);
    }
    // Never refresh a new project's callback after an old project's mutation completes.
    if (sameScope) {
      try { latest.props.onRefresh(); } catch { setRefreshError(true); }
    }
  }

  return (
    <section aria-label="财务审核中心" className="min-w-0 rounded-xl border border-[#d8e3e0] bg-white text-slate-800">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1e8e4] px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck aria-hidden="true" className="h-4 w-4 text-[#3e746a]" />
            <h2 className="text-base font-semibold text-[#203c48]">财务审核中心</h2>
            <span role="status" aria-live="polite" className="rounded-md bg-red-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-red-700">
              待审核 {loading ? "—" : awaitingItems.length} 条
            </span>
          </div>
          <p className="mt-1 break-words text-xs text-slate-500">{projectLabel} · 仅已提交待审结算，审核不等于付款</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={refresh} disabled={!active || loading || fetching || busy}>
            <RefreshCw aria-hidden="true" className={`mr-1 h-3.5 w-3.5 ${fetching ? "animate-spin" : ""}`} />
            {fetching ? "刷新中" : "刷新"}
          </Button>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-slate-500" aria-label="财务审核帮助" disabled={!active || busy} onClick={() => { if (live.current.props.active && !live.current.props.pending && !inFlight.current) setHelpOpen(true); }}>
            <CircleHelp aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="space-y-3 p-4">
        {Boolean(error) && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">待审记录加载失败，当前记录仅供查看，暂不能审核。请刷新后重新核对。</p>}
        {refreshError && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">列表刷新未完成，请点击刷新核对最新审核状态，勿重复审核。</p>}
        {fetching && !loading && <p role="status" className="text-xs text-slate-500">正在更新待审记录，更新完成前暂停审核提交。</p>}
        <div role="group" aria-label="待审结算类型" className="grid grid-cols-2 gap-1.5 rounded-lg border border-[#e1e8e4] bg-[#f3f6f4] p-1.5 sm:grid-cols-3 xl:grid-cols-6">
          {SOURCE_TABS.map(tab => {
            const count = tab.value === "all" ? awaitingItems.length : awaitingItems.filter(item => item.sourceType === tab.value).length;
            return <button key={tab.value} type="button" aria-pressed={source === tab.value} aria-label={`${tab.label}，待审 ${count} 条`} disabled={!active || busy} onClick={() => { if (live.current.props.active && !live.current.props.pending && !inFlight.current) setSource(tab.value); }} className={`flex min-h-9 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3e746a] disabled:opacity-60 ${source === tab.value ? "border-[#3e746a]/30 bg-white text-[#315f57] shadow-sm" : "border-transparent text-slate-600 hover:bg-white/80"}`}>
              <span>{tab.label}</span><span className="rounded bg-red-50 px-1.5 py-0.5 tabular-nums text-red-700">{loading ? "—" : count}</span>
            </button>;
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="w-full sm:max-w-sm">
            <label htmlFor={searchId} className="sr-only">检索待审结算</label>
            <Input id={searchId} aria-label="检索待审结算" value={keyword} disabled={!active || busy} onChange={event => setKeyword(event.target.value)} placeholder="搜索单号、对象、期间或结算类型" className="h-9 text-sm" />
          </div>
          <p className="text-xs text-slate-500">当前筛选待审 {filteredItems.length} 条 · 分类数量不受关键词影响</p>
        </div>
        <div aria-busy={loading || fetching} className="overflow-x-auto rounded-lg border border-[#e1e8e4]">
          <table className="w-full min-w-[960px] text-left text-xs">
            <caption className="sr-only">当前筛选的已提交待审结算；净额为负数表示待收补款</caption>
            <thead className="bg-[#edf1ed] text-slate-600"><tr>
              <th scope="col" className="px-3 py-2.5 font-medium">单号 / 类型</th>
              <th scope="col" className="px-3 py-2.5 font-medium">对象 / 业务期间</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">运费 / 应付基数</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">扣款</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">净额</th>
              <th scope="col" className="px-3 py-2.5 font-medium">提交日期</th>
              <th scope="col" className="px-3 py-2.5 font-medium">状态</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">操作</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={8} className="p-8 text-center text-slate-500">正在加载待审结算…</td></tr> : pagination.pageRows.length ? pagination.pageRows.map(item => <tr key={`${item.sourceType}:${item.settlementId}`} data-finance-settlement={`${item.sourceType}:${item.settlementId}`} className="border-t border-[#e1e8e4] hover:bg-[#f7f9f8]">
                <td className="px-3 py-3"><p className="max-w-52 break-words font-medium">{item.settlementNo}</p><p className="mt-1 text-slate-500">{sourceLabel(item)}</p></td>
                <td className="px-3 py-3"><p className="max-w-56 break-words font-medium">{item.counterpartyDisplay || "—"}</p><p className="mt-1 text-slate-500">{item.periodLabel || "—"}</p></td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{money(item.grossAmount)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{money(item.deductionAmount)}</td>
                <td className="px-3 py-3 text-right"><p className={`whitespace-nowrap font-semibold tabular-nums ${item.netAmount < 0 ? "text-amber-700" : "text-[#315f57]"}`}>{money(item.netAmount)}</p>{item.netAmount <= 0 && <p className="mt-1 whitespace-nowrap text-slate-500">{amountNote(item.netAmount)}</p>}</td>
                <td className="whitespace-nowrap px-3 py-3">{formatChinaDate(item.submittedAt, "未提供")}</td>
                <td className="px-3 py-3"><span className="inline-block whitespace-nowrap rounded bg-amber-50 px-2 py-1 text-amber-800">{statusLabel(item)}</span>{!item.canApprove && <p className="mt-1 text-slate-500">只读</p>}</td>
                <td className="px-3 py-3 text-right"><Button type="button" size="sm" variant="outline" className="h-8 whitespace-nowrap border-[#3e746a]/30 text-[#315f57]" disabled={!active || busy} onClick={() => openDetail(item)}>{item.canApprove ? "查看并审核" : "查看详情"}</Button></td>
              </tr>) : <tr><td colSpan={8} className="p-8 text-center text-slate-500">{error ? "暂无法获取待审结算，请刷新重试。" : keyword.trim() || source !== "all" ? "当前筛选条件下没有待审结算。" : "暂无已提交待审结算，草稿不计入待审数量。"}</td></tr>}
            </tbody>
          </table>
        </div>
        <FinancePagination {...pagination} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} label="财务待审结算" />
      </div>

      <Dialog open={detailsOpen} onOpenChange={open => { if (!open) closeDetail(); }}>
        <DialogContent className="sm:max-w-2xl xl:max-w-2xl 2xl:max-w-2xl" showCloseButton={!busy} onEscapeKeyDown={event => { if (live.current.props.pending || inFlight.current) event.preventDefault(); }} onInteractOutside={event => { if (live.current.props.pending || inFlight.current) event.preventDefault(); }}>
          {selected && <>
            <DialogHeader>
              <DialogTitle>结算详情 · {selected.item.settlementNo}</DialogTitle>
              <DialogDescription>请逐单核对结算依据、扣款与净额。本次操作仅审核，不执行付款或草稿提交。</DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-1 gap-x-5 gap-y-3 rounded-lg border border-[#e1e8e4] bg-[#f7f9f8] p-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">项目范围</dt><dd className="mt-1 break-words font-medium">{projectLabel}</dd></div>
              <div><dt className="text-xs text-slate-500">结算类型</dt><dd className="mt-1">{sourceLabel(selected.item)}</dd></div>
              <div><dt className="text-xs text-slate-500">来源业务台账</dt><dd className="mt-1 break-words">{selected.item.sourceLabel}</dd></div>
              <div><dt className="text-xs text-slate-500">源结算编号 / ID</dt><dd className="mt-1 break-words">{selected.item.settlementNo} / {selected.item.settlementId}</dd></div>
              <div><dt className="text-xs text-slate-500">结算对象</dt><dd className="mt-1 break-words font-medium">{selected.item.counterpartyDisplay || "—"}</dd></div>
              <div><dt className="text-xs text-slate-500">业务期间</dt><dd className="mt-1 break-words">{selected.item.periodLabel || "—"}</dd></div>
              <div><dt className="text-xs text-slate-500">业务状态</dt><dd className="mt-1">{statusLabel(selected.item)}</dd></div>
              <div><dt className="text-xs text-slate-500">提交时间（北京时间）</dt><dd className="mt-1">{formatChinaDateTime(selected.item.submittedAt, "未提供")}</dd></div>
              <div><dt className="text-xs text-slate-500">{selected.item.sourceType === "transport_vehicle" ? "运费基数" : "应付基数"}</dt><dd className="mt-1 font-medium tabular-nums">{money(selected.item.grossAmount)}</dd></div>
              <div><dt className="text-xs text-slate-500">扣款金额</dt><dd className="mt-1 font-medium tabular-nums">{money(selected.item.deductionAmount)}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-slate-500">净额</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-[#315f57]">{money(selected.item.netAmount)}</dd><p className="mt-1 text-xs text-slate-500">{Number.isFinite(selected.item.netAmount) ? amountNote(selected.item.netAmount) : "金额异常，请刷新核对，不可审核。"}</p></div>
            </dl>
            <p className="text-xs leading-5 text-slate-500">更多原始凭证请到对应业务台账核对；此处不展示或虚构逐条运单明细，也不处理实际资金。</p>
            {!selected.item.canApprove ? <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">当前记录无审批权限，仅可查看详情；如需审核，请联系有权限的财务人员。</p> : <>
              <div className="flex items-start gap-2 rounded-lg border border-[#d8e3e0] p-3">
                <Checkbox id={confirmationId} checked={confirmed} disabled={reviewBlocked || !hasValidAmounts(selected.item)} onCheckedChange={value => { if (!live.current.props.active || live.current.props.loading || live.current.props.fetching || live.current.props.error || live.current.props.pending || inFlight.current) return; setConfirmed(value === true); }} />
                <label htmlFor={confirmationId} className="text-sm leading-5">已核对本次结算依据与金额</label>
              </div>
              {(fetching || Boolean(error) || loading) && <p role="alert" className="text-sm text-amber-800">当前数据尚未确认有效，请等待更新完成或刷新成功后再审核。</p>}
              {!hasValidAmounts(selected.item) && <p role="alert" className="text-sm text-red-700">结算金额异常，暂不能审核，请回业务台账核对。</p>}
            </>}
            {approvalError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{approvalError}</p>}
            <DialogFooter>
              {onNavigateToSource && <Button type="button" variant="outline" disabled={!active || busy} onClick={() => { const current = live.current; if (!current.props.active || current.props.pending || inFlight.current || !current.selected) return; const item = current.selected.item; closeDetail(); current.props.onNavigateToSource?.(item); }}>去业务台账核对</Button>}
              <Button type="button" variant="outline" onClick={closeDetail} disabled={busy}>取消</Button>
              {selected.item.canApprove && <Button type="button" className="bg-[#3e746a] hover:bg-[#315f57]" onClick={approveSelected} disabled={!confirmed || reviewBlocked || !hasValidAmounts(selected.item)}>{busy ? "审核提交中…" : "确认审核通过"}</Button>}
            </DialogFooter>
          </>}
        </DialogContent>
      </Dialog>

      <Dialog open={helpOpen && active} onOpenChange={setHelpOpen}>
        <DialogContent className="sm:max-w-lg xl:max-w-lg 2xl:max-w-lg">
          <DialogHeader><DialogTitle>财务审核帮助</DialogTitle><DialogDescription>待审数量、审核权限与金额含义</DialogDescription></DialogHeader>
          <ul className="space-y-3 text-sm leading-6 text-slate-600">
            <li><strong className="text-slate-800">待审范围：</strong>仅已提交待审的结算计入提醒；人员工资、临时日结的“审核中”也属于待审，草稿不算。</li>
            <li><strong className="text-slate-800">审核不等于付款：</strong>审核通过只确认业务结算，不自动付款、不自动提交草稿，也不进行批量审批。</li>
            <li><strong className="text-slate-800">金额含义：</strong>净额为负数表示待收补款；净额为零表示无现金收付。请结合业务台账核对基数与扣款。</li>
            <li><strong className="text-slate-800">权限与核对：</strong>无审批权限时只读，仍可查看结算详情。请逐单核对原始依据并勾选确认后再提交；数据刷新或项目范围变化后需重新核对。</li>
          </ul>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setHelpOpen(false)}>知道了</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default FinanceApprovalCenter;
