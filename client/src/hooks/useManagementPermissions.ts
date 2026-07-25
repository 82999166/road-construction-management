import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

/**
 * 前端仅用此结果收敛菜单与高影响操作的可见性；真实权限始终由服务端过程再次校验。
 * `admin.access` 对已登录的非超级管理员安全返回 false，因此可复用于移动业务页。
 */
export function useManagementPermissions() {
  const { isAuthenticated } = useAuth();
  const access = trpc.admin.access.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
    staleTime: 60_000,
  });

  return {
    isSuperAdmin: Boolean(access.data?.canAccess),
    isLoading: isAuthenticated && access.isLoading,
  };
}
