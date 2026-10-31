import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAccessibilityPreferences } from "@/contexts/AccessibilityPreferencesContext";
import { Accessibility, RotateCcw, Type } from "lucide-react";
import React from "react";

export function DisplayPreferencesControls({ idPrefix = "display-preferences" }: { idPrefix?: string }) {
  const { preferences, setTextWeight, setLayoutScale, reset } = useAccessibilityPreferences();
  const hasCustomPreference = preferences.textWeight !== "normal" || preferences.layoutScale !== "normal";

  return (
    <div className="space-y-3" aria-live="polite">
      <div className="flex min-h-14 items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
        <label className="min-w-0" htmlFor={`${idPrefix}-weight`}>
          <span className="block text-sm font-semibold text-slate-800">粗体显示</span>
          <span className="mt-0.5 block text-xs leading-5 text-slate-500">增强正文、标签和表格文字的辨识度。</span>
        </label>
        <Switch
          id={`${idPrefix}-weight`}
          className="h-6 w-11 data-[state=checked]:bg-[#2d6b63]"
          checked={preferences.textWeight === "bold"}
          onCheckedChange={checked => setTextWeight(checked ? "bold" : "normal")}
          aria-label="切换粗体显示"
        />
      </div>
      <div className="flex min-h-14 items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
        <label className="min-w-0" htmlFor={`${idPrefix}-scale`}>
          <span className="block text-sm font-semibold text-slate-800">放大版面</span>
          <span className="mt-0.5 block text-xs leading-5 text-slate-500">放大文字和常用操作区域，便于阅读与触控。</span>
        </label>
        <Switch
          id={`${idPrefix}-scale`}
          className="h-6 w-11 data-[state=checked]:bg-[#2d6b63]"
          checked={preferences.layoutScale === "large"}
          onCheckedChange={checked => setLayoutScale(checked ? "large" : "normal")}
          aria-label="切换放大版面"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <p className="text-xs text-slate-500">仅保存到本设备浏览器，打印凭证不受影响。</p>
        <Button type="button" size="sm" variant="outline" disabled={!hasCustomPreference} onClick={reset}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />恢复默认
        </Button>
      </div>
    </div>
  );
}

/** PC 端可复用入口；移动端在“我的”中直接显示同一组开关。 */
export function DisplayPreferencesPanel({ className }: { className?: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className={className}>
          <Accessibility className="mr-1.5 h-4 w-4" />显示与辅助
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Type className="h-5 w-5 text-[#2d6b63]" />显示与辅助</DialogTitle>
          <DialogDescription>为当前设备调整阅读与操作显示，不会改变业务数据、权限或 A4 打印版式。</DialogDescription>
        </DialogHeader>
        <DisplayPreferencesControls />
      </DialogContent>
    </Dialog>
  );
}
