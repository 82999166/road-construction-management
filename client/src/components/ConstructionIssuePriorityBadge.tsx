import React from "react";
import {
  getConstructionIssuePriorityLabel,
  type ConstructionIssuePriority,
} from "@shared/constructionIssuePriority";

/** 只对实际问题记录标级；空问题不出现假等级，历史空值不猜测为一般。 */
export function ConstructionIssuePriorityBadge({
  priority,
  issueNotes,
}: {
  priority?: ConstructionIssuePriority | null;
  issueNotes?: string | null;
}) {
  if (!issueNotes?.trim()) return null;
  const tone =
    priority === "urgent"
      ? "border-red-200 bg-red-100 text-red-900"
      : priority === "normal"
        ? "border-yellow-200 bg-yellow-100 text-yellow-900"
        : "border-border bg-muted text-muted-foreground";
  return (
    <span
      data-issue-priority={priority ?? "unclassified"}
      aria-label={`问题等级：${getConstructionIssuePriorityLabel(priority)}`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold leading-5 ${tone}`}
    >
      <span
        className="h-1.5 w-1.5 rounded-full bg-current"
        aria-hidden="true"
      />
      {getConstructionIssuePriorityLabel(priority)}
    </span>
  );
}

export default ConstructionIssuePriorityBadge;
