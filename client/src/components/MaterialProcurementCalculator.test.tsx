import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("材料采购多维度计算器界面", () => {
  it("提供文档定义的常用材料下拉及材料和运费成本汇总", () => {
    const source = readFileSync(new URL("./MaterialProcurementCalculator.tsx", import.meta.url), "utf8");
    expect(source).toContain("常用材料下拉");
    expect(source).toContain("机制砂（2 区中砂）");
    expect(source).toContain("普通硅酸盐水泥（P.O42.5）");
    expect(source).toContain("材料成本汇总");
    expect(source).toContain("运费成本汇总");
    expect(source).toContain("基础运费（单价 × 运距 × 数量）");
    expect(source).toContain("燃油附加费合计");
  });

  it("提供 9 种结算预设加自定义、连续供货月数和逐月明细表", () => {
    const source = readFileSync(new URL("./MaterialProcurementCalculator.tsx", import.meta.url), "utf8");
    expect(source).toContain("结算方式（9 种预设＋自定义）");
    expect(source).toContain("连续供货月数");
    expect(source).toContain("滚动月付款比例");
    expect(source).toContain("当期票据支付比例");
    expect(source).toContain("预计上游付款滞后");
    expect(source).toContain("逐月结算、回款与垫资明细");
    expect(source).toContain("未结滚入下月");
    expect(source).toContain("累计现金流");
  });
});
