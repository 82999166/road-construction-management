import React, { type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import TestRenderer, { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ManagementPortal from "./ManagementPortal";
import ScopedManagementModulePage from "./ScopedManagementModulePage";

const state = vi.hoisted(() => ({
  auth: {} as any,
  query: {} as any,
  workbench: vi.fn(),
  navigate: vi.fn(),
  adminBusinessApi: vi.fn(),
  financeBusinessApi: vi.fn(),
  dieselBusinessApi: vi.fn(),
  evidenceBusinessApi: vi.fn(),
  adminProps: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => state.auth }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    mobile: {
      workbench: {
        useQuery: (...args: unknown[]) => {
          state.workbench(...args);
          return state.query;
        },
      },
    },
  },
}));
vi.mock("wouter", () => ({ useLocation: () => ["/admin", state.navigate] }));
vi.mock("@/components/MobileBottomNavigation", () => ({
  MobileBottomNavigation: () => {
    throw new Error("PC 不允许强制手机底栏");
  },
}));
vi.mock("@/components/DashboardLayout", () => ({
  default: ({
    children,
    menuItems,
    accessLabel,
    fallbackSectionLabel,
  }: any) => (
    <div data-layout="dashboard">
      <aside>
        {menuItems.map((item: any) => (
          <a key={item.path} href={item.path} data-section={item.section}>
            {item.label}
          </a>
        ))}
      </aside>
      <header>
        {accessLabel} · {fallbackSectionLabel}
      </header>
      <main>{children}</main>
    </div>
  ),
}));
vi.mock("./AdminPage", () => ({
  default: (props: any) => {
    state.adminProps(props);
    state.adminBusinessApi(props.scopedSection);
    return (
      <div data-layout="dashboard" data-admin-business={props.scopedSection}>
        {props.authorizedMenuItems.map((item: any) => (
          <a key={item.path} href={item.path}>
            {item.label}
          </a>
        ))}
      </div>
    );
  },
}));
vi.mock("./MobileFinancePage", () => ({
  default: () => {
    state.financeBusinessApi();
    return <EmbeddedBusiness name="财务" />;
  },
}));
vi.mock("./MobileDieselPage", () => ({
  default: () => {
    state.dieselBusinessApi();
    return <EmbeddedBusiness name="柴油" />;
  },
}));
vi.mock("./MobileEvidencePage", () => ({
  default: () => {
    state.evidenceBusinessApi();
    return <EmbeddedBusiness name="取证" />;
  },
}));
function EmbeddedBusiness({ name }: { name: string }) {
  return (
    <div className="mobile-viewport-shell">
      <header>
        <button>手机返回</button>
      </header>
      <main>
        <button>{name}授权业务操作</button>
      </main>
      <nav className="mobile-bottom-navigation">手机底栏</nav>
    </div>
  );
}
function makeData(codes: string[], roles = ["PROJECT_MANAGER"]) {
  return {
    user: {
      id: 7,
      name: "管理人员",
      roleCodes: roles,
      departments: [{ name: "施工部" }],
    },
    menus: codes.map(code => ({ code, title: "内部标题" })),
    dataScope: {
      hasAllProjects: false,
      projectIds: [11],
      organizationIds: [22],
    },
    statistics: { unreadMessages: 3 },
  };
}
function businessCalls() {
  return [
    state.adminBusinessApi,
    state.financeBusinessApi,
    state.dieselBusinessApi,
    state.evidenceBusinessApi,
  ];
}
async function renderLazyPage(element: ReactNode) {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(element as React.ReactElement);
  });
  // Import resolution occurs after React's initial Suspense commit.
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  return renderer;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.auth = {
    user: { id: 7, name: "管理人员" },
    isAuthenticated: true,
    loading: false,
    authLoadingTimedOut: false,
    refresh: vi.fn(),
  };
  state.query = {
    data: makeData(["WORKBENCH", "CONSTRUCTION", "MESSAGES"]),
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  };
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("普通 PC 首页的安全 DashboardLayout", () => {
  it("使用统一分区侧栏与授权业务，不出现强制手机底栏和超级治理", () => {
    const html = renderToString(<ManagementPortal />);
    expect(html).toContain('data-layout="dashboard"');
    expect(html).toContain('href="/admin/construction"');
    expect(html).toContain('data-section="经营业务"');
    expect(html).toContain("PC 业务管理 · 已授权");
    expect(html).toContain("项目经理");
    expect(html).toContain("1 个组织范围内的项目");
    expect(html).not.toContain("PROJECT_MANAGER");
    expect(html).not.toContain("PC 超级治理");
    expect(html).not.toContain("移动端底部导航");
    expect(html).not.toContain("mobile-bottom-navigation");
    expect(html).not.toContain("/admin/permission");
    expect(state.workbench).toHaveBeenCalledOnce();
    for (const call of businessCalls()) expect(call).not.toHaveBeenCalled();
  });

  it("首次无权限为待授权，只保留安全入口，不强制加消息/工具/业务", () => {
    state.query.data = makeData([], []);
    const html = renderToString(<ManagementPortal />);
    expect(html).toContain("待授权");
    expect(html).toContain('href="/admin"');
    expect(html).toContain('href="/help"');
    expect(html).not.toContain("/mobile/messages");
    expect(html).not.toContain("/tools");
    expect(html).not.toContain('href="/admin/');
  });

  it("error+缓存旧 data 时隐藏旧菜单、数据范围与岗位，并显示安全重试", () => {
    state.query.error = new Error("INTERNAL_QUERY_CODE");
    const html = renderToString(<ManagementPortal />);
    expect(html).toContain("管理权限暂时无法同步");
    expect(html).toContain("重新同步");
    expect(html).not.toContain("/admin/construction");
    expect(html).not.toContain("项目经理");
    expect(html).not.toContain("施工部");
    expect(html).not.toContain("INTERNAL_QUERY_CODE");
  });

  it("loading+旧 data 仍使用安全壳，不显示旧菜单", () => {
    state.query.isLoading = true;
    const html = renderToString(<ManagementPortal />);
    expect(html).toContain('data-layout="dashboard"');
    expect(html).toContain("正在加载您的管理功能版块");
    expect(html).not.toContain("/admin/construction");
  });

  it("不同用户缓存不会被当成当前账号授权", () => {
    state.query.data.user.id = 8;
    const html = renderToString(<ManagementPortal />);
    expect(html).toContain("管理权限暂时无法同步");
    expect(html).not.toContain("/admin/construction");
  });
});

