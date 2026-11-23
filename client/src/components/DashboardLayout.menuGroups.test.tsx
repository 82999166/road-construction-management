import React, { type ReactNode } from "react";
import TestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LayoutDashboard } from "lucide-react";
import DashboardLayout, { type DashboardMenuItem } from "./DashboardLayout";

const state = vi.hoisted(() => ({
  location: "/admin/construction",
  collapsed: false,
  mobile: false,
  navigate: vi.fn(),
  toggleSidebar: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    loading: false,
    user: { name: "管理员" },
    logout: vi.fn(),
  }),
}));
vi.mock("wouter", () => ({
  useLocation: () => [state.location, state.navigate],
}));
vi.mock("@/hooks/useMobile", () => ({ useIsMobile: () => state.mobile }));
vi.mock("@/components/DisplayPreferencesPanel", () => ({
  DisplayPreferencesPanel: () => null,
}));
vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AvatarFallback: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/components/ui/dropdown-menu", () => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    DropdownMenu: Wrapper,
    DropdownMenuContent: Wrapper,
    DropdownMenuItem: Wrapper,
    DropdownMenuTrigger: Wrapper,
  };
});
vi.mock("@/components/ui/sidebar", () => {
  const Wrapper = ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>;
  return {
    Sidebar: Wrapper,
    SidebarContent: ({
      children,
      className,
    }: {
      children: ReactNode;
      className?: string;
    }) => (
      <div data-slot="sidebar-content" className={className}>
        {children}
      </div>
    ),
    SidebarFooter: Wrapper,
    SidebarHeader: Wrapper,
    SidebarInset: Wrapper,
    SidebarMenu: Wrapper,
    SidebarMenuItem: Wrapper,
    SidebarProvider: ({
      children,
      style,
    }: {
      children: ReactNode;
      style: React.CSSProperties;
    }) => (
      <div data-provider="sidebar" style={style}>
        {children}
      </div>
    ),
    SidebarTrigger: () => null,
    SidebarMenuButton: ({ children, isActive, tooltip, ...props }: any) => (
      <button
        data-menu="true"
        data-active={isActive}
        data-tooltip={tooltip}
        {...props}
      >
        {children}
      </button>
    ),
    useSidebar: () => ({
      state: state.collapsed ? "collapsed" : "expanded",
      toggleSidebar: state.toggleSidebar,
    }),
  };
});

const menus: DashboardMenuItem[] = [
  {
    icon: LayoutDashboard,
    label: "运营概览",
    path: "/admin",
    section: "总览工作台",
  },
  {
    icon: LayoutDashboard,
    label: "施工管理",
    path: "/admin/construction",
    section: "项目与人员",
  },
  {
    icon: LayoutDashboard,
    label: "现场取证",
    path: "/admin/evidence",
    section: "项目与人员",
  },
  {
    icon: LayoutDashboard,
    label: "运输管理",
    path: "/admin/transport",
    section: "设备与运输",
  },
  {
    icon: LayoutDashboard,
    label: "采购仓储",
    path: "/admin/purchasing",
    section: "采购与结算",
  },
  {
    icon: LayoutDashboard,
    label: "使用教程",
    path: "/help",
    section: "系统与工具",
  },
];
let renderers: ReactTestRenderer[] = [];
let storage: Map<string, string>;

beforeEach(() => {
  vi.clearAllMocks();
  state.location = "/admin/construction";
  state.collapsed = false;
  state.mobile = false;
  storage = new Map();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("React", React);
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
  });
  vi.stubGlobal("document", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    body: { style: {} },
  });
});
afterEach(async () => {
  await act(async () => {
    renderers.forEach(renderer => renderer.unmount());
  });
  renderers = [];
  vi.unstubAllGlobals();
});

async function renderLayout(onBeforeNavigate?: (path: string) => boolean) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <DashboardLayout menuItems={menus} onBeforeNavigate={onBeforeNavigate}>
        <p>业务内容保留</p>
      </DashboardLayout>
    );
  });
  renderers.push(renderer);
  return renderer;
}
function heading(renderer: ReactTestRenderer, label: string) {
  return renderer.root
    .findAllByType("button")
    .find(
      node =>
        node.props["aria-controls"] &&
        node.findAllByType("span").some(span => span.children.includes(label))
    )!;
}
function menuButton(renderer: ReactTestRenderer, label: string) {
  return renderer.root
    .findAllByType("button")
    .find(
      node => node.props["data-menu"] && node.props["aria-label"] === label
    )!;
}
function isVisible(node: ReactTestInstance) {
  let parent: ReactTestInstance | null = node;
  while (parent) {
    if (parent.props.hidden === true) return false;
    parent = parent.parent;
  }
  return true;
}
async function refresh(
  renderer: ReactTestRenderer,
  onBeforeNavigate?: (path: string) => boolean
) {
  await act(async () => {
    renderer.update(
      <DashboardLayout menuItems={menus} onBeforeNavigate={onBeforeNavigate}>
        <p>业务内容保留</p>
      </DashboardLayout>
    );
  });
}

