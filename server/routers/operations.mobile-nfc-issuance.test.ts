import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "server/routers/operations.ts"),
  "utf8"
);

describe("运输手机 NFC 首次发卡", () => {
  it("对空白卡应以车辆为入口创建待确认绑定，而不是要求浏览器读取物理 UID", () => {
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "prepareMobileNfcInitialIssue"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "vehicleId: z.number().int().positive()"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "mobile-ndef:${randomUUID()}"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'status: "suspended"'.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
  });

  it("首次发卡候选必须由服务端依据车辆、司机资料和启用卡状态统一判定", () => {
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "listMobileNfcInitialIssueCandidates"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "已有启用车辆卡，请使用补写或换卡流程"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "未录入司机手机号".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "eligible: !reason".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
  });

  it("首次写入必须使用服务端签名载荷与深链，并保留受控写卡任务和审计", () => {
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "buildTransportNfcCardPayload"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "buildTransportNfcDeepLink"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "rfidCardWriteJobs".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "prepare_mobile_nfc_initial_issue"
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });

  it("已启用卡的车辆不得重复首次发卡，确认成功仍由既有状态机启用卡片", () => {
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "该车辆已有已启用 NFC 卡".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      "confirmRfidCardWrite".replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    );
    expect(source.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'lastWrittenAt: now, status: job.action === "revoke" ? "revoked" : "active"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });
});
