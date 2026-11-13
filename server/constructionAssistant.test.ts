import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import type {
  DatabaseSync as MemoryDatabase,
  SQLInputValue,
} from "node:sqlite";
import { TRPCError } from "@trpc/server";
import { getTableColumns, getTableName, sql, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./_core/env", async original => ({
  ...(await original<typeof import("./_core/env")>()),
  ENV: {
    ...(await original<typeof import("./_core/env")>()).ENV,
    forgeApiUrl: "",
    forgeApiKey: "",
  },
}));
vi.mock("./access", async original => ({
  ...(await original<typeof import("./access")>()),
  assertDepartmentBusinessAccess: vi.fn(),
  assertProjectInCurrentScope: vi.fn(),
  getEffectiveRoleCodes: vi.fn(),
  getSuperAdminAccess: vi.fn(),
}));
vi.mock("./services/externalAiApi", async original => ({
  ...(await original<typeof import("./services/externalAiApi")>()),
  getPublishedExternalAiConfiguration: vi.fn(),
  invokeExternalAiJson: vi.fn(),
}));
vi.mock("./services/secretVault", () => ({
  encryptSecret: vi.fn((key: string) => `encrypted:${key}`),
  decryptSecret: vi.fn((key: string) => key.replace(/^encrypted:/, "")),
  maskSecret: vi.fn(() => "***"),
}));
vi.mock("node:dns", () => ({ promises: { lookup: vi.fn() } }));
vi.mock("node:https", () => ({ request: vi.fn() }));

