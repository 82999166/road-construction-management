import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type TextWeightPreference = "normal" | "bold";
export type LayoutScalePreference = "normal" | "large";

export type AccessibilityPreferences = {
  version: 1;
  textWeight: TextWeightPreference;
  layoutScale: LayoutScalePreference;
};

type AccessibilityPreferencesContextValue = {
  preferences: AccessibilityPreferences;
  setTextWeight: (textWeight: TextWeightPreference) => void;
  setLayoutScale: (layoutScale: LayoutScalePreference) => void;
  reset: () => void;
};

const STORAGE_KEY = "yx.ui-accessibility.v1";
const DEFAULT_PREFERENCES: AccessibilityPreferences = {
  version: 1,
  textWeight: "normal",
  layoutScale: "normal",
};

const noop = () => undefined;
const FALLBACK_CONTEXT: AccessibilityPreferencesContextValue = {
  preferences: DEFAULT_PREFERENCES,
  setTextWeight: noop,
  setLayoutScale: noop,
  reset: noop,
};

const AccessibilityPreferencesContext = createContext<AccessibilityPreferencesContextValue>(FALLBACK_CONTEXT);

function isPreferences(value: unknown): value is AccessibilityPreferences {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AccessibilityPreferences>;
  return candidate.version === 1
    && (candidate.textWeight === "normal" || candidate.textWeight === "bold")
    && (candidate.layoutScale === "normal" || candidate.layoutScale === "large");
}

export function parseAccessibilityPreferences(value: string | null | undefined): AccessibilityPreferences {
  if (!value) return DEFAULT_PREFERENCES;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPreferences(parsed) ? parsed : DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function readPreferencesFromStorage() {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    return parseAccessibilityPreferences(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/**
 * 个人辅助显示只保存在当前浏览器设备，不包含业务、身份或权限资料。
 * 全局根属性由 CSS 令牌消费，不使用 zoom/transform，避免破坏固定导航与弹窗定位。
 */
export function AccessibilityPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState<AccessibilityPreferences>(readPreferencesFromStorage);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.textWeight = preferences.textWeight;
    root.dataset.layoutScale = preferences.layoutScale;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // 隐私模式或受限 WebView 下继续在当前页面有效，不阻断业务界面。
    }
  }, [preferences]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      setPreferences(parseAccessibilityPreferences(event.newValue));
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const value = useMemo<AccessibilityPreferencesContextValue>(() => ({
    preferences,
    setTextWeight: textWeight => setPreferences(current => ({ ...current, textWeight })),
    setLayoutScale: layoutScale => setPreferences(current => ({ ...current, layoutScale })),
    reset: () => setPreferences(DEFAULT_PREFERENCES),
  }), [preferences]);

  return <AccessibilityPreferencesContext.Provider value={value}>{children}</AccessibilityPreferencesContext.Provider>;
}

export function useAccessibilityPreferences() {
  return useContext(AccessibilityPreferencesContext);
}

export { DEFAULT_PREFERENCES, STORAGE_KEY };
