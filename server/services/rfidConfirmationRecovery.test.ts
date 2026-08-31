import { describe, expect, it } from "vitest";
import { isRfidConfirmationRecoveryEligible, RFID_CONFIRMATION_RECEIPT_FAILURE } from "./rfidConfirmationRecovery";

const card = { id: 9, projectId: 3, vehicleId: 7, status: "suspended" as const, lastWrittenAt: null };
const job = { id: 21, cardId: 9, projectId: 3, executionMode: "pc_bridge", status: "failed", failureReason: RFID_CONFIRMATION_RECEIPT_FAILURE, action: "issue" as const };

describe("RFID 写卡确认恢复资格", () => {
  it("只允许最新且明确因本机确认收据保存失败的首次 PC 写卡任务", () => {
    expect(isRfidConfirmationRecoveryEligible({ job, card, latestJobIdForCard: 21 })).toBe(true);
  });

  it("拒绝旧任务、其他失败原因、已挂失卡和不符合补写状态的任务", () => {
    expect(isRfidConfirmationRecoveryEligible({ job, card, latestJobIdForCard: 22 })).toBe(false);
    expect(isRfidConfirmationRecoveryEligible({ job: { ...job, failureReason: "card_user_area_write_failed" }, card, latestJobIdForCard: 21 })).toBe(false);
    expect(isRfidConfirmationRecoveryEligible({ job, card: { ...card, status: "revoked" }, latestJobIdForCard: 21 })).toBe(false);
    expect(isRfidConfirmationRecoveryEligible({ job: { ...job, action: "rewrite" }, card, latestJobIdForCard: 21 })).toBe(false);
  });
});
