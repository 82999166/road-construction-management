import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("服务号业务通知覆盖", () => {
  const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

  it("将关键业务订单与状态节点接入统一服务号投递包装，并保持业务操作与投递故障隔离", () => {
    const finance = read("./routers/finance.ts");
    const admin = read("./routers/admin.ts");
    const labor = read("./routers/labor.ts");
    const settlementPayments = read("./routers/settlementPayments.ts");
    const operations = read("./routers/operations.ts");
    const subcontract = read("./routers/subcontract.ts");
    const contracts = read("./routers/contracts.ts");

    expect(finance).toContain("purchase_order_small_direct_submitted");
    expect(finance).toContain("purchase_order_settlement");
    expect(finance).toContain("inventory_${input.transactionType}");
    expect(admin).toContain("diesel_refuel_recorded");
    expect(admin).toContain("diesel_price_alert");
    expect(labor).toContain("payroll_submitted");
    expect(settlementPayments).toContain("payroll_paid");
    expect(settlementPayments).toContain("daily_wage_paid");
    expect(operations).toContain("transport_plate_photo_ticket_submitted");
    expect(operations).toContain("machine_cost_");
    expect(subcontract).toContain("subcontract_${input.targetStatus}");
    expect(contracts).toContain("outsource_contract_created");
    expect(contracts).toContain("outsource_contract_${input.targetStatus}");
  });

  it("将柴油与合同纳入可配置模板矩阵，并让无模板、未绑定或下发失败写入投递审计而非回滚业务", () => {
    const notifier = read("./services/officialAccountNotifier.ts");
    const wrapper = read("./services/businessNotifier.ts");

    expect(notifier).toContain('module: "diesel"');
    expect(notifier).toContain('module: "contract"');
    expect(notifier).toContain("module_template_not_bound");
    expect(notifier).toContain('status: "failed"');
    expect(notifier).toContain("officialAccountBindings");
    expect(wrapper).toContain("通知故障仅写入投递审计，绝不回滚主业务");
  });
});
