import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { getTableColumns, getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { TrpcContext } from "./_core/context";
import {
  selectVehicleSettlementTrips,
  vehicleSettlementSelectionValidationReason,
  vehicleSettlementTripIdsMatch,
} from "./services/vehicleSettlementSelection";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
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
import { transportRouter } from "./routers/operations";

const normalize = (value: any): any =>
  value instanceof Date
    ? value.toISOString().slice(0, 23).replace("T", " ")
    : typeof value === "boolean"
      ? Number(value)
      : value && typeof value === "object"
        ? JSON.stringify(value)
        : (value ?? null);
/** Same SQL-evaluated in-memory fixture strategy as transport-workspace.caller.test; no app DB/network. */
class SelectionFixtureDb {
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
  reads: string[] = [];
  transactions = 0;
  writes = 0;
  select(projection?: any) {
    return { from: (table: any) => this.query(table, projection) };
  }
  private matches(table: any, condition?: SQL) {
    const name = getTableName(table),
      rows = this.rows[name] ?? [];
    if (!condition) return rows;
    const query = new MySqlDialect().sqlToQuery(condition);
    const db = new DatabaseSync(":memory:");
    const columns = Array.from(
      new Set([
        ...Object.values(getTableColumns(table)).map(
          (column: any) => column.name
        ),
        ...rows.flatMap(row => Object.keys(row)),
      ])
    );
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
      .prepare(`SELECT __index FROM \`${name}\` WHERE ${query.sql}`)
      .all(...query.params.map(normalize))
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
            this.reads.push(getTableName(table));
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
        this.writes++;
        const name = getTableName(table),
          rows = (this.rows[name] ??= []);
        let first = 0;
        for (const value of Array.isArray(data) ? data : [data]) {
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
          this.writes++;
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
  async transaction<T>(fn: (tx: SelectionFixtureDb) => Promise<T>) {
    const previous = this.gate;
    let release!: () => void;
    this.gate = new Promise(resolve => {
      release = resolve;
    });
    await previous;
    this.transactions++;
    this.beforeTransaction?.();
    this.beforeTransaction = undefined;
    const saved = structuredClone(this.rows);
    try {
      return await fn(this);
    } catch (error) {
      this.rows = saved;
      throw error;
    } finally {
      release();
    }
  }
}
const time = new Date("2026-11-04T02:00:00Z");
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
    routeSnapshot: { settlementUnit: "trip" },
    calculatedUnitPrice: "100",
    calculatedAmount: "100",
    fuelDeductionAmount: "0",
    netSettlementAmount: null,
    volumeCubicMeters: "10",
    weightTons: null,
    exceptionStatus: "none",
    ...extra,
  };
}
const eventsFor = (id: number) => [
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
  },
];
function seedTrip(id = 1, extra = {}) {
  (mock.db.rows.transport_trips ??= []).push(trip(id, extra));
  (mock.db.rows.transport_card_events ??= []).push(...eventsFor(id));
}
const selection = {
  projectId: 1,
  vehicleId: 1,
  periodStart: "2026-11-04",
  periodEnd: "2026-11-04",
  selectionMode: "day" as const,
};
const draft = {
  ...selection,
  payeeName: "司机甲",
  paymentMethod: "cash" as const,
};
const ctx = { user: { id: 1, role: "user" }, req: {}, res: {} } as TrpcContext;
const caller = () => transportRouter.createCaller(ctx);
const pure = (
  trips: ReturnType<typeof trip>[],
  input = selection,
  occupiedTripIds: number[] = []
) =>
  selectVehicleSettlementTrips(input, trips, {
    occupiedTripIds,
    events: trips.flatMap(row => eventsFor(row.id)),
    evidence: [],
  });
beforeEach(() => {
  mock.db = new SelectionFixtureDb();
  mock.roles = ["ALL"];
});

