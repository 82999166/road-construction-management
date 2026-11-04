import React, { useId, useRef, type KeyboardEvent } from "react";

export interface BusinessWorkspaceTab<T extends string = string> {
  value: T;
  label: string;
  badge?: number | string;
}

export interface BusinessWorkspaceNavigationProps<T extends string> {
  tabs: readonly BusinessWorkspaceTab<T>[];
  value: T;
  onValueChange: (value: T) => void;
  label: string;
  disabled?: boolean;
}

/** Business modules wrap on small screens; navigation never widens the page. */
export function BusinessWorkspaceNavigation<T extends string>({
  tabs,
  value,
  onValueChange,
  label,
  disabled = false,
}: BusinessWorkspaceNavigationProps<T>) {
  const id = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (disabled || !tabs.length) return;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (index + 1) % tabs.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (index + tabs.length - 1) % tabs.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    refs.current[next]?.focus({ preventScroll: true });
    onValueChange(tabs[next].value);
  }
  const desktopColumns =
    tabs.length > 5
      ? "lg:grid-cols-6"
      : tabs.length === 5
        ? "lg:grid-cols-5"
        : "lg:grid-cols-4";
  return (
    <div
      role="tablist"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={`grid w-full min-w-0 grid-cols-2 gap-1.5 rounded-xl border border-border bg-muted/40 p-1.5 text-foreground ${desktopColumns}`}
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.value}
          ref={element => {
            refs.current[index] = element;
          }}
          id={`${id}-${tab.value}`}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          tabIndex={value === tab.value && !disabled ? 0 : -1}
          disabled={disabled}
          onClick={() => onValueChange(tab.value)}
          onKeyDown={event => move(event, index)}
          className={`flex min-h-11 min-w-0 flex-wrap items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-sm font-medium leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${value === tab.value ? "border-primary/25 bg-background text-primary shadow-sm" : "border-transparent text-muted-foreground hover:bg-background/70 hover:text-foreground"}`}
        >
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">
            {tab.label}
          </span>
          {tab.badge != null && (
            <span className="max-w-full break-words rounded-md bg-muted px-1.5 py-0.5 text-xs tabular-nums text-foreground">
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
