import { Button } from "@/components/ui/button";
import { startLogin } from "@/const";
import { LogIn, RefreshCw, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

type MobileAccessGateProps = {
  /** 当前会话是否已经通过服务端身份校验。 */
  isAuthenticated: boolean;
  /** 认证或首个权限数据请求是否仍在进行。 */
  isLoading: boolean;
  /** 全局认证钩子触发的超时标识，用于引导用户重新认证。 */
  authLoadingTimedOut?: boolean;
  /** 页面在加载时展示的业务文案。 */
  loadingText: string;
  /** 未登录或认证超时时展示的标题。 */
  title: string;
  /** 未登录或认证超时时展示的说明。 */
  description: string;
  /** 业务页面传入的图标，使降级状态仍保留模块识别。 */
  Icon: LucideIcon;
  /** 重新加载认证和业务数据的安全回调。 */
  onRetry: () => void | Promise<unknown>;
};

/**
 * 移动端认证与首屏权限加载统一门禁。
 *
 * 此组件只处理展示与用户主动重试，不自行构造登录地址、访问业务数据或持久化会话。
 * 超过八秒仍未返回的权限查询会被视为可恢复的加载失败，防止页面长期停留在加载文案。
 */
export function MobileAccessGate({
  isAuthenticated,
  isLoading,
  authLoadingTimedOut = false,
  loadingText,
  title,
  description,
  Icon,
  onRetry,
}: MobileAccessGateProps) {
  const [resourceLoadingTimedOut, setResourceLoadingTimedOut] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setResourceLoadingTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setResourceLoadingTimedOut(true), 8_000);
    return () => window.clearTimeout(timer);
  }, [isLoading]);

  /** 用户显式重试时清除本地降级状态，再交由调用页面刷新真实数据。 */
  function retry() {
    setResourceLoadingTimedOut(false);
    void onRetry();
  }

  if (isLoading && !resourceLoadingTimedOut && !authLoadingTimedOut) {
    return <div className="grid min-h-screen place-items-center bg-[#2c1712] px-6 text-center text-sm text-[#f8ead7]">{loadingText}</div>;
  }

  if (!isAuthenticated || authLoadingTimedOut) {
    return <div className="grid min-h-screen place-items-center bg-[#2c1712] p-6 text-center text-[#fff8ed]"><div><div className="mx-auto grid h-16 w-16 place-items-center rounded-[24px] bg-[#c9854a]"><Icon className="h-8 w-8" /></div><h1 className="mt-6 text-2xl font-semibold">{title}</h1><p className="mt-3 text-sm leading-6 text-[#e6cdb0]">{authLoadingTimedOut ? "身份核验响应超时。请重新加载；如问题持续，请重新完成企业身份登录。" : description}</p><div className="mt-6 flex justify-center gap-3"><Button variant="outline" className="border-[#d7a167] bg-transparent text-[#f4dfc3] hover:bg-white/10 hover:text-white" onClick={retry}><RefreshCw className="mr-1.5 h-4 w-4" />重新加载</Button><Button className="bg-[#f4dfc3] text-[#3b2118] hover:bg-white" onClick={() => startLogin()}><LogIn className="mr-1.5 h-4 w-4" />企业身份登录</Button></div></div></div>;
  }

  if (resourceLoadingTimedOut) {
    return <div className="grid min-h-screen place-items-center bg-[#2c1712] p-6 text-center text-[#fff8ed]"><div><div className="mx-auto grid h-16 w-16 place-items-center rounded-[24px] bg-[#c9854a]"><Icon className="h-8 w-8" /></div><h1 className="mt-6 text-2xl font-semibold">{title}暂时无法加载</h1><p className="mt-3 text-sm leading-6 text-[#e6cdb0]">权限或业务数据加载超时。请重新加载；若仍无法恢复，请联系管理员核查项目数据范围。</p><Button className="mt-6 bg-[#f4dfc3] text-[#3b2118] hover:bg-white" onClick={retry}><RefreshCw className="mr-1.5 h-4 w-4" />重新加载</Button></div></div>;
  }

  return null;
}
