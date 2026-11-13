import { useMemo, type ReactNode } from "react";
import { useLaborWorkspaceFilters } from "@/hooks/useLaborWorkspaceFilters";
import { useLaborWorkspaceQueries } from "@/hooks/useLaborWorkspaceQueries";

export type LaborWorkspaceRenderState = {
  filters: ReturnType<typeof useLaborWorkspaceFilters>;
  queries: ReturnType<typeof useLaborWorkspaceQueries>;
};

type Props = {
  enabled: boolean;
  projectId: number;
  initialAttendanceDate: string;
  children: (state: LaborWorkspaceRenderState) => ReactNode;
};

/**
 * 劳务工资的本地筛选、查询输入与 tRPC 查询均在本模块内创建。
 * 组件只会在后台进入“劳务工资”菜单后通过 lazy() 挂载；项目范围、业务字段完整展示、
 * 会计审核与付款权限仍由原有服务端接口最终裁决。
 */
export default function LaborWorkspaceLoader({
  enabled,
  projectId,
  initialAttendanceDate,
  children,
}: Props) {
  const filters = useLaborWorkspaceFilters(initialAttendanceDate);
  const workspaceProjectInput = useMemo(() => ({ projectId }), [projectId]);
  const laborWorkspaceInput = useMemo(
    () => ({ projectId, includeLeft: true }),
    [projectId]
  );
  const payrollWorkspaceInput = useMemo(
    () => ({ projectId, period: filters.laborPeriod || undefined }),
    [filters.laborPeriod, projectId]
  );
  const laborCheckInWorkspaceInput = useMemo(
    () => ({ businessDate: filters.laborAttendanceDate || undefined }),
    [filters.laborAttendanceDate]
  );
  const queries = useLaborWorkspaceQueries({
    enabled,
    workspaceProjectInput,
    laborWorkspaceInput,
    payrollWorkspaceInput,
    laborCheckInWorkspaceInput,
  });
  return <>{children({ filters, queries })}</>;
}
