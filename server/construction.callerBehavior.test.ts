import type {
  DatabaseSync as MemoryDatabase,
  SQLInputValue,
} from "node:sqlite";
import { createRequire } from "node:module";
import { getTableName, sql, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./access", async original => ({
  ...(await original<typeof import("./access")>()),
  assertDepartmentBusinessAccess: vi.fn(),
  assertProjectInCurrentScope: vi.fn(),
  getEffectiveRoleCodes: vi.fn(),
  getSuperAdminAccess: vi.fn(),
}));
vi.mock("./services/businessNotifier", () => ({
  notifyOfficialAccountBusinessEventSafely: vi.fn(),
}));
vi.mock("./routers/messages", () => ({ createInAppMessage: vi.fn() }));
import { getDb } from "./db";
import {
  assertDepartmentBusinessAccess,
  assertProjectInCurrentScope,
  getEffectiveRoleCodes,
  getSuperAdminAccess,
} from "./access";
import { constructionRouter } from "./routers/construction";
const context = {
  user: { id: 1, role: "user", loginMethod: "manus" },
  req: {},
  res: {},
} as TrpcContext;
interface Report {
  id: number;
  projectId: number;
  reportDate: string;
  status: string;
  createdBy: number;
  workArea: string;
  workContent: string;
  safetyNotes: string | null;
  issueNotes: string | null;
  reviewReply: string | null;
}
const report = (id: number, patch: Partial<Report> = {}): Report => ({
  id,
  projectId: 10,
  reportDate: "2026-10-15",
  status: "submitted",
  createdBy: 2,
  workArea: `工区${id}`,
  workContent: "真实施工正文",
  safetyNotes: null,
  issueNotes: "质量问题",
  reviewReply: null,
  ...patch,
});
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite"
) as typeof import("node:sqlite");
const stores: MemoryDatabase[] = [];
/** 只使用:memory:。MySQL编译SQL实际执行而非按测试预期过滤；仅补齐SQLite方言函数和LIKE转义。 */
function memoryDb(records: Report[]) {
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
  memory.exec(`CREATE TABLE construction_daily_reports (
    id INTEGER PRIMARY KEY, projectId INTEGER, reportDate TEXT, workArea TEXT, weather TEXT DEFAULT 'sunny',
    workContent TEXT, safetyNotes TEXT, issueNotes TEXT, progressPercent TEXT DEFAULT '25', status TEXT,
    createdBy INTEGER, reviewReply TEXT, reviewedBy INTEGER DEFAULT 3, reviewedAt TEXT,
    createdAt TEXT DEFAULT '2026-10-15', updatedAt TEXT DEFAULT '2026-10-15');
    CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT);
    INSERT INTO users VALUES(2,'填报乙'),(3,'主管丙');`);
  const insert = memory.prepare(
    `INSERT INTO construction_daily_reports(id,projectId,reportDate,status,createdBy,workArea,workContent,safetyNotes,issueNotes,reviewReply) VALUES(?,?,?,?,?,?,?,?,?,?)`
  );
  records.forEach(row =>
    insert.run(
      row.id,
      row.projectId,
      row.reportDate,
      row.status,
      row.createdBy,
      row.workArea,
      row.workContent,
      row.safetyNotes,
      row.issueNotes,
      row.reviewReply
    )
  );
  const dialect = new MySqlDialect();
  const params = (values: unknown[]): SQLInputValue[] =>
    values.map(value =>
      value instanceof Date
        ? value.toISOString().slice(0, 10)
        : (value as SQLInputValue)
    );
  const select = vi.fn((projection: Record<string, unknown>) => ({
    from(table: Parameters<typeof getTableName>[0]) {
      let predicate: SQL | undefined;
      let limit: number | undefined;
      let order: SQL[] = [];
      let join = false;
      const execute = () => {
        const expressions = Object.entries(projection).map(
          ([name, value]) => sql`${value as SQL} as ${sql.identifier(name)}`
        );
        let query = sql`select ${sql.join(expressions, sql`, `)} from ${sql.identifier(getTableName(table))}`;
        if (join)
          query.append(
            sql` left join users on construction_daily_reports.createdBy = users.id`
          );
        if (predicate) query.append(sql` where ${predicate}`);
        if (order.length)
          query.append(sql` order by ${sql.join(order, sql`, `)}`);
        if (limit) query.append(sql` limit ${limit}`);
        const compiled = dialect.sqlToQuery(query);
        // MySQL LIKE反斜杠默认转义；SQLite需要显式ESCAPE。
        const statement = compiled.sql.replace(
          /like \?/gi,
          "like ? ESCAPE '\\'"
        );
        return memory.prepare(statement).all(...params(compiled.params));
      };
      const chain = {
        leftJoin() {
          join = true;
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
        then(resolve: (rows: unknown[]) => unknown) {
          return Promise.resolve().then(execute).then(resolve);
        },
      };
      return chain;
    },
  }));
  return { memory, select, db: { select } };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertDepartmentBusinessAccess).mockResolvedValue({
    departments: [],
    moduleCodes: ["CONSTRUCTION"],
    hasAllDepartments: false,
  });
  vi.mocked(assertProjectInCurrentScope).mockResolvedValue();
  vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["CONSTRUCTION_MANAGER"]);
  vi.mocked(getSuperAdminAccess).mockResolvedValue({
    user: context.user!,
    canAccess: false,
  });
});
afterEach(() => {
  stores.splice(0).forEach(store => store.close());
});
describe("施工真实路由调用与内存SQL筛选结果（不连接实际DB）", () => {
  it.each(["print", "export"] as const)(
    "501份%s从清单到三个实际调用覆盖完全相同ID与总数",
    async action => {
      const store = memoryDb(
        Array.from({ length: 501 }, (_, i) => report(i + 1))
      );
      vi.mocked(getDb).mockResolvedValue(store.db as never);
      const caller = constructionRouter.createCaller(context);
      const filter = {
        projectId: 10,
        scope: "review" as const,
        dateFrom: "2026-10-01",
        dateTo: "2026-10-31",
        createdBy: 2,
        keyword: "真实",
      };
      const list = await caller.listReports(filter);
      const summary = await caller.summary(filter);
      const manifest = await caller.outputManifest({ ...filter, action });
      expect(list).toHaveLength(501);
      expect(summary).toMatchObject({
        total: 501,
        submitted: 501,
        issues: 501,
        unreplied: 501,
      });
      expect(manifest.total).toBe(501);
      expect(manifest.generatedAt).toBeInstanceOf(Date);
      expect(
        manifest.batches.map(batch => [batch.from, batch.to, batch.ids.length])
      ).toEqual([
        [1, 250, 250],
        [251, 500, 250],
        [501, 501, 1],
      ]);
      const output = [];
      for (const batch of manifest.batches)
        output.push(
          ...(await caller[
            action === "print" ? "printReports" : "exportReports"
          ]({ ...filter, reportIds: batch.ids }))
        );
      expect(output.map(row => row.id)).toEqual(
        manifest.batches.flatMap(batch => batch.ids)
      );
      expect(new Set(output.map(row => row.id)).size).toBe(summary.total);
      expect(output[0]).toMatchObject({
        createdByName: "填报乙",
        reviewedByName: "主管丙",
      });
      await expect(
        caller[action === "print" ? "printReports" : "exportReports"](filter)
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  );
  it.each([
    "quality",
    "safety",
    "unreplied",
    "replied",
    "all",
    "recorded",
  ] as const)(
    "问题scope=%s五接口实际筛出同一集合，空白回复不当闭环",
    async issueScope => {
      const store = memoryDb([
        report(1),
        report(2, {
          issueNotes: null,
          safetyNotes: "安全隐患",
          reviewReply: "主管已回复",
          status: "locked",
        }),
        report(3, {
          issueNotes: "  ",
          safetyNotes: "\t ",
          reviewReply: "只有回复，无原问题",
        }),
        report(4, {
          safetyNotes: "安全情况",
          reviewReply: "  ",
          status: "rejected",
        }),
        report(5, { projectId: 20 }),
      ]);
      vi.mocked(getDb).mockResolvedValue(store.db as never);
      const caller = constructionRouter.createCaller(context);
      const filter = { projectId: 10, scope: "issues" as const, issueScope };
      const expected = {
        quality: [4, 1],
        safety: [4, 2],
        unreplied: [4, 1],
        replied: [2],
        all: [4, 2, 1],
        recorded: [4, 2, 1],
      }[issueScope];
      const manifest = await caller.outputManifest({
        ...filter,
        action: "export",
      });
      const list = await caller.listReports(filter);
      const summary = await caller.summary(filter);
      const printed = await caller.printReports(filter);
      const exported = await caller.exportReports(filter);
      expect(list.map(row => row.id).sort((a, b) => b - a)).toEqual(expected);
      expect(summary.total).toBe(expected.length);
      expect(printed.map(row => row.id)).toEqual(expected);
      expect(exported.map(row => row.id)).toEqual(expected);
      expect(manifest.batches.flatMap(batch => batch.ids)).toEqual(expected);
      if (issueScope === "replied") expect(exported[0].status).toBe("locked");
    }
  );
  it.each([
    "workArea",
    "workContent",
    "safetyNotes",
    "issueNotes",
    "reviewReply",
  ] as const)(
    "关键词真实命中%s，百分号下划线反斜杠必须当字面文本",
    async field => {
      const needle = "%_\\整改";
      const store = memoryDb([
        report(1, { [field]: `前缀${needle}尾部` }),
        report(2, { [field]: "任意内容整改" }),
        report(3, { [field]: needle, projectId: 20 }),
      ]);
      vi.mocked(getDb).mockResolvedValue(store.db as never);
      const caller = constructionRouter.createCaller(context);
      const filter = { projectId: 10, keyword: `  ${needle}  ` };
      expect((await caller.listReports(filter)).map(row => row.id)).toEqual([
        1,
      ]);
      expect((await caller.summary(filter)).total).toBe(1);
      expect((await caller.printReports(filter)).map(row => row.id)).toEqual([
        1,
      ]);
      expect((await caller.exportReports(filter)).map(row => row.id)).toEqual([
        1,
      ]);
      expect(
        (
          await caller.outputManifest({ ...filter, action: "export" })
        ).batches.flatMap(batch => batch.ids)
      ).toEqual([1]);
    }
  );
  it("日期含端点、提交人和栏目/status交集实际生效，不能扩大范围", async () => {
    const store = memoryDb([
      report(1, { reportDate: "2026-10-01" }),
      report(2, { reportDate: "2026-10-31" }),
      report(3, { reportDate: "2026-11-01" }),
      report(4, { createdBy: 3 }),
      report(5, { status: "locked" }),
    ]);
    vi.mocked(getDb).mockResolvedValue(store.db as never);
    const caller = constructionRouter.createCaller(context);
    const filter = {
      projectId: 10,
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
      createdBy: 2,
      scope: "review" as const,
    };
    expect(
      (await caller.listReports(filter)).map(row => row.id).sort()
    ).toEqual([1, 2]);
    expect(
      (await caller.listReports({ ...filter, status: "draft" })).map(
        row => row.id
      )
    ).toEqual([]);
    expect(
      (await caller.listReports({ ...filter, scope: "archive" })).map(
        row => row.id
      )
    ).toEqual([5]);
  });
  it.each(["status", "keyword", "project", "delete"])(
    "清单后%s变化，单批实际ID交集读取明确CONFLICT",
    async change => {
      const store = memoryDb([report(1), report(2)]);
      vi.mocked(getDb).mockResolvedValue(store.db as never);
      const caller = constructionRouter.createCaller(context);
      const filter = {
        projectId: 10,
        scope: "review" as const,
        keyword: "真实",
      };
      const manifest = await caller.outputManifest({
        ...filter,
        action: "print",
      });
      const ids = manifest.batches[0].ids;
      if (change === "status")
        store.memory.exec(
          "UPDATE construction_daily_reports SET status='locked' WHERE id=1"
        );
      if (change === "keyword")
        store.memory.exec(
          "UPDATE construction_daily_reports SET workContent='已经改为其他内容' WHERE id=1"
        );
      if (change === "project")
        store.memory.exec(
          "UPDATE construction_daily_reports SET projectId=20 WHERE id=1"
        );
      if (change === "delete")
        store.memory.exec("DELETE FROM construction_daily_reports WHERE id=1");
      await expect(
        caller.printReports({ ...filter, reportIds: ids })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        caller.exportReports({ ...filter, reportIds: ids })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(
        (await caller.outputManifest({ ...filter, action: "print" })).total
      ).toBe(1);
    }
  );
  it("清单后新增/换号可从全量清单检测total/ids变化，不把相同批次数当快照一致", async () => {
    const store = memoryDb(
      Array.from({ length: 501 }, (_, i) => report(i + 1))
    );
    vi.mocked(getDb).mockResolvedValue(store.db as never);
    const caller = constructionRouter.createCaller(context);
    const original = await caller.outputManifest({
      projectId: 10,
      action: "export",
    });
    store.memory.exec(
      "UPDATE construction_daily_reports SET id=999 WHERE id=1"
    );
    const changed = await caller.outputManifest({
      projectId: 10,
      action: "export",
    });
    expect(changed.total).toBe(original.total);
    expect(changed.batches.flatMap(x => x.ids)).not.toEqual(
      original.batches.flatMap(x => x.ids)
    );
    store.memory.exec(
      "INSERT INTO construction_daily_reports(id,projectId,reportDate,status,createdBy,workArea,workContent) VALUES(1000,10,'2026-10-15','submitted',2,'新工区','新内容')"
    );
    expect(
      (await caller.outputManifest({ projectId: 10, action: "export" })).total
    ).toBe(502);
  });
  it.each(["role", "project", "print", "export"])(
    "清单后%s权限撤销再次拒绝，且拒绝在读取前",
    async revoked => {
      const store = memoryDb([report(1)]);
      vi.mocked(getDb).mockResolvedValue(store.db as never);
      const caller = constructionRouter.createCaller(context);
      await caller.outputManifest({ projectId: 10, action: "export" });
      store.select.mockClear();
      if (revoked === "role")
        vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["ACCOUNTANT"]);
      if (revoked === "project")
        vi.mocked(assertProjectInCurrentScope).mockRejectedValue(
          new TRPCError({ code: "FORBIDDEN" })
        );
      if (revoked === "print" || revoked === "export")
        vi.mocked(assertDepartmentBusinessAccess).mockImplementation(
          async (_ctx, _module, action) => {
            if (action === revoked) throw new TRPCError({ code: "FORBIDDEN" });
            return {
              departments: [],
              moduleCodes: ["CONSTRUCTION"],
              hasAllDepartments: false,
            };
          }
        );
      const action = revoked === "print" ? "print" : "export";
      await expect(
        caller.outputManifest({ projectId: 10, action })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller[action === "print" ? "printReports" : "exportReports"]({
          projectId: 10,
          reportIds: [1],
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(store.select).not.toHaveBeenCalled();
    }
  );
});
