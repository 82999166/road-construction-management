import { and, eq, sql } from "drizzle-orm";
import {
  auditLogs,
  machines,
  notificationRecords,
  transportVehicles,
  userProfiles,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { resolveSupervisorRecipientIds } from "./officialAccountNotifier";
import { decryptSecret } from "./secretVault";
import {
  formatChinaSmsTime,
  inspectAliyunSmsTemplateVariableContract,
  notifyAliyunSmsSafely,
} from "./smsNotifier";

export type RefuelCompletionNotification = {
  actorUserId: number;
  projectId: number;
  recordId: number;
  assetType: "vehicle" | "machine";
  assetId: number;
  liters: number;
  amount: number;
  refueledAt: Date;
};

function readPhone(ciphertext: string | null | undefined) {
  if (!ciphertext) return null;
  try {
    const phone = decryptSecret(ciphertext)
      .trim()
      .replace(/[\s()\-]/g, "");
    return /^\+?[0-9]{6,20}$/.test(phone) ? phone : null;
  } catch {
    return null;
  }
}

/** 只接受已经成功提交的加油记录；两条通知通道互不阻断、不改变记账或结算。 */
export async function notifyRefuelCompletedSafely(
  input: RefuelCompletionNotification
) {
  const db = await getDb();
  if (!db) return;
  const isMachine = input.assetType === "machine";
  const eventCode = isMachine
    ? "machine_refuel_completed"
    : "diesel_refuel_completed";
  const module = isMachine ? "machinery" : "diesel";
  const audit = async (action: string, summary: string) => {
    try {
      await db.insert(auditLogs).values({
        userId: input.actorUserId,
        module,
        action,
        targetType: "diesel_refuel",
        targetId: String(input.recordId),
        summary,
      });
    } catch {
      // 审计失败也不能影响已完成的业务或另一通知通道。
    }
  };
  let label = isMachine ? "机械" : "车辆";
  let phone: string | null = null;
  let driverUserId: number | null = null;
  let ownerUserId: number | null = null;
  let operatorUserId: number | null = null;
  try {
    if (isMachine) {
      const [machine] = await db
        .select({
          name: machines.name,
          code: machines.code,
          ownerUserId: machines.ownerUserId,
          operatorUserId: machines.operatorUserId,
          driverPhoneEncrypted: machines.driverPhoneEncrypted,
        })
        .from(machines)
        .where(
          and(
            eq(machines.id, input.assetId),
            eq(machines.projectId, input.projectId)
          )
        )
        .limit(1);
      if (machine) {
        label = `${machine.name}${machine.code ? `（${machine.code}）` : ""}`;
        ownerUserId = machine.ownerUserId;
        operatorUserId = machine.operatorUserId;
        phone = readPhone(machine.driverPhoneEncrypted);
        if (ownerUserId) {
          try {
            const [owner] = await db
              .select({ phoneEncrypted: userProfiles.phoneEncrypted })
              .from(userProfiles)
              .where(eq(userProfiles.userId, ownerUserId))
              .limit(1);
            phone = readPhone(owner?.phoneEncrypted) ?? phone;
          } catch {
            await audit(
              "refuel_notification_recipient_lookup_failed",
              "机械老板联系方式查询失败，保留驾驶员备用收件人与站内通知"
            );
          }
        }
      }
    } else {
      const [vehicle] = await db
        .select({
          plateNo: transportVehicles.plateNo,
          driverUserId: transportVehicles.driverUserId,
          driverPhoneEncrypted: transportVehicles.driverPhoneEncrypted,
        })
        .from(transportVehicles)
        .where(
          and(
            eq(transportVehicles.id, input.assetId),
            eq(transportVehicles.projectId, input.projectId)
          )
        )
        .limit(1);
      if (vehicle) {
        label = vehicle.plateNo;
        driverUserId = vehicle.driverUserId;
        phone = readPhone(vehicle.driverPhoneEncrypted);
      }
    }
  } catch {
    await audit(
      "refuel_notification_recipient_lookup_failed",
      "加油通知资源收件人查询失败，保留登记人站内通知"
    );
  }
  const recipients = new Set<number>([input.actorUserId]);
  for (const id of [driverUserId, ownerUserId, operatorUserId]) {
    if (id && Number.isInteger(id) && id > 0) recipients.add(id);
  }
  try {
    const supervisors = await resolveSupervisorRecipientIds({
      userId: input.actorUserId,
      projectId: input.projectId,
      module,
      eventCode,
      targetType: "diesel_refuel",
      targetId: String(input.recordId),
      title: "加油完成",
    });
    for (const id of supervisors) {
      if (Number.isInteger(id) && id > 0) recipients.add(id);
    }
  } catch {
    await audit(
      "refuel_notification_recipient_lookup_failed",
      "加油通知主管查询失败，保留登记人及绑定人员站内通知"
    );
  }
  const quantity = input.liters.toFixed(2);
  const amount = input.amount.toFixed(2);
  const time = formatChinaSmsTime(input.refueledAt);
  const content = `${label}加油完成：${quantity}L，金额 ¥${amount}，加油时间 ${time}（北京时间）。已记入柴油台账${!isMachine ? "，扣油情况请以车辆结算明细为准" : ""}。`;
  const sendInApp = async () => {
    const results = await Promise.allSettled(
      Array.from(recipients).map(async recipientUserId => {
        const deepLink =
          recipientUserId === ownerUserId
            ? "/machine-owner-portal"
            : recipientUserId === driverUserId
              ? "/driver-portal?local=1"
              : "/mobile/diesel";
        await db
          .insert(notificationRecords)
          .values({
            eventCode,
            idempotencyKey: `inapp:refuel:${input.recordId}:${recipientUserId}`,
            recipientUserId,
            title: `${isMachine ? "机械" : "车辆"}加油完成`.slice(0, 200),
            content,
            deepLink,
            channel: "in_app",
            status: "sent",
            sentAt: new Date(),
          })
          .onDuplicateKeyUpdate({
            set: { id: sql`${notificationRecords.id}` },
          });
      })
    );
    const failedCount = results.filter(
      result => result.status === "rejected"
    ).length;
    await audit(
      failedCount ? "refuel_in_app_partial_failed" : "refuel_in_app_queued",
      `加油站内通知：${results.length - failedCount}个接收账号已处理，${failedCount}个失败；同一记录同一账号幂等去重`
    );
  };
  const sendSms = async () => {
    try {
      if (phone) {
        const template =
          await inspectAliyunSmsTemplateVariableContract(eventCode);
        if (!template.verified) {
          await audit(
            "refuel_sms_skipped",
            `加油短信未发送：${template.reason}`
          );
          return;
        }
      }
      const result = await notifyAliyunSmsSafely({
        actorUserId: input.actorUserId,
        projectId: input.projectId,
        module,
        eventCode,
        recipientPhone: phone,
        targetType: "diesel_refuel",
        targetId: String(input.recordId),
        templateParams: { vehicle: label, quantity, amount, time },
      });
      if (
        !result.sent &&
        result.reason !== "provider_rejected" &&
        result.reason !== "delivery_failed"
      ) {
        await audit("refuel_sms_skipped", `加油短信未发送：${result.reason}`);
      }
    } catch {
      await audit(
        "refuel_sms_notification_failed",
        "加油短信通知异常，已保留记账与独立站内通知"
      );
    }
  };
  await Promise.allSettled([sendInApp(), sendSms()]);
}
