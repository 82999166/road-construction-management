import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FullDatabaseBackupHistory, {
  type FullBackupHistoryEntry,
} from "./FullDatabaseBackupHistory";

type Props = React.ComponentProps<typeof FullDatabaseBackupHistory>;
let view: ReactTestRenderer;
let refresh: ReturnType<typeof vi.fn>;
const entry = (
  values: Partial<FullBackupHistoryEntry> = {}
): FullBackupHistoryEntry => ({
  id: 1,
  createdAt: "2026-11-05T16:05:06Z",
  operatorName: "张管理员",
  status: "success",
  description: "备份已经逐表校验",
  ...values,
});
async function render(values: Partial<Props> = {}) {
  await act(async () => {
    view = TestRenderer.create(
      <FullDatabaseBackupHistory
        loading={false}
        error={false}
        onRefresh={refresh}
        {...values}
      />
    );
  });
}
function text() {
  return JSON.stringify(view.toJSON());
}
beforeEach(() => {
  refresh = vi.fn();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  if (view) await act(async () => view.unmount());
  vi.unstubAllGlobals();
});

describe("完整备份操作记录组件", () => {
  it("最新失败明确区分旧可用备份和本次按钮操作", async () => {
    await render({
      entries: [
        entry({ status: "failed" }),
        entry({ id: 2, createdAt: "2026-11-04T10:00:00Z" }),
      ],
    });
    expect(view.root.findAllByProps({ role: "alert" })).toHaveLength(1);
    expect(text()).toContain("不代表这次按钮操作成功");
    expect(text()).toContain("仍可下载上次经过校验的备份");
  });
  it("最新成功不显示旧失败警告，展示真实操作者与状态", async () => {
    await render({
      entries: [
        entry(),
        entry({ id: 2, status: "failed" }),
        entry({ id: 3, status: "requested" }),
      ],
    });
    expect(view.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    expect(text()).toContain("张管理员");
    for (const label of ["备份完成", "操作未成功", "请求已提交"])
      expect(text()).toContain(label);
  });
  it("加载状态禁止刷新", async () => {
    await render({ loading: true });
    expect(text()).toContain("正在读取备份操作记录");
    expect(view.root.findByType("button").props.disabled).toBe(true);
  });
  it("错误状态可友好刷新", async () => {
    await render({ error: true });
    expect(text()).toContain("暂时无法读取操作记录");
    expect(view.root.findByType("button").props.disabled).toBe(false);
  });
  it("没有按钮记录时说明服务器手工和定时记录在服务日志", async () => {
    await render();
    expect(text()).toContain("暂无后台按钮操作记录");
    expect(text()).toContain("服务器手工执行或定时备份");
  });
  it("真实按钮回调执行一次", async () => {
    await render({ entries: [entry()] });
    await act(async () => view.root.findByType("button").props.onClick());
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("折叠指引包含宝塔终端、备份和启动前失败的应用服务日志，不提供文件路径或凭据", async () => {
    await render();
    expect(view.root.findAllByType("details")).toHaveLength(1);
    const codes = view.root
      .findAllByType("code")
      .map(code => code.children.join(""));
    expect(codes).toEqual([
      'journalctl -u yx-db-backup.service --since "30 minutes ago" --no-pager',
      "systemctl cat yx-cloud-management.service --no-pager | sed -n 's/^StandardError=append://p' | tail -n 1 | xargs -r tail -n 100 --",
    ]);
    expect(text()).toContain("本服务器应用错误日志写入文件");
    expect(text()).toContain("并非这套独立备份服务的日志");
    expect(text()).not.toMatch(/\/etc\/|\/var\/|\/opt\/|password=|SECRET/);
  });
  it("字符串和Date按北京时间跨日显示，异常日期安全回退", async () => {
    await render({
      entries: [
        entry(),
        entry({ id: 2, createdAt: new Date("2026-11-05T16:05:06Z") }),
        entry({ id: 3, createdAt: "invalid" }),
      ],
    });
    const times = view.root
      .findAllByType("time")
      .map(time => time.children.join(""));
    expect(times).toEqual([
      "2026/11/6 00:05:06",
      "2026/11/6 00:05:06",
      "时间待确认",
    ]);
  });
});
