import React, { type HTMLAttributes, type ReactNode } from "react";
import { createRequire } from "node:module";
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { create, act } = createRequire(import.meta.url)(
  "react-test-renderer"
) as typeof import("react-test-renderer");

const mocks = vi.hoisted(() => ({
  cards: [] as Record<string, unknown>[] | undefined,
  queryStatus: "success" as "pending" | "error" | "success",
  cardsRefetch: vi.fn(),
  invalidateWriters: vi.fn(),
  prepare: vi.fn(),
  finalize: vi.fn(),
  recordTest: vi.fn(),
  saveReader: vi.fn(),
  readiness: vi.fn(),
  fetch: vi.fn(),
  confirm: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

// Only replace Radix/DOM and external I/O boundaries. The real component owns
// the confirm, eligibility, readiness, timeout, payload and result validation.
vi.mock("@/components/ui/button", () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));
vi.mock("@/components/ui/label", () => ({
  Label: (props: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props} />
  ),
}));
vi.mock("@/components/ui/card", () => {
  const Block = (props: HTMLAttributes<HTMLDivElement>) => <div {...props} />;
  return {
    Card: Block,
    CardContent: Block,
    CardDescription: Block,
    CardHeader: Block,
    CardTitle: Block,
  };
});
vi.mock("@/components/ui/select", () => {
  const Block = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Select: ({
      value,
      children,
      onValueChange,
    }: {
      value?: string;
      children?: ReactNode;
      onValueChange?: (value: string) => void;
    }) => (
      <select
        value={value}
        onChange={event => onValueChange?.(event.target.value)}
      >
        {children}
      </select>
    ),
    SelectContent: Block,
    SelectTrigger: Block,
    SelectValue: () => null,
    SelectItem: ({
      value,
      children,
    }: {
      value: string;
      children?: ReactNode;
    }) => <option value={value}>{children}</option>,
  };
});
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("@/lib/rfidBridgeReadiness", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/rfidBridgeReadiness")>()),
  readRfidBridgeReadiness: mocks.readiness,
}));
vi.mock("@/lib/trpc", () => {
  const emptyQuery = () => ({ data: [], isSuccess: true, refetch: vi.fn() });
  type MutationOptions = { onSuccess?: (...args: unknown[]) => unknown };
  const mutation = (call: typeof mocks.prepare, options?: MutationOptions) => ({
    isPending: false,
    mutateAsync: async (input: unknown) => {
      const output: unknown = await call(input);
      await options?.onSuccess?.(output, input);
      return output;
    },
    mutate: call,
  });
  return {
    trpc: {
      useUtils: () => ({
        transport: {
          listRfidWriterDevices: { invalidate: mocks.invalidateWriters },
        },
      }),
      transport: {
        listRfidWriterDevices: { useQuery: emptyQuery },
        listVehicleRfidCards: {
          useQuery: () => ({
            data: mocks.cards,
            status: mocks.queryStatus,
            fetchStatus: mocks.queryStatus === "pending" ? "fetching" : "idle",
            isSuccess: mocks.queryStatus === "success",
            isError: mocks.queryStatus === "error",
            isPending: mocks.queryStatus === "pending",
            isLoading: mocks.queryStatus === "pending",
            isFetching: mocks.queryStatus === "pending",
            refetch: mocks.cardsRefetch,
          }),
        },
        listSites: { useQuery: emptyQuery },
        listReaderDevices: { useQuery: emptyQuery },
        recordRfidHardwareTest: {
          useMutation: (options?: MutationOptions) =>
            mutation(mocks.recordTest, options),
        },
        prepareRfidInitialErase: {
          useMutation: (options?: MutationOptions) =>
            mutation(mocks.prepare, options),
        },
        finalizeRfidInitialErase: {
          useMutation: (options?: MutationOptions) =>
            mutation(mocks.finalize, options),
        },
        saveReaderDevice: {
          useMutation: (options?: MutationOptions) =>
            mutation(mocks.saveReader, options),
        },
      },
    },
  };
});

