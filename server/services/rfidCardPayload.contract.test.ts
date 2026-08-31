import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./secretVault";
import { buildTransportNfcCardPayload, createTransportNfcCardPayloadContract } from "./rfidCardPayload";

const originalJwtSecret = process.env.JWT_SECRET;

afterEach(() => {
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});

describe("正式车辆卡 RC3 规范 UTF-8 字节契约", () => {
  it("任务创建、加密保存、解密领取和写卡器摘要均使用同一 payloadJson UTF-8 字节", () => {
    process.env.JWT_SECRET = "rfid-contract-test-only-secret";
    const payload = buildTransportNfcCardPayload({
      cardId: 17,
      projectId: 23,
      payloadVersion: 4,
      plateNo: "测试车牌",
      driverName: "测试司机",
      driverPhone: "13800000000",
    });
    const created = createTransportNfcCardPayloadContract(payload);
    const encrypted = encryptSecret(JSON.stringify({ payloadJson: created.payloadJson, nfcEntryUrl: "https://example.invalid/mobile/transport" }));
    const claimed = JSON.parse(decryptSecret(encrypted)) as { payloadJson: string };
    const writerUtf8Bytes = Buffer.from(claimed.payloadJson, "utf8");

    expect(claimed.payloadJson).toBe(created.payloadJson);
    expect(writerUtf8Bytes.length).toBe(created.payloadUtf8ByteLength);
    expect(createHash("sha256").update(writerUtf8Bytes).digest("hex")).toBe(created.payloadFingerprint);
    expect(createTransportNfcCardPayloadContract(JSON.parse(claimed.payloadJson)).payloadJson).toBe(claimed.payloadJson);
  });
});
