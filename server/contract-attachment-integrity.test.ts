import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, getTableName, SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import * as schema from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const state = vi.hoisted(() => ({
  db: null as any,
  storagePut: vi.fn(),
  signed: vi.fn(),
  notifications: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: async () => state.db }));
vi.mock("./storage", () => ({
  storagePut: (...args: any[]) => state.storagePut(...args),
  storageGetSignedUrl: (...args: any[]) => state.signed(...args),
}));
vi.mock("./services/businessNotifier", () => ({
  notifyOfficialAccountBusinessEventSafely: (...args: any[]) =>
    state.notifications(...args),
}));
import { contractRouter } from "./routers/contracts";
import { evidenceRouter } from "./routers/evidence";
import { router } from "./_core/trpc";
const mounted = router({ contract: contractRouter, evidence: evidenceRouter });
const caller = (id = 9, role = "user") =>
  mounted.createCaller({
    user: { id, role, name: "合同隔离操作人", openId: `contract-${id}` },
    req: {},
    res: {},
  } as TrpcContext);
const normalize = (v: any): any =>
  v instanceof Date
    ? v.toISOString().slice(0, 23).replace("T", " ")
    : typeof v === "boolean"
      ? Number(v)
      : v && typeof v === "object"
        ? JSON.stringify(v)
        : (v ?? null);
const dialect = new MySqlDialect();
/** Real Drizzle SQL predicates and JOINs executed in isolated in-memory SQLite, never real DB.
 * Only connection, object storage and external notification boundaries are mocked. */
