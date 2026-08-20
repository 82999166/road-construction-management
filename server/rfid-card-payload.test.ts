import { describe, expect, it } from "vitest";
import { buildTransportNfcCardPayload, verifyTransportNfcCardPayload } from "./services/rfidCardPayload";

describe("NTAG216 运输 NFC 最小载荷", () => {
  it("仅携带卡绑定引用、项目引用、修订号、随机挑战值与签名，不携带车辆或司机敏感信息", () => {
    const payload = buildTransportNfcCardPayload({ cardId: 18, projectId: 6, payloadVersion: 2 });
    const serialized = JSON.stringify(payload);

    expect(payload).toMatchObject({ t: "RC2", c: 18, p: 6, r: 2 });
    expect(payload.n).toHaveLength(12);
    expect(payload.s).toHaveLength(22);
    expect(verifyTransportNfcCardPayload(payload)).toBe(true);
    expect(serialized).not.toMatch(/plate|driver|phone|route|amount|volume|cargo/i);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThan(160);
  });

  it("拒绝任何被改写的项目引用、修订号或签名", () => {
    const payload = buildTransportNfcCardPayload({ cardId: 18, projectId: 6, payloadVersion: 2 });
    expect(verifyTransportNfcCardPayload({ ...payload, p: 7 })).toBe(false);
    expect(verifyTransportNfcCardPayload({ ...payload, s: `${payload.s.slice(0, -1)}X` })).toBe(false);
  });
});
