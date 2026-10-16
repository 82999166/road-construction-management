import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const COMPONENTS_USING_SAFE_ERROR_COPY = [
  "ContractManagementPanel.tsx",
  "DieselSummaryPrintDialog.tsx",
  "MachinePaymentSettlementManager.tsx",
  "MachinerySummaryPrintDialog.tsx",
  "NotificationChannelSettings.tsx",
  "SubcontractPaymentSettlementManager.tsx",
  "TaxAccountingHandoffManager.tsx",
  "TaxComplianceControlPanel.tsx",
  "TransportFreightPrintDialog.tsx",
  "TransportRouteConfigurationEditor.tsx",
  "TransportRouteSafetySettings.tsx",
  "TransportTripLedger.tsx",
  "TransportVehicleSettlementManager.tsx",
] as const;

describe("电脑端用户异常提示安全映射", () => {
  it("合同、结算、路线、通知、税务和打印组件不直接回显内部异常", () => {
    for (const fileName of COMPONENTS_USING_SAFE_ERROR_COPY) {
      const source = readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");

      expect(source).toContain('getUserFacingErrorMessage');
      expect(source).not.toContain("toast.error(error.message)");
      expect(source).not.toContain("error instanceof Error ? error.message");
    }
  });
});