describe("vehicle settlement selection pure helper", () => {
  it("merges same-China-day trips and sorts startAt then id without mutating source", () => {
    const rows = [
      trip(3),
      trip(2),
      trip(1, { startAt: new Date("2026-11-03T16:00:00Z") }),
      trip(4, { startAt: new Date("2026-11-03T15:59:59Z") }),
    ];
    const result = pure(rows).preview;
    expect(result).toMatchObject({
      tripIds: [1, 2, 3],
      availableCount: 3,
      selectedCount: 3,
      grossFreightAmount: 300,
      eligible: true,
      reason: null,
    });
    expect(result.dailyGroups).toEqual([
      { date: "2026-11-04", tripCount: 3, grossFreightAmount: 300 },
    ]);
    expect(rows.map(row => row.id)).toEqual([3, 2, 1, 4]);
  });
  it("skips occupied, other scope, non-verified and unresolved evidence/exception facts", () => {
    const rows = [
      trip(1),
      trip(2),
      trip(3, { status: "settled" }),
      trip(4, { projectId: 2 }),
      trip(5, { vehicleId: 2 }),
      trip(6, { exceptionStatus: "open" }),
      trip(7, { unloadEventId: 999 }),
    ];
    expect(pure(rows, selection, [1]).preview.tripIds).toEqual([2]);
  });
  it("takes earliest N and reports insufficiency instead of treating partial rows as eligible", () => {
    const input = {
      ...selection,
      selectionMode: "trip_count" as const,
      tripCount: 2,
    };
    expect(
      selectVehicleSettlementTrips(input, [trip(3), trip(1), trip(2)], {
        occupiedTripIds: [1],
        events: [1, 2, 3].flatMap(eventsFor),
        evidence: [],
      }).preview.tripIds
    ).toEqual([2, 3]);
    const insufficient = selectVehicleSettlementTrips(
      { ...input, tripCount: 4 },
      [trip(1)],
      { occupiedTripIds: [], events: eventsFor(1), evidence: [] }
    ).preview;
    expect(insufficient).toMatchObject({
      availableCount: 1,
      selectedCount: 1,
      eligible: false,
    });
    expect(insufficient.reason).toContain("不足要求的 4 趟");
  });
  it.each([0, -1, 1001, 1.5, undefined])(
    "rejects invalid tripCount %s",
    tripCount => {
      expect(
        vehicleSettlementSelectionValidationReason({
          ...selection,
          selectionMode: "trip_count",
          tripCount,
        })
      ).toContain("1–1000");
    }
  );
  it("validates day/period rules and IDs, retaining omitted-mode compatibility", () => {
    expect(
      vehicleSettlementSelectionValidationReason({
        ...selection,
        periodEnd: "2026-11-05",
      })
    ).toContain("同一天");
    expect(
      vehicleSettlementSelectionValidationReason({
        ...selection,
        selectionMode: "period",
        tripCount: 1,
      })
    ).toContain("只有");
    expect(
      vehicleSettlementSelectionValidationReason({
        ...selection,
        selectionMode: undefined,
      })
    ).toBeNull();
    expect(vehicleSettlementTripIdsMatch([1, 2], [2, 1])).toBe(true);
    expect(vehicleSettlementTripIdsMatch([1, 2], [1, 1])).toBe(false);
  });
  it("supports exactly 1000 earliest trips and marks oversized full-period sets ineligible", () => {
    const rows = Array.from({ length: 1001 }, (_, i) => trip(i + 1));
    const facts = {
      occupiedTripIds: [],
      events: rows.flatMap(row => eventsFor(row.id)),
      evidence: [],
    };
    const count = selectVehicleSettlementTrips(
      { ...selection, selectionMode: "trip_count", tripCount: 1000 },
      rows,
      facts
    ).preview;
    expect(count).toMatchObject({
      availableCount: 1001,
      selectedCount: 1000,
      eligible: true,
      grossFreightAmount: 100000,
    });
    expect(count.tripIds[999]).toBe(1000);
    expect(
      selectVehicleSettlementTrips(selection, rows, facts).preview
    ).toMatchObject({ selectedCount: 1001, eligible: false });
  });
});

