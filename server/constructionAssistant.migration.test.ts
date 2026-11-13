import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error 受控生产迁移器为独立MJS CLI。
import {
  CONSTRUCTION_ASSISTANT_MIGRATION_FILE,
  CONSTRUCTION_ASSISTANT_MIGRATION_SHA256,
  applyConstructionAssistantMigration,
  assertConstructionAssistantShape,
  runConstructionAssistantMigration,
  validateConstructionAssistantMigration,
} from "../scripts/apply-construction-assistant-migration.mjs";

const bytes = readFileSync(
  new URL("../drizzle/0096_cold_sentinel.sql", import.meta.url)
);
const sha = createHash("sha256").update(bytes).digest("hex");
const usage = "construction_assistant_daily_usage";
const memory = "construction_input_memory";
const tables = [usage, memory];
type Column = {
  name: string;
  type: string;
  nullable: string;
  defaultValue: string | number | null;
  extraValue: string;
  position: number;
  generationExpression: string;
};
type IndexRow = {
  name: string;
  columnName: string;
  nonUnique: number | string;
  sequence: number | string;
  subPart: number | null;
  collation: string;
  indexType: string;
};
type Shape = { tableType: string; columns: Column[]; indexes: IndexRow[] };
function fixture(table: string): Shape {
  const fields: Array<[string, string, (string | null)?, string?]> =
    table === usage
      ? [
          ["id", "bigint", null, "auto_increment"],
          ["userId", "int"],
          ["usageDate", "date"],
          ["channel", "enum('ai','voice')"],
          ["attemptCount", "int", "0"],
          ["createdAt", "timestamp", "CURRENT_TIMESTAMP", "DEFAULT_GENERATED"],
          [
            "updatedAt",
            "timestamp",
            "CURRENT_TIMESTAMP",
            "DEFAULT_GENERATED on update CURRENT_TIMESTAMP",
          ],
        ]
      : [
          ["id", "bigint", null, "auto_increment"],
          ["userId", "int"],
          ["projectId", "int"],
          ["field", "varchar(32)"],
          ["content", "text"],
          ["contentHash", "varchar(64)"],
          ["usedAt", "timestamp", "CURRENT_TIMESTAMP", "DEFAULT_GENERATED"],
          ["createdAt", "timestamp", "CURRENT_TIMESTAMP", "DEFAULT_GENERATED"],
        ];
  const keys: Array<[string, string[], number]> =
    table === usage
      ? [
          ["PRIMARY", ["id"], 0],
          [
            "construction_assistant_usage_user_date_channel_unique",
            ["userId", "usageDate", "channel"],
            0,
          ],
        ]
      : [
          ["PRIMARY", ["id"], 0],
          [
            "construction_input_memory_user_project_field_hash_unique",
            ["userId", "projectId", "field", "contentHash"],
            0,
          ],
          [
            "construction_input_memory_recent_index",
            ["userId", "projectId", "field", "usedAt"],
            1,
          ],
        ];
  return {
    tableType: "BASE TABLE",
    columns: fields.map(
      ([name, type, defaultValue = null, extraValue = ""], i) => ({
        name,
        type,
        nullable: "NO",
        defaultValue,
        extraValue,
        position: i + 1,
        generationExpression: "",
      })
    ),
    indexes: keys
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([name, fields, nonUnique]) =>
        fields.map((columnName, i) => ({
          name,
          columnName,
          nonUnique,
          sequence: i + 1,
          subPart: null,
          collation: "A",
          indexType: "BTREE",
        }))
      ),
  };
}
function mockDb(
  initial: Record<string, Shape> = {},
  options: {
    lock?: number | string | null;
    failTable?: string;
    corruptCreated?: string;
    databaseName?: string | null;
  } = {}
) {
  const state = new Map(
    Object.entries(initial).map(([table, shape]) => [
      table,
      structuredClone(shape),
    ])
  );
  const events: string[] = [];
  let failTable = options.failTable;
  return {
    state,
    events,
    query: vi.fn(async (sql: string, params?: string[]) => {
      events.push(sql + (params ? ":" + params[0] : ""));
      if (sql.includes("GET_LOCK"))
        return [[{ acquired: options.lock === undefined ? 1 : options.lock }]];
      if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
      if (sql === "SELECT DATABASE() AS databaseName")
        return [
          [
            {
              databaseName:
                options.databaseName === undefined
                  ? "isolated_test"
                  : options.databaseName,
            },
          ],
        ];
      const table = params?.[0] ?? "";
      const shape = state.get(table);
      if (sql.includes("information_schema.tables"))
        return [shape ? [{ tableType: shape.tableType }] : []];
      if (sql.includes("information_schema.columns"))
        return [structuredClone(shape?.columns ?? [])];
      if (sql.includes("information_schema.statistics"))
        return [structuredClone(shape?.indexes ?? [])];
      throw new Error("Unexpected query: " + sql);
    }),
    execute: vi.fn(async (sql: string) => {
      events.push(sql);
      const table = sql.match(/^CREATE TABLE `([^`]+)`/)?.[1];
      if (!table || !tables.includes(table) || !sql.endsWith("\n);"))
        throw new Error("Unapproved DDL");
      if (
        sql.match(
          /\b(?:ALTER|DROP|UPDATE|INSERT|DELETE|TRUNCATE)\b(?! CURRENT_TIMESTAMP)/
        )
      )
        throw new Error("Historical write");
      if (table === memory) {
        if (
          !sql.includes(
            "INDEX `construction_input_memory_recent_index` (`userId`,`projectId`,`field`,`usedAt`)"
          )
        )
          throw new Error("Index was not created atomically with table");
        if (sql.includes("CREATE INDEX")) throw new Error("Separate index DDL");
      }
      if (state.has(table)) throw new Error("Existing table was recreated");
      if (table === failTable) {
        failTable = undefined;
        throw new Error("Simulated DDL interruption");
      }
      const shape = fixture(table);
      if (table === options.corruptCreated) shape.columns[1].type = "text";
      state.set(table, shape);
      return [{}];
    }),
    end: vi.fn(async () => {}),
  };
}
const apply = (db: ReturnType<typeof mockDb>) =>
  applyConstructionAssistantMigration(db, bytes, sha);
const released = (db: ReturnType<typeof mockDb>) =>
  db.query.mock.calls.filter(([sql]) => sql.includes("RELEASE_LOCK")).length;

function driftCase(
  title: string,
  mutate: (shape: Shape) => void,
  table = memory
) {
  return { title, mutate, table };
}
const drifts = [
  driftCase("missing column", s => {
    s.columns.pop();
  }),
  driftCase("extra column", s => {
    s.columns.push({ ...s.columns[1], name: "unexpected", position: 9 });
  }),
  driftCase("duplicate column replacing another", s => {
    s.columns[2] = { ...s.columns[1], position: 3 };
  }),
  driftCase("column order", s => {
    [s.columns[1], s.columns[2]] = [s.columns[2], s.columns[1]];
  }),
  driftCase("varchar width", s => {
    s.columns[3].type = "varchar(64)";
  }),
  driftCase("text type", s => {
    s.columns[4].type = "longtext";
  }),
  driftCase("unsigned bigint", s => {
    s.columns[0].type = "bigint unsigned";
  }),
  driftCase("integer display-width is not authorized", s => {
    s.columns[1].type = "int(11)";
  }),
  driftCase("nullable", s => {
    s.columns[1].nullable = "YES";
  }),
  driftCase("unexpected default", s => {
    s.columns[1].defaultValue = "0";
  }),
  driftCase("missing auto_increment", s => {
    s.columns[0].extraValue = "";
  }),
  driftCase("unexpected auto_increment", s => {
    s.columns[1].extraValue = "auto_increment";
  }),
  driftCase("unexpected on update", s => {
    s.columns[6].extraValue = "on update CURRENT_TIMESTAMP";
  }),
  driftCase("generation expression", s => {
    s.columns[1].generationExpression = "1 + 1";
  }),
  driftCase("default expression with timezone or precision", s => {
    s.columns[6].defaultValue = "current_timestamp(3)";
  }),
  driftCase("arbitrary timestamp expression", s => {
    s.columns[6].defaultValue = "now() + interval 1 day";
  }),
  driftCase("quoted current_timestamp is not a function", s => {
    s.columns[6].defaultValue = "'current_timestamp'";
  }),
  driftCase("missing index", s => {
    s.indexes = s.indexes.filter(
      x => x.name !== "construction_input_memory_recent_index"
    );
  }),
  driftCase("extra index", s => {
    s.indexes.push({ ...s.indexes[0], name: "unexpected" });
  }),
  driftCase("index column order", s => {
    const rows = s.indexes.filter(
      x => x.name === "construction_input_memory_recent_index"
    );
    [rows[0].columnName, rows[1].columnName] = [
      rows[1].columnName,
      rows[0].columnName,
    ];
  }),
  driftCase("index sequence", s => {
    s.indexes[0].sequence = 2;
  }),
  driftCase("unique index became nonunique", s => {
    s.indexes.find(x => x.name.endsWith("_unique"))!.nonUnique = 1;
  }),
  driftCase("nonunique index became unique", s => {
    s.indexes.find(x => x.name.endsWith("_index"))!.nonUnique = 0;
  }),
  driftCase("prefix index", s => {
    s.indexes.find(x => x.columnName === "field")!.subPart = 10;
  }),
  driftCase("descending index", s => {
    s.indexes[0].collation = "D";
  }),
  driftCase("hash index", s => {
    s.indexes[0].indexType = "HASH";
  }),
  driftCase("table is a view", s => {
    s.tableType = "VIEW";
  }),
  driftCase(
    "enum label case",
    s => {
      s.columns[3].type = "enum('AI','voice')";
    },
    usage
  ),
  driftCase(
    "enum label order",
    s => {
      s.columns[3].type = "enum('voice','ai')";
    },
    usage
  ),
  driftCase(
    "noncanonical numeric default",
    s => {
      s.columns[4].defaultValue = "00";
    },
    usage
  ),
  driftCase(
    "missing updatedAt on-update",
    s => {
      s.columns[6].extraValue = "DEFAULT_GENERATED";
    },
    usage
  ),
  driftCase(
    "on-update precision",
    s => {
      s.columns[6].extraValue = "on update CURRENT_TIMESTAMP(3)";
    },
    usage
  ),
];

describe("施工助手0096仅新增两表的安全迁移", () => {
  it("真实文件摘要固定，已批准DDL仅涉及两表及内联索引", () => {
    expect(sha).toBe(CONSTRUCTION_ASSISTANT_MIGRATION_SHA256);
    expect(CONSTRUCTION_ASSISTANT_MIGRATION_FILE).toBe(
      "0096_cold_sentinel.sql"
    );
    expect(validateConstructionAssistantMigration(bytes, sha)).toBe(sha);
  });
  it.each([
    undefined,
    "",
    "0".repeat(64),
    sha.toUpperCase(),
    sha + "\n",
    "x".repeat(64),
  ])("错误或格式不合法摘要%s在任何DB查询前拒绝", async expectedSha => {
    const db = mockDb();
    await expect(
      applyConstructionAssistantMigration(db, bytes, expectedSha)
    ).rejects.toThrow("MIGRATION_SHA_MISMATCH");
    expect(db.query).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });
  it.each([
    (text: string) => text + "\nDROP TABLE users;",
    (text: string) => text.replace("construction_input_memory", "users"),
    (text: string) => text.replace("varchar(32)", "varchar(99)"),
    (text: string) => text.replace("CREATE INDEX", "DROP INDEX"),
    (text: string) => text + "\nSELECT 'unexpected';",
  ])("额外或被改动SQL即使外部摘要匹配仍拒绝", async mutate => {
    const altered = Buffer.from(mutate(bytes.toString()));
    const alteredSha = createHash("sha256").update(altered).digest("hex");
    const db = mockDb();
    await expect(
      applyConstructionAssistantMigration(db, altered, alteredSha)
    ).rejects.toThrow("UNEXPECTED_STATEMENT");
    expect(db.query).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });
  it.each([0, null, "0"])("未取得30秒锁%s时不读取结构或执行DDL", async lock => {
    const db = mockDb({}, { lock });
    await expect(apply(db)).rejects.toThrow("MIGRATION_BUSY");
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query).toHaveBeenCalledWith(
      "SELECT GET_LOCK('yx_construction_assistant_0096', 30) AS acquired"
    );
    expect(db.execute).not.toHaveBeenCalled();
    expect(released(db)).toBe(0);
  });
  it("没有选中数据库则failclosed且释放锁", async () => {
    const db = mockDb({}, { databaseName: null });
    await expect(apply(db)).rejects.toThrow("DATABASE_NOT_CONFIGURED");
    expect(db.execute).not.toHaveBeenCalled();
    expect(released(db)).toBe(1);
  });
  it("fresh全表先预检，然后仅execute两次CREATE并回读核验；重复执行不再写", async () => {
    const db = mockDb();
    expect(await apply(db)).toEqual({
      tables: {
        [usage]: { applied: true, verified: true },
        [memory]: { applied: true, verified: true },
      },
    });
    expect(db.execute).toHaveBeenCalledTimes(2);
    const firstDDL = db.events.findIndex(sql => sql.startsWith("CREATE TABLE"));
    for (const table of tables) {
      expect(
        db.events
          .slice(0, firstDDL)
          .some(
            sql =>
              sql.includes("information_schema.statistics") &&
              sql.endsWith(":" + table)
          )
      ).toBe(true);
    }
    for (const table of tables) {
      const ddl = db.events.findIndex(sql =>
        sql.startsWith(`CREATE TABLE \`${table}\``)
      );
      expect(
        db.events
          .slice(ddl + 1)
          .some(
            sql =>
              sql.includes("information_schema.columns") &&
              sql.endsWith(":" + table)
          )
      ).toBe(true);
    }
    expect(await apply(db)).toEqual({
      tables: {
        [usage]: { applied: false, verified: true },
        [memory]: { applied: false, verified: true },
      },
    });
    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(released(db)).toBe(2);
    expect(
      db.events.some(sql =>
        /^(?:ALTER|DROP|INSERT|DELETE|UPDATE|BEGIN|COMMIT|ROLLBACK)\b/.test(sql)
      )
    ).toBe(false);
  });
  it("既有完整两表完全幂等且成功摘要只包含两表applied/verified", async () => {
    const db = mockDb({ [usage]: fixture(usage), [memory]: fixture(memory) });
    const result = await apply(db);
    expect(result).toEqual({
      tables: {
        [usage]: { applied: false, verified: true },
        [memory]: { applied: false, verified: true },
      },
    });
    expect(db.execute).not.toHaveBeenCalled();
    expect(released(db)).toBe(1);
  });
  it.each(tables)("部分创建%s后重试仅创建另一缺失表", async table => {
    const db = mockDb({ [table]: fixture(table) });
    const result = await apply(db);
    expect(result.tables[table]).toEqual({ applied: false, verified: true });
    expect(result.tables[tables.find(t => t !== table)!]).toEqual({
      applied: true,
      verified: true,
    });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
  it("MySQL DDL中断不rollback已建完整表，释放锁后重试安全补齐", async () => {
    const db = mockDb({}, { failTable: memory });
    await expect(apply(db)).rejects.toThrow("Simulated DDL interruption");
    expect(db.state.has(usage)).toBe(true);
    expect(db.state.has(memory)).toBe(false);
    expect(released(db)).toBe(1);
    expect(await apply(db)).toEqual({
      tables: {
        [usage]: { applied: false, verified: true },
        [memory]: { applied: true, verified: true },
      },
    });
    expect(
      db.execute.mock.calls.filter(([sql]) =>
        sql.startsWith(`CREATE TABLE \`${usage}\``)
      )
    ).toHaveLength(1);
    expect(released(db)).toBe(2);
  });
  it.each(drifts)(
    "已有$table存在$title漂移，任何DDL前拒绝且不修复",
    async ({ table, mutate }) => {
      const shape = fixture(table);
      mutate(shape);
      const db = mockDb({ [table]: shape });
      await expect(apply(db)).rejects.toThrow("EXISTING_SHAPE_MISMATCH");
      expect(db.execute).not.toHaveBeenCalled();
      expect(released(db)).toBe(1);
      expect(db.state.size).toBe(1);
    }
  );
  it.each([
    "now()",
    "(now())",
    "NOW(0)",
    "current_timestamp",
    "CURRENT_TIMESTAMP()",
    "current_timestamp(0)",
    "(CURRENT_TIMESTAMP())",
  ])("MySQL等价时间默认%s可接受，其他字段不做宽松归一化", async timestamp => {
    const existing = Object.fromEntries(
      tables.map(table => [table, fixture(table)])
    );
    for (const table of tables)
      for (const c of existing[table].columns) {
        if (c.type !== "timestamp") continue;
        c.defaultValue = timestamp;
        c.extraValue = c.name === "updatedAt" ? `on update ${timestamp}` : "";
      }
    existing[usage].columns[4].defaultValue = 0;
    const db = mockDb(existing, { lock: "1" });
    await expect(apply(db)).resolves.toMatchObject({
      tables: { [usage]: { verified: true }, [memory]: { verified: true } },
    });
    expect(db.execute).not.toHaveBeenCalled();
  });
  it("仅剩残留metadata不能当成不存在而CREATE", async () => {
    const db = mockDb({ [memory]: fixture(memory) });
    const original = db.query.getMockImplementation()!;
    db.query.mockImplementation(async (sql, params) => {
      if (sql.includes("information_schema.tables")) return [[]];
      return original(sql, params);
    });
    await expect(apply(db)).rejects.toThrow("EXISTING_SHAPE_MISMATCH");
    expect(db.execute).not.toHaveBeenCalled();
    expect(released(db)).toBe(1);
  });
  it("回读新表结构漂移立即失败，不能继续创建后续表", async () => {
    const db = mockDb({}, { corruptCreated: usage });
    await expect(apply(db)).rejects.toThrow("EXISTING_SHAPE_MISMATCH");
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.state.has(memory)).toBe(false);
    expect(released(db)).toBe(1);
  });
  it("预检后出现不合作创建者的漂移，不执行CREATE且释放锁", async () => {
    const db = mockDb();
    const original = db.query.getMockImplementation()!;
    let reads = 0;
    db.query.mockImplementation(async (sql, params) => {
      if (
        sql.includes("information_schema.tables") &&
        params?.[0] === usage &&
        ++reads === 2
      ) {
        const shape = fixture(usage);
        shape.columns[1].type = "text";
        db.state.set(usage, shape);
      }
      return original(sql, params);
    });
    await expect(apply(db)).rejects.toThrow("EXISTING_SHAPE_MISMATCH");
    expect(db.execute).not.toHaveBeenCalled();
    expect(released(db)).toBe(1);
  });
  it("实际入口限制basename；错误SHA或SQL在连接前拒绝", async () => {
    const db = mockDb();
    const readFile = vi.fn(async () => bytes);
    const createConnection = vi.fn(async () => db);
    const deps = {
      databaseUrl: "mysql://not-logged:test@invalid.local/test",
      readFile,
      createConnection,
    };
    await expect(
      runConstructionAssistantMigration("0095_eager_madrox.sql", sha, deps)
    ).rejects.toThrow("INVALID_CONFIGURATION");
    expect(readFile).not.toHaveBeenCalled();
    await expect(
      runConstructionAssistantMigration(
        CONSTRUCTION_ASSISTANT_MIGRATION_FILE,
        "0".repeat(64),
        deps
      )
    ).rejects.toThrow("MIGRATION_SHA_MISMATCH");
    expect(createConnection).not.toHaveBeenCalled();
    const extra = Buffer.from(bytes + "\nDROP TABLE users;");
    readFile.mockResolvedValue(extra);
    await expect(
      runConstructionAssistantMigration(
        CONSTRUCTION_ASSISTANT_MIGRATION_FILE,
        createHash("sha256").update(extra).digest("hex"),
        deps
      )
    ).rejects.toThrow("UNEXPECTED_STATEMENT");
    expect(createConnection).not.toHaveBeenCalled();
  });
  it("实际入口使用给定DATABASE_URL且不打印凭据，结束连接", async () => {
    const db = mockDb();
    const databaseUrl = "mysql://not-logged:test@invalid.local/test";
    const createConnection = vi.fn(async () => db);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await runConstructionAssistantMigration(
        "/reviewed/0096_cold_sentinel.sql",
        sha,
        {
          databaseUrl,
          readFile: vi.fn(async () => bytes),
          createConnection,
        }
      );
      expect(createConnection).toHaveBeenCalledTimes(1);
      expect(createConnection).toHaveBeenCalledWith(databaseUrl);
      expect(db.end).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
  it("结构漂移失败时实际入口仍结束连接", async () => {
    const shape = fixture(memory);
    shape.columns[0].type = "int";
    const db = mockDb({ [memory]: shape });
    await expect(
      runConstructionAssistantMigration(
        CONSTRUCTION_ASSISTANT_MIGRATION_FILE,
        sha,
        {
          databaseUrl: "mysql://not-logged:test@invalid.local/test",
          readFile: vi.fn(async () => bytes),
          createConnection: vi.fn(async () => db),
        }
      )
    ).rejects.toThrow("EXISTING_SHAPE_MISMATCH");
    expect(db.end).toHaveBeenCalledTimes(1);
    expect(released(db)).toBe(1);
  });
  it("CLI失败仅打印安全摘要，明确DDL不可回滚；不泄漏连接字符串", () => {
    const secret =
      "mysql://secret-user:secret-password@invalid.local/secret-database";
    const script = fileURLToPath(
      new URL(
        "../scripts/apply-construction-assistant-migration.mjs",
        import.meta.url
      )
    );
    try {
      execFileSync(process.execPath, [script, "wrong.sql", sha], {
        env: { ...process.env, DATABASE_URL: secret },
        encoding: "utf8",
        stdio: "pipe",
      });
      throw new Error("CLI should have failed");
    } catch (error) {
      const failure = error as {
        status: number;
        stdout: string;
        stderr: string;
      };
      expect(failure.status).toBe(1);
      expect(failure.stdout).toBe("");
      expect(failure.stderr).toContain("DDL不能事务回滚");
      expect(failure.stderr).toContain("不会修改旧表历史数据");
      expect(failure.stderr).not.toContain("secret-");
      expect(failure.stderr).not.toContain("mysql://");
    }
  });
  it("结构断言验证真实字段与完整索引集合", () => {
    for (const table of tables)
      expect(() =>
        assertConstructionAssistantShape(table, fixture(table))
      ).not.toThrow();
  });
});
