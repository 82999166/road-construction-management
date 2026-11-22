import type {
  DatabaseSync as MemoryDatabase,
  SQLInputValue,
} from "node:sqlite";
import { createRequire } from "node:module";
import { getTableName, sql, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import { format as formatMysql } from "mysql2";
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
  issuePriority: "normal" | "urgent" | null;
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
  issuePriority: null,
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
    workContent TEXT, constructionPlan TEXT, safetyNotes TEXT, issueNotes TEXT, issuePriority TEXT, progressPercent TEXT DEFAULT '25', status TEXT,
    createdBy INTEGER, reviewReply TEXT, reviewedBy INTEGER DEFAULT 3, reviewedAt TEXT,
    createdAt TEXT DEFAULT '2026-10-15', updatedAt TEXT DEFAULT '2026-10-15');
    CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT);
    INSERT INTO users VALUES(2,'填报乙'),(3,'主管丙');`);
  const insert = memory.prepare(
    `INSERT INTO construction_daily_reports(id,projectId,reportDate,status,createdBy,workArea,workContent,safetyNotes,issueNotes,issuePriority,reviewReply) VALUES(?,?,?,?,?,?,?,?,?,?,?)`
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
      row.issuePriority,
      row.reviewReply
    )
  );
  const dialect = new MySqlDialect();
  const params = (values: unknown[]): SQLInputValue[] =>
    values.map(value =>
      value instanceof Date
        ? // 使用真实mysql2的+08:00参数编码，不能ISO.slice把日期筛选时区缺陷藏起来。
          formatMysql("?", [value], false, "+08:00").slice(1, -1)
        : (value as SQLInputValue)
    );
  const select = vi.fn((projection: Record<string, unknown>) => ({
    from(table: Parameters<typeof getTableName>[0]) {
      let predicate: SQL | undefined;
      let limit: number | undefined;
      let order: SQL[] = [];
      let group: SQL[] = [];
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
        if (group.length)
          query.append(sql` group by ${sql.join(group, sql`, `)}`);
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
        groupBy(...value: SQL[]) {
          group = value;
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
  it("DATE当天台账不能被mysql2北京时间参数移至08点排除，有问题日报仍保留", async () => {
    expect(
      formatMysql("?", [new Date("2026-11-22T00:00:00.000Z")], false, "+08:00")
    ).toBe("'2026-11-22 08:00:00.000'");
    const store = memoryDb([
      report(16, { reportDate: "2026-11-22", status: "draft" }),
      report(15, {
        reportDate: "2026-11-20",
        status: "draft",
        issueNotes: null,
      }),
      report(14, { reportDate: "2026-11-19", status: "locked" }),
      report(17, { reportDate: "2026-11-23" }),
      report(18, { reportDate: "2026-11-22", projectId: 20 }),
    ]);
    vi.mocked(getDb).mockResolvedValue(store.db as never);
    const caller = constructionRouter.createCaller(context);
    const filter = {
      projectId: 10,
      dateFrom: "2026-11-22",
      dateTo: "2026-11-22",
      createdBy: 2,
      keyword: "真实",
    };
    expect((await caller.listReports(filter)).map(row => row.id)).toEqual([16]);
    expect(await caller.summary(filter)).toMatchObject({
      total: 1,
      draft: 1,
      issues: 1,
    });
    expect((await caller.printReports(filter)).map(row => row.id)).toEqual([
      16,
    ]);
    expect((await caller.exportReports(filter)).map(row => row.id)).toEqual([
      16,
    ]);
    expect(
      (
        await caller.outputManifest({ ...filter, action: "export" })
      ).batches.flatMap(batch => batch.ids)
    ).toEqual([16]);
    expect(
      (await caller.listReports({ ...filter, dateTo: undefined })).map(
        row => row.id
      )
    ).toEqual([17, 16]);
    expect(
      (await caller.listReports({ ...filter, dateFrom: undefined })).map(
        row => row.id
      )
    ).toEqual([16, 15, 14]);
    expect(
      (await caller.listReports({ projectId: 10 })).map(row => row.id).sort()
    ).toEqual([14, 15, 16, 17]);
  });
  it.each([
    ["ledger", [9, 4, 3, 2, 1]],
    ["review", [9, 2]],
    ["archive", [3]],
    ["issues", [4, 3, 2, 1]],
  ] as const)(
    "%s栏目当天/管理员/关键词的五接口一致，不把问题记录从台账移走",
    async (scope, expected) => {
      const store = memoryDb([
        report(1, { reportDate: "2026-11-22", status: "draft" }),
        report(2, { reportDate: "2026-11-22" }),
        report(3, {
          reportDate: "2026-11-22",
          status: "locked",
          issueNotes: null,
          safetyNotes: "安全情况",
          reviewReply: "主管回复",
        }),
        report(4, {
          reportDate: "2026-11-22",
          status: "rejected",
          reviewReply: " \t\n",
        }),
        report(5, { reportDate: "2026-11-21" }),
        report(6, { reportDate: "2026-11-22", createdBy: 3 }),
        report(7, { reportDate: "2026-11-22", workContent: "其他正文" }),
        report(8, { reportDate: "2026-11-22", projectId: 20 }),
        report(9, {
          reportDate: "2026-11-22",
          issueNotes: " \t\n",
          safetyNotes: null,
        }),
      ]);
      vi.mocked(getDb).mockResolvedValue(store.db as never);
      const caller = constructionRouter.createCaller(context);
      const filter = {
        projectId: 10,
        scope,
        dateFrom: "2026-11-22",
        dateTo: "2026-11-22",
        createdBy: 2,
        keyword: "真实",
      };
      const list = await caller.listReports(filter);
      const summary = await caller.summary(filter);
      const printed = await caller.printReports(filter);
      const exported = await caller.exportReports(filter);
      const manifest = await caller.outputManifest({
        ...filter,
        action: "export",
      });
      expect(list.map(row => row.id).sort((a, b) => b - a)).toEqual(expected);
      expect(printed.map(row => row.id)).toEqual(expected);
      expect(exported.map(row => row.id)).toEqual(expected);
      expect(manifest.batches.flatMap(batch => batch.ids)).toEqual(expected);
      expect(summary.total).toBe(expected.length);
      expect(summary.issues).toBe(expected.filter(id => id !== 9).length);
      expect(summary.unreplied).toBe(
        expected.filter(id => id !== 9 && id !== 3).length
      );
      expect(summary.submitted).toBe(
        expected.filter(id => id === 9 || id === 2).length
      );
      expect(summary.locked).toBe(expected.some(id => id === 3) ? 1 : 0);
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

describe("问题等级五接口与真实作业面历史SQL", () => {
  function useReports(rows: Report[]) {
    const store = memoryDb(rows);
    vi.mocked(getDb).mockResolvedValue(store.db as never);
    return store;
  }
  it.each(["all", "urgent", "normal", "unclassified"] as const)(
    "等级%s五接口同口径含当天端点，安全-only/空白问题不产生等级",
    async issuePriority => {
      useReports([
        report(1, {
          reportDate: "2026-11-22",
          issuePriority: "urgent",
          issueNotes: "普通措辞问题",
        }),
        report(2, {
          reportDate: "2026-11-22",
          issuePriority: "normal",
          issueNotes: "紧急字样不推断，已整改不推断",
        }),
        report(3, { reportDate: "2026-11-22", issuePriority: null }),
        report(4, {
          reportDate: "2026-11-22",
          issueNotes: null,
          safetyNotes: "仅历史安全",
          issuePriority: "urgent",
        }),
        report(5, {
          reportDate: "2026-11-22",
          issueNotes: " \t\n",
          issuePriority: "normal",
        }),
        report(6, { reportDate: "2026-11-21", issuePriority: "urgent" }),
        report(7, { reportDate: "2026-11-23", issuePriority: "urgent" }),
        report(8, {
          reportDate: "2026-11-22",
          projectId: 20,
          issuePriority: "urgent",
        }),
        report(9, {
          reportDate: "2026-11-22",
          createdBy: 3,
          issuePriority: "urgent",
        }),
        report(10, {
          reportDate: "2026-11-22",
          workContent: "其他内容",
          issuePriority: "urgent",
        }),
      ]);
      const api = constructionRouter.createCaller(context);
      const filter = {
        projectId: 10,
        dateFrom: "2026-11-22",
        dateTo: "2026-11-22",
        createdBy: 2,
        keyword: "真实",
        issuePriority,
      };
      const expected = {
        all: [5, 4, 3, 2, 1],
        urgent: [1],
        normal: [2],
        unclassified: [3],
      }[issuePriority];
      const list = await api.listReports(filter);
      const printed = await api.printReports(filter);
      const exported = await api.exportReports(filter);
      const manifest = await api.outputManifest({
        ...filter,
        action: "export",
      });
      const summary = await api.summary(filter);
      expect(list.map(row => row.id).sort((a, b) => b - a)).toEqual(expected);
      expect(printed.map(row => row.id)).toEqual(expected);
      expect(exported.map(row => row.id)).toEqual(expected);
      expect(manifest.batches.flatMap(batch => batch.ids)).toEqual(expected);
      expect(summary).toMatchObject({
        total: expected.length,
        urgentIssues: expected.includes(1) ? 1 : 0,
        normalIssues: expected.includes(2) ? 1 : 0,
        unclassifiedIssues: expected.includes(3) ? 1 : 0,
      });
      for (const row of printed)
        expect(exported.find(item => item.id === row.id)?.issuePriority).toBe(
          row.issuePriority
        );
      expect(exported.find(row => row.id === 3)?.issuePriority).toBe(
        issuePriority === "all" || issuePriority === "unclassified"
          ? null
          : undefined
      );
    }
  );
  it.each(["print", "export"] as const)(
    "等级变更使%s原清单批次明确CONFLICT",
    async action => {
      const store = useReports([report(1, { issuePriority: "urgent" })]);
      const api = constructionRouter.createCaller(context);
      const filter = { projectId: 10, issuePriority: "urgent" as const };
      const manifest = await api.outputManifest({ ...filter, action });
      store.memory.exec(
        "UPDATE construction_daily_reports SET issuePriority='normal' WHERE id=1"
      );
      await expect(
        api[action === "print" ? "printReports" : "exportReports"]({
          ...filter,
          reportIds: manifest.batches[0].ids,
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
    }
  );
  it.each([
    "listReports",
    "summary",
    "printReports",
    "exportReports",
    "outputManifest",
  ] as const)("%s非法等级筛选在读取前拒绝", async method => {
    const store = useReports([]);
    await expect(
      constructionRouter
        .createCaller(context)
        [
          method
        ]({ projectId: 10, issuePriority: "critical", action: "export" } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(getDb).not.toHaveBeenCalled();
    expect(store.select).not.toHaveBeenCalled();
  });
  it("真实历史跨日期、状态、提交人去重，使用次数优先及最近日报日排序，仅当前项目", async () => {
    useReports([
      report(1, {
        workArea: "常用工区",
        reportDate: "2026-01-01",
        status: "locked",
      }),
      report(2, {
        workArea: "常用工区",
        reportDate: "2026-01-02",
        createdBy: 3,
      }),
      report(3, {
        workArea: "常用工区",
        reportDate: "2026-01-03",
        status: "rejected",
      }),
      report(4, { workArea: "最近工区", reportDate: "2026-11-22" }),
      report(5, { workArea: "最近工区", reportDate: "2026-11-21" }),
      report(6, { workArea: "旧日工区", reportDate: "2026-06-01" }),
      report(7, { workArea: "旧日工区", reportDate: "2026-05-01" }),
      report(8, {
        workArea: "常用工区",
        projectId: 20,
        reportDate: "2026-11-23",
      }),
      report(9, { workArea: "跨项目不可见", projectId: 20 }),
      report(10, { workArea: " \t\n" }),
    ]);
    const result = await constructionRouter
      .createCaller(context)
      .workAreaOptions({ projectId: 10 });
    expect(result).toEqual({
      items: [
        { workArea: "常用工区", useCount: 3, lastUsedAt: "2026-01-03" },
        { workArea: "最近工区", useCount: 2, lastUsedAt: "2026-11-22" },
        { workArea: "旧日工区", useCount: 2, lastUsedAt: "2026-06-01" },
      ],
    });
    expect(assertDepartmentBusinessAccess).toHaveBeenCalledWith(
      expect.anything(),
      "CONSTRUCTION",
      "read"
    );
    expect(assertProjectInCurrentScope).toHaveBeenCalledWith(
      expect.anything(),
      10
    );
    result.items.forEach(row =>
      expect(Object.keys(row).sort()).toEqual([
        "lastUsedAt",
        "useCount",
        "workArea",
      ])
    );
  });
  it("历史最多30个真实选项，按次数与最近日选择，不制造空历史演示项", async () => {
    useReports(
      Array.from({ length: 35 }, (_, index) =>
        report(index + 1, {
          workArea: `作业面${String(index).padStart(2, "0")}`,
          reportDate: index >= 30 ? "2026-11-22" : "2026-01-01",
        })
      )
    );
    const api = constructionRouter.createCaller(context);
    const result = await api.workAreaOptions({ projectId: 10 });
    expect(result.items).toHaveLength(30);
    expect(new Set(result.items.map(row => row.workArea)).size).toBe(30);
    expect(result.items.slice(0, 5).map(row => row.workArea)).toEqual([
      "作业面30",
      "作业面31",
      "作业面32",
      "作业面33",
      "作业面34",
    ]);
    expect(await api.workAreaOptions({ projectId: 99 })).toEqual({ items: [] });
  });
  it("历史关键词百分号/下划线/反斜杠按字面查找，200字符有效而201拒绝", async () => {
    const needle = "%_\\工区";
    useReports([
      report(1, { workArea: `前缀${needle}尾部` }),
      report(2, { workArea: "任意工区" }),
      report(3, { workArea: needle, projectId: 20 }),
      report(4, { workArea: "区".repeat(200) }),
    ]);
    const api = constructionRouter.createCaller(context);
    expect(
      await api.workAreaOptions({ projectId: 10, keyword: ` ${needle} ` })
    ).toEqual({
      items: [
        {
          workArea: `前缀${needle}尾部`,
          useCount: 1,
          lastUsedAt: "2026-10-15",
        },
      ],
    });
    expect(
      (await api.workAreaOptions({ projectId: 10, keyword: "区".repeat(200) }))
        .items
    ).toHaveLength(1);
    vi.mocked(getDb).mockClear();
    await expect(
      api.workAreaOptions({ projectId: 10, keyword: "区".repeat(201) })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(getDb).not.toHaveBeenCalled();
  });
  it.each(["role", "module", "project"])(
    "历史%s越权在读取前拒绝",
    async restriction => {
      const store = useReports([report(1)]);
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
        constructionRouter
          .createCaller(context)
          .workAreaOptions({ projectId: 10 })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(getDb).not.toHaveBeenCalled();
      expect(store.select).not.toHaveBeenCalled();
    }
  );
});
