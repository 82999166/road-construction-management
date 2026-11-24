import React from "react";

export type EvidenceAssociationRecord = { sourceAssociationStatus?: "referenced" | "unverified_marker" | "unassigned"; deletionBlockedReason?: string | null; canDelete?: boolean; sourceId?: string | null };
export function canRequestEvidenceDeletion(record: EvidenceAssociationRecord | null | undefined) {
  return Boolean(record && record.sourceAssociationStatus === "unassigned" && record.canDelete === true && !record.deletionBlockedReason);
}
export function evidenceAssociationLabel(status: EvidenceAssociationRecord["sourceAssociationStatus"]) {
  if (status === "referenced") return "已有业务 / 历史引用";
  if (status === "unverified_marker") return "来源标记待核验";
  if (status === "unassigned") return "未关联单据";
  return "来源状态待核验";
}
export function EvidenceAssociationSummary({ record }: { record: EvidenceAssociationRecord }) {
  return <div className="min-w-0 rounded-lg bg-[#f9f4ed] px-2.5 py-2 text-[10px] leading-4 text-[#735645] [overflow-wrap:anywhere]">
    <p>来源状态：{evidenceAssociationLabel(record.sourceAssociationStatus)}</p>
    <p className="mt-1">来源标记：{record.sourceId || "未填写"}（标记本身不证明真实业务关联或审核状态）</p>
    {record.sourceAssociationStatus === "referenced" && <p className="mt-1">已有当前或历史引用，须在原业务核查；不代表当前已审核。</p>}
    {record.sourceAssociationStatus === "unverified_marker" && <p className="mt-1">无法据来源标记确认是否已使用，保守保留影像，请回原业务核验。</p>}
    {!canRequestEvidenceDeletion(record) && <p className="mt-1 text-[#a44336]">不能删除：{record.deletionBlockedReason || (record.sourceAssociationStatus === "unassigned" ? "当前岗位无删除权限" : "来源或引用状态未确认可删除")}</p>}
    <p className="mt-1">影像查看仍须原业务及项目权限；审核状态以真实单据为准。</p>
  </div>;
}
