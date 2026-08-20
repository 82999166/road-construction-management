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
const DEEP_LINK_SIGNATURE_CONTEXT = "road-construction-transport-nfc/deep-link/v1";
const TRANSPORT_NFC_ENTRY_URL = "https://yx.maomaoyx.com/mobile/transport";

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

function createDeepLinkSignature(input: { cardId: number; projectId: number; payloadVersion: number }) {
  return createHmac("sha256", requireCardSigningSecret())
    .update([DEEP_LINK_SIGNATURE_CONTEXT, input.cardId, input.projectId, input.payloadVersion].join("|"), "utf8")
    .digest("base64url")
    .slice(0, 22);
}

/**
 * 正式卡写入一个受控 HTTPS 入口。URL 不携带车牌、电话、路线、方量、价格或金额；
 * 手机打开后仍须由服务端按卡绑定、项目、修订号、当前用户权限重新校验。
 */
export function buildTransportNfcDeepLink(input: { cardId: number; projectId: number; payloadVersion: number }) {
  const signature = createDeepLinkSignature(input);
  const token = Buffer.from(JSON.stringify({ c: input.cardId, p: input.projectId, r: input.payloadVersion, s: signature }), "utf8").toString("base64url");
  return `${TRANSPORT_NFC_ENTRY_URL}?nfc=${encodeURIComponent(token)}`;
}

export function verifyTransportNfcDeepLinkToken(token: string) {
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as { c?: unknown; p?: unknown; r?: unknown; s?: unknown };
    if (!Number.isInteger(parsed.c) || !Number.isInteger(parsed.p) || !Number.isInteger(parsed.r) || typeof parsed.s !== "string") return null;
    const input = { cardId: Number(parsed.c), projectId: Number(parsed.p), payloadVersion: Number(parsed.r) };
    const expected = createDeepLinkSignature(input);
    if (parsed.s.length !== expected.length || !timingSafeEqual(Buffer.from(parsed.s, "utf8"), Buffer.from(expected, "utf8"))) return null;
    return input;
  } catch {
    return null;
  }
}
