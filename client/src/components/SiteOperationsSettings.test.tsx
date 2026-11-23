import React from "react";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactTestRenderer, ReactTestInstance } from "react-test-renderer";
import {
  DEFAULT_SITE_CONFIGURATION,
  type SiteConfiguration,
} from "@shared/siteOperations";
const { create, act } = createRequire(import.meta.url)(
  "react-test-renderer"
) as typeof import("react-test-renderer");
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  projects: vi.fn(),
  config: vi.fn(),
  credential: vi.fn(),
  weather: vi.fn(),
  save: vi.fn(),
  saveKey: vi.fn(),
  upload: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => m.auth() }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    siteOperations: {
      projects: { useQuery: (...a: unknown[]) => m.projects(...a) },
      getConfiguration: { useQuery: (...a: unknown[]) => m.config(...a) },
      getWeatherCredential: {
        useQuery: (...a: unknown[]) => m.credential(...a),
      },
      getWeather: { useQuery: (...a: unknown[]) => m.weather(...a) },
      saveConfiguration: {
        useMutation: () => ({ mutateAsync: m.save, isPending: false }),
      },
      saveWeatherCredential: {
        useMutation: () => ({ mutateAsync: m.saveKey, isPending: false }),
      },
      uploadVideo: {
        useMutation: () => ({ mutateAsync: m.upload, isPending: false }),
      },
    },
  },
}));
import Settings from "./SiteOperationsSettings";
let tree: ReactTestRenderer;
let configs: Record<
  number,
  {
    projectId: number;
    version: number;
    configuration: SiteConfiguration;
    videos: [];
  }
>;
const text = (n: ReactTestInstance): string =>
  n.children.map(c => (typeof c === "string" ? c : text(c))).join("");
const button = (s: string) =>
  tree.root.findAllByType("button").find(n => text(n) === s)!;
const click = async (s: string) => act(async () => button(s).props.onClick());
const input = (s: string) => tree.root.findByProps({ "aria-label": s });
const change = async (s: string, value: any, checked = false) =>
  act(async () =>
    input(s).props.onChange({
      target: checked ? { checked: value } : { value },
    })
  );
