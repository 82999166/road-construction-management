import { FinancialLedgerPrintPreviewDialog, type FinancialPrintColumn, type FinancialPrintRow } from "@/components/FinancialLedgerPrintPreviewDialog";

export type FinancialPrintBookId = "ledger" | "invoices" | "categories" | "subcategories";
export type FinancialPrintBook = {
  id: FinancialPrintBookId;
  title: string;
  filterLabel: string;
  columns: FinancialPrintColumn[];
  rows: FinancialPrintRow[];
  summaryLabel: string;
};

/** 统一挂载财务各账本的宽屏预览。账本行数据必须来自父页面现有的受控查询与筛选结果。 */
export function FinancialLedgerPrintPreviewDialogs({
  activeBook,
  onActiveBookChange,
  projectName,
  period,
  books,
}: {
  activeBook: FinancialPrintBookId | null;
  onActiveBookChange: (book: FinancialPrintBookId | null) => void;
  projectName: string;
  period: string;
  books: FinancialPrintBook[];
}) {
  return <>{books.map(book => <FinancialLedgerPrintPreviewDialog key={book.id} open={activeBook === book.id} onOpenChange={open => !open && onActiveBookChange(null)} title={book.title} projectName={projectName} period={period} filterLabel={book.filterLabel} columns={book.columns} rows={book.rows} summaryLabel={book.summaryLabel} />)}</>;
}
