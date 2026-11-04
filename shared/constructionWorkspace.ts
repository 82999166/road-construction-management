export type ConstructionWorkspaceTab =
  | "ledger"
  | "review"
  | "issues"
  | "archive";
export type ConstructionStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "locked";
export type ConstructionIssueScope =
  | "all"
  | "recorded"
  | "quality"
  | "safety"
  | "unreplied"
  | "replied";
export const CONSTRUCTION_WORKSPACE_TABS = [
  { value: "ledger", label: "日报台账" },
  { value: "review", label: "审核待办" },
  { value: "issues", label: "现场问题" },
  { value: "archive", label: "归档查询" },
] as const;
export interface ConstructionWorkspaceFilter {
  dateFrom: string;
  dateTo: string;
  createdBy: string;
  keyword: string;
  status: "all" | ConstructionStatus;
  issueScope: ConstructionIssueScope;
}
export function constructionFilterInput(
  projectId: number,
  tab: ConstructionWorkspaceTab,
  filter: ConstructionWorkspaceFilter
) {
  return {
    projectId,
    scope: tab,
    dateFrom: filter.dateFrom || undefined,
    dateTo: filter.dateTo || undefined,
    createdBy:
      filter.createdBy === "all" ? undefined : Number(filter.createdBy),
    keyword: filter.keyword.trim() || undefined,
    status: filter.status === "all" ? undefined : filter.status,
    issueScope: filter.issueScope,
  };
}
/** 仅存在待审记录时允许下钻；保留日期/提交人/关键词/问题交集，状态交给待审栏目固定约束。 */
export function constructionReviewDrillFilter(
  tab: ConstructionWorkspaceTab,
  filter: ConstructionWorkspaceFilter
): ConstructionWorkspaceFilter {
  return {
    ...filter,
    status: "all",
    issueScope:
      tab === "issues" && filter.issueScope === "all"
        ? "recorded"
        : filter.issueScope,
  };
}
/** 分批只限制单次输出负载；清单始终覆盖全部授权筛选记录，不丢弃第251条及以后记录。 */
export function constructionOutputBatches(ids: readonly number[], size = 250) {
  if (!Number.isInteger(size) || size < 1 || size > 250)
    throw new Error("输出批次大小应为1至250");
  const batches: Array<{
    batch: number;
    ids: number[];
    from: number;
    to: number;
  }> = [];
  for (let index = 0; index < ids.length; index += size) {
    const chunk = ids.slice(index, index + size);
    batches.push({
      batch: batches.length + 1,
      ids: chunk,
      from: index + 1,
      to: index + chunk.length,
    });
  }
  return batches;
}
export function constructionRowActions(
  status: ConstructionStatus,
  capabilities: { canEdit: boolean; canTransition: boolean }
) {
  return {
    edit: capabilities.canEdit && (status === "draft" || status === "rejected"),
    submit: capabilities.canTransition && status === "draft",
    approve: capabilities.canTransition && status === "submitted",
    reject: capabilities.canTransition && status === "submitted",
    archive: capabilities.canTransition && status === "approved",
  };
}
