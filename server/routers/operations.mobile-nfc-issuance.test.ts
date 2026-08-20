import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "server/routers/operations.ts"), "utf8");

describe("运输手机 NFC 首次发卡", () => {
  it("对空白卡应以车辆为入口创建待确认绑定，而不是要求浏览器读取物理 UID", () => {
    expect(source).toContain("prepareMobileNfcInitialIssue");
    expect(source).toContain("vehicleId: z.number().int().positive()");
    expect(source).toContain("mobile-ndef:${randomUUID()}");
    expect(source).toContain('status: "suspended"');
  });

  it("首次发卡候选必须由服务端依据车辆、司机资料和启用卡状态统一判定", () => {
    expect(source).toContain("listMobileNfcInitialIssueCandidates");
    expect(source).toContain("已有启用车辆卡，请使用补写或换卡流程");
    expect(source).toContain("未录入司机手机号");
    expect(source).toContain("eligible: !reason");
  });

  it("首次写入必须使用服务端签名载荷与深链，并保留受控写卡任务和审计", () => {
    expect(source).toContain("buildTransportNfcCardPayload");
    expect(source).toContain("buildTransportNfcDeepLink");
    expect(source).toContain("rfidCardWriteJobs");
    expect(source).toContain("prepare_mobile_nfc_initial_issue");
  });

  it("已启用卡的车辆不得重复首次发卡，确认成功仍由既有状态机启用卡片", () => {
    expect(source).toContain("该车辆已有已启用 NFC 卡");
    expect(source).toContain("confirmRfidCardWrite");
    expect(source).toContain('lastWrittenAt: now, status: job.action === "revoke" ? "revoked" : "active"');
  });
});
