/**
 * 独立登录页的站内返回路径工具。
 *
 * OAuth 回调固定返回应用根路径，因此将用户原始业务路径暂存到同源 sessionStorage；
 * 不接受绝对 URL、协议相对 URL 或非站内路径，避免认证成功后发生开放重定向。
 */
export const LOGIN_ROUTE = "/login";
export const POST_LOGIN_RETURN_KEY = "road-construction-management:post-login-return";

export function getCurrentAppPath() {
  if (typeof window === "undefined") return "/mobile";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function sanitizeReturnPath(candidate: string | null | undefined, fallback = "/mobile") {
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return fallback;
  }

  return candidate;
}

export function createLoginPath(returnTo?: string | null) {
  const safeReturnTo = sanitizeReturnPath(returnTo, "");
  if (!safeReturnTo || safeReturnTo === LOGIN_ROUTE) return LOGIN_ROUTE;
  return `${LOGIN_ROUTE}?returnTo=${encodeURIComponent(safeReturnTo)}`;
}

/** 已认证用户访问登录页时，只能回到经过站内路径校验的目标页。 */
export function getAuthenticatedLoginRedirectTarget(isAuthenticated: boolean, loading: boolean, returnTo: string) {
  if (!isAuthenticated || loading) return null;
  return sanitizeReturnPath(returnTo);
}

/**
 * tRPC 未授权响应的统一跳转目标。登录页自身不再重定向，避免认证失败时循环刷新。
 */
export function getUnauthorizedLoginRedirectPath(currentPath: string) {
  const pathname = currentPath.split(/[?#]/, 1)[0];
  if (pathname === LOGIN_ROUTE || pathname.startsWith(`${LOGIN_ROUTE}/`)) return null;
  return createLoginPath(currentPath);
}

export function getLoginReturnPath(search: string, fallback = "/mobile") {
  const params = new URLSearchParams(search);
  return sanitizeReturnPath(params.get("returnTo"), fallback);
}

export function rememberPostLoginReturnPath(returnTo: string) {
  try {
    sessionStorage.setItem(POST_LOGIN_RETURN_KEY, sanitizeReturnPath(returnTo));
  } catch {
    // 私密浏览或受限 WebView 可能禁用 sessionStorage；此时安全回退到移动工作台。
  }
}

export function consumePostLoginReturnPath(fallback = "/mobile") {
  try {
    const stored = sessionStorage.getItem(POST_LOGIN_RETURN_KEY);
    sessionStorage.removeItem(POST_LOGIN_RETURN_KEY);
    return sanitizeReturnPath(stored, fallback);
  } catch {
    return fallback;
  }
}
