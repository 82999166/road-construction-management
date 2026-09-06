export const DYNAMIC_IMPORT_RECOVERY_KEY = "yx-dynamic-import-recovery-at";
export const DYNAMIC_IMPORT_RECOVERY_WINDOW_MS = 60_000;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
  return "";
}

/** Vite 动态分包在版本原子切换后找不到旧哈希文件时的各浏览器错误文本。 */
export function isDynamicImportLoadError(error: unknown) {
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk .* failed/i.test(getErrorMessage(error));
}

export function canRecoverDynamicImport(lastReloadedAt: number, now: number) {
  return !Number.isFinite(lastReloadedAt) || lastReloadedAt <= 0 || now - lastReloadedAt >= DYNAMIC_IMPORT_RECOVERY_WINDOW_MS;
}

/**
 * 只针对静态分包加载失败刷新一次：刷新会取到新的 index.html 与最新哈希资源，
 * 不会重放 tRPC 请求或 mutation。60 秒内再次失败则保留错误页，避免网络故障循环刷新。
 */
export function recoverDynamicImportLoadError(error: unknown) {
  if (typeof window === "undefined" || !isDynamicImportLoadError(error)) return false;
  try {
    const now = Date.now();
    const lastReloadedAt = Number(sessionStorage.getItem(DYNAMIC_IMPORT_RECOVERY_KEY) ?? "0");
    if (!canRecoverDynamicImport(lastReloadedAt, now)) return false;
    sessionStorage.setItem(DYNAMIC_IMPORT_RECOVERY_KEY, String(now));
  } catch {
    // 存储被禁用时仍刷新当前页面一次；不会触发任何业务写入或请求重放。
  }
  window.location.reload();
  return true;
}
