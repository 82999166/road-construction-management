import { notifyOfficialAccountBusinessEvent } from "../server/services/officialAccountNotifier.ts";

const recipientUserId = 390177;
const runId = `live-smoke-${Date.now()}`;

const result = await notifyOfficialAccountBusinessEvent({
  userId: recipientUserId,
  recipientUserIds: [recipientUserId],
  module: "security",
  eventCode: "official_account_live_smoke_test",
  targetType: "official_account_binding",
  targetId: runId,
  title: "服务号通知验收",
  content: "此为系统发起的一次受控验收通知，已确认您的服务号绑定正常。",
  deepLink: "/mobile/profile",
});

console.log(JSON.stringify({ runId, result }, null, 2));
