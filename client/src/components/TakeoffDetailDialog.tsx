import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TakeoffSection } from "@/components/TakeoffFields";
import { TAKEOFF_DIALOG_LAYOUT, TakeoffPhotoGallery } from "@/components/TakeoffPhotos";
import { formatChinaDateTime, toDeviceDateInput } from "@/lib/businessTime";
import { printTakeoffDetail } from "@/lib/measurementTakeoffPrint";
import type { TakeoffDetail } from "@/lib/takeoffEditorModel";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { useEffect, useRef, useState } from "react";
import { formatQuantity } from "@shared/numberFormat";
const status: Record<string, string> = { draft: "草稿", rejected: "已退回", submitted: "待复核", reviewing: "复核中", approved: "已审核", locked: "已锁定", void: "已作废" };
function text(value: string | null) { return value === null ? "历史未填写" : value || "未填写"; }
export function TakeoffDetailDialog({ projectId, id, sessionIdentity, onClose, autoPrint = false }: {
  projectId: number; id: number; sessionIdentity: unknown; onClose: () => void; autoPrint?: boolean;
}) {
  const utils = trpc.useUtils();
  const [detail, setDetail] = useState<TakeoffDetail | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(!autoPrint);
  const [printing, setPrinting] = useState(false);
  const printingRef = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const scope = useRef({ projectId, id, sessionIdentity });
  const live = useRef(scope.current); live.current = { projectId, id, sessionIdentity };
  const visible = scope.current.projectId === projectId && scope.current.id === id && scope.current.sessionIdentity === sessionIdentity;
  const current = (token: number) => mounted.current && token === generation.current && scope.current.projectId === live.current.projectId && scope.current.id === live.current.id && scope.current.sessionIdentity === live.current.sessionIdentity;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  async function readDetail() {
    const token = ++generation.current; scope.current = { projectId, id, sessionIdentity };
    setDetail(null); setError(""); setReading(true);
    try { const result = await utils.measurement.getTakeoffDetail.fetch({ projectId, id }, { staleTime: 0 }); if (current(token)) setDetail(result); }
    catch (e) { if (current(token)) setError(getUserFacingErrorMessage(e)); }
    finally { if (current(token)) setReading(false); }
  }
  async function print() {
    if (printingRef.current) return;
    printingRef.current = true; setPrinting(true); setError("");
    const token = generation.current;
    try {
      // Always use the dedicated print endpoint, never re-use a detail/cache snapshot.
      const result = await utils.measurement.getTakeoffPrint.fetch({ projectId, id }, { staleTime: 0 });
      if (!current(token)) return;
      await printTakeoffDetail(result, () => current(token));
    } catch (e) { if (current(token)) setError(getUserFacingErrorMessage(e)); }
    finally { if (current(token)) { printingRef.current = false; setPrinting(false); } }
  }
  useEffect(() => {
    generation.current++; scope.current = { projectId, id, sessionIdentity };
    setDetail(null); printingRef.current = false; setPrinting(false); setError("");
    if (autoPrint) { setReading(false); void print(); } else void readDetail();
    return () => { generation.current++; };
  }, [projectId, id, sessionIdentity, autoPrint]);
  function close() { generation.current++; onClose(); }
  return <Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent className={TAKEOFF_DIALOG_LAYOUT}><DialogHeader><DialogTitle>{autoPrint ? "项目部工程量收方 A4 打印" : "项目部工程量收方详情"}</DialogTitle></DialogHeader>
    <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
      {reading || !visible ? <p role="status">正在重新读取收方资料…</p> : detail ? <>
        <TakeoffSection title="基本信息"><dl className="grid grid-cols-2 gap-3 text-sm">{[["项目", detail.project.name], ["正式单号", detail.record.takeoffNo], ["收方日期", toDeviceDateInput(detail.record.takeoffDate)], ["状态", status[detail.record.status] ?? "待处理"], ["工程项目", detail.record.workItem], ["里程 / 作业位置", detail.record.workLocation], ["工程量", `${formatQuantity(detail.record.quantity)} ${detail.record.unit}`], ["业主单价", `¥${detail.record.unitPrice}`], ["申报金额（服务端）", `¥${detail.record.declaredAmount}`], ["录入人", detail.submittedByName ?? "未填写"], ["复核人", detail.reviewedByName ?? "未复核"]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-all">{value}</dd></div>)}</dl></TakeoffSection>
        <TakeoffSection title="工程说明"><h4 className="text-xs text-muted-foreground">详细项目说明</h4><p className="whitespace-pre-wrap break-all text-sm">{text(detail.record.workDescription)}</p><h4 className="text-xs text-muted-foreground">计量依据</h4><p className="whitespace-pre-wrap break-all text-sm">{text(detail.record.measurementBasis)}</p></TakeoffSection>
        <TakeoffSection title="测量明细">{detail.record.measurementRows === null ? <p className="text-sm">历史未填写</p> : !detail.record.measurementRows.length ? <p className="text-sm">未填写</p> : detail.record.measurementRows.map((row, i) => <div key={i} className="space-y-2 rounded-lg border bg-background p-3 text-sm"><p className="whitespace-pre-wrap break-all font-semibold">{i + 1}. {row.item || "未填分项"} · {row.location || "未填位置"}</p><div className="grid grid-cols-2 gap-2">{[["长", row.length], ["宽", row.width], ["高 / 厚", row.height], ["次数 / 数量", row.count]].map(([label, value]) => <p key={label} className="break-all">{label}：{value ?? "—"}</p>)}<p className="col-span-2 break-all">明细工程量：{formatQuantity(row.quantity)} {detail.record.unit}</p></div><p className="whitespace-pre-wrap break-all">计算说明：{row.calculation || "—"}</p><p className="whitespace-pre-wrap break-all">备注：{row.remarks || "—"}</p></div>)}</TakeoffSection>
        <TakeoffSection title="现场图片">{detail.evidences.length ? <TakeoffPhotoGallery photos={detail.evidences} /> : <p className="text-sm">未关联现场图片</p>}<p className="text-xs text-muted-foreground">当前授权范围内站内查看，不提供下载；打印将重新读取全部关联图片。</p>{detail.evidences.map(photo => photo.capturedAt ? <p key={photo.evidenceId} className="break-all text-xs">{photo.fileName} · 归档时刻：{formatChinaDateTime(photo.capturedAt)}</p> : null)}</TakeoffSection>
      </> : autoPrint ? <p className="text-sm">每次打印重新读取完整资料，全部图片加载后进入 A4 打印。</p> : null}
      {error && visible ? <p role="alert" className="whitespace-pre-wrap break-all rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
    </div><DialogFooter className="shrink-0 border-t pt-3"><Button variant="outline" onClick={close}>关闭</Button>{!autoPrint ? <Button variant="outline" disabled={reading || printing} onClick={() => void readDetail()}>重新读取详情</Button> : null}<Button disabled={printing || reading || !visible} onClick={() => void print()}>{printing ? "正在准备打印…" : "A4 打印"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