describe("real transport caller preview and creation", () => {
  it("preview is read-only, batch reads eligibility and returns gross-only daily groups across days", async () => {
    seedTrip(1, { startAt: new Date("2026-11-03T16:00:00Z") });
    seedTrip(2);
    seedTrip(3, {
      startAt: new Date("2026-11-04T16:00:00Z"),
      calculatedAmount: "125.23",
    });
    const before = structuredClone(mock.db.rows);
    const result = await caller().previewVehicleSettlementSelection({
      ...selection,
      selectionMode: "period",
      periodEnd: "2026-11-05",
    });
    expect(result).toMatchObject({
      tripIds: [1, 2, 3],
      availableCount: 3,
      selectedCount: 3,
      grossFreightAmount: 325.23,
      eligible: true,
    });
    expect(result.dailyGroups).toEqual([
      { date: "2026-11-04", tripCount: 2, grossFreightAmount: 200 },
      { date: "2026-11-05", tripCount: 1, grossFreightAmount: 125.23 },
    ]);
    expect(result.rows[0]).toMatchObject({
      id: 1,
      tripNo: "TR-1",
      startAt: new Date("2026-11-03T16:00:00Z"),
      quantity: 1,
      unitPrice: 100,
      grossAmount: 100,
    });
    expect(result).not.toHaveProperty("netPayableAmount");
    expect(mock.db.rows).toEqual(before);
    expect(mock.db.writes).toBe(0);
    expect(mock.db.transactions).toBe(0);
    expect(mock.db.locks).toEqual([]);
    expect(
      mock.db.reads.filter((name: string) => name === "transport_card_events")
    ).toHaveLength(1);
    expect(mock.db.reads).not.toContain("diesel_refuel_records");
  });
  it("quantity and unit price use real frozen ton/volume trip facts, not client money", async () => {
    seedTrip(1, {
      routeSnapshot: { settlementUnit: "ton" },
      weightTons: "23.5",
      calculatedUnitPrice: "6",
      calculatedAmount: "141",
    });
    seedTrip(2, {
      routeSnapshot: { settlementUnit: "cubic_meter" },
      volumeCubicMeters: "12.34",
      calculatedUnitPrice: "8",
      calculatedAmount: "98.72",
    });
    const result = await caller().previewVehicleSettlementSelection(selection);
    expect(
      result.rows.map(row => [row.quantity, row.unitPrice, row.grossAmount])
    ).toEqual([
      [23.5, 6, 141],
      [12.34, 8, 98.72],
    ]);
  });
  it("preview uses active same-project transport image facts, rejecting void/other-project/PDF evidence", async () => {
    seedTrip(1, {
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
      { mimeType: "image/jpeg", sourceType: "purchase" },
    ]) {
      Object.assign(mock.db.rows.evidence_records[1], patch);
      expect(
        await caller().previewVehicleSettlementSelection(selection)
      ).toMatchObject({ tripIds: [], availableCount: 0, eligible: false });
    }
    Object.assign(mock.db.rows.evidence_records[1], {
      sourceType: "transport",
      mimeType: "image/jpeg",
    });
    expect(
      await caller().previewVehicleSettlementSelection(selection)
    ).toMatchObject({ tripIds: [1], eligible: true });
    expect(
      mock.db.reads.filter((name: string) => name === "evidence_records")
    ).toHaveLength(5);
    expect(mock.db.writes).toBe(0);
  });
  it("period creation merges across inclusive China business dates and excludes both UTC boundary outsiders", async () => {
    seedTrip(1, { startAt: new Date("2026-11-03T15:59:59Z") });
    seedTrip(2, { startAt: new Date("2026-11-03T16:00:00Z") });
    seedTrip(3, { startAt: new Date("2026-11-05T15:59:59Z") });
    seedTrip(4, { startAt: new Date("2026-11-05T16:00:00Z") });
    const input = {
      ...selection,
      selectionMode: "period" as const,
      periodEnd: "2026-11-05",
    };
    const preview = await caller().previewVehicleSettlementSelection(input);
    expect(preview.tripIds).toEqual([2, 3]);
    const result = await caller().createVehicleSettlement({
      ...draft,
      ...input,
      tripIds: preview.tripIds,
    });
    expect(result).toMatchObject({ tripCount: 2, grossFreightAmount: 200 });
    expect(
      mock.db.rows.transport_vehicle_settlement_items.map(
        (row: any) => row.tripId
      )
    ).toEqual([2, 3]);
  });
  it("enforces settlement permission even for drivers with explicit read permission, project scope and vehicle category", async () => {
    seedTrip();
    for (const roles of [["DRIVER"], ["VEHICLE_OWNER"], ["VIEWER"]]) {
      mock.roles = roles;
      await expect(
        caller().previewVehicleSettlementSelection(selection)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller().createVehicleSettlement(draft)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    mock.roles = ["ALL"];
    await expect(
      caller().previewVehicleSettlementSelection({ ...selection, projectId: 2 })
    ).rejects.toThrow("未授权项目");
    mock.db.rows.transport_vehicles[0].projectId = 2;
    await expect(
      caller().previewVehicleSettlementSelection(selection)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    mock.db.rows.transport_vehicles[0].projectId = 1;
    mock.db.rows.transport_vehicles[0].ownership = "leased";
    await expect(
      caller().previewVehicleSettlementSelection(selection)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("preview excludes occupied/settled/unresolved rows and creation must reject insufficient N", async () => {
    seedTrip(1);
    seedTrip(2);
    seedTrip(3, { status: "settled" });
    seedTrip(4, { exceptionStatus: "open" });
    seedTrip(5, { unloadEventId: 999 });
    mock.db.rows.transport_vehicle_settlement_items = [
      { id: 1, tripId: 1, settlementId: 99 },
    ];
    const input = {
      ...selection,
      selectionMode: "trip_count" as const,
      tripCount: 2,
    };
    expect(
      await caller().previewVehicleSettlementSelection(input)
    ).toMatchObject({
      tripIds: [2],
      availableCount: 1,
      selectedCount: 1,
      eligible: false,
    });
    await expect(
      caller().createVehicleSettlement({ ...draft, ...input })
    ).rejects.toThrow("不足要求的 2 趟");
    expect(mock.db.writes).toBe(0);
  });
  it.each([0, 1001, 1.5])(
    "caller rejects tripCount %s before DB writes",
    async tripCount => {
      await expect(
        caller().previewVehicleSettlementSelection({
          ...selection,
          selectionMode: "trip_count",
          tripCount,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        caller().createVehicleSettlement({
          ...draft,
          selectionMode: "trip_count",
          tripCount,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(mock.db.reads).toEqual([]);
    }
  );
  it("caller rejects mismatched day, non-count tripCount and duplicate IDs", async () => {
    seedTrip();
    await expect(
      caller().previewVehicleSettlementSelection({
        ...selection,
        periodEnd: "2026-11-05",
      })
    ).rejects.toThrow("同一天");
    await expect(
      caller().createVehicleSettlement({ ...draft, tripCount: 1 })
    ).rejects.toThrow("只有");
    await expect(
      caller().createVehicleSettlement({ ...draft, tripIds: [1, 1] })
    ).rejects.toThrow("不得重复");
    await expect(
      caller().createVehicleSettlement({
        ...draft,
        selectionMode: undefined,
        legacyTripIds: [1, 1],
        legacyConfirmation: "核对依据",
      })
    ).rejects.toThrow("不得重复");
  });
  it.each(["day", "period"] as const)(
    "%s preview IDs must be the complete current set, added rows require refresh",
    async selectionMode => {
      seedTrip(1);
      seedTrip(2);
      const input = { ...selection, selectionMode };
      const preview = await caller().previewVehicleSettlementSelection(input);
      seedTrip(3);
      await expect(
        caller().createVehicleSettlement({
          ...draft,
          ...input,
          tripIds: preview.tripIds,
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        caller().createVehicleSettlement({
          ...draft,
          ...input,
          tripIds: [1, 2, 99],
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(mock.db.writes).toBe(0);
    }
  );
  it("new-mode occupation after preview must conflict rather than silently shrink", async () => {
    seedTrip(1);
    seedTrip(2);
    const preview = await caller().previewVehicleSettlementSelection(selection);
    mock.db.rows.transport_vehicle_settlement_items = [
      { id: 1, tripId: 1, settlementId: 99 },
    ];
    await expect(
      caller().createVehicleSettlement({ ...draft, tripIds: preview.tripIds })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("all previewed rows becoming occupied returns a refresh conflict, not a silently empty save", async () => {
    seedTrip(1);
    mock.db.rows.transport_vehicle_settlement_items = [
      { id: 1, tripId: 1, settlementId: 99 },
    ];
    await expect(
      caller().createVehicleSettlement({ ...draft, tripIds: [1] })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mock.db.writes).toBe(0);
  });
  it("trip_count requires earliest stable N, accepts same ID set independent of request order", async () => {
    seedTrip(3);
    seedTrip(1);
    seedTrip(2);
    const input = {
      ...draft,
      selectionMode: "trip_count" as const,
      tripCount: 2,
    };
    await expect(
      caller().createVehicleSettlement({ ...input, tripIds: [2, 3] })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      caller().createVehicleSettlement({ ...input, tripIds: [1] })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const result = await caller().createVehicleSettlement({
      ...input,
      tripIds: [2, 1],
    });
    expect(result).toMatchObject({ tripCount: 2, grossFreightAmount: 200 });
    expect(
      mock.db.rows.transport_vehicle_settlement_items.map(
        (row: any) => row.tripId
      )
    ).toEqual([1, 2]);
  });
  it.each(["added", "occupied", "eligibility", "date", "amount"])(
    "locked revalidation rejects %s change before transaction writes",
    async kind => {
      seedTrip(1);
      seedTrip(2);
      mock.db.beforeTransaction = () => {
        if (kind === "added") seedTrip(3);
        if (kind === "occupied")
          mock.db.rows.transport_vehicle_settlement_items = [
            { tripId: 1, settlementId: 99 },
          ];
        if (kind === "eligibility")
          mock.db.rows.transport_card_events[1].validationStatus =
            "needs_review";
        if (kind === "date")
          mock.db.rows.transport_trips[0].startAt = new Date(
            "2026-11-05T02:00:00Z"
          );
        if (kind === "amount")
          mock.db.rows.transport_trips[0].calculatedAmount = "999";
      };
      await expect(
        caller().createVehicleSettlement({ ...draft, tripIds: [1, 2] })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(mock.db.rows.transport_vehicle_settlements ?? []).toHaveLength(0);
      expect(mock.db.writes).toBe(0);
      expect(mock.db.locks.slice(0, 2)).toEqual([
        "projects",
        "transport_vehicles",
      ]);
      expect(mock.db.locks).toContain("transport_trips");
    }
  );
  it("backdated earlier trip changes trip_count first N even when requested rows still exist", async () => {
    seedTrip(2);
    seedTrip(3);
    mock.db.beforeTransaction = () =>
      seedTrip(1, { startAt: new Date("2026-11-04T01:00:00Z") });
    await expect(
      caller().createVehicleSettlement({
        ...draft,
        selectionMode: "trip_count",
        tripCount: 2,
        tripIds: [2, 3],
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("same-day multi-trip creates one settlement and preserves all original locks/concurrent uniqueness", async () => {
    seedTrip(1);
    seedTrip(2);
    const results = await Promise.allSettled([
      caller().createVehicleSettlement({ ...draft, tripIds: [1, 2] }),
      caller().createVehicleSettlement({ ...draft, tripIds: [1, 2] }),
    ]);
    expect(
      results.filter(result => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(mock.db.rows.transport_vehicle_settlements).toHaveLength(1);
    expect(mock.db.rows.transport_vehicle_settlement_items).toHaveLength(2);
    expect(mock.db.locks).toEqual(
      expect.arrayContaining([
        "projects",
        "transport_vehicles",
        "transport_trips",
        "transport_vehicle_settlement_items",
      ])
    );
  });
  it("legacy explicit API remains independent and requires finance, no auto-mixing historical settled trips", async () => {
    seedTrip(1, {
      status: "settled",
      fuelDeductionAmount: "45",
      netSettlementAmount: "55",
    });
    seedTrip(2);
    expect(
      (await caller().previewVehicleSettlementSelection(selection)).tripIds
    ).toEqual([2]);
    await expect(
      caller().createVehicleSettlement({
        ...draft,
        legacyTripIds: [1],
        legacyConfirmation: "原凭据逐单核对",
      })
    ).rejects.toThrow("不纳入历史");
    const legacy = {
      ...draft,
      selectionMode: undefined,
      tripIds: [1],
      legacyTripIds: [1],
      legacyConfirmation: "原凭据逐单核对",
    };
    mock.roles = ["TRANSPORT_MANAGER"];
    await expect(
      caller().createVehicleSettlement(legacy)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    mock.roles = ["ACCOUNTANT"];
    expect(await caller().createVehicleSettlement(legacy)).toMatchObject({
      tripCount: 1,
      fuelDeductionAmount: 45,
      netPayableAmount: 55,
    });
  });
  it("omitted selectionMode retains explicit single-trip and strict invalid/occupied IDs", async () => {
    seedTrip(1);
    seedTrip(2);
    const legacy = { ...draft, selectionMode: undefined };
    await expect(
      caller().createVehicleSettlement({ ...legacy, tripIds: [1, 99] })
    ).rejects.toThrow("不能静默忽略");
    expect(
      await caller().createVehicleSettlement({ ...legacy, tripIds: [2] })
    ).toMatchObject({ tripCount: 1, grossFreightAmount: 100 });
    await expect(
      caller().createVehicleSettlement({ ...legacy, tripIds: [2] })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
