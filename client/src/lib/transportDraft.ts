import { useEffect } from "react";
export type TransportDirtyChange = (dirty: boolean) => void;
/** Only report boolean changes; stable parent callbacks avoid rerender loops. */
export function useTransportDirty(
  dirty: boolean,
  onDirtyChange?: TransportDirtyChange
) {
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
}
/** Shared by Cancel, Escape and overlay closes. A declined confirmation leaves the draft intact. */
export function discardTransportDraft(
  dirty: boolean,
  discard: () => void,
  confirm: (message: string) => boolean = message => window.confirm(message)
) {
  if (dirty && !confirm("尚有未保存运输草稿，确认放弃修改？此操作不是保存。"))
    return false;
  discard();
  return true;
}
