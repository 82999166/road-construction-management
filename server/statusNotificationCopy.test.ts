import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 业务状态的英文码只允许留在数据库、接口参数与事件编码中。
 * 此测试守住服务端用户通知和审计摘要的中文边界。
 */
describe("服务端状态通知中文化", () => {
  const operations = readFileSync(
    new URL("./routers/operations.ts", import.meta.url),
    "utf8"
  );
  const construction = readFileSync(
    new URL("./routers/construction.ts", import.meta.url),
    "utf8"
  );
  const finance = readFileSync(
    new URL("./routers/finance.ts", import.meta.url),
    "utf8"
  );
  const subcontract = readFileSync(
    new URL("./routers/subcontract.ts", import.meta.url),
    "utf8"
  );
  const contracts = readFileSync(
    new URL("./routers/contracts.ts", import.meta.url),
    "utf8"
  );
  const broadcast = readFileSync(
    new URL("./routers/broadcast.ts", import.meta.url),
    "utf8"
  );

  it("运输、机械与施工日报状态通知使用中文标签而不是原始状态码", () => {
    expect(operations).toContain("getBusinessStatusLabel(input.nextStatus)");
    expect(operations).not.toContain("title: `运输趟次已${input.nextStatus}`");
    expect(operations).not.toContain("title: `机械成本已${input.nextStatus}`");
    expect(construction).toContain("getBusinessStatusLabel(input.nextStatus)");
    expect(construction).not.toContain(
      "title: `施工日报已${input.nextStatus}`"
    );
  });

  it("采购、计量和分包状态通知使用中文标签而不是原始状态码", () => {
    expect(finance).toMatch(
      /getBusinessStatusLabel\(\s*effectiveTargetStatus\s*\)/
    );
    expect(finance).toMatch(
      /getBusinessStatusLabel\(\s*input\.targetStatus\s*\)/
    );
    expect(finance).not.toContain(
      "title: `采购申请已${effectiveTargetStatus}`"
    );
    expect(finance).not.toContain("title: `采购订单已${input.targetStatus}`");
    expect(subcontract).toContain("getBusinessStatusLabel(input.targetStatus)");
    expect(subcontract).not.toContain(
      "title: `分包批次已${input.targetStatus}`"
    );
  });

  it("财税、合同、群发的审计摘要不直接回显内部状态码", () => {
    expect(finance).not.toContain("状态变更为：${input.targetStatus}");
    expect(contracts).toContain("getBusinessStatusLabel(input.targetStatus)");
    expect(contracts).not.toContain("状态变更为：${input.targetStatus}");
    expect(broadcast).toContain("getBusinessStatusLabel(nextStatus)");
    expect(broadcast).not.toContain("状态变更为：${nextStatus}");
  });
});