import RfidLocalWriterPanel from "./RfidLocalWriterPanel";
import {
  REQUIRED_RFID_BRIDGE_VERSION,
  REQUIRED_RFID_BRIDGE_BUILD_ID,
  REQUIRED_RFID_WRITER_VERSION,
  type RfidBridgeReadiness,
} from "@/lib/rfidBridgeReadiness";

const unboundLabel = "直接恢复当前未绑定实体卡";
const boundLabel = "停用并擦除恢复初卡";
const fingerprint = "a1".repeat(32);
const boundCard = {
  id: 71,
  projectId: 10,
  status: "active",
  plateNo: "湘A00071",
  cardUidMasked: "04****71",
};
const ready = (): RfidBridgeReadiness => ({
  status: "ready",
  bridgeVersion: REQUIRED_RFID_BRIDGE_VERSION,
  bridgeBuildId: REQUIRED_RFID_BRIDGE_BUILD_ID,
  writerVersion: REQUIRED_RFID_WRITER_VERSION,
  reason: "测试只读版本已匹配",
});
const validErase = () => ({
  success: true,
  erased: true,
  verified: true,
  initialNdef: true,
  writeProtectionChanged: false,
  cardUidFingerprint: fingerprint,
  writerVersion: "ntag216-initial-erase-v2",
});
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
let tree: ReactTestRenderer | undefined;
let eraseBody: Record<string, unknown>;
const root = () => {
  if (!tree) throw new Error("Render RFID panel first");
  return tree.root;
};
const text = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(text).join("");
const buttons = (label: string) =>
  root()
    .findAllByType("button")
    .filter(node => text(node) === label);
const button = (label: string) => {
  const result = buttons(label)[0];
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
};
const render = async (projectId = 10) => {
  await act(async () => {
    tree = create(
      <RfidLocalWriterPanel projectId={projectId} onUidRead={vi.fn()} />
    );
  });
};
const click = async (label: string) => {
  const props = button(label)
    .props as React.ButtonHTMLAttributes<HTMLButtonElement>;
  expect(props.disabled).not.toBe(true);
  await act(async () => {
    await props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
  });
};
const select = async (optionValue: string) => {
  const control = root()
    .findAllByType("select")
    .find(node =>
      node
        .findAllByType("option")
        .some(option => option.props.value === optionValue)
    );
  if (!control) throw new Error(`Missing select option: ${optionValue}`);
  await act(async () => {
    control.props.onChange({ target: { value: optionValue } });
  });
};
type Flow = "未绑定" | "已绑定";
const flows: Flow[] = ["未绑定", "已绑定"];
const flowLabel = (flow: Flow) =>
  flow === "已绑定" ? boundLabel : unboundLabel;
const readyPanel = async (flow: Flow) => {
  mocks.cards = flow === "已绑定" ? [boundCard] : [];
  await render();
  await click("检测本地桥接");
  expect(button(flowLabel(flow)).props.disabled).toBe(false);
  if (flow === "已绑定") await select("71");
  // Separate initial ordinary health check from each destructive operation.
  mocks.readiness.mockClear();
  mocks.fetch.mockClear();
  mocks.success.mockClear();
  mocks.error.mockClear();
};
const eraseCalls = () =>
  mocks.fetch.mock.calls.filter(
    ([url, options]) =>
      String(url).endsWith("/api/erase-initial-card") &&
      options?.method === "POST"
  );
