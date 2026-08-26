import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("运输运费 A4 PDF 打印模板", () => {
  it("按车牌与日期读取真实受控运单，并默认排除作废记录", () => {
    const source = readFileSync(new URL("./TransportFreightPrintDialog.tsx", import.meta.url), "utf8");

    expect(source).toContain("trpc.transport.listTrips.useQuery");
    expect(source).toContain("dateFrom");
    expect(source).toContain("dateTo");
    expect(source).toContain("vehicleId");
    expect(source).toContain('trip.status !== "void"');
    expect(source).toContain("包含作废单");
  });

  it("按 A4 横向逐条打印，并在最后一行汇总金额、趟数和车辆数", () => {
    const source = readFileSync(new URL("./TransportFreightPrintDialog.tsx", import.meta.url), "utf8");

    expect(source).toContain("@page { size: A4 landscape");
    expect(source).toContain("trips.map((trip, index)");
    expect(source).toContain("运输运费明细表");
    expect(source).toContain("柴油扣款");
    expect(source).toContain("去重车辆数");
    expect(source).toContain("运单趟数");
    expect(source).toContain("打印 / 保存 PDF");
    expect(source).toContain("openA4LandscapePrintDocument");
    expect(source).toContain("bodyHtml");
  });
});
