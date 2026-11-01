import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./routers/admin.ts", import.meta.url), "utf8");

describe("柴油台账加油员投影", () => {
  it("仅按每条记录的真实登记人批量查询姓名，不将当前查看账号当作加油员", () => {
    expect(source).toContain("const refuelerUserIds = Array.from(");
    expect(source).toContain("filtered.map(row => row.createdBy)");
    expect(source).toContain("inArray(users.id, refuelerUserIds)");
    expect(source).toContain("refuelerNames.get(row.createdBy) ?? null");
    expect(source).not.toContain("refuelerName: ctx.user.name");
  });
});
