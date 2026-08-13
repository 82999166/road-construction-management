import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("共享按钮可读性", () => {
  it("主按钮保留高对比前景和清晰禁用状态类", () => {
    const markup = renderToStaticMarkup(<Button disabled>保存并启用</Button>);
    expect(markup).toContain("text-primary-foreground");
    expect(markup).toContain("disabled:bg-slate-200");
    expect(markup).toContain("disabled:text-slate-500");
    expect(markup).toContain("disabled:opacity-100");
    expect(markup).toContain("当前不可操作：请完成必填项或等待当前处理结束");
  });

  it("轮廓按钮显式使用前景色而不依赖父级继承", () => {
    const markup = renderToStaticMarkup(<Button variant="outline">保存岗位</Button>);
    expect(markup).toContain("text-foreground");
  });
});
