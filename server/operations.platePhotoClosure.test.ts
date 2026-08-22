import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("直拍车牌运输闭环", () => {
  it("直拍开票在装土时进入在途，并以受控定位完成卸土", () => {
    const source = readFileSync(new URL("./routers/operations.ts", import.meta.url), "utf8");
    expect(source).toContain("confirmPlatePhotoUnload");
    expect(source).toContain("unloadEvidenceId");
    expect(source).toContain("transport-unload-${trip.tripNo}");
    expect(source).toContain('loadConfirmedAt: input.invoiceMode === "plate_photo" ? tripStart : null');
    expect(source).toContain('source: "manual_review"');
    expect(source).toContain("未达到卸土点");
    expect(source).toContain("activeVehicleTransitKey: null");
    expect(source).toContain("transport_unload_completed");
  });
});