describe("PC 菜单分类折叠与导航", () => {
  it("默认展开总览和当前业务组，其余可折叠且状态持久化", async () => {
    const renderer = await renderLayout();
    expect(heading(renderer, "总览工作台").props["aria-expanded"]).toBe(true);
    expect(heading(renderer, "项目与人员").props["aria-expanded"]).toBe(true);
    expect(heading(renderer, "设备与运输").props["aria-expanded"]).toBe(false);
    expect(isVisible(menuButton(renderer, "运输管理"))).toBe(false);
    await act(async () => {
      heading(renderer, "设备与运输").props.onClick();
    });
    expect(isVisible(menuButton(renderer, "运输管理"))).toBe(true);
    expect(JSON.parse(storage.get("dashboard-menu-groups")!).设备与运输).toBe(
      true
    );
    await act(async () => {
      heading(renderer, "设备与运输").props.onClick();
    });
    expect(isVisible(menuButton(renderer, "运输管理"))).toBe(false);
    expect(JSON.parse(storage.get("dashboard-menu-groups")!).设备与运输).toBe(
      false
    );
  });

  it("还原已存分类偏好，但当前深层路径与路由切换自动展开所属组", async () => {
    storage.set(
      "dashboard-menu-groups",
      JSON.stringify({ 项目与人员: false, 设备与运输: false, 系统与工具: true })
    );
    state.location = "/admin/construction/detail?project=1#progress";
    const renderer = await renderLayout();
    expect(isVisible(menuButton(renderer, "施工管理"))).toBe(true);
    expect(menuButton(renderer, "施工管理").props["aria-current"]).toBe("page");
    expect(isVisible(menuButton(renderer, "使用教程"))).toBe(true);
    await act(async () => {
      heading(renderer, "项目与人员").props.onClick();
    });
    expect(isVisible(menuButton(renderer, "施工管理"))).toBe(false);
    state.location = "/admin/construction/another";
    await refresh(renderer);
    expect(isVisible(menuButton(renderer, "施工管理"))).toBe(true);
    state.location = "/admin/transport";
    await refresh(renderer);
    expect(heading(renderer, "设备与运输").props["aria-expanded"]).toBe(true);
    expect(menuButton(renderer, "运输管理").props["data-active"]).toBe(true);
  });

  it("收缩图标模式忽略分类折叠，全部入口可达且保留提示及导航保护", async () => {
    const guard = vi.fn(() => true);
    const renderer = await renderLayout(guard);
    state.collapsed = true;
    await refresh(renderer, guard);
    expect(
      renderer.root
        .findAllByType("button")
        .filter(node => node.props["aria-controls"])
    ).toHaveLength(0);
    for (const item of menus) {
      const button = menuButton(renderer, item.label);
      expect(isVisible(button)).toBe(true);
      expect(button.props["data-tooltip"]).toBe(item.label);
      await act(async () => {
        button.props.onClick();
      });
    }
    expect(state.navigate.mock.calls.map(([path]) => path)).toEqual(
      menus.filter(item => item.path !== state.location).map(item => item.path)
    );
    expect(guard).toHaveBeenCalledTimes(menus.length - 1);
    expect(
      renderer.root.findByProps({ "data-slot": "sidebar-content" }).props
        .className
    ).toContain("group-data-[collapsible=icon]:!overflow-y-auto");
    state.collapsed = false;
    await refresh(renderer, guard);
    expect(isVisible(menuButton(renderer, "采购仓储"))).toBe(false);
  });

  it("折叠模式下取消导航仍不跳转，手机抽屉不会误用 PC 图标模式", async () => {
    state.collapsed = true;
    const guard = vi.fn(() => false);
    const renderer = await renderLayout(guard);
    await act(async () => {
      menuButton(renderer, "采购仓储").props.onClick();
    });
    expect(state.navigate).not.toHaveBeenCalled();
    state.mobile = true;
    await refresh(renderer, guard);
    expect(heading(renderer, "项目与人员").props["aria-expanded"]).toBe(true);
  });
});

describe("菜单存储异常容错", () => {
  it("localStorage 读取和写入失败均不影响渲染与折叠操作", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    const renderer = await renderLayout();
    expect(
      renderer.root.findByProps({ "data-provider": "sidebar" }).props.style[
        "--sidebar-width"
      ]
    ).toBe("280px");
    await act(async () => {
      heading(renderer, "采购与结算").props.onClick();
    });
    expect(isVisible(menuButton(renderer, "采购仓储"))).toBe(true);
    await act(async () => {
      menuButton(renderer, "采购仓储").props.onClick();
    });
    expect(state.navigate).toHaveBeenCalledWith("/admin/purchasing");
  });

  it("无 localStorage 环境也安全回退", async () => {
    vi.stubGlobal("localStorage", undefined);
    const renderer = await renderLayout();
    expect(isVisible(menuButton(renderer, "施工管理"))).toBe(true);
  });

  it.each(["{broken", "null", "[]", '{"设备与运输":"true"}'])(
    "损坏或不合规的分类偏好 %s 不影响菜单",
    async saved => {
      storage.set("dashboard-menu-groups", saved);
      const renderer = await renderLayout();
      expect(heading(renderer, "设备与运输").props["aria-expanded"]).toBe(
        false
      );
      expect(isVisible(menuButton(renderer, "施工管理"))).toBe(true);
    }
  );

  it.each(["NaN", "150", "999", "280junk", "Infinity"])(
    "非法宽度 %s 回退到合理默认值",
    async saved => {
      storage.set("sidebar-width", saved);
      const renderer = await renderLayout();
      expect(
        renderer.root.findByProps({ "data-provider": "sidebar" }).props.style[
          "--sidebar-width"
        ]
      ).toBe("280px");
    }
  );

  it("有效宽度仍可还原", async () => {
    storage.set("sidebar-width", "320");
    const renderer = await renderLayout();
    expect(
      renderer.root.findByProps({ "data-provider": "sidebar" }).props.style[
        "--sidebar-width"
      ]
    ).toBe("320px");
  });
});
