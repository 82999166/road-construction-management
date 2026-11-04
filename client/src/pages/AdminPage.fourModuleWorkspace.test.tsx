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
      "VehicleManagementWorkspace",
    ]) {
      expect(source.match(new RegExp(`<${component} `, "g"))).toHaveLength(1);
    }
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'label="运输工作区栏目"'.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'active={transportWorkspaceTab === "rates"}'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'active={transportWorkspaceTab === "terminals"}'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });
  it("新内部录入回传稳定草稿状态，项目切换和退出保留保护", () => {
    for (const callback of [
      "onVehicleManagementDirtyChange",
      "onPurchasingDirtyChange",
      "onTransportRatesDirtyChange",
      "onTransportRoutesDirtyChange",
      "onTransportTerminalsDirtyChange",
    ]) {
      expect(source).toContain(`const ${callback} = useCallback(`);
      expect(source).toContain(`onDirtyChange={${callback}}`);
    }
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "Object.values(workspaceDrafts).some(Boolean)"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "purchaseSpreadsheetImportOpen || machineryPaymentFormOpen || hasWorkspaceDraft"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'document.addEventListener("click", beforeNavigate, true)'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'window.addEventListener("beforeunload", beforeUnload)'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "event.preventDefault(); event.stopPropagation();"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "onPaymentFormOpenChange={setMachineryPaymentFormOpen}"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    const vehicle = readFileSync(
      new URL("../components/VehicleManagementWorkspace.tsx", import.meta.url),
      "utf8"
    ).replace(/\s+/g, " ");
    const detail = readFileSync(
      new URL("../components/VehicleManagementDetail.tsx", import.meta.url),
      "utf8"
    ).replace(/\s+/g, " ");
    expect(vehicle.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "recordDetailDirty=useCallback("
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(vehicle.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "onDirtyChange={recordDetailDirty}"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(vehicle.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "onDirtyChange?.(dirty);return()=>onDirtyChange?.(false)"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(vehicle.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "[dirty,onDirtyChange]".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(vehicle.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "if(dirty&&!confirmVehicleDiscard(true,()=>{}))return;"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(detail.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "confirmVehicleDiscard(dirty,onClose)"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(detail.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "target||edit||payeeOpen||paymentDirty"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(detail.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "onDirtyChange={setPaymentDirty}"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });
  it("运输结算独立草稿仍须接回父级项目切换与退出保护，不能由单车详情回调替代", () => {
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "const onTransportSettlementDirtyChange = useCallback("
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "onDirtyChange={onTransportSettlementDirtyChange}"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'recordWorkspaceDirty("transport-settlement", dirty)'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
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
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "onCreateSettlement={openTripSettlement}"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });
});
