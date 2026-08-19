import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SettlementTemplateCalculator from "./SettlementTemplateCalculator";

describe("原生计量结算模板", () => {
  it("默认渲染土石方收方、双价测算和付款区域，而非外部 iframe", () => {
    const markup = renderToStaticMarkup(<SettlementTemplateCalculator />);

    expect(markup).toContain("土石方结算模板");
    expect(markup).toContain("附属工程结算模板");
    expect(markup).toContain("收方台账（天然方）");
    expect(markup).toContain("分包计价与中标收入");
    expect(markup).toContain("本期应付分包商");
    expect(markup).not.toContain("iframe");
    expect(markup).not.toContain("Not found");
  });

  it("附属工程页签提供里程、图纸参数、自动方量和业主/分包双价对照", () => {
    const markup = renderToStaticMarkup(<SettlementTemplateCalculator initialTab="auxiliary" />);

    expect(markup).toContain("附属工程构件清单与双价测算");
    expect(markup).toContain("里程桩号");
    expect(markup).toContain("图纸长(m)");
    expect(markup).toContain("图纸宽(m)");
    expect(markup).toContain("图纸高(m)");
    expect(markup).toContain("自动方量");
    expect(markup).toContain("业主金额");
    expect(markup).toContain("分包金额");
    expect(markup).toContain("测算差额");
  });
});
