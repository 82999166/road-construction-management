import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQLInputValue } from "node:sqlite";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { getTableColumns, getTableName, SQL } from "drizzle-orm";
import {
  MySqlDialect,
  type AnyMySqlColumn,
  type MySqlTable,
} from "drizzle-orm/mysql-core";
import type { TrpcContext } from "./_core/context";
import type { SettlementPaymentDb } from "./services/settlementPayments";
import {
  auditLogs,
  dailyAccountingClosures,
  evidenceRecords,
  financialRecords,
  laborWorkers,
  machinePaymentSettlements,
  machines,
  payrollStatements,
  projects,
  settlementPaymentRecords,
  subcontractPackages,
  subcontractPaymentSettlements,
  temporaryDailyWageSettlements,
  transportVehicleCarryForwardOffsets,
  transportVehicleSettlements,
  transportVehicles,
} from "../drizzle/schema";
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite"
) as typeof import("node:sqlite");

const mock = vi.hoisted(() => ({
  db: undefined as QueuedDb | undefined,
  roles: ["ALL"],
  projectAllowed: true,
  departmentAllowed: true,
  detailedAllowed: true,
  authChecks: 0,
}));
vi.mock("./db", () => ({
  getDb: async () => mock.db as unknown as SettlementPaymentDb,
}));
vi.mock("./access", async original => {
  const access = await original<typeof import("./access")>();
  const { TRPCError } = await import("@trpc/server");
  const forbidden = (message: string) => {
    throw new TRPCError({ code: "FORBIDDEN", message });
  };
  return {
    ...access,
    assertDepartmentBusinessAccess: async (
      _ctx: unknown,
      _module: unknown,
      action: unknown
    ) => {
      mock.authChecks++;
      if (!mock.departmentAllowed) forbidden("当前部门未获授权办理财务业务");
      if (action === "settle" && !mock.detailedAllowed)
        forbidden("当前角色未获实际付款操作权限");
    },
    assertProjectInCurrentScope: async (_ctx: unknown, id: number) => {
      if (id !== 1 || !mock.projectAllowed)
        forbidden("当前账号未获授权访问该项目数据");
    },
    getEffectiveRoleCodes: async () => mock.roles,
    getSuperAdminAccess: async () => ({
      canAccess: mock.roles.includes("ALL"),
    }),
    getRoleOperationPermissionDecision: async () => ({
      hasDetailedPermissions: false,
      allowed: true,
    }),
    hasUserSpecificOperationPermission: async () => true,
  };
});
vi.mock("./services/businessNotifier", () => ({
  notifyOfficialAccountBusinessEventSafely: async () => {},
}));
vi.mock("./services/officialAccountDriverBinding", () => ({
  sendOfficialAccountDriverNotification: async () => {},
}));
vi.mock("./storage", () => ({
  storageGetSignedUrl: async () => "/controlled/proof",
  storagePut: async () => ({ key: "controlled-proof" }),
}));
import { settlementPaymentRouter } from "./routers/settlementPayments";
import { transportRouter } from "./routers/operations";
import { router } from "./_core/trpc";
import { verifyAuditIntegrityChain } from "./services/auditIntegrity";

type Row = Record<string, unknown>;
type Projection = Record<string, AnyMySqlColumn | SQL | MySqlTable>;
const sqlValue = (value: unknown): SQLInputValue =>
  value instanceof Date
    ? value.toISOString().slice(0, 23).replace("T", " ")
    : typeof value === "boolean"
      ? Number(value)
      : value === undefined || value === null
        ? null
        : typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "bigint"
          ? value
          : JSON.stringify(value);

/** Only a disposable :memory: SQL evaluator is used. It never opens the application DB.
 * All transactions queue, isolate writes and restore the complete fixture on failure.
 * Drizzle-generated WHERE/JOIN predicates are evaluated rather than silently ignored. */
