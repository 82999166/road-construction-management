/** 仅显式等级，不从问题、安全或审核自由文字推断紧急/整改语义。 */
export type ConstructionIssuePriority = "normal" | "urgent";
export type ConstructionIssuePriorityFilter =
  | "all"
  | ConstructionIssuePriority
  | "unclassified";

/** 历史 NULL/省略保持未分级，不能默认映射成一般。 */
export function getConstructionIssuePriorityLabel(
  priority?: ConstructionIssuePriority | null
): string {
  if (priority === "urgent") return "紧急";
  if (priority === "normal") return "一般";
  return "未分级";
}

/** PC、手机、打印可共用语义；空白问题不显示等级，安全历史也不产生问题等级。 */
export function getConstructionIssuePriorityBadge(
  issueNotes: string | null | undefined,
  priority: ConstructionIssuePriority | null | undefined
) {
  if (!issueNotes?.trim()) return null;
  return {
    priority: priority ?? null,
    label: getConstructionIssuePriorityLabel(priority),
    tone:
      priority === "urgent"
        ? ("red" as const)
        : priority === "normal"
          ? ("yellow" as const)
          : ("neutral" as const),
  };
}
