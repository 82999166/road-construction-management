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
}));
vi.mock("./services/businessNotifier", () => ({
  notifyOfficialAccountBusinessEventSafely: vi.fn(),
}));
vi.mock("./routers/messages", () => ({ createInAppMessage: vi.fn() }));
vi.mock("./storage", () => ({ storageGetSignedUrl: vi.fn() }));

import { getDb } from "./db";
import {
  assertDepartmentBusinessAccess,
  assertProjectInCurrentScope,
  getEffectiveRoleCodes,
} from "./access";
import { storageGetSignedUrl } from "./storage";
import { constructionRouter } from "./routers/construction";

const context = {
  user: { id: 1, role: "user", loginMethod: "manus" },
  req: {},
  res: {},
} as TrpcContext;
const report = (id: number, patch: Record<string, SQLInputValue> = {}) => ({
  id,
  projectId: 10,
  reportDate: "2026-11-22",
  status: "submitted",
  createdBy: 2,
  workArea: `工区${id}`,
  workContent: "真实施工正文",
  constructionPlan: "历史计划",
  safetyNotes: "历史安全说明",
  issueNotes: "质量问题",
  issuePriority: "urgent",
  reviewReply: null,
  ...patch,
});
const photo = (
  id: number,
  reportId: number,
  patch: Record<string, SQLInputValue> = {}
) => ({
  id,
  projectId: 10,
  sourceType: "site_photo",
  sourceId: `construction-report-${reportId}`,
  fileKey: `private/evidence-${id}.jpg`,
  fileName: `现场照片${id}.jpg`,
  watermarkJson: JSON.stringify({ description: `影像说明${id}` }),
  capturedAt: "2026-11-22 08:30:00",
  createdAt: "2026-11-22 08:31:00",
  ...patch,
});

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite"
) as typeof import("node:sqlite");
const stores: MemoryDatabase[] = [];

