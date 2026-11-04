import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  buildScopedAdministratorNavigation,
  getScopedAdministratorRoleLabels,
  getScopedAdministratorScopeLabel,
} from "@/lib/scopedAdministratorNavigation";
import { trpc } from "@/lib/trpc";
import { Bell, MapPin, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import React from "react";
import { useLocation } from "wouter";

/** 普通 PC 首页只读取服务端工作台投影，不读取超级后台经营/治理概览。 */
export default function ManagementPortal() {
  const { user, loading, isAuthenticated, authLoadingTimedOut, refresh } =
    useAuth();
  const [, navigate] = useLocation();
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
        loadingText="正在核验您的管理权限…"
        title="统一管理入口"
        description="请从普通管理员入口登录，系统将按实际岗位和项目授权加载 PC 管理工作台。"
        Icon={ShieldCheck}
        onRetry={() => {
          void refresh();
          void workbench.refetch();
        }}
      />
    );
  }

  // 查询错误必须优先于缓存数据；同步失败时不展示旧业务菜单或旧数据范围。
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
  const businessMenuItems = menuItems.filter(item =>
    item.path.startsWith("/admin/")
  );
  const hasMessages = Boolean(
    data?.menus.some(menu => menu.code === "MESSAGES")
  );
  const roleLabels = getScopedAdministratorRoleLabels(
    data?.user.roleCodes ?? []
  );

  return (
    <div className="scoped-pc-administrator">
      <DashboardLayout
        title="悦信云智管 · 管理后台"
        menuItems={menuItems}
        accessLabel="PC 业务管理 · 已授权"
        fallbackSectionLabel="业务工作台"
      >
        <div className="mx-auto max-w-7xl space-y-6 py-3">
          <section className="rounded-xl border border-[#dce3de] bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-wide text-[#70827b]">
                  我的工作台 · 服务端实时授权
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-[#1b2d34]">
                  运营概览
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  欢迎，{user?.name || "管理人员"}
                  。左侧仅展示已授权业务；数据查询与操作始终由服务端按岗位、部门和项目范围再次核验。
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={workbench.isFetching}
                onClick={() => void workbench.refetch()}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${workbench.isFetching ? "animate-spin" : ""}`}
                />
                刷新授权
              </Button>
            </div>
          </section>

          {workbench.isLoading && !workbench.error ? (
            <Card>
              <CardContent className="flex items-center gap-2 p-7 text-sm text-slate-600">
                <RefreshCw className="h-4 w-4 animate-spin" />
                正在加载您的管理功能版块…
              </CardContent>
            </Card>
          ) : !data ? (
            <Card>
              <CardContent className="p-7 text-center">
                <ShieldCheck className="mx-auto h-7 w-7 text-amber-700" />
                <h2 className="mt-4 text-lg font-semibold">
                  管理权限暂时无法同步
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  为保障数据安全，已隐藏所有业务菜单和旧授权数据。请重新同步；若问题持续，请联系超级管理员核验授权。
                </p>
                <Button
                  className="mt-5"
                  disabled={workbench.isFetching}
                  onClick={() => void workbench.refetch()}
                >
                  重新同步
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <section className="min-w-0 space-y-5">
                <Card>
                  <CardContent className="p-5">
                    <h2 className="text-base font-semibold text-[#1b2d34]">
                      已授权业务
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      请使用左侧分区导航进入业务页面。不会为普通管理员开放全局治理或额外授予操作权限。
                    </p>
                    {businessMenuItems.length ? (
                      <div className="mt-5 divide-y divide-slate-100">
                        {businessMenuItems.map(item => (
                          <button
                            key={item.path}
                            onClick={() => navigate(item.path)}
                            className="flex w-full items-center gap-3 px-1 py-3 text-left text-sm text-[#284651] hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#284651]"
                          >
                            <item.icon className="h-4 w-4 shrink-0" />
                            <span className="flex-1">{item.label}</span>
                            <span className="text-xs text-slate-500">
                              {item.section}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                        <UserRound className="mx-auto h-6 w-6 text-slate-500" />
                        <h3 className="mt-3 font-semibold">
                          当前尚未分配业务管理版块 · 待授权
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-slate-600">
                          请联系超级管理员分配岗位、业务操作权限和项目范围。授权完成后点击刷新授权；未授权前不会加载业务数据。
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
                {hasMessages ? (
                  <Card>
                    <CardContent className="p-5">
                      <h2 className="flex items-center gap-2 text-sm font-semibold">
                        <Bell className="h-4 w-4" />
                        我的消息
                      </h2>
                      <p className="mt-3 text-sm leading-6 text-slate-600">
                        您有 {data.statistics.unreadMessages}{" "}
                        条未读消息，仅包含发送给您本人的业务提醒。
                      </p>
                      <Button
                        variant="outline"
                        className="mt-4"
                        onClick={() => navigate("/mobile/messages")}
                      >
                        查看消息中心
                      </Button>
                    </CardContent>
                  </Card>
                ) : null}
              </section>
              <Card className="h-fit">
                <CardContent className="p-5">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-[#1b2d34]">
                    <MapPin className="h-4 w-4" />
                    数据与组织范围
                  </h2>
                  <dl className="mt-4 space-y-4 text-sm">
                    <div>
                      <dt className="text-xs text-slate-500">项目范围</dt>
                      <dd className="mt-1 break-words font-medium">
                        {getScopedAdministratorScopeLabel(data.dataScope)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">所属部门</dt>
                      <dd className="mt-1 break-words font-medium">
                        {data.user.departments
                          .map(department => department.name)
                          .join("、") || "暂未配置"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">有效岗位</dt>
                      <dd className="mt-1 break-words font-medium">
                        {roleLabels.join("、") || "暂未配置"}
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </DashboardLayout>
    </div>
  );
}
