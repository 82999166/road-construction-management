import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TAKEOFF_UNITS, emptyMeasurementRow, type TakeoffDraft, type TakeoffMeasurementRow } from "@/lib/takeoffEditorModel";
import type { ReactNode } from "react";

export function TakeoffSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="min-w-0 space-y-3 rounded-xl border bg-muted/20 p-3 sm:p-4"><h3 className="text-sm font-semibold">{title}</h3>{children}</section>;
}
export function TakeoffFields({ draft, onChange, projectName, claims = [], disabled }: {
  draft: TakeoffDraft; onChange: (draft: TakeoffDraft) => void; projectName: string;
  claims?: { id: number; claimNo: string }[]; disabled: boolean;
}) {
  const change = <K extends keyof TakeoffDraft>(key: K, value: TakeoffDraft[K]) => onChange({ ...draft, [key]: value });
  const rows = draft.measurementRows ?? [];
  const total = rows.reduce((sum, row) => sum + (Number.isFinite(row.quantity) ? row.quantity : 0), 0);
  const updateRow = <K extends keyof TakeoffMeasurementRow>(index: number, key: K, value: TakeoffMeasurementRow[K]) => change("measurementRows", rows.map((row, i) => i === index ? { ...row, [key]: value } : row));
  const base = "mt-1 min-w-0 w-full";
  return <fieldset disabled={disabled} className="min-w-0 space-y-3">
    <TakeoffSection title="基本信息">
      <div className="grid min-w-0 grid-cols-2 gap-3">
        <div className="min-w-0"><Label htmlFor="takeoff-project">当前项目</Label><Input id="takeoff-project" className={base} value={projectName} disabled /></div>
        <div className="min-w-0"><Label htmlFor="takeoff-date">收方日期</Label><Input id="takeoff-date" className={base} type="date" value={draft.takeoffDate} onChange={e => change("takeoffDate", e.target.value)} /></div>
        <div className="col-span-2 min-w-0"><Label htmlFor="takeoff-claim">关联计量申报（可选）</Label><select id="takeoff-claim" className={`${base} h-9 rounded-md border bg-background px-2 text-sm`} value={draft.measurementClaimId} onChange={e => change("measurementClaimId", e.target.value)}><option value="">暂不关联计量申报</option>{draft.measurementClaimId && !claims.some(c => String(c.id) === draft.measurementClaimId) ? <option value={draft.measurementClaimId}>已关联申报 #{draft.measurementClaimId}</option> : null}{claims.map(c => <option key={c.id} value={c.id}>{c.claimNo}</option>)}</select></div>
        <div className="col-span-2 min-w-0 sm:col-span-1"><Label htmlFor="takeoff-item">工程项目</Label><Input id="takeoff-item" className={base} maxLength={200} value={draft.workItem} placeholder="例如：路基土方填筑" onChange={e => change("workItem", e.target.value)} /></div>
        <div className="col-span-2 min-w-0 sm:col-span-1"><Label htmlFor="takeoff-position">里程 / 作业位置</Label><Input id="takeoff-position" className={base} maxLength={200} value={draft.workLocation} placeholder="例如：K12+340 左侧" onChange={e => change("workLocation", e.target.value)} /></div>
        <div className="min-w-0"><Label htmlFor="takeoff-unit">计量单位</Label><select id="takeoff-unit" className={`${base} h-9 rounded-md border bg-background px-2 text-sm`} value={draft.unit} onChange={e => { const unit = TAKEOFF_UNITS.find(u => u.value === e.target.value); if (unit) change("unit", unit.value); }}>{TAKEOFF_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}</select></div>
        <div className="min-w-0"><Label htmlFor="takeoff-quantity">工程量</Label><Input id="takeoff-quantity" className={base} type="number" inputMode="decimal" min="0" step="any" value={draft.quantity} onChange={e => change("quantity", e.target.value)} /></div>
        <div className="min-w-0"><Label htmlFor="takeoff-price">业主单价（元）</Label><Input id="takeoff-price" className={base} type="number" inputMode="decimal" min="0" step="0.01" value={draft.unitPrice} onChange={e => change("unitPrice", e.target.value)} /></div>
        <div className="min-w-0 rounded-lg bg-muted p-2 text-xs"><p>收方申报金额（服务端复算）</p><p className="mt-1 break-all font-semibold">¥{Number.isFinite(Number(draft.quantity) * Number(draft.unitPrice)) ? (Number(draft.quantity) * Number(draft.unitPrice)).toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "—"}</p></div>
      </div>
    </TakeoffSection>
    <TakeoffSection title="工程说明">
      <div><Label htmlFor="takeoff-description">详细项目说明</Label>{draft.workDescription === null ? <p className="text-xs text-muted-foreground">历史未填写；未改动时保留原空值</p> : null}<Textarea id="takeoff-description" className={base} rows={4} maxLength={10000} value={draft.workDescription ?? ""} placeholder="填写施工内容、工艺、规格、范围及现场情况" onChange={e => change("workDescription", e.target.value)} /></div>
      <div><Label htmlFor="takeoff-basis">计量依据</Label>{draft.measurementBasis === null ? <p className="text-xs text-muted-foreground">历史未填写</p> : null}<Textarea id="takeoff-basis" className={base} rows={2} maxLength={2000} value={draft.measurementBasis ?? ""} placeholder="图纸、合同清单、测量方式或现场确认依据" onChange={e => change("measurementBasis", e.target.value)} /></div>
    </TakeoffSection>
    <TakeoffSection title="测量明细">
      <p className="text-xs leading-5 text-muted-foreground">尺寸、次数为辅助原始数据，可留空；所有明细工程量单位继承“{draft.unit}”。自由计算说明不执行、不自动计算结算量。</p>
      {draft.measurementRows === null ? <p className="text-xs text-muted-foreground">历史未填写</p> : null}
      {rows.map((row, index) => <div key={index} className="min-w-0 space-y-2 rounded-lg border bg-background p-3" data-measurement-row>
        <div className="flex items-center justify-between gap-2"><h4 className="text-xs font-semibold">测量行 {index + 1}</h4><Button type="button" size="sm" variant="ghost" onClick={() => change("measurementRows", rows.filter((_, i) => i !== index))}>移除测量行</Button></div>
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <div className="min-w-0"><Label htmlFor={`row-${index}-item`}>分项</Label><Input id={`row-${index}-item`} className={base} maxLength={120} value={row.item} onChange={e => updateRow(index, "item", e.target.value)} /></div>
          <div className="min-w-0"><Label htmlFor={`row-${index}-location`}>位置</Label><Input id={`row-${index}-location`} className={base} maxLength={200} value={row.location} onChange={e => updateRow(index, "location", e.target.value)} /></div>
          {([["length", "长"], ["width", "宽"], ["height", "高 / 厚"], ["count", "次数 / 数量"], ["quantity", `明细工程量 (${draft.unit})`]] as const).map(([key, label]) => <div key={key} className="min-w-0"><Label htmlFor={`row-${index}-${key}`}>{label}</Label><Input id={`row-${index}-${key}`} className={base} type="number" inputMode="decimal" min="0" step="any" value={row[key] === null || !Number.isFinite(row[key]) ? "" : row[key]} onChange={e => updateRow(index, key, e.target.value === "" && key !== "quantity" ? null : e.target.value === "" ? Number.NaN : Number(e.target.value))} /></div>)}
          <div className="col-span-2"><Label htmlFor={`row-${index}-calculation`}>计算说明（自由文本）</Label><Textarea id={`row-${index}-calculation`} className={base} rows={2} maxLength={500} value={row.calculation} onChange={e => updateRow(index, "calculation", e.target.value)} /></div>
          <div className="col-span-2"><Label htmlFor={`row-${index}-remarks`}>备注</Label><Textarea id={`row-${index}-remarks`} className={base} rows={2} maxLength={500} value={row.remarks} onChange={e => updateRow(index, "remarks", e.target.value)} /></div>
        </div>
      </div>)}
      <div className="flex flex-wrap items-center gap-2"><Button type="button" size="sm" variant="outline" disabled={disabled || rows.length >= 100} onClick={() => change("measurementRows", [...rows, emptyMeasurementRow()])}>添加测量行</Button><span className="break-all text-xs">参考合计：{total.toLocaleString("zh-CN", { maximumFractionDigits: 6 })} {draft.unit}</span><Button type="button" size="sm" variant="secondary" disabled={disabled || !rows.length || !Number.isFinite(total) || rows.some(r => !Number.isFinite(r.quantity) || r.quantity < 0)} onClick={() => change("quantity", String(total))}>将参考合计带入工程量</Button></div>
    </TakeoffSection>
  </fieldset>;
}
