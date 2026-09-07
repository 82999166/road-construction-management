import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { FileImage, HelpCircle, Images, Printer, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const FIXED_ROWS = 3;
const MAX_RECORDS = 80;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

type BillImage = { id: string; name: string; source: string; size: number };

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[character] ?? character);
}

export function chunkPaymentBillRecords<T>(records: T[], itemsPerRow: number) {
  const perPage = FIXED_ROWS * itemsPerRow;
  return Array.from({ length: Math.ceil(records.length / perPage) }, (_, index) => records.slice(index * perPage, (index + 1) * perPage));
}

export function PaymentAccountBillPrintDialog({
  open,
  onOpenChange,
  projectName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [records, setRecords] = useState<BillImage[]>([]);
  const [itemsPerRow, setItemsPerRow] = useState(2);
  const [maxHeight, setMaxHeight] = useState(100);
  const [accountType, setAccountType] = useState("微信支付");
  const [accountLabel, setAccountLabel] = useState("");
  const [dragging, setDragging] = useState(false);

  const pages = useMemo(() => chunkPaymentBillRecords(records, itemsPerRow), [records, itemsPerRow]);
  const totalSize = records.reduce((sum, record) => sum + record.size, 0);
  const recordsPerPage = FIXED_ROWS * itemsPerRow;
  const billTitle = accountLabel.trim() ? `${accountType}账单 · ${accountLabel.trim()}` : `${accountType}账单`;

  const importFiles = async (fileList: FileList | File[]) => {
    const candidates = Array.from(fileList).filter(file => file.type.startsWith("image/"));
    if (!candidates.length) {
      toast.error("请选择账单图片文件");
      return;
    }
    const remainingCount = MAX_RECORDS - records.length;
    if (remainingCount <= 0) {
      toast.error(`为保证浏览器打印稳定性，单次会话最多保留 ${MAX_RECORDS} 张账单图片。`);
      return;
    }
    const accepted = candidates.slice(0, remainingCount);
    const addedBytes = accepted.reduce((sum, file) => sum + file.size, 0);
    if (totalSize + addedBytes > MAX_TOTAL_BYTES) {
      toast.error("图片总大小超过 100 MB，请分批打印或先压缩截图。");
      return;
    }
    const loaded = await Promise.allSettled(accepted.map(file => new Promise<BillImage>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === "string" ? resolve({ id: `${Date.now()}-${crypto.randomUUID()}`, name: file.name, source: reader.result, size: file.size }) : reject(new Error("图片读取失败"));
      reader.onerror = () => reject(new Error(`无法读取图片：${file.name}`));
      reader.readAsDataURL(file);
    })));
    const imported = loaded.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
    setRecords(current => [...current, ...imported]);
    const rejected = loaded.length - imported.length;
    toast.success(`已导入 ${imported.length} 张账单图片${rejected ? `，${rejected} 张读取失败` : ""}`);
  };

  const print = () => {
    if (!records.length) {
      toast.error("请先导入至少一张支付账单图片");
      return;
    }
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error("浏览器阻止了打印页，请允许弹出窗口后重试。");
      return;
    }
    const pageHtml = pages.map((page, pageIndex) => `<section class="a4-page"><header class="page-heading"><div><b>${escapeHtml(billTitle)}</b><span>项目：${escapeHtml(projectName)}</span></div><span>第 ${pageIndex + 1} / ${pages.length} 页 · ${FIXED_ROWS} 排 × 每排 ${itemsPerRow} 张</span></header><div class="records-grid" style="grid-template-columns:repeat(${itemsPerRow},minmax(0,1fr));grid-template-rows:repeat(${FIXED_ROWS},minmax(0,1fr));">${page.map((record, index) => `<article class="record-card"><div class="record-title"><span>${escapeHtml(accountType)}账单 ${pageIndex * recordsPerPage + index + 1}</span><small>${escapeHtml(record.name || "已导入图片")}</small></div><div class="image-wrap"><img src="${record.source}" alt="支付账单 ${pageIndex * recordsPerPage + index + 1}" /></div></article>`).join("")}</div></section>`).join("");
    printWindow.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8" /><title>${escapeHtml(billTitle)}批量打印</title><style>*{box-sizing:border-box}html,body{margin:0;background:#f3f5f7;color:#172033;font-family:"Microsoft YaHei","PingFang SC",Arial,sans-serif}.a4-page{display:flex;flex-direction:column;width:210mm;height:297mm;margin:10mm auto;padding:6mm;overflow:hidden;background:#fff;box-shadow:0 6px 22px rgba(28,42,62,.16)}.page-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;height:6mm;margin-bottom:3mm;color:#5c6879;font-size:10px;line-height:1}.page-heading div{display:flex;gap:4mm;align-items:center}.page-heading b{color:#3d495a;font-size:11px}.records-grid{display:grid;flex:1;min-height:0;gap:3mm}.record-card{display:flex;flex-direction:column;min-width:0;min-height:0;padding:3mm;border:1px solid #707b89;background:#fff}.record-title{display:flex;align-items:center;justify-content:space-between;min-height:4mm;gap:8px;padding-bottom:2mm;color:#354154;border-bottom:1px solid #d6dce3;font-size:10px;font-weight:700}.record-title small{overflow:hidden;color:#8490a0;font-size:9px;font-weight:400;text-overflow:ellipsis;white-space:nowrap}.image-wrap{display:flex;flex:1;align-items:center;justify-content:center;min-width:0;min-height:0;padding-top:2mm;overflow:hidden}.image-wrap img{display:block;max-width:100%;max-height:min(${maxHeight}mm,100%);object-fit:contain}@media print{body{background:#fff}.a4-page{width:210mm;height:297mm;margin:0;box-shadow:none;break-after:page;page-break-after:always}.a4-page:last-child{break-after:auto;page-break-after:auto}@page{size:A4 portrait;margin:0}}</style></head><body>${pageHtml}<script>window.onload=()=>setTimeout(()=>window.print(),120)<\/script></body></html>`);
    printWindow.document.close();
  };

  useEffect(() => {
    if (!open) return;
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.items ?? []).filter(item => item.type.startsWith("image/")).map(item => item.getAsFile()).filter((file): file is File => Boolean(file));
      if (files.length) {
        event.preventDefault();
        void importFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open, records.length, totalSize]);

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[calc(100vh-1.5rem)] max-w-[calc(100vw-1.5rem)] overflow-hidden p-0 sm:max-w-[1320px]">
      <DialogHeader className="border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <DialogTitle className="flex items-center gap-2 text-lg text-slate-900"><Images className="h-5 w-5 text-emerald-700" />支付账号账单批量打印</DialogTitle>
            <DialogDescription className="mt-1">账单图片仅保留在当前浏览器内存，用于预览和打印；不会上传、保存或写入项目财务流水。</DialogDescription>
          </div>
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">已导入 <b>{records.length}</b> 份 · 将打印 <b>{pages.length}</b> 页</div>
        </div>
      </DialogHeader>
      <div className="max-h-[calc(100vh-13rem)] overflow-y-auto bg-slate-50 px-4 py-4 sm:px-6">
        <section className="sticky top-0 z-10 rounded-xl border border-slate-200 bg-white/95 p-4 shadow-sm backdrop-blur">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[150px_minmax(190px,1fr)_150px_190px_auto] lg:items-end">
            <div className="grid gap-1.5"><Label>支付账号类型</Label><Select value={accountType} onValueChange={setAccountType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="微信支付">微信支付</SelectItem><SelectItem value="支付宝">支付宝</SelectItem><SelectItem value="银行卡">银行卡</SelectItem><SelectItem value="现金账户">现金账户</SelectItem><SelectItem value="其他支付平台">其他支付平台</SelectItem></SelectContent></Select></div>
            <div className="grid gap-1.5"><Label>账号别名（仅打印页标题，可不填）</Label><Input value={accountLabel} maxLength={48} placeholder="例如：项目部微信收款号" onChange={event => setAccountLabel(event.target.value)} /></div>
            <div className="grid gap-1.5"><Label>每页排数</Label><div className="flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">固定 3 排</div></div>
            <div className="grid gap-1.5"><Label>每排账单数</Label><Select value={String(itemsPerRow)} onValueChange={value => setItemsPerRow(Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[1, 2, 3, 4].map(value => <SelectItem key={value} value={String(value)}>{value} 张 / 排</SelectItem>)}</SelectContent></Select></div>
            <div className="flex flex-wrap gap-2"><Button type="button" className="bg-emerald-700 hover:bg-emerald-800" onClick={() => fileInputRef.current?.click()}><Upload className="mr-1.5 h-4 w-4" />追加图片</Button><Button type="button" variant="outline" onClick={print}><Printer className="mr-1.5 h-4 w-4" />打印全部</Button></div>
          </div>
          <div className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between"><label className="flex max-w-md flex-1 items-center gap-3 text-xs text-slate-600"><span className="shrink-0 font-medium">图片最大高度</span><input className="w-full accent-emerald-700" type="range" min="25" max="180" step="5" value={maxHeight} onChange={event => setMaxHeight(Number(event.target.value))} /><b className="w-14 text-right text-emerald-800">{maxHeight} mm</b></label><div className="flex items-center gap-2 text-xs text-slate-500"><span>每页 {FIXED_ROWS} 排 × {itemsPerRow} 张，共 {recordsPerPage} 份</span>{records.length ? <Button type="button" size="sm" variant="ghost" className="h-7 text-rose-700 hover:text-rose-800" onClick={() => setRecords([])}><Trash2 className="mr-1 h-3.5 w-3.5" />清空全部</Button> : null}</div></div>
        </section>
        <input ref={fileInputRef} className="hidden" type="file" accept="image/*" multiple onChange={event => { if (event.target.files) void importFiles(event.target.files); event.target.value = ""; }} />
        <button type="button" onClick={() => fileInputRef.current?.click()} onDragEnter={event => { event.preventDefault(); setDragging(true); }} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={event => { event.preventDefault(); setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); void importFiles(event.dataTransfer.files); }} className={cn("mt-4 w-full rounded-xl border-2 border-dashed px-5 py-5 text-center transition-colors", dragging ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-600 hover:border-emerald-400 hover:bg-emerald-50/40")}><FileImage className="mx-auto h-6 w-6" /><strong className="mt-2 block text-sm text-slate-800">拖入支付账单截图，或点击选择图片</strong><span className="mt-1 block text-xs">支持多次追加、拖拽和 Ctrl+V 粘贴；最多 {MAX_RECORDS} 张、总大小不超过 100 MB。</span></button>
        {!records.length ? <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white py-12 text-center text-slate-500"><Images className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 font-medium text-slate-700">等待导入支付账单图片</p><p className="mt-1 text-xs">系统会按导入顺序自动生成连续 A4 纵向打印页。</p></div> : <div className="mt-5 space-y-5">{pages.map((page, pageIndex) => <section key={pageIndex} className="mx-auto w-full max-w-[794px] overflow-hidden rounded-md bg-white p-4 shadow-md ring-1 ring-slate-200" style={{ aspectRatio: "210 / 297" }}><header className="mb-3 flex items-center justify-between gap-3 border-b border-slate-200 pb-2 text-[11px] text-slate-500"><span className="min-w-0 truncate font-semibold text-slate-700">{billTitle} · {projectName}</span><span className="shrink-0">第 {pageIndex + 1}/{pages.length} 页 · {FIXED_ROWS} 排 × {itemsPerRow} 张</span></header><div className="grid h-[calc(100%-2rem)] gap-3" style={{ gridTemplateColumns: `repeat(${itemsPerRow}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${FIXED_ROWS}, minmax(0, 1fr))` }}>{page.map((record, index) => <article key={record.id} className="relative flex min-h-0 flex-col border border-slate-400 bg-white p-2"><div className="flex min-w-0 items-center justify-between gap-2 border-b border-slate-200 pb-1 text-[10px]"><span className="font-semibold text-slate-700">{accountType}账单 {pageIndex * recordsPerPage + index + 1}</span><span className="truncate text-slate-400">{record.name}</span></div><div className="flex min-h-0 flex-1 items-center justify-center pt-2"><img src={record.source} alt={`${accountType}账单 ${pageIndex * recordsPerPage + index + 1}`} className="max-h-full max-w-full object-contain" /></div><button type="button" aria-label={`删除账单 ${pageIndex * recordsPerPage + index + 1}`} className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full border border-rose-200 bg-white text-rose-700 hover:bg-rose-600 hover:text-white" onClick={() => setRecords(current => current.filter(item => item.id !== record.id))}><X className="h-3 w-3" /></button></article>)}</div></section>)}</div>}
        <div className="mt-5 flex items-start gap-2 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-900"><HelpCircle className="mt-0.5 h-4 w-4 shrink-0" />打印时请选择 <b>A4 纵向</b>、边距“无”或“默认最小”，并关闭浏览器页眉页脚。账单图片不进入服务器、不产生财务流水；财务记账仍以资金总账、凭证和审批记录为准。</div>
      </div>
      <DialogFooter className="border-t border-slate-200 bg-white px-5 py-3 sm:px-6"><Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button><Button disabled={!records.length} className="bg-emerald-700 hover:bg-emerald-800" onClick={print}><Printer className="mr-1.5 h-4 w-4" />打印 / 保存 PDF</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
