import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("关键多表写入原子性", () => {
  it("库存流水、采购状态与审计日志必须使用同一事务", () => {
    const source = readFileSync(
      new URL("./routers/finance.ts", import.meta.url),
      "utf8"
    );
    const start = source.indexOf("saveInventoryTransaction:");
    const end = source.indexOf("\n});", start);
    const procedure = source.slice(start, end);

    expect(procedure).toContain("await db.transaction(async tx => {");
    expect(procedure).toMatch(/tx\s*\.insert\(inventoryTransactions\)/);
    expect(procedure).toMatch(/tx\s*\.update\(purchaseRequests\)/);
    expect(procedure).toContain("appendIntegrityProtectedAudit(tx");
    expect(procedure).toMatch(/from\(projects\)[\s\S]*?for\("update"\)/);
  });

  it("移动考勤设备绑定、打卡和审计日志必须使用同一事务", () => {
    const source = readFileSync(
      new URL("./routers/labor.ts", import.meta.url),
      "utf8"
    );
    const start = source.indexOf("checkIn: protectedProcedure");
    const end = source.indexOf("listCheckIns:", start);
    const procedure = source.slice(start, end);

    expect(procedure).toContain("await db.transaction(async tx => {");
    expect(procedure).toMatch(/tx\s*\.insert\(attendanceDeviceBindings\)/);
    expect(procedure).toMatch(/tx\s*\.insert\(attendanceCheckIns\)/);
    expect(procedure).toMatch(/tx\s*\.insert\(auditLogs\)/);
  });
});
