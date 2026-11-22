import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** 不加载真实 DB/主管网络路径；短信只 mock 投递入口，保留真实北京时间格式化。 */
const mocks = vi.hoisted(() => ({ db: vi.fn(), supervisors: vi.fn(), sms: vi.fn(), inspect: vi.fn(), decrypt: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.db }));
vi.mock("./officialAccountNotifier", () => ({ resolveSupervisorRecipientIds: mocks.supervisors }));
vi.mock("./secretVault", () => ({ decryptSecret: mocks.decrypt }));
vi.mock("./smsNotifier", async original => ({
  ...(await original<typeof import("./smsNotifier")>()),
  notifyAliyunSmsSafely: mocks.sms,
  inspectAliyunSmsTemplateVariableContract: mocks.inspect,
}));
import { notifyRefuelCompletedSafely } from "./refuelCompletionNotifier";

const input = {
  actorUserId: 9, projectId: 3, recordId: 20, assetType: "vehicle" as "vehicle" | "machine",
  assetId: 13, liters: 10, amount: 86.1, refueledAt: new Date("2026-11-14T04:00:00.000Z"),
};
const dialect = new MySqlDialect();
function database() {
  const state: Record<string, any[]> = {
    transport_vehicles: [{ id: 13, projectId: 3, plateNo: "合成车牌001", driverUserId: 18, driverPhoneEncrypted: "cipher:13800138000" }],
    machines: [{ id: 13, projectId: 3, name: "合成挖机", code: "EX01", ownerUserId: 21, operatorUserId: 22, driverPhoneEncrypted: "cipher:13800138000" }],
    user_profiles: [{ userId: 21, phoneEncrypted: "cipher:13900139000" }],
    notification_records: [], audit_logs: [],
  };
  const fault = { query: new Set<string>(), notificationRecipient: new Set<number>(), audit: false };
  const conditions: { table: string; sql: string; params: unknown[] }[] = [];
  const updates: { row: any; set: any }[] = [];
  const db: any = { state, fault, conditions, updates };
  db.select = () => ({ from: (table: any) => {
    const tableName = getTableName(table);
    let rows = state[tableName] ?? [];
    const query: any = {
      where: (condition: any) => {
        const compiled = dialect.sqlToQuery(condition);
        conditions.push({ table: tableName, ...compiled });
        if (tableName === "transport_vehicles" || tableName === "machines") {
          rows = rows.filter(row => row.id === compiled.params[0] && row.projectId === compiled.params[1]);
        } else if (tableName === "user_profiles") rows = rows.filter(row => row.userId === compiled.params[0]);
        return query;
      },
      limit: () => query,
      then: (ok: any, fail: any) => (fault.query.has(tableName)
        ? Promise.reject(Error("synthetic lookup failure")) : Promise.resolve(rows)).then(ok, fail),
    };
    return query;
  } });
  db.insert = (table: any) => ({ values: (value: any) => {
    const tableName = getTableName(table);
    if (tableName === "notification_records") return { onDuplicateKeyUpdate: async ({ set }: any) => {
      if (fault.notificationRecipient.has(value.recipientUserId)) throw Error("synthetic in-app failure");
      updates.push({ row: value, set });
      const existing = state.notification_records.find(row => row.idempotencyKey === value.idempotencyKey);
      if (existing) {
        // 真实 no-op 分支只接收 SQL 引用原 id；不允许覆盖 status/readAt/sentAt。
        expect(Object.keys(set)).toEqual(["id"]);
        expect(dialect.sqlToQuery(set.id).sql).toBe("`notification_records`.`id`");
      } else state.notification_records.push({ id: state.notification_records.length + 1, ...value });
      return [{ affectedRows: existing ? 0 : 1 }];
    } };
    return (async () => {
      if (tableName === "audit_logs" && fault.audit) throw Error("synthetic audit failure");
      (state[tableName] ??= []).push(value);
      return [{ affectedRows: 1 }];
    })();
  } });
  return db;
}
let db: ReturnType<typeof database>;
const recipients = () => db.state.notification_records.map((row: any) => row.recipientUserId).sort((a: number, b: number) => a - b);
const message = (userId: number) => db.state.notification_records.find((row: any) => row.recipientUserId === userId);
beforeEach(() => {
  vi.resetAllMocks();
  db = database();
  mocks.db.mockResolvedValue(db);
  mocks.supervisors.mockResolvedValue([30, 9, 30, 0, -1, 1.5, null]);
  mocks.sms.mockResolvedValue({ sent: true, reason: "accepted" });
  mocks.inspect.mockResolvedValue({ verified: true, reason: "verified" });
  mocks.decrypt.mockImplementation((cipher: string) => {
    if (cipher === "corrupt") throw Error("synthetic decrypt failure");
    return cipher.replace(/^cipher:/, "");
  });
});

