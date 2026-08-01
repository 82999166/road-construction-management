import { notifyOfficialAccountBusinessEvent, type OfficialAccountBusinessEvent } from "./officialAccountNotifier";

/** 业务域统一走微信公众号单通道；通知故障仅写入投递审计，绝不回滚主业务。 */
export type BusinessNotificationEvent = OfficialAccountBusinessEvent;

export async function notifyOfficialAccountBusinessEventSafely(event: BusinessNotificationEvent) {
  return notifyOfficialAccountBusinessEvent(event);
}
