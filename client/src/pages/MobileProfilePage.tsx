import { useAuth } from "@/_core/hooks/useAuth";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { DisplayPreferencesControls } from "@/components/DisplayPreferencesPanel";
import { Button } from "@/components/ui/button";
import { createLoginPath } from "@/lib/authNavigation";
import { trpc } from "@/lib/trpc";
import { Accessibility, ArrowLeft, BadgeCheck, BellRing, CheckCircle2, HardHat, KeyRound, Link2, LogOut, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import React from "react";
import { useLocation, useSearch } from "wouter";

const ROLE_CODE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "超级管理员",
  SYSTEM_ADMIN: "系统管理员",
  PROJECT_MANAGER: "项目经理",
  CONSTRUCTION_MANAGER: "施工管理员",
  SITE_MANAGER: "现场管理员",
  TRANSPORT_MANAGER: "运输管理员",
  DRIVER: "运输司机",
  MACHINERY_MANAGER: "机械管理员",
  PURCHASING_MANAGER: "采购管理员",
  WAREHOUSE_MANAGER: "仓储管理员",
  LABOR_MANAGER: "劳务管理员",
  FINANCE_MANAGER: "财务管理员",
  ACCOUNTANT: "会计",
  SAFETY_MANAGER: "安全管理员",
  ADMIN: "管理员",
  EMPLOYEE: "项目成员",
};

function roleCodeLabel(roleCode: string) {
  return ROLE_CODE_LABELS[roleCode] ?? "已授权岗位";
}

/**
 * 移动端个人中心只展示本人的脱敏身份与服务端已授权范围，
 * 不暴露组织成员、银行卡、身份证或未授权项目清单。
 */
