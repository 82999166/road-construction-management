import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
import { getTableColumns, getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { TrpcContext } from "./_core/context";
const mock = vi.hoisted(() => ({ db: null as any, roles: ["ALL"] }));
vi.mock("./db", () => ({ getDb: async () => mock.db }));
vi.mock("./access", async original => ({
  ...(await original<typeof import("./access")>()),
  assertDepartmentBusinessAccess: async () => {},
  assertProjectInCurrentScope: async (_ctx: unknown, id: number) => {
    if (id !== 1) throw new Error("未授权项目");
  },
  getEffectiveRoleCodes: async () => mock.roles,
  getSuperAdminAccess: async () => ({ canAccess: mock.roles.includes("ALL") }),
  getRoleOperationPermissionDecision: async () => ({
    allowed: true,
    source: "role",
  }),
  hasUserSpecificOperationPermission: async () => true,
}));
vi.mock("./services/businessNotifier", () => ({
  notifyOfficialAccountBusinessEventSafely: async () => {},
}));
vi.mock("./services/officialAccountDriverBinding", () => ({
  sendOfficialAccountDriverNotification: async () => {},
}));
vi.mock("./services/transportRisk", () => ({
  triggerTransportRiskScan: async () => {},
}));
vi.mock("./storage", () => ({
  storageGetSignedUrl: async () => "/controlled/image",
}));
import { machineryRouter, transportRouter } from "./routers/operations";
import { isPurchaseDeductionEligible } from "./services/transportPurchaseDeduction";
const normalize = (v: any): any =>
  v instanceof Date
    ? v.toISOString().slice(0, 23).replace("T", " ")
    : typeof v === "boolean"
      ? Number(v)
      : v && typeof v === "object"
        ? JSON.stringify(v)
        : (v ?? null);
/** In-memory SQLite evaluates SQL emitted by Drizzle (including AND/OR/IN/NULL/ranges).
 * Transactions queue and rollback the fixture store. No actual application DB/network access. */
class FakeDb {
  rows: Record<string, any[]> = {
    projects: [{ id: 1 }],
    transport_vehicles: [
      {
        id: 1,
        projectId: 1,
        ownership: "trip_settlement",
        plateNo: "湘A12345",
      },
    ],
  };
  private gate = Promise.resolve();
  beforeTransaction?: () => void;
  zeroWriteTable?: string;
  locks: string[] = [];
  select(projection?: any) {
    return { from: (table: any) => this.query(table, projection) };
  }
  private matches(table: any, condition?: SQL) {
    const name = getTableName(table),
      rows = this.rows[name] ?? [];
    if (!condition) return rows;
    const q = new MySqlDialect().sqlToQuery(condition);
    const db = new DatabaseSync(":memory:");
    const columns = [
      ...new Set([
        ...Object.values(getTableColumns(table)).map((c: any) => c.name),
        ...rows.flatMap(row => Object.keys(row)),
      ]),
    ];
    db.exec(
      `CREATE TABLE \`${name}\` (__index INTEGER, ${columns.map(col => `\`${col}\``).join(",")})`
    );
    const insert = db.prepare(
      `INSERT INTO \`${name}\` VALUES (${[0, ...columns].map(() => "?").join(",")})`
    );
    rows.forEach((row, i) =>
      insert.run(i, ...columns.map(col => normalize(row[col])))
    );
    const ids = db
      .prepare(`SELECT __index FROM \`${name}\` WHERE ${q.sql}`)
      .all(...q.params.map(normalize))
      .map((row: any) => row.__index);
    db.close();
    return ids.map(i => rows[i]);
  }
  private query(table: any, projection?: any) {
    let condition: SQL | undefined, limit: number | undefined;
    const builder: any = {
      where: (sql: SQL) => {
        condition = sql;
        return builder;
      },
      orderBy: () => builder,
      limit: (n: number) => {
        limit = n;
        return builder;
      },
      for: () => {
        this.locks.push(getTableName(table));
        return builder;
      },
      then: (resolve: any, reject: any) =>
        Promise.resolve()
          .then(() => {
            let rows = this.matches(table, condition);
            if (limit) rows = rows.slice(0, limit);
            return rows.map(row =>
              projection
                ? Object.fromEntries(
                    Object.entries(projection).map(([key, column]: any) => [
                      key,
                      row[column.name],
                    ])
                  )
                : structuredClone(row)
            );
          })
          .then(resolve, reject),
    };
    return builder;
  }
  insert(table: any) {
    return {
      values: async (data: any) => {
        const name = getTableName(table),
          rows = (this.rows[name] ??= []),
          values = Array.isArray(data) ? data : [data];
        let first = 0;
        for (const value of values) {
          if (
            name === "transport_vehicle_settlement_items" &&
            rows.some(row => row.tripId === value.tripId)
          )
            throw new Error("transport_vehicle_settlement_items_trip_unique");
          const id = Math.max(0, ...rows.map(row => row.id ?? 0)) + 1;
          first ||= id;
          rows.push({
            id,
            status:
              name === "transport_vehicle_settlements" ? "draft" : undefined,
            ...structuredClone(value),
          });
        }
        return [{ insertId: first }];
      },
    };
  }
  update(table: any) {
    return {
      set: (patch: any) => ({
        where: async (condition: SQL) => {
          const rows =
            this.zeroWriteTable === getTableName(table)
              ? []
              : this.matches(table, condition);
          rows.forEach(row => Object.assign(row, structuredClone(patch)));
          return [{ affectedRows: rows.length }];
        },
      }),
    };
  }
  delete(table: any) {
    return {
      where: async (condition: SQL) => {
        const rows = this.matches(table, condition);
        this.rows[getTableName(table)] = (
          this.rows[getTableName(table)] ?? []
        ).filter(row => !rows.includes(row));
        return [{ affectedRows: rows.length }];
      },
    };
  }
  async transaction<T>(fn: (tx: FakeDb) => Promise<T>) {
    const prev = this.gate;
    let release!: () => void;
    this.gate = new Promise(resolve => (release = resolve));
    await prev;
    this.beforeTransaction?.();
    this.beforeTransaction = undefined;
    const saved = structuredClone(this.rows);
    try {
      return await fn(this);
    } catch (e) {
      this.rows = saved;
      throw e;
    } finally {
      release();
    }
  }
}
const time = new Date("2026-11-04T02:00:00Z");
const ctx = { user: { id: 1, role: "user" }, req: {}, res: {} } as TrpcContext;
const caller = () => transportRouter.createCaller(ctx);
function trip(id = 1, extra = {}) {
  return {
    id,
    projectId: 1,
    vehicleId: 1,
    tripNo: `TR-${id}`,
    status: "verified",
    invoiceMode: "nfc_card",
    startAt: time,
    endAt: new Date(time.getTime() + 600000),
    loadConfirmedAt: time,
    unloadConfirmedAt: new Date(time.getTime() + 600000),
    loadConfirmedBy: 2,
    unloadConfirmedBy: 3,
    loadEventId: id * 10,
    unloadEventId: id * 10 + 1,
    routeSnapshot: {},
    calculatedAmount: "100",
    fuelDeductionAmount: "0",
    netSettlementAmount: null,
    volumeCubicMeters: "10",
    exceptionStatus: "none",
    ...extra,
  };
}
function seedTrip(id = 1, extra = {}) {
  (mock.db.rows.transport_trips ??= []).push(trip(id, extra));
  (mock.db.rows.transport_card_events ??= []).push(
    {
      id: id * 10,
      tripId: id,
      projectId: 1,
      eventType: "load",
      validationStatus: "accepted",
    },
    {
      id: id * 10 + 1,
      tripId: id,
      projectId: 1,
      eventType: "unload",
      validationStatus: "accepted",
    }
  );
}
function fuel(id = 1, extra = {}) {
  return {
    id,
    projectId: 1,
    vehicleId: 1,
    status: "approved",
    transportTripId: null,
    refueledAt: time,
    deductFromFreight: true,
    amount: "20",
    ...extra,
  };
}
function order(id = 1, extra = {}) {
  return {
    id,
    projectId: 1,
    assetType: "vehicle",
    assetId: 1,
    status: "closed",
    amount: "30",
    orderedAt: time,
    assetDeductionReference: null,
    ...extra,
  };
}
const draft = {
  projectId: 1,
  vehicleId: 1,
  periodStart: "2026-11-04",
  periodEnd: "2026-11-04",
  payeeName: "司机甲",
  paymentMethod: "cash" as const,
};
const nonTrip = {
  ...draft,
  settlementKind: "adjustment" as const,
  basisDescription: "签证已核准费用",
  adjustmentAmount: 100,
};
function recovery(extra = {}) {
  return {
    id: 20,
    projectId: 1,
    vehicleId: 1,
    settlementNo: "S-OLD",
    status: "receivable",
    netPayableAmount: "-60",
    ...extra,
  };
}
const records = (amount = "30", extra = {}) => ({
  id: 1,
  projectId: 1,
  sourceType: "purchase_order_settlement",
  sourceId: "1",
  amount,
  settlementStatus: "paid",
  direction: "expense",
  ...extra,
});
beforeEach(() => {
  mock.db = new FakeDb();
  mock.roles = ["ALL"];
});
describe("运输真实路由资格与授权", () => {
  it("无项目权限、司机不能核验/创建，按趟车辆不能直接settled", async () => {
    seedTrip(1, { status: "submitted" });
    mock.roles = ["DRIVER"];
    await expect(
      caller().transitionTrip({ id: 1, projectId: 1, nextStatus: "verified" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().createVehicleSettlement(draft)).rejects.toMatchObject(
      { code: "FORBIDDEN" }
    );
    mock.roles = ["ALL"];
    await expect(
      caller().createVehicleSettlement({ ...draft, projectId: 2 })
    ).rejects.toThrow("未授权项目");
    await expect(
      caller().transitionTrip({ id: 1, projectId: 1, nextStatus: "settled" })
    ).rejects.toThrow("不能直接标记已结算");
  });
  it("正常双刷核验通过，缺少真实接受事件则拦截", async () => {
    seedTrip(1, { status: "submitted" });
    mock.db.rows.transport_card_events[1].validationStatus = "needs_review";
    await expect(
      caller().transitionTrip({ id: 1, projectId: 1, nextStatus: "verified" })
    ).rejects.toThrow("尚未完成有效卸土");
    mock.db.rows.transport_card_events[1].validationStatus = "accepted";
    await caller().transitionTrip({
      id: 1,
      projectId: 1,
      nextStatus: "verified",
    });
    expect(mock.db.rows.transport_trips[0].status).toBe("verified");
  });
  it.each(["single_scan", "unload_only"])(
    "%s特殊闭环需要服务端来源及核对依据",
    async kind => {
      const snapshot =
        kind === "single_scan"
          ? {
              nfcSingleScanClosed: true,
              nfcSingleScanClosedAt: time.toISOString(),
              nfcSingleScanClosedBy: 2,
            }
          : {
              unloadOnlyCardClose: true,
              unloadOnlyCardClosedAt: time.toISOString(),
              loadCardRecorded: false,
            };
      seedTrip(1, {
        status: "submitted",
        routeSnapshot: snapshot,
        ...(kind === "single_scan"
          ? {
              unloadEventId: null,
              unloadConfirmedAt: null,
              unloadConfirmedBy: null,
            }
          : {
              loadEventId: null,
              loadConfirmedAt: null,
              loadConfirmedBy: null,
            }),
      });
      await expect(
        caller().transitionTrip({ id: 1, projectId: 1, nextStatus: "verified" })
      ).rejects.toThrow("须填写现场核对依据");
      await caller().transitionTrip({
        id: 1,
        projectId: 1,
        nextStatus: "verified",
        reviewRemarks: "现场原始记录已核对",
      });
      expect(mock.db.rows.transport_trips[0].status).toBe("verified");
    }
  );
  it("照片须有效项目来源和图像类型，作废/跨项目/PDF不放行", async () => {
    seedTrip(1, {
      status: "submitted",
      invoiceMode: "plate_photo",
      evidenceId: 8,
      routeSnapshot: {
        unloadConfirmationMode: "photo",
        unloadPhotoEvidenceId: 9,
      },
    });
    mock.db.rows.evidence_records = [
      {
        id: 8,
        projectId: 1,
        sourceType: "transport",
        status: "active",
        mimeType: "image/jpeg",
      },
      {
        id: 9,
        projectId: 1,
        sourceType: "transport",
        status: "void",
        mimeType: "image/jpeg",
      },
    ];
    for (const patch of [
      { status: "void" },
      { status: "active", projectId: 2 },
      { projectId: 1, mimeType: "application/pdf" },
    ]) {
      Object.assign(mock.db.rows.evidence_records[1], patch);
      await expect(
        caller().transitionTrip({ id: 1, projectId: 1, nextStatus: "verified" })
      ).rejects.toThrow("尚未完成有效卸土");
    }
    Object.assign(mock.db.rows.evidence_records[1], {
      status: "active",
      projectId: 1,
      mimeType: "image/jpeg",
    });
    await caller().transitionTrip({
      id: 1,
      projectId: 1,
      nextStatus: "verified",
    });
  });
  it("已有异常必须显式依据；已进入结算不能重复核验", async () => {
    seedTrip(1, { status: "submitted", exceptionStatus: "open" });
    await expect(
      caller().transitionTrip({ id: 1, projectId: 1, nextStatus: "verified" })
    ).rejects.toThrow("须填写现场核对依据");
    mock.db.rows.transport_vehicle_settlement_items = [
      { id: 1, tripId: 1, settlementId: 1 },
    ];
    await expect(
      caller().transitionTrip({
        id: 1,
        projectId: 1,
        nextStatus: "verified",
        reviewRemarks: "现场核对异常说明",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
describe("真实结算生成与并发来源占用", () => {
  it("显式错车/未核验ID不得静默丢单，历史清单必须财务确认", async () => {
    seedTrip();
    await expect(
      caller().createVehicleSettlement({ ...draft, tripIds: [1, 99] })
    ).rejects.toThrow("不能静默忽略");
    await expect(
      caller().createVehicleSettlement({ ...draft, legacyTripIds: [1] })
    ).rejects.toThrow("逐单确认");
    mock.roles = ["TRANSPORT_MANAGER"];
    await expect(
      caller().createVehicleSettlement({
        ...draft,
        legacyTripIds: [1],
        legacyConfirmation: "原历史凭据核对",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("并发同一运单只有一张真实结算/明细/来源快照", async () => {
    seedTrip();
    const results = await Promise.allSettled([
      caller().createVehicleSettlement(draft),
      caller().createVehicleSettlement(draft),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(mock.db.rows.transport_vehicle_settlements).toHaveLength(1);
    expect(mock.db.rows.transport_vehicle_settlement_items).toHaveLength(1);
    expect(
      mock.db.rows.audit_logs.filter(
        (r: any) => r.action === "vehicle_settlement_basis_v1"
      )
    ).toHaveLength(1);
  });
  it("不同趟并发不能重复消费同一池柴油，刷新重试扣款为零", async () => {
    seedTrip(1);
    seedTrip(2);
    mock.db.rows.diesel_refuel_records = [fuel()];
    const results = await Promise.allSettled([
      caller().createVehicleSettlement({ ...draft, tripIds: [1] }),
      caller().createVehicleSettlement({ ...draft, tripIds: [2] }),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const used = mock.db.rows.transport_vehicle_settlement_items[0].tripId;
    const retry = await caller().createVehicleSettlement({
      ...draft,
      tripIds: [used === 1 ? 2 : 1],
    });
    expect(retry.fuelDeductionAmount).toBe(0);
    expect(
      mock.db.rows.transport_vehicle_settlements.reduce(
        (n: number, r: any) => n + Number(r.fuelDeductionAmount),
        0
      )
    ).toBe(20);
  });
  it("柴油倒挂完整计入负应付，错趟来源不消费", async () => {
    seedTrip();
    mock.db.rows.diesel_refuel_records = [
      fuel(1, { amount: "150" }),
      fuel(2, { transportTripId: 99, amount: "999" }),
    ];
    const result = await caller().createVehicleSettlement(draft);
    expect(result.netPayableAmount).toBe(-50);
    expect(result.fuelDeductionAmount).toBe(150);
    expect(
      mock.db.rows.diesel_refuel_records.map((r: any) => r.status)
    ).toEqual(["settled", "approved"]);
  });
  it("已核验旧行无真实闭环也不得被生成器绕过", async () => {
    seedTrip();
    mock.db.rows.transport_card_events = [];
    await expect(caller().createVehicleSettlement(draft)).rejects.toThrow(
      "真实闭环核验资格"
    );
    expect(mock.db.rows.transport_vehicle_settlements ?? []).toHaveLength(0);
  });
  it("历史closed未知/部分付款不扣，真实总付款可扣；既有引用金额不改", async () => {
    seedTrip();
    mock.db.rows.purchase_orders = [
      order(),
      order(2, { amount: "777", assetDeductionReference: "OLD-REF" }),
      order(3, { amount: "40" }),
    ];
    mock.db.rows.financial_records = [
      records("10"),
      records("40", { id: 2, sourceId: "3" }),
    ];
    const result = await caller().createVehicleSettlement(draft);
    expect(result.assetDeductionAmount).toBe(40);
    expect(mock.db.rows.purchase_orders[0].assetDeductionReference).toBeNull();
    expect(mock.db.rows.purchase_orders[1]).toMatchObject({
      amount: "777",
      assetDeductionReference: "OLD-REF",
    });
  });
  it("配件并发两趟只允许引用一次付款订单", async () => {
    seedTrip(1);
    seedTrip(2);
    mock.db.rows.purchase_orders = [order()];
    mock.db.rows.financial_records = [records()];
    const r = await Promise.allSettled([
      caller().createVehicleSettlement({ ...draft, tripIds: [1] }),
      caller().createVehicleSettlement({ ...draft, tripIds: [2] }),
    ]);
    expect(r.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect(
      mock.db.rows.transport_vehicle_settlements[0].assetDeductionAmount
    ).toBe("30");
  });
  it("前期抵扣须审核/实际余额；并发不可复用同一余额", async () => {
    seedTrip(1);
    seedTrip(2);
    mock.db.rows.transport_vehicle_settlements = [
      recovery(),
      recovery({ id: 21, status: "draft", netPayableAmount: "-1000" }),
    ];
    mock.db.rows.settlement_payment_records = [
      {
        id: 1,
        projectId: 1,
        settlementType: "transport_vehicle",
        settlementId: 20,
        direction: "income",
        status: "active",
        amount: "10",
      },
    ];
    const r = await Promise.allSettled([
      caller().createVehicleSettlement({ ...draft, tripIds: [1] }),
      caller().createVehicleSettlement({ ...draft, tripIds: [2] }),
    ]);
    expect(r.filter(x => x.status === "fulfilled")).toHaveLength(1);
    const target = mock.db.rows.transport_vehicle_settlements.find(
      (x: any) => x.id !== 20 && x.id !== 21
    );
    expect(target.carryForwardDeductionAmount).toBe("50");
    expect(mock.db.rows.transport_vehicle_carry_forward_offsets).toHaveLength(
      1
    );
  });
  it("历史已settled财务逐单纳入保留原扣款和净额，既有柴油不再扣", async () => {
    seedTrip(1, {
      status: "settled",
      fuelDeductionAmount: "45",
      netSettlementAmount: "55",
    });
    mock.db.rows.diesel_refuel_records = [fuel()];
    const r = await caller().createVehicleSettlement({
      ...draft,
      tripIds: [1],
      legacyTripIds: [1],
      legacyConfirmation: "历史原金额已逐单核对",
    });
    expect(r).toMatchObject({ fuelDeductionAmount: 45, netPayableAmount: 55 });
    expect(mock.db.rows.diesel_refuel_records[0].status).toBe("approved");
    await caller().transitionVehicleSettlement({
      projectId: 1,
      id: r.id,
      action: "submit",
    });
    await caller().transitionVehicleSettlement({
      projectId: 1,
      id: r.id,
      action: "approve",
    });
    await caller().transitionVehicleSettlement({
      projectId: 1,
      id: r.id,
      action: "void",
    });
    expect(mock.db.rows.transport_trips[0]).toMatchObject({
      status: "settled",
      fuelDeductionAmount: "45",
      netSettlementAmount: "55",
    });
  });
});
describe("来源快照条件恢复和非按趟闭环", () => {
  it("审核/作废恢复逐趟原金额与柴油配件抵扣，非关联来源不动", async () => {
    seedTrip();
    mock.db.rows.diesel_refuel_records = [
      fuel(),
      fuel(2, { status: "settled", transportTripId: 99 }),
    ];
    mock.db.rows.purchase_orders = [
      order(),
      order(2, { assetDeductionReference: "OLD" }),
    ];
    mock.db.rows.financial_records = [records()];
    mock.db.rows.transport_vehicle_settlements = [
      recovery({ netPayableAmount: "-10" }),
    ];
    const r = await caller().createVehicleSettlement(draft);
    await caller().transitionVehicleSettlement({
      projectId: 1,
      id: r.id,
      action: "submit",
    });
    await caller().transitionVehicleSettlement({
      projectId: 1,
      id: r.id,
      action: "approve",
    });
    expect(mock.db.rows.transport_trips[0]).toMatchObject({
      status: "settled",
      fuelDeductionAmount: "20",
      netSettlementAmount: "80",
    });
    await caller().transitionVehicleSettlement({
      projectId: 1,
      id: r.id,
      action: "void",
    });
    expect(mock.db.rows.transport_trips[0]).toMatchObject({
      status: "verified",
      fuelDeductionAmount: "0",
      netSettlementAmount: null,
    });
    expect(
      mock.db.rows.diesel_refuel_records.map((x: any) => x.status)
    ).toEqual(["approved", "settled"]);
    expect(
      mock.db.rows.purchase_orders.map((x: any) => x.assetDeductionReference)
    ).toEqual([null, "OLD"]);
    expect(mock.db.rows.transport_vehicle_settlements[0].status).toBe(
      "receivable"
    );
    expect(mock.db.rows.transport_vehicle_carry_forward_offsets[0].status).toBe(
      "reversed"
    );
  });
  it("非按趟结算同样固化恢复来源，不漏柴油/抵扣", async () => {
    mock.db.rows.diesel_refuel_records = [fuel()];
    mock.db.rows.transport_vehicle_settlements = [
      recovery({ netPayableAmount: "-30" }),
    ];
    const r = await caller().createNonTripVehicleSettlement(nonTrip);
    expect(r.netPayableAmount).toBe(50);
    await caller().transitionVehicleSettlement({
      projectId: 1,
      id: r.id,
      action: "void",
    });
    expect(mock.db.rows.diesel_refuel_records[0].status).toBe("approved");
    expect(mock.db.rows.transport_vehicle_settlements[0].status).toBe(
      "receivable"
    );
  });
  it("非按趟并发柴油消费仍只允许一张草稿", async () => {
    mock.db.rows.diesel_refuel_records = [fuel()];
    const r = await Promise.allSettled([
      caller().createNonTripVehicleSettlement(nonTrip),
      caller().createNonTripVehicleSettlement(nonTrip),
    ]);
    expect(r.filter(x => x.status === "fulfilled")).toHaveLength(1);
  });
  it("并发重复租金期间只有一单，不因无柴油/无使用量月租而重复计租", async () => {
    mock.db.rows.transport_vehicles[0].ownership = "leased";
    mock.db.rows.transport_vehicle_lease_rules = [
      {
        id: 1,
        projectId: 1,
        vehicleId: 1,
        status: "active",
        billingType: "monthly",
        rate: "3000",
        effectiveFrom: new Date("2026-11-01T00:00:00Z"),
        effectiveTo: null,
      },
    ];
    const lease = {
      ...draft,
      settlementKind: "lease" as const,
      basisDescription: "原月租合同依据",
    };
    const r = await Promise.allSettled([
      caller().createNonTripVehicleSettlement(lease),
      caller().createNonTripVehicleSettlement(lease),
    ]);
    expect(r.filter(x => x.status === "fulfilled")).toHaveLength(1);
  });
  it("历史无来源快照拒绝猜测恢复；有付款即使状态旧approved也不能作废", async () => {
    mock.db.rows.transport_vehicle_settlements = [
      recovery({
        id: 1,
        status: "approved",
        netPayableAmount: "100",
        fuelDeductionAmount: "20",
        assetDeductionAmount: "0",
        carryForwardDeductionAmount: "0",
      }),
    ];
    await expect(
      caller().transitionVehicleSettlement({
        projectId: 1,
        id: 1,
        action: "void",
      })
    ).rejects.toThrow("缺少原状态与扣款来源快照");
    mock.db.rows.settlement_payment_records = [
      {
        id: 1,
        projectId: 1,
        settlementType: "transport_vehicle",
        settlementId: 1,
        status: "active",
      },
    ];
    await expect(
      caller().transitionVehicleSettlement({
        projectId: 1,
        id: 1,
        action: "void",
      })
    ).rejects.toThrow("实际收付凭证");
  });
  it("来源金额被并发修改则作废冲突，不能覆盖金额或释放引用", async () => {
    seedTrip();
    const r = await caller().createVehicleSettlement(draft);
    await caller().transitionVehicleSettlement({
      projectId: 1,
      id: r.id,
      action: "submit",
    });
    await caller().transitionVehicleSettlement({
      projectId: 1,
      id: r.id,
      action: "approve",
    });
    mock.db.rows.transport_trips[0].netSettlementAmount = "999";
    await expect(
      caller().transitionVehicleSettlement({
        projectId: 1,
        id: r.id,
        action: "void",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mock.db.rows.transport_vehicle_settlements[0].status).toBe(
      "approved"
    );
    expect(mock.db.rows.transport_vehicle_settlement_items).toHaveLength(1);
    expect(mock.db.rows.transport_trips[0].netSettlementAmount).toBe("999");
  });
  it("条件写入0行审核回滚，不记录成功审计/不改运单", async () => {
    seedTrip();
    const r = await caller().createVehicleSettlement(draft);
    await caller().transitionVehicleSettlement({
      projectId: 1,
      id: r.id,
      action: "submit",
    });
    mock.db.zeroWriteTable = "transport_trips";
    await expect(
      caller().transitionVehicleSettlement({
        projectId: 1,
        id: r.id,
        action: "approve",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mock.db.rows.transport_vehicle_settlements[0].status).toBe(
      "submitted"
    );
    expect(mock.db.rows.transport_trips[0].status).toBe("verified");
  });
  it("并发作废只有一次恢复，重试不影响已恢复/新归集", async () => {
    seedTrip();
    mock.db.rows.diesel_refuel_records = [fuel()];
    const r = await caller().createVehicleSettlement(draft);
    const results = await Promise.allSettled([
      caller().transitionVehicleSettlement({
        projectId: 1,
        id: r.id,
        action: "void",
      }),
      caller().transitionVehicleSettlement({
        projectId: 1,
        id: r.id,
        action: "void",
      }),
    ]);
    expect(results.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect(mock.db.rows.diesel_refuel_records[0].status).toBe("approved");
  });
  it("机械租金同用付款依据，未知历史closed不扣且不改历史reference", async () => {
    mock.db.rows.machines = [
      { id: 1, projectId: 1, ownership: "leased", name: "挖机" },
    ];
    mock.db.rows.machine_monthly_statements = [
      {
        id: 1,
        projectId: 1,
        machineId: 1,
        period: "2026-11",
        status: "approved",
        machineShareAmount: "500",
        fuelAmount: "0",
        repairAmount: "0",
      },
    ];
    mock.db.rows.purchase_orders = [
      order(1, { assetType: "machine" }),
      order(2, {
        assetType: "machine",
        assetDeductionReference: "M-OLD",
        amount: "123",
      }),
    ];
    const r = await machineryRouter.createCaller(ctx).createPaymentSettlement({
      projectId: 1,
      monthlyStatementId: 1,
      payeeName: "机械老板",
      paymentMethod: "cash",
      manualDeductionAmount: 0,
    });
    expect(r.partsDeductionAmount).toBe(0);
    expect(mock.db.rows.purchase_orders[1]).toMatchObject({
      amount: "123",
      assetDeductionReference: "M-OLD",
    });
  });
  it("兼容显式实际付款总额但不接受closed标签与已扣引用重新扣", () => {
    expect(isPurchaseDeductionEligible(order(), [])).toBe(false);
    expect(
      isPurchaseDeductionEligible({ ...order(), actualPaidAmount: 30 }, [])
    ).toBe(true);
    expect(
      isPurchaseDeductionEligible(
        order(1, { assetDeductionReference: "OLD" }),
        [records()]
      )
    ).toBe(false);
  });
});
