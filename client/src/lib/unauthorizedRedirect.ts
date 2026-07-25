import { UNAUTHED_ERR_MSG } from "@shared/const";
import { getUnauthorizedLoginRedirectPath } from "./authNavigation";

/**
 * 将 tRPC 未授权错误统一转换为独立登录页导航。
 * 返回值用于测试与调用方判断是否实际触发了浏览器重定向。
 */
export function redirectToLoginForUnauthorizedError(
  errorMessage: string | undefined,
  currentPath: string,
  replace: (path: string) => void,
) {
  if (errorMessage !== UNAUTHED_ERR_MSG) return false;

  const loginPath = getUnauthorizedLoginRedirectPath(currentPath);
  if (!loginPath) return false;

  replace(loginPath);
  return true;
}