export default function MobileProfilePage() {
  const { user, loading, isAuthenticated, authLoadingTimedOut, refresh, logout } = useAuth();
  const [, navigate] = useLocation();
  const search = useSearch();
  const workbench = trpc.mobile.workbench.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const officialBinding = trpc.officialAccount.bindingStatus.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const [bindingFeedback, setBindingFeedback] = React.useState<string | null>(null);
  const bindingMutation = trpc.officialAccount.beginBinding.useMutation({
    onSuccess: result => {
      if (!result.url) {
        setBindingFeedback("服务号尚未完成后台发布配置，请联系超级管理员。");
        return;
      }
      window.location.assign(result.url);
    },
    onError: () => setBindingFeedback("暂时无法发起公众号绑定，请稍后重试。"),
  });
  const verifyFollowMutation = trpc.officialAccount.verifyFollowStatus.useMutation({
    onSuccess: async result => {
      await officialBinding.refetch();
      setBindingFeedback(result.status === "active" ? "已通过微信实时核验确认关注服务号，通知身份已恢复。" : result.status === "unsubscribed" ? "微信实时核验显示该微信当前未关注服务号，请在关注后再次核验。" : result.status === "unbound" ? "尚未完成微信身份绑定，请在微信内重新绑定。" : "暂时无法完成微信实时核验，系统已保留原绑定状态，请稍后重试。");
    },
    onError: () => setBindingFeedback("暂时无法完成微信实时核验，系统已保留原绑定状态，请稍后重试。"),
  });
  const scope = workbench.data?.dataScope;
  const roleCodes = workbench.data?.user.roleCodes ?? [];
  const scopeText = scope?.hasAllProjects ? "全部项目范围" : `已授权 ${scope?.projectIds.length ?? 0} 个项目范围`;
  const bindingResult = new URLSearchParams(search).get("officialAccount");
  const bound = officialBinding.data?.status === "active";
  const needsFollowOfficialAccount = officialBinding.data?.status === "unsubscribed";
  const bindingStatusText = bound ? "已绑定，可接收审核、运输和项目通知" : needsFollowOfficialAccount ? "已识别微信身份，但当前尚未关注服务号，暂无法接收通知" : officialBinding.data?.status === "unavailable" ? "状态暂不可用，请稍后刷新" : "未绑定，暂无法接收公众号业务提醒";
  const bindingGuideText = needsFollowOfficialAccount ? "请先关注公司的认证服务号，再点击下方按钮重新绑定；关注后系统才可向该微信发送业务通知。" : "请先关注公司的认证服务号，再在微信内点击绑定。系统不会展示或返回微信身份标识。";
  const notificationRoleHint = roleCodes.includes("DRIVER") ? "司机：接收装土、卸土、异常和运输结算提醒。" : roleCodes.some(code => ["TRANSPORT_MANAGER", "CONSTRUCTION_MANAGER", "PROJECT_MANAGER"].includes(code)) ? "现场管理员、施工员或指挥员：接收刷卡异常、待审核和项目动态提醒。" : roleCodes.some(code => ["FINANCE_MANAGER", "ACCOUNTANT", "SUPER_ADMIN"].includes(code)) ? "管理与财务岗位：接收审批待办、汇总和异常上报提醒。" : "所有已授权岗位均可绑定，用于接收自身项目范围内的业务提醒。";

  /** 安全退出只在会话清理成功后进入独立登录页，失败时保留当前页面以避免误导用户已退出。 */
  const handleSecureLogout = () => {
    void logout().then(() => navigate(createLoginPath("/mobile/profile"))).catch(() => undefined);
  };

  return (
    <MobileAccessGate isAuthenticated={isAuthenticated} isLoading={loading || workbench.isLoading} authLoadingTimedOut={authLoadingTimedOut} loadingText="正在加载个人授权信息…" title="个人中心" description="请先通过企业统一身份登录后查看您的岗位和数据范围。" Icon={UserRound} onRetry={() => Promise.all([refresh(), workbench.refetch(), officialBinding.refetch()])}>
      <div className="min-h-screen bg-[#f8f1e7] text-[#3b2118]">
        <div className="mobile-viewport-shell mx-auto min-h-screen max-w-xl bg-[#fdf7ee] shadow-[0_0_50px_rgba(74,42,29,.12)]">
          <header className="bg-[#3a2117] px-5 pb-8 pt-6 text-[#fff7ea]"><button className="inline-flex items-center gap-1 text-xs text-[#e8cfb2]" onClick={() => navigate("/mobile")}><ArrowLeft className="h-4 w-4" />返回工作台</button><div className="mt-7 flex items-center gap-4"><div className="grid h-16 w-16 place-items-center rounded-[24px] bg-[#c9854a]"><HardHat className="h-8 w-8" /></div><div><p className="text-xs text-[#e8cfb2]">企业统一身份</p><h1 className="mt-1 text-2xl font-semibold">{user?.name ?? "项目成员"}</h1></div></div></header>
          <main className="space-y-4 px-5 py-6">
            {bindingResult === "bound" && <p className="rounded-xl bg-[#e7f4e7] px-3 py-2 text-xs leading-5 text-[#35643a]">公众号通知身份已绑定成功，后续审核、运输和项目提醒将发送到您的微信。</p>}
            {bindingResult === "conflict" && <p className="rounded-xl bg-[#fff1dc] px-3 py-2 text-xs leading-5 text-[#8c571f]">该微信已关联其他系统账号，请联系超级管理员处理。</p>}
            {bindingResult === "failed" && <p className="rounded-xl bg-[#fff1dc] px-3 py-2 text-xs leading-5 text-[#8c571f]">公众号绑定未完成，请在微信内重新发起绑定。</p>}
            <section className="rounded-2xl bg-white p-4 shadow-[0_8px_22px_rgba(71,42,30,.07)]"><div className="flex items-start gap-3"><BadgeCheck className="mt-0.5 h-5 w-5 text-[#a85d2f]" /><div><h2 className="text-sm font-semibold">当前岗位</h2><p className="mt-1 text-xs leading-5 text-[#765542]">{roleCodes.length ? roleCodes.map(roleCodeLabel).join(" · ") : "尚未分配业务岗位"}</p></div></div></section>
            <section className="rounded-2xl bg-white p-4 shadow-[0_8px_22px_rgba(71,42,30,.07)]"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-[#a85d2f]" /><div><h2 className="text-sm font-semibold">数据范围</h2><p className="mt-1 text-xs leading-5 text-[#765542]">{scopeText}。实际查询和操作仍由服务端逐项校验。</p></div></div></section>
            <section className="rounded-2xl border border-[#d6e1dc] bg-[#f7fbf9] p-4 shadow-[0_8px_22px_rgba(71,42,30,.05)]"><div className="mb-3 flex items-start gap-3"><Accessibility className="mt-0.5 h-5 w-5 text-[#2d6b63]" /><div><h2 className="text-sm font-semibold">显示与辅助</h2><p className="mt-1 text-xs leading-5 text-[#58736c]">为当前手机开启粗体显示或放大版面，便于阅读和操作。</p></div></div><DisplayPreferencesControls idPrefix="mobile-display-preferences" /></section>
              <section className="rounded-2xl border border-[#e6cfac] bg-[#fffbf4] p-4 shadow-[0_8px_22px_rgba(71,42,30,.05)]"><div className="flex items-start gap-3"><BellRing className="mt-0.5 h-5 w-5 text-[#a85d2f]" /><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">微信公众号通知</h2><p className="mt-1 text-xs leading-5 text-[#765542]">{bindingStatusText}</p><p className="mt-1 text-xs leading-5 text-[#8b6852]">{bindingGuideText}</p><p className="mt-2 rounded-lg bg-[#f7ead9] px-2.5 py-2 text-xs leading-5 text-[#80543d]">{notificationRoleHint}</p>{bindingFeedback && <p className="mt-2 text-xs leading-5 text-[#a4462d]">{bindingFeedback}</p>}<div className="mt-3 flex flex-wrap gap-2">{bound ? <span className="inline-flex h-8 items-center rounded-md bg-[#e5f2e5] px-3 text-xs font-medium text-[#35643a]"><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />已完成绑定</span> : <Button size="sm" className="bg-[#a85d2f] text-white hover:bg-[#8f4e26]" disabled={bindingMutation.isPending || officialBinding.isLoading} onClick={() => { setBindingFeedback(null); bindingMutation.mutate(); }}><Link2 className="mr-1.5 h-3.5 w-3.5" />{bindingMutation.isPending ? "正在跳转…" : needsFollowOfficialAccount ? "关注后重新绑定" : "在微信内绑定"}</Button>}<Button size="sm" variant="outline" className="border-[#c9b19b] text-[#6f4b36]" disabled={verifyFollowMutation.isPending || officialBinding.isLoading} onClick={() => { setBindingFeedback(null); verifyFollowMutation.mutate(); }}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />{verifyFollowMutation.isPending ? "正在核验…" : "重新核验关注状态"}</Button></div></div></div></section>
            <section className="rounded-2xl border border-[#ead9c8] bg-[#fffaf3] p-4 shadow-[0_8px_22px_rgba(71,42,30,.05)]"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-[#a85d2f]" /><div className="min-w-0"><h2 className="text-sm font-semibold">账户安全</h2><p className="mt-1 text-xs leading-5 text-[#765542]">本系统通过企业统一身份认证验证登录，不保存您的企业密码，也不提供本地密码重置。修改密码或处理账号异常请使用企业身份平台；如授权发生变化，可重新验证身份同步最新会话。</p><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" className="border-[#c9854a] text-[#7d421f]" onClick={() => navigate(createLoginPath("/mobile/profile"))}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />重新验证身份</Button><a href="/api/identity-recovery" className="inline-flex h-8 items-center justify-center rounded-md border border-[#c9b19b] px-3 text-xs font-medium text-[#6f4b36] transition-colors hover:bg-[#f4eadf]"><KeyRound className="mr-1.5 h-3.5 w-3.5" />账号恢复与密码重置</a><Button size="sm" variant="outline" className="border-[#c9b19b] text-[#6f4b36]" onClick={handleSecureLogout}><LogOut className="mr-1.5 h-3.5 w-3.5" />安全退出</Button></div></div></div></section>
            <Button className="w-full bg-[#3a2117] text-[#fff7ea] hover:bg-[#512e20]" onClick={() => navigate("/mobile")}>返回我的业务</Button>
          </main>
        </div>
      </div>
    </MobileAccessGate>
  );
}
