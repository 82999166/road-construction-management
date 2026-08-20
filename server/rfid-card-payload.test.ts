import { describe, expect, it } from "vitest";
import { buildTransportNfcCardPayload, verifyTransportNfcCardPayload } from "./services/rfidCardPayload";

describe("NTAG216 运输 NFC 最小载荷", () => {
  it("携带现场核对所需车牌、司机与电话，并以签名保护卡绑定引用和可读识别字段", () => {
    const payload = buildTransportNfcCardPayload({ cardId: 18, projectId: 6, payloadVersion: 2, plateNo: "粤A12345", driverName: "张司机", driverPhone: "13800138000" });
    const serialized = JSON.stringify(payload);

    expect(payload).toMatchObject({ t: "RC3", c: 18, p: 6, r: 2, v: "粤A12345", d: "张司机", h: "13800138000" });
    expect(payload.n).toHaveLength(12);
    expect(payload.s).toHaveLength(22);
    expect(verifyTransportNfcCardPayload(payload)).toBe(true);
    expect(serialized).not.toMatch(/route|amount|volume|cargo|settlement/i);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThan(240);
  });

  it("拒绝任何被改写的项目引用、修订号或签名", () => {
    const payload = buildTransportNfcCardPayload({ cardId: 18, projectId: 6, payloadVersion: 2, plateNo: "粤A12345", driverName: "张司机", driverPhone: "13800138000" });
    const changedSignature = `${payload.s.slice(0, -1)}${payload.s.endsWith("X") ? "Y" : "X"}`;
    expect(verifyTransportNfcCardPayload({ ...payload, p: 7 })).toBe(false);
    expect(verifyTransportNfcCardPayload({ ...payload, h: "13800138001" })).toBe(false);
    expect(verifyTransportNfcCardPayload({ ...payload, s: changedSignature })).toBe(false);
    expect(verifyTransportNfcCardPayload({ ...payload, s: `${payload.s}x` })).toBe(false);
  });
});