class SqlFixture {
  rows: Record<string, any[]> = {};
  locks: string[] = [];
  lockRace?: { table: string; run: () => void };
  failTable?: string;
  zeroTable?: string;
  rollback() {
    throw new Error("rollback");
  }
  constructor() {
    this.rows = {
      projects: [
        { id: 2, status: "active" },
        { id: 3, status: "active" },
      ],
      system_roles: [{ id: 1, code: "PROJECT_MANAGER", status: "active" }],
      user_role_assignments: [9, 10].map((userId, index) => ({
        id: index + 1,
        userId,
        roleId: 1,
        projectId: 2,
        organizationId: null,
        status: "active",
        validFrom: null,
        validTo: null,
      })),
      system_permissions: ["read", "create", "edit", "submit"]
        .map((action, i) => ({ id: i + 1, module: "contract", action }))
        .concat([{ id: 5, module: "evidence", action: "manage" }]),
      role_permissions: [1, 2, 3, 4, 5].map(permissionId => ({
        id: permissionId,
        roleId: 1,
        permissionId,
      })),
      department_business_scopes: [
        {
          id: 1,
          projectId: 2,
          organizationId: null,
          module: "CONTRACT",
          status: "active",
        },
        {
          id: 2,
          projectId: 2,
          organizationId: null,
          module: "EVIDENCE",
          status: "active",
        },
      ],
      outsource_contracts: [
        {
          id: 5,
          projectId: 2,
          status: "draft",
          createdBy: 9,
          contractNo: "CT-真实旧正式号",
          contractType: "transport",
          counterpartyName: "真实往来方",
          pricingMethod: "trip",
          contractAmount: "100.00",
          attachmentEvidenceId: null,
        },
      ],
      evidence_records: [],
      audit_logs: [],
      audit_log_integrity_events: [],
      audit_log_chain_state: [],
    };
  }
  engine(tables: any[]) {
    const db = new DatabaseSync(":memory:");
    db.function("regexp", (pattern: string, value: any) =>
      Number(new RegExp(pattern, "i").test(String(value ?? "")))
    );
    for (const table of [
      ...new Map(tables.map(t => [getTableName(t), t])).values(),
    ]) {
      const name = getTableName(table),
        rows = this.rows[name] ?? [];
      const columns = [
        ...new Set([
          ...Object.values(getTableColumns(table)).map((c: any) => c.name),
          ...rows.flatMap(r => Object.keys(r)),
        ]),
      ];
      db.exec(
        `CREATE TABLE \`${name}\` (__index INTEGER, ${columns.map(c => `\`${c}\``).join(",")})`
      );
      const insert = db.prepare(
        `INSERT INTO \`${name}\` VALUES (${[0, ...columns].map(() => "?").join(",")})`
      );
      rows.forEach((row, i) =>
        insert.run(i, ...columns.map(c => normalize(row[c])))
      );
    }
    return db;
  }
  match(table: any, condition?: SQL) {
    const name = getTableName(table),
      db = this.engine([table]);
    const q = condition
      ? dialect.sqlToQuery(condition)
      : { sql: "1=1", params: [] };
    const found = db
      .prepare(`SELECT __index FROM \`${name}\` WHERE ${q.sql}`)
      .all(...q.params.map(normalize))
      .map((r: any) => this.rows[name][r.__index]);
    db.close();
    return found;
  }
  select(projection?: any) {
    return {
      from: (table: any) => {
        let condition: SQL | undefined,
          limit = Infinity,
          locked = false;
        const joins: { table: any; on: SQL; type: string }[] = [],
          orders: SQL[] = [];
        const chain: any = {
          where: (v: SQL) => {
            condition = v;
            return chain;
          },
          limit: (v: number) => {
            limit = v;
            return chain;
          },
          orderBy: (...v: SQL[]) => {
            orders.push(...v);
            return chain;
          },
          for: () => {
            locked = true;
            return chain;
          },
          innerJoin: (t: any, on: SQL) => {
            joins.push({ table: t, on, type: "INNER" });
            return chain;
          },
          leftJoin: (t: any, on: SQL) => {
            joins.push({ table: t, on, type: "LEFT" });
            return chain;
          },
          then: (resolve: any, reject: any) =>
            Promise.resolve()
              .then(() => {
                const name = getTableName(table);
                if (locked) {
                  this.locks.push(name);
                  if (this.lockRace?.table === name) {
                    const race = this.lockRace;
                    this.lockRace = undefined;
                    race.run();
                  }
                }
                const db = this.engine([table, ...joins.map(j => j.table)]),
                  params: any[] = [];
                const expression = (s: SQL) => {
                  const q = dialect.sqlToQuery(s);
                  params.push(...q.params.map(normalize));
                  return q.sql;
                };
                const fields = projection
                  ? Object.entries(projection)
                      .map(
                        ([key, value]: any) =>
                          `${value instanceof SQL ? expression(value) : `\`${getTableName(value.table)}\`.\`${value.name}\``} AS \`${key}\``
                      )
                      .join(",")
                  : `\`${name}\`.__index`;
                const sql = `SELECT ${fields} FROM \`${name}\` ${joins.map(j => `${j.type} JOIN \`${getTableName(j.table)}\` ON ${expression(j.on)}`).join(" ")}${condition ? ` WHERE ${expression(condition)}` : ""}${orders.length ? ` ORDER BY ${orders.map(expression).join(",")}` : ""}${Number.isFinite(limit) ? ` LIMIT ${limit}` : ""}`;
                const result = db
                  .prepare(sql)
                  .all(...params)
                  .map((r: any) =>
                    projection
                      ? { ...r }
                      : structuredClone(this.rows[name][r.__index])
                  );
                db.close();
                return result;
              })
              .then(resolve, reject),
        };
        return chain;
      },
    };
  }
  insert(table: any) {
    return {
      values: (value: any) => {
        let duplicate: any;
        const action = async () => {
          const name = getTableName(table);
          if (name === this.failTable)
            throw new Error(`fixture write failure: ${name}`);
          const rows = (this.rows[name] ??= []),
            keys: Record<string, string[]> = {
              business_document_number_allocations: ["requestHash"],
              business_document_number_counters: ["prefix"],
              business_document_creation_receipts: ["requestHash"],
            };
          const prior =
            duplicate &&
            keys[name] &&
            rows.find(r => keys[name].every(k => r[k] === value[k]));
          if (prior) {
            Object.assign(prior, structuredClone(duplicate.set));
            return [{ insertId: prior.id, affectedRows: 1 }];
          }
          const id = value.id ?? Math.max(0, ...rows.map(r => r.id ?? 0)) + 1;
          const defaults =
            name === "business_document_number_allocations"
              ? { number: null, prefix: null, sequence: null }
              : name === "business_document_creation_receipts"
                ? { resultJson: null }
                : {};
          rows.push({ id, ...defaults, ...structuredClone(value) });
          return [{ insertId: id, affectedRows: 1 }];
        };
        const chain: any = {
          then: (r: any, e: any) => action().then(r, e),
          onDuplicateKeyUpdate: (o: any) => {
            duplicate = o;
            return chain;
          },
          $returningId: async () => [{ id: (await action())[0].insertId }],
        };
        return chain;
      },
    };
  }
  update(table: any) {
    return {
      set: (value: any) => ({
        where: async (condition: SQL) => {
          const name = getTableName(table);
          if (name === this.failTable)
            throw new Error(`fixture write failure: ${name}`);
          const rows = this.match(table, condition);
          if (name === this.zeroTable) return [{ affectedRows: 0 }];
          rows.forEach(r => Object.assign(r, structuredClone(value)));
          return [{ affectedRows: rows.length }];
        },
      }),
    };
  }
  async transaction<T>(callback: (tx: SqlFixture) => Promise<T>): Promise<T> {
    const before = structuredClone(this.rows);
    try {
      return await callback(this);
    } catch (e) {
      this.rows = before;
      throw e;
    }
  }
}
const jpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==",
  "base64"
);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY1kAAAAASUVORK5CYII=",
  "base64"
);
const input = {
  projectId: 2,
  contractType: "transport" as const,
  counterpartyName: "真实合同相对方",
  pricingMethod: "trip" as const,
  contractAmount: 123.45,
  unitPrice: 12.34,
  startDate: "2026-11-24",
  endDate: "2027-01-01",
};
const uploadInput = (
  id?: number,
  bytes = jpeg,
  mimeType: "image/jpeg" | "image/png" = "image/jpeg"
) => ({
  projectId: 2,
  id,
  fileName: mimeType === "image/png" ? "合同.png" : "合同.jpg",
  mimeType,
  base64Data: bytes.toString("base64"),
});
let db: SqlFixture;
const objects = new Map<string, string>();
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  vi.clearAllMocks();
  objects.clear();
  vi.stubEnv("JWT_SECRET", "isolated-contract-attachment-root-key");
  db = new SqlFixture();
  state.db = db;
  state.storagePut.mockImplementation(async (key: string, data: string) => {
    objects.set(key, data);
    return { key, url: "unused" };
  });
  state.signed.mockImplementation(
    async (key: string) =>
      `https://isolated.invalid/contract-preview/${encodeURIComponent(key)}`
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          objects.get(decodeURIComponent(url.split("/contract-preview/")[1])),
          { status: 200 }
        )
    )
  );
  state.notifications.mockResolvedValue(undefined);
});
async function uploaded(
  id?: number,
  bytes = jpeg,
  mimeType: "image/jpeg" | "image/png" = "image/jpeg"
) {
  return (
    await caller().contract.uploadAttachment(uploadInput(id, bytes, mimeType))
  ).evidenceId;
}
const evidenceRow = (id: number) =>
  db.rows.evidence_records.find(r => r.id === id)!;
