import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sites: [] as any[],
  routes: [] as any[],
  singleEnabled: false,
  input: null as any,
  fail: false,
  readback: null as null | (() => Promise<void>),
  siteInvalidate: vi.fn(),
  routeInvalidate: vi.fn(),
  singleInvalidate: vi.fn(),
  routeMutate: vi.fn(),
  singleMutate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error, info: mocks.info },
}));
vi.mock("@/components/ui/dialog", () => ({
  useDialogComposition: () => ({
    justEndedComposing: () => false,
    setComposing: () => {},
    markCompositionEnd: () => {},
  }),
  Dialog: ({ children, onOpenChange }: any) => (
    <div data-test="dialog" onClick={() => onOpenChange(false)}>
      {children}
    </div>
  ),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      transport: {
        listSites: { invalidate: mocks.siteInvalidate },
        listRoutePresets: { invalidate: mocks.routeInvalidate },
        getNfcSingleScanCloseSetting: { invalidate: mocks.singleInvalidate },
      },
    }),
    transport: {
      listSites: {
        useQuery: () => ({
          data: mocks.sites,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      listRoutePresets: {
        useQuery: () => ({
          data: mocks.routes,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      getNfcSingleScanCloseSetting: {
        useQuery: () => ({
          data: { enabled: mocks.singleEnabled },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      saveSite: {
        useMutation: (options: any) => {
          const [isPending, pending] = React.useState(false);
          const [variables, setVariables] = React.useState<any>();
          return {
            isPending,
            variables,
            mutate: (input: any) => {
              mocks.input = input;
              setVariables(input);
              pending(true);
              void (async () => {
                try {
                  if (mocks.fail) throw new Error("TEST_FAILED");
                  await options.onSuccess(
                    { success: true, id: input.id },
                    input
                  );
                } catch (error) {
                  options.onError(error);
                } finally {
                  pending(false);
                }
              })();
            },
          };
        },
      },
      saveRoutePreset: {
        useMutation: () => ({ isPending: false, mutate: mocks.routeMutate }),
      },
      setNfcSingleScanCloseSetting: {
        useMutation: () => ({ isPending: false, mutate: mocks.singleMutate }),
      },
    },
  },
}));
import { TransportRouteSafetySettings } from "./TransportRouteSafetySettings";
let view: TestRenderer.ReactTestRenderer;
const input = (label: string) =>
  view.root
    .findAllByType("input")
    .find(item => item.props["aria-label"] === label)!;
const button = (label: string) =>
  view.root
    .findAllByType("button")
    .find(item => JSON.stringify(item.props.children).includes(label))!;
const text = () => JSON.stringify(view.toJSON());
async function mount() {
  await act(async () => {
    view = TestRenderer.create(<TransportRouteSafetySettings projectId={10} />);
  });
}
async function change(label: string, value: string | boolean) {
  await act(async () => {
    input(label).props.onChange({
      target: typeof value === "boolean" ? { checked: value } : { value },
    });
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { confirm: vi.fn(() => true) });
  vi.clearAllMocks();
  mocks.sites = [
    {
      id: 72,
      projectId: 10,
      siteType: "unload",
      name: "卸土区",
      address: "测试地点",
      administratorUserId: null,
      minimumTransitMinutes: 10,
      minimumTransitEnabled: false,
      unloadGeofenceMeters: 300,
      unloadGeofenceEnabled: false,
      status: "active",
      addressResolved: true,
    },
  ];
  mocks.routes = [
    {
      id: 91,
      projectId: 10,
      status: "active",
      unloadSiteId: 72,
      loadSiteId: 71,
      presetDistanceKm: "2",
      unloadOnlyCloseEnabled: false,
    },
  ];
  mocks.singleEnabled = false;
  mocks.input = null;
  mocks.fail = false;
  mocks.readback = null;
  mocks.siteInvalidate.mockImplementation(async () => {
    if (mocks.readback) await mocks.readback();
    mocks.sites = mocks.sites.map(site => ({ ...site, ...mocks.input }));
  });
  mocks.routeInvalidate.mockResolvedValue(undefined);
  mocks.singleInvalidate.mockResolvedValue(undefined);
});
afterEach(async () => {
  if (view) await act(async () => view.unmount());
  vi.unstubAllGlobals();
});
describe("运输安全设置真实组件", () => {
  it("49000米给输入框错误且不提交，已保存300米规则保持不变", async () => {
    await mount();
    await change("卸土区定位允许偏差（米）", "49000");
    expect(input("卸土区定位允许偏差（米）").props["aria-invalid"]).toBe(true);
    expect(button("保存地点统一阈值").props.disabled).toBe(true);
    expect(text()).toContain("30～5000");
    expect(text()).toContain("输入不符合范围");
    expect(text()).toContain("定位允许偏差300米");
    expect(mocks.input).toBeNull();
    await act(async () => {
      view.update(<TransportRouteSafetySettings projectId={10} />);
    });
    expect(input("卸土区定位允许偏差（米）").props.value).toBe("49000");
  });
  it("2分钟500米与两个勾选按原值提交，回读后显示已保存且不是仅提示", async () => {
    await mount();
    await change("卸土区最短运输时间（分钟）", "2");
    await change("卸土区定位允许偏差（米）", "500");
    await change("卸土区最短时间硬拦截", true);
    await change("卸土区定位范围硬拦截", true);
    await act(async () => {
      button("保存地点统一阈值").props.onClick();
    });
    expect(mocks.input).toMatchObject({
      id: 72,
      projectId: 10,
      minimumTransitMinutes: 2,
      unloadGeofenceMeters: 500,
      minimumTransitEnabled: true,
      unloadGeofenceEnabled: true,
    });
    expect(text()).toContain("最短2分钟（硬拦截）");
    expect(text()).toContain("定位允许偏差500米（硬拦截）");
    expect(text()).toContain("当前显示已保存规则");
    expect(mocks.siteInvalidate).toHaveBeenCalledTimes(1);
    expect(mocks.routeInvalidate).toHaveBeenCalledTimes(1);
  });
  it("回读未完成时保留新值、禁用修改和关闭，避免旧缓存回滚", async () => {
    let release!: () => void;
    mocks.readback = () =>
      new Promise<void>(resolve => {
        release = resolve;
      });
    await mount();
    await change("卸土区定位允许偏差（米）", "800");
    await act(async () => {
      button("保存地点统一阈值").props.onClick();
    });
    expect(input("卸土区定位允许偏差（米）").props.value).toBe("800");
    expect(input("卸土区定位允许偏差（米）").props.disabled).toBe(true);
    expect(text()).toContain("尚未保存");
    const dialog = view.root
      .findAllByType("div")
      .find(item => item.props["data-test"] === "dialog")!;
    await act(async () => dialog.props.onClick());
    expect(mocks.info).toHaveBeenCalled();
    await act(async () => {
      release();
    });
    expect(input("卸土区定位允许偏差（米）").props.value).toBe("800");
    expect(text()).toContain("定位允许偏差800米");
  });
  it("保存失败保留修改并不显示成功，不改已保存规则", async () => {
    mocks.fail = true;
    await mount();
    await change("卸土区最短运输时间（分钟）", "3");
    await act(async () => {
      button("保存地点统一阈值").props.onClick();
    });
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled();
    expect(mocks.siteInvalidate).not.toHaveBeenCalled();
    expect(input("卸土区最短运输时间（分钟）").props.value).toBe("3");
    expect(text()).toContain("最短10分钟");
    expect(text()).toContain("尚未保存");
  });
  it("特殊策略即时保存不隐式提交无效阈值，未保存标识仍在", async () => {
    await mount();
    await change("卸土区定位允许偏差（米）", "49000");
    await change("路线91卸土点补刷卡闭环", true);
    expect(mocks.routeMutate).toHaveBeenCalledWith(
      expect.objectContaining({ unloadOnlyCloseEnabled: true })
    );
    expect(mocks.input).toBeNull();
    expect(text()).toContain("输入不符合范围");
  });
  it("仅开启时间拦截可保存，不会自动开启定位拦截", async () => {
    await mount();
    await change("卸土区最短时间硬拦截", true);
    await act(async () => button("保存地点统一阈值").props.onClick());
    expect(mocks.input).toMatchObject({
      minimumTransitEnabled: true,
      unloadGeofenceEnabled: false,
    });
    expect(text()).toContain("仅提示、不拦截");
  });
});
