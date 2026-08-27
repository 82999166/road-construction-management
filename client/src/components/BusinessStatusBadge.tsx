import { Badge } from "@/components/ui/badge";

export const BUSINESS_STATUS_LABELS: Record<string, string> = {
  pending: "待处理", active: "已启用", left: "已退场", idle: "闲置", working: "作业中", repairing: "维修中", offsite: "场外", retired: "已退役",
  draft: "草稿", submitted: "待审核", reviewing: "审核中", pending_approval: "待审核", approved: "已审核", verified: "已核验", confirmed: "已确认", paid: "已发放", settled: "已结算", closed: "已关闭", completed: "已完成",
  rejected: "已退回", locked: "已归档", void: "已作废", cancelled: "已取消", suspended: "已暂停", disabled: "已停用", expired: "已过期", missing: "未配置",
  publishing: "发布中", published: "已发布", partial: "部分失败", failed: "处理失败", sent: "已投递", delivered: "已送达", skipped: "已跳过", queued: "排队中", processing: "处理中", read: "已阅读", unread: "未读", acknowledged: "已确认收悉",
  ordered: "已下单", received: "已收货", stocked: "已入库", generated: "已生成", receipt_recorded: "已登记", handed_off: "已交接", in_transit: "运输中", configured: "已配置", enabled: "已启用", inactive: "未启用",
  not_bound: "未绑定", not_configured: "未配置", invalid_config: "配置无效", delivery_failed: "投递失败", database_unavailable: "服务暂不可用", verification_failed: "核验失败", unavailable: "暂不可用",
};

/** 仅用于用户可见投影；服务端枚举和状态机值始终保持不变。 */
export function getBusinessStatusLabel(status: string | null | undefined) {
  const source = status?.trim() ?? "";
  if (!source) return "未登记";
  const label = BUSINESS_STATUS_LABELS[source.toLowerCase()];
  if (label) return label;
  return /[\u4e00-\u9fff]/.test(source) ? source : "待处理";
}

/** 仅展示服务端真实状态；可操作性始终由后端状态机再次判定。 */
export default function BusinessStatusBadge({ status }: { status: string }) {
  const normalizedStatus = status.trim().toLowerCase();
  const tone = ["approved", "verified", "paid", "settled", "active", "working", "delivered", "acknowledged", "received", "stocked", "completed"].includes(normalizedStatus) ? "bg-emerald-50 text-emerald-700" : ["rejected", "void", "disabled", "retired", "failed", "expired"].includes(normalizedStatus) ? "bg-rose-50 text-rose-700" : ["submitted", "reviewing", "pending", "repairing", "suspended", "queued", "processing", "partial"].includes(normalizedStatus) ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600";
  return <Badge className={tone}>{getBusinessStatusLabel(status)}</Badge>;
}
