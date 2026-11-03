import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";
const raw = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");
const normalized = raw.replace(/\s+/g, " ");
const file = ts.createSourceFile(
  "AdminPage.tsx",
  raw,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const panels: { label: string; active: string; text: string }[] = [];
function scan(node: ts.Node) {
  if (
    ts.isJsxElement(node) &&
    node.openingElement.tagName.getText(file) === "FinanceRetainedPanel"
  ) {
    const attributes = node.openingElement.attributes.properties;
    const label = attributes.find(
      a => ts.isJsxAttribute(a) && a.name.getText(file) === "label"
    ) as ts.JsxAttribute | undefined;
    const active = attributes.find(
      a => ts.isJsxAttribute(a) && a.name.getText(file) === "active"
    ) as ts.JsxAttribute | undefined;
    panels.push({
      label: label?.initializer?.getText(file).replace(/"/g, "") ?? "",
      active: active?.initializer?.getText(file).replace(/\s+/g, " ") ?? "",
      text: node.getText(file),
    });
  }
  ts.forEachChild(node, scan);
}
scan(file);
function query(name: string) {
  const start = raw.indexOf(`  const ${name} =`);
  return raw
    .slice(start, raw.indexOf("\n  const ", start + 8))
    .replace(/\s+/g, " ");
}
describe("柴油四栏目独立业务工作区", () => {
  it("合法JSX包含四栏目且默认加油台账", () => {
    expect(
      (file as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics
    ).toHaveLength(0);
    expect(
      raw.match(/const \[dieselTab, setDieselTab\][\s\S]*?;/)?.[0]
    ).toContain('("ledger")');
    for (const label of ["加油台账", "油价与预警", "供应商对账", "柴油票据"]) {
      expect(
        panels.some(
          p =>
            p.label === label &&
            p.active.includes("isDiesel") &&
            p.active.includes("dieselTab")
        )
      ).toBe(true);
    }
  });
  it("全项目账本、发票、封账和财税面板只在财务显示", () => {
    for (const label of ["收支账本", "发票管理", "日结封存", "财税交接"]) {
      const panel = panels.find(p => p.label === label);
      expect(panel?.active).toContain("!isDiesel");
      expect(panel?.active).not.toContain("isDiesel ||");
    }
    const diesel = panels.find(p => p.label === "柴油管理")!.text;
    expect(diesel).not.toContain("TaxAccountingHandoffManager");
    expect(diesel).not.toContain("closeDailyAccount.mutate");
    expect(diesel).not.toContain("reopenDailyAccount.mutate");
    expect(diesel).not.toContain("financeInvoiceRows.map");
    expect(diesel).toContain("前往财务发票管理");
  });
  it("柴油页不读取全项目账本、发票和会计封存", () => {
    for (const name of [
      "financeSummary",
      "financeInvoices",
      "dailyAccountingReport",
    ]) {
      expect(query(name)).toContain("!isDiesel");
      expect(query(name)).not.toContain("(isDiesel ||");
    }
    expect(query("dieselRefuelRecords")).toContain('dieselTab === "receipts"');
    expect(query("dieselPriceAlertRule")).toContain('dieselTab === "prices"');
    expect(query("dieselSupplierReconciliation")).toContain(
      'dieselTab === "suppliers"'
    );
  });
  it("加油台账分页但汇总、凭证预览和导出使用全部当前筛选记录", () => {
    expect(normalized).toContain("dieselLedgerPagination.pageRows.map");
    expect(normalized).toContain("total={dieselLedgerPagination.total}");
    expect(normalized).toContain("summarizeDieselLedgerRecords");
    expect(normalized).toContain(
      "(dieselRefuelRecords.data ?? []).map(item => ["
    );
    expect(normalized).toContain(
      "records={ (dieselRefuelRecords.data ?? []) as DieselPrintRecord[] }"
    );
    expect(normalized).toContain("柴油台账统计不等同于全项目会计日结");
    expect(normalized).toContain("加油小票不等同于正式发票或已抵扣凭证");
  });
  it("登记和指导价写入仍复用原接口，刷新不会调用无关账本查询", () => {
    const start = raw.indexOf("  const refreshDieselLedger =");
    const refresh = raw.slice(
      start,
      raw.indexOf("  const stopDieselCamera", start)
    );
    expect(refresh).toContain("trpcUtils.admin.diesel.invalidate()");
    expect(refresh).not.toContain("financeSummary.refetch()");
    expect(normalized).toContain(
      "trpc.admin.diesel.saveRefuelRecord.useMutation"
    );
    expect(normalized).toContain(
      "trpc.admin.diesel.saveGuidelinePrice.useMutation"
    );
    expect(query("dieselGuidelinePrices")).toContain("dieselRefuelDialogOpen");
  });
});
