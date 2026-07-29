import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import NotFound from "@/pages/NotFound";
import { createLoginPath } from "@/lib/authNavigation";
import { trpc } from "@/lib/trpc";
import { ShieldAlert } from "lucide-react";
import { useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import AdminPage from "./pages/AdminPage";
import Home from "./pages/Home";
import LoginPage from "./pages/LoginPage";
import MobileConstructionPage from "./pages/MobileConstructionPage";
import MobileEvidencePage from "./pages/MobileEvidencePage";
import MobileFinancePage from "./pages/MobileFinancePage";
import MobileLaborPage from "./pages/MobileLaborPage";
import MobileMeasurementPage from "./pages/MobileMeasurementPage";
import MobileMessagesPage from "./pages/MobileMessagesPage";
import MobileMachineryPage from "./pages/MobileMachineryPage";
import MobilePurchasingPage from "./pages/MobilePurchasingPage";
import MobileProfilePage from "./pages/MobileProfilePage";
import MobileTransportPage from "./pages/MobileTransportPage";
import MobileWorkbench from "./pages/MobileWorkbench";
import { useAuth } from "./_core/hooks/useAuth";

/**
 * PC 超级管理后台前端路由守卫。
 * 未登录人员不会触发后台数据请求；已登录但非超级管理员者会被引导回首页。
 * 服务端 admin 路由仍逐项调用 assertSuperAdmin，防止绕过前端直接调用接口。
 */
function AdminRouteGuard() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const access = trpc.admin.access.useQuery(undefined, { enabled: isAuthenticated, retry: false });

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate(createLoginPath("/admin"));
    if (!access.isLoading && access.data && !access.data.canAccess) navigate("/");
  }, [access.data, access.isLoading, isAuthenticated, loading, navigate]);

  if (loading || (isAuthenticated && access.isLoading)) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">正在核验后台访问权限…</div>;
  }
  if (!isAuthenticated) {
    return <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50"><ShieldAlert className="h-8 w-8 text-slate-400" /><p className="text-sm text-slate-600">PC 超级管理后台需要先完成登录。</p><Button onClick={() => navigate(createLoginPath("/admin"))}>前往登录页</Button></div>;
  }
  if (access.error || (access.data && !access.data.canAccess)) {
    return <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50"><ShieldAlert className="h-8 w-8 text-amber-600" /><p className="text-sm text-slate-600">当前账号未获超级管理后台授权，正在返回业务入口。</p></div>;
  }
  return <AdminPage />;
}

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/login"} component={LoginPage} />
      <Route path={"/"} component={Home} />
      <Route path={"/mobile"} component={MobileWorkbench} />
      <Route path={"/mobile/construction"} component={MobileConstructionPage} />
      <Route path={"/mobile/labor"} component={MobileLaborPage} />
      <Route path={"/mobile/machinery"} component={MobileMachineryPage} />
      <Route path={"/mobile/transport"} component={MobileTransportPage} />
      <Route path={"/mobile/purchasing"} component={MobilePurchasingPage} />
      <Route path={"/mobile/measurement"} component={MobileMeasurementPage} />
      <Route path={"/mobile/finance"} component={MobileFinancePage} />
      <Route path={"/mobile/messages"} component={MobileMessagesPage} />
      <Route path={"/mobile/evidence"} component={MobileEvidencePage} />
      <Route path={"/mobile/profile"} component={MobileProfilePage} />
      <Route path={"/admin"} component={AdminRouteGuard} />
      <Route path={"/admin/:section"} component={AdminRouteGuard} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