describe("普通 PC 模块的授权后挂载", () => {
  it.each([
    "finance",
    "diesel",
    "evidence",
    "labor",
    "settings",
    "permission",
    "administrators",
    "backup",
    "audit",
    "organization",
    "constructor",
    "__proto__",
  ])("拒绝/未知 %s 使用同款安全壳且不加载任何模块业务 API", section => {
    const html = renderToString(
      <ScopedManagementModulePage section={section} />
    );
    expect(html).toContain('data-layout="dashboard"');
    expect(html).toContain("返回业务工作台");
    expect(html).not.toContain(`href="/admin/${section}"`);
    for (const call of businessCalls()) expect(call).not.toHaveBeenCalled();
    expect(state.adminProps).not.toHaveBeenCalled();
  });

  it("workbench.error 对缓存中已授权模块也拒绝挂载", () => {
    state.query.error = new Error("OLD_PERMISSION");
    const html = renderToString(
      <ScopedManagementModulePage section="construction" />
    );
    expect(html).toContain("管理权限暂时无法同步");
    expect(html).toContain("重新同步");
    expect(html).not.toContain("/admin/construction");
    expect(html).not.toContain("OLD_PERMISSION");
    for (const call of businessCalls()) expect(call).not.toHaveBeenCalled();
  });

  it.each([
    "construction",
    "labor",
    "machinery",
    "transport",
    "purchasing",
    "subcontract",
    "contracts",
  ])(
    "授权的 %s 继续使用 scoped AdminPage，并传全部过滤侧栏而非仅当前模块",
    async section => {
      state.query.data = makeData([
        "CONSTRUCTION",
        "LABOR",
        "MACHINERY",
        "TRANSPORT",
        "PURCHASING",
        "MEASUREMENT",
        "CONTRACT",
        "FINANCE",
        "ADMINISTRATORS",
        "SETTINGS",
      ]);
      const renderer = await renderLazyPage(
        <ScopedManagementModulePage section={section} />
      );
      expect(state.adminProps).toHaveBeenCalled();
      const props = state.adminProps.mock.calls.at(-1)![0];
      expect(props.scopedSection).toBe(section);
      expect(props.authorizedMenuItems.map((item: any) => item.path)).toEqual([
        "/admin",
        "/admin/construction",
        "/admin/machinery",
        "/admin/transport",
        "/admin/labor",
        "/admin/finance",
        "/admin/purchasing",
        "/admin/subcontract",
        "/admin/contracts",
        "/help",
      ]);
      expect(
        renderer.root.findAllByProps({ "data-layout": "dashboard" })
      ).toHaveLength(1);
      expect(state.financeBusinessApi).not.toHaveBeenCalled();
      await act(async () => renderer.unmount());
    }
  );

  it.each(["finance", "diesel", "evidence"])(
    "授权 %s 保留受控业务操作并用单一 DashboardLayout 包装、局部隐藏手机 chrome",
    async section => {
      state.query.data = makeData([section.toUpperCase(), "CONSTRUCTION"]);
      const renderer = await renderLazyPage(
        <ScopedManagementModulePage section={section} />
      );
      expect(
        renderer.root.findAllByProps({ "data-layout": "dashboard" })
      ).toHaveLength(1);
      const container = renderer.root.findByProps({
        "data-pc-management-module": section.toUpperCase(),
      });
      expect(container.props.className).toContain("scoped-pc-business");
      expect(container.findByType("style").children.join("")).toContain(
        ".scoped-pc-business .mobile-bottom-navigation { display: none !important; }"
      );
      expect(
        container
          .findAllByType("button")
          .some(button => String(button.children).includes("授权业务操作"))
      ).toBe(true);
      expect(state.adminBusinessApi).not.toHaveBeenCalled();
      const called =
        section === "finance"
          ? state.financeBusinessApi
          : section === "diesel"
            ? state.dieselBusinessApi
            : state.evidenceBusinessApi;
      expect(called).toHaveBeenCalled();
      for (const call of businessCalls().filter(call => call !== called))
        expect(call).not.toHaveBeenCalled();
      await act(async () => renderer.unmount());
    }
  );
});
