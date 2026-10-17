import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "server/routers/finance.ts"), "utf8");
const schema = readFileSync(resolve(process.cwd(), "drizzle/schema.ts"), "utf8");

describe("采购仓储 Excel 历史导入契约", () => {
  it("仅允许超级管理员批量导入，并在服务端校验范围和库存权限", () => {
    const procedure = source.slice(source.indexOf("importSpreadsheet:"), source.indexOf("listPurchaseEvidences:"));
    expect(procedure).toContain("await assertSuperAdmin(ctx)");
    expect(procedure).toContain("await assertProjectInCurrentScope(ctx, input.projectId)");
    expect(procedure).toContain("当前岗位无库存收发导入权限");
  });

  it("阻断同文件和历史单号重复，并整批保留可审计写入", () => {
    const procedure = source.slice(source.indexOf("importSpreadsheet:"), source.indexOf("listPurchaseEvidences:"));
    expect(procedure).toContain("导入文件中存在重复采购订单号");
    expect(procedure).toContain("导入文件中存在重复库存流水单号");
    expect(procedure).toContain("采购订单号已存在");
    expect(procedure).toContain("库存流水单号已存在");
    expect(procedure).toContain("await db.transaction");
    expect(procedure).toContain('action: "import_purchase_spreadsheet"');
  });

  it("将实际采购者作为独立快照保存，不能混同导入操作人", () => {
    const procedure = source.slice(source.indexOf("importSpreadsheet:"), source.indexOf("listPurchaseEvidences:"));
    expect(schema).toContain('purchaserName: varchar("purchaserName", { length: 128 })');
    expect(source).toContain('purchaserName: z.string().trim().min(1, "请填写采购者").max(128)');
    expect(procedure).toContain("purchaserName: row.purchaserName.trim()");
    expect(procedure).toContain("采购者快照");
  });

  it("历史采购订单采用独立模式、草稿状态并允许之后补传附件", () => {
    const procedure = source.slice(source.indexOf("importSpreadsheet:"), source.indexOf("listPurchaseEvidences:"));
    expect(schema).toContain('mysqlEnum("procurementMode", ["request", "small_direct", "imported"])');
    expect(procedure).toContain('procurementMode: "imported" as const');
    expect(procedure).toContain('status: "draft" as const');
    expect(procedure).toContain("发票附件须后续补传");
  });
});
