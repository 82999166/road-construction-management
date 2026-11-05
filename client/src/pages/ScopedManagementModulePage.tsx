import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { getScopedPcAdminSection } from "@/lib/scopedManagementWorkspace";
import {
  buildScopedAdministratorNavigation,
  SCOPED_EMBEDDED_BUSINESS_CSS,
} from "@/lib/scopedAdministratorNavigation";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { RefreshCw, ShieldCheck } from "lucide-react";
import React, { lazy, Suspense, type ReactNode } from "react";
import { useLocation } from "wouter";

// 只在服务端工作台授权通过后渲染 lazy 组件，拒绝/未知模块不发起业务 API。
const MobileFinancePage = lazy(() => import("./MobileFinancePage"));
const MobileDieselPage = lazy(() => import("./MobileDieselPage"));
const EvidenceWorkspace = lazy(() =>
  import("./MobileEvidencePage").then(module => ({
    default: module.EvidenceWorkspace,
  }))
);
const AdminPage = lazy(() => import("./AdminPage"));

const PC_SCOPED_MODULES = {
  construction: { code: "CONSTRUCTION", title: "施工管理" },
  labor: { code: "LABOR", title: "劳务工资" },
  machinery: { code: "MACHINERY", title: "机械管理" },
  transport: { code: "TRANSPORT", title: "运输管理" },
  purchasing: { code: "PURCHASING", title: "采购仓储" },
  measurement: { code: "MEASUREMENT", title: "结算分包" },
  subcontract: { code: "MEASUREMENT", title: "结算分包" },
  contract: { code: "CONTRACT", title: "合同管理" },
  contracts: { code: "CONTRACT", title: "合同管理" },
  finance: { code: "FINANCE", title: "财务管理" },
  diesel: { code: "DIESEL", title: "柴油管理" },
  evidence: { code: "EVIDENCE", title: "现场取证" },
} as const;

/** 页面只控制真实授权入口；数据与操作继续由既有服务端按业务/项目范围裁决。 */
export default function ScopedManagementModulePage({
  section,
}: {
  section: string;
}) {
  const { user, isAuthenticated, loading, authLoadingTimedOut, refresh } =
    useAuth();
  const [, navigate] = useLocation();
  // Object.hasOwn 防止 constructor / __proto__ 等未知路径被解释为模块。
  const module = Object.prototype.hasOwnProperty.call(
    PC_SCOPED_MODULES,
    section
  )
    ? PC_SCOPED_MODULES[section as keyof typeof PC_SCOPED_MODULES]
    : undefined;
  const workbench = trpc.mobile.workbench.useQuery(undefined, {
    enabled: isAuthenticated && !loading && !authLoadingTimedOut,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (loading || !isAuthenticated || authLoadingTimedOut) {
    return (
      <MobileAccessGate
        isAuthenticated={isAuthenticated}
        isLoading={loading}
        authLoadingTimedOut={authLoadingTimedOut}
        loadingText="正在核验业务模块权限…"
        title="统一业务工作台"
        description="请先从普通管理员入口登录，系统会按岗位和项目范围加载允许办理的 PC 业务。"
        Icon={ShieldCheck}
        onRetry={() => {
          void refresh();
          void workbench.refetch();
        }}
      />
    );
  }

  // 即使 query 保留旧 data，error 也必须关闭全部业务入口与组件。
  const data =
    !workbench.error &&
    !workbench.isLoading &&
    workbench.data?.user.id === user?.id
      ? workbench.data
      : undefined;
  const menuItems = buildScopedAdministratorNavigation(
    data?.menus ?? [],
    data?.user.roleCodes ?? []
  );
  function shell(children: ReactNode) {
    return (
      <div className="scoped-pc-administrator">
        <DashboardLayout
          title="悦信云智管 · 管理后台"
          menuItems={menuItems}
          accessLabel="PC 业务管理 · 已授权"
          fallbackSectionLabel="业务工作台"
        >
          <div className="mx-auto max-w-7xl space-y-5 py-3">{children}</div>
        </DashboardLayout>
      </div>
    );
  }
  function notice(title: string, description: string, retry = false) {
    return shell(
      <Card>
        <CardContent className="p-7 text-center">
          <ShieldCheck className="mx-auto h-7 w-7 text-amber-700" />
          <h1 className="mt-4 text-lg font-semibold">{title}</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
            {description}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Button variant="outline" onClick={() => navigate("/admin")}>
              返回业务工作台
            </Button>
            {retry ? (
              <Button
                disabled={workbench.isFetching}
                onClick={() => void workbench.refetch()}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                重新同步
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!module) {
    return notice(
      "该后台功能不可用",
      "请从已授权的业务工作台进入，系统不会提供未登记的后台功能路由。"
    );
  }
  if (workbench.error) {
    return notice(
      "管理权限暂时无法同步",
      "为保障数据安全，已隐藏旧授权菜单，且不会加载该模块业务数据。请重试，或返回首页联系超级管理员核验授权。",
      true
    );
  }
  if (workbench.isLoading) {
    return shell(
      <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-600">
        <RefreshCw className="h-4 w-4 animate-spin" />
        正在加载 {module.title} 权限…
      </div>
    );
  }
  if (!data) {
    return notice(
      "管理权限暂时无法同步",
      "当前授权信息未通过核验，不会加载业务数据。请重新同步后再进入。",
      true
    );
  }
  if (!data.menus.some(item => item.code === module.code)) {
    return notice(
      `暂无 ${module.title} 权限`,
      "请由超级管理员分配对应业务模块、操作权限和项目范围。该模块尚未加载，直接访问地址也不会获得数据或操作权限。"
    );
  }

  const scopedAdminSection = getScopedPcAdminSection(module.code);
  if (scopedAdminSection) {
    // AdminPage 自带 DashboardLayout；这里绝不再包第二个侧栏。
    return (
      <Suspense
        fallback={shell(
          <p className="py-16 text-center text-sm text-slate-500">
            正在加载 {module.title} PC 工作区…
          </p>
        )}
      >
        <AdminPage
          scopedSection={scopedAdminSection}
          authorizedMenuItems={menuItems}
        />
      </Suspense>
    );
  }

  const Page =
    module.code === "FINANCE"
      ? MobileFinancePage
      : module.code === "DIESEL"
        ? MobileDieselPage
        : EvidenceWorkspace;
  return shell(
    <>
      <section>
        <h1 className="text-xl font-semibold text-[#1b2d34]">{module.title}</h1>
        <p className="mt-2 text-sm text-slate-600">
          内容及操作按服务端已授权项目范围显示，不读取超级后台的全局数据。
        </p>
      </section>
      <div
        className="scoped-pc-business overflow-hidden rounded-xl border border-[#dce3de]"
        data-pc-management-module={module.code}
      >
        <style>{SCOPED_EMBEDDED_BUSINESS_CSS}</style>
        <Suspense
          fallback={
            <p className="py-16 text-center text-sm text-slate-500">
              正在加载 {module.title}…
            </p>
          }
        >
          {module.code === "EVIDENCE" ? (
            <EvidenceWorkspace mode="pc" />
          ) : (
            <Page />
          )}
        </Suspense>
      </div>
    </>
  );
}
