import { useAuth } from "@/_core/hooks/useAuth";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, BadgeCheck, HardHat, ShieldCheck, UserRound } from "lucide-react";
import { useLocation } from "wouter";

/**
 * 移动端个人中心只展示本人的脱敏身份与服务端已授权范围，
 * 不暴露组织成员、银行卡、身份证或未授权项目清单。
 */
export default function MobileProfilePage() {
  const { user, loading, isAuthenticated, authLoadingTimedOut, refresh } = useAuth();
  const [, navigate] = useLocation();
  const workbench = trpc.mobile.workbench.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const scope = workbench.data?.dataScope;
  const roleCodes = workbench.data?.user.roleCodes ?? [];
  const scopeText = scope?.hasAllProjects ? "全部项目范围" : `已授权 ${scope?.projectIds.length ?? 0} 个项目范围`;

  return (
    <MobileAccessGate isAuthenticated={isAuthenticated} isLoading={loading || workbench.isLoading} authLoadingTimedOut={authLoadingTimedOut} loadingText="正在加载个人授权信息…" title="个人中心" description="请先通过企业统一身份登录后查看您的岗位和数据范围。" Icon={UserRound} onRetry={() => Promise.all([refresh(), workbench.refetch()])}>
      <div className="min-h-screen bg-[#f8f1e7] text-[#3b2118]">
        <div className="mx-auto min-h-screen max-w-xl bg-[#fdf7ee] shadow-[0_0_50px_rgba(74,42,29,.12)]">
          <header className="bg-[#3a2117] px-5 pb-8 pt-6 text-[#fff7ea]"><button className="inline-flex items-center gap-1 text-xs text-[#e8cfb2]" onClick={() => navigate("/mobile")}><ArrowLeft className="h-4 w-4" />返回工作台</button><div className="mt-7 flex items-center gap-4"><div className="grid h-16 w-16 place-items-center rounded-[24px] bg-[#c9854a]"><HardHat className="h-8 w-8" /></div><div><p className="text-xs text-[#e8cfb2]">企业统一身份</p><h1 className="mt-1 text-2xl font-semibold">{user?.name ?? "项目成员"}</h1></div></div></header>
          <main className="space-y-4 px-5 py-6"><section className="rounded-2xl bg-white p-4 shadow-[0_8px_22px_rgba(71,42,30,.07)]"><div className="flex items-start gap-3"><BadgeCheck className="mt-0.5 h-5 w-5 text-[#a85d2f]" /><div><h2 className="text-sm font-semibold">当前岗位</h2><p className="mt-1 text-xs leading-5 text-[#765542]">{roleCodes.length ? roleCodes.join(" · ") : "尚未分配业务岗位"}</p></div></div></section><section className="rounded-2xl bg-white p-4 shadow-[0_8px_22px_rgba(71,42,30,.07)]"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-[#a85d2f]" /><div><h2 className="text-sm font-semibold">数据范围</h2><p className="mt-1 text-xs leading-5 text-[#765542]">{scopeText}。实际查询和操作仍由服务端逐项校验。</p></div></div></section><Button className="w-full bg-[#3a2117] text-[#fff7ea] hover:bg-[#512e20]" onClick={() => navigate("/mobile")}>返回我的业务</Button></main>
        </div>
      </div>
    </MobileAccessGate>
  );
}
