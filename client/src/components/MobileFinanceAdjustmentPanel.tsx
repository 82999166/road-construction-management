import { MobileFinanceAdjustmentActions, canAdjustFinancialRecord, getFinancialRecordAdjustmentAction } from "@/components/MobileFinanceAdjustmentActions";
import React from "react";

type FinancialRecordForPanel = {
  id: number;
  recordNo: string;
  category: string;
  sourceType?: string | null;
  settlementStatus: string;
};

type MobileFinanceAdjustmentPanelProps = {
  projectId: number;
  roleCodes: readonly string[];
  records: FinancialRecordForPanel[];
};

/** 将可调整的人工流水集中在原流水列表之后，避免误把来源业务流水展示为财务台账可操作对象。 */
export function MobileFinanceAdjustmentPanel({ projectId, roleCodes, records }: MobileFinanceAdjustmentPanelProps) {
  if (!canAdjustFinancialRecord(roleCodes)) return null;
  const adjustableRecords = records.filter(record => getFinancialRecordAdjustmentAction(record));
  if (!adjustableRecords.length) return null;

  return <section className="rounded-2xl border border-[#ead9c8] bg-[#fffaf3] p-4 print:hidden"><div><p className="font-semibold text-[#5c3525]">账务调整</p><p className="mt-1 text-xs leading-5 text-[#765542]">仅显示可调整的人工流水；未支付可作废，已支付会生成相反方向的冲销流水。</p></div><div className="mt-3 space-y-2">{adjustableRecords.map(record => <div key={record.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#f0e3d5] bg-white px-3 py-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{record.category}</p><p className="mt-0.5 text-[11px] text-[#8f7566]">{record.recordNo}</p></div><MobileFinanceAdjustmentActions projectId={projectId} roleCodes={roleCodes} record={record} /></div>)}</div></section>;
}
