import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getBusinessStatusLabel } from "./BusinessStatusBadge";

const source = readFileSync(resolve(import.meta.dirname, "BusinessStatusBadge.tsx"), "utf8");

describe("BusinessStatusBadge", () => {
  it("保留劳务审核、付款与终态的真实状态展示", () => {
    expect(source).toContain('approved: "已审核"');
    expect(source).toContain('paid: "已发放"');
    expect(source).toContain('void: "已作废"');
    expect(source).toContain("仅展示服务端真实状态");
  });

  it("将通知和表格常见英文状态投影为中文", () => {
    expect(getBusinessStatusLabel("pending")).toBe("待处理");
    expect(getBusinessStatusLabel("delivered")).toBe("已送达");
    expect(getBusinessStatusLabel("acknowledged")).toBe("已确认收悉");
    expect(getBusinessStatusLabel("ordered")).toBe("已下单");
    expect(getBusinessStatusLabel("in_transit")).toBe("运输中");
    expect(getBusinessStatusLabel("verification_failed")).toBe("核验失败");
  });

  it("不会将未知英文枚举直接回显给用户", () => {
    expect(getBusinessStatusLabel("unrecognized_internal_state")).toBe("待处理");
    expect(getBusinessStatusLabel("已人工确认")).toBe("已人工确认");
    expect(getBusinessStatusLabel(null)).toBe("未登记");
  });
});
