import { Bell, LayoutDashboard, UserRound } from "lucide-react";
import React from "react";
import { useLocation } from "wouter";
import { useMobileSafeNavigate } from "@/contexts/MobileFormProtectionContext";

const MOBILE_NAV_ROUTES = new Set([
  "/mobile",
  "/mobile/purchasing",
  "/mobile/measurement",
  "/mobile/finance",
  "/mobile/profile",
]);

/**
 * 为没有页面级业务 Tab 的移动页提供统一固定导航。业务页已自带 Tab 时不重复挂载。
 */
export function MobileBottomNavigation({ forceVisible = false }: { forceVisible?: boolean } = {}) {
  const [location] = useLocation();
  const safeNavigate = useMobileSafeNavigate();
  // 微信内首次登录、OAuth 回跳和预览环境都会保留查询参数。
  // 路径判定必须忽略查询串，否则 `/mobile/profile?from_webdev=1` 会被误判为非移动页，导致固定 Tab 消失。
  const pathname = location.split(/[?#]/, 1)[0] || "/";
  if (!forceVisible && !MOBILE_NAV_ROUTES.has(pathname)) return null;

  const active = pathname === "/mobile" || forceVisible ? "workbench" : pathname === "/mobile/messages" ? "messages" : pathname === "/mobile/profile" ? "profile" : "business";
  const itemClass = (name: typeof active) => `flex min-w-14 flex-col items-center gap-1 px-3 py-1 ${active === name ? "text-[#9f582b]" : "text-[#8f7566]"}`;

  return (
    <nav aria-label="移动端底部导航" className="mobile-bottom-navigation fixed right-0 bottom-0 left-0 z-40 flex w-full max-w-none items-center justify-around border-t border-[#ead9c8] bg-[#fffaf2]/95 px-3 py-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] shadow-[0_-8px_24px_rgba(71,42,30,.08)] backdrop-blur print:hidden lg:hidden">
      <button className={itemClass("workbench")} onClick={() => safeNavigate("/mobile")}><LayoutDashboard className="h-5 w-5" /><span className="text-[10px]">工作台</span></button>
      <button className={itemClass("business")} onClick={() => safeNavigate("/mobile/messages")}><Bell className="h-5 w-5" /><span className="text-[10px]">消息</span></button>
      <button className={itemClass("profile")} onClick={() => safeNavigate("/mobile/profile")}><UserRound className="h-5 w-5" /><span className="text-[10px]">我的</span></button>
    </nav>
  );
}