const assertNoWrite = () => {
  expect(eraseCalls()).toHaveLength(0);
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.finalize).not.toHaveBeenCalled();
  expect(mocks.recordTest).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    confirm: mocks.confirm,
    setTimeout: (handler: () => void, timeout: number) =>
      globalThis.setTimeout(handler, timeout),
    clearTimeout: (id: ReturnType<typeof setTimeout>) =>
      globalThis.clearTimeout(id),
  });
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.cards = [];
  mocks.queryStatus = "success";
  eraseBody = validErase();
  mocks.confirm.mockReturnValue(true);
  mocks.readiness.mockResolvedValue(ready());
  mocks.prepare.mockResolvedValue({
    success: true,
    cardUidFingerprint: fingerprint,
  });
  mocks.finalize.mockResolvedValue({ success: true });
  mocks.cardsRefetch.mockResolvedValue({ data: [], isSuccess: true });
  mocks.fetch.mockImplementation(async (url: string, options: RequestInit) => {
    if (url === "http://127.0.0.1:47601/health" && options.method === "GET")
      return response({
        success: true,
        readers: ["Mock uTrust"],
        service: "正常",
      });
    if (
      url === "http://127.0.0.1:47601/api/erase-initial-card" &&
      options.method === "POST"
    )
      return response(eraseBody);
    throw new Error(`Unexpected mocked request: ${url}`);
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree?.unmount());
  tree = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("RfidLocalWriterPanel 初卡恢复：真实组件行为（无实体卡/数据库 I/O）", () => {
  it("真实桥接版本常量采用CRC兼容擦除能力 v15，不在测试 mock 中伪造版本", () => {
    expect(REQUIRED_RFID_BRIDGE_VERSION).toBe("utrust-bridge-installer-v15");
    expect(REQUIRED_RFID_BRIDGE_BUILD_ID).toBe(
      "utrust-rfid-installer-20261115-getversion-v15"
    );
  });

  it.each([
    ["有效项目且查询成功空列表", 10, "success", [], true],
    ["无项目", 0, "success", [], false],
    ["无效项目", -1, "success", [], false],
    ["加载中无数据", 10, "pending", undefined, false],
    ["加载中已有空缓存", 10, "pending", [], false],
    ["查询失败无数据", 10, "error", undefined, false],
    ["查询失败已有空缓存", 10, "error", [], false],
    ["查询成功但存在绑定", 10, "success", [boundCard], false],
  ] as const)(
    "%s：未绑定恢复入口遵守查询状态",
    async (_, projectId, status, cards, visible) => {
      mocks.queryStatus = status;
      mocks.cards = cards === undefined ? undefined : [...cards];
      await render(projectId);
      expect(buttons(unboundLabel)).toHaveLength(visible ? 1 : 0);
      assertNoWrite();
      expect(mocks.fetch).not.toHaveBeenCalled();
    }
  );

  it.each(flows)(
    "%s恢复取消原生 window.confirm 后零写入、零 prepare",
    async flow => {
      await readyPanel(flow);
      mocks.confirm.mockReturnValue(false);
      await click(flowLabel(flow));
      expect(mocks.confirm).toHaveBeenCalledTimes(1);
      expect(mocks.confirm.mock.calls[0][0]).toContain("不可撤销");
      expect(mocks.readiness).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
      assertNoWrite();
    }
  );

  const rejectedStatuses: RfidBridgeReadiness["status"][] = [
    "upgrade_required",
    "unavailable",
    "writer_mismatch",
  ];
  for (const flow of flows) {
    it.each(rejectedStatuses)(
      `${flow}恢复 readiness=%s 时重检恢复能力、拒绝 POST 且不先停用`,
      async status => {
        await readyPanel(flow);
        mocks.readiness.mockResolvedValue({
          ...ready(),
          status,
          reason: "请完整安装最新版桥接后重新检测",
        });
        await click(flowLabel(flow));
        expect(mocks.readiness).toHaveBeenCalledTimes(1);
        expect(mocks.readiness).toHaveBeenCalledWith(undefined, true);
        expect(mocks.fetch).not.toHaveBeenCalled();
        expect(mocks.error).toHaveBeenCalled();
        expect(mocks.success).not.toHaveBeenCalled();
        assertNoWrite();
      }
    );
  }

  it.each(flows)("%s恢复能力检查抛错也不提交擦除或停用", async flow => {
    await readyPanel(flow);
    mocks.readiness.mockRejectedValue(new Error("桥接恢复能力检测失败"));
    await click(flowLabel(flow));
    expect(mocks.readiness).toHaveBeenCalledTimes(1);
    expect(mocks.readiness).toHaveBeenCalledWith(undefined, true);
    expect(mocks.fetch).not.toHaveBeenCalled();
    assertNoWrite();
    expect(mocks.error).toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it.each(flows)("%s只有全部严格成功标志及合法指纹才报告成功", async flow => {
    await readyPanel(flow);
    await click(flowLabel(flow));
    expect(mocks.readiness).toHaveBeenCalledTimes(1);
    expect(mocks.readiness).toHaveBeenCalledWith(undefined, true);
    expect(eraseCalls()).toHaveLength(1);
    const [url, options] = eraseCalls()[0];
    expect(url).toBe("http://127.0.0.1:47601/api/erase-initial-card");
    expect(options).toMatchObject({ method: "POST", cache: "no-store" });
    expect(JSON.parse(options.body)).toMatchObject({
      confirmErase: "ERASE_NTAG216_USER_AREA",
    });
    expect(mocks.success).toHaveBeenCalledTimes(1);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.recordTest).not.toHaveBeenCalled();
    if (flow === "已绑定") {
      expect(mocks.prepare).toHaveBeenCalledTimes(1);
      expect(mocks.prepare).toHaveBeenCalledWith({
        projectId: 10,
        cardId: 71,
        writerDeviceId: null,
      });
      expect(JSON.parse(options.body).expectedCardUidFingerprint).toBe(
        fingerprint
      );
      expect(mocks.finalize).toHaveBeenCalledTimes(1);
      expect(mocks.finalize).toHaveBeenCalledWith({
        projectId: 10,
        cardId: 71,
        cardUidFingerprint: fingerprint,
        writerDeviceId: null,
      });
      expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.fetch.mock.invocationCallOrder[0]
      );
    } else {
      expect(mocks.prepare).not.toHaveBeenCalled();
      expect(mocks.finalize).not.toHaveBeenCalled();
      expect(mocks.cardsRefetch).not.toHaveBeenCalled();
      expect(JSON.parse(options.body)).not.toHaveProperty(
        "expectedCardUidFingerprint"
      );
    }
  });

  const invalidResults: [string, Record<string, unknown>][] = [
    ["success=false", { success: false }],
    ["success 字符串", { success: "true" }],
    ["缺少 erased", { erased: undefined }],
    ["erased=false", { erased: false }],
    ["erased 字符串", { erased: "true" }],
    ["缺少 verified", { verified: undefined }],
    ["verified=false", { verified: false }],
    ["verified 字符串", { verified: "true" }],
    ["initialNdef=false", { initialNdef: false }],
    ["initialNdef 字符串", { initialNdef: "true" }],
    ["缺少 writeProtectionChanged", { writeProtectionChanged: undefined }],
    ["写保护已变化", { writeProtectionChanged: true }],
    ["写保护数字 0", { writeProtectionChanged: 0 }],
    ["缺少指纹", { cardUidFingerprint: undefined }],
    ["空指纹", { cardUidFingerprint: "" }],
    ["63 位指纹", { cardUidFingerprint: "a".repeat(63) }],
    ["65 位指纹", { cardUidFingerprint: "a".repeat(65) }],
    ["64 位但非十六进制", { cardUidFingerprint: "g".repeat(64) }],
    ["指纹尾随换行", { cardUidFingerprint: `${fingerprint}\n` }],
    ["非字符串指纹", { cardUidFingerprint: 123 }],
  ];
  for (const flow of flows) {
    it.each(invalidResults)(
      `${flow}桥接返回 %s：不得提示成功或 finalize`,
      async (_, patch) => {
        await readyPanel(flow);
        eraseBody = { ...validErase(), ...patch };
        await click(flowLabel(flow));
        expect(eraseCalls()).toHaveLength(1);
        expect(mocks.success).not.toHaveBeenCalled();
        expect(mocks.finalize).not.toHaveBeenCalled();
        expect(mocks.error).toHaveBeenCalled();
        if (flow === "未绑定") expect(mocks.prepare).not.toHaveBeenCalled();
      }
    );
  }

  it("prepare 返回的目标指纹传给 bridge 的 expectedCardUidFingerprint，最终审计仍对应所选卡", async () => {
    await readyPanel("已绑定");
    const expected = "b2".repeat(32);
    mocks.prepare.mockResolvedValue({
      success: true,
      cardUidFingerprint: expected,
    });
    await click(boundLabel);
    const payload = JSON.parse(eraseCalls()[0][1].body);
    expect(payload.expectedCardUidFingerprint).toBe(expected);
    expect(payload).not.toHaveProperty("cardUid");
    expect(mocks.finalize.mock.calls[0][0]).toMatchObject({
      cardId: 71,
      cardUidFingerprint: fingerprint,
    });
  });

  it("prepare 拒绝时不发实体卡擦除 POST，也不 finalize", async () => {
    await readyPanel("已绑定");
    mocks.prepare.mockRejectedValue(new Error("该卡已不允许恢复"));
    await click(boundLabel);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(eraseCalls()).toHaveLength(0);
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled();
  });

  it.each(flows)(
    "%s旧 rawPS 缺失 ps1 变为中文完整升级指引，不回显本机路径",
    async flow => {
      await readyPanel(flow);
      eraseBody = {
        success: false,
        message: "initial_card_erase_failed",
        rawPS:
          "The argument 'D:\\PRIVATE-RFID\\Scripts\\erase_initial.ps1' to the -File parameter does not exist.",
        detail:
          "reader_script_missing D:\\PRIVATE-RFID\\Scripts\\erase_initial.ps1",
      };
      await click(flowLabel(flow));
      expect(mocks.error).toHaveBeenCalledTimes(1);
      const message = String(mocks.error.mock.calls[0][0]);
      expect(message).toMatch(/安装|升级|更新/);
      expect(message).toMatch(/完整|最新版|最新/);
      expect(`${message} ${text(root())}`).not.toMatch(
        /PRIVATE-RFID|D:\\|rawPS|does not exist|initial_card_erase_failed/
      );
      expect(mocks.success).not.toHaveBeenCalled();
      expect(mocks.finalize).not.toHaveBeenCalled();
    }
  );

  it.each(flows)(
    "%s擦除请求总超时为 60 秒，8 秒不取消，超时后不自动重试",
    async flow => {
      await readyPanel(flow);
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      mocks.fetch.mockImplementation((_url: string, options: RequestInit) => {
        signal = options.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        });
      });
      const props = button(flowLabel(flow))
        .props as React.ButtonHTMLAttributes<HTMLButtonElement>;
      let operation: unknown;
      await act(async () => {
        operation = props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
        await Promise.resolve();
      });
      expect(eraseCalls()).toHaveLength(1);
      expect(signal?.aborted).toBe(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8_000);
      });
      expect(signal?.aborted).toBe(false);
      expect(mocks.error).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(51_999);
      });
      expect(signal?.aborted).toBe(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
        await operation;
      });
      expect(signal?.aborted).toBe(true);
      expect(mocks.error).toHaveBeenCalledTimes(1);
      expect(mocks.error.mock.calls[0][0]).toMatch(/超时|60|一分钟/);
      expect(mocks.success).not.toHaveBeenCalled();
      expect(mocks.finalize).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });
      expect(eraseCalls()).toHaveLength(1);
      expect(mocks.readiness).toHaveBeenCalledTimes(1);
      expect(mocks.prepare).toHaveBeenCalledTimes(flow === "已绑定" ? 1 : 0);
      expect(button(flowLabel(flow)).props.disabled).not.toBe(true);
    }
  );
});
