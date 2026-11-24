import { withNumberingFixture } from "./services/businessDocumentNumber.fixtureAdapter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  notify: vi.fn(),
  driver: vi.fn(),
  sms: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: async (...args: any[]) => withNumberingFixture(await mocks.db(...args)) }));
vi.mock("./services/businessNotifier", () => ({
  notifyOfficialAccountBusinessEventSafely: mocks.notify,
}));
vi.mock("./services/officialAccountDriverBinding", () => ({
  revokeOfficialAccountDriverVehicleBinding: vi.fn(),
  sendOfficialAccountDriverNotification: mocks.driver,
}));
vi.mock("./services/smsNotifier", async load => ({
  ...(await load<any>()),
  notifyAliyunSmsSafely: mocks.sms,
}));
import { adminRouter } from "./routers/admin";

const ctx = {
  user: {
    id: 7,
    role: "admin",
    openId: "synthetic-diesel-correction",
    name: "合成管理员",
  },
  req: { headers: {} },
  res: {},
} as TrpcContext;
const now = new Date("2026-11-14T04:00:00.000Z");
const version = new Date("2026-11-15T04:00:00.000Z");
const baseRecord = {
  id: 41,
  recordNo: "DS3-original",
  projectId: 3,
  assetType: "machine",
  machineId: 13,
  vehicleId: null,
  transportTripId: null,
  supplyMethod: "project_supply",
  stationOrSupplierName: null,
  liters: "10.000",
  actualUnitPrice: null,
  appliedUnitPrice: "7.35",
  amount: "73.50",
  deductFromFreight: false,
  refueledAt: now,
  meterReading: "888.00",
  receiptNo: "原始小票",
  evidenceId: 91,
  remarks: "历史备注",
  status: "approved",
  createdBy: 2,
  approvedBy: 6,
  approvedAt: now,
  createdAt: now,
  updatedAt: version,
};
const baseCost = {
  id: 61,
  machineId: 13,
  projectId: 3,
  costType: "fuel",
  costName: "柴油历史成本",
  quantity: "10.000",
  unitPrice: "7.35",
  amount: "73.50",
  dieselRefuelRecordId: 41,
  occurredAt: now,
  evidenceId: 91,
  remarks: "原成本备注",
  status: "approved",
  createdAt: now,
};
const deletion = {
  id: 41,
  projectId: 3,
  expectedUpdatedAt: version.toISOString(),
};
const edit = {
  ...deletion,
  assetType: "machine" as const,
  machineId: 13,
  supplyMethod: "project_supply" as const,
  liters: 12,
  actualUnitPrice: null,
  deductFromFreight: false,
  refueledAt: now.toISOString(),
  status: "approved" as const,
  remarks: "更正升数",
  meterReading: 888,
  receiptNo: "原始小票",
};

