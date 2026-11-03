import { useCallback, useEffect, useRef, useState } from "react";

export type TaxWorkspaceSection = "materials" | "batches" | "review";

/** All available read procedures are aggregate reads; never gate by profile existence. */
export function taxWorkspaceQueryEnabled(
  enabled: boolean,
  projectId: number,
  section: TaxWorkspaceSection,
  owner: "handoff" | "review"
) {
  return (
    enabled &&
    projectId > 0 &&
    (owner === "review" ? section === "review" : section !== "review")
  );
}

export const taxScopeKey = (projectId: number, period: string) =>
  `${projectId}:${period}`;
export const taxDraftChanged = <T,>(draft: T, baseline: T) =>
  JSON.stringify(draft) !== JSON.stringify(baseline);

/** Form state lives above secondary panels and is reset only by the keyed scope boundary. */
export function useTaxDraft<T>(initial: T) {
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const dirty = taxDraftChanged(draft, baseline);
  const load = useCallback((value: T) => {
    setDraft(value);
    setBaseline(value);
  }, []);
  // Call with the submitted snapshot so edits made while a mutation is pending stay dirty.
  const markSaved = useCallback((value: T) => setBaseline(value), []);
  const reset = useCallback(() => setDraft(baseline), [baseline]);
  const submitted = useRef(initial);
  const capture = useCallback(() => {
    submitted.current = draft;
  }, [draft]);
  const commit = useCallback(() => setBaseline(submitted.current), []);
  const initialValue = useRef(initial);
  const commitAndReset = useCallback(() => {
    if (!taxDraftChanged(draft, submitted.current)) {
      setDraft(initialValue.current);
      setBaseline(initialValue.current);
    } else {
      setBaseline(submitted.current);
    }
  }, [draft]);
  return {
    draft,
    setDraft,
    dirty,
    load,
    markSaved,
    reset,
    capture,
    commit,
    commitAndReset,
  };
}

/** Callback identity changes must not emit a spurious clean state into the parent's guard. */
export function useTaxDirtyReport(
  dirty: boolean,
  onDirtyChange?: (dirty: boolean) => void
) {
  const callback = useRef(onDirtyChange);
  callback.current = onDirtyChange;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(
    () => () => {
      callback.current?.(false);
    },
    []
  );
}

/** A result from an unmounted scope must not download files or update the new scope. */
export function useTaxScopeAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}
