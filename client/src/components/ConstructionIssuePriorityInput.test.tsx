import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConstructionIssuePriorityInput } from "./ConstructionIssuePriorityInput";

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => vi.unstubAllGlobals());

describe("施工问题等级输入", () => {
  it("新建一般黄色、紧急红色且显式选择带check；文本和aria表达等级", async () => {
    const onChange = vi.fn();
    let view!: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      view = TestRenderer.create(
        <ConstructionIssuePriorityInput value="normal" onChange={onChange} />
      );
    });
    const radios = view.root.findAllByType("input");
    expect(radios[0].props.checked).toBe(true);
    expect(radios[0].props["aria-label"]).toBe("一般");
    expect(radios[1].props["aria-label"]).toBe("紧急");
    expect(view.root.findAllByType("label")[0].props.className).toContain(
      "yellow"
    );
    expect(view.root.findAllByType("label")[1].props.className).toContain(
      "red"
    );
    expect(view.root.findAllByType("svg")).toHaveLength(1);
    await act(async () => radios[1].props.onChange());
    expect(onChange).toHaveBeenCalledWith("urgent");
    await act(async () =>
      view.update(
        <ConstructionIssuePriorityInput value="urgent" onChange={onChange} />
      )
    );
    expect(view.root.findAllByType("input")[1].props.checked).toBe(true);
    await act(async () => view.unmount());
  });
  it("历史NULL不自动改一般；disabled保留NULL并禁止选择", async () => {
    const onChange = vi.fn();
    let view!: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      view = TestRenderer.create(
        <ConstructionIssuePriorityInput
          value={null}
          onChange={onChange}
          disabled
        />
      );
    });
    expect(JSON.stringify(view.toJSON())).toContain("历史未分级");
    expect(onChange).not.toHaveBeenCalled();
    for (const radio of view.root.findAllByType("input")) {
      expect(radio.props.checked).toBe(false);
      expect(radio.props.disabled).toBe(true);
      await act(async () => radio.props.onChange());
    }
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => view.unmount());
  });
});
