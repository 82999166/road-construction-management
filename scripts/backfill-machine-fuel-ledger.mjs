import mysql from "mysql2/promise";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const MACHINE_FUEL_RECORD_PREFIX = "DS-MC-";
export function machineFuelRecordNo(id) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0)
    throw new Error("机械费用编号无效");
  return `${MACHINE_FUEL_RECORD_PREFIX}${id}`;
}
const preservedFields = [
  "id",
  "machineId",
  "projectId",
  "costType",
  "costName",
  "quantity",
  "unitPrice",
  "amount",
  "occurredAt",
  "evidenceId",
  "remarks",
  "status",
  "createdAt",
];
export function preservedCostSnapshot(cost) {
  return Object.fromEntries(
    preservedFields.map(key => [key, cost[key] ?? null])
  );
}
function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function equalDecimal(a, b) {
  return Number(a) === Number(b);
}
export function assertMatchingFuelRecord(cost, fuel) {
  if (
    !fuel ||
    fuel.assetType !== "machine" ||
    Number(fuel.machineId) !== Number(cost.machineId) ||
    Number(fuel.projectId) !== Number(cost.projectId) ||
    fuel.status !== cost.status ||
    !equalDecimal(fuel.liters, cost.quantity) ||
    !equalDecimal(fuel.appliedUnitPrice, cost.unitPrice) ||
    !equalDecimal(fuel.amount, cost.amount) ||
    String(fuel.refueledAt) !== String(cost.occurredAt) ||
    fuel.deductFromFreight ||
    fuel.vehicleId ||
    fuel.transportTripId
  ) {
    throw new Error("机械费用与关联柴油台账不一致，停止归集并保留原始数据");
  }
}
export function buildBackfillPlan(costs, fuelRows, actors = new Map()) {
  const byId = new Map(fuelRows.map(row => [Number(row.id), row]));
  const byNo = new Map(fuelRows.map(row => [row.recordNo, row]));
  const usedLinks = new Set();
  const candidates = [];
  for (const cost of [...costs].sort((a, b) => Number(a.id) - Number(b.id))) {
    if (cost.costType !== "fuel") throw new Error("归集只允许机械柴油费用");
    if (
      !Number.isSafeInteger(Number(cost.machineId)) ||
      Number(cost.machineId) <= 0 ||
      !Number.isSafeInteger(Number(cost.projectId)) ||
      Number(cost.projectId) <= 0 ||
      !["draft", "approved", "settled", "void"].includes(cost.status) ||
      ![cost.quantity, cost.unitPrice, cost.amount].every(
        value =>
          value !== null && Number.isFinite(Number(value)) && Number(value) >= 0
      ) ||
      !cost.occurredAt
    )
      throw new Error("历史机械柴油资料不完整，停止归集");
    if (cost.dieselRefuelRecordId) {
      const link = Number(cost.dieselRefuelRecordId);
      if (usedLinks.has(link))
        throw new Error("同一柴油记录被重复关联，停止归集");
      usedLinks.add(link);
      assertMatchingFuelRecord(cost, byId.get(link));
      continue;
    }
    const recordNo = machineFuelRecordNo(cost.id);
    const existing = byNo.get(recordNo);
    if (existing) {
      assertMatchingFuelRecord(cost, existing);
      if (usedLinks.has(Number(existing.id)))
        throw new Error("柴油来源编号已被其他费用占用");
      usedLinks.add(Number(existing.id));
    }
    candidates.push({
      cost: preservedCostSnapshot(cost),
      recordNo,
      existingRecordId: existing?.id ?? null,
      createdBy: Number(actors.get(Number(cost.id)) ?? 0),
    });
  }
  return {
    digest: hash({
      costs: costs
        .map(cost => ({
          ...preservedCostSnapshot(cost),
          dieselRefuelRecordId: cost.dieselRefuelRecordId ?? null,
        }))
        .sort((a, b) => Number(a.id) - Number(b.id)),
      candidates,
    }),
    candidates,
    totalFuelCosts: costs.length,
    alreadyLinked: costs.length - candidates.length,
  };
}
async function load(connection, lock = false) {
  const [costs] = await connection.query(
    "SELECT * FROM machine_cost_records WHERE costType=? ORDER BY id" +
      (lock ? " FOR UPDATE" : ""),
    ["fuel"]
  );
  const [fuelRows] = await connection.query(
    "SELECT * FROM diesel_refuel_records WHERE assetType=? ORDER BY id" +
      (lock ? " FOR UPDATE" : ""),
    ["machine"]
  );
  const [events] = await connection.query(
    "SELECT targetId,userId FROM audit_logs WHERE module=? AND action=? AND targetType=? ORDER BY id",
    ["machinery", "create_cost", "machine_cost"]
  );
  const identities = new Map();
  for (const event of events) {
    const id = Number(event.targetId),
      actor = Number(event.userId);
    if (
      Number.isSafeInteger(id) &&
      id > 0 &&
      Number.isSafeInteger(actor) &&
      actor > 0
    ) {
      const set = identities.get(id) ?? new Set();
      set.add(actor);
      identities.set(id, set);
    }
  }
  const actors = new Map(
    [...identities.entries()]
      .filter(([, set]) => set.size === 1)
      .map(([id, set]) => [id, [...set][0]])
  );
  return { costs, fuelRows, plan: buildBackfillPlan(costs, fuelRows, actors) };
}
export async function backfillMachineFuelLedger(
  connection,
  { apply = false, expectedDigest, auditActorId = 0 } = {}
) {
  const [[lock]] = await connection.query(
    "SELECT GET_LOCK(?, 15) AS acquired",
    ["yx-machine-fuel-ledger-backfill"]
  );
  if (Number(lock.acquired) !== 1)
    throw new Error("机械柴油归集正在执行，请稍后重试");
  let transaction = false;
  try {
    if (apply) {
      await connection.beginTransaction();
      transaction = true;
      await connection.query("SELECT id FROM machines ORDER BY id FOR UPDATE");
    }
    const { costs, plan } = await load(connection, apply);
    const report = {
      applied: apply,
      planDigest: plan.digest,
      totalFuelCosts: plan.totalFuelCosts,
      alreadyLinked: plan.alreadyLinked,
      candidateCount: plan.candidates.length,
      created: 0,
      linked: 0,
      originalCostSnapshotsPreserved: true,
      unknownOriginalActors: plan.candidates.filter(row => !row.createdBy)
        .length,
    };
    if (!apply) return report;
    if (!expectedDigest || expectedDigest !== plan.digest)
      throw new Error("历史记录已变化，需重新只读核对后再执行归集");
    const before = hash(costs.map(preservedCostSnapshot));
    for (const entry of plan.candidates) {
      const cost = entry.cost;
      const [[machine]] = await connection.query(
        "SELECT id FROM machines WHERE id=?",
        [cost.machineId]
      );
      const [[project]] = await connection.query(
        "SELECT id FROM projects WHERE id=?",
        [cost.projectId]
      );
      if (!machine || !project)
        throw new Error("机械或项目历史依据缺失，停止归集");
      let recordId = entry.existingRecordId;
      if (!recordId) {
        if (!entry.createdBy)
          throw new Error("历史机械柴油缺少唯一真实登记人证据，停止归集");
        const [result] = await connection.execute(
          "INSERT INTO diesel_refuel_records (recordNo,projectId,assetType,vehicleId,machineId,transportTripId,supplyMethod,stationOrSupplierName,liters,actualUnitPrice,appliedUnitPrice,amount,deductFromFreight,refueledAt,meterReading,receiptNo,evidenceId,remarks,status,createdBy,approvedBy,approvedAt,createdAt) VALUES (?,?,?,NULL,?,NULL,?,NULL,?,NULL,?,?,0,?,NULL,NULL,?,?,?, ?,NULL,NULL,?)",
          [
            entry.recordNo,
            cost.projectId,
            "machine",
            cost.machineId,
            "project_supply",
            cost.quantity,
            cost.unitPrice,
            cost.amount,
            cost.occurredAt,
            cost.evidenceId,
            cost.remarks,
            cost.status,
            entry.createdBy,
            cost.createdAt ?? cost.occurredAt,
          ]
        );
        recordId = Number(result.insertId);
        if (!Number.isSafeInteger(recordId) || recordId <= 0)
          throw new Error("柴油归集保存失败");
        report.created += 1;
      }
      const [updated] = await connection.execute(
        "UPDATE machine_cost_records SET dieselRefuelRecordId=? WHERE id=? AND costType=? AND dieselRefuelRecordId IS NULL",
        [recordId, cost.id, "fuel"]
      );
      if (updated.affectedRows !== 1)
        throw new Error("机械柴油关联已变化，归集已取消");
      report.linked += 1;
    }
    const final = await load(connection, true);
    if (
      hash(final.costs.map(preservedCostSnapshot)) !== before ||
      final.plan.candidates.length !== 0
    )
      throw new Error("归集后校验未通过，全部回滚");
    if (report.linked)
      await connection.execute(
        "INSERT INTO audit_logs (userId,module,action,targetType,targetId,summary) VALUES (?,?,?,?,?,?)",
        [
          auditActorId,
          "diesel",
          "backfill_machine_fuel",
          "machine_fuel_ledger",
          plan.digest,
          `机械柴油统一归集${report.linked}笔；保留原数量、单价、金额、日期和审核结算状态；未新增机械成本或发送短信`,
        ]
      );
    await connection.commit();
    transaction = false;
    return report;
  } catch (error) {
    if (transaction) await connection.rollback();
    throw error;
  } finally {
    await connection.query("SELECT RELEASE_LOCK(?)", [
      "yx-machine-fuel-ledger-backfill",
    ]);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const apply = process.argv.includes("--apply");
  const expectedDigest = process.argv
    .find(value => value.startsWith("--expected-digest="))
    ?.slice("--expected-digest=".length);
  const actor =
    process.argv
      .find(value => value.startsWith("--audit-actor="))
      ?.slice("--audit-actor=".length) ?? "0";
  if (!process.env.DATABASE_URL) throw new Error("数据库连接未配置");
  const connection = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    dateStrings: true,
    timezone: "+08:00",
  });
  try {
    console.log(
      JSON.stringify(
        await backfillMachineFuelLedger(connection, {
          apply,
          expectedDigest,
          auditActorId: Number(actor),
        })
      )
    );
  } finally {
    await connection.end();
  }
}
