import type { TrpcContext } from "./_core/context";
import { TRPCError } from "@trpc/server";
import { type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./access", async importOriginal => {
  const actual = await importOriginal<typeof import("./access")>();
  return { ...actual, assertSuperAdmin: vi.fn() };
});
vi.mock("./services/selfHostDatabaseBackup", () => ({
  createSelfHostDatabaseBackup: vi.fn(),
  getSelfHostDatabaseBackupStatus: vi.fn(),
  getVerifiedSelfHostDatabaseBackupArtifact: vi.fn(),
}));

import { auditLogs, users } from "../drizzle/schema";
import { assertSuperAdmin } from "./access";
import { getDb } from "./db";
import { adminRouter } from "./routers/admin";
import {
  createSelfHostDatabaseBackup,
  getSelfHostDatabaseBackupStatus,
} from "./services/selfHostDatabaseBackup";

function createAdminContext(): TrpcContext {
  const user = {
    id: 1,
    openId: "full-backup-admin",
    email: "admin@example.com",
    name: "备份管理员",
    loginMethod: "manus" as const,
    role: "admin" as const,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    lastSignedIn: new Date("2026-07-01T00:00:00.000Z"),
  };
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

type AuditWrite = typeof auditLogs.$inferInsert;
type HistoryRow = {
  id: number;
  createdAt: Date;
  action: string;
  operatorName: string | null;
  summary?: string | null;
  module?: string;
  targetType?: string | null;
  targetId?: string | null;
  credentials?: string;
  filePath?: string;
};

const descriptions = {
  requested: "已提交完整备份请求，结果以完成记录和新的可用备份为准",
  success: "已生成并逐表校验新的完整备份",
  failed:
    "启动或结果校验未完成；上次成功备份仍保留，请结合时间查看受控服务日志",
};

function verifiedBackup(createdAt = "2026-07-15T03:00:00.000Z") {
  return {
    backupId: "a".repeat(64),
    createdAt,
    tableCount: 116,
    compressedBytes: 4096,
    sha256: "a".repeat(64),
    verification: {
      gzipIntegrity: "passed" as const,
      allTableDefinitionsPresent: true,
    },
    retention: { keepDays: 14, removedFiles: [] as string[] },
  };
}

/** In-memory audit fixture: no application DB, filesystem backup or service launch. */
function createAuditDb(initialRows: HistoryRow[] = []) {
  const rows = [...initialRows];
  const events: string[] = [];
  const values = vi.fn(async (value: AuditWrite) => {
    const id = Math.max(0, ...rows.map(row => row.id)) + 1;
    events.push(value.action);
    rows.push({
      ...value,
      id,
      createdAt: value.createdAt ?? new Date("2026-07-15T03:00:00.000Z"),
      operatorName: createAdminContext().user!.name,
    });
    return [{ insertId: id }];
  });
  // Keep raw fixture columns even when a projection is supplied: assert both the
  // SQL projection and the response allowlist independently, so neither can leak.
  const query = {
    from: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(async (limit: number) =>
      [...rows].sort((left, right) => right.id - left.id).slice(0, limit)
    ),
  };
  query.from.mockReturnValue(query);
  query.leftJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  const db = {
    select: vi.fn((_projection?: Record<string, unknown>) => query),
    insert: vi.fn((_table: typeof auditLogs) => ({ values })),
  };
  vi.mocked(getDb).mockResolvedValue(
    db as unknown as NonNullable<Awaited<ReturnType<typeof getDb>>>
  );
  return { db, query, values, rows, events };
}

function expectNoBackupServiceCalls() {
  expect(createSelfHostDatabaseBackup).not.toHaveBeenCalled();
  expect(getSelfHostDatabaseBackupStatus).not.toHaveBeenCalled();
}

describe("超级管理完整备份操作记录", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(assertSuperAdmin).mockResolvedValue(createAdminContext().user!);
    vi.mocked(getSelfHostDatabaseBackupStatus).mockResolvedValue({
      configured: true,
      executable: true,
      latestSuccess: null,
      latestFailure: null,
      browserDownload: { enabled: false, available: false },
    });
  });

  it.each(["fullHistory", "createFull"] as const)(
    "%s 未获超级管理员授权时拒绝，且不访问数据库或启动备份",
    async procedure => {
      const fixture = createAuditDb();
      const ctx = createAdminContext();
      vi.mocked(assertSuperAdmin).mockRejectedValue(
        new TRPCError({ code: "FORBIDDEN", message: "仅超级管理员可操作" })
      );

      await expect(
        adminRouter.createCaller(ctx).backup[procedure]()
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
      });

      expect(assertSuperAdmin).toHaveBeenCalledWith(ctx);
      expect(getDb).not.toHaveBeenCalled();
      expect(fixture.db.select).not.toHaveBeenCalled();
      expect(fixture.db.insert).not.toHaveBeenCalled();
      expectNoBackupServiceCalls();
    }
  );

  it("历史仅查询全库备份三种动作的最近 20 条，并返回固定脱敏 DTO 和状态", async () => {
    const actions = ["create_requested", "create", "create_failed"] as const;
    const statuses = ["requested", "success", "failed"] as const;
    const rawSummary =
      "旧原始日志 mysql://root:legacy-password@localhost/db /root/mysql.cnf /var/backups/private.sql.gz";
    const inputRows: HistoryRow[] = Array.from({ length: 25 }, (_, index) => ({
      id: 100 - index,
      createdAt: new Date(
        `2026-07-${String(25 - index).padStart(2, "0")}T03:00:00.000Z`
      ),
      action: actions[index % actions.length],
      operatorName: index === 1 ? null : index === 2 ? "" : "历史操作者",
      module: "backup",
      targetType: "full_database_backup",
      targetId: "/var/backups/private.sql.gz",
      summary: rawSummary,
      credentials: "legacy-password",
      filePath: "/root/mysql.cnf",
    }));
    const { db, query } = createAuditDb(inputRows);
    const ctx = createAdminContext();

    const result = await adminRouter.createCaller(ctx).backup.fullHistory();

    expect(assertSuperAdmin).toHaveBeenCalledWith(ctx);
    expect(db.select).toHaveBeenCalledWith({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      action: auditLogs.action,
      operatorName: users.name,
    });
    expect(query.from).toHaveBeenCalledWith(auditLogs);
    expect(query.leftJoin.mock.calls[0][0]).toBe(users);
    const dialect = new MySqlDialect();
    const join = dialect.sqlToQuery(query.leftJoin.mock.calls[0][1] as SQL);
    expect(join.sql).toBe("`audit_logs`.`userId` = `users`.`id`");
    const filter = dialect.sqlToQuery(query.where.mock.calls[0][0] as SQL);
    expect(filter.params).toEqual([
      "backup",
      "full_database_backup",
      "create_requested",
      "create",
      "create_failed",
    ]);
    expect(filter.sql).toBe(
      "(`audit_logs`.`module` = ? and `audit_logs`.`targetType` = ? and `audit_logs`.`action` in (?, ?, ?))"
    );
    expect(dialect.sqlToQuery(query.orderBy.mock.calls[0][0] as SQL).sql).toBe(
      "`audit_logs`.`id` desc"
    );
    expect(query.limit).toHaveBeenCalledOnce();
    expect(query.limit).toHaveBeenCalledWith(20);
    expect(result).toHaveLength(20);
    expect(result).toEqual(
      inputRows.slice(0, 20).map((row, index) => ({
        id: row.id,
        createdAt: row.createdAt,
        operatorName: row.operatorName || "超级管理员",
        status: statuses[index % statuses.length],
        description: descriptions[statuses[index % statuses.length]],
      }))
    );
    for (const row of result) {
      expect(Object.keys(row).sort()).toEqual([
        "createdAt",
        "description",
        "id",
        "operatorName",
        "status",
      ]);
    }
    const serialized = JSON.stringify(result);
    for (const secret of [
      rawSummary,
      "legacy-password",
      "mysql://",
      "/root/",
      "/var/backups/",
      "summary",
      "credentials",
      "filePath",
      "targetId",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(db.insert).not.toHaveBeenCalled();
    expectNoBackupServiceCalls();
  });

  it("历史在数据库不可用时返回空列表，不启动或读取备份服务", async () => {
    vi.mocked(getDb).mockResolvedValue(null);

    await expect(
      adminRouter.createCaller(createAdminContext()).backup.fullHistory()
    ).resolves.toEqual([]);

    expect(assertSuperAdmin).toHaveBeenCalledOnce();
    expect(getDb).toHaveBeenCalledOnce();
    expectNoBackupServiceCalls();
  });

  it("先持久化请求记录，再启动备份，校验成功后新增成功记录并返回本次产物", async () => {
    const fixture = createAuditDb();
    const backup = verifiedBackup();
    vi.mocked(createSelfHostDatabaseBackup).mockImplementation(async () => {
      expect(fixture.values).toHaveBeenCalledOnce();
      expect(fixture.rows.map(row => row.action)).toEqual(["create_requested"]);
      fixture.events.push("service_started");
      return backup;
    });

    await expect(
      adminRouter.createCaller(createAdminContext()).backup.createFull()
    ).resolves.toEqual(backup);

    expect(fixture.events).toEqual([
      "create_requested",
      "service_started",
      "create",
    ]);
    expect(fixture.db.insert.mock.calls.map(call => call[0])).toEqual([
      auditLogs,
      auditLogs,
    ]);
    expect(fixture.values.mock.calls.map(call => call[0])).toEqual([
      {
        userId: 1,
        module: "backup",
        action: "create_requested",
        targetType: "full_database_backup",
        targetId: null,
        summary: "超级管理员提交完整数据库备份请求；尚未宣布完成",
      },
      {
        userId: 1,
        module: "backup",
        action: "create",
        targetType: "full_database_backup",
        targetId: backup.sha256.slice(0, 16),
        summary: "创建完整数据库备份：116 张表，gzip 校验与逐表定义校验通过",
      },
    ]);
    expect(createSelfHostDatabaseBackup).toHaveBeenCalledOnce();
    expect(createSelfHostDatabaseBackup).toHaveBeenCalledWith();
    expect(getSelfHostDatabaseBackupStatus).not.toHaveBeenCalled();
  });

  it.each([
    "备份启动授权未通过，任务尚未启动",
    "本次未生成新的已验证备份；页面保留的是上次成功备份",
  ])(
    "失败仅新增请求和失败记录，不将旧成功产物当成本次成功：%s",
    async message => {
      const previousBackup = verifiedBackup("2026-07-01T03:00:00.000Z");
      const previousSuccess: HistoryRow = {
        id: 41,
        createdAt: new Date(previousBackup.createdAt),
        operatorName: "历史管理员",
        action: "create",
        module: "backup",
        targetType: "full_database_backup",
        targetId: previousBackup.sha256.slice(0, 16),
        summary: "旧成功原始日志 /var/backups/old.sql.gz password=old-secret",
      };
      const previousSnapshot = { ...previousSuccess };
      const fixture = createAuditDb([previousSuccess]);
      vi.mocked(getSelfHostDatabaseBackupStatus).mockResolvedValue({
        configured: true,
        executable: true,
        latestSuccess: previousBackup,
        latestFailure: null,
        browserDownload: { enabled: false, available: false },
      });
      vi.mocked(createSelfHostDatabaseBackup).mockImplementation(async () => {
        expect(fixture.values).toHaveBeenCalledOnce();
        fixture.events.push("service_started");
        throw new Error(message);
      });
      const caller = adminRouter.createCaller(createAdminContext());

      await expect(caller.backup.createFull()).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message,
      });

      expect(fixture.events).toEqual([
        "create_requested",
        "service_started",
        "create_failed",
      ]);
      expect(fixture.values).toHaveBeenCalledTimes(2);
      expect(fixture.values.mock.calls.map(call => call[0].action)).toEqual([
        "create_requested",
        "create_failed",
      ]);
      expect(fixture.values.mock.calls[0][0]).toMatchObject({
        userId: 1,
        module: "backup",
        targetType: "full_database_backup",
        targetId: null,
      });
      expect(fixture.values.mock.calls[1][0]).toEqual({
        userId: 1,
        module: "backup",
        action: "create_failed",
        targetType: "full_database_backup",
        targetId: null,
        summary:
          "完整备份请求启动或结果校验未完成；请结合操作时间核对应用服务和备份服务日志",
      });
      expect(
        fixture.values.mock.calls.some(call => call[0].action === "create")
      ).toBe(false);
      expect(fixture.rows.find(row => row.id === previousSuccess.id)).toEqual(
        previousSnapshot
      );
      expect(createSelfHostDatabaseBackup).toHaveBeenCalledOnce();
      expect(getSelfHostDatabaseBackupStatus).not.toHaveBeenCalled();

      const history = await caller.backup.fullHistory();
      expect(history.map(row => row.status)).toEqual([
        "failed",
        "requested",
        "success",
      ]);
      expect(history[2]).toEqual({
        id: previousSuccess.id,
        createdAt: previousSuccess.createdAt,
        operatorName: "历史管理员",
        status: "success",
        description: descriptions.success,
      });
      expect(JSON.stringify(history)).not.toContain("old-secret");
      expect(JSON.stringify(history)).not.toContain("/var/backups/");
    }
  );

  it("创建时数据库不可用则拒绝，不能在无法记录请求时启动备份", async () => {
    vi.mocked(getDb).mockResolvedValue(null);

    await expect(
      adminRouter.createCaller(createAdminContext()).backup.createFull()
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "暂时无法记录备份操作，请稍后重试",
    });

    expect(assertSuperAdmin).toHaveBeenCalledOnce();
    expect(getDb).toHaveBeenCalledOnce();
    expectNoBackupServiceCalls();
  });

  it("请求审计写入失败时拒绝，不启动备份或新增成功记录", async () => {
    const fixture = createAuditDb();
    fixture.values.mockRejectedValueOnce(new Error("audit insert unavailable"));

    await expect(
      adminRouter.createCaller(createAdminContext()).backup.createFull()
    ).rejects.toThrow("audit insert unavailable");

    expect(fixture.values).toHaveBeenCalledOnce();
    expect(fixture.values.mock.calls[0][0].action).toBe("create_requested");
    expect(fixture.rows).toEqual([]);
    expectNoBackupServiceCalls();
  });
});
