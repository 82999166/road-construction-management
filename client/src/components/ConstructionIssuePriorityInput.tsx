import React, { useId } from "react";
import { Check } from "lucide-react";
import {
  getConstructionIssuePriorityLabel,
  type ConstructionIssuePriority,
} from "@shared/constructionIssuePriority";

export interface ConstructionIssuePriorityInputProps {
  value: ConstructionIssuePriority | null;
  onChange: (value: ConstructionIssuePriority) => void;
  disabled?: boolean;
}

/** NULL is an explicit historical state; mounting never assigns a default. */
export function ConstructionIssuePriorityInput({
  value,
  onChange,
  disabled = false,
}: ConstructionIssuePriorityInputProps) {
  const name = useId();
  return (
    <div className="space-y-1.5">
      <div
        role="radiogroup"
        aria-label="问题等级"
        aria-disabled={disabled}
        className="grid max-w-sm grid-cols-2 gap-2"
      >
        {(["normal", "urgent"] as const).map(priority => {
          const selected = value === priority;
          return (
            <label
              key={priority}
              className={`flex min-h-10 items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm font-medium ${priority === "urgent" ? "border-red-300 bg-red-50 text-red-800" : "border-yellow-300 bg-yellow-50 text-yellow-900"} ${selected ? "ring-2 ring-current ring-offset-1" : ""} ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name={name}
                  value={priority}
                  aria-label={getConstructionIssuePriorityLabel(priority)}
                  checked={selected}
                  disabled={disabled}
                  className="accent-current focus-visible:outline-2 focus-visible:outline-offset-2"
                  onChange={() => {
                    if (!disabled) onChange(priority);
                  }}
                />
                {getConstructionIssuePriorityLabel(priority)}
              </span>
              {selected ? (
                <Check aria-hidden="true" className="h-4 w-4" />
              ) : (
                <span className="h-4 w-4" aria-hidden="true" />
              )}
            </label>
          );
        })}
      </div>
      {value === null ? (
        <p className="text-xs text-muted-foreground" role="status">
          历史未分级；明确选择后才会更改等级。
        </p>
      ) : null}
    </div>
  );
}
