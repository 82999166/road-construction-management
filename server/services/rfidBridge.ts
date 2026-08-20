import { createHash, randomBytes } from "node:crypto";

export const RFID_BRIDGE_TOKEN_TTL_MS = 5 * 60 * 1000;

export function createRfidBridgeToken() {
  return randomBytes(32).toString("base64url");
}

export function hashRfidBridgeToken(token: string) {
  return createHash("sha256").update(`road-construction-rfid-bridge/v1:${token}`, "utf8").digest("hex");
}
