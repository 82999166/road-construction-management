import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSTRUCTION_ASSISTANT_DEFAULTS } from "@shared/constructionAssistant";
const state = vi.hoisted(() => ({
  data: null as any,
  error: false,
  loading: false,
  save: vi.fn(),
  refetch: vi.fn(),
  options: null as any,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      constructionAssistant: {
        configuration: { invalidate: vi.fn() },
        status: { invalidate: vi.fn() },
      },
    }),
    constructionAssistant: {
      configuration: {
        useQuery: (_: unknown, options: unknown) => {
          state.options = options;
          return {
            data: state.data,
            isError: state.error,
            isLoading: state.loading,
            refetch: state.refetch,
          };
        },
      },
      saveConfiguration: {
        useMutation: () => ({ mutate: state.save, isPending: false }),
      },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { ConstructionAssistantSettings } from "./ConstructionAssistantSettings";
let renderer: ReactTestRenderer | undefined;
async function mount(active = true, onDirtyChange = vi.fn()) {
  await act(async () => {
    renderer = create(
      <ConstructionAssistantSettings
        active={active}
        onDirtyChange={onDirtyChange}
      />
    );
  });
  return { root: renderer!.root, dirty: onDirtyChange };
}
function text() {
  return JSON.stringify(renderer!.toJSON());
}
function button(label: string) {
  return renderer!.root
    .findAllByType("button")
    .find(node => JSON.stringify(node.children).includes(label))!;
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  state.data = {
    ...CONSTRUCTION_ASSISTANT_DEFAULTS,
    speechKeyConfigured: true,
  };
  state.error = false;
  state.loading = false;
  state.save.mockReset();
  state.refetch.mockReset();
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
});
describe("施工智能录入设置", () => {
  it("用已发布配置而非默认配置展示，密钥只展示是否托管", async () => {
    state.data = {
      ...state.data,
      aiDailyLimit: 7,
      speechEndpoint: "https://speech.example.com/v1",
      speechModel: "speech-model",
    };
    const { root } = await mount();
    expect(root.findByProps({ id: "assistant-ai-limit" }).props.value).toBe(7);
    expect(root.findByProps({ id: "assistant-speech-key" }).props.value).toBe(
      ""
    );
    expect(root.findByProps({ id: "assistant-speech-key" }).props.type).toBe(
      "password"
    );
    expect(text()).toContain("留空保留原密钥");
  });
  it("失败不能保存默认覆盖值，可以重新读取", async () => {
    state.error = true;
    state.data = null;
    const { root } = await mount();
    expect(root.findByType("fieldset").props.disabled).toBe(true);
    expect(text()).toContain("不会按默认值覆盖已有配置");
    await act(async () => button("重新读取").props.onClick());
    expect(state.refetch).toHaveBeenCalledOnce();
    expect(state.save).not.toHaveBeenCalled();
  });
  it("非当前分类不触发读取", async () => {
    await mount(false);
    expect(state.options.enabled).toBe(false);
  });
  it("编辑标记父页未保存，提交额度和空白密钥保留语义", async () => {
    const { root, dirty } = await mount();
    await act(async () =>
      root
        .findByProps({ id: "assistant-ai-limit" })
        .props.onChange({ target: { value: "13" } })
    );
    expect(dirty).toHaveBeenLastCalledWith(true);
    await act(async () => button("保存智能录入设置").props.onClick());
    expect(state.save).toHaveBeenCalledWith(
      expect.objectContaining({ aiDailyLimit: 13, speechApiKey: "" })
    );
  });
  it("取消修改恢复原已发布额度且不发请求", async () => {
    const { root, dirty } = await mount();
    await act(async () =>
      root
        .findByProps({ id: "assistant-voice-limit" })
        .props.onChange({ target: { value: "6" } })
    );
    await act(async () => button("取消修改").props.onClick());
    expect(root.findByProps({ id: "assistant-voice-limit" }).props.value).toBe(
      10
    );
    expect(dirty).toHaveBeenLastCalledWith(false);
    expect(state.save).not.toHaveBeenCalled();
  });
  it("异步配置刷新不覆盖正在输入的新密钥", async () => {
    const dirty = vi.fn();
    const { root } = await mount(true, dirty);
    await act(async () =>
      root
        .findByProps({ id: "assistant-speech-key" })
        .props.onChange({ target: { value: "synthetic-new-key" } })
    );
    state.data = { ...state.data, aiDailyLimit: 8 };
    await act(async () =>
      renderer!.update(
        <ConstructionAssistantSettings active onDirtyChange={dirty} />
      )
    );
    expect(root.findByProps({ id: "assistant-speech-key" }).props.value).toBe(
      "synthetic-new-key"
    );
  });
  it("清楚说明非免费额度、不自动审核与录音处理", async () => {
    await mount();
    expect(text()).toContain("实际费用由接口供应商决定");
    expect(text()).toContain("不会自动提交、审核");
    expect(text()).toContain("不作为业务附件保存");
  });
});
