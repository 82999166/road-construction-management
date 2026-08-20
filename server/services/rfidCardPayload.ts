import { createHmac, randomBytes } from "node:crypto";
import { ENV } from "../_core/env";

export type TransportNfcCardPayloadV2 = {
  t: "RC2";
  c: number;
  p: number;
  r: number;
  n: string;
  s: string;
};

const SIGNATURE_CONTEXT = "road-construction-transport-nfc/v2";

function requireCardSigningSecret() {
  if (!ENV.cookieSecret) throw new Error("系统签名密钥不可用，不能生成安全运输 NFC 写卡载荷");
  return ENV.cookieSecret;
}

function signingText(payload: Omit<TransportNfcCardPayloadV2, "s">) {
  return [SIGNATURE_CONTEXT, payload.t, payload.c, payload.p, payload.r, payload.n].join("|");
}

function createSignature(payload: Omit<TransportNfcCardPayloadV2, "s">) {
  return createHmac("sha256", requireCardSigningSecret()).update(signingText(payload), "utf8").digest("base64url").slice(0, 22);
}

/**
 * NTAG216 卡内只写最小身份凭证。原始卡 UID 由读卡器读取后单独派生指纹；车牌、司机、电话、路线、方量、单价和金额全部留在服务端权威台账。
 */
export function buildTransportNfcCardPayload(input: { cardId: number; projectId: number; payloadVersion: number }): TransportNfcCardPayloadV2 {
  const unsigned = {
    t: "RC2" as const,
    c: input.cardId,
    p: input.projectId,
    r: input.payloadVersion,
    n: randomBytes(9).toString("base64url"),
  };
  return { ...unsigned, s: createSignature(unsigned) };
}

export function verifyTransportNfcCardPayload(payload: TransportNfcCardPayloadV2) {
  const { s, ...unsigned } = payload;
  return s === createSignature(unsigned);
}