/** 执行实际 Drizzle WHERE（=、<>、IN、AND、OR），不是顺序返回或忽略条件。 */
function predicate(condition: any) {
  if (!condition) return () => true;
  const query = new MySqlDialect().sqlToQuery(condition);
  let parameter = 0;
  const sql = query.sql.replace(/\?/g, () => `@${parameter++}`);
  const tokens = sql.match(
    /`[^`]+`\.`[^`]+`|@\d+|<>|!=|>=|<=|>|<|=|\(|\)|,|\b(?:and|or|in|is|not|null)\b/gi
  )!;
  let position = 0;
  const equal = (a: any, b: any) =>
    a instanceof Date || b instanceof Date
      ? new Date(a).getTime() === new Date(b).getTime()
      : a === b;
  type Filter = (row: any) => boolean;
  const primary = (): Filter => {
    if (tokens[position] === "(") {
      position++;
      const inner = expression();
      if (tokens[position++] !== ")") throw Error("unsupported SQL grouping");
      return inner;
    }
    const column = /`[^`]+`\.`([^`]+)`/.exec(tokens[position++])?.[1];
    if (!column) throw Error(`unsupported SQL column: ${query.sql}`);
    const operator = tokens[position++].toLowerCase();
    if (operator === "is") {
      const negate = tokens[position]?.toLowerCase() === "not";
      if (negate) position++;
      if (tokens[position++]?.toLowerCase() !== "null")
        throw Error("unsupported SQL IS");
      return row => (negate ? row[column] != null : row[column] == null);
    }
    const argument = () => query.params[Number(tokens[position++].slice(1))];
    if (operator === "in") {
      position++;
      const values = [argument()];
      while (tokens[position] === ",") {
        position++;
        values.push(argument());
      }
      if (tokens[position++] !== ")") throw Error("unsupported SQL IN");
      return row => values.some(value => equal(row[column], value));
    }
    const value = argument();
    if ([">", "<", ">=", "<="].includes(operator))
      return row => {
        if (row[column] == null) return false;
        const a =
          row[column] instanceof Date ? row[column].getTime() : row[column];
        const b = value instanceof Date ? value.getTime() : value;
        return operator === ">"
          ? a > b
          : operator === "<"
            ? a < b
            : operator === ">="
              ? a >= b
              : a <= b;
      };
    if (!["=", "<>", "!="].includes(operator))
      throw Error("unsupported SQL operator");
    return row =>
      operator === "=" ? equal(row[column], value) : !equal(row[column], value);
  };
  const conjunction = (): Filter => {
    let left = primary();
    while (tokens[position]?.toLowerCase() === "and") {
      position++;
      const a = left,
        b = primary();
      left = row => a(row) && b(row);
    }
    return left;
  };
  const expression = (): Filter => {
    let left = conjunction();
    while (tokens[position]?.toLowerCase() === "or") {
      position++;
      const a = left,
        b = conjunction();
      left = row => a(row) || b(row);
    }
    return left;
  };
  const result = expression();
  if (position !== tokens.length)
    throw Error(`unsupported SQL tail: ${query.sql}`);
  return result;
}

function database() {
  const state: Record<string, any[]> = {
    diesel_refuel_records: [structuredClone(baseRecord)],
    machine_cost_records: [structuredClone(baseCost)],
    machines: [{ id: 13, projectId: 3, status: "active" }],
    projects: [{ id: 3, status: "active" }],
    transport_vehicles: [{ id: 21, projectId: 3, status: "active" }],
    transport_trips: [],
    evidence_records: [
      {
        id: 91,
        projectId: 3,
        sourceType: "diesel_receipt",
        status: "active",
        mimeType: "image/png",
      },
    ],
    diesel_guideline_prices: [
      {
        id: 5,
        projectId: 3,
        status: "active",
        pricePerLiter: "9.99",
        effectiveFrom: new Date("2026-11-01T00:00:00Z"),
        effectiveTo: null,
      },
    ],
    machine_monthly_statements: [],
    machine_payment_settlements: [],
    transport_vehicle_settlements: [],
    audit_logs: [],
    user_role_assignments: [],
    diesel_price_alert_rules: [],
  };
  const locks: string[] = [],
    writes: Array<{ table: string; values: any }> = [],
    reads: string[] = [];
  const fault = {
    update: "",
    audit: false,
    afterLock: undefined as undefined | ((table: string) => void),
    lockedDiesel: undefined as undefined | (() => void),
    beforeUpdate: undefined as undefined | ((table: string) => void),
  };
  const db: any = {
    state,
    locks,
    writes,
    reads,
    fault,
    select: () => ({
      from: (table: any) => {
        const name = getTableName(table);
        let filter = (_row: any) => true,
          limit = Infinity,
          locked = false;
        const q: any = {
          where: (where: any) => {
            filter = predicate(where);
            return q;
          },
          limit: (count: number) => {
            limit = count;
            return q;
          },
          orderBy: () => q,
          innerJoin: () => q,
          for: () => {
            locked = true;
            return q;
          },
          then: (resolve: any, reject: any) =>
            Promise.resolve()
              .then(() => {
                reads.push(name);
                if (locked) {
                  locks.push(name);
                  fault.afterLock?.(name);
                }
                if (locked && name === "diesel_refuel_records")
                  fault.lockedDiesel?.();
                return structuredClone(
                  (state[name] ?? []).filter(filter).slice(0, limit)
                );
              })
              .then(resolve, reject),
        };
        return q;
      },
    }),
    update: (table: any) => ({
      set: (values: any) => ({
        where: async (where: any) => {
          const name = getTableName(table);
          if (fault.update === name) return [{ affectedRows: 0 }];
          fault.beforeUpdate?.(name);
          const rows = (state[name] ?? []).filter(predicate(where));
          rows.forEach(row => Object.assign(row, values));
          writes.push({ table: name, values });
          return [{ affectedRows: rows.length }];
        },
      }),
    }),
    insert: (table: any) => ({
      values: async (values: any) => {
        const name = getTableName(table);
        if (name === "audit_logs" && fault.audit)
          throw Error("synthetic audit rollback");
        const id = (state[name]?.length ?? 0) + 101;
        (state[name] ??= []).push({ id, ...values });
        return [{ insertId: id, affectedRows: 1 }];
      },
    }),
    delete: vi.fn(),
    transaction: vi.fn(async (fn: any) => {
      const before = structuredClone(state);
      try {
        return await fn(db);
      } catch (error) {
        for (const key of Object.keys(state)) state[key] = before[key] ?? [];
        throw error;
      }
    }),
  };
  return db;
}
let db: ReturnType<typeof database>;
const caller = () => adminRouter.createCaller(ctx).diesel;
function useVehicle() {
  Object.assign(db.state.diesel_refuel_records[0], {
    assetType: "vehicle",
    machineId: null,
    vehicleId: 21,
    deductFromFreight: true,
  });
  db.state.machine_cost_records = [];
}
function bindVehicleSettlement(
  status = "draft",
  source: any = { version: 1, fuelIds: [41] }
) {
  db.state.transport_vehicle_settlements.push({
    id: 71,
    settlementNo: "VS-source",
    projectId: 3,
    vehicleId: 21,
    status,
  });
  db.state.audit_logs.push({
    id: 81,
    module: "transport",
    action: "vehicle_settlement_basis_v1",
    targetType: "transport_vehicle_settlement",
    targetId: "VS-source",
    beforeJson: typeof source === "string" ? source : JSON.stringify(source),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  db = database();
  mocks.db.mockResolvedValue(db);
  mocks.notify.mockResolvedValue([]);
  mocks.driver.mockResolvedValue([]);
  mocks.sms.mockResolvedValue({ sent: false });
});

describe("admin.diesel受控删除真实caller/事务行为", () => {
  it("删除只作废，保留柴油/机械全部原字段及完整before/after审计快照", async () => {
    const before = structuredClone(db.state);
    expect(await caller().deleteRefuelRecord(deletion)).toEqual({
      success: true,
      id: 41,
      status: "void",
      alreadyVoid: false,
    });
    const row = db.state.diesel_refuel_records[0];
    expect(row).toEqual({
      ...before.diesel_refuel_records[0],
      status: "void",
      updatedAt: row.updatedAt,
    });
    expect(row.updatedAt.getTime()).toBeGreaterThan(version.getTime());
    expect(db.state.machine_cost_records[0]).toEqual({
      ...before.machine_cost_records[0],
      status: "void",
    });
    const dieselAudit = db.state.audit_logs.find(
      (row: any) => row.module === "diesel"
    );
    expect(JSON.parse(dieselAudit.beforeJson)).toEqual(
      JSON.parse(JSON.stringify(before.diesel_refuel_records[0]))
    );
    expect(JSON.parse(dieselAudit.afterJson)).toEqual(
      JSON.parse(JSON.stringify(row))
    );
    expect(
      JSON.parse(
        db.state.audit_logs.find((row: any) => row.module === "machinery")
          .beforeJson
      )
    ).toEqual(JSON.parse(JSON.stringify(baseCost)));
    expect(db.writes.map((row: any) => Object.keys(row.values).sort())).toEqual(
      [["status", "updatedAt"], ["status"]]
    );
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.reads).not.toContain("diesel_guideline_prices");
    expect(db.reads).not.toContain("evidence_records");
  });
  it("锁序遵循项目、原机器、原成本、柴油当前行，资源禁用/项目归档不影响受控删除", async () => {
    db.state.projects[0].status = "archived";
    db.state.machines[0].status = "disabled";
    await caller().deleteRefuelRecord(deletion);
    expect(db.locks.slice(0, 4)).toEqual([
      "projects",
      "machines",
      "machine_cost_records",
      "diesel_refuel_records",
    ]);
  });
  it.each(["machine_cost_records", "diesel_refuel_records"])(
    "%s CAS失败全部回滚",
    async table => {
      db.fault.update = table;
      const before = structuredClone(db.state);
      await expect(caller().deleteRefuelRecord(deletion)).rejects.toMatchObject(
        { code: "CONFLICT" }
      );
      expect(db.state).toEqual(before);
      expect(mocks.notify).not.toHaveBeenCalled();
    }
  );
  it("审计失败回滚已更新的柴油和关联成本", async () => {
    db.fault.audit = true;
    const before = structuredClone(db.state);
    await expect(caller().deleteRefuelRecord(deletion)).rejects.toThrow(
      "synthetic audit rollback"
    );
    expect(db.state).toEqual(before);
  });
  it("普通账户真实超管守卫拒绝删除和编辑，不启动写事务", async () => {
    const regular = adminRouter.createCaller({
      ...ctx,
      user: { ...ctx.user!, role: "user" },
    }).diesel;
    await expect(regular.deleteRefuelRecord(deletion)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(regular.saveRefuelRecord(edit)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.writes).toHaveLength(0);
  });
  it("未登录、非法编号及缺少版本均拒绝", async () => {
    await expect(
      adminRouter
        .createCaller({ ...ctx, user: null })
        .diesel.deleteRefuelRecord(deletion)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    for (const input of [
      { ...deletion, id: 0 },
      { ...deletion, id: 1.5 },
      { ...deletion, projectId: -1 },
      { ...deletion, expectedUpdatedAt: "not-a-date" },
      { id: 41, projectId: 3 },
    ])
      await expect(
        caller().deleteRefuelRecord(input as any)
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.writes).toHaveLength(0);
  });
  it("跨项目及不存在记录不允许操作", async () => {
    for (const input of [
      { ...deletion, projectId: 4 },
      { ...deletion, id: 99 },
    ])
      await expect(caller().deleteRefuelRecord(input)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    expect(db.locks).toHaveLength(0);
    expect(db.writes).toHaveLength(0);
  });
  it("DS-MC机械录入不可由柴油管理删除或修改", async () => {
    db.state.diesel_refuel_records[0].recordNo = "DS-MC-61";
    await expect(caller().deleteRefuelRecord(deletion)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("机械管理"),
    });
    await expect(caller().saveRefuelRecord(edit)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(db.writes).toHaveLength(0);
  });
  it.each(["diesel_refuel_records", "machine_cost_records"])(
    "%s已settled时删除/编辑均拒绝",
    async table => {
      db.state[table][0].status = "settled";
      await expect(caller().deleteRefuelRecord(deletion)).rejects.toMatchObject(
        { code: "BAD_REQUEST" }
      );
      await expect(caller().saveRefuelRecord(edit)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(db.writes).toHaveLength(0);
    }
  );
  it.each(["monthly", "payment"])(
    "柴油与成本仍approved，但机械%s已结算/绑定也拒绝",
    async source => {
      if (source === "monthly")
        db.state.machine_monthly_statements.push({
          id: 71,
          machineId: 13,
          projectId: 3,
          period: "2026-11",
          status: "settled",
        });
      else
        db.state.machine_payment_settlements.push({
          id: 71,
          machineId: 13,
          projectId: 3,
          period: "2026-11",
          status: "draft",
        });
      await expect(caller().deleteRefuelRecord(deletion)).rejects.toMatchObject(
        { code: "BAD_REQUEST" }
      );
      await expect(caller().saveRefuelRecord(edit)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(db.writes).toHaveLength(0);
    }
  );
  it.each(["draft", "approved", "paid", "receivable", "offset"])(
    "车辆有效%s结算审计引用仍approved柴油时拒绝",
    async status => {
      useVehicle();
      bindVehicleSettlement(status);
      await expect(caller().deleteRefuelRecord(deletion)).rejects.toMatchObject(
        { code: "BAD_REQUEST" }
      );
      expect(db.writes).toHaveLength(0);
    }
  );
  it("结算fuelSources引用及损坏来源快照采取保守防御", async () => {
    useVehicle();
    bindVehicleSettlement("approved", {
      fuelIds: [],
      fuelSources: [{ id: 41 }],
    });
    await expect(caller().deleteRefuelRecord(deletion)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    db.state.audit_logs[0].beforeJson = "invalid-json";
    await expect(caller().deleteRefuelRecord(deletion)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
  it("车辆来源关联已settled原趟次拒绝，并使用与车辆结算相同的前置锁序", async () => {
    useVehicle();
    db.state.diesel_refuel_records[0].transportTripId = 51;
    db.state.transport_trips.push({
      id: 51,
      projectId: 3,
      vehicleId: 21,
      status: "settled",
    });
    await expect(caller().deleteRefuelRecord(deletion)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(db.locks.slice(0, 5)).toEqual([
      "projects",
      "transport_vehicles",
      "transport_trips",
      "machine_cost_records",
      "diesel_refuel_records",
    ]);
  });
  it("无关项目/车辆/月份和已void结算不误阻止删除", async () => {
    db.state.machine_monthly_statements.push({
      id: 71,
      projectId: 3,
      machineId: 13,
      period: "2026-10",
      status: "settled",
    });
    db.state.machine_payment_settlements.push({
      id: 72,
      projectId: 3,
      machineId: 13,
      period: "2026-11",
      status: "void",
    });
    await expect(caller().deleteRefuelRecord(deletion)).resolves.toMatchObject({
      success: true,
    });
    db = database();
    mocks.db.mockResolvedValue(db);
    useVehicle();
    bindVehicleSettlement("void");
    await expect(caller().deleteRefuelRecord(deletion)).resolves.toMatchObject({
      success: true,
    });
  });
  it("重复删除已void不写入、不追加审计（原旧版本可安全重试）", async () => {
    await caller().deleteRefuelRecord(deletion);
    const before = structuredClone(db.state),
      writeCount = db.writes.length;
    expect(await caller().deleteRefuelRecord(deletion)).toMatchObject({
      alreadyVoid: true,
    });
    expect(db.state).toEqual(before);
    expect(db.writes).toHaveLength(writeCount);
  });
  it("陈旧版本删除和编辑均CONFLICT且不覆盖", async () => {
    const stale = "2026-11-15T03:59:59.000Z";
    await expect(
      caller().deleteRefuelRecord({ ...deletion, expectedUpdatedAt: stale })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      caller().saveRefuelRecord({ ...edit, expectedUpdatedAt: stale })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.writes).toHaveLength(0);
  });
  it.each(["version", "cost_link", "cost_status"])(
    "实际WHERE防御%s竞争变更并回滚双账",
    async race => {
      const before = structuredClone(db.state);
      db.fault.beforeUpdate = (table: string) => {
        if (race === "version" && table === "diesel_refuel_records")
          db.state.diesel_refuel_records[0].updatedAt = new Date(
            version.getTime() + 1000
          );
        if (table === "machine_cost_records") {
          if (race === "cost_link")
            db.state.machine_cost_records[0].dieselRefuelRecordId = 999;
          if (race === "cost_status")
            db.state.machine_cost_records[0].status = "settled";
        }
      };
      await expect(caller().deleteRefuelRecord(deletion)).rejects.toMatchObject(
        { code: "CONFLICT" }
      );
      expect(db.state).toEqual(before);
    }
  );
  it.each(["approved", "void"] as const)(
    "已void禁止编辑/复活到%s",
    async status => {
      db.state.diesel_refuel_records[0].status = "void";
      await expect(
        caller().saveRefuelRecord({ ...edit, status })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(db.writes).toHaveLength(0);
    }
  );
  it("等待ledger后成本已结算被重新读取拦截", async () => {
    db.fault.afterLock = (table: string) => {
      if (table === "machines")
        db.state.machine_cost_records[0].status = "settled";
    };
    await expect(caller().deleteRefuelRecord(deletion)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(db.writes).toHaveLength(0);
  });
  it.each(["machineId", "projectId", "transportTripId"])(
    "hint与锁后%s变化不可按错误原资源操作",
    async field => {
      db.fault.lockedDiesel = () => {
        db.state.diesel_refuel_records[0][field] = 999;
      };
      await expect(caller().deleteRefuelRecord(deletion)).rejects.toMatchObject(
        { code: "CONFLICT" }
      );
      expect(db.writes).toHaveLength(0);
    }
  );
  it.each([
    { projectId: 4 },
    { machineId: 999 },
    { costType: "repair" },
    { status: "void" },
  ])("异常关联成本%s阻断覆盖", async override => {
    Object.assign(db.state.machine_cost_records[0], override);
    await expect(caller().deleteRefuelRecord(deletion)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(db.writes).toHaveLength(0);
  });
});

describe("柴油普通修改证据/油价快照/双账同步", () => {
  it("不上传照片时省略evidenceId保留原照片；指导价变动也保留原有效快照", async () => {
    db.state.diesel_guideline_prices = []; // 历史指导价不再有效也不能使单纯改升数失败。
    const result = await caller().saveRefuelRecord(edit);
    expect(result).toMatchObject({
      success: true,
      id: 41,
      appliedUnitPrice: 7.35,
      amount: 88.2,
    });
    expect(db.state.diesel_refuel_records[0]).toMatchObject({
      liters: "12",
      amount: "88.2",
      evidenceId: 91,
      createdBy: 2,
    });
    expect(db.state.machine_cost_records[0]).toMatchObject({
      quantity: "12",
      amount: "88.2",
      unitPrice: "7.35",
      evidenceId: 91,
      costName: "柴油历史成本",
      remarks: "原成本备注",
    });
    const audit = db.state.audit_logs.find(
      (row: any) => row.module === "diesel"
    );
    expect(JSON.parse(audit.beforeJson).liters).toBe("10.000");
    expect(JSON.parse(audit.afterJson).liters).toBe("12");
    expect(db.reads).not.toContain("diesel_guideline_prices");
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    await expect(caller().saveRefuelRecord(edit)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
  it("客户端传旧证据ID保留，真实新证据归属校验并同步两账", async () => {
    await caller().saveRefuelRecord({ ...edit, evidenceId: 91 });
    db.state.evidence_records.push({ ...db.state.evidence_records[0], id: 92 });
    await caller().saveRefuelRecord({
      ...edit,
      evidenceId: 92,
      expectedUpdatedAt:
        db.state.diesel_refuel_records[0].updatedAt.toISOString(),
    });
    expect(db.state.diesel_refuel_records[0].evidenceId).toBe(92);
    expect(db.state.machine_cost_records[0].evidenceId).toBe(92);
  });
  it("新照片跨项目/无效证据不得替换原凭证", async () => {
    db.state.evidence_records.push({
      ...db.state.evidence_records[0],
      id: 92,
      projectId: 4,
    });
    await expect(
      caller().saveRefuelRecord({ ...edit, evidenceId: 92 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.state.diesel_refuel_records[0].evidenceId).toBe(91);
    expect(db.writes).toHaveLength(0);
  });
  it("改日期重新按有效指导价计算（不扩大历史价格保留范围）", async () => {
    expect(
      await caller().saveRefuelRecord({
        ...edit,
        refueledAt: "2026-11-16T04:00:00Z",
      })
    ).toMatchObject({ appliedUnitPrice: 9.99, amount: 119.88 });
    expect(db.state.machine_cost_records[0]).toMatchObject({
      unitPrice: "9.99",
      amount: "119.88",
    });
  });
  it("改供油方式和实际单价用新价格同步关联机械成本", async () => {
    const result = await caller().saveRefuelRecord({
      ...edit,
      supplyMethod: "external_station",
      actualUnitPrice: 8.25,
      stationOrSupplierName: "测试站",
    });
    expect(result).toMatchObject({ appliedUnitPrice: 8.25, amount: 99 });
    expect(db.state.machine_cost_records[0].unitPrice).toBe("8.25");
  });
  it.each(["machine_cost_records", "audit"])(
    "普通修改%s失败两账原子回滚且不通知",
    async fault => {
      if (fault === "audit") db.fault.audit = true;
      else db.fault.update = fault;
      const before = structuredClone(db.state);
      await expect(caller().saveRefuelRecord(edit)).rejects.toThrow();
      expect(db.state).toEqual(before);
      expect(mocks.notify).not.toHaveBeenCalled();
    }
  );
  it("项目/原设备禁改，锁原机器而不是输入指定机器", async () => {
    await expect(
      caller().saveRefuelRecord({ ...edit, machineId: 999 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.locks).toContain("machines");
    expect(db.writes).toHaveLength(0);
  });
  it("车辆编辑不能绕过有效结算来源绑定", async () => {
    useVehicle();
    bindVehicleSettlement();
    await expect(
      caller().saveRefuelRecord({
        ...edit,
        assetType: "vehicle",
        machineId: null,
        vehicleId: 21,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.writes).toHaveLength(0);
  });
  it("兼容未带expectedUpdatedAt的旧编辑，仍基于锁后原版本CAS", async () => {
    const { expectedUpdatedAt: _version, ...legacyEdit } = edit;
    await expect(caller().saveRefuelRecord(legacyEdit)).resolves.toMatchObject({
      success: true,
    });
    expect(
      db.state.diesel_refuel_records[0].updatedAt.getTime()
    ).toBeGreaterThan(version.getTime());
  });
  it("同秒内两次编辑推进秒级updatedAt，旧客户端版本不能再次命中", async () => {
    const clock = vi
      .spyOn(Date, "now")
      .mockReturnValue(version.getTime() + 500);
    try {
      await caller().saveRefuelRecord(edit);
      expect(db.state.diesel_refuel_records[0].updatedAt.getTime()).toBe(
        version.getTime() + 1000
      );
      await expect(caller().saveRefuelRecord(edit)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      await caller().saveRefuelRecord({
        ...edit,
        expectedUpdatedAt:
          db.state.diesel_refuel_records[0].updatedAt.toISOString(),
      });
      expect(db.state.diesel_refuel_records[0].updatedAt.getTime()).toBe(
        version.getTime() + 2000
      );
    } finally {
      clock.mockRestore();
    }
  });
  it("新建车辆正常业务仍按当日指导价、现场照片、直接记账和原通知合同处理", async () => {
    db.state.diesel_refuel_records = [];
    db.state.machine_cost_records = [];
    const { id: _id, expectedUpdatedAt: _version, ...creation } = edit;
    const result = await caller().saveRefuelRecord({
      ...creation,
      assetType: "vehicle",
      machineId: null,
      vehicleId: 21,
      evidenceId: 91,
      status: "draft",
    });
    expect(result).toMatchObject({
      success: true,
      appliedUnitPrice: 9.99,
      amount: 119.88,
    });
    expect(db.state.diesel_refuel_records).toHaveLength(1);
    expect(db.state.diesel_refuel_records[0]).toMatchObject({
      status: "approved",
      evidenceId: 91,
      createdBy: 7,
      vehicleId: 21,
    });
    expect(db.state.machine_cost_records).toHaveLength(0);
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ eventCode: "diesel_refuel_recorded" })
    );
    expect(mocks.sms).toHaveBeenCalledWith(
      expect.objectContaining({ eventCode: "diesel_refuel_completed" })
    );
  });
});
