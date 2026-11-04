import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Express } from "express";
import { TRPCError } from "@trpc/server";
import { and, eq, ne } from "drizzle-orm";
import * as s from "../../drizzle/schema";
import { assertCertificateFileSignature } from "../../shared/domain";
import type { TrpcContext } from "../_core/context";
import { getSuperAdminAccess } from "../access";
import { createContext } from "../_core/context";
import { ENV } from "../_core/env";
import { storagePut, storageGetSignedUrl } from "../storage";
import { encryptSecret, decryptSecret } from "./secretVault";
import { chinaBusinessDate } from "./chinaBusinessTime";
import { isAliyunOssPhotoStorageKey } from "./aliyunOssPhotoStorage";
import { mutateFleet, type FleetBase } from "./vehicleManagementCore";
import {
  fail,
  fleetAccess,
  requireFleetDb,
  safeDocument,
  workOrderTransition,
} from "./vehicleManagementPolicy";

export type ProfileFields = Pick<
  typeof s.vehicleFleetProfiles.$inferInsert,
  | "propertyType"
  | "settlementMode"
  | "purpose"
  | "vin"
  | "brandModel"
  | "registeredOn"
  | "energyType"
  | "emissionStandard"
  | "trailerVehicleId"
  | "remarks"
> & { effectiveCapacityM3?: number | null };
export async function saveFleetProfile(
  ctx: TrpcContext,
  input: FleetBase & ProfileFields
) {
  return mutateFleet(ctx, input, "saveProfile", async (tx, vehicle) => {
    if (input.trailerVehicleId === vehicle.id) fail("不能将车辆关联为自身挂车");
    if (input.trailerVehicleId) {
      const [trailer] = await tx
        .select()
        .from(s.transportVehicles)
        .where(eq(s.transportVehicles.id, input.trailerVehicleId))
        .limit(1);
      const [profile] = await tx
        .select()
        .from(s.vehicleFleetProfiles)
        .where(eq(s.vehicleFleetProfiles.vehicleId, input.trailerVehicleId))
        .limit(1);
      if (
        !trailer ||
        trailer.projectId !== vehicle.projectId ||
        profile?.purpose !== "trailer" ||
        profile.archived
      )
        fail("请选择同项目已登记为挂车且未归档的车辆");
      if (vehicle.vehicleType !== "tractor") fail("只有牵引车可以维护挂车组合");
      const used = await tx
        .select({ id: s.vehicleFleetProfiles.vehicleId })
        .from(s.vehicleFleetProfiles)
        .where(
          and(
            eq(s.vehicleFleetProfiles.trailerVehicleId, trailer.id),
            ne(s.vehicleFleetProfiles.vehicleId, vehicle.id),
            eq(s.vehicleFleetProfiles.archived, false)
          )
        )
        .limit(1);
      if (used.length) fail("该挂车已被其他牵引车关联", "CONFLICT");
    }
    const { vehicleId, projectId, version, effectiveCapacityM3, ...fields } =
      input;
    await tx
      .update(s.vehicleFleetProfiles)
      .set({
        ...fields,
        effectiveCapacityM3:
          effectiveCapacityM3 === undefined
            ? undefined
            : effectiveCapacityM3 === null
              ? null
              : String(effectiveCapacityM3),
      })
      .where(eq(s.vehicleFleetProfiles.vehicleId, vehicle.id));
    return { fields: { ...fields, effectiveCapacityM3 } };
  });
}
export async function setFleetState(
  ctx: TrpcContext,
  input: FleetBase & {
    dispatchStatus: "standby" | "working" | "paused";
    reason: string;
  }
) {
  return mutateFleet(ctx, input, "setState", async (tx, vehicle, profile) => {
    if (
      input.dispatchStatus !== "paused" &&
      (vehicle.status !== "active" ||
        profile.technicalStatus !== "normal" ||
        profile.projectStatus !== "on_site")
    )
      fail("车辆须启用、在场且维修验收放行后，才能恢复调度");
    await tx
      .update(s.vehicleFleetProfiles)
      .set({ dispatchStatus: input.dispatchStatus })
      .where(eq(s.vehicleFleetProfiles.vehicleId, vehicle.id));
    return { dispatchStatus: input.dispatchStatus, reason: input.reason };
  });
}
export async function inspectFleet(
  ctx: TrpcContext,
  input: FleetBase & {
    occurredAt: number;
    driverPersonId?: number;
    meterReading?: number | null;
    items: {
      key: string;
      result: "pass" | "fail" | "unknown";
      note?: string;
    }[];
    safetyFault: boolean;
    notes: string;
  }
) {
  if (
    input.occurredAt > Date.now() ||
    chinaBusinessDate(new Date(input.occurredAt)) !==
      chinaBusinessDate(new Date())
  )
    fail("出车检查请登记今天已实际发生的时间");
  if (new Set(input.items.map(x => x.key)).size !== input.items.length)
    fail("检查项目不能重复");
  return mutateFleet(
    ctx,
    input,
    "inspect",
    async (tx, vehicle, profile, actorId) => {
      if (
        input.driverPersonId &&
        input.driverPersonId !== vehicle.driverPersonId
      )
        fail("检查驾驶员须为当前明确关联人员");
      const fault =
        input.safetyFault || input.items.some(x => x.result === "fail");
      const [inserted] = await tx
        .insert(s.vehicleInspections)
        .values({
          vehicleId: vehicle.id,
          projectId: vehicle.projectId,
          occurredAt: new Date(input.occurredAt),
          driverPersonId: input.driverPersonId ?? vehicle.driverPersonId,
          meterReading:
            input.meterReading == null ? null : String(input.meterReading),
          items: input.items,
          safetyFault: fault,
          notes: input.notes,
          createdBy: actorId,
        });
      const inspectionId = Number(inserted.insertId);
      let workOrderId: number | null = null;
      if (fault) {
        const [order] = await tx
          .insert(s.vehicleWorkOrders)
          .values({
            vehicleId: vehicle.id,
            projectId: vehicle.projectId,
            inspectionId,
            safetyFault:
              input.safetyFault ||
              input.items.some(
                x =>
                  ["brakes", "tires", "lights", "sealing"].includes(x.key) &&
                  x.result === "fail"
              ),
            fault: input.notes,
            purchaseOrderIds: [],
            stoppedAt: new Date(input.occurredAt),
            createdBy: actorId,
          });
        workOrderId = Number(order.insertId);
        await tx
          .update(s.vehicleFleetProfiles)
          .set({ technicalStatus: "safety_hold", dispatchStatus: "paused" })
          .where(eq(s.vehicleFleetProfiles.vehicleId, vehicle.id));
      } else if (input.items.some(x => x.result === "unknown")) {
        await tx
          .update(s.vehicleFleetProfiles)
          .set({ dispatchStatus: "paused" })
          .where(eq(s.vehicleFleetProfiles.vehicleId, vehicle.id));
      }
      // A successful check never independently releases an open repair order.
      return {
        inspectionId,
        workOrderId,
        outcome: fault
          ? "fault"
          : input.items.some(x => x.result === "unknown")
            ? "unknown"
            : "passed",
      };
    },
    new Date(input.occurredAt)
  );
}
export async function transitionFleetWorkOrder(
  ctx: TrpcContext,
  input: FleetBase & {
    workOrderId: number;
    action: "start" | "submit_acceptance" | "reject" | "accept" | "release";
    reason: string;
    serviceProvider?: string;
    laborHours?: number;
    partsDescription?: string;
    costBearer?: "company" | "owner" | "shared";
    maintenanceRecordId?: number;
    purchaseOrderIds?: number[];
  }
) {
  if (["accept", "release"].includes(input.action))
    await fleetAccess(ctx, "review", input.projectId);
  return mutateFleet(
    ctx,
    input,
    "transitionWorkOrder",
    async (tx, vehicle, profile, actorId) => {
      const [order] = await tx
        .select()
        .from(s.vehicleWorkOrders)
        .where(
          and(
            eq(s.vehicleWorkOrders.id, input.workOrderId),
            eq(s.vehicleWorkOrders.vehicleId, vehicle.id),
            eq(s.vehicleWorkOrders.projectId, input.projectId)
          )
        )
        .limit(1)
        .for("update");
      if (!order) fail("维修工单不属于该车辆项目", "NOT_FOUND");
      const status = workOrderTransition(order.status, input.action);
      if (
        ["accept", "release"].includes(input.action) &&
        order.createdBy === actorId &&
        !(await getSuperAdminAccess(ctx)).canAccess
      )
        fail("需由复核人员独立验收");
      if (input.maintenanceRecordId) {
        const [cost] = await tx
          .select()
          .from(s.assetMaintenanceRecords)
          .where(eq(s.assetMaintenanceRecords.id, input.maintenanceRecordId))
          .limit(1)
          .for("update");
        if (
          !cost ||
          cost.assetType !== "vehicle" ||
          cost.assetId !== vehicle.id ||
          cost.projectId !== input.projectId ||
          cost.status === "void"
        )
          fail("关联维修费用不属于本车本项目有效台账");
      }
      const purchaseIds = Array.from(
        new Set(input.purchaseOrderIds ?? order.purchaseOrderIds)
      );
      for (const id of purchaseIds) {
        const [purchase] = await tx
          .select()
          .from(s.purchaseOrders)
          .where(eq(s.purchaseOrders.id, id))
          .limit(1)
          .for("update");
        if (
          !purchase ||
          purchase.assetType !== "vehicle" ||
          purchase.assetId !== vehicle.id ||
          purchase.projectId !== input.projectId ||
          purchase.status === "void"
        )
          fail("关联采购单不属于本车本项目有效台账");
        const duplicate = await tx
          .select({ id: s.vehicleWorkOrders.id })
          .from(s.vehicleWorkOrders)
          .where(
            and(
              eq(s.vehicleWorkOrders.vehicleId, vehicle.id),
              ne(s.vehicleWorkOrders.id, order.id)
            )
          );
        if (duplicate.length) {
          const others = await tx
            .select()
            .from(s.vehicleWorkOrders)
            .where(
              and(
                eq(s.vehicleWorkOrders.vehicleId, vehicle.id),
                ne(s.vehicleWorkOrders.id, order.id)
              )
            );
          if (others.some(o => o.purchaseOrderIds.includes(id)))
            fail("采购凭证已关联其他维修工单，请核实不能重复归集", "CONFLICT");
        }
      }
      const now = new Date();
      await tx
        .update(s.vehicleWorkOrders)
        .set({
          status,
          serviceProvider: input.serviceProvider,
          laborHours:
            input.laborHours === undefined
              ? undefined
              : String(input.laborHours),
          partsDescription: input.partsDescription,
          costBearer: input.costBearer,
          maintenanceRecordId: input.maintenanceRecordId,
          purchaseOrderIds: purchaseIds,
          repairedAt: input.action === "submit_acceptance" ? now : undefined,
          acceptedAt: input.action === "accept" ? now : undefined,
          acceptedBy: input.action === "accept" ? actorId : undefined,
          releasedAt: input.action === "release" ? now : undefined,
          releasedBy: input.action === "release" ? actorId : undefined,
        })
        .where(eq(s.vehicleWorkOrders.id, order.id));
      const otherOpen = await tx
        .select({ id: s.vehicleWorkOrders.id })
        .from(s.vehicleWorkOrders)
        .where(
          and(
            eq(s.vehicleWorkOrders.vehicleId, vehicle.id),
            ne(s.vehicleWorkOrders.id, order.id),
            ne(s.vehicleWorkOrders.status, "released")
          )
        );
      await tx
        .update(s.vehicleFleetProfiles)
        .set({
          technicalStatus:
            status === "released" && !otherOpen.length
              ? "normal"
              : status === "repairing"
                ? "repair"
                : "safety_hold",
          dispatchStatus: "paused",
        })
        .where(eq(s.vehicleFleetProfiles.vehicleId, vehicle.id));
      return { workOrderId: order.id, status, reason: input.reason };
    }
  );
}
export async function saveFleetMaintenancePlan(
  ctx: TrpcContext,
  input: FleetBase & {
    id?: number;
    title: string;
    dueOn?: string | null;
    dueMileage?: number | null;
    lastMileage?: number | null;
    source: string;
    completedAt?: number | null;
  }
) {
  if (!input.dueOn && input.dueMileage == null)
    fail("至少配置日期或里程一种保养条件");
  if (input.completedAt && input.completedAt > Date.now())
    fail("不能提前记录未发生的保养完成");
  return mutateFleet(
    ctx,
    input,
    "saveMaintenancePlan",
    async (tx, vehicle, profile, actorId) => {
      const [existing] = input.id
        ? await tx
            .select()
            .from(s.vehicleMaintenancePlans)
            .where(
              and(
                eq(s.vehicleMaintenancePlans.id, input.id),
                eq(s.vehicleMaintenancePlans.vehicleId, vehicle.id),
                eq(s.vehicleMaintenancePlans.projectId, input.projectId)
              )
            )
            .limit(1)
            .for("update")
        : [];
      if (input.id && !existing) fail("保养计划不属于本车本项目", "NOT_FOUND");
      if (existing?.completedAt)
        fail("已完成保养保留历史；下次保养请新增计划", "CONFLICT");
      const values = {
        vehicleId: vehicle.id,
        projectId: input.projectId,
        title: input.title,
        dueOn: input.dueOn,
        dueMileage:
          input.dueMileage === undefined
            ? undefined
            : input.dueMileage === null
              ? null
              : String(input.dueMileage),
        lastMileage:
          input.lastMileage === undefined
            ? undefined
            : input.lastMileage === null
              ? null
              : String(input.lastMileage),
        source: input.source,
        completedAt: input.completedAt ? new Date(input.completedAt) : null,
      };
      let planId = existing?.id;
      if (existing)
        await tx
          .update(s.vehicleMaintenancePlans)
          .set(values)
          .where(eq(s.vehicleMaintenancePlans.id, existing.id));
      else {
        const [created] = await tx
          .insert(s.vehicleMaintenancePlans)
          .values({ ...values, createdBy: actorId });
        planId = Number(created.insertId);
      }
      return { planId };
    }
  );
}
export async function saveFleetSpecialRecord(
  ctx: TrpcContext,
  input: FleetBase & {
    kind: "earthwork" | "monitoring";
    recordedAt: number;
    data: Record<string, string | number | boolean | null | undefined>;
    reason: string;
  }
) {
  if (input.recordedAt > Date.now()) fail("专项档案只能登记已实际发生的资料");
  return mutateFleet(
    ctx,
    input,
    "saveSpecialRecord",
    async (tx, vehicle, profile, actorId) => {
      const data = Object.fromEntries(
        Object.entries(input.data)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [
            k,
            typeof v === "number" ? new Date(v).toISOString() : v,
          ])
      ) as Record<string, string | boolean | null>;
      const [result] = await tx
        .insert(s.vehicleSpecialRecords)
        .values({
          vehicleId: vehicle.id,
          projectId: input.projectId,
          kind: input.kind,
          recordedAt: new Date(input.recordedAt),
          data,
          reason: input.reason,
          source: "manual",
          createdBy: actorId,
        });
      return {
        specialRecordId: Number(result.insertId),
        kind: input.kind,
        source: "manual",
      };
    },
    new Date(input.recordedAt)
  );
}
export async function revokeFleetAccess(
  ctx: TrpcContext,
  input: FleetBase & { grantId: number; reason: string }
) {
  await fleetAccess(ctx, "manage", input.projectId);
  return mutateFleet(
    ctx,
    input,
    "revokeAccess",
    async (tx, vehicle, profile, actorId) => {
      const [grant] = await tx
        .select()
        .from(s.vehicleAccessGrants)
        .where(
          and(
            eq(s.vehicleAccessGrants.id, input.grantId),
            eq(s.vehicleAccessGrants.vehicleId, vehicle.id),
            eq(s.vehicleAccessGrants.projectId, input.projectId)
          )
        )
        .limit(1)
        .for("update");
      if (!grant || grant.revokedAt)
        fail("授权已撤销或不属于该车辆项目", "CONFLICT");
      await tx
        .update(s.vehicleAccessGrants)
        .set({ revokedAt: new Date(), revokedBy: actorId })
        .where(eq(s.vehicleAccessGrants.id, grant.id));
      return { grantId: grant.id, reason: input.reason };
    }
  );
}
const MAX_BYTES = 8 * 1024 * 1024;
export type VehicleDocumentInput = FleetBase & {
  kind: typeof s.vehicleDocuments.$inferSelect.kind;
  title: string;
  applicable: boolean;
  validFrom?: string;
  validTo?: string;
  originalName: string;
  mimeType: "image/jpeg" | "image/png" | "application/pdf";
  base64: string;
};
export function decodeVehicleDocument(
  value: string,
  mime: VehicleDocumentInput["mimeType"]
) {
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value) ||
    value.length > Math.ceil(MAX_BYTES / 3) * 4
  )
    fail("附件编码无效或超过8MB");
  const bytes = Buffer.from(value, "base64");
  if (
    !bytes.length ||
    bytes.length > MAX_BYTES ||
    bytes.toString("base64") !== value
  )
    fail("附件内容无效或超过8MB");
  try {
    assertCertificateFileSignature(bytes, mime);
  } catch {
    fail("附件内容与JPG、PNG或PDF类型不符");
  }
  return bytes;
}
export async function uploadFleetDocument(
  ctx: TrpcContext,
  input: VehicleDocumentInput
) {
  if (input.validFrom && input.validTo && input.validTo < input.validFrom)
    fail("证照结束日期不能早于开始日期");
  const bytes = decodeVehicleDocument(input.base64, input.mimeType);
  return mutateFleet(
    ctx,
    input,
    "uploadDocument",
    async (tx, vehicle, profile, actorId) => {
      const key = `vehicle-private/${vehicle.id}/${randomUUID()}.enc`;
      const stored = await storagePut(
        key,
        encryptSecret(bytes.toString("base64")),
        "application/octet-stream"
      );
      const [result] = await tx
        .insert(s.vehicleDocuments)
        .values({
          vehicleId: vehicle.id,
          projectId: input.projectId,
          kind: input.kind,
          title: input.title,
          applicable: input.applicable,
          validFrom: input.validFrom,
          validTo: input.validTo,
          fileKey: stored.key,
          originalName: path.basename(input.originalName),
          mimeType: input.mimeType,
          contentBytes: bytes.length,
          contentSha256: createHash("sha256").update(bytes).digest("hex"),
          createdBy: actorId,
        });
      return {
        documentId: Number(result.insertId),
        kind: input.kind,
        title: input.title,
      };
    }
  );
}
export async function verifyFleetDocument(
  ctx: TrpcContext,
  input: FleetBase & {
    documentId: number;
    result: "verified" | "rejected" | "not_applicable";
    reason: string;
  }
) {
  await fleetAccess(ctx, "review", input.projectId);
  return mutateFleet(
    ctx,
    input,
    "verifyDocument",
    async (tx, vehicle, profile, actorId) => {
      const [doc] = await tx
        .select()
        .from(s.vehicleDocuments)
        .where(
          and(
            eq(s.vehicleDocuments.id, input.documentId),
            eq(s.vehicleDocuments.vehicleId, vehicle.id),
            eq(s.vehicleDocuments.projectId, input.projectId)
          )
        )
        .limit(1)
        .for("update");
      if (!doc) fail("证照不属于本车本项目", "NOT_FOUND");
      if (doc.verificationStatus !== "pending")
        fail("证照已核验；更正或续办应新增记录保留历史", "CONFLICT");
      await tx
        .update(s.vehicleDocuments)
        .set({
          verificationStatus: input.result,
          applicable: input.result !== "not_applicable",
          verifiedAt: new Date(),
          verifiedBy: actorId,
          verificationNote: input.reason,
        })
        .where(eq(s.vehicleDocuments.id, doc.id));
      return { documentId: doc.id, result: input.result, reason: input.reason };
    }
  );
}
type PreviewToken = {
  actorId: number;
  vehicleId: number;
  projectId: number;
  documentId: number;
  expires: number;
};
const tokens = new Map<string, PreviewToken>();
async function authorizedVehicleDocument(
  ctx: TrpcContext,
  input: { vehicleId: number; projectId: number; documentId: number }
) {
  await fleetAccess(ctx, "read", input.projectId);
  const db = await requireFleetDb();
  const [doc] = await db
    .select()
    .from(s.vehicleDocuments)
    .where(
      and(
        eq(s.vehicleDocuments.id, input.documentId),
        eq(s.vehicleDocuments.vehicleId, input.vehicleId),
        eq(s.vehicleDocuments.projectId, input.projectId)
      )
    )
    .limit(1);
  if (
    !doc ||
    !doc.fileKey.startsWith(`vehicle-private/${input.vehicleId}/`) ||
    !["image/jpeg", "image/png", "application/pdf"].includes(doc.mimeType) ||
    doc.contentBytes > MAX_BYTES
  )
    fail("车辆附件来源不符，不能预览", "FORBIDDEN");
  return doc;
}
export async function previewFleetDocument(
  ctx: TrpcContext,
  input: { vehicleId: number; projectId: number; documentId: number }
) {
  const doc = await authorizedVehicleDocument(ctx, input);
  const { actor } = await fleetAccess(ctx, "read", input.projectId);
  for (const [key, t] of Array.from(tokens.entries()))
    if (t.expires <= Date.now()) tokens.delete(key);
  if (tokens.size >= 1000)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "附件预览繁忙，请稍后再试",
    });
  const token = randomUUID().replace(/-/g, "");
  const expires = Date.now() + 120000;
  tokens.set(token, { ...input, actorId: actor.id, expires });
  return {
    url: `/api/vehicle-documents/preview/${token}`,
    expiresAt: new Date(expires),
    mimeType: doc.mimeType,
    fileName: doc.originalName,
  };
}
async function readPrivateVehicleStorage(key: string) {
  if (ENV.selfHostStorageDir && !isAliyunOssPhotoStorageKey(key)) {
    const root = path.resolve(ENV.selfHostStorageDir),
      file = path.resolve(root, key);
    if (!file.startsWith(root + path.sep)) throw Error("INVALID_STORAGE");
    const stat = await fs.stat(file);
    if (stat.size > MAX_BYTES * 2) throw Error("INVALID_SIZE");
    return fs.readFile(file);
  }
  const url = await storageGetSignedUrl(key);
  if (!url.startsWith("https://")) throw Error("INVALID_STORAGE");
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (
    !response.ok ||
    !response.body ||
    Number(response.headers.get("content-length")) > MAX_BYTES * 2
  )
    throw Error("UNAVAILABLE");
  const reader = response.body.getReader(),
    chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES * 2) throw Error("INVALID_SIZE");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks, size);
}
export function registerVehicleDocumentPreview(app: Express) {
  app.get("/api/vehicle-documents/preview/:token", async (req, res) => {
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    try {
      const token = String(req.params.token),
        item = tokens.get(token);
      if (!item || item.expires <= Date.now()) {
        res.status(410).send("预览已过期，请重新打开");
        return;
      }
      const ctx = await createContext({
        req,
        res,
        info: {} as Parameters<typeof createContext>[0]["info"],
      });
      const { actor } = await fleetAccess(ctx, "read", item.projectId);
      if (actor.id !== item.actorId) fail("附件预览未经授权", "FORBIDDEN");
      if (!tokens.delete(token) || item.expires <= Date.now()) {
        res.status(410).send("预览已过期或已使用");
        return;
      }
      const doc = await authorizedVehicleDocument(ctx, item),
        stored = await readPrivateVehicleStorage(doc.fileKey),
        bytes = decodeVehicleDocument(
          decryptSecret(stored.toString("utf8")),
          doc.mimeType as VehicleDocumentInput["mimeType"]
        );
      if (
        bytes.length !== doc.contentBytes ||
        createHash("sha256").update(bytes).digest("hex") !== doc.contentSha256
      )
        throw Error("INTEGRITY_FAILED");
      res
        .set({
          "Content-Type": doc.mimeType,
          "Content-Disposition": "inline",
          "Content-Security-Policy": "sandbox",
        })
        .send(bytes);
    } catch (error) {
      res
        .status(
          error instanceof TRPCError &&
            ["UNAUTHORIZED", "FORBIDDEN"].includes(error.code)
            ? 403
            : 404
        )
        .send("附件不能预览，请重新授权或联系管理员");
    }
  });
}
