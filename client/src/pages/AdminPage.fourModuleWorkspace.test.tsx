import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = readFileSync(
  new URL("./AdminPage.tsx", import.meta.url),
  "utf8"
).replace(/\s+/g, " ");
describe("四业务模块集成完整性", () => {
  it("施工采购机械保留唯一工作区，运输使用独立栏目而非锚点长页", () => {
    for (const component of [
      "ConstructionWorkspace",
      "PurchasingWorkspace",
      "MachineryWorkspace",
    ]) {
      expect(source.match(new RegExp(`<${component} `, "g"))).toHaveLength(1);
    }
    expect(source).toContain('label="运输工作区栏目"');
    expect(source).toContain('active={transportWorkspaceTab === "rates"}');
    expect(source).toContain('active={transportWorkspaceTab === "terminals"}');
  });
  it("新内部录入回传稳定草稿状态，项目切换和退出保留保护", () => {
    for (const callback of [
      "onPurchasingDirtyChange",
      "onTransportSettlementDirtyChange",
      "onTransportRatesDirtyChange",
      "onTransportRoutesDirtyChange",
      "onTransportTerminalsDirtyChange",
    ]) {
      expect(source).toContain(`const ${callback} = useCallback(`);
      expect(source).toContain(`onDirtyChange={${callback}}`);
    }
    expect(source).toContain("Object.values(workspaceDrafts).some(Boolean)");
    expect(source).toContain(
      "purchaseSpreadsheetImportOpen || machineryPaymentFormOpen || hasWorkspaceDraft"
    );
    expect(source).toContain(
      'document.addEventListener("click", beforeNavigate, true)'
    );
    expect(source).toContain(
      'window.addEventListener("beforeunload", beforeUnload)'
    );
    expect(source).toContain(
      "event.preventDefault(); event.stopPropagation();"
    );
    expect(source).toContain(
      "onPaymentFormOpenChange={setMachineryPaymentFormOpen}"
    );
  });
  it("写入仍调用原始受控接口，不创建新的非审计付款或库存通道", () => {
    for (const name of [
      "saveMachine.mutate",
      "saveMachineCost.mutate",
      "saveMachineDailyOperation.mutate",
      "purchaseSpreadsheetImport",
      "saveAssetMaintenance.mutate",
    ]) {
      expect(source).toContain(name);
    }
    expect(source).toContain("onCreateSettlement={openTripSettlement}");
  });
});