/** 沿用施工callerBehavior测试方式：编译真实MySQL SQL并在:memory:执行，不按预期手工筛选。 */
function memoryDb(
  reports: ReturnType<typeof report>[],
  photos: ReturnType<typeof photo>[] = []
) {
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
    workContent TEXT, constructionPlan TEXT, safetyNotes TEXT, issueNotes TEXT, issuePriority TEXT,
    progressPercent TEXT DEFAULT '25', status TEXT, createdBy INTEGER, reviewReply TEXT,
    reviewedBy INTEGER DEFAULT 3, reviewedAt TEXT, createdAt TEXT DEFAULT '2026-11-22', updatedAt TEXT DEFAULT '2026-11-22');
    CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT);
    INSERT INTO users VALUES(2,'填报乙'),(3,'主管丙');
    CREATE TABLE evidence_records (
    id INTEGER PRIMARY KEY, projectId INTEGER, sourceType TEXT, sourceId TEXT,
    fileKey TEXT, fileName TEXT, watermarkJson TEXT, capturedAt TEXT, createdAt TEXT,
    url TEXT DEFAULT 'https://internal.example/original', original TEXT DEFAULT 'secret-original',
    ocrResultJson TEXT DEFAULT 'secret-ocr', longitude TEXT DEFAULT 'secret-location');`);
  const insert = (table: string, row: Record<string, SQLInputValue>) => {
    const keys = Object.keys(row);
    memory
      .prepare(
        `INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`
      )
      .run(...Object.values(row));
  };
  reports.forEach(row => insert("construction_daily_reports", row));
  photos.forEach(row => insert("evidence_records", row));
  const dialect = new MySqlDialect();
  const queries: Array<
    ReturnType<MySqlDialect["sqlToQuery"]> & { table: string }
  > = [];
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
        queries.push({ ...compiled, table: getTableName(table) });
        // 保留mysql2 +08:00 DATE参数编码，不能以ISO.slice隐藏日期筛选缺陷。
        const params = compiled.params.map(value =>
          value instanceof Date
            ? formatMysql("?", [value], false, "+08:00").slice(1, -1)
            : (value as SQLInputValue)
        );
        return memory
          .prepare(compiled.sql.replace(/like \?/gi, "like ? ESCAPE '\\'"))
          .all(...params);
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
        then(
          resolve: (rows: unknown[]) => unknown,
          reject: (reason: unknown) => unknown
        ) {
          return Promise.resolve().then(execute).then(resolve, reject);
        },
      };
      return chain;
    },
  }));
  const db = { select };
  vi.mocked(getDb).mockResolvedValue(db as never);
  return { memory, select, queries, db };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(assertDepartmentBusinessAccess).mockResolvedValue({
    departments: [],
    moduleCodes: ["CONSTRUCTION"],
    hasAllDepartments: false,
  });
  vi.mocked(assertProjectInCurrentScope).mockResolvedValue();
  vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["CONSTRUCTION_MANAGER"]);
  vi.mocked(storageGetSignedUrl).mockImplementation(
    async key => `/controlled/${key.split("/").pop()}`
  );
});
afterEach(() => {
  stores.splice(0).forEach(store => store.close());
});

const caller = () => constructionRouter.createCaller(context);
const evidenceQueries = (store: ReturnType<typeof memoryDb>) =>
  store.queries.filter(query => query.table === "evidence_records");

describe("施工打印影像真实caller授权与完整批次复核", () => {
  it("未登录请求在读取或签名前拒绝", async () => {
    const store = memoryDb([report(1)], [photo(1, 1)]);
    await expect(
      constructionRouter
        .createCaller({ ...context, user: null })
        .printEvidence({ projectId: 10, reportIds: [1] })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(store.select).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
    expect(storageGetSignedUrl).not.toHaveBeenCalled();
  });

  it.each(["print", "role", "project"])(
    "%s权限拒绝在读取前生效，read权限不能代替print",
    async restriction => {
      const store = memoryDb([report(1)], [photo(1, 1)]);
      if (restriction === "print")
        vi.mocked(assertDepartmentBusinessAccess).mockImplementation(
          async (_ctx, _module, action) => {
            if (action === "print") throw new TRPCError({ code: "FORBIDDEN" });
            return {
              departments: [],
              moduleCodes: ["CONSTRUCTION"],
              hasAllDepartments: false,
            };
          }
        );
      if (restriction === "role")
        vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["ACCOUNTANT"]);
      if (restriction === "project")
        vi.mocked(assertProjectInCurrentScope).mockRejectedValue(
          new TRPCError({ code: "FORBIDDEN" })
        );
      await expect(
        caller().printEvidence({ projectId: 10, reportIds: [1] })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(store.select).not.toHaveBeenCalled();
      expect(getDb).not.toHaveBeenCalled();
      expect(storageGetSignedUrl).not.toHaveBeenCalled();
      expect(assertDepartmentBusinessAccess).toHaveBeenCalledWith(
        expect.anything(),
        "CONSTRUCTION",
        "print"
      );
    }
  );

  it("传入另一个项目日报ID不能靠同项目影像伪造合法批次", async () => {
    const store = memoryDb([report(1, { projectId: 20 })], [photo(1, 1)]);
    await expect(
      caller().printEvidence({ projectId: 10, reportIds: [1] })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(evidenceQueries(store)).toEqual([]);
    expect(storageGetSignedUrl).not.toHaveBeenCalled();
  });

  it.each([
    "status",
    "keyword",
    "project",
    "delete",
    "grade",
    "date",
    "submitter",
  ])("清单后%s变化不得静默遗漏日报或签名残留照片", async change => {
    const store = memoryDb([report(1), report(2)], [photo(1, 1), photo(2, 2)]);
    const api = caller();
    const filter = {
      projectId: 10,
      scope: "review" as const,
      keyword: "真实",
      issuePriority: "urgent" as const,
      dateFrom: "2026-11-22",
      dateTo: "2026-11-22",
      createdBy: 2,
    };
    const manifest = await api.outputManifest({ ...filter, action: "print" });
    const changes: Record<string, string> = {
      status:
        "UPDATE construction_daily_reports SET status='locked' WHERE id=1",
      keyword:
        "UPDATE construction_daily_reports SET workContent='其他内容' WHERE id=1",
      project: "UPDATE construction_daily_reports SET projectId=20 WHERE id=1",
      delete: "DELETE FROM construction_daily_reports WHERE id=1",
      grade:
        "UPDATE construction_daily_reports SET issuePriority='normal' WHERE id=1",
      date: "UPDATE construction_daily_reports SET reportDate='2026-11-21' WHERE id=1",
      submitter: "UPDATE construction_daily_reports SET createdBy=3 WHERE id=1",
    };
    store.memory.exec(changes[change]);
    await expect(
      api.printEvidence({ ...filter, reportIds: manifest.batches[0].ids })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("未生成不完整批次"),
    });
    expect(evidenceQueries(store)).toEqual([]);
    expect(storageGetSignedUrl).not.toHaveBeenCalled();
  });

  it("250份批次完整返回真实排序日报ID和每份全部多图（750图不截断）", async () => {
    const ids = Array.from({ length: 250 }, (_, index) => index + 1);
    const photos = ids.flatMap(id =>
      [0, 1, 2].map(offset => photo(id * 3 + offset, id))
    );
    const store = memoryDb(
      ids.map(id => report(id)),
      photos
    );
    const output = await caller().printEvidence({
      projectId: 10,
      reportIds: ids,
    });
    expect(output.reportIds).toEqual([...ids].reverse());
    expect(output.photos).toHaveLength(750);
    for (const id of ids)
      expect(output.photos.filter(row => row.reportId === id)).toHaveLength(3);
    expect(storageGetSignedUrl).toHaveBeenCalledTimes(750);
    const query = evidenceQueries(store)[0];
    expect(query.params).toEqual([
      10,
      "site_photo",
      ...output.reportIds.map(id => `construction-report-${id}`),
    ]);
    expect(query.sql).not.toMatch(/limit/i);
    expect(store.queries[0].sql).toContain(" limit ?");
    expect(store.queries[0].params.at(-1)).toBe(251);
  });

  it("未传清单时报告ID来自当前完整授权输出，251份明确要求分批", async () => {
    const store = memoryDb(
      Array.from({ length: 251 }, (_, index) => report(index + 1)),
      [photo(1, 1)]
    );
    await expect(
      caller().printEvidence({ projectId: 10 })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("输出清单"),
    });
    expect(evidenceQueries(store)).toEqual([]);
    expect(storageGetSignedUrl).not.toHaveBeenCalled();
  });

  it.each([
    { projectId: 0 },
    { projectId: 10, reportIds: [] },
    { projectId: 10, reportIds: [1, 1] },
    { projectId: 10, reportIds: [0] },
    {
      projectId: 10,
      reportIds: Array.from({ length: 251 }, (_, index) => index + 1),
    },
    { projectId: 10, dateFrom: "2026-11-23", dateTo: "2026-11-22" },
    { projectId: 10, issuePriority: "critical" },
  ])("非法批次或过滤输入%j在读取前拒绝", async input => {
    const store = memoryDb([report(1)], [photo(1, 1)]);
    await expect(caller().printEvidence(input as never)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(getDb).not.toHaveBeenCalled();
    expect(store.select).not.toHaveBeenCalled();
    expect(storageGetSignedUrl).not.toHaveBeenCalled();
  });
});

describe("施工打印影像精确关联、稳定排序与安全投影", () => {
  it("只签名当前项目site_photo精确sourceId，拒绝前缀相似/外项目/其他业务照片", async () => {
    const store = memoryDb(
      [report(1), report(10), report(100, { projectId: 20 })],
      [
        photo(1, 1),
        photo(2, 10),
        photo(3, 100),
        photo(4, 1, { projectId: 20 }),
        photo(5, 1, { sourceType: "receipt" }),
        photo(6, 1, { sourceId: "construction-report-1-extra" }),
        photo(7, 1, { sourceId: "construction-report-01" }),
        photo(8, 1, { sourceId: "prefix-construction-report-1" }),
        photo(9, 1, { sourceId: null }),
      ]
    );
    const output = await caller().printEvidence({
      projectId: 10,
      reportIds: [1],
    });
    expect(output).toEqual({
      projectId: 10,
      reportIds: [1],
      photos: [
        {
          id: 1,
          projectId: 10,
          reportId: 1,
          fileName: "现场照片1.jpg",
          capturedAt: "2026-11-22 08:30:00",
          description: "影像说明1",
          url: "/controlled/evidence-1.jpg",
        },
      ],
    });
    expect(storageGetSignedUrl).toHaveBeenCalledTimes(1);
    expect(storageGetSignedUrl).toHaveBeenCalledWith("private/evidence-1.jpg");
    const query = evidenceQueries(store)[0];
    expect(query.sql).toContain("`evidence_records`.`projectId` = ?");
    expect(query.sql).toContain("`evidence_records`.`sourceType` = ?");
    expect(query.sql).toContain("`evidence_records`.`sourceId` in (?)");
    expect(query.params).toEqual([10, "site_photo", "construction-report-1"]);
    expect(query.sql).not.toMatch(/\blike\b/i);
    expect(Object.keys(output).sort()).toEqual([
      "photos",
      "projectId",
      "reportIds",
    ]);
    expect(Object.keys(output.photos[0]).sort()).toEqual([
      "capturedAt",
      "description",
      "fileName",
      "id",
      "projectId",
      "reportId",
      "url",
    ]);
    const projection = store.select.mock.calls[1][0];
    for (const key of [
      "url",
      "original",
      "ocrResultJson",
      "longitude",
      "latitude",
    ])
      expect(Object.keys(projection)).not.toContain(key);
    expect(JSON.stringify(output)).not.toMatch(
      /private\/|secret-|internal\.example|fileKey|watermarkJson|sourceId/
    );
  });

  it("多图按capturedAt/createdAt/id稳定降序，含空拍摄时间且不截断", async () => {
    const store = memoryDb(
      [report(1), report(2)],
      [
        photo(1, 1, { capturedAt: null }),
        photo(2, 1, { capturedAt: "2026-11-21 09:00:00" }),
        photo(3, 1, { createdAt: "2026-11-22 08:32:00" }),
        photo(4, 2, { createdAt: "2026-11-22 08:32:00" }),
        photo(5, 2, { capturedAt: "2026-11-23 08:30:00" }),
      ]
    );
    const output = await caller().printEvidence({ projectId: 10 });
    expect(output.reportIds).toEqual([2, 1]);
    expect(output.photos.map(row => row.id)).toEqual([5, 4, 3, 2, 1]);
    const query = evidenceQueries(store)[0];
    expect(query.sql).toContain(
      "order by `evidence_records`.`capturedAt` desc, `evidence_records`.`createdAt` desc, `evidence_records`.`id` desc"
    );
    expect(query.sql).not.toMatch(/limit/i);
  });

  it("日报筛选完整复用printReports，DATE字符串含端点、等级和历史关键词不丢失", async () => {
    const needle = "%_\\历史";
    const store = memoryDb(
      [
        report(1, { issuePriority: null, safetyNotes: needle }),
        report(2, { issuePriority: "urgent", safetyNotes: needle }),
        report(3, {
          issuePriority: null,
          reportDate: "2026-11-21",
          safetyNotes: needle,
        }),
        report(4, { issuePriority: null, projectId: 20, safetyNotes: needle }),
        report(5, { issuePriority: null, safetyNotes: "其他历史" }),
        report(6, { issuePriority: null, createdBy: 3, safetyNotes: needle }),
        report(7, {
          issuePriority: null,
          status: "locked",
          safetyNotes: needle,
        }),
        report(8, {
          issuePriority: null,
          issueNotes: null,
          safetyNotes: needle,
        }),
      ],
      [photo(1, 1), photo(2, 2)]
    );
    const filter = {
      projectId: 10,
      dateFrom: "2026-11-22",
      dateTo: "2026-11-22",
      issuePriority: "unclassified" as const,
      issueScope: "unreplied" as const,
      scope: "review" as const,
      createdBy: 2,
      keyword: needle,
    };
    const printed = await caller().printReports(filter);
    const output = await caller().printEvidence(filter);
    expect(output.reportIds).toEqual(printed.map(row => row.id));
    expect(output.reportIds).toEqual([1]);
    expect(output.photos.map(row => row.id)).toEqual([1]);
    const reportQueries = store.queries.filter(
      query => query.table === "construction_daily_reports"
    );
    expect(reportQueries[1]).toEqual(reportQueries[0]);
    expect(reportQueries[1].params).toContain("2026-11-22");
    expect(reportQueries[1].params.some(value => value instanceof Date)).toBe(
      false
    );
    expect(reportQueries[1].sql).toContain("`issuePriority` is null");
    expect(printed[0]).toMatchObject({
      safetyNotes: needle,
      constructionPlan: "历史计划",
      issuePriority: null,
      reviewedByName: "主管丙",
    });
  });

  it("无关联照片仍返回所有授权日报ID，而非伪造丢失记录", async () => {
    memoryDb([report(1), report(2)], [photo(1, 1, { sourceType: "receipt" })]);
    await expect(
      caller().printEvidence({ projectId: 10, reportIds: [1, 2] })
    ).resolves.toEqual({
      projectId: 10,
      reportIds: [2, 1],
      photos: [],
    });
    expect(storageGetSignedUrl).not.toHaveBeenCalled();
  });

  it("空筛选结果返回空完整envelope，不读取其他项目残留照片", async () => {
    const store = memoryDb([report(1, { projectId: 20 })], [photo(1, 1)]);
    await expect(caller().printEvidence({ projectId: 10 })).resolves.toEqual({
      projectId: 10,
      reportIds: [],
      photos: [],
    });
    expect(evidenceQueries(store)).toEqual([]);
    expect(storageGetSignedUrl).not.toHaveBeenCalled();
  });

  it.each([
    "{broken-json",
    "null",
    "[]",
    JSON.stringify({ description: { url: "https://untrusted.example" } }),
    JSON.stringify({ description: 123 }),
    JSON.stringify({ description: "" }),
    null,
  ])(
    "损坏或非字符串watermark=%j仅降级说明，不遗漏照片",
    async watermarkJson => {
      memoryDb([report(1)], [photo(1, 1, { watermarkJson })]);
      const output = await caller().printEvidence({
        projectId: 10,
        reportIds: [1],
      });
      expect(output.photos).toHaveLength(1);
      expect(output.photos[0]).toMatchObject({
        description: "施工日报现场影像",
        url: "/controlled/evidence-1.jpg",
      });
    }
  );

  it("客户端任意URL不会被用作打印照片来源", async () => {
    memoryDb([report(1)], [photo(1, 1)]);
    const output = await caller().printEvidence({
      projectId: 10,
      reportIds: [1],
      url: "https://untrusted.example/image",
      photos: [{ url: "https://untrusted.example/image" }],
    } as never);
    expect(output.photos[0].url).toBe("/controlled/evidence-1.jpg");
    expect(JSON.stringify(output)).not.toContain("untrusted.example");
  });

  it("旧reportEvidence仍使用read授权并返回原数组及六字段契约，不增加projectId", async () => {
    memoryDb([report(1)], [photo(1, 1)]);
    const output = await caller().reportEvidence({
      projectId: 10,
      reportIds: [1],
    });
    expect(Array.isArray(output)).toBe(true);
    expect(Object.keys(output[0]).sort()).toEqual([
      "capturedAt",
      "description",
      "fileName",
      "id",
      "reportId",
      "url",
    ]);
    expect(assertDepartmentBusinessAccess).toHaveBeenCalledWith(
      expect.anything(),
      "CONSTRUCTION",
      "read"
    );
    expect(output[0].description).toBe("影像说明1");
  });
});

describe("施工打印影像不可静默降级失败", () => {
  it("任一照片签名失败必须拒绝整个批次，不能跳过坏图返回其他照片", async () => {
    memoryDb([report(1)], [photo(1, 1), photo(2, 1), photo(3, 1)]);
    vi.mocked(storageGetSignedUrl).mockImplementation(async key => {
      if (key === "private/evidence-2.jpg") throw new Error("签名服务不可用");
      return "/controlled/ok.jpg";
    });
    await expect(
      caller().printEvidence({ projectId: 10, reportIds: [1] })
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(storageGetSignedUrl).toHaveBeenCalledTimes(3);
  });

  it("初始数据库不可用时明确报错，不能返回无照片", async () => {
    vi.mocked(getDb).mockResolvedValue(null);
    await expect(
      caller().printEvidence({ projectId: 10, reportIds: [1] })
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "数据库连接暂不可用",
    });
    expect(storageGetSignedUrl).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "日报读取后数据库不可用（有日报=%s）也必须报错",
    async hasReports => {
      const store = memoryDb(hasReports ? [report(1)] : []);
      vi.mocked(getDb)
        .mockResolvedValueOnce(store.db as never)
        .mockResolvedValueOnce(null);
      await expect(
        caller().printEvidence({ projectId: 10 })
      ).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: "数据库连接暂不可用",
      });
      expect(evidenceQueries(store)).toEqual([]);
      expect(storageGetSignedUrl).not.toHaveBeenCalled();
    }
  );

  it("影像SQL读取异常时明确失败，不当作无关联照片", async () => {
    const store = memoryDb([report(1)], [photo(1, 1)]);
    store.memory.exec("DROP TABLE evidence_records");
    await expect(
      caller().printEvidence({ projectId: 10, reportIds: [1] })
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(storageGetSignedUrl).not.toHaveBeenCalled();
  });
});
