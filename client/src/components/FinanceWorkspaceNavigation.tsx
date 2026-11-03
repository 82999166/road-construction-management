import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  clampFinancePage,
  FINANCE_PAGE_SIZES,
  getFinancePageCount,
  normalizeFinancePageSize,
  paginateFinanceRows,
} from "@/lib/financePagination";

export type FinanceWorkspaceTab =
  | "overview"
  | "ledger"
  | "settlements"
  | "costs"
  | "invoices"
  | "closing"
  | "tax";

export const FINANCE_WORKSPACE_TABS = [
  { value: "overview", label: "财务总览" },
  { value: "ledger", label: "收支账本" },
  { value: "settlements", label: "结算收付" },
  { value: "costs", label: "成本分析" },
  { value: "invoices", label: "发票管理" },
  { value: "closing", label: "日结对账" },
  { value: "tax", label: "财税交接" },
] as const satisfies readonly { value: FinanceWorkspaceTab; label: string }[];

export interface FinanceWorkspaceNavigationProps {
  value: FinanceWorkspaceTab;
  onValueChange: (value: FinanceWorkspaceTab) => void;
  disabled?: boolean;
  badges?: Partial<Record<FinanceWorkspaceTab, number | string>>;
}

/** Seven equal desktop columns; narrow screens wrap instead of horizontal scrolling. */
export function FinanceWorkspaceNavigation({
  value,
  onValueChange,
  disabled = false,
  badges,
}: FinanceWorkspaceNavigationProps) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) {
    if (disabled) return;
    const last = FINANCE_WORKSPACE_TABS.length - 1;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (index + 1) % (last + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (index + last) % (last + 1);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    buttons.current[next]?.focus({ preventScroll: true });
    onValueChange(FINANCE_WORKSPACE_TABS[next].value);
  }

  return (
    <div
      role="tablist"
      aria-label="财务工作区栏目"
      aria-orientation="horizontal"
      aria-disabled={disabled || undefined}
      className="grid w-full min-w-0 grid-cols-2 gap-1.5 rounded-xl border border-border bg-muted/40 p-1.5 text-foreground sm:grid-cols-4 lg:grid-cols-7"
    >
      {FINANCE_WORKSPACE_TABS.map((tab, index) => {
        const selected = tab.value === value;
        const badge = badges?.[tab.value];
        return (
          <button
            key={tab.value}
            ref={element => {
              buttons.current[index] = element;
            }}
            id={`${id}-${tab.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={badge == null ? tab.label : `${tab.label}，${badge}`}
            tabIndex={selected && !disabled ? 0 : -1}
            disabled={disabled}
            onClick={() => onValueChange(tab.value)}
            onKeyDown={event => handleKeyDown(event, index)}
            className={`flex min-h-11 min-w-0 flex-wrap items-center justify-center gap-x-1.5 gap-y-1 rounded-lg border px-2 py-2 text-[0.9em] font-medium leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none ${
              selected
                ? "border-primary/25 bg-background text-primary shadow-sm"
                : "border-transparent text-muted-foreground hover:bg-background/70 hover:text-foreground"
            }`}
          >
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
              {tab.label}
            </span>
            {badge != null && (
              <span
                aria-hidden="true"
                className="min-w-0 max-w-full break-words rounded-md bg-muted px-1.5 py-0.5 text-[0.85em] tabular-nums text-foreground [overflow-wrap:anywhere]"
              >
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const useBrowserLayoutEffect =
  typeof document === "undefined" ? useEffect : useLayoutEffect;

export interface FinanceRetainedPanelProps {
  active: boolean;
  children: ReactNode;
  label?: string;
}

/**
 * Mount on the very first active render, then preserve drafts while hidden + inert.
 * Callers must still pass active to each child's query `enabled` option.
 */
export function FinanceRetainedPanel({
  active,
  children,
  label = "财务工作区内容",
}: FinanceRetainedPanelProps) {
  const [hasMounted, setHasMounted] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useBrowserLayoutEffect(() => {
    if (active) {
      setHasMounted(true);
      return;
    }
    // Hidden descendants must never keep keyboard focus when their tab closes.
    const focused = panel.current?.ownerDocument.activeElement;
    if (focused && panel.current?.contains(focused) && "blur" in focused) {
      (focused as HTMLElement).blur();
    }
  }, [active]);

  if (!active && !hasMounted) return null;

  return (
    <div
      ref={panel}
      role="tabpanel"
      aria-label={label}
      aria-hidden={!active}
      hidden={!active}
      inert={!active}
      className="w-full min-w-0"
    >
      {children}
    </div>
  );
}

export interface FinancePaginationResult<T> {
  page: number;
  pageSize: number;
  pageRows: T[];
  total: number;
  pageCount: number;
  setPage: Dispatch<SetStateAction<number>>;
  setPageSize: Dispatch<SetStateAction<number>>;
}

/**
 * resetKey should be a stable primitive (e.g. JSON.stringify([projectId, period, filters])).
 * pageRows is only for list rendering; summaries and exports must keep using all rows.
 */
export function useFinancePagination<T>(
  rows: readonly T[],
  resetKey: unknown,
  initialPageSize = 20
): FinancePaginationResult<T> {
  const [state, setState] = useState(() => ({
    page: 1,
    pageSize: normalizeFinancePageSize(initialPageSize),
    resetKey,
  }));
  const keyChanged = !Object.is(state.resetKey, resetKey);
  const result = useMemo(
    () =>
      paginateFinanceRows(rows, keyChanged ? 1 : state.page, state.pageSize),
    [rows, keyChanged, state.page, state.pageSize]
  );

  // Derive a safe page synchronously (no empty first frame), then reconcile state.
  useEffect(() => {
    setState(previous => {
      const page = Object.is(previous.resetKey, resetKey)
        ? clampFinancePage(
            previous.page,
            getFinancePageCount(rows.length, previous.pageSize)
          )
        : 1;
      return page === previous.page && Object.is(previous.resetKey, resetKey)
        ? previous
        : { ...previous, page, resetKey };
    });
  }, [resetKey, rows.length]);

  const setPage = useCallback<Dispatch<SetStateAction<number>>>(
    next => {
      setState(previous => {
        const currentPage = Object.is(previous.resetKey, resetKey)
          ? clampFinancePage(
              previous.page,
              getFinancePageCount(rows.length, previous.pageSize)
            )
          : 1;
        const requested = typeof next === "function" ? next(currentPage) : next;
        return {
          ...previous,
          resetKey,
          page: clampFinancePage(
            requested,
            getFinancePageCount(rows.length, previous.pageSize)
          ),
        };
      });
    },
    [resetKey, rows.length]
  );

  const setPageSize = useCallback<Dispatch<SetStateAction<number>>>(
    next => {
      setState(previous => ({
        resetKey,
        page: 1,
        pageSize: normalizeFinancePageSize(
          typeof next === "function" ? next(previous.pageSize) : next
        ),
      }));
    },
    [resetKey]
  );

  return { ...result, setPage, setPageSize };
}

export interface FinancePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  label?: string;
}

export function FinancePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  label = "财务明细",
}: FinancePaginationProps) {
  const selectId = useId();
  const size = normalizeFinancePageSize(pageSize);
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const pageCount = getFinancePageCount(safeTotal, size);
  const current = clampFinancePage(page, pageCount);
  const first = safeTotal === 0 ? 0 : (current - 1) * size + 1;
  const last = Math.min(current * size, safeTotal);
  const buttonClass =
    "min-h-10 min-w-0 max-w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[0.9em] leading-snug text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed [overflow-wrap:anywhere]";

  return (
    <nav
      aria-label={`${label}分页`}
      className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-border pt-3 text-[0.95em] text-foreground"
    >
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="min-w-0 break-words text-muted-foreground [overflow-wrap:anywhere]"
      >
        共 {safeTotal.toLocaleString("zh-CN")} 条 · 当前{" "}
        {first.toLocaleString("zh-CN")}–{last.toLocaleString("zh-CN")} 条
      </p>
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
        <label
          htmlFor={selectId}
          className="flex min-w-0 flex-wrap items-center gap-1.5"
        >
          <span>每页</span>
          <select
            id={selectId}
            aria-label={`${label}每页条数`}
            value={size}
            onChange={event =>
              onPageSizeChange(
                normalizeFinancePageSize(Number(event.target.value))
              )
            }
            className="min-h-10 max-w-full rounded-md border border-border bg-background px-2 py-1.5 text-[1em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {FINANCE_PAGE_SIZES.map(option => (
              <option key={option} value={option}>
                {option} 条
              </option>
            ))}
          </select>
        </label>
        <div
          role="group"
          aria-label={`${label}页码导航`}
          className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5"
        >
          <button
            type="button"
            className={buttonClass}
            disabled={current === 1}
            onClick={() => onPageChange(1)}
          >
            首页
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={current === 1}
            onClick={() => onPageChange(current - 1)}
          >
            上一页
          </button>
          <span
            aria-current="page"
            className="min-w-0 break-words px-1 tabular-nums [overflow-wrap:anywhere]"
          >
            第 {current} / {pageCount} 页
          </span>
          <button
            type="button"
            className={buttonClass}
            disabled={current === pageCount}
            onClick={() => onPageChange(current + 1)}
          >
            下一页
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={current === pageCount}
            onClick={() => onPageChange(pageCount)}
          >
            末页
          </button>
        </div>
      </div>
    </nav>
  );
}
