import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React, { type ReactElement } from "react";

vi.mock("react", async original => ({
  ...(await original<typeof import("react")>()),
  useId: () => "business-test",
  useRef: () => ({ current: [] }),
}));

import { BusinessWorkspaceNavigation } from "./BusinessWorkspaceNavigation";

const tabs = [
  { value: "ledger", label: "业务台账" },
  { value: "audit", label: "审核待办", badge: 3 },
  { value: "costs", label: "费用统计" },
  { value: "settings", label: "业务配置" },
] as const;

type ButtonProps = {
  onKeyDown: (event: { key: string; preventDefault: () => void }) => void;
  onClick: () => void;
  "aria-selected": boolean;
  disabled: boolean;
  tabIndex: number;
};
function buttons(onValueChange = vi.fn(), disabled = false) {
  const tree = BusinessWorkspaceNavigation({
    tabs,
    value: "ledger",
    onValueChange,
    label: "业务工作区栏目",
    disabled,
  });
  return {
    onValueChange,
    rows: tree.props.children as ReactElement<ButtonProps>[],
  };
}

describe("四模块共用栏目导航", () => {
  it("手机换行且正确标识当前栏目和待办数量", () => {
    const html = renderToStaticMarkup(
      <BusinessWorkspaceNavigation
        tabs={tabs}
        value="ledger"
        onValueChange={() => {}}
        label="业务工作区栏目"
      />
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="业务工作区栏目"');
    expect(html).toContain("grid-cols-2");
    expect(html).toContain("lg:grid-cols-4");
    expect(html).toContain("审核待办");
    expect(html).toContain('aria-selected="true"');
    expect(html).not.toContain("overflow-x-auto");
  });
  it("方向键循环切换并支持首尾键", () => {
    const { rows, onValueChange } = buttons();
    const preventDefault = vi.fn();
    rows[0].props.onKeyDown({ key: "ArrowLeft", preventDefault });
    expect(onValueChange).toHaveBeenLastCalledWith("settings");
    rows[3].props.onKeyDown({ key: "ArrowRight", preventDefault });
    expect(onValueChange).toHaveBeenLastCalledWith("ledger");
    rows[1].props.onKeyDown({ key: "End", preventDefault });
    expect(onValueChange).toHaveBeenLastCalledWith("settings");
    rows[2].props.onKeyDown({ key: "Home", preventDefault });
    expect(onValueChange).toHaveBeenLastCalledWith("ledger");
    expect(preventDefault).toHaveBeenCalledTimes(4);
  });
  it("只将选中栏目放入Tab顺序，点击进入对应业务", () => {
    const { rows, onValueChange } = buttons();
    expect(rows.map(row => row.props.tabIndex)).toEqual([0, -1, -1, -1]);
    expect(rows.map(row => row.props["aria-selected"])).toEqual([
      true,
      false,
      false,
      false,
    ]);
    rows[2].props.onClick();
    expect(onValueChange).toHaveBeenCalledWith("costs");
  });
  it("禁用时键盘不切换且按钮不可聚焦", () => {
    const { rows, onValueChange } = buttons(vi.fn(), true);
    rows[0].props.onKeyDown({ key: "ArrowRight", preventDefault: vi.fn() });
    expect(onValueChange).not.toHaveBeenCalled();
    expect(
      rows.every(row => row.props.disabled && row.props.tabIndex === -1)
    ).toBe(true);
  });
  it("五、六栏目按数量形成桌面等宽导航", () => {
    for (const count of [5, 6]) {
      const values = Array.from({ length: count }, (_, index) => ({
        value: String(index),
        label: `栏目${index}`,
      }));
      const html = renderToStaticMarkup(
        <BusinessWorkspaceNavigation
          tabs={values}
          value="0"
          onValueChange={() => {}}
          label="测试业务栏目"
        />
      );
      expect(html).toContain(`lg:grid-cols-${count}`);
    }
  });
});
