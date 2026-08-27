import { KeyRound, ScrollText, ShieldCheck, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatChinaDateTime } from "@/lib/businessTime";

type AuditLogRow = { id: number; summary: string; module: string; action: string; userId: number | null; createdAt: Date | string | null };
type SensitiveAccessRow = { id: number; dataCategory: string; result: string; module: string; accessPurpose: string; recordCount: number; createdAt: Date | string | null };
type IntegritySnapshot = { valid: boolean; eventCount: number; errors: string[]; sealedCount: number; completeSeal: boolean } | undefined;

function displayDate(value: Date | string | null) {
  return formatChinaDateTime(value);
}

function MetricCard({ title, value, description, icon: Icon }: { title: string; value: string | number; description: string; icon: LucideIcon }) {
  return <Card className="border-[#d8e3e0] bg-[#f8fcfb]"><CardContent className="flex items-start justify-between gap-3 p-4"><div><p className="text-sm font-medium text-slate-600">{title}</p><p className="mt-1 text-2xl font-semibold tracking-tight text-[#203c48]">{value}</p><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div><span className="rounded-xl bg-white p-2 text-[#4d6b63] shadow-sm"><Icon className="size-4" /></span></CardContent></Card>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-sm text-slate-500">{text}</div>;
}

/** 超级管理员专用审计工作区；只展示受控摘要，绝不将账号、定位或原始审计载荷渲染到浏览器。 */
export default function AdminAuditWorkspace({ audits, integrity, isIntegrityLoading, isRefreshing, sensitiveAccesses, onRefresh }: { audits: AuditLogRow[]; integrity: IntegritySnapshot; isIntegrityLoading: boolean; isRefreshing: boolean; sensitiveAccesses: SensitiveAccessRow[]; onRefresh: () => void }) {
  return <div className="space-y-6">
    <div><p className="text-sm font-medium text-[#203c48]">治理留痕</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">配置发布与审计日志</h1><p className="mt-2 text-sm text-slate-500">所有组织、角色、授权和系统设置的关键操作都会写入服务端审计记录。敏感数据利用与审计链仅限超级管理员在本页受控复核。</p></div>
    <section className="grid gap-3 md:grid-cols-3"><MetricCard title="审计链状态" value={isIntegrityLoading ? "校验中" : integrity?.valid ? "完整" : "待核验"} description={integrity?.valid ? `已封存 ${integrity.eventCount} 条事件` : integrity?.errors?.[0] || "尚未取得校验结果"} icon={ShieldCheck} /><MetricCard title="本次补链" value={integrity?.sealedCount ?? 0} description={integrity?.completeSeal === false ? "达到单次上限，请刷新继续补链" : "未发现待补链事件或已完成"} icon={ScrollText} /><MetricCard title="近期敏感访问" value={sensitiveAccesses.length} description="仅记录用途、模块、范围与数量，不展示敏感原文" icon={KeyRound} /></section>
    <Card><CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0"><div><CardTitle className="text-base">敏感数据访问利用</CardTitle><CardDescription>完整收款账户、原始定位等受控读取均必须保留用途与项目范围留痕。</CardDescription></div><Button size="sm" variant="outline" onClick={onRefresh} disabled={isRefreshing}>刷新核验</Button></CardHeader><CardContent>{sensitiveAccesses.length ? <div className="space-y-2">{sensitiveAccesses.map(item => <div key={item.id} className="grid gap-1 rounded-xl border border-slate-100 p-3 md:grid-cols-[1fr_auto]"><div><p className="text-sm font-medium text-slate-700">{item.dataCategory} · {item.result}</p><p className="mt-1 text-xs text-slate-500">{item.module} · {item.accessPurpose} · 返回 {item.recordCount} 条</p></div><p className="text-xs text-slate-400">{displayDate(item.createdAt)}</p></div>)}</div> : <EmptyState text="近期暂无受控敏感数据访问记录。" />}</CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">最近操作</CardTitle></CardHeader><CardContent className="space-y-2">{audits.length ? audits.map(item => <div key={item.id} className="grid gap-1 rounded-xl border border-slate-100 p-3 md:grid-cols-[1fr_auto]"><div><p className="text-sm font-medium text-slate-700">{item.summary}</p><p className="mt-1 text-xs text-slate-400">{item.module} · {item.action} · 操作人 #{item.userId ?? "系统"}</p></div><p className="text-xs text-slate-400">{displayDate(item.createdAt)}</p></div>) : <EmptyState text="尚无审计记录；首次保存组织、角色或配置后将自动生成。" />}</CardContent></Card>
  </div>;
}
