import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { startLogin } from "@/const";
import {
  getAuthenticatedLoginRedirectTarget,
  getLoginReturnPath,
  rememberPostLoginReturnPath,
} from "@/lib/authNavigation";
import { ArrowRight, HardHat, ShieldCheck } from "lucide-react";
import React, { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * 独立登录页面只负责发起统一身份认证，不收集、存储或校验本地账号密码。
 * 用户主动点击后才调用 OAuth 跳转函数，以保持一次性 nonce 与浏览器 Cookie 配对。
 */
export default function LoginPage() {
  const { isAuthenticated, loading } = useAuth();
  const [location, navigate] = useLocation();
  const returnTo = getLoginReturnPath(location.includes("?") ? `?${location.split("?")[1]}` : "");
  const redirectTarget = getAuthenticatedLoginRedirectTarget(isAuthenticated, loading, returnTo);

  useEffect(() => {
    if (redirectTarget) navigate(redirectTarget);
  }, [navigate, redirectTarget]);

  function handleLogin() {
    rememberPostLoginReturnPath(returnTo);
    startLogin();
  }

  return (
    <main className="min-h-screen bg-[#2c1712] px-5 py-8 text-[#fff8ed] sm:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl items-center justify-center">
        <section className="grid w-full overflow-hidden rounded-[32px] border border-white/10 bg-[#3a2119] shadow-[0_30px_90px_rgba(12,4,2,.38)] lg:grid-cols-[1.05fr_.95fr]">
          <div className="relative overflow-hidden bg-[radial-gradient(circle_at_22%_18%,rgba(201,133,74,.34),transparent_35%),linear-gradient(145deg,#6a3c28_0%,#2b1813_72%)] p-8 sm:p-12">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#f4dfc3] text-[#3b2118]"><HardHat className="h-5 w-5" /></div>
              <div><p className="font-semibold tracking-tight">工程云管</p><p className="text-xs text-[#e6cdb0]">施工承包一体化管理平台</p></div>
            </div>
            <div className="mt-16 max-w-md">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs text-[#f7dfc2]"><ShieldCheck className="h-3.5 w-3.5" />统一身份认证</span>
              <h1 className="mt-6 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">安全进入施工业务与管理后台。</h1>
              <p className="mt-5 text-sm leading-7 text-[#ead4bc]">系统不保存企业账号密码。登录、找回与密码管理由您的统一身份提供方负责，业务权限则在本系统内按岗位与项目范围校验。</p>
            </div>
          </div>
          <div className="flex flex-col justify-center bg-[#fffaf3] p-8 text-[#3b2118] sm:p-12">
            <p className="text-sm font-medium text-[#9a6036]">欢迎使用</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">登录工程云管</h2>
            <p className="mt-4 text-sm leading-6 text-slate-600">完成企业身份核验后，系统会安全返回您刚才访问的业务页面。</p>
            <Button className="mt-8 h-12 w-full bg-[#203c48] text-base hover:bg-[#17313b]" onClick={handleLogin} disabled={loading}>
              {loading ? "正在核验当前会话…" : "企业身份登录"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <p className="mt-5 text-center text-xs leading-5 text-slate-500">若企业身份平台不可用，请联系系统管理员核查账号状态与项目授权。</p>
          </div>
        </section>
      </div>
    </main>
  );
}
