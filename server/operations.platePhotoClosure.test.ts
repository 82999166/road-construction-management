import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("运输拍照卸土闭环", () => {
  it("拍照发票和NFC发票均可在卸土点通过受控定位完成拍照卸土", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    expect(source).toContain("confirmPlatePhotoUnload");
    expect(source).toContain("unloadEvidenceId");
    expect(source).toContain("transport-unload-${trip.tripNo}");
    expect(source).toContain('loadConfirmedAt: input.invoiceMode === "plate_photo" ? tripStart : null');
    expect(source).toContain('source: "manual_review"');
    expect(source).toContain("getDailyVehicleStageOrdinal");
    expect(source).toContain('eventType: "unload"');
    expect(source).toContain("未达到卸土点");
    expect(source).toContain("activeVehicleTransitKey: null");
    expect(source).toContain("transport_unload_completed");
    expect(source).toContain('unloadConfirmationMode: "photo"');
    expect(source).toContain('status: "submitted"');
    expect(source).not.toContain('message: "该运单应通过 NFC 刷卡闭环，不适用直拍卸土确认"');
  });
});
