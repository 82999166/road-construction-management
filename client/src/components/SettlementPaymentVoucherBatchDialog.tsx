import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { escapePrintHtml, openA4PrintDocument } from "@/lib/a4Print";
import { Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type VoucherRecord = {
  id: number;
  voucherNo: string;
  settlementTypeLabel: string;
  settlementNo: string;
  periodLabel: string;
  direction: "expense" | "income";
  status: "active" | "reversed";
  amount: number;
  paymentDate: string;
  paymentMethodLabel: string;
  payeeName: string;
  operatorName: string;
  proof: { evidenceId: number; fileName: string; mimeType: string; sha256Prefix: string } | null;
  reconciliationStatus: "matched" | "missing" | "inconsistent";
};
const money = (value: number) => `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * 财务真实凭证批打：默认只输出已选且处于当前服务器筛选范围的付款记录。
 * 不输出完整银行卡、支付参考号、签名URL或存储键；原始凭证仅以文件名/哈希摘要留痕。
 */
export function SettlementPaymentVoucherBatchDialog({ open, onOpenChange, records, projectLabel, period }: { open: boolean; onOpenChange: (open: boolean) => void; records: VoucherRecord[]; projectLabel: string; period: string }) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  useEffect(() => {
    if (open) setSelectedIds(records.filter(item => item.status === "active").map(item => item.id));
  }, [open, records]);
  const activeRecords = useMemo(() => records.filter(item => item.status === "active"), [records]);
  const selected = useMemo(() => activeRecords.filter(item => selectedIds.includes(item.id)), [activeRecords, selectedIds]);
  const toggleAll = (checked: boolean) => setSelectedIds(checked ? activeRecords.map(item => item.id) : []);
  const print = () => {
    if (!selected.length) return;
    const pages = selected.map((record, index) => `<section class="voucher-page"><h1>结算实际${record.direction === "income" ? "补款" : "付款"}凭证</h1><p class="sub">项目：${escapePrintHtml(projectLabel)}　|　会计期间：${escapePrintHtml(period)}　|　第 ${index + 1} / ${selected.length} 笔</p><hr class="rule"><div class="voucher-grid"><div class="voucher-label">凭证编号</div><div>${escapePrintHtml(record.voucherNo)}</div><div class="voucher-label">业务类型</div><div>${escapePrintHtml(record.settlementTypeLabel)}</div><div class="voucher-label">结算单号</div><div>${escapePrintHtml(record.settlementNo)}</div><div class="voucher-label">业务归属</div><div>${escapePrintHtml(record.periodLabel)}</div><div class="voucher-label">收付方向</div><div>${record.direction === "income" ? "收取补款（收入）" : "实际付款（支出）"}</div><div class="voucher-label">本次金额</div><div><b>${escapePrintHtml(money(record.amount))}</b></div><div class="voucher-label">收付日期</div><div>${escapePrintHtml(record.paymentDate)}</div><div class="voucher-label">收款人 / 补款人</div><div>${escapePrintHtml(record.payeeName)}</div><div class="voucher-label">收付方式</div><div>${escapePrintHtml(record.paymentMethodLabel)}</div><div class="voucher-label">凭证文件</div><div>${record.proof ? `${escapePrintHtml(record.proof.fileName)}（证据 #${record.proof.evidenceId}；摘要 ${escapePrintHtml(record.proof.sha256Prefix || "—")}）` : "未关联凭证"}</div><div class="voucher-label">账内核对</div><div>${record.reconciliationStatus === "matched" ? "已匹配资金流水" : record.reconciliationStatus === "missing" ? "待核对：未匹配资金流水" : "待核对：金额或方向不一致"}</div><div class="voucher-label">状态</div><div>${record.status === "active" ? "有效" : "已冲正"}</div><div class="voucher-label">经办人</div><div>${escapePrintHtml(record.operatorName)}</div></div><div class="signature-line"><span>制单：________________</span><span>复核：________________</span><span>出纳：________________</span></div></section>`).join("");
    openA4PrintDocument({ title: `付款凭证批打-${period}`, bodyHtml: pages, orientation: "portrait" });
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl xl:max-w-5xl"><DialogHeader><DialogTitle>付款凭证批量打印</DialogTitle><DialogDescription>仅打印当前月度筛选中的有效实际收付记录，一笔一页 A4 纵向。账户、支付参考号和凭证链接默认不打印。</DialogDescription></DialogHeader><div className="rounded-xl border border-[#d8e3e0]"><div className="flex items-center justify-between gap-3 border-b bg-[#f8fcfb] px-3 py-2 text-sm"><label className="flex items-center gap-2"><Checkbox checked={activeRecords.length > 0 && selectedIds.length === activeRecords.length} onCheckedChange={value => toggleAll(value === true)} />全选有效记录（{activeRecords.length} 笔）</label><span className="text-slate-500">已选 {selected.length} 笔</span></div><div className="divide-y">{records.length ? records.map(record => <label key={record.id} className="flex cursor-pointer items-start gap-3 px-3 py-3 text-sm hover:bg-slate-50"><Checkbox checked={selectedIds.includes(record.id)} disabled={record.status !== "active"} onCheckedChange={value => setSelectedIds(current => value === true ? current.includes(record.id) ? current : current.concat(record.id) : current.filter(id => id !== record.id))} /><span className="min-w-0 flex-1"><b>{record.voucherNo}</b><span className="ml-2 text-slate-500">{record.settlementTypeLabel} · {record.settlementNo}</span><span className="mt-1 block text-xs text-slate-500">{record.paymentDate} · {record.payeeName} · {record.paymentMethodLabel} · {record.status === "active" ? money(record.amount) : "已冲正"}</span></span></label>) : <p className="p-6 text-center text-sm text-slate-500">当前筛选无可打印的付款凭证。</p>}</div></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button><Button disabled={!selected.length} onClick={print}><Printer className="mr-1.5 h-4 w-4" />打印 / 保存 PDF（{selected.length} 笔）</Button></DialogFooter></DialogContent></Dialog>;
}
