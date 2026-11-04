import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { startLogin } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import { DisplayPreferencesPanel } from "@/components/DisplayPreferencesPanel";
import {
  isDashboardMenuActive,
  requestDashboardNavigation,
} from "@/lib/dashboardNavigation";
import {
  LayoutDashboard,
  LogOut,
  PanelLeft,
  Users,
  type LucideIcon,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";

const defaultMenuItems = [
  { icon: LayoutDashboard, label: "首页", path: "/" },
  { icon: Users, label: "功能页", path: "/some-path" },
];

/** 侧边栏菜单由上层页面传入，便于独立的超级管理后台复用预置布局。 */
export type DashboardMenuItem = {
  icon: LucideIcon;
  label: string;
  path: string;
  /** 侧栏分区标题；未提供时归入“工作台”。 */
  section?: string;
};

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function DashboardLayout({
  children,
  title = "管理工作台",
  menuItems = defaultMenuItems,
  accessLabel = "PC 超级治理 · 已授权",
  fallbackSectionLabel = "系统治理",
  onBeforeNavigate,
}: {
  children: React.ReactNode;
  title?: string;
  menuItems?: DashboardMenuItem[];
  accessLabel?: string;
  fallbackSectionLabel?: string;
  onBeforeNavigate?: (path: string) => boolean;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="flex flex-col items-center gap-6">
            <h1 className="text-2xl font-semibold tracking-tight text-center">
              请登录后继续
            </h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              访问此管理工作台需要完成身份验证。
            </p>
          </div>
          <Button
            onClick={() => startLogin()}
            size="lg"
            className="w-full shadow-lg hover:shadow-xl transition-all"
          >
            登录
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent
        setSidebarWidth={setSidebarWidth}
        title={title}
        menuItems={menuItems}
        accessLabel={accessLabel}
        fallbackSectionLabel={fallbackSectionLabel}
        onBeforeNavigate={onBeforeNavigate}
      >
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
  title: string;
  menuItems: DashboardMenuItem[];
  accessLabel: string;
  fallbackSectionLabel: string;
  onBeforeNavigate?: (path: string) => boolean;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
  title,
  menuItems,
  accessLabel,
  fallbackSectionLabel,
  onBeforeNavigate,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeMenuItem = menuItems.find(item =>
    isDashboardMenuActive(location, item.path)
  );
  const isMobile = useIsMobile();
  const menuGroups = menuItems.reduce<
    Array<{ label: string; items: DashboardMenuItem[] }>
  >((groups, item) => {
    const label = item.section ?? "工作台";
    const existing = groups.find(group => group.label === label);
    if (existing) existing.items.push(item);
    else groups.push({ label, items: [item] });
    return groups;
  }, []);

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r border-white/10 !bg-[#14242c] !text-[#e8efec]"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-auto border-b border-white/10 px-3 py-4">
            <div className="flex w-full items-center gap-3 transition-all">
              <button
                onClick={toggleSidebar}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3c64e]"
                aria-label="展开或收起导航"
              >
                <PanelLeft className="h-4 w-4" />
              </button>
              {!isCollapsed ? (
                <div className="min-w-0">
                  <span className="block truncate text-sm font-semibold tracking-wide text-white">
                    {title}
                  </span>
                  <span className="mt-0.5 block text-[10px] font-medium tracking-[0.16em] text-[#9fb1ad]">
                    悦信 · 智慧工程管理
                  </span>
                </div>
              ) : null}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0 py-3">
            {menuGroups.map(group => (
              <div className="mb-3 last:mb-0" key={group.label}>
                {!isCollapsed ? (
                  <p className="px-5 pb-1.5 text-[10px] font-semibold tracking-[0.16em] text-[#829590]">
                    {group.label}
                  </p>
                ) : null}
                <SidebarMenu className="px-2">
                  {group.items.map(item => {
                    const isActive = isDashboardMenuActive(location, item.path);
                    return (
                      <SidebarMenuItem key={item.path}>
                        <SidebarMenuButton
                          isActive={isActive}
                          onClick={() =>
                            requestDashboardNavigation(
                              location,
                              item.path,
                              setLocation,
                              onBeforeNavigate
                            )
                          }
                          tooltip={item.label}
                          className="relative h-10 rounded-md px-3 text-slate-300 transition-colors hover:bg-white/10 hover:text-white data-[active=true]:bg-[#263a43] data-[active=true]:font-medium data-[active=true]:text-white data-[active=true]:before:absolute data-[active=true]:before:inset-y-2 data-[active=true]:before:left-0 data-[active=true]:before:w-0.5 data-[active=true]:before:rounded-full data-[active=true]:before:bg-[#f3c64e]"
                        >
                          <item.icon
                            className={`h-4 w-4 ${isActive ? "text-[#f3c64e]" : "text-[#a8b8b4]"}`}
                          />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </div>
            ))}
          </SidebarContent>

          <SidebarFooter className="border-t border-white/10 p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left transition-colors hover:bg-white/10 group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3c64e]">
                  <Avatar className="h-9 w-9 shrink-0 border border-white/20">
                    <AvatarFallback className="bg-[#29424b] text-xs font-medium text-[#f6d36c]">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="truncate text-sm font-medium leading-none text-white">
                      {user?.name || "-"}
                    </p>
                    <p className="mt-1.5 truncate text-xs text-[#9fb1ad]">
                      {user?.email || "已登录用户"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>退出登录</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset className="bg-[#f5f5f0]">
        {!isMobile && (
          <div className="sticky top-0 z-30 hidden h-16 items-center justify-between border-b border-[#dce3de] bg-[#f8f8f4]/95 px-6 backdrop-blur md:flex lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <span className="text-xs font-semibold tracking-[0.14em] text-[#70827b]">
                项目指挥台
              </span>
              <span className="text-[#c5cfca]">/</span>
              <span className="truncate text-sm font-medium text-[#1b2d34]">
                {activeMenuItem?.label ?? fallbackSectionLabel}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#60736c]">
              <DisplayPreferencesPanel className="h-9 border-[#cbd7d5] bg-white text-[#284651] hover:bg-[#eff6f4]" />
              <span className="ml-1 h-2 w-2 rounded-full bg-[#f3c64e]" />
              {accessLabel}
            </div>
          </div>
        )}
        {isMobile && (
          <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-[#dce3de] bg-[#f8f8f4]/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg border border-[#dce3de] bg-white" />
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <span className="tracking-tight text-[#1b2d34]">
                    {activeMenuItem?.label ?? "菜单"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
        <main className="admin-command-canvas flex-1 p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </SidebarInset>
    </>
  );
}
