import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("高频项目台账查询索引", () => {
  it("为财务流水、工资和运输台账保留项目、期间、状态筛选索引", () => {
    const schema = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");
    const migration = readFileSync(new URL("../drizzle/0069_modern_leopardon.sql", import.meta.url), "utf8");

    expect(schema).toContain("financial_records_project_settlement_occurred_index");
    expect(schema).toContain("payroll_statements_project_period_status_index");
    expect(schema).toContain("transport_trips_project_status_start_index");
    expect(migration).toContain("CREATE INDEX `financial_records_project_settlement_occurred_index`");
    expect(migration).toContain("CREATE INDEX `payroll_statements_project_period_status_index`");
    expect(migration).toContain("CREATE INDEX `transport_trips_project_status_start_index`");
  });
});
