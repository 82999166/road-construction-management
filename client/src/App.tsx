import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import NotFound from "@/pages/NotFound";
import { createLoginPath } from "@/lib/authNavigation";
import { resolveManagementAccessMode } from "@/lib/managementPortal";
import { trpc } from "@/lib/trpc";
import { ShieldAlert } from "lucide-react";
import { useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { MobileBottomNavigation } from "./components/MobileBottomNavigation";
import { MobileEvidenceShortcut } from "./components/MobileEvidenceShortcut";
import { ThemeProvider } from "./contexts/ThemeContext";
import AdminPage from "./pages/AdminPage";
import Home from "./pages/Home";
import LoginPage from "./pages/LoginPage";
import ManagementPortal from "./pages/ManagementPortal";
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
 * 统一管理入口前端路由守卫。
 * 超级管理员进入全局治理后台；普通管理人员进入仅含其服务端授权业务模块的管理工作台。
 * admin 路由仍逐项调用 assertSuperAdmin，防止绕过前端直接调用接口。
 */
function AdminRouteGuard() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const access = trpc.admin.access.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const mode = resolveManagementAccessMode({
    isAuthenticated,
    authLoading: loading,
    accessLoading: access.isLoading,
    accessError: Boolean(access.error),
    isSuperAdmin: Boolean(access.data?.canAccess),
  });

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate(createLoginPath("/admin"));
  }, [isAuthenticated, loading, navigate]);

  if (mode === "checking") {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">正在核验后台访问权限…</div>;
  }
  if (mode === "login") {
    return <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50"><ShieldAlert className="h-8 w-8 text-slate-400" /><p className="text-sm text-slate-600">统一管理后台需要先完成登录。</p><Button onClick={() => navigate(createLoginPath("/admin"))}>前往统一登录页</Button></div>;
  }
  if (mode === "unavailable") {
    return <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50"><ShieldAlert className="h-8 w-8 text-amber-600" /><p className="text-sm text-slate-600">后台权限状态暂时无法核验，请稍后重新进入。</p><Button variant="outline" onClick={() => window.location.reload()}>重新加载</Button></div>;
  }
  return mode === "super-admin" ? <AdminPage /> : <ManagementPortal />;
}

/** 测试环境专用的独立本地超级管理员入口，不改变企业身份统一登录页。 */
function LocalAdminLoginRoute() {
  return <LoginPage localAdminOnly />;
}

function UnifiedLoginRoute() {
  return <LoginPage />;
}

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <>
    <Switch>
      <Route path={"/login"} component={UnifiedLoginRoute} />
      <Route path={"/admin/login"} component={LocalAdminLoginRoute} />
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
    <MobileEvidenceShortcut />
    <MobileBottomNavigation />
    </>
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
