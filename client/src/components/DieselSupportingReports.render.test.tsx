import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DieselPriceHistory,
  DieselSupplierReport,
} from "./DieselSupportingReports";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());
const supplier = {
  supplierName: "真实供油商",
  liters: 100,
  amount: 650,
  averageUnitPrice: 6.5,
  minUnitPrice: 6,
  maxUnitPrice: 7,
  priceSpread: 1,
  recordCount: 5,
  receiptCount: 4,
  alertCount: 1,
};
const price = {
  id: 1,
  pricePerLiter: "6.50",
  effectiveFrom: new Date("2026-11-01T00:00:00Z"),
  effectiveTo: null,
  status: "active",
  remarks: "真实核准记录",
};

describe("柴油辅助报表真实渲染", () => {
  it("供应商表格在容器内横向滚动，中文表头与月份口径完整，无默认打印portal", () => {
    const html = renderToStaticMarkup(
      <DieselSupplierReport
        rows={[supplier]}
        loading={false}
        projectName="道路工程"
        period="2026-11"
      />
    );
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("max-w-full");
    expect(html).toContain("min-w-[880px]");
    expect(html).toContain('aria-label="柴油供应商汇总表格，可横向滚动"');
    expect(html).toContain("最低价（元/L）");
    expect(html).toContain("价差（元/L）");
    expect(html).toContain("凭证笔数");
    expect(html).toContain("价格异常笔数");
    expect(html).toContain("不继承加油台账日期筛选");
    expect(html).toContain("真实供油商");
    expect(html).toContain('value="20" selected=""');
    expect(html).toContain('value="50"');
    expect(html).toContain('value="100"');
    expect(html).not.toContain('role="dialog"');
  });
  it("指导价状态和日期均中文，只有生效开始日期筛选、不包含会计月份控件", () => {
    const html = renderToStaticMarkup(
      <DieselPriceHistory
        rows={[price]}
        loading={false}
        projectName="道路工程"
      />
    );
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("启用");
    expect(html).toContain("未设置结束日期");
    expect(html).toContain("2026-11-01");
    expect(html).toContain("真实核准记录");
    expect(html).toContain("不按会计月份");
    expect(html).toContain('type="date"');
    expect(html).not.toContain('type="month"');
    expect(html).not.toContain('role="dialog"');
  });
  it.each(["loading", "error"] as const)(
    "%s时两表隐藏旧行和汇总，导出打印按钮禁用",
    state => {
      const flags = { loading: state === "loading", error: state === "error" };
      const supplierHtml = renderToStaticMarkup(
        <DieselSupplierReport
          rows={[supplier]}
          {...flags}
          projectName="道路工程"
          period="2026-12"
        />
      );
      const priceHtml = renderToStaticMarkup(
        <DieselPriceHistory rows={[price]} {...flags} projectName="道路工程" />
      );
      expect(supplierHtml).not.toContain("真实供油商");
      expect(supplierHtml).not.toContain("650.00");
      expect(priceHtml).not.toContain("真实核准记录");
      expect(priceHtml).not.toContain("6.50");
      for (const html of [supplierHtml, priceHtml]) {
        expect((html.match(/disabled=""/g) ?? []).length).toBe(2);
        expect(html).not.toContain('role="dialog"');
        expect(html).not.toContain("每页条数");
      }
    }
  );
  it("enabled=false真实渲染为空，无法泄漏隐藏portal", () => {
    expect(
      renderToStaticMarkup(
        <DieselSupplierReport
          rows={[supplier]}
          loading={false}
          projectName="道路工程"
          period="2026-11"
          enabled={false}
        />
      )
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <DieselPriceHistory
          rows={[price]}
          loading={false}
          projectName="道路工程"
          enabled={false}
        />
      )
    ).toBe("");
  });
});
