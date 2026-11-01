import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PC 阶梯运价设置", () => {
  const source = readFileSync(
    new URL("./TransportFreightRuleManager.tsx", import.meta.url),
    "utf8"
  );

  it("提供独立的规则维护入口和后续运单快照说明", () => {
    expect(source).toContain("阶梯运价设置");
    expect(source).toContain("新增运价");
    expect(source).toContain("编辑阶梯运价");
    expect(source).toContain("历史运单的运价快照和结算金额保持不变");
    expect(source).toContain("路线只能选择“生效”规则");
  });

  it("通过既有受控运输接口保存并刷新路线可选运价", () => {
    expect(source).toContain("trpc.transport.listFreightRules.useQuery");
    expect(source).toContain("trpc.transport.saveFreightRule.useMutation");
    expect(source).toContain("utils.transport.listFreightRules.invalidate()");
    expect(source).toContain("utils.transport.listRoutePresets.invalidate()");
    expect(source).toContain("status: draft.status");
    expect(source).toContain("effectiveFrom: draft.effectiveFrom");
  });
});
