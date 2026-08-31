export type RfidConfirmationRecoveryJob = {
  id: number;
  cardId: number;
  projectId: number;
  executionMode: string;
  status: string;
  failureReason: string | null;
  action: "issue" | "rewrite" | "revoke";
};

export type RfidConfirmationRecoveryCard = {
  id: number;
  projectId: number;
  vehicleId: number | null;
  status: "active" | "suspended" | "revoked";
  lastWrittenAt: Date | null;
};

export const RFID_CONFIRMATION_RECEIPT_FAILURE = "local_confirmation_receipt_failed";

/**
 * 仅允许恢复“实体写入、逐字节回读和摘要一致之后，本机保存确认收据失败”的最新 PC 任务。
 * 此函数只判断服务端状态；恢复后仍必须由本机桥接重新只读核验实体卡内容，不能直接确认成功。
 */
export function isRfidConfirmationRecoveryEligible(input: {
  job: RfidConfirmationRecoveryJob;
  card: RfidConfirmationRecoveryCard;
  latestJobIdForCard: number;
}) {
  const { job, card, latestJobIdForCard } = input;
  if (job.id !== latestJobIdForCard || job.cardId !== card.id || job.projectId !== card.projectId) return false;
  if (job.executionMode !== "pc_bridge" || job.status !== "failed" || job.failureReason !== RFID_CONFIRMATION_RECEIPT_FAILURE) return false;
  if (!card.vehicleId || card.status === "revoked") return false;
  if (job.action === "issue") return card.lastWrittenAt === null && (card.status === "suspended" || card.status === "active");
  if (job.action === "rewrite") return card.lastWrittenAt !== null && card.status === "active";
  return true;
}
