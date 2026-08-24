import ContractManagementPanel from "@/components/ContractManagementPanel";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { FileText } from "lucide-react";

/** 普通管理员的外包合同入口；数据与操作权限仍由合同路由按项目范围二次校验。 */
export default function MobileContractPage() {
  const { isAuthenticated, loading, authLoadingTimedOut, refresh } = useAuth();
  const projects = trpc.mobile.attendanceProjects.useQuery(undefined, { enabled: isAuthenticated, retry: false });

  if (loading || !isAuthenticated || projects.isLoading) {
    return <MobileAccessGate isAuthenticated={isAuthenticated} isLoading={loading || (isAuthenticated && projects.isLoading)} authLoadingTimedOut={authLoadingTimedOut} loadingText="正在加载合同管理…" title="外包合同管理" description="系统将按您的合同权限和项目范围加载可办理合同。" Icon={FileText} onRetry={() => { void refresh(); void projects.refetch(); }} />;
  }

  return <main className="min-h-screen bg-[#f8f1e7] px-4 py-5 text-[#3b2118] sm:px-6 lg:px-8"><div className="mx-auto max-w-7xl"><ContractManagementPanel projects={projects.data?.projects ?? []} /></div></main>;
}
