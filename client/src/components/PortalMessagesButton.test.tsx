import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => {
  const unread = {
    data: { count: 7 } as { count: number } | undefined,
    error: null as Error | null,
  };
  const portalResult = () => ({
    data: { status: "unbound" },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  });
  return {
    unread,
    unreadQuery: vi.fn(() => unread),
    tokenQuery: vi.fn(portalResult),
    localDriverQuery: vi.fn(portalResult),
    ownerQuery: vi.fn(portalResult),
    navigate: vi.fn(),
    auth: {
      isAuthenticated: true,
      user: { name: "测试账号", loginMethod: "local_driver" } as {
        name: string;
        loginMethod: string;
      } | null,
      loading: false,
      authLoadingTimedOut: false,
      refresh: vi.fn(),
    },
  };
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    messages: { unreadCount: { useQuery: runtime.unreadQuery } },
    officialAccount: {
      driverPortalSummary: { useQuery: runtime.tokenQuery },
      localDriverPortalSummary: { useQuery: runtime.localDriverQuery },
    },
    machinery: { ownerExpensePortal: { useQuery: runtime.ownerQuery } },
  },
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => runtime.auth }));
vi.mock("wouter", () => ({
  useLocation: () => ["/driver/portal", runtime.navigate],
}));

import { PortalMessagesButton } from "./PortalMessagesButton";
import DriverPortalPage from "../pages/DriverPortalPage";
import MachineOwnerPortalPage from "../pages/MachineOwnerPortalPage";

let renderer: ReactTestRenderer | undefined;

async function render(element: React.ReactElement) {
  await act(async () => {
    renderer = create(element);
  });
  return renderer!;
}

function messageButtons(view: ReactTestRenderer) {
  return view.root.findAll(
    node =>
      node.type === "button" &&
      String(node.props["aria-label"] ?? "").startsWith("消息")
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.unread.data = { count: 7 };
  runtime.unread.error = null;
  runtime.auth.isAuthenticated = true;
  runtime.auth.user = { name: "测试账号", loginMethod: "local_driver" };
  runtime.auth.loading = false;
  runtime.auth.authLoadingTimedOut = false;
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    location: {
      search: "",
      pathname: "/driver/portal",
      href: "",
      replace: vi.fn(),
    },
    setTimeout,
    clearTimeout,
  });
});

