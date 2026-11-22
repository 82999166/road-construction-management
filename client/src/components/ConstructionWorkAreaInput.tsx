import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { hashKey } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";

export interface ConstructionWorkAreaInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  projectId: number;
  userId: number;
  active: boolean;
  disabled?: boolean;
  placeholder?: string;
}
type WorkAreaOption = {
  workArea: string;
  useCount: number;
  lastUsedAt: Date | string;
};

/** Scope changes destroy the menu and reject all callbacks from the old session. */
export function ConstructionWorkAreaInput(
  props: ConstructionWorkAreaInputProps
) {
  return (
    <ConstructionWorkAreaInputSession
      key={`${props.userId}:${props.projectId}:${props.active}:${Boolean(props.disabled)}`}
      {...props}
    />
  );
}

function ConstructionWorkAreaInputSession({
  id,
  value,
  onChange,
  projectId,
  userId,
  active,
  disabled = false,
  placeholder,
}: ConstructionWorkAreaInputProps) {
  const sessionId = useId();
  const enabled = active && !disabled && projectId > 0 && userId > 0;
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [items, setItems] = useState<WorkAreaOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [highlight, setHighlight] = useState(-1);
  const requestSequence = useRef(0);
  const input = useMemo(
    () => ({
      projectId,
      keyword: debouncedKeyword.trim().slice(0, 100) || undefined,
    }),
    [projectId, debouncedKeyword]
  );
  // Account/session isolation is client-only: never add userId to the API contract.
  const queryKeyHashFn = useCallback(
    (key: readonly unknown[]) => `${userId}:${sessionId}:${hashKey(key)}`,
    [userId, sessionId]
  );
  const query = trpc.construction.workAreaOptions.useQuery(input, {
    enabled: false,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    queryKeyHashFn,
    trpc: { abortOnUnmount: true },
  });
  const latestRefetch = useRef(query.refetch);
  latestRefetch.current = query.refetch;
  useEffect(() => {
    if (keyword === debouncedKeyword) return;
    const timer = setTimeout(() => setDebouncedKeyword(keyword), 300);
    return () => clearTimeout(timer);
  }, [keyword, debouncedKeyword]);
  useEffect(() => {
    if (!enabled || !open || keyword !== debouncedKeyword) return;
    let cancelled = false;
    const sequence = ++requestSequence.current;
    setItems([]);
    setError("");
    setLoading(true);
    setHighlight(-1);
    void latestRefetch
      .current({ throwOnError: true })
      .then(result => {
        if (!result.data) throw new Error("作业面读取失败");
        if (!cancelled && sequence === requestSequence.current)
          setItems(result.data.items.slice(0, 30));
      })
      .catch(cause => {
        if (!cancelled && sequence === requestSequence.current)
          setError(
            getUserFacingErrorMessage(
              cause,
              "常用作业面读取失败，请重试；不能视为没有历史记录。"
            )
          );
      })
      .finally(() => {
        if (!cancelled && sequence === requestSequence.current)
          setLoading(false);
      });
    return () => {
      cancelled = true;
      requestSequence.current += 1;
    };
  }, [enabled, open, keyword, debouncedKeyword, revision]);
  const busy = loading || keyword !== debouncedKeyword;
  function choose(item: WorkAreaOption) {
    if (!enabled || !open || busy || error) return;
    onChange(item.workArea);
    setOpen(false);
  }
  function keyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (busy || error || !items.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight(current =>
        event.key === "ArrowDown"
          ? (current + 1) % items.length
          : current <= 0
            ? items.length - 1
            : current - 1
      );
    } else if (event.key === "Enter" && highlight >= 0) {
      event.preventDefault();
      choose(items[highlight]);
    }
  }
  return (
    <Popover
      open={open && enabled}
      onOpenChange={next => {
        if (enabled) {
          setOpen(next);
          if (next) {
            setKeyword("");
            setDebouncedKeyword("");
            setItems([]);
            setLoading(true);
            setError("");
          }
        }
      }}
    >
      <div className="relative w-full min-w-0">
        <Input
          id={id}
          aria-label="施工部位 / 作业面"
          value={value}
          maxLength={200}
          placeholder={placeholder || "可选择常用作业面，也可手动输入"}
          disabled={disabled}
          className="pr-32"
          onChange={event => {
            if (!disabled) onChange(event.target.value);
          }}
        />
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="常用作业面"
            aria-haspopup="listbox"
            disabled={!enabled}
            className="absolute inset-y-0 right-1 my-auto h-8 gap-1 px-2 text-xs"
          >
            常用作业面 <ChevronDown aria-hidden="true" className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
      </div>
      <PopoverContent
        align="end"
        className="w-[min(24rem,calc(100vw-3rem))] space-y-2 p-3"
        onKeyDown={keyDown}
      >
        <Input
          aria-label="搜索常用作业面"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${sessionId}-options`}
          aria-activedescendant={
            highlight >= 0 ? `${sessionId}-option-${highlight}` : undefined
          }
          placeholder="搜索已保存日报的作业面"
          maxLength={100}
          value={keyword}
          onChange={event => {
            setKeyword(event.target.value.slice(0, 100));
            setItems([]);
            setHighlight(-1);
            setError("");
          }}
        />
        {busy ? (
          <p role="status" className="text-xs text-muted-foreground">
            正在读取常用作业面…
          </p>
        ) : error ? (
          <div role="alert" className="text-xs text-destructive">
            {error}
            <Button
              type="button"
              size="sm"
              variant="link"
              onClick={() => setRevision(current => current + 1)}
            >
              重试
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {debouncedKeyword.trim()
              ? "暂无匹配的已保存作业面，可继续手动输入。"
              : "当前项目暂无已保存作业面，可手动输入新作业面。"}
          </p>
        ) : null}
        <div
          id={`${sessionId}-options`}
          role="listbox"
          aria-label="常用作业面选项"
          className="max-h-60 space-y-1 overflow-y-auto"
        >
          {!busy &&
            !error &&
            items.map((item, index) => (
              <button
                key={item.workArea}
                id={`${sessionId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={value === item.workArea}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring ${highlight === index ? "bg-accent" : ""}`}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(item)}
              >
                <span className="min-w-0 break-words">
                  {item.workArea}
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    已使用 {item.useCount} 次
                  </span>
                </span>
                {value === item.workArea ? (
                  <Check aria-hidden="true" className="h-4 w-4 shrink-0" />
                ) : null}
              </button>
            ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          仅当前授权项目已保存日报；选择只回填，不自动保存。
        </p>
      </PopoverContent>
    </Popover>
  );
}