const refetch = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    confirm: vi.fn().mockReturnValue(true),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  configs = {
    1: {
      projectId: 1,
      version: 4,
      configuration: structuredClone(DEFAULT_SITE_CONFIGURATION),
      videos: [],
    },
    2: {
      projectId: 2,
      version: 8,
      configuration: structuredClone(DEFAULT_SITE_CONFIGURATION),
      videos: [],
    },
  };
  m.auth.mockReturnValue({
    user: { role: "admin", id: 1 },
    isAuthenticated: true,
    loading: false,
  });
  m.projects.mockReturnValue({
    data: [
      { id: 1, name: "工地甲", status: "active" },
      { id: 2, name: "工地乙", status: "active" },
    ],
    isError: false,
  });
  m.config.mockImplementation(({ projectId }) => ({
    data: configs[projectId],
    isError: false,
    isLoading: false,
    refetch: async () => ({ data: configs[projectId], isError: false }),
  }));
  m.credential.mockReturnValue({
    data: { version: 9, keyConfigured: true },
    isError: false,
    isLoading: false,
    refetch: async () => ({
      data: { version: 10, keyConfigured: true },
      isError: false,
    }),
  });
  m.weather.mockReturnValue({ refetch, isFetching: false });
  m.save.mockImplementation(async args => {
    configs[args.projectId] = {
      ...configs[args.projectId],
      version: configs[args.projectId].version + 1,
      configuration: args.configuration,
    };
    return { success: true, version: configs[args.projectId].version };
  });
  m.saveKey.mockResolvedValue({ success: true, version: 10 });
  vi.stubGlobal(
    "FileReader",
    class {
      result = "data:video/mp4;base64,AAAA";
      onload?: () => void;
      readAsDataURL() {
        this.onload?.();
      }
    }
  );
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => {
    tree = create(<Settings />);
  });
}
describe("现场大屏后台配置真实行为", () => {
  it("登录及非admin查询禁用并不显示敏感面板", async () => {
    m.auth.mockReturnValue({
      user: { role: "user" },
      isAuthenticated: true,
      loading: false,
    });
    await mount();
    expect(text(tree.root)).toContain("仅超级管理员");
    for (const q of [m.projects, m.config, m.credential, m.weather])
      expect(q.mock.calls.at(-1)?.[1].enabled).toBe(false);
  });
  it("项目关联、样片默认启用、CAS保存回读且失败保留草稿", async () => {
    await mount();
    expect(input("配置所属项目").props.value).toBe(1);
    await click("加入授权样片");
    expect(text(tree.root)).toContain("KaiKemmann");
    const check = tree.root
      .findAllByType("input")
      .filter(n => n.props.type === "checkbox");
    expect(check.map(n => n.props.checked)).toEqual([true, true]);
    m.save.mockRejectedValueOnce(
      Object.assign(new Error("配置冲突"), { data: { code: "CONFLICT" } })
    );
    await click("保存配置");
    expect(text(tree.root)).toContain("草稿保留");
    expect(text(tree.root)).toContain("不会自动覆盖");
    expect(m.save.mock.calls[0][0]).toMatchObject({
      projectId: 1,
      expectedVersion: 4,
    });
    expect(m.save.mock.calls[0][0].configuration.videos[0].sampleAsset).toBe(
      "excavator_cc_by_sa_4"
    );
    expect(
      tree.root.findAllByProps({ className: "so-video-editor" })
    ).toHaveLength(1);
    await click("保存配置");
    expect(text(tree.root)).toContain("版本 v5");
    await change("配置所属项目", "2");
    expect(text(tree.root)).not.toContain("KaiKemmann");
    await click("加入授权样片");
    await click("保存配置");
    expect(m.save.mock.calls.at(-1)?.[0]).toMatchObject({
      projectId: 2,
      expectedVersion: 8,
    });
  });
  it("关闭启用自动清除默认，默认必须启用且最多一个；删除需要确认", async () => {
    await mount();
    await click("加入授权样片");
    await click("加入授权样片");
    let checks = tree.root
      .findAllByType("input")
      .filter(n => n.props.type === "checkbox");
    await act(async () =>
      checks[3].props.onChange({ target: { checked: true } })
    );
    checks = tree.root
      .findAllByType("input")
      .filter(n => n.props.type === "checkbox");
    expect(checks.map(n => n.props.checked)).toEqual([true, false, true, true]);
    await act(async () =>
      checks[2].props.onChange({ target: { checked: false } })
    );
    checks = tree.root
      .findAllByType("input")
      .filter(n => n.props.type === "checkbox");
    expect(checks[3].props.checked).toBe(false);
    expect(checks[3].props.disabled).toBe(true);
    (window.confirm as any).mockReturnValue(false);
    await click("删除视频");
    expect(
      tree.root.findAllByProps({ className: "so-video-editor" })
    ).toHaveLength(2);
    (window.confirm as any).mockReturnValue(true);
    await click("删除视频");
    expect(
      tree.root.findAllByProps({ className: "so-video-editor" })
    ).toHaveLength(1);
  });
  it("上传迟到结果不能污染新项目，文件input清空支持同文件重选", async () => {
    let resolve!: (v: unknown) => void;
    m.upload.mockReturnValue(new Promise(r => (resolve = r)));
    await mount();
    const target = {
      value: "a.mp4",
      files: [{ name: "a.mp4", size: 1024, type: "video/mp4" }],
    };
    await act(async () => input("上传现场录像").props.onChange({ target }));
    expect(target.value).toBe("");
    expect(m.upload).toHaveBeenCalledWith({
      projectId: 1,
      fileName: "a.mp4",
      mimeType: "video/mp4",
      base64: "AAAA",
    });
    await change("配置所属项目", "2");
    await act(async () => resolve({ storageReference: 100, projectId: 1 }));
    expect(text(tree.root)).not.toContain("a.mp4");
    expect(
      tree.root.findAllByProps({ className: "so-video-editor" })
    ).toHaveLength(0);
  });
  it("上传必须<=16MB且正确mime，成功不自动保存，保存失败保留受控引用", async () => {
    await mount();
    await act(async () =>
      input("上传现场录像").props.onChange({
        target: {
          value: "bad",
          files: [
            {
              name: "bad.mov",
              size: 17 * 1024 * 1024,
              type: "video/quicktime",
            },
          ],
        },
      })
    );
    expect(m.upload).not.toHaveBeenCalled();
    expect(text(tree.root)).toContain("16MB");
    m.upload.mockResolvedValue({ storageReference: 100, projectId: 1 });
    await act(async () =>
      input("上传现场录像").props.onChange({
        target: {
          value: "",
          files: [{ name: "a.mp4", size: 1000, type: "video/mp4" }],
        },
      })
    );
    expect(m.save).not.toHaveBeenCalled();
    expect(text(tree.root)).toContain("上传已完成");
    expect(text(tree.root)).toContain("必须点击“保存配置”才能启用");
    m.save.mockRejectedValue(new Error("网络失败"));
    await click("保存配置");
    expect(m.save.mock.calls.at(-1)?.[0].configuration.videos[0]).toMatchObject(
      { storageReference: 100, enabled: true, default: true }
    );
    expect(text(tree.root)).toContain("草稿保留");
  });
  it("全局密钥密码不回显，空保持，显式清空确认与CAS独立保存", async () => {
    await mount();
    await click("天气接入");
    await change("天气服务", "open_meteo_commercial");
    expect(input("商业天气 API 密钥").props).toMatchObject({
      type: "password",
      value: "",
    });
    expect(text(tree.root)).toContain("所有使用该商业服务的项目共享");
    await click("独立保存密钥");
    expect(m.saveKey.mock.calls[0][0]).toEqual({ expectedVersion: 9 });
    expect(m.save).not.toHaveBeenCalled();
    (window.confirm as any).mockReturnValue(false);
    await click("显式清空全局密钥");
    expect(m.saveKey).toHaveBeenCalledTimes(1);
    (window.confirm as any).mockReturnValue(true);
    await click("显式清空全局密钥");
    expect(m.saveKey.mock.calls.at(-1)?.[0]).toEqual({
      expectedVersion: 9,
      clear: true,
    });
    await change("商业天气 API 密钥", "new-key");
    m.saveKey.mockRejectedValue(new Error("CONFLICT"));
    await click("独立保存密钥");
    expect(input("商业天气 API 密钥").props.value).toBe("new-key");
    expect(text(tree.root)).toContain("不自动覆盖");
  });
  it("天气测试仅反映真实状态，不声称商业联调成功；坐标非法不能保存", async () => {
    await mount();
    await click("天气接入");
    refetch.mockResolvedValue({
      data: { status: "not_configured" },
      isError: false,
    });
    await click("测试天气（已保存配置）");
    expect(text(tree.root)).toContain("实际天气状态：天气服务待配置");
    await click("天气地点");
    await change("天气地点名称", "工地甲");
    await change("天气纬度", "91");
    await change("天气经度", "120");
    expect(button("保存配置").props.disabled).toBe(true);
    await change("天气纬度", "30");
    expect(button("保存配置").props.disabled).toBe(false);
    await click("保存配置");
    expect(m.save.mock.calls.at(-1)?.[0].configuration.location).toEqual({
      label: "工地甲",
      latitude: 30,
      longitude: 120,
    });
  });
  it("未保存草稿保护项目、Tab与刷新，配置加载错误禁用保存", async () => {
    await mount();
    await click("加入授权样片");
    expect(window.addEventListener).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function)
    );
    (window.confirm as any).mockReturnValue(false);
    await change("配置所属项目", "2");
    expect(input("配置所属项目").props.value).toBe(1);
    await click("天气接入");
    expect(input("上传现场录像")).toBeTruthy();
    m.config.mockImplementation(({ projectId }) => ({
      data: configs[projectId],
      isError: true,
      isLoading: false,
      refetch: vi.fn(),
    }));
    await act(async () => tree.update(<Settings />));
    expect(button("保存配置").props.disabled).toBe(true);
    expect(text(tree.root)).toContain("项目配置读取失败");
  });
});

