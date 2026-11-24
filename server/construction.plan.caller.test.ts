import { withNumberingFixture } from "./services/businessDocumentNumber.fixtureAdapter";
import { createRequire } from "node:module";
import type {
  DatabaseSync as MemoryDatabase,
  SQLInputValue,
} from "node:sqlite";
import { TRPCError } from "@trpc/server";
import { getTableColumns, getTableName, sql, type SQL } from "drizzle-orm";
import { evidenceRecords, auditLogChainState, auditLogIntegrityEvents } from "../drizzle/schema";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./access", async original => ({
  ...(await original<typeof import("./access")>()),
  assertDepartmentBusinessAccess: vi.fn(),
  assertProjectInCurrentScope: vi.fn(),
  getEffectiveRoleCodes: vi.fn(),
  getSuperAdminAccess: vi.fn(),
  getRoleOperationPermissionDecision: vi.fn(),
}));
vi.mock("./services/businessNotifier", () => ({
  notifyOfficialAccountBusinessEventSafely: vi
    .fn()
    .mockResolvedValue(undefined),
}));
vi.mock("./routers/messages", () => ({
  createInAppMessage: vi.fn().mockResolvedValue({ created: true }),
}));

import {
  assertDepartmentBusinessAccess,
  assertProjectInCurrentScope,
  getEffectiveRoleCodes,
  getRoleOperationPermissionDecision,
  getSuperAdminAccess,
} from "./access";
import { getDb } from "./db";
import { router } from "./_core/trpc";
import { constructionRouter } from "./routers/construction";
import { createInAppMessage } from "./routers/messages";
import { notifyOfficialAccountBusinessEventSafely } from "./services/businessNotifier";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite"
) as typeof import("node:sqlite");
const stores: MemoryDatabase[] = [];
// 保留真实 construction.* RPC 路径，不能绕过统一历史修改/审核权限中间件。
const callerRouter = router({ construction: constructionRouter });
function context(id = 1, role: "user" | "admin" = "admin"): TrpcContext {
  return {
    user: {
      id,
      openId: `plan-caller-${id}`,
      name: `管理人员${id}`,
      email: null,
      loginMethod: "manus",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}
const caller = (ctx = context()) => callerRouter.createCaller(ctx).construction;
const input = () => ({
  projectId: 10,
  reportDate: "2026-11-13",
  workArea: "K12+500 路基作业面",
  weather: "cloudy" as const,
  workContent: "当日完成路基填筑与碾压检测。",
  safetyNotes: "落实临边防护和安全交底",
  issueNotes: "局部压实度待复检",
  progressPercent: 35.5,
});
const originalPlan = "明日先复检压实度，再组织下一层填筑。";
const report = (patch: Record<string, unknown> = {}) => ({
  id: 71,
  documentNo: null, // 迁移前历史单据不重编号，真实投影返回 nullable 新列。
  ...input(),
  progressPercent: "35.5",
  constructionPlan: originalPlan,
  issuePriority: null,
  status: "draft",
  createdBy: 2,
  reviewReply: "原审核回复",
  reviewedBy: 3,
  reviewedAt: "2026-11-12T09:00:00.000Z",
  createdAt: "2026-11-13T08:00:00.000Z",
  updatedAt: "2026-11-13T08:00:00.000Z",
  ...patch,
});

type Table = Parameters<typeof getTableName>[0];
/**
 * 复用 callerBehavior 的 :memory: SQL 执行思路，扩展真实条件写入。
 * 数据只在内存；投影、关键词、项目/状态 WHERE 均由真实路由生成后执行，
 * 不按预设返回行，也不以源码文本包含关系作为断言。
 */
function memoryDb(records: Record<string, unknown>[] = []) {
  const memory = new DatabaseSync(":memory:");
  stores.push(memory);
  memory.function("CHAR_LENGTH", value => String(value ?? "").length);
  memory.function("regexp", (pattern, value) =>
    new RegExp(String(pattern).replace("[^[:space:]]", "\\S")).test(
      String(value ?? "")
    )
      ? 1
      : 0
  );
  memory.exec(`
    CREATE TABLE construction_daily_reports (
      id INTEGER PRIMARY KEY, documentNo TEXT, projectId INTEGER NOT NULL, reportDate TEXT NOT NULL,
      workArea TEXT NOT NULL, weather TEXT NOT NULL DEFAULT 'other', workContent TEXT NOT NULL,
      constructionPlan TEXT, safetyNotes TEXT, issueNotes TEXT, issuePriority TEXT, progressPercent TEXT NOT NULL DEFAULT '0',
      status TEXT NOT NULL DEFAULT 'draft', createdBy INTEGER NOT NULL, reviewReply TEXT,
      reviewedBy INTEGER, reviewedAt TEXT, createdAt TEXT DEFAULT '2026-11-13T08:00:00.000Z',
      updatedAt TEXT DEFAULT '2026-11-13T08:00:00.000Z');
    CREATE TABLE projects (id INTEGER PRIMARY KEY, status TEXT);
    INSERT INTO projects VALUES (10,'active'),(20,'active');
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO users VALUES (1,'管理人员1'),(2,'现场填报人'),(3,'项目主管');
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY, userId INTEGER, module TEXT, action TEXT, targetType TEXT,
      targetId TEXT, summary TEXT, beforeJson TEXT, afterJson TEXT, ipAddress TEXT,
      createdAt TEXT DEFAULT '2026-11-13T08:00:00.000Z');
    CREATE TABLE system_roles (id INTEGER PRIMARY KEY, code TEXT, status TEXT);
    INSERT INTO system_roles VALUES (1,'CONSTRUCTION_MANAGER','active');
    CREATE TABLE user_role_assignments (
      id INTEGER PRIMARY KEY, userId INTEGER, roleId INTEGER, projectId INTEGER,
      status TEXT, validFrom TEXT, validTo TEXT);
    INSERT INTO user_role_assignments VALUES (1,3,1,10,'active',NULL,NULL);
  `);
  // 按真实 schema 创建新调用所需的全部列；历史 documentNo NULL 原样保留。
  for (const table of [evidenceRecords, auditLogChainState, auditLogIntegrityEvents]) {
    memory.exec(`CREATE TABLE ${getTableName(table)} (${Object.values(getTableColumns(table)).map(column =>
      `\`${column.name}\` ${column.name === "id" ? "INTEGER PRIMARY KEY" : column.dataType === "number" || column.dataType === "boolean" ? "INTEGER" : "TEXT"}`
    ).join(",")})`);
  }
  const locks: string[] = [];
  const dialect = new MySqlDialect();
  const values = (entries: unknown[]): SQLInputValue[] =>
    entries.map(value =>
      value instanceof Date
        ? value.toISOString().replace(/T00:00:00\.000Z$/, "")
        : (value as SQLInputValue)
    );
  const executeInsert = (table: string, record: Record<string, unknown>) => {
    const entries = Object.entries(record).filter(
      ([, value]) => value !== undefined
    );
    return memory
      .prepare(
        `INSERT INTO \`${table}\` (${entries.map(([key]) => `\`${key}\``).join(",")}) VALUES (${entries.map(() => "?").join(",")})`
      )
      .run(...values(entries.map(([, value]) => value)));
  };
  records.forEach(row => executeInsert("construction_daily_reports", row));
  const select = vi.fn((projection?: Record<string, unknown>) => ({
    from(table: Table) {
      let predicate: SQL | undefined;
      let limit: number | undefined;
      let order: SQL[] = [];
      const joins: SQL[] = [];
      const execute = () => {
        const expressions = Object.entries(
          projection ?? getTableColumns(table)
        ).map(
          ([name, value]) => sql`${value as SQL} as ${sql.identifier(name)}`
        );
        const query = sql`select ${sql.join(expressions, sql`, `)} from ${sql.identifier(getTableName(table))}`;
        joins.forEach(join => query.append(join));
        if (predicate) query.append(sql` where ${predicate}`);
        if (order.length)
          query.append(sql` order by ${sql.join(order, sql`, `)}`);
        if (limit !== undefined) query.append(sql` limit ${limit}`);
        const compiled = dialect.sqlToQuery(query);
        // 补齐 MySQL 的默认 LIKE 反斜杠转义；其他查询不预先过滤。
        const statement = compiled.sql.replace(
          /like \?/gi,
          "like ? ESCAPE '\\'"
        );
        return memory.prepare(statement).all(...values(compiled.params));
      };
      const chain = {
        leftJoin(joined: Table, on: SQL) {
          joins.push(
            sql` left join ${sql.identifier(getTableName(joined))} on ${on}`
          );
          return chain;
        },
        innerJoin(joined: Table, on: SQL) {
          joins.push(
            sql` inner join ${sql.identifier(getTableName(joined))} on ${on}`
          );
          return chain;
        },
        where(value: SQL) {
          predicate = value;
          return chain;
        },
        orderBy(...value: SQL[]) {
          order = value;
          return chain;
        },
        limit(value: number) {
          limit = value;
          return chain;
        },
        for(mode: string) { locks.push(`${getTableName(table)}:${mode}`); return chain; },
        then(resolve: (rows: unknown[]) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve().then(execute).then(resolve, reject);
        },
      };
      return chain;
    },
  }));
  const insert = vi.fn((table: Table) => ({
    values(record: Record<string, unknown>) {
      const execute = () => executeInsert(getTableName(table), record);
      return {
        $returningId: async () => [{ id: Number(execute().lastInsertRowid) }],
        then: (resolve: (result: unknown) => unknown) =>
          Promise.resolve().then(execute).then(resolve),
      };
    },
  }));
  let beforeUpdate: (() => void) | undefined;
  let appliedConcurrentWrite: (() => void) | undefined;
  const update = vi.fn((table: Table) => ({
    set(record: Record<string, unknown>) {
      return {
        async where(predicate: SQL) {
          appliedConcurrentWrite = beforeUpdate;
          beforeUpdate?.();
          beforeUpdate = undefined;
          const entries = Object.entries(record).filter(
            ([, value]) => value !== undefined
          );
          const assignments = entries.map(
            ([name, value]) => sql`${sql.identifier(name)} = ${value}`
          );
          const query = sql`update ${sql.identifier(getTableName(table))} set ${sql.join(assignments, sql`, `)} where ${predicate}`;
          const compiled = dialect.sqlToQuery(query);
          const result = memory
            .prepare(compiled.sql)
            .run(...values(compiled.params));
          return [{ affectedRows: Number(result.changes) }];
        },
      };
    },
  }));
  return {
    memory,
    locks,
    db: { select, insert, update, transaction: async (callback: (tx: any) => Promise<unknown>) => {
      memory.exec("BEGIN");
      try { const result = await callback({ select, insert, update }); memory.exec("COMMIT"); return result; }
      catch (error) {
        memory.exec("ROLLBACK");
        // 单连接内存 SQL 无法另开并行连接；竞争方已提交的变更不属于本事务回滚范围。
        // 重放真实竞争 SQL，仅恢复其已提交事实，业务 UPDATE/CAS/审计仍完整回滚。
        appliedConcurrentWrite?.();
        throw error;
      }
      finally { appliedConcurrentWrite = undefined; }
    } },
    raw: (id = 71) =>
      memory
        .prepare("SELECT * FROM construction_daily_reports WHERE id=?")
        .get(id),
    audits: () => memory.prepare("SELECT * FROM audit_logs ORDER BY id").all(),
    beforeNextUpdate: (hook: () => void) => {
      beforeUpdate = hook;
    },
  };
}
function useDb(records: Record<string, unknown>[] = []) {
  const store = memoryDb(records);
  vi.mocked(getDb).mockResolvedValue(withNumberingFixture(store.db) as never);
  return store;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertDepartmentBusinessAccess).mockResolvedValue({
    departments: [],
    moduleCodes: ["CONSTRUCTION"],
    hasAllDepartments: false,
  });
  vi.mocked(assertProjectInCurrentScope).mockResolvedValue(undefined);
  vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["CONSTRUCTION_MANAGER"]);
  vi.mocked(getSuperAdminAccess).mockImplementation(async ctx => ({
    user: ctx.user!,
    canAccess: ctx.user?.role === "admin",
  }));
  vi.mocked(getRoleOperationPermissionDecision).mockResolvedValue({
    hasDetailedPermissions: false,
    allowed: false,
  });
});
afterEach(() => {
  stores.splice(0).forEach(store => store.close());
});

describe("可选施工计划：真实 scoped caller 与内存 SQL 回归", () => {
  it("获授权普通填报人新建，修剪计划并保留正文、安全、问题、进度和审计通知", async () => {
    const store = useDb();
    const result = await caller(context(1, "user")).saveReport({
      ...input(),
      constructionPlan: ` \n${originalPlan}\n第二班组负责测量放样。 \t`,
    });
    expect(result).toEqual({ id: 1, created: true });
    expect(store.raw(1)).toMatchObject({
      ...input(),
      documentNo: expect.stringMatching(/^CR\d{14}0001\d{4}$/),
      progressPercent: "35.5",
      createdBy: 1,
      status: "draft",
      constructionPlan: `${originalPlan}\n第二班组负责测量放样。`,
      reviewReply: null,
      reviewedBy: null,
      reviewedAt: null,
    });
    expect(store.audits()).toEqual([
      expect.objectContaining({
        userId: 1,
        module: "construction",
        action: "create_daily_report",
        targetId: "1",
      }),
    ]);
    expect(notifyOfficialAccountBusinessEventSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 10,
        eventCode: "construction_daily_report_created",
        targetId: "1",
      })
    );
  });

  it.each(["omitted", "null", "blank"] as const)(
    "新建计划为%s时仍可保存，历史兼容为null",
    async mode => {
      const store = useDb();
      const optional =
        mode === "omitted"
          ? {}
          : { constructionPlan: mode === "null" ? null : " \n\t " };
      const result = await caller().saveReport({ ...input(), ...optional });
      expect(store.raw(result.id)).toMatchObject({
        constructionPlan: null,
        workContent: input().workContent,
        safetyNotes: input().safetyNotes,
        issueNotes: input().issueNotes,
      });
    }
  );

  it.each(["listReports", "printReports", "exportReports"] as const)(
    "%s实际投影返回计划/历史null，原有业务字段和审核人显示名不变",
    async method => {
      useDb([
        report(),
        report({ id: 72, constructionPlan: null }),
        report({ id: 73, projectId: 20 }),
      ]);
      const rows = await caller()[method]({ projectId: 10 });
      expect(rows).toHaveLength(2);
      expect(rows.find(row => row.id === 71)).toEqual({
        ...report(),
        createdByName: "现场填报人",
        reviewedByName: "项目主管",
      });
      expect(rows.find(row => row.id === 72)).toMatchObject({
        constructionPlan: null,
      });
      expect(assertDepartmentBusinessAccess).toHaveBeenCalledWith(
        expect.anything(),
        "CONSTRUCTION",
        method === "listReports"
          ? "read"
          : method === "printReports"
            ? "print"
            : "export"
      );
      expect(assertProjectInCurrentScope).toHaveBeenCalledWith(
        expect.anything(),
        10
      );
    }
  );

  it("计划中的字面通配符关键词被真实SQL检索，列表/统计/打印/导出/清单仍限定项目", async () => {
    const needle = "%_\\放样";
    useDb([
      report({ constructionPlan: `前缀${needle}后缀` }),
      report({ id: 72, constructionPlan: "其他计划放样" }),
      report({ id: 73, constructionPlan: needle, projectId: 20 }),
    ]);
    const filter = { projectId: 10, keyword: ` ${needle} ` };
    const api = caller();
    expect((await api.listReports(filter)).map(row => row.id)).toEqual([71]);
    expect((await api.printReports(filter)).map(row => row.id)).toEqual([71]);
    expect((await api.exportReports(filter)).map(row => row.id)).toEqual([71]);
    expect(await api.summary(filter)).toMatchObject({
      total: 1,
      draft: 1,
      issues: 1,
      unreplied: 0,
      averageProgressPercent: 35.5,
    });
    expect(
      (
        await api.outputManifest({ ...filter, action: "export" })
      ).batches.flatMap(batch => batch.ids)
    ).toEqual([71]);
  });

  it("显式更新施工计划只改变计划，正文及原审核信息不被覆盖", async () => {
    const store = useDb([report()]);
    const before = { ...store.raw() };
    expect(
      await caller().saveReport({
        ...input(),
        id: 71,
        constructionPlan: "  更新后先检测，再组织摊铺。  ",
      })
    ).toEqual({ id: 71, updated: true });
    expect(store.raw()).toEqual({
      ...before,
      constructionPlan: "更新后先检测，再组织摊铺。",
    });
    expect(store.audits()).toEqual([
      expect.objectContaining({
        action: "update_daily_report",
        targetId: "71",
      }),
    ]);
  });

  it.each(["draft", "rejected"])(
    "更新%s日报省略计划不覆盖原计划，原退回重提逻辑不变",
    async status => {
      const store = useDb([report({ status })]);
      const before = { ...store.raw() };
      await caller().saveReport({ ...input(), id: 71 });
      expect(store.raw()).toEqual({
        ...before,
        ...(status === "rejected"
          ? {
              status: "draft",
              reviewReply: null,
              reviewedBy: null,
              reviewedAt: null,
            }
          : {}),
        constructionPlan: originalPlan,
      });
    }
  );

  it.each([null, " \n\t "])(
    "更新显式计划%j可清空，其他业务内容不变",
    async constructionPlan => {
      const store = useDb([report()]);
      const before = { ...store.raw() };
      await caller().saveReport({ ...input(), id: 71, constructionPlan });
      expect(store.raw()).toEqual({ ...before, constructionPlan: null });
      expect(
        (await caller().listReports({ projectId: 10 }))[0].constructionPlan
      ).toBeNull();
    }
  );

  it("计划8000字符边界可保存，trim后按实际长度校验", async () => {
    const store = useDb();
    const plan = "计".repeat(8000);
    const saved = await caller().saveReport({
      ...input(),
      constructionPlan: ` \n${plan}\t `,
    });
    expect(store.raw(saved.id)).toMatchObject({ constructionPlan: plan });
  });

  it.each(["create", "update"])(
    "%s计划超过8000字符在读写库前拒绝",
    async operation => {
      const store = useDb([report()]);
      const before = { ...store.raw() };
      await expect(
        caller().saveReport({
          ...input(),
          ...(operation === "update" ? { id: 71 } : {}),
          constructionPlan: "计".repeat(8001),
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(getDb).not.toHaveBeenCalled();
      expect(store.db.insert).not.toHaveBeenCalled();
      expect(store.db.update).not.toHaveBeenCalled();
      expect(store.raw()).toEqual(before);
    }
  );

  it.each(["role", "module", "project"])(
    "新增计划不能绕过%s权限且拒绝发生于读写库前",
    async restriction => {
      const store = useDb();
      if (restriction === "role")
        vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["ACCOUNTANT"]);
      if (restriction === "module")
        vi.mocked(assertDepartmentBusinessAccess).mockRejectedValue(
          new TRPCError({ code: "FORBIDDEN" })
        );
      if (restriction === "project")
        vi.mocked(assertProjectInCurrentScope).mockRejectedValue(
          new TRPCError({ code: "FORBIDDEN" })
        );
      await expect(
        caller(context(1, "user")).saveReport({
          ...input(),
          constructionPlan: originalPlan,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(getDb).not.toHaveBeenCalled();
      expect(store.db.insert).not.toHaveBeenCalled();
    }
  );

  it.each(["listReports", "printReports", "exportReports"] as const)(
    "%s仍独立校验操作权限，不能因新字段绕过",
    async method => {
      const store = useDb([report()]);
      vi.mocked(assertDepartmentBusinessAccess).mockRejectedValue(
        new TRPCError({ code: "FORBIDDEN" })
      );
      await expect(caller()[method]({ projectId: 10 })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(getDb).not.toHaveBeenCalled();
      expect(store.db.select).not.toHaveBeenCalled();
    }
  );

  it("普通管理人员不能通过带计划的历史更新改写他人记录", async () => {
    const store = useDb([report({ createdBy: 2 })]);
    await expect(
      caller(context(1, "user")).saveReport({
        ...input(),
        id: 71,
        constructionPlan: "试图改写历史计划",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(store.db.update).not.toHaveBeenCalled();
    expect(store.raw()).toMatchObject({ constructionPlan: originalPlan });
  });

  it.each(["submitted", "approved", "locked"])(
    "%s日报即使超级管理员也不能修改计划及其他业务内容",
    async status => {
      const store = useDb([report({ status })]);
      const before = { ...store.raw() };
      await expect(
        caller().saveReport({ ...input(), id: 71, constructionPlan: null })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(store.db.update).not.toHaveBeenCalled();
      expect(store.db.insert).not.toHaveBeenCalled();
      expect(store.raw()).toEqual(before);
    }
  );

  it("现有日报属于其他项目时无法通过计划更新跨项目写入", async () => {
    const store = useDb([report({ projectId: 20 })]);
    const before = { ...store.raw() };
    await expect(
      caller().saveReport({
        ...input(),
        id: 71,
        constructionPlan: originalPlan,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(store.db.update).not.toHaveBeenCalled();
    expect(store.raw()).toEqual(before);
  });

  it("写入前并发转为提交状态，状态条件保护仍拒绝计划覆盖且不追加审计", async () => {
    const store = useDb([report()]);
    store.beforeNextUpdate(() =>
      store.memory.exec(
        "UPDATE construction_daily_reports SET status='submitted' WHERE id=71"
      )
    );
    await expect(
      caller().saveReport({
        ...input(),
        id: 71,
        constructionPlan: "并发尝试替换计划",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(store.raw()).toMatchObject({
      status: "submitted",
      constructionPlan: originalPlan,
    });
    expect(store.audits()).toEqual([]);
    expect(notifyOfficialAccountBusinessEventSafely).not.toHaveBeenCalled();
  });

  it.each(["confirm", "return"] as const)(
    "有效项目主管%s仍走原审核逻辑并保留计划和其他业务字段",
    async decision => {
      const store = useDb([
        report({
          status: "submitted",
          reviewReply: null,
          reviewedBy: null,
          reviewedAt: null,
        }),
      ]);
      const before = { ...store.raw() };
      const status = decision === "confirm" ? "locked" : "rejected";
      const reply = "已核实施工记录，按原审核流程处理。";
      expect(
        await caller(context(3)).reviewReport({
          id: 71,
          projectId: 10,
          decision,
          reply,
        })
      ).toEqual({ success: true, status });
      expect(store.raw()).toEqual({
        ...before,
        status,
        reviewReply: reply,
        reviewedBy: 3,
        reviewedAt: expect.any(String),
      });
      expect(store.audits()).toEqual([
        expect.objectContaining({
          action:
            decision === "confirm"
              ? "confirm_and_archive_daily_report"
              : "return_daily_report",
          targetId: "71",
        }),
      ]);
      expect(createInAppMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientUserId: 2,
          eventCode: `construction_daily_report_${status}`,
        })
      );
    }
  );

  it("有review详细操作权限但不是当前项目主管，仍不能审核含计划日报", async () => {
    const store = useDb([report({ status: "submitted" })]);
    vi.mocked(getRoleOperationPermissionDecision).mockResolvedValue({
      hasDetailedPermissions: true,
      allowed: true,
    });
    const before = { ...store.raw() };
    await expect(
      caller(context(1, "user")).reviewReport({
        id: 71,
        projectId: 10,
        decision: "confirm",
        reply: "越权审核尝试",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(store.db.update).not.toHaveBeenCalled();
    expect(store.raw()).toEqual(before);
  });

  it("已归档终态无法回退，审核和计划内容保持不变", async () => {
    const store = useDb([report({ status: "locked" })]);
    const before = { ...store.raw() };
    await expect(
      caller().transitionReport({ id: 71, projectId: 10, nextStatus: "draft" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller(context(3)).reviewReport({
        id: 71,
        projectId: 10,
        decision: "return",
        reply: "尝试退回已归档日报",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(store.db.update).not.toHaveBeenCalled();
    expect(store.raw()).toEqual(before);
  });
});

describe("显式问题等级与历史安全原文：真实 scoped caller", () => {
  it.each([
    { patch: {}, priority: "normal" },
    { patch: { issuePriority: "urgent" as const }, priority: "urgent" },
    { patch: { issuePriority: "normal" as const }, priority: "normal" },
    { patch: { issuePriority: null }, priority: null },
    {
      patch: { issueNotes: null, issuePriority: "urgent" as const },
      priority: null,
    },
    {
      patch: { issueNotes: " \t\n", issuePriority: "normal" as const },
      priority: null,
    },
    {
      patch: { issueNotes: undefined, issuePriority: "urgent" as const },
      priority: null,
    },
  ])(
    "新建patch=$patch仅真实问题保存显式等级$priority",
    async ({ patch, priority }) => {
      const store = useDb();
      const saved = await caller(context(1, "user")).saveReport({
        ...input(),
        ...patch,
      });
      expect(store.raw(saved.id)).toMatchObject({
        issuePriority: priority,
        safetyNotes: input().safetyNotes,
        status: "draft",
      });
      expect(store.audits()).toHaveLength(1);
    }
  );
  it("自由文字含紧急/整改仍默认一般，只有显式urgent才为紧急", async () => {
    const store = useDb();
    const saved = await caller().saveReport({
      ...input(),
      issueNotes: "紧急待处理，随后完成整改",
      safetyNotes: undefined,
    });
    expect(store.raw(saved.id)).toMatchObject({
      issuePriority: "normal",
      safetyNotes: null,
      status: "draft",
    });
  });
  it.each(["urgent", "normal", null] as const)(
    "编辑省略等级和安全字段保留旧等级%s及逐字安全原文",
    async issuePriority => {
      const safetyNotes = " \n历史安全原文  不得被新表单删除\t";
      const store = useDb([report({ issuePriority, safetyNotes })]);
      const before = { ...store.raw() };
      await caller().saveReport({ ...input(), id: 71, safetyNotes: undefined });
      expect(store.raw()).toEqual(before);
      expect(store.audits()).toHaveLength(1);
    }
  );
  it.each([
    {
      patch: { issuePriority: null },
      priority: null,
      notes: input().issueNotes,
    },
    {
      patch: { issuePriority: "normal" as const },
      priority: "normal",
      notes: input().issueNotes,
    },
    { patch: { issueNotes: null }, priority: null, notes: null },
    {
      patch: { issueNotes: " \n\t", issuePriority: "urgent" as const },
      priority: null,
      notes: null,
    },
  ])(
    "编辑显式NULL/等级或清空问题 $patch",
    async ({ patch, priority, notes }) => {
      const store = useDb([report({ issuePriority: "urgent" })]);
      const before = { ...store.raw() };
      await caller().saveReport({
        ...input(),
        id: 71,
        safetyNotes: undefined,
        ...patch,
      });
      expect(store.raw()).toEqual({
        ...before,
        issueNotes: notes,
        issuePriority: priority,
      });
    }
  );
  it.each([null, "旧客户端显式修改的安全说明"])(
    "旧客户端显式安全字段%j继续兼容",
    async safetyNotes => {
      const store = useDb([report({ issuePriority: "urgent" })]);
      const before = { ...store.raw() };
      await caller().saveReport({ ...input(), id: 71, safetyNotes });
      expect(store.raw()).toEqual({ ...before, safetyNotes });
    }
  );
  it.each(["critical", "all", "unclassified", "", 1, {}])(
    "拒绝非法等级%j，发生于读取与写入前",
    async issuePriority => {
      const store = useDb([report()]);
      const before = { ...store.raw() };
      await expect(
        caller().saveReport({ ...input(), issuePriority } as never)
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(getDb).not.toHaveBeenCalled();
      expect(store.db.insert).not.toHaveBeenCalled();
      expect(store.db.update).not.toHaveBeenCalled();
      expect(store.raw()).toEqual(before);
    }
  );
  it("普通用户不能以新等级字段绕过历史编辑权限", async () => {
    const store = useDb([report({ issuePriority: null })]);
    const before = { ...store.raw() };
    await expect(
      caller(context(1, "user")).saveReport({
        ...input(),
        id: 71,
        issuePriority: "urgent",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(store.raw()).toEqual(before);
    expect(store.db.update).not.toHaveBeenCalled();
  });
  it.each(["submitted", "approved", "locked"])(
    "等级编辑不能改变%s状态锁定",
    async status => {
      const store = useDb([report({ status, issuePriority: "urgent" })]);
      const before = { ...store.raw() };
      await expect(
        caller().saveReport({ ...input(), id: 71, issuePriority: "normal" })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(store.raw()).toEqual(before);
      expect(store.audits()).toEqual([]);
    }
  );
  it("并发状态CAS冲突不写入等级也不追加审计", async () => {
    const store = useDb([report({ issuePriority: "normal" })]);
    store.beforeNextUpdate(() =>
      store.memory.exec(
        "UPDATE construction_daily_reports SET status='submitted' WHERE id=71"
      )
    );
    await expect(
      caller().saveReport({ ...input(), id: 71, issuePriority: "urgent" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(store.raw()).toMatchObject({
      issuePriority: "normal",
      status: "submitted",
    });
    expect(store.audits()).toEqual([]);
  });
});

describe("编辑问题原文省略与等级联动", () => {
  it("同时省略问题、安全及等级字段逐字保留历史原文与urgent", async () => {
    const store = useDb([
      report({
        issueNotes: " \n历史问题原文\t",
        safetyNotes: " \n历史安全原文\t",
        issuePriority: "urgent",
      }),
    ]);
    const before = { ...store.raw() };
    await caller().saveReport({
      ...input(),
      id: 71,
      issueNotes: undefined,
      safetyNotes: undefined,
    });
    expect(store.raw()).toEqual(before);
  });
  it("省略问题原文但显式传入NULL等级保留正文与安全，保持未分级", async () => {
    const store = useDb([report({ issuePriority: "urgent" })]);
    const before = { ...store.raw() };
    await caller().saveReport({
      ...input(),
      id: 71,
      issueNotes: undefined,
      safetyNotes: undefined,
      issuePriority: null,
    });
    expect(store.raw()).toEqual({ ...before, issuePriority: null });
  });
  it("历史问题为空即使省略正文并显式urgent也不能产生孤立等级", async () => {
    const store = useDb([report({ issueNotes: " \t\n", issuePriority: null })]);
    const before = { ...store.raw() };
    await caller().saveReport({
      ...input(),
      id: 71,
      issueNotes: undefined,
      safetyNotes: undefined,
      issuePriority: "urgent",
    });
    expect(store.raw()).toEqual(before);
  });
});