import { promises as dns } from "node:dns";
import { request as httpsRequest } from "node:https";
import {
  assertDepartmentBusinessAccess,
  assertProjectInCurrentScope,
  getEffectiveRoleCodes,
  getSuperAdminAccess,
} from "./access";
import { getDb } from "./db";
import { ENV } from "./_core/env";
import { router } from "./_core/trpc";
import { constructionAssistantRouter } from "./routers/constructionAssistant";
import {
  getPublishedExternalAiConfiguration,
  invokeExternalAiJson,
  normalizeExternalAiBaseUrl,
} from "./services/externalAiApi";
import {
  ASSISTANT_SETTING_KEYS,
  businessDateChina,
  consumeDailyQuota,
  MAX_AUDIO_BYTES,
  readAssistantConfiguration,
  resolveSpeechEndpoint,
  validateAiOutput,
  validateAudio,
  validateSpeechEndpoint,
} from "./services/constructionAssistant";
import { CONSTRUCTION_ASSISTANT_DEFAULTS } from "../shared/constructionAssistant";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite"
) as typeof import("node:sqlite");
const stores: MemoryDatabase[] = [];
const callerRouter = router({
  constructionAssistant: constructionAssistantRouter,
});
function context(id = 1, role: "user" | "admin" = "user"): TrpcContext {
  return {
    user: {
      id,
      openId: `assistant-${id}`,
      name: `用户${id}`,
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
const caller = (ctx = context()) =>
  callerRouter.createCaller(ctx).constructionAssistant;
const aiInput = {
  projectId: 10,
  field: "workContent" as const,
  content: "K12+300 完成 30%，待核实。",
  mode: "polish" as const,
};
const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 1, 2, 3]).toString(
  "base64"
);
const voiceInput = {
  projectId: 10,
  audioBase64: webm,
  mimeType: "audio/webm" as const,
};
type Table = Parameters<typeof getTableName>[0];

/** 真正执行路由的 SQL 条件/事务/唯一冲突，绝不预设 history、update 结果。 */
function useDb() {
  const memory = new DatabaseSync(":memory:");
  stores.push(memory);
  memory.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users VALUES(1,'用户1'),(2,'用户2');
    CREATE TABLE construction_daily_reports(id INTEGER PRIMARY KEY,projectId INTEGER,workContent TEXT,reviewReply TEXT);
    INSERT INTO construction_daily_reports VALUES(71,10,'原始日报内容','原审核内容');
    CREATE TABLE construction_input_memory(id INTEGER PRIMARY KEY AUTOINCREMENT,userId INTEGER,projectId INTEGER,field TEXT,content TEXT,contentHash TEXT,usedAt TEXT DEFAULT CURRENT_TIMESTAMP,createdAt TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(userId,projectId,field,contentHash));
    CREATE TABLE construction_assistant_daily_usage(id INTEGER PRIMARY KEY AUTOINCREMENT,userId INTEGER,usageDate TEXT,channel TEXT,attemptCount INTEGER DEFAULT 0,createdAt TEXT DEFAULT CURRENT_TIMESTAMP,updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(userId,usageDate,channel));
    CREATE TABLE system_settings(id INTEGER PRIMARY KEY AUTOINCREMENT,category TEXT,settingKey TEXT UNIQUE,displayName TEXT,valueJson TEXT,secretEncrypted TEXT,valuePreview TEXT,isSensitive INTEGER DEFAULT 0,status TEXT DEFAULT 'draft',version INTEGER DEFAULT 1,updatedBy INTEGER,publishedAt TEXT,remarks TEXT,createdAt TEXT DEFAULT CURRENT_TIMESTAMP,updatedAt TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE audit_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,userId INTEGER,module TEXT,action TEXT,targetType TEXT,targetId TEXT,summary TEXT,beforeJson TEXT,afterJson TEXT,ipAddress TEXT,createdAt TEXT DEFAULT CURRENT_TIMESTAMP);
  `);
  const dialect = new MySqlDialect();
  const queries: string[] = [];
  const locks: string[] = [];
  const values = (params: unknown[]): SQLInputValue[] =>
    params.map(v =>
      v instanceof Date
        ? v.toISOString()
        : typeof v === "boolean"
          ? Number(v)
          : (v as SQLInputValue)
    );
  const compile = (query: SQL) => {
    const compiled = dialect.sqlToQuery(query);
    const statement = compiled.sql.replace(/like \?/gi, "like ? ESCAPE '\\'");
    queries.push(statement);
    return { statement, params: values(compiled.params) };
  };
  const run = (query: SQL) => {
    const c = compile(query);
    return memory.prepare(c.statement).run(...c.params);
  };
  const assignments = (record: Record<string, unknown>) =>
    Object.entries(record).map(
      ([name, value]) => sql`${sql.identifier(name)} = ${value}`
    );
  const db = {
    select(projection?: Record<string, unknown>) {
      return {
        from(table: Table) {
          let predicate: SQL | undefined;
          let maximum: number | undefined;
          let order: SQL[] = [];
          const execute = () => {
            const cols = Object.entries(
              projection ?? getTableColumns(table)
            ).map(
              ([name, value]) => sql`${value as SQL} as ${sql.identifier(name)}`
            );
            const query = sql`select ${sql.join(cols, sql`, `)} from ${sql.identifier(getTableName(table))}`;
            if (predicate) query.append(sql` where ${predicate}`);
            if (order.length)
              query.append(sql` order by ${sql.join(order, sql`, `)}`);
            if (maximum !== undefined) query.append(sql` limit ${maximum}`);
            const c = compile(query);
            return memory.prepare(c.statement).all(...c.params);
          };
          const chain = {
            where(v: SQL) {
              predicate = v;
              return chain;
            },
            orderBy(...v: SQL[]) {
              order = v;
              return chain;
            },
            limit(v: number) {
              maximum = v;
              return chain;
            },
            for(_mode: string) {
              locks.push(getTableName(table));
              return chain;
            },
            then(
              resolve: (rows: unknown[]) => unknown,
              reject?: (error: unknown) => unknown
            ) {
              return Promise.resolve().then(execute).then(resolve, reject);
            },
          };
          return chain;
        },
      };
    },
    insert(table: Table) {
      return {
        values(record: Record<string, unknown>) {
          let onConflict: Record<string, unknown> | undefined;
          const execute = () => {
            const entries = Object.entries(record).filter(
              ([, v]) => v !== undefined
            );
            const query = sql`insert into ${sql.identifier(getTableName(table))} (${sql.join(
              entries.map(([name]) => sql`${sql.identifier(name)}`),
              sql`, `
            )}) values (${sql.join(
              entries.map(([, value]) => sql`${value}`),
              sql`, `
            )})`;
            if (onConflict)
              query.append(
                sql` on conflict do update set ${sql.join(assignments(onConflict), sql`, `)}`
              );
            return [{ affectedRows: Number(run(query).changes) }];
          };
          const chain = {
            onDuplicateKeyUpdate({ set }: { set: Record<string, unknown> }) {
              onConflict = set;
              return chain;
            },
            then(
              resolve: (result: unknown) => unknown,
              reject?: (error: unknown) => unknown
            ) {
              return Promise.resolve().then(execute).then(resolve, reject);
            },
          };
          return chain;
        },
      };
    },
    update(table: Table) {
      return {
        set(record: Record<string, unknown>) {
          return {
            async where(predicate: SQL) {
              const result = run(
                sql`update ${sql.identifier(getTableName(table))} set ${sql.join(assignments(record), sql`, `)} where ${predicate}`
              );
              return unknownUpdates
                ? {}
                : [{ affectedRows: Number(result.changes) }];
            },
          };
        },
      };
    },
    delete(table: Table) {
      return {
        async where(predicate: SQL) {
          return [
            {
              affectedRows: Number(
                run(
                  sql`delete from ${sql.identifier(getTableName(table))} where ${predicate}`
                ).changes
              ),
            },
          ];
        },
      };
    },
    async transaction<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
      let release!: () => void;
      const old = tail;
      tail = new Promise<void>(resolve => {
        release = resolve;
      });
      await old;
      memory.exec("BEGIN");
      try {
        const result = await fn(db);
        memory.exec("COMMIT");
        return result;
      } catch (error) {
        memory.exec("ROLLBACK");
        throw error;
      } finally {
        release();
      }
    },
  };
  let tail = Promise.resolve();
  let unknownUpdates = false;
  vi.mocked(getDb).mockResolvedValue(db as never);
  return {
    db,
    memory,
    queries,
    locks,
    unknownResult: () => {
      unknownUpdates = true;
    },
    setting(
      key: string,
      value: string | null,
      secret: string | null = null,
      status = "published"
    ) {
      memory
        .prepare(
          "INSERT INTO system_settings(category,settingKey,displayName,valueJson,secretEncrypted,status) VALUES('施工助手',?,?,?,?,?) ON CONFLICT(settingKey) DO UPDATE SET valueJson=excluded.valueJson, secretEncrypted=excluded.secretEncrypted,status=excluded.status"
        )
        .run(key, key, value, secret, status);
    },
    memories: () =>
      memory
        .prepare("SELECT * FROM construction_input_memory ORDER BY id")
        .all(),
    original: () =>
      memory.prepare("SELECT * FROM construction_daily_reports").all(),
    audits: () => memory.prepare("SELECT * FROM audit_logs ORDER BY id").all(),
    used: (channel = "ai", userId = 1) =>
      Number(
        memory
          .prepare(
            "SELECT attemptCount FROM construction_assistant_daily_usage WHERE userId=? AND usageDate=? AND channel=?"
          )
          .get(userId, businessDateChina(), channel)?.attemptCount ?? 0
      ),
  };
}
function enableVoice(store: ReturnType<typeof useDb>) {
  store.setting(ASSISTANT_SETTING_KEYS.cloudVoiceEnabled, "true");
  store.setting(
    ASSISTANT_SETTING_KEYS.speechEndpoint,
    "https://voice.example.com/v1/"
  );
  store.setting(ASSISTANT_SETTING_KEYS.speechModel, "whisper-1");
  store.setting(
    ASSISTANT_SETTING_KEYS.speechKey,
    null,
    "encrypted:voice-test-secret"
  );
}
function mockSpeech(
  status = 200,
  payload: unknown = { text: "K12+300 待核实" }
) {
  const sent: Array<{
    endpoint: string;
    options: Record<string, unknown>;
    body: Buffer;
  }> = [];
  vi.mocked(httpsRequest).mockImplementation(((
    endpoint: string,
    options: Record<string, unknown>,
    callback: (
      res: EventEmitter & {
        statusCode: number;
        resume: () => void;
        destroy: () => void;
      }
    ) => void
  ) => {
    const req = new EventEmitter() as EventEmitter & {
      end: (body: Buffer) => void;
    };
    req.end = body => {
      sent.push({ endpoint, options, body });
      queueMicrotask(() => {
        const res = Object.assign(new EventEmitter(), {
          statusCode: status,
          resume: vi.fn(),
          destroy: vi.fn(),
        });
        callback(res);
        if (status >= 200 && status < 300) {
          res.emit("data", Buffer.from(JSON.stringify(payload)));
          res.emit("end");
        }
      });
    };
    return req;
  }) as never);
  return sent;
}
beforeEach(() => {
  vi.clearAllMocks();
  ENV.forgeApiUrl = "";
  ENV.forgeApiKey = "";
  vi.mocked(assertDepartmentBusinessAccess).mockResolvedValue({
    departments: [],
    moduleCodes: ["CONSTRUCTION"],
    hasAllDepartments: false,
  });
  vi.mocked(assertProjectInCurrentScope).mockImplementation(
    async (_ctx, projectId) => {
      if (projectId !== 10)
        throw new TRPCError({ code: "FORBIDDEN", message: "异项目" });
      return undefined;
    }
  );
  vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["CONSTRUCTION_MANAGER"]);
  vi.mocked(getSuperAdminAccess).mockImplementation(async ctx => ({
    canAccess: ctx.user?.role === "admin",
    user: ctx.user!,
  }));
  vi.mocked(getPublishedExternalAiConfiguration).mockResolvedValue({
    enabled: true,
    model: "test-model",
    baseUrl: "https://ai.example.com/v1",
    apiKey: "ai-test-secret",
  });
  vi.mocked(invokeExternalAiJson).mockResolvedValue({
    content: JSON.stringify({ text: aiInput.content, warnings: [] }),
    model: "test-model",
    mode: "json_schema",
  });
  vi.mocked(dns.lookup).mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
  ] as never);
});
afterEach(() => {
  stores.splice(0).forEach(store => store.close());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("施工助手真实caller：权限和本人当前项目边界", () => {
  it("未登录不读取数据库；无部门或施工岗位授权拒绝", async () => {
    const store = useDb();
    await expect(
      caller({ ...context(), user: null }).history({
        projectId: 10,
        field: "workContent",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    vi.mocked(assertDepartmentBusinessAccess).mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" })
    );
    await expect(caller().status({ projectId: 10 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    vi.mocked(getEffectiveRoleCodes).mockResolvedValue(["FINANCE_MANAGER"]);
    await expect(
      caller().remember({ projectId: 10, entries: [] })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(store.memories()).toEqual([]);
  });
  it("status/history沿用read；所有接口拒绝异项目", async () => {
    useDb();
    await caller().status({ projectId: 10 });
    await caller().history({ projectId: 10, field: "workArea" });
    expect(
      vi.mocked(assertDepartmentBusinessAccess).mock.calls.map(call => call[2])
    ).toEqual(["read", "read"]);
    const api = caller();
    for (const pending of [
      api.status({ projectId: 11 }),
      api.history({ projectId: 11, field: "workArea" }),
      api.remember({ projectId: 11, entries: [] }),
      api.forget({ projectId: 11 }),
      api.assist({ ...aiInput, projectId: 11 }),
      api.transcribe({ ...voiceInput, projectId: 11 }),
    ]) {
      await expect(pending).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(invokeExternalAiJson).not.toHaveBeenCalled();
    expect(httpsRequest).not.toHaveBeenCalled();
  });
  it.each(["create", "edit"] as const)(
    "仅有%s写权也可保存/删除/AI/语音",
    async granted => {
      const store = useDb();
      enableVoice(store);
      mockSpeech();
      vi.mocked(assertDepartmentBusinessAccess).mockImplementation(
        async (_ctx, _module, action) => {
          if (action !== granted && action !== "read")
            throw new TRPCError({ code: "FORBIDDEN" });
          return {
            departments: [],
            moduleCodes: ["CONSTRUCTION"],
            hasAllDepartments: false,
          };
        }
      );
      await caller().remember({
        projectId: 10,
        entries: [{ field: "workContent", content: "本人输入" }],
      });
      await caller().forget({ projectId: 10 });
      await caller().assist(aiInput);
      await caller().transcribe(voiceInput);
      expect(store.memories()).toEqual([]);
      expect(store.used()).toBe(1);
      expect(store.used("voice")).toBe(1);
    }
  );
  it("DB内部故障不可回退edit而授权通过", async () => {
    const store = useDb();
    vi.mocked(assertDepartmentBusinessAccess).mockRejectedValue(
      new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB失败" })
    );
    await expect(caller().forget({ projectId: 10 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(assertDepartmentBusinessAccess).toHaveBeenCalledTimes(1);
    expect(store.audits()).toEqual([]);
  });
  it("两个写权均被拒绝时不发请求、不存记忆", async () => {
    const store = useDb();
    vi.mocked(assertDepartmentBusinessAccess).mockRejectedValue(
      new TRPCError({ code: "FORBIDDEN" })
    );
    await expect(caller().assist(aiInput)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(invokeExternalAiJson).not.toHaveBeenCalled();
    expect(store.used()).toBe(0);
  });
});

describe("施工助手记忆真实SQL事务", () => {
  it("本人/项目/字段隔离，trim去重，单删和clear都不改变原日报", async () => {
    const store = useDb();
    const original = store.original();
    await caller().remember({
      projectId: 10,
      entries: [
        { field: "workContent", content: " 本人原话 " },
        { field: "safetyNotes", content: "风险提醒" },
      ],
    });
    await caller().remember({
      projectId: 10,
      entries: [{ field: "workContent", content: "本人原话" }],
    });
    await caller(context(2)).remember({
      projectId: 10,
      entries: [{ field: "workContent", content: "他人隐私" }],
    });
    store.memory
      .prepare(
        "INSERT INTO construction_input_memory(userId,projectId,field,content,contentHash,usedAt) VALUES(1,11,'workContent','其它项目','other',?)"
      )
      .run(new Date().toISOString());
    const own = await caller().history({ projectId: 10, field: "workContent" });
    expect(own.items.map(row => row.content)).toEqual(["本人原话"]);
    expect(store.memories()).toHaveLength(4);
    const otherId = Number(store.memories().find(row => row.userId === 2)!.id);
    expect(await caller().forget({ projectId: 10, id: otherId })).toEqual({
      success: true,
    });
    expect(await caller().forget({ projectId: 10, id: 999999 })).toEqual({
      success: true,
    });
    expect(store.memories()).toHaveLength(4);
    await caller().forget({ projectId: 10, id: own.items[0].id });
    expect(
      (await caller().history({ projectId: 10, field: "workContent" })).items
    ).toEqual([]);
    await caller().forget({ projectId: 10 });
    expect(store.memories().map(row => row.content)).toEqual([
      "他人隐私",
      "其它项目",
    ]);
    expect(store.original()).toEqual(original);
    expect(JSON.stringify(store.audits())).not.toContain("他人隐私");
    expect(JSON.stringify(store.audits())).toContain(`requestedIds=${otherId}`);
    expect(store.locks).toContain("users");
  });
  it("最多5字段、重复字段拒绝、空白忽略且全量预校验不部分写入", async () => {
    const store = useDb();
    await expect(
      caller().remember({
        projectId: 10,
        entries: [
          { field: "workContent", content: "先存" },
          { field: "workArea", content: "X".repeat(201) },
        ],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().remember({
        projectId: 10,
        entries: [
          { field: "workContent", content: "先存" },
          { field: "workContent", content: "第二" },
        ],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().remember({
        projectId: 10,
        entries: Array.from({ length: 6 }, () => ({
          field: "workArea" as const,
          content: "",
        })),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await caller().remember({
      projectId: 10,
      entries: [{ field: "workArea", content: " \n\t " }],
    });
    expect(store.memories()).toEqual([]);
    expect(store.audits()).toEqual([]);
  });
  it("同用户并发upsert去重、每field裁剪最新30，不裁剪其它用户", async () => {
    const store = useDb();
    await Promise.all(
      Array.from({ length: 35 }, (_, i) =>
        caller().remember({
          projectId: 10,
          entries: [{ field: "workContent", content: `记录${i}` }],
        })
      )
    );
    await Promise.all(
      Array.from({ length: 5 }, () =>
        caller().remember({
          projectId: 10,
          entries: [{ field: "workContent", content: "记录34" }],
        })
      )
    );
    await caller(context(2)).remember({
      projectId: 10,
      entries: [{ field: "workContent", content: "另一个人的" }],
    });
    expect(
      (await caller().history({ projectId: 10, field: "workContent" })).items
    ).toHaveLength(30);
    expect(store.memories().filter(row => row.userId === 1)).toHaveLength(30);
    expect(
      store
        .memories()
        .filter(row => row.userId === 1)
        .some(row => row.content === "记录0")
    ).toBe(false);
    expect(
      store.memories().filter(row => row.content === "记录34")
    ).toHaveLength(1);
    expect(store.original()[0].workContent).toBe("原始日报内容");
  });
  it("关键词%/_/反斜杠按字面搜索，超过90天不返回", async () => {
    const store = useDb();
    for (const content of ["完成30%", "符号_", "路径\\文件", "普通内容"])
      await caller().remember({
        projectId: 10,
        entries: [{ field: "workContent", content }],
      });
    expect(
      (
        await caller().history({
          projectId: 10,
          field: "workContent",
          keyword: "%",
        })
      ).items.map(x => x.content)
    ).toEqual(["完成30%"]);
    expect(
      (
        await caller().history({
          projectId: 10,
          field: "workContent",
          keyword: "_",
        })
      ).items.map(x => x.content)
    ).toEqual(["符号_"]);
    expect(
      (
        await caller().history({
          projectId: 10,
          field: "workContent",
          keyword: "\\",
        })
      ).items.map(x => x.content)
    ).toEqual(["路径\\文件"]);
    store.memory
      .prepare(
        "UPDATE construction_input_memory SET usedAt='2020-01-01' WHERE content='普通内容'"
      )
      .run();
    expect(
      (await caller().history({ projectId: 10, field: "workContent" })).items
    ).toHaveLength(3);
  });
  it("事务中审计写入失败回滚所有upsert，不留下部分记忆", async () => {
    const store = useDb();
    store.memory.exec(
      "CREATE TRIGGER audit_failure BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_failure'); END;"
    );
    await expect(
      caller().remember({
        projectId: 10,
        entries: [
          { field: "workContent", content: "正文" },
          { field: "safetyNotes", content: "风险" },
        ],
      })
    ).rejects.toThrow();
    expect(store.memories()).toEqual([]);
    expect(store.original()[0].workContent).toBe("原始日报内容");
  });
  it("history开关关闭不保存或读取但仍允许清除自己记忆", async () => {
    const store = useDb();
    await caller().remember({
      projectId: 10,
      entries: [{ field: "workContent", content: "旧记忆" }],
    });
    store.setting(ASSISTANT_SETTING_KEYS.historyEnabled, "false");
    await caller().remember({
      projectId: 10,
      entries: [{ field: "workContent", content: "新记忆" }],
    });
    expect(store.memories()).toHaveLength(1);
    expect(
      (await caller().history({ projectId: 10, field: "workContent" })).items
    ).toEqual([]);
    await caller().forget({ projectId: 10 });
    expect(store.memories()).toEqual([]);
  });
});

describe("DB原子配额和配置就绪", () => {
  it("并发SQL条件最多3次，分channel/user隔离并用北京时间", async () => {
    const store = useDb();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T16:05:00Z"));
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => consumeDailyQuota(1, "ai", 3))
    );
    expect(businessDateChina()).toBe("2026-11-13");
    expect(results.filter(x => x.status === "fulfilled")).toHaveLength(3);
    expect(store.used()).toBe(3);
    expect(store.queries.some(query => /attemptCount.*< \?/.test(query))).toBe(
      true
    );
    await consumeDailyQuota(1, "voice", 3);
    await consumeDailyQuota(2, "ai", 3);
    expect(store.used("voice")).toBe(1);
    expect(store.used("ai", 2)).toBe(1);
  });
  it("affectedRows未知fail-closed并回滚计数", async () => {
    const store = useDb();
    store.unknownResult();
    await expect(consumeDailyQuota(1, "ai", 20)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(store.used()).toBe(0);
    expect(
      store.memory
        .prepare("SELECT * FROM construction_assistant_daily_usage")
        .all()
    ).toEqual([]);
  });
  it.each([
    null,
    {
      enabled: false,
      baseUrl: "https://ai.example.com/v1",
      model: "x",
      apiKey: "x",
    },
  ])("provider未配置/禁用status不可误报且AI不发不扣", async cfg => {
    const store = useDb();
    vi.mocked(getPublishedExternalAiConfiguration).mockResolvedValue(cfg);
    expect((await caller().status({ projectId: 10 })).aiReady).toBe(false);
    await expect(caller().assist(aiInput)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(store.used()).toBe(0);
    expect(invokeExternalAiJson).not.toHaveBeenCalled();
  });
  it("AI开关关闭，即使外部provider配置存在仍不发不扣", async () => {
    const store = useDb();
    store.setting(ASSISTANT_SETTING_KEYS.aiEnabled, "false");
    expect((await caller().status({ projectId: 10 })).aiReady).toBe(false);
    await expect(caller().assist(aiInput)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(store.used()).toBe(0);
    expect(invokeExternalAiJson).not.toHaveBeenCalled();
  });
  it("DB失败status返回明确错误，不伪造额度0", async () => {
    vi.mocked(getDb).mockResolvedValue(null);
    await expect(caller().status({ projectId: 10 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
  it("配置读取只选白名单published设置，普通boolean/number类型有效", async () => {
    const store = useDb();
    store.setting("UNRELATED_SECRET", "不要读取");
    store.setting(ASSISTANT_SETTING_KEYS.aiEnabled, "false");
    store.setting(ASSISTANT_SETTING_KEYS.aiLimit, "7");
    expect(await readAssistantConfiguration()).toMatchObject({
      aiEnabled: false,
      aiDailyLimit: 7,
    });
    expect(store.queries.at(-1)).toMatch(/settingKey.*in \(/);
  });
  it("配置仅super发布；启用云语音不完整配置事务拒绝", async () => {
    const store = useDb();
    await expect(caller().configuration()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller().saveConfiguration(CONSTRUCTION_ASSISTANT_DEFAULTS)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller(context(1, "admin")).saveConfiguration({
        ...CONSTRUCTION_ASSISTANT_DEFAULTS,
        cloudVoiceEnabled: true,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(store.memory.prepare("SELECT * FROM system_settings").all()).toEqual(
      []
    );
  });
  it("并发发布设置锁行、空key保留密钥，不返回或审计密钥", async () => {
    const store = useDb();
    const api = caller(context(1, "admin"));
    await api.saveConfiguration({
      ...CONSTRUCTION_ASSISTANT_DEFAULTS,
      cloudVoiceEnabled: true,
      speechEndpoint: "https://voice.example.com/v1",
      speechModel: "whisper-1",
      speechApiKey: "voice-test-secret",
    });
    await Promise.all([
      api.saveConfiguration({
        ...CONSTRUCTION_ASSISTANT_DEFAULTS,
        cloudVoiceEnabled: true,
        speechEndpoint: "https://voice.example.com/v1",
        speechModel: "whisper-1",
        speechApiKey: "",
        aiDailyLimit: 3,
      }),
      api.saveConfiguration({
        ...CONSTRUCTION_ASSISTANT_DEFAULTS,
        cloudVoiceEnabled: true,
        speechEndpoint: "https://voice.example.com/v1",
        speechModel: "whisper-1",
        voiceDailyLimit: 4,
      }),
    ]);
    const key = store.memory
      .prepare("SELECT * FROM system_settings WHERE settingKey=?")
      .get(ASSISTANT_SETTING_KEYS.speechKey)!;
    expect(key.secretEncrypted).toBe("encrypted:voice-test-secret");
    expect(key.version).toBe(4);
    expect(store.locks).toContain("system_settings");
    expect(JSON.stringify(await api.configuration())).not.toContain(
      "voice-test-secret"
    );
    expect(JSON.stringify(store.audits())).not.toContain("voice-test-secret");
  });
});

describe("AI原字段事实保护及付费尝试", () => {
  it("正常模型严格JSON保留数字/否定并提醒确认；模式指令和实际field限制进prompt", async () => {
    const store = useDb();
    expect(
      await caller().assist({ ...aiInput, mode: "organize" })
    ).toMatchObject({ text: aiInput.content, provider: "test-model" });
    const prompt = vi.mocked(invokeExternalAiJson).mock.calls[0][0];
    expect(prompt.system).toContain("列表使用 •");
    expect(prompt.system).toContain("最大 8000");
    expect(JSON.parse(prompt.prompt)).toMatchObject({
      field: "workContent",
      mode: "organize",
    });
    expect((await caller().assist(aiInput)).warnings.join("")).toContain(
      "确认"
    );
    expect(store.used()).toBe(2);
    expect(JSON.stringify(store.audits())).not.toContain(aiInput.content);
    expect(JSON.stringify(store.audits())).not.toContain("ai-test-secret");
  });
  it.each([
    { text: aiInput.content },
    { text: aiInput.content, warnings: "no" },
    { text: aiInput.content, warnings: [null] },
    { text: aiInput.content, warnings: [], workArea: "额外字段" },
    { text: "", warnings: [] },
  ])("malformed模型响应不静默修复 %#", async payload => {
    const store = useDb();
    vi.mocked(invokeExternalAiJson).mockResolvedValue({
      content: JSON.stringify(payload),
      model: "test",
      mode: "json_schema",
    });
    await expect(caller().assist(aiInput)).rejects.toMatchObject({
      code: "BAD_GATEWAY",
    });
    expect(store.used()).toBe(1);
    expect(store.audits().at(-1)?.action).toBe("assist_failure");
  });
  it("非法JSON响应拒绝并记录失败长度而非全文", async () => {
    const store = useDb();
    vi.mocked(invokeExternalAiJson).mockResolvedValue({
      content: "not-json",
      model: "test",
      mode: "json_schema",
    });
    await expect(caller().assist(aiInput)).rejects.toMatchObject({
      code: "BAD_GATEWAY",
    });
    expect(store.used()).toBe(1);
    expect(store.audits().at(-1)?.summary).toContain(
      `inputLength=${aiInput.content.length}`
    );
    expect(JSON.stringify(store.audits())).not.toContain("not-json");
  });
  it("provider失败仍扣额度，超限不调用provider", async () => {
    const store = useDb();
    store.setting(ASSISTANT_SETTING_KEYS.aiLimit, "1");
    vi.mocked(invokeExternalAiJson).mockRejectedValue(
      new Error("fake-secret-provider-body")
    );
    await expect(caller().assist(aiInput)).rejects.toMatchObject({
      code: "BAD_GATEWAY",
    });
    await expect(caller().assist(aiInput)).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(invokeExternalAiJson).toHaveBeenCalledTimes(1);
    expect(store.used()).toBe(1);
    expect(JSON.stringify(store.audits())).not.toContain(
      "fake-secret-provider-body"
    );
  });
  it.each([
    "合格",
    "无隐患",
    "验收通过",
    "已完成",
    "符合规范",
    "安全达标",
    "已整改",
    "审核通过",
  ])("拒绝新增肯定事实%s", fact => {
    expect(() =>
      validateAiOutput("待核实施工情况", `待核实施工情况，${fact}`)
    ).toThrow("unsupported_fact_added");
  });
  it.each(["未", "不", "禁止", "风险", "待核实"])("拒绝删掉保护词%s", term => {
    expect(() => validateAiOutput(`${term}施工`, "施工")).toThrow(
      "negative_or_risk_changed"
    );
  });
  it("桩号/数量/中文数字不能修改，分条禁止凭空产生序号", () => {
    expect(() =>
      validateAiOutput("桩号K12+300完成30%", "桩号K12+300完成40%")
    ).toThrow("numeric_fact_changed");
    expect(() => validateAiOutput("三人待核实", "四人待核实")).toThrow(
      "numeric_fact_changed"
    );
    expect(() => validateAiOutput("桩号K12+300", "桩号D12+300")).toThrow(
      "numeric_fact_changed"
    );
    expect(() => validateAiOutput("温度-3，完成30%", "温度3，完成30")).toThrow(
      "numeric_fact_changed"
    );
    expect(() => validateAiOutput("路基待核实", "1.路基待核实")).toThrow(
      "numeric_fact_changed"
    );
    expect(validateAiOutput("路基待核实", "•路基待核实")).toBe("•路基待核实");
    expect(() =>
      validateAiOutput("未验收通过，不施工", "验收通过，不施工，不继续")
    ).toThrow("negative_or_risk_changed");
  });
  it("按实际workArea 200/safetyNotes 1000长度限制拒绝而非8000统一", async () => {
    const store = useDb();
    vi.mocked(invokeExternalAiJson).mockResolvedValue({
      content: JSON.stringify({ text: "A".repeat(201), warnings: [] }),
      model: "test",
      mode: "json_schema",
    });
    await expect(
      caller().assist({ ...aiInput, field: "workArea", content: "A" })
    ).rejects.toMatchObject({ code: "BAD_GATEWAY" });
    expect(() =>
      validateAiOutput("安全提醒", "A".repeat(1001), "safetyNotes")
    ).toThrow("malformed_ai_response");
    await expect(
      caller().assist({
        ...aiInput,
        field: "workArea",
        content: "A".repeat(201),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(store.used()).toBe(1);
  });
});

describe("语音严格格式、DNS和内存网络请求", () => {
  it.each([
    "http://voice.example.com/v1",
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://169.254.1.1",
    "https://172.16.0.1",
    "https://192.168.1.1",
    "https://100.64.0.1",
    "https://198.18.0.1",
    "https://0.0.0.0",
    "https://[::1]",
    "https://localhost",
    "https://internal.local",
    "https://u:p@voice.example.com/v1",
  ])("拒绝不公开HTTPS地址%s", value => {
    expect(() => validateSpeechEndpoint(value)).toThrow();
  });
  it("复用外部AI地址校验", () => {
    expect(() =>
      normalizeExternalAiBaseUrl("https://192.168.1.1/v1")
    ).toThrow();
  });
  it.each([
    {
      addresses: [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
    },
    { addresses: [{ address: "::ffff:8.8.8.8", family: 6 }] },
    { addresses: [] },
  ])("DNS所有地址安全才通过 %#", async ({ addresses }) => {
    const store = useDb();
    enableVoice(store);
    vi.mocked(dns.lookup).mockResolvedValue(addresses as never);
    await expect(caller().transcribe(voiceInput)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(store.used("voice")).toBe(0);
    expect(httpsRequest).not.toHaveBeenCalled();
  });
  it("DNS失败fail-closed", async () => {
    useDb();
    vi.mocked(dns.lookup).mockRejectedValue(new Error("dns-unavailable"));
    await expect(
      resolveSpeechEndpoint("https://voice.example.com/v1")
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it.each([
    "",
    "abcd$",
    "aGVsbG8",
    "aGVsbG8=\n",
    "Zh==",
    `data:audio/webm;base64,${webm}`,
  ])("canonical base64拒绝非法输入 %#", b64 => {
    expect(() => validateAudio(b64, "audio/webm")).toThrow();
  });
  it("2MB严格上限和mime magic RIFF WAVE/mp4 ftyp/ID3或FF frame", () => {
    const max = Buffer.alloc(MAX_AUDIO_BYTES);
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).copy(max);
    expect(validateAudio(max.toString("base64"), "audio/webm")).toHaveLength(
      MAX_AUDIO_BYTES
    );
    const tooBig = Buffer.alloc(MAX_AUDIO_BYTES + 1);
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).copy(tooBig);
    expect(() =>
      validateAudio(tooBig.toString("base64"), "audio/webm")
    ).toThrow();
    expect(() =>
      validateAudio(Buffer.from("RIFF0000NOPE").toString("base64"), "audio/wav")
    ).toThrow();
    expect(() =>
      validateAudio(
        Buffer.from([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]).toString("base64"),
        "audio/mp4"
      )
    ).toThrow();
    for (const [mime, bytes] of [
      ["audio/wav", Buffer.from("RIFF0000WAVE")],
      [
        "audio/mp4",
        Buffer.from([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]),
      ],
      ["audio/mpeg", Buffer.from("ID3audio")],
      ["audio/mpeg", Buffer.from([0xff, 0xfb, 0x90, 0x00])],
      ["audio/ogg", Buffer.from("OggSaudio")],
    ] as const)
      expect(validateAudio(bytes.toString("base64"), mime)).toEqual(bytes);
    expect(() => validateAudio(webm, "audio/ogg")).toThrow();
  });
  it("云语音无配置不请求不扣额，非法音频也不扣", async () => {
    const store = useDb();
    await expect(caller().transcribe(voiceInput)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    enableVoice(store);
    await expect(
      caller().transcribe({ ...voiceInput, audioBase64: "!" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(httpsRequest).not.toHaveBeenCalled();
    expect(store.used("voice")).toBe(0);
  });
  it("保留/v1 endpoint、HTTPS lookup固定IP、Bearer只发provider且multipart内存不存录音", async () => {
    const store = useDb();
    enableVoice(store);
    const sent = mockSpeech();
    expect(await caller().transcribe(voiceInput)).toEqual({
      text: "K12+300 待核实",
    });
    expect(sent[0].endpoint).toBe(
      "https://voice.example.com/v1/audio/transcriptions"
    );
    expect(sent[0].options.headers).toMatchObject({
      Authorization: "Bearer voice-test-secret",
      Accept: "application/json",
    });
    const lookup = sent[0].options.lookup as (
      host: string,
      opts: object,
      cb: (...args: unknown[]) => void
    ) => void;
    const cb = vi.fn();
    lookup("voice.example.com", {}, cb);
    expect(cb).toHaveBeenCalledWith(null, "8.8.8.8", 4);
    expect(sent[0].body.toString()).toContain('name="model"');
    expect(sent[0].body.toString()).toContain("whisper-1");
    expect(sent[0].body.toString()).toContain('filename="recording.webm"');
    expect(JSON.stringify(store.audits())).not.toContain("voice-test-secret");
    expect(JSON.stringify(store.audits())).not.toContain(webm);
    expect(store.memories()).toEqual([]);
    expect(store.used("voice")).toBe(1);
    expect(dns.lookup).toHaveBeenCalledWith("voice.example.com", {
      all: true,
      verbatim: true,
    });
  });
  it("语音失败尝试用尽限额后不发第二个provider请求", async () => {
    const store = useDb();
    enableVoice(store);
    store.setting(ASSISTANT_SETTING_KEYS.voiceLimit, "1");
    const sent = mockSpeech(500);
    await expect(caller().transcribe(voiceInput)).rejects.toMatchObject({
      code: "BAD_GATEWAY",
    });
    await expect(caller().transcribe(voiceInput)).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(sent).toHaveLength(1);
    expect(store.used("voice")).toBe(1);
  });
  it.each([302, 307, 500])(
    "HTTP%s拒绝且不跟随redirect，失败尝试仍计费",
    async status => {
      const store = useDb();
      enableVoice(store);
      const sent = mockSpeech(status);
      await expect(caller().transcribe(voiceInput)).rejects.toMatchObject({
        code: "BAD_GATEWAY",
      });
      expect(sent).toHaveLength(1);
      expect(store.used("voice")).toBe(1);
    }
  );
  it.each([{ text: " " }, { text: "x".repeat(8001) }, { text: 123 }, null])(
    "语音响应必须非空文本且<=8000 %#",
    async payload => {
      const store = useDb();
      enableVoice(store);
      mockSpeech(200, payload);
      await expect(caller().transcribe(voiceInput)).rejects.toMatchObject({
        code: "BAD_GATEWAY",
      });
      expect(store.used("voice")).toBe(1);
    }
  );
  it("请求超时25秒友好错误且保留失败配额", async () => {
    const store = useDb();
    enableVoice(store);
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => new AbortController().signal);
    vi.mocked(httpsRequest).mockImplementation(((
      _url: string,
      _opts: unknown,
      _cb: unknown
    ) => {
      const req = new EventEmitter() as EventEmitter & {
        end: (b: Buffer) => void;
      };
      req.end = () =>
        queueMicrotask(() =>
          req.emit(
            "error",
            Object.assign(new Error("secret-body-timeout"), {
              name: "TimeoutError",
            })
          )
        );
      return req;
    }) as never);
    await expect(caller().transcribe(voiceInput)).rejects.toMatchObject({
      code: "BAD_GATEWAY",
      message: expect.stringContaining("暂不可用"),
    });
    expect(timeoutSpy).toHaveBeenCalledWith(25_000);
    timeoutSpy.mockRestore();
    expect(store.used("voice")).toBe(1);
    expect(JSON.stringify(store.audits())).not.toContain("secret-body-timeout");
  });
});

describe("受控Forge云语音开箱可用后备", () => {
  it("默认语音启用但无两个provider时status false且不请求；DTO只返回能力boolean", async () => {
    const store = useDb();
    expect((await readAssistantConfiguration()).cloudVoiceEnabled).toBe(true);
    expect((await caller().status({ projectId: 10 })).cloudVoiceReady).toBe(
      false
    );
    expect(
      (await caller(context(1, "admin")).configuration()).builtinVoiceAvailable
    ).toBe(false);
    expect(store.used("voice")).toBe(0);
  });
  it.each(["https://forge.example.com/", "https://forge.example.com/v1/"])(
    "受控地址%s正确POST v1转写、zh/whisper/FormData/redirect:error/25s",
    async base => {
      const store = useDb();
      ENV.forgeApiUrl = base;
      ENV.forgeApiKey = "forge-test-secret";
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ text: "本人云转写结果" }), {
            status: 200,
          })
        );
      vi.stubGlobal("fetch", fetchMock);
      const status = await caller().status({ projectId: 10 });
      expect(status.cloudVoiceReady).toBe(true);
      expect(status.message).toContain("内置云转写已就绪");
      const dto = await caller(context(1, "admin")).configuration();
      expect(dto.builtinVoiceAvailable).toBe(true);
      expect(JSON.stringify(dto)).not.toContain("forge-test-secret");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(store.used("voice")).toBe(0);
      expect(await caller().transcribe(voiceInput)).toEqual({
        text: "本人云转写结果",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [endpoint, options] = fetchMock.mock.calls[0];
      expect(endpoint).toBe(
        "https://forge.example.com/v1/audio/transcriptions"
      );
      expect(options).toMatchObject({
        method: "POST",
        redirect: "error",
        headers: {
          authorization: "Bearer forge-test-secret",
          "Accept-Encoding": "identity",
        },
      });
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(options.body).toBeInstanceOf(FormData);
      expect(options.body.get("model")).toBe("whisper-1");
      expect(options.body.get("language")).toBe("zh");
      expect(options.body.get("response_format")).toBe("verbose_json");
      expect(options.body.get("file").size).toBe(
        Buffer.from(webm, "base64").length
      );
      expect(httpsRequest).not.toHaveBeenCalled();
      expect(dns.lookup).not.toHaveBeenCalled();
      expect(store.used("voice")).toBe(1);
      expect(JSON.stringify(store.audits())).not.toContain("forge-test-secret");
    }
  );
  it("外部完整配置优先，不因外部失败silent fallback到Forge", async () => {
    const store = useDb();
    enableVoice(store);
    ENV.forgeApiUrl = "https://forge.example.com";
    ENV.forgeApiKey = "forge-test-secret";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const sent = mockSpeech(500);
    await expect(caller().transcribe(voiceInput)).rejects.toMatchObject({
      code: "BAD_GATEWAY",
    });
    expect(sent).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.used("voice")).toBe(1);
  });
  it("有Forge可以发布外部全空；部分外部配置不能被Forge掩盖", async () => {
    const store = useDb();
    ENV.forgeApiUrl = "https://forge.example.com";
    ENV.forgeApiKey = "forge-test-secret";
    const api = caller(context(1, "admin"));
    await api.saveConfiguration(CONSTRUCTION_ASSISTANT_DEFAULTS);
    expect((await caller().status({ projectId: 10 })).cloudVoiceReady).toBe(
      true
    );
    await expect(
      api.saveConfiguration({
        ...CONSTRUCTION_ASSISTANT_DEFAULTS,
        speechModel: "whisper-1",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    store.setting(ASSISTANT_SETTING_KEYS.speechModel, "whisper-1");
    expect((await caller().status({ projectId: 10 })).cloudVoiceReady).toBe(
      false
    );
    await expect(caller().transcribe(voiceInput)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(store.used("voice")).toBe(0);
  });
  it.each(["", "http://forge.example.com", "bad-url"])(
    "缺失或无效受控Forge地址%s不会假就绪",
    async url => {
      useDb();
      ENV.forgeApiUrl = url;
      ENV.forgeApiKey = "forge-test-secret";
      expect((await caller().status({ projectId: 10 })).cloudVoiceReady).toBe(
        false
      );
    }
  );
  it("Forge失败/redirect/error/timeout友好拒绝，扣额度且不落盘", async () => {
    const store = useDb();
    ENV.forgeApiUrl = "https://forge.example.com";
    ENV.forgeApiKey = "forge-test-secret";
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error("forge-test-secret-redirect"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(caller().transcribe(voiceInput)).rejects.toMatchObject({
      code: "BAD_GATEWAY",
    });
    expect(fetchMock.mock.calls[0][1].redirect).toBe("error");
    expect(store.used("voice")).toBe(1);
    expect(store.memories()).toEqual([]);
    expect(JSON.stringify(store.audits())).not.toContain("forge-test-secret");
  });
  it("Forge配置存在但管理员关闭云语音，不调用且不扣额", async () => {
    const store = useDb();
    ENV.forgeApiUrl = "https://forge.example.com";
    ENV.forgeApiKey = "forge-test-secret";
    store.setting(ASSISTANT_SETTING_KEYS.cloudVoiceEnabled, "false");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await caller().status({ projectId: 10 })).cloudVoiceReady).toBe(
      false
    );
    await expect(caller().transcribe(voiceInput)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.used("voice")).toBe(0);
  });
});
