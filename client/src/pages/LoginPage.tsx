import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startLogin } from "@/const";
import {
  getAuthenticatedLoginRedirectTarget,
  getLoginReturnPath,
  rememberPostLoginReturnPath,
} from "@/lib/authNavigation";
import { trpc } from "@/lib/trpc";
import { ArrowRight, HardHat, KeyRound, ShieldCheck } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";

/**
 * 企业人员默认走统一身份认证；普通管理人员由超级管理员在后台创建本地账号。
 * 本页面从不保存口令，输入值仅随本次 HTTPS 请求发送给服务端进行不可逆摘要校验。
 */
export default function LoginPage() {
  const { isAuthenticated, loading, user } = useAuth();
  const utils = trpc.useUtils();
  const [location, navigate] = useLocation();
  const [temporaryUsername, setTemporaryUsername] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [managerUsername, setManagerUsername] = useState("");
  const [managerPassword, setManagerPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [shouldChangeLocalPassword, setShouldChangeLocalPassword] = useState(false);
  const returnTo = getLoginReturnPath(location.includes("?") ? `?${location.split("?")[1]}` : "");
  // 用户已确认本地账号无需在首次登录时强制改密；保留改密接口仅供后续受控密码维护使用。
  const requiresLocalPasswordChange = false;
  const redirectTarget = requiresLocalPasswordChange ? null : getAuthenticatedLoginRedirectTarget(isAuthenticated, loading, returnTo);
  const temporaryLogin = trpc.auth.localAdminLogin.useMutation();
  const managerLogin = trpc.auth.localManagerLogin.useMutation();
  const changeLocalPassword = trpc.auth.changeLocalPassword.useMutation();

  useEffect(() => {
    if (redirectTarget) navigate(redirectTarget);
  }, [navigate, redirectTarget]);

  function handleLogin() {
    rememberPostLoginReturnPath(returnTo);
    startLogin();
  }

  async function handleTemporaryAdminLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await temporaryLogin.mutateAsync({ username: temporaryUsername.trim(), password: temporaryPassword });
      setTemporaryPassword("");
      await utils.auth.me.invalidate();
      navigate(returnTo);
    } catch {
      setTemporaryPassword("");
    }
  }

  async function handleLocalManagerLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const result = await managerLogin.mutateAsync({ username: managerUsername.trim(), password: managerPassword });
      setManagerPassword("");
      await utils.auth.me.invalidate();
      if (result.mustChangePassword) {
        setShouldChangeLocalPassword(true);
        return;
      }
      navigate(returnTo);
    } catch {
      setManagerPassword("");
    }
  }

  async function handleLocalPasswordChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await changeLocalPassword.mutateAsync({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setShouldChangeLocalPassword(false);
      await utils.auth.me.invalidate();
      navigate(returnTo);
    } catch {
      setCurrentPassword("");
      setNewPassword("");
    }
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
              <p className="mt-5 text-sm leading-7 text-[#ead4bc]">企业人员通过统一身份认证进入系统，业务权限按岗位与项目范围校验。初始化期间，系统管理员可使用受控的临时本地登录入口；口令只在服务器端校验。</p>
            </div>
          </div>
          <div className="flex flex-col justify-center bg-[#fffaf3] p-8 text-[#3b2118] sm:p-12">
            <p className="text-sm font-medium text-[#9a6036]">欢迎使用</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">登录工程云管</h2>
            <p className="mt-4 text-sm leading-6 text-slate-600">完成身份核验后，系统会安全返回您刚才访问的业务页面；普通管理人员仅可访问已授权模块和项目范围。</p>
            <Button className="mt-8 h-12 w-full bg-[#203c48] text-base hover:bg-[#17313b]" onClick={handleLogin} disabled={loading}>
              {loading ? "正在核验当前会话…" : "企业身份登录"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            {requiresLocalPasswordChange ? (
              <form className="mt-5 rounded-2xl border border-[#b8d1ca] bg-[#f2faf7] p-4" onSubmit={handleLocalPasswordChange}>
                <div className="flex items-center gap-2 text-sm font-semibold text-[#245344]"><KeyRound className="h-4 w-4" />首次登录，请先更新密码</div>
                <p className="mt-1 text-xs leading-5 text-slate-600">为保护账号安全，初始密码或后台重置密码不能直接进入业务工作台。新密码至少 12 位，并同时包含字母和数字。</p>
                <div className="mt-3 grid gap-3">
                  <div className="grid gap-1.5"><Label htmlFor="local-current-password">当前密码</Label><Input id="local-current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} disabled={changeLocalPassword.isPending} required /></div>
                  <div className="grid gap-1.5"><Label htmlFor="local-new-password">新密码</Label><Input id="local-new-password" type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} disabled={changeLocalPassword.isPending} required /></div>
                </div>
                {changeLocalPassword.error ? <p className="mt-3 text-xs font-medium text-red-700">{changeLocalPassword.error.message}</p> : null}
                <Button type="submit" className="mt-4 h-10 w-full bg-[#245344] hover:bg-[#1c4336]" disabled={changeLocalPassword.isPending}>{changeLocalPassword.isPending ? "正在更新密码…" : "更新密码并进入工作台"}</Button>
              </form>
            ) : <>
            <form className="mt-5 rounded-2xl border border-[#c7d7dc] bg-[#f4fafb] p-4" onSubmit={handleLocalManagerLogin}>
              <div className="flex items-center gap-2 text-sm font-semibold text-[#294d5a]"><KeyRound className="h-4 w-4" />普通管理人员账号登录</div>
              <p className="mt-1 text-xs leading-5 text-slate-500">账号由超级管理员在后台创建。登录后仅显示您获授权的业务模块、部门和项目范围。</p>
              <div className="mt-3 grid gap-3">
                <div className="grid gap-1.5"><Label htmlFor="local-manager-username">账号</Label><Input id="local-manager-username" autoComplete="username" value={managerUsername} onChange={event => setManagerUsername(event.target.value)} disabled={managerLogin.isPending} required /></div>
                <div className="grid gap-1.5"><Label htmlFor="local-manager-password">密码</Label><Input id="local-manager-password" type="password" autoComplete="current-password" value={managerPassword} onChange={event => setManagerPassword(event.target.value)} disabled={managerLogin.isPending} required /></div>
              </div>
              {managerLogin.error ? <p className="mt-3 text-xs font-medium text-red-700">{managerLogin.error.message}</p> : null}
              <Button type="submit" variant="outline" className="mt-4 h-10 w-full border-[#82a5af] text-[#294d5a] hover:bg-[#e8f3f5]" disabled={managerLogin.isPending}>{managerLogin.isPending ? "正在安全登录…" : "管理人员登录"}</Button>
            </form>
            <form className="mt-4 rounded-2xl border border-[#ead9c9] bg-[#fff7ed] p-4" onSubmit={handleTemporaryAdminLogin}>
              <div className="flex items-center gap-2 text-sm font-semibold text-[#623a27]"><ShieldCheck className="h-4 w-4" />临时管理后台登录</div>
              <p className="mt-1 text-xs leading-5 text-slate-500">仅用于初始化或应急管理；登录成功后拥有超级管理员权限，请尽快替换临时口令。</p>
              <div className="mt-3 grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="temporary-admin-username">账号</Label>
                  <Input id="temporary-admin-username" autoComplete="username" value={temporaryUsername} onChange={event => setTemporaryUsername(event.target.value)} disabled={temporaryLogin.isPending} required />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="temporary-admin-password">密码</Label>
                  <Input id="temporary-admin-password" type="password" autoComplete="current-password" value={temporaryPassword} onChange={event => setTemporaryPassword(event.target.value)} disabled={temporaryLogin.isPending} required />
                </div>
              </div>
              {temporaryLogin.error ? <p className="mt-3 text-xs font-medium text-red-700">{temporaryLogin.error.message}</p> : null}
              <Button type="submit" variant="outline" className="mt-4 h-10 w-full border-[#bd8a66] text-[#653b26] hover:bg-[#f2e0cf]" disabled={temporaryLogin.isPending}>
                {temporaryLogin.isPending ? "正在安全登录…" : "临时管理员登录"}
              </Button>
            </form>
            </>}
            <a href="/api/identity-recovery" className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-[#365560] transition-colors hover:border-[#8ba4aa] hover:bg-[#f4f8f8]"><KeyRound className="h-4 w-4" />账号恢复与密码重置</a>
            <p className="mt-5 text-center text-xs leading-5 text-slate-500">若企业身份平台不可用，请联系系统管理员核查账号状态与项目授权。</p>
          </div>
        </section>
      </div>
    </main>
  );
}
