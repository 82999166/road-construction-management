import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";

type RegisteredMobileForm = {
  id: string;
  label: string;
  isDirty: boolean;
  saveDraft?: () => void | Promise<void>;
  discard?: () => void;
};

type PendingExit = {
  forms: RegisteredMobileForm[];
  action: () => void;
};

type MobileFormProtectionContextValue = {
  registerForm: (form: RegisteredMobileForm) => () => void;
  requestExit: (formId: string, action: () => void) => void;
  requestNavigation: (action: () => void) => void;
};

const MobileFormProtectionContext = createContext<MobileFormProtectionContextValue | null>(null);

/**
 * 只守护移动端的未提交输入。服务端业务草稿与本机临时草稿严格分开：
 * “保存本机草稿”不会创建、审核或提交任何业务单据。
 */
export function MobileFormProtectionProvider({ children }: { children: React.ReactNode }) {
  const formsRef = useRef(new Map<string, RegisteredMobileForm>());
  const [pendingExit, setPendingExit] = useState<PendingExit | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const registerForm = useCallback((form: RegisteredMobileForm) => {
    formsRef.current.set(form.id, form);
    return () => formsRef.current.delete(form.id);
  }, []);

  const openExitConfirmation = useCallback((forms: RegisteredMobileForm[], action: () => void) => {
    if (!forms.some(form => form.isDirty)) {
      action();
      return;
    }
    setSaveError("");
    setPendingExit({ forms: forms.filter(form => form.isDirty), action });
  }, []);

  const requestExit = useCallback((formId: string, action: () => void) => {
    const form = formsRef.current.get(formId);
    if (!form) {
      action();
      return;
    }
    openExitConfirmation([form], action);
  }, [openExitConfirmation]);

  const requestNavigation = useCallback((action: () => void) => {
    openExitConfirmation(Array.from(formsRef.current.values()), action);
  }, [openExitConfirmation]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!Array.from(formsRef.current.values()).some(form => form.isDirty)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  const value = useMemo(() => ({ registerForm, requestExit, requestNavigation }), [registerForm, requestExit, requestNavigation]);

  async function saveAndExit() {
    if (!pendingExit) return;
    setSaving(true);
    setSaveError("");
    try {
      await Promise.all(pendingExit.forms.map(form => form.saveDraft?.()));
      const action = pendingExit.action;
      setPendingExit(null);
      action();
    } catch (error) {
      setSaveError(error instanceof Error && error.message ? error.message : "本机草稿未保存成功，请检查设备存储权限后重试，或选择放弃填写。");
    } finally {
      setSaving(false);
    }
  }

  function discardAndExit() {
    if (!pendingExit) return;
    pendingExit.forms.forEach(form => form.discard?.());
    const action = pendingExit.action;
    setPendingExit(null);
    action();
  }

  const formLabels = pendingExit?.forms.map(form => form.label).filter(Boolean) ?? [];
  return <MobileFormProtectionContext.Provider value={value}>
    {children}
    <AlertDialog open={Boolean(pendingExit)} onOpenChange={open => { if (!open && !saving) setPendingExit(null); }}>
      <AlertDialogContent className="border-[#ead9c8] bg-[#fffaf3]">
        <AlertDialogHeader>
          <AlertDialogTitle>您有未提交的填写内容</AlertDialogTitle>
          <AlertDialogDescription>
            {formLabels.length > 1 ? `“${formLabels.join("、")}”中有尚未提交的内容。` : `“${formLabels[0] ?? "当前表单"}”中有尚未提交的内容。`}
            可仅保存为本机临时草稿，稍后在这台设备继续填写；不会提交、审核或生成业务单据。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {saveError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">{saveError}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>继续填写</AlertDialogCancel>
          <button type="button" disabled={saving} className="inline-flex h-9 items-center justify-center rounded-md border border-amber-300 bg-amber-50 px-4 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-50" onClick={discardAndExit}>放弃填写</button>
          <AlertDialogAction disabled={saving} onClick={event => { event.preventDefault(); void saveAndExit(); }}>
            {saving ? "正在保存…" : "保存本机草稿并退出"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </MobileFormProtectionContext.Provider>;
}

export function useMobileFormProtection(form: RegisteredMobileForm) {
  const context = useContext(MobileFormProtectionContext);
  const formRef = useRef(form);
  formRef.current = form;

  useEffect(() => {
    if (!context) return;
    return context.registerForm({
      id: formRef.current.id,
      label: formRef.current.label,
      isDirty: formRef.current.isDirty,
      saveDraft: () => formRef.current.saveDraft?.(),
      discard: () => formRef.current.discard?.(),
    });
  }, [context, form.id, form.label, form.isDirty, form.saveDraft, form.discard]);

  return {
    // 单页渲染测试不挂载应用根 Provider 时保持可渲染；正式 App 已强制挂载 Provider。
    requestClose: (action: () => void) => context ? context.requestExit(form.id, action) : action(),
    requestNavigation: (action: () => void) => context ? context.requestNavigation(action) : action(),
  };
}

/** 在移动业务页替代直接 navigate，离开页面前统一检查未提交输入。 */
export function useMobileSafeNavigate() {
  const [, navigate] = useLocation();
  const context = useContext(MobileFormProtectionContext);
  return useCallback((to: string, options?: { replace?: boolean }) => {
    if (context) context.requestNavigation(() => navigate(to, options));
    else navigate(to, options);
  }, [context, navigate]);
}
