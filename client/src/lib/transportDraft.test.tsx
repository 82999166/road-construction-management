import React from "react";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { discardTransportDraft, useTransportDirty } from "./transportDraft";
const { act, create } = createRequire(import.meta.url)("react-test-renderer");
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
function Probe({
  dirty,
  callback,
}: {
  dirty: boolean;
  callback: (dirty: boolean) => void;
}) {
  useTransportDirty(dirty, callback);
  return <span>{dirty ? "未保存" : "无草稿"}</span>;
}
describe("运输草稿保护", () => {
  it("拒绝取消不清理资料，不将取消当成保存", () => {
    const discard = vi.fn();
    const confirm = vi.fn(() => false);
    expect(discardTransportDraft(true, discard, confirm)).toBe(false);
    expect(discard).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("此操作不是保存")
    );
  });
  it("确认放弃才清理资料，干净表单可直接关闭", () => {
    const discard = vi.fn();
    const confirm = vi.fn(() => true);
    expect(discardTransportDraft(true, discard, confirm)).toBe(true);
    expect(discard).toHaveBeenCalledTimes(1);
    confirm.mockClear();
    expect(discardTransportDraft(false, discard, confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledTimes(2);
  });
  it("稳定callback和相同dirty不产生重复回传或重渲染循环，卸载解除父级锁", async () => {
    const callback = vi.fn();
    let root: ReturnType<typeof create>;
    await act(async () => {
      root = create(<Probe dirty={true} callback={callback} />);
    });
    expect(callback.mock.calls).toEqual([[true]]);
    await act(async () => {
      root.update(<Probe dirty={true} callback={callback} />);
    });
    expect(callback.mock.calls).toEqual([[true]]);
    await act(async () => {
      root.update(<Probe dirty={false} callback={callback} />);
    });
    expect(callback.mock.calls.at(-1)).toEqual([false]);
    callback.mockClear();
    await act(async () => {
      root.unmount();
    });
    expect(callback.mock.calls).toEqual([[false]]);
  });
});
