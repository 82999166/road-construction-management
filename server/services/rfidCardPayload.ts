import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ENV } from "../_core/env";

export type TransportNfcCardPayloadV2 = {
  t: "RC3";
  c: number;
  p: number;
  r: number;
  v: string;
  d: string;
  h: string;
  n: string;
  s: string;
};

const SIGNATURE_CONTEXT = "road-construction-transport-nfc/v2";

function requireCardSigningSecret() {
  if (!ENV.cookieSecret) throw new Error("系统签名密钥不可用，不能生成安全运输 NFC 写卡载荷");
  return ENV.cookieSecret;
}

function signingText(payload: Omit<TransportNfcCardPayloadV2, "s">) {
  return [SIGNATURE_CONTEXT, payload.t, payload.c, payload.p, payload.r, payload.v, payload.d, payload.h, payload.n].join("|");
}

function createSignature(payload: Omit<TransportNfcCardPayloadV2, "s">) {
  return createHmac("sha256", requireCardSigningSecret()).update(signingText(payload), "utf8").digest("base64url").slice(0, 22);
}

/**
 * NTAG216 卡内写入现场发票管理员需要核对的车牌、司机姓名和联系电话，以及签名保护的卡绑定引用。原始卡 UID 由读卡器读取后单独派生指纹；路线、方量、单价、金额和结算状态全部留在服务端权威台账。
 */
export function buildTransportNfcCardPayload(input: { cardId: number; projectId: number; payloadVersion: number; plateNo: string; driverName: string; driverPhone: string }): TransportNfcCardPayloadV2 {
  const unsigned = {
    t: "RC3" as const,
    c: input.cardId,
    p: input.projectId,
    r: input.payloadVersion,
    v: input.plateNo,
    d: input.driverName,
    h: input.driverPhone,
    n: randomBytes(9).toString("base64url"),
  };
  return { ...unsigned, s: createSignature(unsigned) };
}

export function verifyTransportNfcCardPayload(payload: TransportNfcCardPayloadV2) {
  const { s, ...unsigned } = payload;
  const expected = createSignature(unsigned);
  if (typeof s !== "string" || s.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(s, "utf8"), Buffer.from(expected, "utf8"));
}