function revoke(kind: string) {
  if (kind === "role")
    db.rows.user_role_assignments.forEach(r => (r.status = "disabled"));
  if (kind === "module")
    db.rows.department_business_scopes.find(
      r => r.module === "CONTRACT"
    )!.status = "disabled";
  if (kind === "scope")
    db.rows.user_role_assignments.forEach(r => (r.projectId = 3));
  if (kind === "edit")
    db.rows.role_permissions = db.rows.role_permissions.filter(
      r => r.permissionId !== 3
    );
}

describe("合同真正专用上传 → save → preview 完整闭环", () => {
  it.each([
    [jpeg, "image/jpeg"],
    [png, "image/png"],
  ] as const)(
    "真实signature %s 的归档/新建/预览与真实allocator",
    async (bytes, mime) => {
      const evidenceId = await uploaded(undefined, bytes, mime);
      expect(evidenceRow(evidenceId)).toMatchObject({
        sourceType: "contract",
        sourceId: "contract_attachment_upload:pending",
        uploadedBy: 9,
        contentBytes: bytes.length,
        contentSha256: createHash("sha256").update(bytes).digest("hex"),
      });
      await caller().contract.previewAttachment({ projectId: 2, evidenceId });
      const result = await caller().contract.save({
        ...input,
        attachmentEvidenceId: evidenceId,
      });
      const contract = db.rows.outsource_contracts.find(
        r => r.id === result.contractId
      )!;
      expect(contract).toMatchObject({
        attachmentEvidenceId: evidenceId,
        status: "draft",
        contractAmount: "123.45",
        unitPrice: "12.34",
        createdBy: 9,
      });
      expect(contract.contractNo).toMatch(/^CT\d{14}0009\d{4}$/);
      expect(db.rows.business_document_number_allocations[0].number).toBe(
        contract.contractNo
      );
      expect(evidenceRow(evidenceId).sourceId).toBe(
        `contract_attachment_upload:${result.contractId}`
      );
      await expect(
        caller(10).contract.previewAttachment({
          projectId: 2,
          id: result.contractId,
          evidenceId,
        })
      ).resolves.toMatchObject({
        evidenceId,
        mimeType: mime,
        url: `data:${mime};base64,${bytes.toString("base64")}`,
      });
      expect(
        db.rows.audit_logs.some(
          r => r.action === "retain_evidence_binding_pointers"
        )
      ).toBe(true);
      expect(db.rows.audit_log_integrity_events.length).toBeGreaterThan(0);
      expect(state.notifications).toHaveBeenCalledOnce();
    }
  );
  it("编辑替换deleted旧pointer保持原No，审计保留前后键，不复活旧影像", async () => {
    const old = await uploaded(5);
    db.rows.outsource_contracts[0].attachmentEvidenceId = old;
    evidenceRow(old).status = "deleted";
    const next = await uploaded(5);
    await caller().contract.save({
      ...input,
      id: 5,
      attachmentEvidenceId: next,
    });
    expect(db.rows.outsource_contracts[0]).toMatchObject({
      contractNo: "CT-真实旧正式号",
      attachmentEvidenceId: next,
      contractAmount: "123.45",
    });
    expect(evidenceRow(old).status).toBe("deleted");
    expect(db.rows.business_document_number_allocations).toBeUndefined();
    const audit = db.rows.audit_logs.find(
      r => r.action === "retain_evidence_binding_pointers"
    )!;
    expect(audit.beforeJson).toContain(evidenceRow(old).fileKey);
    expect(audit.afterJson).toContain(evidenceRow(next).fileKey);
    await caller().contract.previewAttachment({
      projectId: 2,
      id: 5,
      evidenceId: next,
    });
  });
  it("pending一次消费，不能再次用于另一个新合同", async () => {
    const id = await uploaded();
    await caller().contract.save({ ...input, attachmentEvidenceId: id });
    const before = structuredClone(db.rows);
    await expect(
      caller().contract.save({ ...input, attachmentEvidenceId: id })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.rows).toEqual(before);
  });
  it.each(["draft", "suspended"])(
    "编辑%s合同使用真实parent marker",
    async status => {
      db.rows.outsource_contracts[0].status = status;
      const id = await uploaded(5);
      await caller().contract.save({
        ...input,
        id: 5,
        attachmentEvidenceId: id,
      });
      expect(db.rows.outsource_contracts[0].status).toBe(status);
    }
  );
});

