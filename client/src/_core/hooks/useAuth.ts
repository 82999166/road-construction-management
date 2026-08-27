import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo, useState } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  // Login is started via startLogin() in the effect below, only when we actually
  // navigate — never during render. startLogin() mints a one-time nonce + writes
  // the state cookie, so calling it per render would overwrite the cookie and
  // desync it from an in-flight login's `state`.
  const { redirectOnUnauthenticated = false, redirectPath } = options ?? {};
  const utils = trpc.useUtils();
  /**
   * 认证请求通常应在数秒内结束。超过阈值时不再让页面永久显示加载态，
   * 而是安全地按未登录状态降级；用户仍可通过刷新或登录按钮重新发起认证。
   */
  const [authLoadingTimedOut, setAuthLoadingTimedOut] = useState(false);

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  useEffect(() => {
    if (!meQuery.isLoading) {
      setAuthLoadingTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setAuthLoadingTimedOut(true), 8_000);
    return () => window.clearTimeout(timer);
  }, [meQuery.isLoading]);

  // 清理历史版本遗留的认证镜像。真正的会话继续只依赖 HttpOnly Cookie，浏览器本地不持久化用户对象。
  useEffect(() => {
    try {
      localStorage.removeItem("manus-runtime-user-info");
    } catch {}
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      // Clear the Preview auto-login token mirrored into sessionStorage, so
      // header-based sessions (Safari ITP / WebView) are logged out too. The
      // backend cookie is cleared by the logout mutation.
      try {
        sessionStorage.removeItem("manus-cookie");
        localStorage.removeItem("manus-runtime-user-info");
      } catch {}
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, utils]);

  const state = useMemo(() => {
    return {
      user: meQuery.data ?? null,
      loading: (meQuery.isLoading && !authLoadingTimedOut) || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
      authLoadingTimedOut,
    };
  }, [
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    authLoadingTimedOut,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (redirectPath && window.location.pathname === redirectPath) return;

    // Navigate at this moment only. startLogin() mints the nonce + cookie itself.
    if (redirectPath) {
      window.location.href = redirectPath;
    } else {
      startLogin();
    }
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    state.user,
  ]);

  return {
    ...state,
    /** 手动重试会先清除超时降级标识，再调用 tRPC 的原始刷新逻辑。 */
    refresh: () => {
      setAuthLoadingTimedOut(false);
      return meQuery.refetch();
    },
    logout,
  };
}
