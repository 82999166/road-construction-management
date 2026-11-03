export const FINANCE_PAGE_SIZES = [20, 50, 100] as const;

export function normalizeFinancePageSize(pageSize: number): number {
  return FINANCE_PAGE_SIZES.some(size => size === pageSize) ? pageSize : 20;
}

export function getFinancePageCount(total: number, pageSize: number): number {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  return Math.max(1, Math.ceil(safeTotal / normalizeFinancePageSize(pageSize)));
}

export function clampFinancePage(page: number, pageCount: number): number {
  const lastPage = Number.isFinite(pageCount)
    ? Math.max(1, Math.floor(pageCount))
    : 1;
  if (page === Infinity) return lastPage;
  return Math.min(
    lastPage,
    Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1)
  );
}

/** A display-only slice: never mutate rows or use pageRows for totals/exports. */
export function paginateFinanceRows<T>(
  rows: readonly T[],
  page = 1,
  pageSize = 20
) {
  const size = normalizeFinancePageSize(pageSize);
  const total = rows.length;
  const pageCount = getFinancePageCount(total, size);
  const currentPage = clampFinancePage(page, pageCount);
  const start = (currentPage - 1) * size;
  return {
    page: currentPage,
    pageSize: size,
    pageRows: rows.slice(start, start + size),
    total,
    pageCount,
  };
}