describe("加油完成通知独立通道与绑定收件人", () => {
  it("车辆只发一次司机短信，站内信发送给登记人、绑定司机及去重合法主管", async () => {
    await notifyRefuelCompletedSafely(input);
    expect(recipients()).toEqual([9, 18, 30]);
    expect(message(18).deepLink).toBe("/driver-portal?local=1");
    expect(message(9).deepLink).toBe("/mobile/diesel");
    expect(message(30).deepLink).toBe("/mobile/diesel");
    expect(mocks.sms).toHaveBeenCalledTimes(1);
    expect(mocks.inspect).toHaveBeenCalledWith("diesel_refuel_completed");
    expect(mocks.inspect.mock.invocationCallOrder[0]).toBeLessThan(mocks.sms.mock.invocationCallOrder[0]);
    expect(mocks.sms).toHaveBeenCalledWith({ actorUserId: 9, projectId: 3, module: "diesel", eventCode: "diesel_refuel_completed", recipientPhone: "13800138000", targetType: "diesel_refuel", targetId: "20", templateParams: { vehicle: "合成车牌001", quantity: "10.00", amount: "86.10", time: "2026-11-14 12:00" } });
    expect(mocks.supervisors).toHaveBeenCalledWith(expect.objectContaining({ userId: 9, projectId: 3, module: "diesel", eventCode: "diesel_refuel_completed", targetType: "diesel_refuel", targetId: "20" }));
    for (const row of db.state.notification_records) {
      expect(row).toMatchObject({ channel: "in_app", status: "sent", eventCode: "diesel_refuel_completed", idempotencyKey: `inapp:refuel:20:${row.recipientUserId}`, sentAt: expect.any(Date) });
      expect(row.content).toContain("10.00L");
      expect(row.content).toContain("¥86.10");
      expect(row.content).toContain("2026-11-14 12:00（北京时间）");
      expect(row.content).not.toContain("13800138000");
      expect(row.content).not.toContain("cipher:");
    }
    expect(db.conditions.find((condition: any) => condition.table === "transport_vehicles")?.params).toEqual([13, 3]);
  });

  it("机械短信优先老板手机号，站内信包含老板和操作员且分别使用受控深链", async () => {
    await notifyRefuelCompletedSafely({ ...input, assetType: "machine" });
    expect(recipients()).toEqual([9, 21, 22, 30]);
    expect(message(21).deepLink).toBe("/machine-owner-portal");
    expect(message(22).deepLink).toBe("/mobile/diesel");
    expect(mocks.sms).toHaveBeenCalledTimes(1);
    expect(mocks.inspect).toHaveBeenCalledWith("machine_refuel_completed");
    expect(mocks.sms).toHaveBeenCalledWith(expect.objectContaining({ module: "machinery", eventCode: "machine_refuel_completed", recipientPhone: "13900139000", targetType: "diesel_refuel", targetId: "20", templateParams: { vehicle: "合成挖机（EX01）", quantity: "10.00", amount: "86.10", time: "2026-11-14 12:00" } }));
    expect(db.conditions.find((condition: any) => condition.table === "machines")?.params).toEqual([13, 3]);
    expect(db.conditions.find((condition: any) => condition.table === "user_profiles")?.params).toEqual([21]);
    expect(message(21).eventCode).toBe("machine_refuel_completed");
  });

  it.each([null, "corrupt", "cipher:invalid-number", "cipher:"])("老板手机号 %s 缺失、损坏或无效时回退机械驾驶员", async phoneEncrypted => {
    db.state.user_profiles[0].phoneEncrypted = phoneEncrypted;
    await notifyRefuelCompletedSafely({ ...input, assetType: "machine" });
    expect(mocks.sms).toHaveBeenCalledTimes(1);
    expect(mocks.sms).toHaveBeenCalledWith(expect.objectContaining({ recipientPhone: "13800138000" }));
    expect(recipients()).toEqual([9, 21, 22, 30]);
  });

  it("老板资料查询异常回退驾驶员，主管查询异常仍通知登记人及绑定账号", async () => {
    db.fault.query.add("user_profiles");
    mocks.supervisors.mockRejectedValue(Error("synthetic supervisors failure"));
    await expect(notifyRefuelCompletedSafely({ ...input, assetType: "machine" })).resolves.toBeUndefined();
    expect(recipients()).toEqual([9, 21, 22]);
    expect(mocks.sms).toHaveBeenCalledWith(expect.objectContaining({ recipientPhone: "13800138000" }));
    expect(db.state.audit_logs.some((row: any) => row.action === "refuel_notification_recipient_lookup_failed")).toBe(true);
  });

  it("重复、非法绑定账号被过滤，登记人同时是老板/操作员/主管也只收一条", async () => {
    db.state.machines[0].ownerUserId = 9;
    db.state.machines[0].operatorUserId = 9;
    mocks.supervisors.mockResolvedValue([9, 30, 30, 0, -1, 1.5, NaN, undefined, "31"]);
    await notifyRefuelCompletedSafely({ ...input, assetType: "machine" });
    expect(recipients()).toEqual([9, 30]);
    expect(mocks.sms).toHaveBeenCalledTimes(1);
    db.state.notification_records = [];
    db.state.machines[0].ownerUserId = -2;
    db.state.machines[0].operatorUserId = 2.5;
    await notifyRefuelCompletedSafely({ ...input, recordId: 21, assetType: "machine" });
    expect(recipients()).toEqual([9, 30]);
  });

  it("车辆无绑定账号或手机号不创建账号，短信跳过仍发登记人及主管站内信", async () => {
    db.state.transport_vehicles[0].driverUserId = null;
    db.state.transport_vehicles[0].driverPhoneEncrypted = null;
    mocks.sms.mockResolvedValue({ sent: false, reason: "recipient_phone_unavailable" });
    await notifyRefuelCompletedSafely(input);
    expect(recipients()).toEqual([9, 30]);
    expect(mocks.sms).toHaveBeenCalledWith(expect.objectContaining({ recipientPhone: null }));
    expect(db.state.audit_logs.some((row: any) => row.action === "refuel_sms_skipped")).toBe(true);
    expect(mocks.inspect).not.toHaveBeenCalled();
  });

  it("查询严格按资产ID与项目，跨项目资产不泄露司机联系方式或通知给无关司机", async () => {
    db.state.transport_vehicles[0].projectId = 99;
    mocks.sms.mockResolvedValue({ sent: false, reason: "recipient_phone_unavailable" });
    await notifyRefuelCompletedSafely(input);
    expect(recipients()).toEqual([9, 30]);
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.sms).toHaveBeenCalledWith(expect.objectContaining({ recipientPhone: null }));
    expect(message(9).content).not.toContain("合成车牌001");
  });

  it.each([
    ["vehicle", "variable_contract_invalid"], ["machine", "variable_contract_invalid"],
    ["vehicle", "provider_request_failed"], ["machine", "provider_request_failed"],
    ["vehicle", "template_not_approved"], ["machine", "template_not_approved"],
  ] as const)("%s 模板 %s 不投递短信，独立站内信正常且留下安全跳过审计", async (assetType, reason) => {
    mocks.inspect.mockResolvedValue({ verified: false, reason, legacyDollarVariables: reason === "variable_contract_invalid" ? ["vehicle", "quantity", "amount", "time"] : [], templateStatus: reason === "template_not_approved" ? "0" : "1" });
    await expect(notifyRefuelCompletedSafely({ ...input, assetType })).resolves.toBeUndefined();
    expect(mocks.inspect).toHaveBeenCalledWith(assetType === "machine" ? "machine_refuel_completed" : "diesel_refuel_completed");
    expect(mocks.sms).not.toHaveBeenCalled();
    expect(recipients()).toEqual(assetType === "machine" ? [9, 21, 22, 30] : [9, 18, 30]);
    expect(db.state.audit_logs).toContainEqual(expect.objectContaining({ action: "refuel_sms_skipped", summary: expect.stringContaining(reason) }));
    expect(JSON.stringify(db.state.audit_logs)).not.toContain("13900139000");
  });

  it("模板检查函数拒绝仍保留站内消息且不调用实际短信投递", async () => {
    mocks.inspect.mockRejectedValue(Error("synthetic provider inspection exception"));
    await expect(notifyRefuelCompletedSafely(input)).resolves.toBeUndefined();
    expect(mocks.sms).not.toHaveBeenCalled();
    expect(recipients()).toEqual([9, 18, 30]);
    expect(db.state.audit_logs).toContainEqual(expect.objectContaining({ action: "refuel_sms_notification_failed" }));
  });

  it.each(["disabled", "module_disabled", "template_unavailable", "provider_rejected", "delivery_failed"])("短信 %s 不阻断站内信", async reason => {
    mocks.sms.mockResolvedValue({ sent: false, reason });
    await expect(notifyRefuelCompletedSafely(input)).resolves.toBeUndefined();
    expect(recipients()).toEqual([9, 18, 30]);
    expect(mocks.sms).toHaveBeenCalledTimes(1);
    if (!["provider_rejected", "delivery_failed"].includes(reason)) expect(db.state.audit_logs.some((row: any) => row.action === "refuel_sms_skipped")).toBe(true);
  });

  it("短信函数抛错及失败审计也抛错仍完成全部站内消息，无敏感错误回显", async () => {
    mocks.sms.mockRejectedValue(Error("synthetic request with phone 13800138000 and secret"));
    await expect(notifyRefuelCompletedSafely(input)).resolves.toBeUndefined();
    expect(recipients()).toEqual([9, 18, 30]);
    expect(db.state.audit_logs.some((row: any) => row.action === "refuel_sms_notification_failed")).toBe(true);
    expect(JSON.stringify(db.state.audit_logs)).not.toContain("13800138000");
    db.fault.audit = true;
    await expect(notifyRefuelCompletedSafely({ ...input, recordId: 21 })).resolves.toBeUndefined();
    expect(db.state.notification_records).toHaveLength(6);
  });

  it("单个站内信写入失败不阻断其他收件人或唯一短信", async () => {
    db.fault.notificationRecipient.add(18);
    await expect(notifyRefuelCompletedSafely(input)).resolves.toBeUndefined();
    expect(recipients()).toEqual([9, 30]);
    expect(mocks.sms).toHaveBeenCalledTimes(1);
    expect(db.state.audit_logs.some((row: any) => row.action === "refuel_in_app_partial_failed")).toBe(true);
  });

  it("资产查询失败仍发送登记人和主管站内信，不向错误号码发送短信", async () => {
    db.fault.query.add("transport_vehicles");
    mocks.sms.mockResolvedValue({ sent: false, reason: "recipient_phone_unavailable" });
    await expect(notifyRefuelCompletedSafely(input)).resolves.toBeUndefined();
    expect(recipients()).toEqual([9, 30]);
    expect(mocks.sms).toHaveBeenCalledWith(expect.objectContaining({ recipientPhone: null }));
  });

  it("稳定记录+账号幂等键 no-op 更新，既有已读消息的 status/readAt/sentAt 不被重置", async () => {
    const readAt = new Date("2026-11-14T05:00:00Z");
    const sentAt = new Date("2026-11-14T04:00:01Z");
    db.state.notification_records.push({ id: 100, recipientUserId: 18, idempotencyKey: "inapp:refuel:20:18", status: "read", readAt, sentAt, title: "原消息", content: "原内容" });
    await notifyRefuelCompletedSafely(input);
    expect(db.state.notification_records).toHaveLength(3);
    expect(message(18)).toMatchObject({ id: 100, status: "read", readAt, sentAt, title: "原消息", content: "原内容" });
    expect(db.updates).toHaveLength(3);
    for (const update of db.updates) {
      expect(Object.keys(update.set)).toEqual(["id"]);
      expect(dialect.sqlToQuery(update.set.id).sql).toBe("`notification_records`.`id`");
    }
  });

  it("DB不可用时安全返回且不会触发任何外部通知", async () => {
    mocks.db.mockResolvedValue(null);
    await expect(notifyRefuelCompletedSafely(input)).resolves.toBeUndefined();
    expect(mocks.sms).not.toHaveBeenCalled();
    expect(mocks.supervisors).not.toHaveBeenCalled();
  });
});