describe("免费天气授权与直达配置", () => {
  it("选择免费方案不会预勾选条款或填造联系信息，商业key仅商业时显示", async () => {
    await mount();
    await click("天气接入");
    expect(input("天气服务").props.value).toBe("disabled");
    expect(
      tree.root.findAllByProps({ "aria-label": "商业天气 API 密钥" })
    ).toHaveLength(0);
    await change("天气服务", "met_norway");
    expect(input("管理员确认 MET Norway 服务条款").props.checked).toBe(false);
    expect(input("MET Norway 联系信息").props.value).toBe("");
    expect(
      tree.root
        .findAllByType("a")
        .some(a => a.props.href === "https://api.met.no/doc/TermsOfService")
    ).toBe(true);
    expect(text(tree.root)).toContain("AI 不得代为接受");
    expect(text(tree.root)).toContain("无需 API Key");
    expect(m.save).not.toHaveBeenCalled();
    expect(m.saveKey).not.toHaveBeenCalled();
    expect(refetch).not.toHaveBeenCalled();
    await click("保存配置");
    expect(m.save.mock.calls.at(-1)?.[0].configuration.weather).toMatchObject({
      provider: "met_norway",
    });
    expect(
      m.save.mock.calls.at(-1)?.[0].configuration.weather.metNorway
    ).toBeUndefined();
  });
  it("条款确认与真实联系信息按项目显式保存回读，格式非法禁保存、切换provider不清商业key", async () => {
    await mount();
    await click("天气接入");
    await change("天气服务", "open_meteo_commercial");
    await change("商业天气 API 密钥", "pending-commercial-key");
    await change("天气服务", "met_norway");
    await change("MET Norway 联系信息", "fake@example.com");
    expect(button("保存配置").props.disabled).toBe(true);
    await change("MET Norway 联系信息", "https://github.com/private/repo");
    expect(button("保存配置").props.disabled).toBe(true);
    await change("MET Norway 联系信息", "https://yx.maomaoyx.com/support");
    await change("管理员确认 MET Norway 服务条款", true, true);
    await click("保存配置");
    expect(m.save.mock.calls.at(-1)?.[0]).toMatchObject({
      projectId: 1,
      expectedVersion: 4,
      configuration: {
        weather: {
          provider: "met_norway",
          metNorway: {
            termsAccepted: true,
            contact: "https://yx.maomaoyx.com/support",
          },
        },
      },
    });
    expect(input("管理员确认 MET Norway 服务条款").props.checked).toBe(true);
    expect(m.saveKey).not.toHaveBeenCalled();
    await change("天气服务", "open_meteo_commercial");
    expect(input("商业天气 API 密钥").props.value).toBe(
      "pending-commercial-key"
    );
    await change("配置所属项目", "2");
    await change("天气服务", "met_norway");
    expect(input("管理员确认 MET Norway 服务条款").props.checked).toBe(false);
    expect(input("MET Norway 联系信息").props.value).toBe("");
  });
  it("siteTab=weather和合法siteProjectId首次初始化，手动切换不被URL覆盖", async () => {
    (window as any).location = {
      search: "?category=onsite&siteTab=weather&siteProjectId=2",
    };
    await mount();
    expect(input("配置所属项目").props.value).toBe(2);
    expect(input("天气服务").props.value).toBe("disabled");
    await change("配置所属项目", "1");
    await act(async () => tree.update(<Settings />));
    expect(input("配置所属项目").props.value).toBe(1);
    await click("视频管理");
    await act(async () => tree.update(<Settings />));
    expect(input("上传现场录像")).toBeTruthy();
  });
  it.each(["999", "-1", "0", "2.0", "nonsense"])(
    "非法或未授权URL项目%s忽略",
    async siteProjectId => {
      (window as any).location = {
        search: `?siteTab=weather&siteProjectId=${siteProjectId}`,
      };
      await mount();
      expect(input("配置所属项目").props.value).toBe(1);
    }
  );
  it("项目列表迟到时再应用URL项目一次", async () => {
    (window as any).location = { search: "?siteTab=weather&siteProjectId=2" };
    m.projects.mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: true,
    });
    await mount();
    m.projects.mockReturnValue({
      data: [
        { id: 1, name: "工地甲", status: "active" },
        { id: 2, name: "工地乙", status: "active" },
      ],
      isError: false,
    });
    await act(async () => tree.update(<Settings />));
    expect(input("配置所属项目").props.value).toBe(2);
  });
});
