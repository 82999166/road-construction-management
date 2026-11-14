import mysql from "mysql2/promise";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { backfillMachineFuelLedger } from "../scripts/backfill-machine-fuel-ledger.mjs";
const enabled = process.env.MACHINE_FUEL_REAL_DB_TEST === "1";
const suite = enabled ? describe : describe.skip;
suite("本机真实数据库机械柴油归集事务", () => {
  let db: any;
  beforeAll(async () => {
    const url = new URL(
      process.env.MACHINE_FUEL_TEST_DATABASE_URL ||
        "mysql://root@127.0.0.1:33316/machine_fuel_regression"
    );
    if (
      url.hostname !== "127.0.0.1" ||
      url.port !== "33316" ||
      url.pathname !== "/machine_fuel_regression"
    )
      throw Error("只允许指定本机隔离数据库");
    const admin = await mysql.createConnection({
      uri: url.toString().replace("/machine_fuel_regression", "/mysql"),
    });
    await admin.query("CREATE DATABASE IF NOT EXISTS machine_fuel_regression");
    await admin.end();
    db = await mysql.createConnection({
      uri: url.toString(),
      dateStrings: true,
      timezone: "+08:00",
    });
    await db.query("CREATE TABLE IF NOT EXISTS machines (id INT PRIMARY KEY)");
    await db.query("CREATE TABLE IF NOT EXISTS projects (id INT PRIMARY KEY)");
    await db.query(
      "CREATE TABLE IF NOT EXISTS machine_cost_records (id INT PRIMARY KEY,machineId INT,projectId INT,costType VARCHAR(32),costName VARCHAR(128),quantity DECIMAL(14,3),unitPrice DECIMAL(16,2),amount DECIMAL(16,2),occurredAt DATETIME,evidenceId INT NULL,remarks VARCHAR(500),status VARCHAR(32),createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,dieselRefuelRecordId BIGINT NULL)"
    );
    await db.query(
      "CREATE TABLE IF NOT EXISTS diesel_refuel_records (id BIGINT AUTO_INCREMENT PRIMARY KEY,recordNo VARCHAR(64) UNIQUE,projectId INT,assetType VARCHAR(16),vehicleId INT NULL,machineId INT NULL,transportTripId BIGINT NULL,supplyMethod VARCHAR(32),stationOrSupplierName VARCHAR(160) NULL,liters DECIMAL(12,3),actualUnitPrice DECIMAL(16,2) NULL,appliedUnitPrice DECIMAL(16,2),amount DECIMAL(16,2),deductFromFreight BOOLEAN,refueledAt DATETIME,meterReading DECIMAL(14,2) NULL,receiptNo VARCHAR(64) NULL,evidenceId INT NULL,remarks VARCHAR(500) NULL,status VARCHAR(32),createdBy INT,approvedBy INT NULL,approvedAt DATETIME NULL,createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)"
    );
    await db.query(
      "CREATE TABLE IF NOT EXISTS audit_logs (id INT AUTO_INCREMENT PRIMARY KEY,userId INT,module VARCHAR(64),action VARCHAR(64),targetType VARCHAR(64),targetId VARCHAR(128),summary VARCHAR(1000))"
    );
    for (const table of [
      "diesel_refuel_records",
      "machine_cost_records",
      "audit_logs",
    ])
      await db.query(
        `ALTER TABLE ${table} CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
  });
  afterAll(async () => {
    if (db) await db.end();
  });
  beforeEach(async () => {
    for (const table of [
      "diesel_refuel_records",
      "machine_cost_records",
      "audit_logs",
      "machines",
      "projects",
    ])
      await db.query(`DELETE FROM ${table}`);
    await db.query("INSERT INTO machines VALUES (12),(13)");
    await db.query("INSERT INTO projects VALUES (3)");
    await db.query(
      "INSERT INTO machine_cost_records (id,machineId,projectId,costType,costName,quantity,unitPrice,amount,occurredAt,status) VALUES (1,13,3,'fuel','柴油',126.117,8.61,1085.87,'2026-11-12 12:00:00','settled'),(2,13,3,'fuel','柴油',123.889,8.61,1066.68,'2026-11-12 11:59:00','settled'),(3,12,3,'fuel','柴油',180.426,8.61,1553.47,'2026-11-12 11:56:00','settled')"
    );
    for (const id of [1, 2, 3])
      await db.execute(
        "INSERT INTO audit_logs (userId,module,action,targetType,targetId,summary) VALUES (9,'machinery','create_cost','machine_cost',?,'原登记')",
        [String(id)]
      );
  });
  it("三筆真实SQL写入保持430.432L/3706.02和settled，二次执行零增加", async () => {
    const preview = await backfillMachineFuelLedger(db);
    expect(preview.candidateCount).toBe(3);
    const result = await backfillMachineFuelLedger(db, {
      apply: true,
      expectedDigest: preview.planDigest,
      auditActorId: 1,
    });
    expect(result).toMatchObject({
      created: 3,
      linked: 3,
      originalCostSnapshotsPreserved: true,
      unknownOriginalActors: 0,
    });
    const [[sum]] = await db.query(
      "SELECT SUM(liters) AS liters,SUM(amount) AS amount,COUNT(*) AS count FROM diesel_refuel_records"
    );
    expect(Number(sum.liters)).toBe(430.432);
    expect(Number(sum.amount)).toBe(3706.02);
    expect(Number(sum.count)).toBe(3);
    const [rows] = await db.query(
      "SELECT status,supplyMethod,createdBy FROM diesel_refuel_records"
    );
    expect(
      rows.every(
        (r: any) =>
          r.status === "settled" &&
          r.supplyMethod === "project_supply" &&
          r.createdBy === 9
      )
    ).toBe(true);
    const repeated = await backfillMachineFuelLedger(db);
    expect(repeated.candidateCount).toBe(0);
    expect(
      await backfillMachineFuelLedger(db, {
        apply: true,
        expectedDigest: repeated.planDigest,
      })
    ).toMatchObject({ created: 0, linked: 0 });
  });
  it("后续一条缺失机械时前面插入全部回滚", async () => {
    await db.query("DELETE FROM machines WHERE id=12");
    const preview = await backfillMachineFuelLedger(db);
    await expect(
      backfillMachineFuelLedger(db, {
        apply: true,
        expectedDigest: preview.planDigest,
      })
    ).rejects.toThrow("依据缺失");
    const [[r]] = await db.query(
      "SELECT COUNT(*) AS count FROM diesel_refuel_records"
    );
    expect(Number(r.count)).toBe(0);
    const [[c]] = await db.query(
      "SELECT COUNT(*) AS count FROM machine_cost_records WHERE dieselRefuelRecordId IS NOT NULL"
    );
    expect(Number(c.count)).toBe(0);
  });
  it("预览后金额变化拒绝写入，不使用旧预览", async () => {
    const preview = await backfillMachineFuelLedger(db);
    await db.query("UPDATE machine_cost_records SET amount=1085.88 WHERE id=1");
    await expect(
      backfillMachineFuelLedger(db, {
        apply: true,
        expectedDigest: preview.planDigest,
      })
    ).rejects.toThrow("已变化");
    const [[r]] = await db.query(
      "SELECT COUNT(*) AS count FROM diesel_refuel_records"
    );
    expect(Number(r.count)).toBe(0);
  });
});