afterEach(async () => {
  if (renderer)
    await act(async () => {
      renderer!.unmount();
    });
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("PortalMessagesButton 真实组件", () => {
  it.each([
    [0, "0"],
    [7, "7"],
    [99, "99"],
    [100, "99+"],
  ])("显示实际未读数 %s 并将超过99显示为 %s", async (count, label) => {
    runtime.unread.data = { count };
    const view = await render(<PortalMessagesButton isAuthenticated />);
    const button = messageButtons(view)[0];

    expect(button.props["aria-label"]).toBe(`消息，${count} 条未读`);
    expect(button.children).toContain("消息");
    expect(button.findByType("span").children).toEqual([label]);
    expect(button.findByType("svg").props.className).toContain("lucide-bell");
    expect(button.props.className).toContain("bg-white/10");
    expect(runtime.unreadQuery).toHaveBeenCalledWith(undefined, {
      enabled: true,
      retry: false,
      refetchInterval: 30_000,
    });
  });

  it("点击跳转到已有移动消息中心", async () => {
    const view = await render(<PortalMessagesButton isAuthenticated />);
    await act(async () => {
      messageButtons(view)[0].props.onClick();
    });
    expect(runtime.navigate).toHaveBeenCalledOnce();
    expect(runtime.navigate).toHaveBeenCalledWith("/mobile/messages");
  });

  it.each([
    ["尚无数据", undefined, null],
    ["查询失败", undefined, new Error("网络异常")],
    ["失败时存在旧缓存", { count: 7 }, new Error("网络异常")],
  ] as const)("%s 不伪造零且入口仍可点击", async (_name, data, error) => {
    runtime.unread.data = data;
    runtime.unread.error = error;
    const view = await render(<PortalMessagesButton isAuthenticated />);
    const button = messageButtons(view)[0];

    expect(button.props["aria-label"]).toBe("消息");
    expect(button.findAllByType("span")).toHaveLength(0);
    expect(button.props.disabled).not.toBe(true);
    await act(async () => {
      button.props.onClick();
    });
    expect(runtime.navigate).toHaveBeenCalledOnce();
    expect(runtime.navigate).toHaveBeenCalledWith("/mobile/messages");
  });

  it("未认证时不挂载入口、未读查询或导航", async () => {
    const view = await render(<PortalMessagesButton isAuthenticated={false} />);
    expect(view.toJSON()).toBeNull();
    expect(runtime.unreadQuery).not.toHaveBeenCalled();
    expect(runtime.navigate).not.toHaveBeenCalled();
  });

  it("认证状态切换时挂载或移除查询组件，不保留登出后的入口", async () => {
    const view = await render(<PortalMessagesButton isAuthenticated={false} />);
    await act(async () => {
      view.update(<PortalMessagesButton isAuthenticated />);
    });
    expect(messageButtons(view)).toHaveLength(1);
    expect(runtime.unreadQuery).toHaveBeenCalledOnce();
    await act(async () => {
      view.update(<PortalMessagesButton isAuthenticated={false} />);
    });
    expect(view.toJSON()).toBeNull();
    expect(runtime.unreadQuery).toHaveBeenCalledOnce();
  });
});

describe("两门户消息入口真实接线", () => {
  it("系统登录司机显示真实未读并点击进入消息中心，保持原本只读接口", async () => {
    const view = await render(<DriverPortalPage />);
    const button = messageButtons(view)[0];
    expect(button.findByType("span").children).toEqual(["7"]);
    expect(
      view.root.findByType("header").findByType(PortalMessagesButton)
    ).toBeDefined();
    expect(runtime.localDriverQuery).toHaveBeenCalledWith(undefined, {
      enabled: true,
      retry: false,
    });
    await act(async () => {
      button.props.onClick();
    });
    expect(runtime.navigate).toHaveBeenCalledOnce();
    expect(runtime.navigate).toHaveBeenCalledWith("/mobile/messages");
    expect(
      view.root.findAllByProps({ "aria-label": "查看账单使用说明" })
    ).toHaveLength(1);
  });

  it.each([
    [false, null],
    [false, { name: "未认证旧账号", loginMethod: "local_driver" }],
    [true, { name: "其他系统账号", loginMethod: "local" }],
  ] as const)(
    "微信token访问认证=%s且不是系统登录司机，不获得消息或账号权限",
    async (authenticated, user) => {
      runtime.auth.isAuthenticated = authenticated;
      runtime.auth.user = user;
      window.location.search = "?token=valid-wechat-token-123456";
      const view = await render(<DriverPortalPage />);

      expect(messageButtons(view)).toHaveLength(0);
      expect(view.root.findAllByType(PortalMessagesButton)).toHaveLength(0);
      expect(runtime.unreadQuery).not.toHaveBeenCalled();
      expect(runtime.localDriverQuery).toHaveBeenCalledWith(undefined, {
        enabled: false,
        retry: false,
      });
      expect(runtime.tokenQuery).toHaveBeenCalledWith(
        { token: "valid-wechat-token-123456" },
        { enabled: true, retry: false }
      );
      expect(runtime.navigate).not.toHaveBeenCalled();
      expect(view.root.findAllByType("button")).toHaveLength(1);
    }
  );

  it("已登录机械老板显示消息入口，同时保留原个人资料按钮及跳转", async () => {
    runtime.auth.user = {
      name: "机械老板",
      loginMethod: "local_machine_owner",
    };
    const view = await render(<MachineOwnerPortalPage />);
    const button = messageButtons(view)[0];
    expect(button.findByType("span").children).toEqual(["7"]);
    expect(
      view.root.findByType("header").findByType(PortalMessagesButton)
    ).toBeDefined();
    expect(runtime.ownerQuery).toHaveBeenCalledWith(undefined, {
      enabled: true,
      retry: false,
    });
    await act(async () => {
      button.props.onClick();
    });
    expect(runtime.navigate).toHaveBeenLastCalledWith("/mobile/messages");
    const profile = view.root.findByProps({ "aria-label": "进入我的资料" });
    await act(async () => {
      profile.props.onClick();
    });
    expect(runtime.navigate).toHaveBeenLastCalledWith("/mobile/profile");
    expect(runtime.navigate).toHaveBeenCalledTimes(2);
  });

  it("机械老板未登录时保持登录门禁且不挂载消息查询或入口", async () => {
    runtime.auth.isAuthenticated = false;
    runtime.auth.user = null;
    const view = await render(<MachineOwnerPortalPage />);
    expect(messageButtons(view)).toHaveLength(0);
    expect(runtime.unreadQuery).not.toHaveBeenCalled();
    expect(runtime.ownerQuery).toHaveBeenCalledWith(undefined, {
      enabled: false,
      retry: false,
    });
    expect(view.root.findAllByType("header")).toHaveLength(0);
    expect(JSON.stringify(view.toJSON())).toContain("前往登录页");
  });
});