class QueuedDb {
  rows: Record<string, Row[]> = {};
  locks: string[][] = [];
  private activeLocks?: string[];
  private gate = Promise.resolve();
  beforeTransaction?: () => void | Promise<void>;
  failTable?: string;
  failOnce = false;
  zeroUpdateTable?: string;
  missingIdTable?: string;
  select(projection?: Projection) {
    return { from: (table: MySqlTable) => this.query(table, projection) };
  }
  private query(table: MySqlTable, projection?: Projection) {
    let condition: SQL | undefined, limit: number | undefined;
    const joins: Array<{ table: MySqlTable; condition: SQL }> = [];
    const evaluate = () => {
      const tables = [table, ...joins.map(join => join.table)];
      const sqlite = new DatabaseSync(":memory:");
      try {
        for (const item of tables) {
          const name = getTableName(item),
            records = this.rows[name] ?? [];
          const columns = [
            ...new Set([
              ...Object.values(getTableColumns(item)).map(
                column => column.name
              ),
              ...records.flatMap(row => Object.keys(row)),
            ]),
          ];
          sqlite.exec(
            `CREATE TABLE \`${name}\` (__index INTEGER, ${columns.map(column => `\`${column}\``).join(",")})`
          );
          const insert = sqlite.prepare(
            `INSERT INTO \`${name}\` VALUES (${[0, ...columns].map(() => "?").join(",")})`
          );
          records.forEach((row, index) =>
            insert.run(index, ...columns.map(column => sqlValue(row[column])))
          );
        }
        const dialect = new MySqlDialect();
        const predicates = joins.map(join => ({
          name: getTableName(join.table),
          ...dialect.sqlToQuery(join.condition),
        }));
        const where = condition ? dialect.sqlToQuery(condition) : undefined;
        const params = [
          ...predicates.flatMap(join => join.params),
          ...(where?.params ?? []),
        ].map(sqlValue);
        const from = `FROM \`${getTableName(table)}\` ${predicates.map(join => `INNER JOIN \`${join.name}\` ON ${join.sql}`).join(" ")} ${where ? `WHERE ${where.sql}` : ""}`;
        if (
          projection &&
          Object.values(projection).some(value => value instanceof SQL)
        ) {
          const expressions = Object.entries(projection)
            .map(
              ([key, value]) =>
                `${dialect.sqlToQuery(value.getSQL()).sql} AS \`${key}\``
            )
            .join(",");
          return sqlite
            .prepare(`SELECT ${expressions} ${from}`)
            .all(...params)
            .map(row => ({ ...row }));
        }
        const selected = sqlite
          .prepare(
            `SELECT ${tables.map((item, index) => `\`${getTableName(item)}\`.__index AS index${index}`).join(",")} ${from}`
          )
          .all(...params);
        return selected.slice(0, limit).map(indices => {
          const records = tables.map(
            (item, index) =>
              (this.rows[getTableName(item)] ?? [])[
                Number(indices[`index${index}`])
              ]
          );
          if (!projection) return structuredClone(records[0]);
          return Object.fromEntries(
            Object.entries(projection).map(([key, column]) => {
              if (column instanceof SQL) return [key, null];
              if (!("table" in column))
                return [
                  key,
                  structuredClone(
                    records[
                      tables.findIndex(
                        item => getTableName(item) === getTableName(column)
                      )
                    ]
                  ),
                ];
              const index = tables.findIndex(
                item => getTableName(item) === getTableName(column.table)
              );
              return [key, structuredClone(records[index]?.[column.name])];
            })
          );
        });
      } finally {
        sqlite.close();
      }
    };
    const builder = {
      where: (value: SQL) => {
        condition = value;
        return builder;
      },
      orderBy: (..._values: unknown[]) => builder,
      limit: (value: number) => {
        limit = value;
        return builder;
      },
      innerJoin: (joined: MySqlTable, value: SQL) => {
        joins.push({ table: joined, condition: value });
        return builder;
      },
      for: (_mode: string) => {
        if (!this.activeLocks)
          throw new Error("FOR UPDATE must run in a transaction");
        this.activeLocks.push(getTableName(table));
        return builder;
      },
      then: <TResult1 = Row[], TResult2 = never>(
        resolve?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
        reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
      ) => Promise.resolve().then(evaluate).then(resolve, reject),
    };
    return builder;
  }
  insert(table: MySqlTable) {
    return {
      values: (data: Row | Row[]) => {
        let result: Array<{ insertId: number }> | undefined;
        const write = () => {
          if (result) return result;
          const name = getTableName(table);
          if (this.failTable === name) {
            if (this.failOnce) this.failTable = undefined;
            throw new Error("SQL /private/db-path credential=secret-fixture");
          }
          const rows = (this.rows[name] ??= []),
            values = Array.isArray(data) ? data : [data];
          let first = 0;
          for (const value of values) {
            const id = Number(
              value.id ??
                Math.max(0, ...rows.map(row => Number(row.id ?? 0))) + 1
            );
            first ||= id;
            rows.push({ id, ...structuredClone(value) });
          }
          return (result = [
            { insertId: this.missingIdTable === name ? 0 : first },
          ]);
        };
        return {
          $returningId: async () =>
            write().map(value => ({ id: value.insertId })),
          then: <TResult1 = Array<{ insertId: number }>, TResult2 = never>(
            resolve?:
              | ((
                  value: Array<{ insertId: number }>
                ) => TResult1 | PromiseLike<TResult1>)
              | null,
            reject?:
              | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
              | null
          ) => Promise.resolve().then(write).then(resolve, reject),
        };
      },
    };
  }
  update(table: MySqlTable) {
    return {
      set: (patch: Row) => ({
        where: async (condition: SQL) => {
          if (this.failTable === getTableName(table))
            throw new Error("SQL /private/db-path credential=secret-fixture");
          const selected = await this.select({ id: getTableColumns(table).id })
            .from(table)
            .where(condition);
          const ids = new Set(selected.map(row => row.id));
          const rows =
            this.zeroUpdateTable === getTableName(table)
              ? []
              : (this.rows[getTableName(table)] ?? []).filter(row =>
                  ids.has(row.id)
                );
          rows.forEach(row => Object.assign(row, structuredClone(patch)));
          return [{ affectedRows: rows.length }];
        },
      }),
    };
  }
  delete(table: MySqlTable) {
    return {
      where: async (condition: SQL) => {
        const selected = await this.select({ id: getTableColumns(table).id })
          .from(table)
          .where(condition);
        const ids = new Set(selected.map(row => row.id));
        this.rows[getTableName(table)] = (
          this.rows[getTableName(table)] ?? []
        ).filter(row => !ids.has(row.id));
        return [{ affectedRows: ids.size }];
      },
    };
  }
  async transaction<T>(run: (tx: QueuedDb) => Promise<T>) {
    const previous = this.gate;
    let release!: () => void;
    this.gate = new Promise<void>(resolve => {
      release = resolve;
    });
    await previous;
    const before = this.beforeTransaction;
    this.beforeTransaction = undefined;
    await before?.();
    const saved = structuredClone(this.rows),
      locks: string[] = [];
    this.activeLocks = locks;
    this.locks.push(locks);
    try {
      return await run(this);
    } catch (error) {
      this.rows = saved;
      throw error;
    } finally {
      this.activeLocks = undefined;
      release();
    }
  }
}

const time = new Date("2026-11-04T00:00:00Z");
const db = () => mock.db!;
const root = router({
  settlementPayment: settlementPaymentRouter,
  transport: transportRouter,
});
const ctx = { user: { id: 1, role: "user" }, req: {}, res: {} } as TrpcContext;
const caller = () => root.createCaller(ctx);
type SourceType = typeof settlementPaymentRecords.$inferSelect.settlementType;
const input = (
  settlementType: SourceType = "transport_vehicle",
  amount = 60
) => ({
  projectId: 1,
  settlementType,
  settlementId: 1,
  amount,
  paymentDate: "2026-11-04",
  paymentMethod: "cash" as const,
  payeeName: "收款人甲",
  evidenceId: 1,
});
function seed<T extends MySqlTable>(
  table: T,
  rows: Array<Partial<T["$inferInsert"]>>
) {
  db().rows[getTableName(table)] = structuredClone(rows) as Row[];
}
function source(type: SourceType = "transport_vehicle", patch: Row = {}) {
  const common = {
    id: 1,
    projectId: 1,
    status: "approved",
    payeeName: "收款人甲",
    payeeAccount: null,
    approvedBy: 2,
    ...patch,
  };
  if (type === "transport_vehicle")
    seed(transportVehicleSettlements, [
      {
        ...common,
        vehicleId: 1,
        settlementNo: "S-1",
        netPayableAmount: "100",
        settlementKind: "adjustment",
        fuelDeductionAmount: "0",
        assetDeductionAmount: "0",
        carryForwardDeductionAmount: "0",
        ...patch,
      },
    ]);
  if (type === "machine")
    seed(machinePaymentSettlements, [
      {
        ...common,
        machineId: 1,
        settlementNo: "M-1",
        netPayableAmount: "100",
        ...patch,
      },
    ]);
  if (type === "payroll")
    seed(payrollStatements, [
      {
        ...common,
        workerId: 1,
        actualAmount: "100",
        period: "2026-11",
        ...patch,
      },
    ]);
  if (type === "daily_wage")
    seed(temporaryDailyWageSettlements, [
      {
        ...common,
        workerId: 1,
        actualAmount: "100",
        settlementDate: time,
        ...patch,
      },
    ]);
  if (type === "subcontract") {
    seed(subcontractPaymentSettlements, [
      {
        ...common,
        packageId: 1,
        settlementNo: "SUB-1",
        packageNoSnapshot: "P-1",
        netPayableAmount: "100",
        ...patch,
      },
    ]);
    seed(subcontractPackages, [{ id: 1, projectId: 1, status: "confirmed" }]);
  }
  seed(evidenceRecords, [
    {
      id: 1,
      projectId: 1,
      sourceType: "settlement_payment_proof",
      sourceId: `${type}:1`,
      status: "active",
      fileKey: "controlled-proof",
      fileName: "凭证.pdf",
      mimeType: "application/pdf",
    },
  ]);
}
function recovery() {
  source("transport_vehicle", {
    status: "receivable",
    netPayableAmount: "-100",
  });
}
const records = (table: MySqlTable) => db().rows[getTableName(table)] ?? [];
const total = (table: MySqlTable) =>
  records(table).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
const assertNoMoney = () => {
  expect(records(settlementPaymentRecords)).toHaveLength(0);
  expect(records(financialRecords)).toHaveLength(0);
  expect(
    records(auditLogs).filter(row => row.module === "finance")
  ).toHaveLength(0);
};
function pauseNextTransaction() {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => {
    enter = resolve;
  });
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  db().beforeTransaction = async () => {
    enter();
    await held;
  };
  return { entered, release };
}
beforeEach(() => {
  mock.db = new QueuedDb();
  mock.roles = ["ALL"];
  mock.projectAllowed = true;
  mock.departmentAllowed = true;
  mock.detailedAllowed = true;
  mock.authChecks = 0;
  seed(projects, [{ id: 1, status: "active" }]);
  seed(transportVehicles, [
    { id: 1, projectId: 1, plateNo: "湘A12345", ownership: "owned" },
  ]);
  seed(machines, [{ id: 1, projectId: 1 }]);
  seed(laborWorkers, [{ id: 1, projectId: 1, realName: "工人甲" }]);
  db().rows.audit_log_chain_state = [
    {
      id: 1,
      lastSequence: 0,
      lastHash: createHash("sha256")
        .update("audit-chain-v1:genesis:2026-08-21")
        .digest("hex"),
    },
  ];
});

describe("统一付款真实caller与排队事务", () => {
  it.each<SourceType>([
    "transport_vehicle",
    "machine",
    "payroll",
    "daily_wage",
    "subcontract",
  ])(
    "%s 并发两笔只能成功一笔，最后一笔按新余额结清并保留真实流水审计",
    async type => {
      source(type);
      const outcomes = await Promise.allSettled([
        caller().settlementPayment.record(input(type)),
        caller().settlementPayment.record(input(type)),
      ]);
      expect(outcomes.filter(row => row.status === "fulfilled")).toHaveLength(
        1
      );
      const failure = outcomes.find(row => row.status === "rejected");
      expect(
        failure?.status === "rejected" ? String(failure.reason) : ""
      ).toContain("40.00");
      expect(total(settlementPaymentRecords)).toBe(60);
      expect(total(financialRecords)).toBe(60);
      expect(
        records(auditLogs).filter(row => row.module === "finance")
      ).toHaveLength(1);
      const final = await caller().settlementPayment.record(input(type, 40));
      expect(final).toMatchObject({
        status: "paid",
        paidAmount: 100,
        remainingAmount: 0,
      });
      expect(total(settlementPaymentRecords)).toBe(100);
      expect(total(financialRecords)).toBe(100);
      expect(db().locks.every(locks => locks[0] === "projects")).toBe(true);
      const expected =
        type === "transport_vehicle"
          ? ["projects", "transport_vehicles", "transport_vehicle_settlements"]
          : type === "machine"
            ? ["projects", "machines", "machine_payment_settlements"]
            : [
                "projects",
                type === "payroll"
                  ? "payroll_statements"
                  : type === "daily_wage"
                    ? "temporary_daily_wage_settlements"
                    : "subcontract_payment_settlements",
              ];
      expect(db().locks[0].slice(0, expected.length)).toEqual(expected);
      const integrity = await verifyAuditIntegrityChain(
        db() as unknown as Parameters<typeof verifyAuditIntegrityChain>[0]
      );
      expect(integrity.valid).toBe(true);
      expect(integrity.eventCount).toBe(2);
      if (type === "subcontract")
        expect(records(subcontractPackages)[0].status).toBe("settled");
    }
  );
  it("排队期间金额降低，事务按新净额拒绝而非使用旧余额", async () => {
    source();
    db().beforeTransaction = () => {
      records(transportVehicleSettlements)[0].netPayableAmount = "20";
    };
    await expect(caller().settlementPayment.record(input())).rejects.toThrow(
      "20.00"
    );
    assertNoMoney();
  });
  it.each(["void", "paid", "draft", "submitted"])(
    "排队期间主单变为%s必须拒绝",
    async status => {
      source();
      db().beforeTransaction = () => {
        records(transportVehicleSettlements)[0].status = status;
      };
      await expect(
        caller().settlementPayment.record(input())
      ).rejects.toMatchObject({ code: "CONFLICT" });
      assertNoMoney();
    }
  );
  it.each(["closed", "archived"])(
    "排队期间付款日%s封存必须拒绝",
    async status => {
      source();
      db().beforeTransaction = () =>
        seed(dailyAccountingClosures, [
          {
            id: 1,
            projectId: 1,
            closingDate: time,
            status: status as "closed" | "archived",
          },
        ]);
      await expect(caller().settlementPayment.record(input())).rejects.toThrow(
        "付款日期已封存"
      );
      assertNoMoney();
    }
  );
  it.each([
    { status: "void" },
    { projectId: 2 },
    { sourceType: "transport" },
    { sourceId: "transport_vehicle:2" },
  ])("排队期间凭证失效或归属改变不能付款：%j", async patch => {
    source();
    db().beforeTransaction = () =>
      Object.assign(records(evidenceRecords)[0], patch);
    await expect(caller().settlementPayment.record(input())).rejects.toThrow(
      "有效付款凭证"
    );
    assertNoMoney();
  });
  it.each(["role", "project", "department", "detailed"])(
    "排队期间%s授权撤回不能沿用旧鉴权",
    async kind => {
      source();
      db().beforeTransaction = () => {
        if (kind === "role") mock.roles = ["DRIVER"];
        if (kind === "project") mock.projectAllowed = false;
        if (kind === "department") mock.departmentAllowed = false;
        if (kind === "detailed") mock.detailedAllowed = false;
      };
      await expect(
        caller().settlementPayment.record(input())
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(mock.authChecks).toBeGreaterThanOrEqual(2);
      assertNoMoney();
    }
  );
  it("分包审核付款职责分离在事务内重验，不能使用排队前审核人", async () => {
    source("subcontract");
    mock.roles = ["CASHIER"];
    db().beforeTransaction = () => {
      records(subcontractPaymentSettlements)[0].approvedBy = 1;
    };
    await expect(
      caller().settlementPayment.record(input("subcontract"))
    ).rejects.toThrow("职责分离");
    assertNoMoney();
  });
  it.each<SourceType>([
    "transport_vehicle",
    "machine",
    "payroll",
    "daily_wage",
  ])("出纳不能通过统一入口付款%s", async type => {
    source(type);
    mock.roles = ["CASHIER"];
    await expect(
      caller().settlementPayment.record(input(type))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    assertNoMoney();
  });
  it("分包获授权出纳保持原付款权限，并写同一付款表与审计", async () => {
    source("subcontract");
    mock.roles = ["CASHIER"];
    await caller().settlementPayment.record(input("subcontract"));
    expect(total(settlementPaymentRecords)).toBe(60);
    expect(total(financialRecords)).toBe(60);
  });
  it.each([
    "financial_records",
    "audit_logs",
    "audit_log_integrity_events",
    "audit_log_chain_state",
  ])("%s写失败，付款/财务/主单/审计链全回滚且错误无SQL或秘密", async table => {
    source();
    const saved = structuredClone(db().rows);
    db().failTable = table;
    const failure = await caller()
      .settlementPayment.record(input())
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "本次资金登记未完成，款项、流水和审计已一并回滚，请稍后重试",
    });
    expect(String(failure)).not.toMatch(/secret-fixture|private\/db-path|SQL/);
    expect(db().rows).toEqual(saved);
  });
  it.each<SourceType>([
    "transport_vehicle",
    "machine",
    "payroll",
    "daily_wage",
    "subcontract",
  ])("%s主单条件写0行必须回滚，不能保留已插入资金事实", async type => {
    source(type);
    db().zeroUpdateTable =
      type === "transport_vehicle"
        ? "transport_vehicle_settlements"
        : type === "machine"
          ? "machine_payment_settlements"
          : type === "payroll"
            ? "payroll_statements"
            : type === "daily_wage"
              ? "temporary_daily_wage_settlements"
              : "subcontract_payment_settlements";
    const saved = structuredClone(db().rows);
    await expect(
      caller().settlementPayment.record(input(type))
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db().rows).toEqual(saved);
  });
  it("付款没有生成可追溯标识时回滚，不生成孤立财务流水", async () => {
    source();
    const saved = structuredClone(db().rows);
    db().missingIdTable = "settlement_payment_records";
    await expect(caller().settlementPayment.record(input())).rejects.toThrow(
      "未完成"
    );
    expect(db().rows).toEqual(saved);
  });
  it("不足一分的小数金额不得被四舍五入为零付款", async () => {
    source();
    await expect(
      caller().settlementPayment.record(input("transport_vehicle", 0.001))
    ).rejects.toThrow("至少为 0.01");
    assertNoMoney();
  });
  it("两笔各50并发合法付款均成功，后一笔基于已提交实付正确结清", async () => {
    source();
    const outcomes = await Promise.all([
      caller().settlementPayment.record(input("transport_vehicle", 50)),
      caller().settlementPayment.record(input("transport_vehicle", 50)),
    ]);
    expect(outcomes.map(row => row.status)).toEqual(["partial", "paid"]);
    expect(outcomes.map(row => row.remainingAmount)).toEqual([50, 0]);
    expect(total(settlementPaymentRecords)).toBe(100);
    expect(total(financialRecords)).toBe(100);
  });
  it("首个排队事务审计失败全回滚，第二笔可继续付款且不消费失败余额", async () => {
    source();
    db().failTable = "audit_log_integrity_events";
    db().failOnce = true;
    const barrier = pauseNextTransaction();
    const first = caller().settlementPayment.record(input());
    await barrier.entered;
    const second = caller().settlementPayment.record(input());
    const pending = Promise.allSettled([first, second]);
    barrier.release();
    const outcomes = await pending;
    expect(outcomes[0].status).toBe("rejected");
    expect(outcomes[1].status).toBe("fulfilled");
    expect(total(settlementPaymentRecords)).toBe(60);
    expect(total(financialRecords)).toBe(60);
    expect(
      records(auditLogs).filter(row => row.module === "finance")
    ).toHaveLength(1);
    expect(
      (
        await verifyAuditIntegrityChain(
          db() as unknown as Parameters<typeof verifyAuditIntegrityChain>[0]
        )
      ).valid
    ).toBe(true);
  });
});

describe("负净应付补款、有效前期抵扣与跨路由互斥", () => {
  function offsets() {
    recovery();
    records(transportVehicleSettlements).push(
      {
        id: 2,
        projectId: 1,
        vehicleId: 1,
        status: "draft",
        netPayableAmount: "10",
      },
      {
        id: 3,
        projectId: 1,
        vehicleId: 1,
        status: "approved",
        netPayableAmount: "10",
      },
      {
        id: 4,
        projectId: 1,
        vehicleId: 1,
        status: "void",
        netPayableAmount: "10",
      },
      {
        id: 5,
        projectId: 2,
        vehicleId: 1,
        status: "draft",
        netPayableAmount: "10",
      },
      {
        id: 6,
        projectId: 1,
        vehicleId: 2,
        status: "draft",
        netPayableAmount: "10",
      }
    );
    seed(transportVehicleCarryForwardOffsets, [
      {
        id: 1,
        projectId: 1,
        vehicleId: 1,
        sourceSettlementId: 1,
        targetSettlementId: 2,
        status: "active",
        amount: "20",
        createdAt: time,
      },
      {
        id: 2,
        projectId: 1,
        vehicleId: 1,
        sourceSettlementId: 1,
        targetSettlementId: 3,
        status: "active",
        amount: "10",
        createdAt: time,
      },
      {
        id: 3,
        projectId: 1,
        vehicleId: 1,
        sourceSettlementId: 1,
        targetSettlementId: 4,
        status: "active",
        amount: "999",
        createdAt: time,
      },
      {
        id: 4,
        projectId: 1,
        vehicleId: 1,
        sourceSettlementId: 1,
        targetSettlementId: 3,
        status: "reversed",
        amount: "999",
        createdAt: time,
      },
      {
        id: 5,
        projectId: 1,
        vehicleId: 1,
        sourceSettlementId: 1,
        targetSettlementId: 5,
        status: "active",
        amount: "999",
        createdAt: time,
      },
      {
        id: 6,
        projectId: 1,
        vehicleId: 1,
        sourceSettlementId: 1,
        targetSettlementId: 6,
        status: "active",
        amount: "999",
        createdAt: time,
      },
      {
        id: 7,
        projectId: 2,
        vehicleId: 1,
        sourceSettlementId: 1,
        targetSettlementId: 2,
        status: "active",
        amount: "999",
        createdAt: time,
      },
      {
        id: 8,
        projectId: 1,
        vehicleId: 1,
        sourceSettlementId: 1,
        targetSettlementId: 99,
        status: "active",
        amount: "999",
        createdAt: time,
      },
    ]);
    seed(settlementPaymentRecords, [
      {
        id: 1,
        projectId: 1,
        settlementType: "transport_vehicle",
        settlementId: 1,
        direction: "income",
        status: "active",
        amount: "10",
        paymentDate: time,
      },
      {
        id: 2,
        projectId: 1,
        settlementType: "transport_vehicle",
        settlementId: 1,
        direction: "income",
        status: "reversed",
        amount: "999",
        paymentDate: time,
      },
    ]);
  }
  it("详情与看板扣全部active有效抵扣，不扣作废/逆转/错车/跨项目/缺失目标且不猜历史", async () => {
    offsets();
    const list = await caller().settlementPayment.list({
      projectId: 1,
      settlementType: "transport_vehicle",
      settlementId: 1,
    });
    expect(list).toMatchObject({
      dueAmount: 100,
      offsetAmount: 30,
      paidAmount: 10,
      remainingAmount: 60,
      direction: "income",
    });
    const board = await caller().settlementPayment.board({
      projectId: 1,
      sourceTypes: ["transport_vehicle"],
      asOfDate: "2026-11-04",
    });
    expect(board.rows.find(row => row.settlementId === 1)).toMatchObject({
      offsetAmount: 30,
      paidOrRecoveredAmount: 10,
      remainingAmount: 60,
    });
    await expect(
      caller().settlementPayment.record(input("transport_vehicle", 60.01))
    ).rejects.toThrow("60.00");
    const paid = await caller().settlementPayment.record(
      input("transport_vehicle", 60)
    );
    expect(paid).toMatchObject({
      status: "offset",
      dueAmount: 100,
      paidAmount: 70,
      remainingAmount: 0,
    });
    expect(records(financialRecords)[0]).toMatchObject({
      direction: "income",
      amount: "60",
    });
  });
  it("负净应付并发补款不能与已占用抵扣超过源欠额", async () => {
    offsets();
    const outcomes = await Promise.allSettled([
      caller().settlementPayment.record(input("transport_vehicle", 40)),
      caller().settlementPayment.record(input("transport_vehicle", 40)),
    ]);
    expect(outcomes.filter(row => row.status === "fulfilled")).toHaveLength(1);
    const list = await caller().settlementPayment.list({
      projectId: 1,
      settlementType: "transport_vehicle",
      settlementId: 1,
    });
    expect(list).toMatchObject({
      paidAmount: 50,
      offsetAmount: 30,
      remainingAmount: 20,
    });
  });
  it("没有有效分配和逐笔实收时，不从旧标签或扣款合计猜测历史已收补款", async () => {
    recovery();
    records(transportVehicleSettlements)[0].carryForwardDeductionAmount = "999";
    const list = await caller().settlementPayment.list({
      projectId: 1,
      settlementType: "transport_vehicle",
      settlementId: 1,
    });
    expect(list).toMatchObject({
      dueAmount: 100,
      paidAmount: 0,
      offsetAmount: 0,
      remainingAmount: 100,
    });
  });
  const adjustment = {
    projectId: 1,
    vehicleId: 1,
    periodStart: "2026-11-04",
    periodEnd: "2026-11-04",
    payeeName: "司机甲",
    paymentMethod: "cash" as const,
    settlementKind: "adjustment" as const,
    basisDescription: "经审核的原始签证依据",
    adjustmentAmount: 60,
  };
  it("运输创建先占前期抵扣时，统一补款排队重算不能再使用同一余额", async () => {
    recovery();
    const barrier = pauseNextTransaction();
    const creation =
      caller().transport.createNonTripVehicleSettlement(adjustment);
    await barrier.entered;
    const payment = caller().settlementPayment.record(
      input("transport_vehicle", 60)
    );
    const outcomes = Promise.allSettled([creation, payment]);
    barrier.release();
    const results = await outcomes;
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect(total(transportVehicleCarryForwardOffsets)).toBe(60);
    expect(total(settlementPaymentRecords)).toBe(0);
    expect(db().locks.every(locks => locks[0] === "projects")).toBe(true);
  });
  it("统一補款先入账时，运输创建不得按排队前旧余额继续抵扣", async () => {
    recovery();
    const barrier = pauseNextTransaction();
    const payment = caller().settlementPayment.record(
      input("transport_vehicle", 60)
    );
    await barrier.entered;
    const creation =
      caller().transport.createNonTripVehicleSettlement(adjustment);
    // 让运输在持锁付款提交前完成候选余额读取，真实模拟旧快照排队。
    await new Promise(resolve => setImmediate(resolve));
    const outcomes = Promise.allSettled([payment, creation]);
    barrier.release();
    const results = await outcomes;
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect(total(settlementPaymentRecords)).toBe(60);
    expect(total(transportVehicleCarryForwardOffsets)).toBe(0);
    const retry =
      await caller().transport.createNonTripVehicleSettlement(adjustment);
    expect(retry).toMatchObject({
      carryForwardDeductionAmount: 40,
      netPayableAmount: 20,
    });
    expect(
      total(settlementPaymentRecords) +
        total(transportVehicleCarryForwardOffsets)
    ).toBe(100);
  });
  it.each([true, false])(
    "付款与运输作废并发不能双成功，付款优先=%s",
    async paymentFirst => {
      source();
      const payment = () => caller().settlementPayment.record(input());
      const cancel = () =>
        caller().transport.transitionVehicleSettlement({
          projectId: 1,
          id: 1,
          action: "void",
        });
      const barrier = pauseNextTransaction();
      const first = paymentFirst ? payment() : cancel();
      await barrier.entered;
      const second = paymentFirst ? cancel() : payment();
      await new Promise(resolve => setImmediate(resolve));
      const outcomes = Promise.allSettled([first, second]);
      barrier.release();
      const results = await outcomes;
      expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
      const status = records(transportVehicleSettlements)[0].status;
      if (!paymentFirst) {
        expect(status).toBe("void");
        assertNoMoney();
      } else {
        expect(status).toBe("partial");
        expect(total(settlementPaymentRecords)).toBe(60);
        expect(total(financialRecords)).toBe(60);
      }
      expect(db().locks.every(locks => locks[0] === "projects")).toBe(true);
    }
  );
});
