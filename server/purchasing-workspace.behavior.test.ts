import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { purchasingRouter } from "./routers/finance";
const mock = vi.hoisted(() => ({ db: null as any, roles: ["ALL"], userId: 1 }));
vi.mock("./db", () => ({ getDb: async () => mock.db }));
vi.mock("./access", () => ({
  requireAuthenticatedUser: () => ({ id: mock.userId }),
  assertDepartmentBusinessAccess: async () => {},
  assertProjectInCurrentScope: async (_ctx: unknown, id: number) => {
    if (id !== 1) throw new Error("未授权项目");
  },
  getEffectiveRoleCodes: async () => mock.roles,
  hasUserSpecificOperationPermission: async () =>
    mock.roles.includes("USER_SPECIFIC_READ"),
  assertSuperAdmin: async () => {
    if (!mock.roles.includes("ALL")) throw new Error("仅超级管理员");
    return { id: mock.userId };
  },
  getCurrentDataScope: async () => ({ hasAllProjects: true }),
}));
vi.mock("./services/auditIntegrity", () => ({
  appendIntegrityProtectedAudit: async (tx: any, data: any) =>
    tx.audits.push(data),
}));
vi.mock("./services/businessNotifier", () => ({
  notifyOfficialAccountBusinessEventSafely: async () => {},
}));
vi.mock("./storage", () => ({
  storageGetSignedUrl: async () => "/controlled/test",
  storagePut: async () => ({ key: "private/key" }),
}));
class FakeDb {
  rows: Record<string, any[]> = {
    projects: [{ id: 1 }],
    purchase_orders: [],
    purchase_requests: [],
    inventory_transactions: [],
    evidence_records: [],
    financial_records: [],
    daily_accounting_closures: [],
    suppliers: [],
  };
  audits: any[] = [];
  writes: { table: string; data: any }[] = [];
  locks = 0;
  lockCalls: {
    table: string;
    mode: string;
    params: unknown[];
    inTransaction: boolean;
  }[] = [];
  events: string[] = [];
  private inTransaction = false;
  private hasProjectLock = false;
  private gate: Promise<void> = Promise.resolve();
  select() {
    return { from: (table: any) => this.query(table) };
  }
  private query(table: any) {
    const name = getTableName(table);
    let rows = [...(this.rows[name] ?? [])];
    let params: unknown[] = [];
    const builder: any = {
      where: (condition: SQL) => {
        const q = new MySqlDialect().sqlToQuery(condition);
        params = q.params;
        const columns = [...q.sql.matchAll(/`[^`]+`\.`([^`]+)` = \?/g)].map(
          m => m[1]
        );
        rows = rows.filter(row =>
          columns.every((col, i) => row[col] === q.params[i])
        );
        return builder;
      },
      limit: (n: number) => {
        rows = rows.slice(0, n);
        return builder;
      },
      orderBy: () => builder,
      for: (mode: string) => {
        expect(name).toBe("projects");
        expect(mode).toBe("update");
        expect(params).toEqual([1]);
        expect(this.inTransaction).toBe(true);
        this.lockCalls.push({
          table: name,
          mode,
          params,
          inTransaction: this.inTransaction,
        });
        this.hasProjectLock = true;
        this.events.push("lock:projects");
        this.locks++;
        return builder;
      },
      then: (resolve: any, reject: any) => {
        if (
          this.inTransaction &&
          [
            "inventory_transactions",
            "purchase_orders",
            "financial_records",
          ].includes(name)
        ) {
          expect(this.hasProjectLock, `读取${name}前必须先锁项目行`).toBe(true);
          this.events.push(`read:${name}`);
        }
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return builder;
  }
  insert(table: any) {
    const name = getTableName(table);
    return {
      values: (data: any) => {
        const values = Array.isArray(data) ? data : [data];
        const ids = values.map(row => {
          const id = (this.rows[name]?.length ?? 0) + 1;
          const value = { id, ...row };
          (this.rows[name] ??= []).push(value);
          this.writes.push({ table: name, data: value });
          return { id };
        });
        return {
          $returningId: async () => ids,
          then: (resolve: any) =>
            Promise.resolve([{ insertId: ids[0].id }]).then(resolve),
        };
      },
    };
  }
  update(table: any) {
    const name = getTableName(table);
    return {
      set: (patch: any) => ({
        where: async (condition: SQL) => {
          const rows = await this.query(table).where(condition);
          rows.forEach((row: any) => Object.assign(row, patch));
          this.writes.push({ table: name, data: patch });
          return [{ affectedRows: rows.length }];
        },
      }),
    };
  }
  async transaction<T>(fn: (tx: FakeDb) => Promise<T>): Promise<T> {
    const previous = this.gate;
    let release!: () => void;
    this.gate = new Promise(resolve => {
      release = resolve;
    });
    await previous;
    this.inTransaction = true;
    this.hasProjectLock = false;
    this.events.push("transaction:start");
    const rows = structuredClone(this.rows),
      writes = [...this.writes],
      audits = [...this.audits];
    try {
      return await fn(this);
    } catch (e) {
      this.rows = rows;
      this.writes = writes;
      this.audits = audits;
      throw e;
    } finally {
      this.inTransaction = false;
      this.hasProjectLock = false;
      this.events.push("transaction:end");
      release();
    }
  }
}
const ctx = { user: { id: 1 }, req: {}, res: {} } as TrpcContext;
const caller = () => purchasingRouter.createCaller(ctx);
const baseStock = {
  projectId: 1,
  itemName: "水泥",
  unit: "袋",
  quantity: 1,
  unitCost: 10,
  occurredAt: "2026-11-04T01:00:00.000Z",
};
function order(extra = {}) {
  return {
    id: 1,
    projectId: 1,
    requestId: null,
    createdBy: 1,
    orderNo: "PO-1",
    amount: "100",
    status: "confirmed",
    inventoryItemName: "水泥",
    inventoryUnit: "袋",
    receiptExpectedQuantity: "10",
    ...extra,
  };
}
function stock(extra = {}) {
  return {
    id: 1,
    projectId: 1,
    transactionType: "inbound",
    itemName: "水泥",
    unit: "袋",
    quantity: "10",
    amount: "100",
    unitCost: "10",
    originalOutboundId: null,
    costRuleVersion: "legacy_v1",
    purchaseOrderId: 1,
    ...extra,
  };
}
beforeEach(() => {
  mock.db = new FakeDb();
  mock.roles = ["ALL"];
  mock.userId = 1;
});
describe("采购仓储真实路由行为（模拟DB，不连接实际库）", () => {
  it("无订单入库须负责人授权原因与有效证据，失败无落库", async () => {
    mock.db.rows.evidence_records = [
      { id: 1, projectId: 1, sourceType: "purchase", status: "active" },
    ];
    mock.roles = ["WAREHOUSE_MANAGER"];
    await expect(
      caller().saveInventoryTransaction({
        ...baseStock,
        transactionType: "inbound",
        evidenceId: 1,
        exceptionReason: "期初库存核验入库",
      })
    ).rejects.toThrow("须审批负责人");
    expect(mock.db.rows.inventory_transactions).toHaveLength(0);
    mock.roles = ["ALL"];
    await caller().saveInventoryTransaction({
      ...baseStock,
      transactionType: "inbound",
      evidenceId: 1,
      exceptionReason: "期初库存核验入库",
    });
    expect(mock.db.rows.inventory_transactions[0]).toMatchObject({
      costRuleVersion: "moving_weighted_v2",
      exceptionReason: "期初库存核验入库",
    });
    expect(mock.db.audits).toHaveLength(1);
  });
  it("逐单订单超收被拦截，成功实际收齐才更新订单", async () => {
    mock.db.rows.purchase_orders = [order()];
    mock.db.rows.evidence_records = [
      { id: 1, projectId: 1, sourceType: "purchase", status: "active" },
    ];
    await expect(
      caller().saveInventoryTransaction({
        ...baseStock,
        transactionType: "inbound",
        purchaseOrderId: 1,
        evidenceId: 1,
        quantity: 11,
      })
    ).rejects.toThrow("超过订单剩余");
    await caller().saveInventoryTransaction({
      ...baseStock,
      transactionType: "inbound",
      purchaseOrderId: 1,
      evidenceId: 1,
      quantity: 10,
    });
    expect(mock.db.rows.purchase_orders[0].status).toBe("received");
    expect(mock.db.locks).toBe(2);
  });
  it("并发领用在项目锁事务中防超领且不采信输入单价", async () => {
    mock.db.rows.inventory_transactions = [stock()];
    const calls = await Promise.allSettled([
      caller().saveInventoryTransaction({
        ...baseStock,
        transactionType: "outbound",
        quantity: 7,
        unitCost: 999,
      }),
      caller().saveInventoryTransaction({
        ...baseStock,
        transactionType: "outbound",
        quantity: 7,
        unitCost: 1,
      }),
    ]);
    expect(calls.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(mock.db.rows.inventory_transactions).toHaveLength(2);
    expect(mock.db.rows.inventory_transactions[1].amount).toBe("70");
    expect(mock.db.lockCalls).toHaveLength(2);
    expect(mock.db.events.slice(0, 3)).toEqual([
      "transaction:start",
      "lock:projects",
      "read:inventory_transactions",
    ]);
  });
  it("退库必须原领用并防重复，用原成本不受客户端单价影响", async () => {
    mock.db.rows.inventory_transactions = [
      stock(),
      stock({
        id: 2,
        transactionType: "outbound",
        quantity: "4",
        amount: "40",
        purchaseOrderId: null,
      }),
    ];
    await expect(
      caller().saveInventoryTransaction({
        ...baseStock,
        transactionType: "return",
      })
    ).rejects.toThrow("原领用流水");
    await caller().saveInventoryTransaction({
      ...baseStock,
      transactionType: "return",
      originalOutboundId: 2,
      quantity: 4,
      unitCost: 999,
    });
    expect(mock.db.rows.inventory_transactions[2].amount).toBe("40");
    await expect(
      caller().saveInventoryTransaction({
        ...baseStock,
        transactionType: "return",
        originalOutboundId: 2,
        quantity: 1,
      })
    ).rejects.toThrow("重复退库");
  });
  it("关闭未付订单失败，付款并发只写一笔原financial_records", async () => {
    mock.db.rows.purchase_orders = [order({ status: "received" })];
    mock.db.rows.inventory_transactions = [stock()];
    await expect(
      caller().transitionOrder({ projectId: 1, id: 1, targetStatus: "closed" })
    ).rejects.toThrow("未付余额");
    const payment = {
      projectId: 1,
      orderId: 1,
      amount: 100,
      settledAt: baseStock.occurredAt,
    };
    const results = await Promise.allSettled([
      caller().recordSettlement(payment),
      caller().recordSettlement(payment),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(mock.db.rows.financial_records).toHaveLength(1);
    expect(mock.db.rows.financial_records[0]).toMatchObject({
      sourceType: "purchase_order_settlement",
      sourceId: "1",
      settlementStatus: "paid",
      amount: "100",
    });
    await caller().transitionOrder({
      projectId: 1,
      id: 1,
      targetStatus: "closed",
    });
    expect(mock.db.rows.purchase_orders[0].status).toBe("closed");
  });
  it("发票跨项目/来源或类型混绑失败，补传不自动审核历史订单", async () => {
    mock.db.rows.purchase_orders = [
      order({ status: "draft", hasInvoice: false }),
    ];
    mock.db.rows.evidence_records = [
      { id: 1, projectId: 2, sourceType: "purchase", status: "active" },
    ];
    const bind = {
      projectId: 1,
      orderId: 1,
      evidenceId: 1,
      attachmentKind: "invoice" as const,
      reason: "历史原始发票补传",
    };
    await expect(caller().bindOrderEvidence(bind)).rejects.toThrow("附件失效");
    mock.db.rows.evidence_records = [
      {
        id: 1,
        projectId: 1,
        sourceType: "purchase",
        status: "active",
        watermarkJson: '{"attachmentKind":"document"}',
      },
    ];
    await expect(caller().bindOrderEvidence(bind)).rejects.toThrow(
      "类型不能混绑"
    );
    mock.db.rows.evidence_records[0].watermarkJson =
      '{"attachmentKind":"invoice"}';
    await caller().bindOrderEvidence(bind);
    expect(mock.db.rows.purchase_orders[0]).toMatchObject({
      status: "draft",
      hasInvoice: true,
      invoiceEvidenceId: 1,
    });
  });
  it("非超级管理员无法获取供应商；仓库无实际付款执行权限", async () => {
    mock.roles = ["WAREHOUSE_MANAGER"];
    await expect(caller().listSuppliers()).rejects.toThrow("仅超级管理员");
    await expect(
      caller().recordSettlement({
        projectId: 1,
        orderId: 1,
        amount: 1,
        settledAt: baseStock.occurredAt,
      })
    ).rejects.toThrow("未获财务成本");
  });
  it("并发空库存超领也必须锁项目已有行，全部失败且不写历史", async () => {
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        caller().saveInventoryTransaction({
          ...baseStock,
          transactionType: "outbound",
        })
      )
    );
    expect(results.every(r => r.status === "rejected")).toBe(true);
    expect(mock.db.lockCalls).toHaveLength(2);
    expect(mock.db.rows.inventory_transactions).toHaveLength(0);
  });
  it("并发订单入库防超收，部分收货不覆盖订单原数量", async () => {
    mock.db.rows.purchase_orders = [order({ quantity: "99", unitPrice: "1" })];
    mock.db.rows.evidence_records = [
      { id: 1, projectId: 1, sourceType: "purchase", status: "active" },
    ];
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        caller().saveInventoryTransaction({
          ...baseStock,
          transactionType: "inbound",
          purchaseOrderId: 1,
          evidenceId: 1,
          quantity: 7,
        })
      )
    );
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(mock.db.lockCalls).toHaveLength(2);
    expect(mock.db.rows.purchase_orders[0]).toMatchObject({
      status: "confirmed",
      quantity: "99",
    });
    expect(mock.db.rows.inventory_transactions).toHaveLength(1);
    expect(mock.db.rows.inventory_transactions[0].quantity).toBe("7");
  });
  it("并发退库防原领用超退，跨项目同名或异单位流水不可引用", async () => {
    mock.db.rows.inventory_transactions = [
      stock(),
      stock({
        id: 2,
        transactionType: "outbound",
        quantity: "4",
        amount: "40",
        purchaseOrderId: null,
      }),
    ];
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        caller().saveInventoryTransaction({
          ...baseStock,
          transactionType: "return",
          originalOutboundId: 2,
          quantity: 3,
        })
      )
    );
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(mock.db.rows.inventory_transactions[2]).toMatchObject({
      amount: "30",
      originalOutboundId: 2,
    });
    expect(mock.db.lockCalls).toHaveLength(2);
    for (const patch of [
      { projectId: 2 },
      { unit: "吨" },
      { itemName: "砂石" },
    ]) {
      mock.db.rows.inventory_transactions = [
        stock(),
        stock({ id: 2, transactionType: "outbound", ...patch }),
      ];
      await expect(
        caller().saveInventoryTransaction({
          ...baseStock,
          transactionType: "return",
          originalOutboundId: 2,
        })
      ).rejects.toThrow("原领用流水");
    }
  });
  it("v1/v2混合流水金额不重算，v2新领用按真实累计估值且原历史逐字段保留", async () => {
    const legacy = stock({
      quantity: "10",
      amount: "101.23",
      unitCost: "9.99",
    });
    const v2 = stock({
      id: 2,
      quantity: "10",
      amount: "300",
      costRuleVersion: "moving_weighted_v2",
    });
    mock.db.rows.inventory_transactions = [legacy, v2];
    const original = structuredClone(mock.db.rows.inventory_transactions);
    await caller().saveInventoryTransaction({
      ...baseStock,
      transactionType: "outbound",
      quantity: 5,
      unitCost: 999,
    });
    expect(mock.db.rows.inventory_transactions.slice(0, 2)).toEqual(original);
    expect(mock.db.rows.inventory_transactions[2]).toMatchObject({
      amount: "100.31",
      costRuleVersion: "moving_weighted_v2",
      unitCost: "20.06",
    });
    const result = await caller().listInventory({ projectId: 1 });
    expect(result).toMatchObject({
      balances: [{ balanceQuantity: 15, totalAmount: 300.92, hasLegacy: true }],
    });
    expect(
      mock.db.writes.every(
        (w: any) => w.table !== "inventory_transactions" || w.data.id === 3
      )
    ).toBe(true);
  });
  it("负责人登记独立验收依据，不改quantity历史，已有库存禁止覆盖", async () => {
    mock.db.rows.purchase_orders = [
      order({ quantity: "88", receiptExpectedQuantity: null }),
    ];
    const basis = {
      projectId: 1,
      orderId: 1,
      itemName: "水泥",
      unit: "袋",
      expectedQuantity: 10,
      reason: "实物核验清单确认",
    };
    mock.roles = ["WAREHOUSE_MANAGER"];
    await expect(caller().configureReceiptBasis(basis)).rejects.toThrow(
      "审批负责人"
    );
    mock.roles = ["ALL"];
    await caller().configureReceiptBasis(basis);
    expect(mock.db.rows.purchase_orders[0]).toMatchObject({
      quantity: "88",
      receiptExpectedQuantity: "10",
      receiptBasisReason: basis.reason,
    });
    mock.db.rows.inventory_transactions = [stock()];
    await expect(
      caller().configureReceiptBasis({ ...basis, expectedQuantity: 11 })
    ).rejects.toThrow("禁止覆盖验收依据");
    expect(
      mock.db.audits.filter((a: any) => a.action === "configure_receipt_basis")
    ).toHaveLength(1);
  });
  it("实物未收齐或未实付/作废流水均不能关闭，非库存订单仍需实付款", async () => {
    mock.db.rows.purchase_orders = [order({ status: "received" })];
    mock.db.rows.financial_records = [
      {
        id: 1,
        projectId: 1,
        sourceType: "purchase_order_settlement",
        sourceId: "1",
        amount: "100",
        settlementStatus: "paid",
      },
    ];
    await expect(
      caller().transitionOrder({ projectId: 1, id: 1, targetStatus: "closed" })
    ).rejects.toThrow("不可关闭");
    mock.db.rows.inventory_transactions = [stock()];
    for (const status of ["unpaid", "void"]) {
      mock.db.rows.financial_records[0].settlementStatus = status;
      await expect(
        caller().transitionOrder({
          projectId: 1,
          id: 1,
          targetStatus: "closed",
        })
      ).rejects.toThrow("未付余额");
    }
    mock.db.rows.purchase_orders[0].receiptExpectedQuantity = null;
    await expect(
      caller().transitionOrder({ projectId: 1, id: 1, targetStatus: "closed" })
    ).rejects.toThrow("未付余额");
    mock.db.rows.financial_records[0].settlementStatus = "paid";
    await caller().transitionOrder({
      projectId: 1,
      id: 1,
      targetStatus: "closed",
    });
    expect(mock.db.rows.purchase_orders[0].status).toBe("closed");
  });
  it("历史关闭仍可登记真实余额，超付失败且partial旧流水不批量改paid", async () => {
    mock.db.rows.purchase_orders = [
      order({ status: "closed", receiptExpectedQuantity: null }),
    ];
    const historical = {
      id: 1,
      projectId: 1,
      sourceType: "purchase_order_settlement",
      sourceId: "1",
      amount: "40",
      settlementStatus: "partial",
      direction: "expense",
    };
    mock.db.rows.financial_records = [historical];
    await expect(
      caller().recordSettlement({
        projectId: 1,
        orderId: 1,
        amount: 61,
        settledAt: baseStock.occurredAt,
      })
    ).rejects.toThrow("超过采购订单");
    await caller().recordSettlement({
      projectId: 1,
      orderId: 1,
      amount: 60,
      settledAt: baseStock.occurredAt,
    });
    expect(mock.db.rows.financial_records[0]).toEqual(historical);
    expect(mock.db.rows.financial_records[1]).toMatchObject({
      amount: "60",
      settlementStatus: "paid",
    });
    expect(mock.db.lockCalls).toHaveLength(2);
  });
  it("发票绑定同时检查订单项目、active/来源/类型/本人岗位，旧引用保留审计", async () => {
    const bind = {
      projectId: 1,
      orderId: 1,
      evidenceId: 1,
      attachmentKind: "invoice" as const,
      reason: "旧发票遗失新原件补传",
    };
    mock.db.rows.purchase_orders = [order({ projectId: 2 })];
    await expect(caller().bindOrderEvidence(bind)).rejects.toThrow(
      "当前项目订单"
    );
    mock.db.rows.purchase_orders = [
      order({ status: "draft", invoiceEvidenceId: 77 }),
    ];
    for (const patch of [
      { sourceType: "site_photo" },
      { status: "deleted" },
      { watermarkJson: "{broken" },
    ]) {
      mock.db.rows.evidence_records = [
        {
          id: 1,
          projectId: 1,
          sourceType: "purchase",
          status: "active",
          watermarkJson: '{"attachmentKind":"invoice"}',
          ...patch,
        },
      ];
      await expect(caller().bindOrderEvidence(bind)).rejects.toThrow();
    }
    mock.db.rows.evidence_records = [
      {
        id: 1,
        projectId: 1,
        sourceType: "purchase",
        status: "active",
        sourceId: "small_direct_invoice",
      },
    ];
    mock.db.rows.purchase_orders[0].createdBy = 9;
    mock.roles = ["USER_SPECIFIC_READ"];
    await expect(caller().bindOrderEvidence(bind)).rejects.toThrow(
      "附件维护权限"
    );
    mock.roles = ["ALL"];
    await caller().bindOrderEvidence(bind);
    expect(mock.db.rows.purchase_orders[0]).toMatchObject({
      status: "draft",
      invoiceEvidenceId: 1,
    });
    expect(mock.db.audits.at(-1)).toMatchObject({
      beforeJson: '{"evidenceId":77}',
    });
  });
  it("供应商维护super-only；原组织和信用代码不会因旧客户端缺字段丢失", async () => {
    mock.db.rows.suppliers = [
      {
        id: 1,
        name: "原供应商",
        organizationId: 5,
        unifiedSocialCreditCode: "91440000",
        contactName: "张工",
        contactPhoneMasked: "***1234",
        status: "active",
      },
    ];
    const update = {
      id: 1,
      name: "更新供应商",
      contactName: "李工",
      contactPhoneMasked: "***5678",
      status: "disabled" as const,
    };
    mock.roles = ["WAREHOUSE_MANAGER"];
    await expect(caller().saveSupplier(update)).rejects.toThrow("仅超级管理员");
    mock.roles = ["ALL"];
    await caller().saveSupplier(update);
    expect(mock.db.rows.suppliers[0]).toMatchObject({
      organizationId: 5,
      unifiedSocialCreditCode: "91440000",
      status: "disabled",
      name: "更新供应商",
    });
  });

  it("直接采购创建也检查同项目active发票类型，不能用孤立错误原件充当发票", async () => {
    mock.db.rows.purchase_categories = [{ id: 1, status: "active" }];
    const document = {
      id: 1,
      projectId: 1,
      sourceType: "purchase",
      status: "active",
      sourceId: "small_direct_document",
      watermarkJson: '{"attachmentKind":"document"}',
    };
    const invoice = {
      id: 2,
      projectId: 1,
      sourceType: "purchase",
      status: "active",
      sourceId: "small_direct_invoice",
      watermarkJson: '{"attachmentKind":"invoice"}',
    };
    const create = {
      projectId: 1,
      categoryId: 1,
      itemDescription: "水泥采购",
      quantity: 1,
      unitPrice: 50,
      evidenceId: 1,
      hasInvoice: true,
      invoiceEvidenceId: 2,
      orderedAt: baseStock.occurredAt,
    };
    for (const patch of [
      { projectId: 2 },
      { status: "deleted" },
      { sourceType: "financial_invoice" },
      { watermarkJson: '{"attachmentKind":"document"}' },
    ]) {
      mock.db.rows.evidence_records = [document, { ...invoice, ...patch }];
      await expect(caller().createSmallDirectOrder(create)).rejects.toThrow(
        "发票附件"
      );
      expect(mock.db.rows.purchase_orders).toHaveLength(0);
    }
    mock.db.rows.evidence_records = [document, invoice];
    await caller().createSmallDirectOrder(create);
    expect(mock.db.rows.purchase_orders[0]).toMatchObject({
      projectId: 1,
      amount: "50",
      evidenceId: 1,
      invoiceEvidenceId: 2,
      hasInvoice: true,
      status: "draft",
    });
  });

  it("历史负库存纠正必须负责人授权原因和凭证，纠正不覆盖原负流水", async () => {
    const legacy = stock({
      transactionType: "outbound",
      purchaseOrderId: null,
      quantity: "2",
      amount: "20",
    });
    mock.db.rows.inventory_transactions = [legacy];
    mock.db.rows.evidence_records = [
      { id: 1, projectId: 1, sourceType: "purchase", status: "active" },
    ];
    const recover = {
      ...baseStock,
      transactionType: "inbound" as const,
      quantity: 2,
      evidenceId: 1,
      exceptionReason: "历史期初实物重新核验",
    };
    mock.roles = ["WAREHOUSE_MANAGER"];
    await expect(caller().saveInventoryTransaction(recover)).rejects.toThrow(
      "审批负责人"
    );
    mock.roles = ["ALL"];
    await expect(
      caller().saveInventoryTransaction({ ...recover, evidenceId: null })
    ).rejects.toThrow("必须关联");
    await expect(
      caller().saveInventoryTransaction({ ...recover, exceptionReason: null })
    ).rejects.toThrow("审批负责人");
    await caller().saveInventoryTransaction(recover);
    expect(mock.db.rows.inventory_transactions[0]).toEqual(legacy);
    expect(mock.db.rows.inventory_transactions[1]).toMatchObject({
      amount: "20",
      exceptionReason: recover.exceptionReason,
      costRuleVersion: "moving_weighted_v2",
    });
    expect(mock.db.audits).toHaveLength(1);
    const result = await caller().listInventory({ projectId: 1 });
    expect(result).toMatchObject({
      balances: [{ balanceQuantity: 0, totalAmount: 0, hasLegacy: true }],
    });
  });
});
