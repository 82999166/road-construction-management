import { Badge } from "@/components/ui/badge";

/** 仅展示服务端真实状态；可操作性始终由后端状态机再次判定。 */
export default function BusinessStatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = { pending: "待进场", active: "可用", left: "已退场", idle: "闲置", working: "作业中", repairing: "维修中", offsite: "场外", retired: "已退役", draft: "草稿", submitted: "待审核", reviewing: "审核中", approved: "已审核", verified: "已核验", paid: "已发放", settled: "已结算", rejected: "已退回", locked: "已归档", void: "已作废", suspended: "已暂停", disabled: "已停用", publishing: "发布中", published: "已发布", partial: "部分失败", failed: "发布失败", cancelled: "已取消", sent: "已投递", skipped: "已跳过" };
  const tone = ["approved", "verified", "paid", "settled", "active", "working"].includes(status) ? "bg-emerald-50 text-emerald-700" : ["rejected", "void", "disabled", "retired"].includes(status) ? "bg-rose-50 text-rose-700" : ["submitted", "reviewing", "pending", "repairing", "suspended"].includes(status) ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600";
  return <Badge className={tone}>{labels[status] ?? status}</Badge>;
}
