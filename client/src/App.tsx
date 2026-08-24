import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import NotFound from "@/pages/NotFound";
import { createAdminLoginPath } from "@/lib/authNavigation";
import { resolveManagementAccessMode } from "@/lib/managementPortal";
import { trpc } from "@/lib/trpc";
import { ShieldAlert } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { MobileBottomNavigation } from "./components/MobileBottomNavigation";
import { MobileEvidenceShortcut } from "./components/MobileEvidenceShortcut";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAuth } from "./_core/hooks/useAuth";
import { useIsMobile } from "./hooks/useMobile";

/** 页面按路由加载，避免首次进入任一端时下载另一端所有业务模块。 */
const AdminPage = lazy(() => import("./pages/AdminPage"));
const Home = lazy(() => import("./pages/Home"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const DriverWechatBindPage = lazy(() => import("./pages/DriverWechatBindPage"));
const DriverPortalPage = lazy(() => import("./pages/DriverPortalPage"));
const ManagementPortal = lazy(() => import("./pages/ManagementPortal"));
const MobileWorkbench = lazy(() => import("./pages/MobileWorkbench"));
const MobileAttendancePage = lazy(() => import("./pages/MobileAttendancePage"));
const MobileConstructionPage = lazy(() => import("./pages/MobileConstructionPage"));
const MobileLaborPage = lazy(() => import("./pages/MobileLaborPage"));
const MobileMachineryPage = lazy(() => import("./pages/MobileMachineryPage"));
const MobileTransportPage = lazy(() => import("./pages/MobileTransportPage"));
const MobilePurchasingPage = lazy(() => import("./pages/MobilePurchasingPage"));
const MobileMeasurementPage = lazy(() => import("./pages/MobileMeasurementPage"));
const MobileSubcontractPage = lazy(() => import("./pages/MobileSubcontractPage"));
const MobileContractPage = lazy(() => import("./pages/MobileContractPage"));
const MobileFinancePage = lazy(() => import("./pages/MobileFinancePage"));
const MobileDieselPage = lazy(() => import("./pages/MobileDieselPage"));
const MobileMessagesPage = lazy(() => import("./pages/MobileMessagesPage"));
const MobileEvidencePage = lazy(() => import("./pages/MobileEvidencePage"));
const MobileProfilePage = lazy(() => import("./pages/MobileProfilePage"));

/**
 * 统一管理入口前端路由守卫。
 * 超级管理员进入全局治理后台；普通管理人员进入仅含其服务端授权业务模块的管理工作台。
 * admin 路由仍逐项调用 assertSuperAdmin，防止绕过前端直接调用接口。
 */
function AdminRouteGuard() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const isMobile = useIsMobile();
  const access = trpc.admin.access.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const mode = resolveManagementAccessMode({
    isAuthenticated,
    authLoading: loading,
    accessLoading: access.isLoading,
    accessError: Boolean(access.error),
    isSuperAdmin: Boolean(access.data?.canAccess),
  });

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate(createAdminLoginPath("/admin"));
  }, [isAuthenticated, loading, navigate]);

  const isMobileScopedManager = mode === "scoped-manager" && (isMobile || (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches));
  useEffect(() => {
    if (isMobileScopedManager) navigate("/mobile");
  }, [isMobileScopedManager, navigate]);

  if (mode === "checking") {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">正在核验后台访问权限…</div>;
  }
  if (mode === "login") {
    return <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50"><ShieldAlert className="h-8 w-8 text-slate-400" /><p className="text-sm text-slate-600">全局治理后台需要使用超级管理员入口登录。</p><Button onClick={() => navigate(createAdminLoginPath("/admin"))}>前往超级管理员登录</Button></div>;
  }
  if (mode === "unavailable") {
    return <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50"><ShieldAlert className="h-8 w-8 text-amber-600" /><p className="text-sm text-slate-600">后台权限状态暂时无法核验，请稍后重新进入。</p><Button variant="outline" onClick={() => window.location.reload()}>重新加载</Button></div>;
  }
  if (isMobileScopedManager) {
    return <div className="flex min-h-screen items-center justify-center bg-[#fffaf3] text-sm text-[#76523f]">正在进入工程承包移动工作台…</div>;
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
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">正在加载业务工作区…</div>}>
    <Switch>
	      <Route path={"/login"} component={UnifiedLoginRoute} />
	      <Route path={"/admin/login"} component={LocalAdminLoginRoute} />
	      <Route path={"/driver-wechat-bind"} component={DriverWechatBindPage} />
	      <Route path={"/driver-portal"} component={DriverPortalPage} />
	      <Route path={"/"} component={Home} />
      <Route path={"/mobile"} component={MobileWorkbench} />
      <Route path={"/mobile/attendance"} component={MobileAttendancePage} />
      <Route path={"/mobile/construction"} component={MobileConstructionPage} />
      <Route path={"/mobile/labor"} component={MobileLaborPage} />
      <Route path={"/mobile/machinery"} component={MobileMachineryPage} />
      <Route path={"/mobile/transport"} component={MobileTransportPage} />
      <Route path={"/mobile/purchasing"} component={MobilePurchasingPage} />
      <Route path={"/mobile/measurement"} component={MobileMeasurementPage} />
      <Route path={"/mobile/subcontract"} component={MobileSubcontractPage} />
      <Route path={"/mobile/contract"} component={MobileContractPage} />
      <Route path={"/mobile/finance"} component={MobileFinancePage} />
      <Route path={"/mobile/diesel"} component={MobileDieselPage} />
      <Route path={"/mobile/messages"} component={MobileMessagesPage} />
      <Route path={"/mobile/evidence"} component={MobileEvidencePage} />
      <Route path={"/mobile/profile"} component={MobileProfilePage} />
      <Route path={"/admin"} component={AdminRouteGuard} />
      <Route path={"/admin/:section"} component={AdminRouteGuard} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
    </Suspense>
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
          <div className="notranslate" translate="no">
            <Toaster />
            <Router />
          </div>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
