import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { consumePostLoginReturnPath, createLoginPath } from "@/lib/authNavigation";
import { ArrowRight, Building2, HardHat, ShieldCheck, Smartphone } from "lucide-react";
import React, { useEffect } from "react";
import { useLocation } from "wouter";

/** 系统入口页：业务人员进入移动工作台，超级管理员可进入独立 PC 后台。 */
export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) {
      // 根路径不再停留在营销页或岗位同步加载态；认证缺失、失败或超时降级后
      // 一律进入独立登录页，并在认证完成后安全回到移动工作台。
      setLocation(createLoginPath("/mobile"));
      return;
    }
    setLocation(consumePostLoginReturnPath());
  }, [isAuthenticated, loading, setLocation]);

  return (
    <div className="min-h-screen bg-[#f7f6f2] text-slate-900">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-6 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#203c48] text-white shadow-sm"><HardHat className="h-5 w-5" /></div>
          <div><p className="text-sm font-semibold tracking-tight">工程云管</p><p className="text-xs text-slate-500">施工承包一体化管理平台</p></div>
        </div>
        <div className="flex items-center gap-2">
          {isAuthenticated ? <span className="hidden text-sm text-slate-500 sm:inline">您好，{user?.name || "用户"}</span> : null}
          <Button variant="outline" className="border-slate-300 bg-white" onClick={() => isAuthenticated ? setLocation("/admin") : setLocation(createLoginPath("/admin"))}>{isAuthenticated ? "进入管理后台" : "登录系统"}</Button>
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-6xl gap-12 px-5 pb-14 pt-12 lg:grid-cols-[1.15fr_.85fr] lg:px-8 lg:pt-20">
        <section className="max-w-2xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-[#e9f0ed] px-3 py-1.5 text-xs font-medium text-[#285847]"><ShieldCheck className="h-3.5 w-3.5" /> 企业微信唯一通知与账号安全通道</div>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight text-[#172b34] sm:text-5xl">让施工现场、经营数据与管理决策处于同一节奏。</h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-slate-600">覆盖劳务工资、机械租赁、渣土运输、采购仓储、计量财务、水印取证和项目成本。业务人员在移动端办理，超级管理员在独立 PC 后台完成治理与配置。</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button className="bg-[#203c48] px-5 hover:bg-[#17313b]" onClick={() => isAuthenticated ? setLocation("/mobile") : setLocation(createLoginPath("/mobile"))}>{loading ? "正在识别登录状态" : "进入移动工作台"}<ArrowRight className="ml-2 h-4 w-4" /></Button>
            <Button variant="outline" className="border-slate-300 bg-white px-5" onClick={() => isAuthenticated ? setLocation("/admin") : setLocation(createLoginPath("/admin"))}>PC 超级管理后台</Button>
          </div>
        </section>
        <section className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
          {[{ icon: Smartphone, title: "移动业务工作台", text: "按岗位动态呈现待办与业务菜单" }, { icon: Building2, title: "独立 PC 超级后台", text: "组织、权限、项目、接口和密钥受控维护" }, { icon: ShieldCheck, title: "可追溯治理", text: "所有发布、授权与关键业务均可审计" }].map(item => (
            <div key={item.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_10px_35px_rgba(31,57,65,.06)]">
              <item.icon className="h-5 w-5 text-[#b87836]" />
              <h2 className="mt-3 text-sm font-semibold text-slate-800">{item.title}</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">{item.text}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