describe("来源、scope与权限真实负例", () => {
  it.each([
    { sourceType: "other" },
    { sourceType: "site_photo" },
    { sourceId: null },
    { sourceId: "contract-5" },
    { projectId: 3 },
    { status: "deleted" },
    { uploadedBy: 10 },
    { watermarkJson: "{}" },
    { fileKey: "generic/borrow.jpg" },
    { contentSha256: null },
  ])("拒绝被篡改实际上传产物 %j，save/preview均无写入", async change => {
    const id = await uploaded(5);
    Object.assign(evidenceRow(id), change);
    const before = structuredClone(db.rows);
    await expect(
      caller().contract.save({ ...input, id: 5, attachmentEvidenceId: id })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().contract.previewAttachment({
        projectId: 2,
        id: 5,
        evidenceId: id,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.rows).toEqual(before);
  });
  it("他人私有pending不可借用也不可预览，pending不用于现有合同", async () => {
    const id = await uploaded();
    const before = structuredClone(db.rows);
    await expect(
      caller(10).contract.save({ ...input, attachmentEvidenceId: id })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller(10).contract.previewAttachment({ projectId: 2, evidenceId: id })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().contract.save({ ...input, id: 5, attachmentEvidenceId: id })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.rows).toEqual(before);
  });
  it("另一个真实父合同产物不可借给本合同", async () => {
    db.rows.outsource_contracts.push({
      ...db.rows.outsource_contracts[0],
      id: 7,
      contractNo: "CT-另一真实号",
    });
    const id = await uploaded(7);
    const before = structuredClone(db.rows);
    await expect(
      caller().contract.save({ ...input, id: 5, attachmentEvidenceId: id })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.rows).toEqual(before);
  });
  it.each(["active", "expired", "closed", "void"])(
    "原合同终态%s不准上传或保存",
    async status => {
      const id = await uploaded(5);
      db.rows.outsource_contracts[0].status = status;
      const before = structuredClone(db.rows);
      await expect(uploaded(5)).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        caller().contract.save({ ...input, id: 5, attachmentEvidenceId: id })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(db.rows).toEqual(before);
    }
  );
  it.each([999, 7])("编辑上传必须真实同项目父合同%d", async id => {
    if (id === 7)
      db.rows.outsource_contracts.push({
        ...db.rows.outsource_contracts[0],
        id,
        projectId: 3,
      });
    const before = structuredClone(db.rows);
    await expect(uploaded(id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.storagePut).not.toHaveBeenCalled();
    expect(db.rows).toEqual(before);
  });
  it.each(["role", "module", "scope", "edit"])(
    "项目锁等待后真实%s撤回，upload/save拒绝且不写",
    async kind => {
      const id = await uploaded(5);
      const before = structuredClone(db.rows);
      db.lockRace = { table: "projects", run: () => revoke(kind) };
      await expect(uploaded(5)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(db.rows).toEqual(before);
      db.lockRace = { table: "evidence_records", run: () => revoke(kind) };
      await expect(
        caller().contract.save({ ...input, id: 5, attachmentEvidenceId: id })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(db.rows).toEqual(before);
    }
  );
  it.each(["role", "module", "scope"])(
    "preview附件锁等待后%s撤回不签名",
    async kind => {
      const id = await uploaded(5);
      await caller().contract.save({
        ...input,
        id: 5,
        attachmentEvidenceId: id,
      });
      db.lockRace = { table: "evidence_records", run: () => revoke(kind) };
      await expect(
        caller().contract.previewAttachment({
          projectId: 2,
          id: 5,
          evidenceId: id,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(state.signed).not.toHaveBeenCalled();
    }
  );
  it("EVIDENCE单域角色不能替代CONTRACT；无显式edit的原管理者不能变更", async () => {
    revoke("module");
    await expect(uploaded()).rejects.toMatchObject({ code: "FORBIDDEN" });
    db = new SqlFixture();
    state.db = db;
    db.rows.role_permissions = db.rows.role_permissions.filter(
      r => ![1, 2, 3].includes(r.permissionId)
    );
    await expect(uploaded(5)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each(["suspended", "archived"])(
    "非active项目%s不可上传/save/preview",
    async status => {
      const id = await uploaded();
      db.rows.projects[0].status = status;
      const before = structuredClone(db.rows);
      for (const call of [
        () => uploaded(),
        () => caller().contract.save({ ...input, attachmentEvidenceId: id }),
        () =>
          caller().contract.previewAttachment({ projectId: 2, evidenceId: id }),
      ])
        await expect(call()).rejects.toMatchObject({
          code: status === "archived" ? "FORBIDDEN" : "CONFLICT",
        });
      expect(db.rows).toEqual(before);
    }
  );
  it("原合同hint与锁后pointer变化拒绝，不丢失原快照", async () => {
    const id = await uploaded(5);
    const before = structuredClone(db.rows);
    db.lockRace = {
      table: "evidence_records",
      run: () => (db.rows.outsource_contracts[0].attachmentEvidenceId = 888),
    };
    await expect(
      caller().contract.save({ ...input, id: 5, attachmentEvidenceId: id })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(db.rows).toEqual(before);
  });
});

describe("旧pointer兼容、8MB与事务故障", () => {
  it.each(["active", "deleted"])(
    "omission保留锁后旧%s pointer，无复活",
    async status => {
      const id = await uploaded(5);
      db.rows.outsource_contracts[0].attachmentEvidenceId = id;
      Object.assign(evidenceRow(id), {
        sourceType: "other",
        sourceId: null,
        status,
      });
      await caller().contract.save({ ...input, id: 5 });
      expect(db.rows.outsource_contracts[0].attachmentEvidenceId).toBe(id);
      expect(evidenceRow(id).status).toBe(status);
    }
  );
  it("同ID active旧other/null合法，deleted同ID拒绝", async () => {
    const id = await uploaded(5);
    db.rows.outsource_contracts[0].attachmentEvidenceId = id;
    Object.assign(evidenceRow(id), { sourceType: "other", sourceId: null });
    await caller().contract.save({ ...input, id: 5, attachmentEvidenceId: id });
    await caller().contract.previewAttachment({
      projectId: 2,
      id: 5,
      evidenceId: id,
    });
    evidenceRow(id).status = "deleted";
    const before = structuredClone(db.rows);
    await expect(
      caller().contract.save({ ...input, id: 5, attachmentEvidenceId: id })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.rows).toEqual(before);
  });
  it.each([
    [Buffer.from("not a real image"), "image/jpeg"],
    [jpeg, "image/png"],
    [png, "image/jpeg"],
  ] as const)("拒绝伪signature/MIME %s", async (bytes, mime) => {
    await expect(uploaded(undefined, bytes, mime)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(state.storagePut).not.toHaveBeenCalled();
  });
  it("8MB边界可归档，超1字节及非法base64拒绝", async () => {
    const bytes = Buffer.alloc(8 * 1024 * 1024);
    jpeg.subarray(0, 4).copy(bytes);
    const id = await uploaded(undefined, bytes);
    expect(evidenceRow(id).contentBytes).toBe(bytes.length);
    await expect(
      uploaded(undefined, Buffer.concat([bytes, Buffer.from([0])]))
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().contract.uploadAttachment({
        ...uploadInput(),
        base64Data: "!bad",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.storagePut).toHaveBeenCalledOnce();
  });
  it.each([
    "outsource_contracts",
    "audit_log_integrity_events",
    "business_document_number_allocations",
  ])("创建事务%s失败完整回滚，保留已归档ID可重试", async table => {
    const id = await uploaded();
    const before = structuredClone(db.rows);
    db.failTable = table;
    await expect(
      caller().contract.save({ ...input, attachmentEvidenceId: id })
    ).rejects.toThrow("fixture write failure");
    expect(db.rows).toEqual(before);
    expect(state.notifications).not.toHaveBeenCalled();
    db.failTable = undefined;
    await caller().contract.save({ ...input, attachmentEvidenceId: id });
    expect(state.storagePut).toHaveBeenCalledOnce();
  });
  it.each(["outsource_contracts", "evidence_records"])(
    "业务/绑定CAS %s零写必须回滚",
    async table => {
      const id = await uploaded(
        table === "outsource_contracts" ? 5 : undefined
      );
      const before = structuredClone(db.rows);
      db.zeroTable = table;
      await expect(
        caller().contract.save({
          ...input,
          ...(table === "outsource_contracts" ? { id: 5 } : {}),
          attachmentEvidenceId: id,
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(db.rows).toEqual(before);
      expect(state.notifications).not.toHaveBeenCalled();
    }
  );
  it("上传审计失败不返回ID，预览审计失败不外露URL", async () => {
    const before = structuredClone(db.rows);
    db.failTable = "audit_log_integrity_events";
    await expect(uploaded()).rejects.toThrow("fixture write failure");
    expect(db.rows).toEqual(before);
    db.failTable = undefined;
    const id = await uploaded();
    const uploadedRows = structuredClone(db.rows);
    db.failTable = "audit_log_integrity_events";
    await expect(
      caller().contract.previewAttachment({ projectId: 2, evidenceId: id })
    ).rejects.toThrow("fixture write failure");
    expect(db.rows).toEqual(uploadedRows);
  });
  it("通用list/delete/OCR不暴露专用contract，通用upload禁止contract marker", async () => {
    const id = await uploaded();
    await expect(
      caller(9, "admin").evidence.list({ projectId: 2 })
    ).resolves.toEqual([]);
    await expect(
      caller(9, "admin").evidence.delete({
        id,
        deletionReason: "不应允许通用删除合同私有影像",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(9, "admin").evidence.ocr({ id })).rejects.toMatchObject(
      { code: "FORBIDDEN" }
    );
    await expect(
      caller(9, "admin").evidence.upload({
        ...uploadInput(),
        sourceType: "other",
        sourceId: "contract_attachment_upload:pending",
        description: "试图通用伪装",
        capturedAt: "2026-11-24T03:00:00Z",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("最后整合：一次消费、等待撤权与完整性", () => {
  it("同一合同替换后的旧不同ID即使active也拒绝重新借回，当前sameID可保留", async () => {
    const old = await uploaded(5);
    await caller().contract.save({
      ...input,
      id: 5,
      attachmentEvidenceId: old,
    });
    const next = await uploaded(5);
    await caller().contract.save({
      ...input,
      id: 5,
      attachmentEvidenceId: next,
    });
    const before = structuredClone(db.rows);
    await expect(
      caller().contract.save({ ...input, id: 5, attachmentEvidenceId: old })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.rows).toEqual(before);
    await caller().contract.save({
      ...input,
      id: 5,
      attachmentEvidenceId: next,
    });
    expect(evidenceRow(old).status).toBe("active");
  });
  it("旧generic不同ID不能假装保留指针", async () => {
    const old = await uploaded(5);
    db.rows.outsource_contracts[0].attachmentEvidenceId = old;
    const borrowed = await uploaded(5);
    Object.assign(evidenceRow(borrowed), {
      sourceType: "other",
      sourceId: null,
    });
    const before = structuredClone(db.rows);
    await expect(
      caller().contract.save({
        ...input,
        id: 5,
        attachmentEvidenceId: borrowed,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.rows).toEqual(before);
  });
  it("稳定documentRequestKey回执重放原contractId/No，不再消费pending、不重复通知", async () => {
    const id = await uploaded();
    const request = {
      ...input,
      attachmentEvidenceId: id,
      documentRequestKey: "contract-real-ui-request",
    };
    const first = await caller().contract.save(request);
    const before = structuredClone(db.rows);
    expect(await caller().contract.save(request)).toEqual(first);
    expect(db.rows).toEqual(before);
    expect(state.notifications).toHaveBeenCalledOnce();
    db.lockRace = { table: "projects", run: () => revoke("module") };
    await expect(caller().contract.save(request)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(db.rows).toEqual(before);
  });
  it("实际上传是AES-GCM密文/octet-stream，原图不是公开存储字节", async () => {
    const id = await uploaded();
    const call = state.storagePut.mock.calls[0];
    expect(call[2]).toBe("application/octet-stream");
    expect(call[1]).toMatch(/^v1\./);
    expect(call[1]).not.toContain(jpeg.toString("base64"));
    expect(evidenceRow(id).fileKey).toMatch(/\.encrypted$/);
    const preview = await caller().contract.previewAttachment({
      projectId: 2,
      evidenceId: id,
    });
    expect(preview.url).toBe(
      `data:image/jpeg;base64,${jpeg.toString("base64")}`
    );
    expect(preview.url).not.toContain("https://");
  });
  it.each(["role", "module", "scope"])(
    "对象上传等待后%s撤回，不新增证据/审计",
    async kind => {
      const before = structuredClone(db.rows);
      state.storagePut.mockImplementationOnce(
        async (key: string, data: string) => {
          objects.set(key, data);
          revoke(kind);
          return { key };
        }
      );
      await expect(uploaded(5)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(db.rows).toEqual(before);
      expect(state.notifications).not.toHaveBeenCalled();
    }
  );
  it("原mounted上传submit详细权限在项目锁后撤回须再验", async () => {
    const before = structuredClone(db.rows);
    db.lockRace = {
      table: "projects",
      run: () => {
        db.rows.role_permissions = db.rows.role_permissions.filter(
          r => r.permissionId !== 4
        );
      },
    };
    await expect(uploaded()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.rows).toEqual(before);
    expect(state.storagePut).not.toHaveBeenCalled();
  });
  it("读取/解密等待后module撤回不返回原件，即使初次授权成功", async () => {
    const id = await uploaded();
    const before = structuredClone(db.rows);
    state.signed.mockImplementationOnce(async (key: string) => {
      revoke("module");
      return `https://isolated.invalid/contract-preview/${encodeURIComponent(key)}`;
    });
    await expect(
      caller().contract.previewAttachment({ projectId: 2, evidenceId: id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.rows).toEqual(before);
  });
  it.each(["hash", "bytes", "cipher"])(
    "合同预览%s损坏不外露原图且事务回滚",
    async kind => {
      const id = await uploaded();
      if (kind === "hash") evidenceRow(id).contentSha256 = "a".repeat(64);
      if (kind === "bytes") evidenceRow(id).contentBytes++;
      if (kind === "cipher")
        objects.set(evidenceRow(id).fileKey, "v1.corrupt.cipher.text");
      const before = structuredClone(db.rows);
      await expect(
        caller().contract.previewAttachment({ projectId: 2, evidenceId: id })
      ).rejects.toThrow();
      expect(db.rows).toEqual(before);
    }
  );
  it("远端读取声明超限即拒绝，不完成图片预览", async () => {
    const id = await uploaded();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("oversize", {
            headers: { "content-length": "99999999" },
          })
      )
    );
    await expect(
      caller().contract.previewAttachment({ projectId: 2, evidenceId: id })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
