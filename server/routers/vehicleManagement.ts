import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  businessDay,
  id,
  mileage,
  mutationBase,
  text,
  timestampInput,
} from "../services/vehicleManagementPolicy";
import {
  assignFleet,
  detailFleet,
  grantFleetAccess,
  listFleet,
  retireFleet,
  saveFleetContract,
} from "../services/vehicleManagementCore";
import { listFleetRecords } from "../services/vehicleManagementRecords";
import {
  inspectFleet,
  previewFleetDocument,
  revokeFleetAccess,
  saveFleetMaintenancePlan,
  saveFleetProfile,
  saveFleetSpecialRecord,
  setFleetState,
  transitionFleetWorkOrder,
  uploadFleetDocument,
  verifyFleetDocument,
} from "../services/vehicleManagementLifecycle";

const short = z.string().trim().max(160).nullable().optional();
const reason = text;
const documentKind = z.enum([
  "vehicle_registration",
  "transport_permit",
  "insurance",
  "inspection",
  "annual_review",
  "other",
]);
const docMime = z.enum(["image/jpeg", "image/png", "application/pdf"]);
const dataString = z.string().trim().max(1000).optional();
const specialData = z
  .object({
    operatorName: dataString,
    approvalNo: dataString,
    validTo: businessDay.optional(),
    loadingSite: dataString,
    unloadingSite: dataString,
    allowedRoute: dataString,
    allowedTimeWindow: dataString,
    sealedDeviceCheck: dataString,
    exitCheck: dataString,
    unloadReceipt: dataString,
    exceptionHandling: dataString,
    applicable: z.boolean().optional(),
    provider: dataString,
    deviceNo: dataString,
    platformName: dataString,
    deviceStatus: z
      .enum(["unknown", "active", "fault", "not_configured"])
      .optional(),
    verifiedAt: timestampInput.optional(),
    verificationNote: dataString,
  })
  .strict();
export const vehicleManagementRouter = router({
  records: protectedProcedure
    .input(
      z.object({
        vehicleIds: z.array(id).max(5000).default([]),
        projectId: id.optional(),
        category: z.enum(["assignments", "maintenance", "compliance"]),
      })
    )
    .query(({ ctx, input }) => listFleetRecords(ctx, input)),
  list: protectedProcedure
    .input(
      z.object({
        projectId: id.optional(),
        search: z.string().trim().max(200).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
        all: z.boolean().default(false),
      })
    )
    .query(({ ctx, input }) => listFleet(ctx, input)),
  detail: protectedProcedure
    .input(z.object({ vehicleId: id, projectId: id.optional() }))
    .query(({ ctx, input }) => detailFleet(ctx, input)),
  saveProfile: protectedProcedure
    .input(
      mutationBase.extend({
        propertyType: z.enum(["company_owned", "rented", "partner"]),
        settlementMode: z.enum([
          "monthly",
          "daily",
          "hourly",
          "shift",
          "trip",
          "ton",
          "volume",
          "none",
        ]),
        purpose: z.enum(["general", "trailer"]).optional(),
        vin: z
          .string()
          .trim()
          .regex(/^[A-HJ-NPR-Z0-9]{17}$/, "VIN须为17位且不含I、O、Q")
          .nullable()
          .optional(),
        brandModel: short,
        registeredOn: businessDay.nullable().optional(),
        energyType: z.string().trim().max(64).nullable().optional(),
        emissionStandard: z.string().trim().max(64).nullable().optional(),
        effectiveCapacityM3: z
          .number()
          .finite()
          .positive()
          .max(9999999)
          .nullable()
          .optional(),
        trailerVehicleId: id.nullable().optional(),
        remarks: z.string().trim().max(1000).nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) => saveFleetProfile(ctx, input)),
  setState: protectedProcedure
    .input(
      mutationBase.extend({
        dispatchStatus: z.enum(["standby", "working", "paused"]),
        reason,
      })
    )
    .mutation(({ ctx, input }) => setFleetState(ctx, input)),
  assign: protectedProcedure
    .input(
      mutationBase.extend({
        action: z.enum(["enter", "transfer", "exit", "handover"]),
        targetProjectId: id.optional(),
        driverPersonId: id.nullable().optional(),
        driverUserId: id.nullable().optional(),
        driverBindingId: id.nullable().optional(),
        occurredAt: timestampInput,
        meterReading: mileage,
        condition: text,
        reason,
      })
    )
    .mutation(({ ctx, input }) => assignFleet(ctx, input)),
  saveContract: protectedProcedure
    .input(
      mutationBase.extend({
        billingType: z.enum(["monthly", "daily", "hourly", "shift"]),
        rate: z.number().finite().positive().max(999999999999.99),
        effectiveFrom: businessDay,
        effectiveTo: businessDay.optional(),
        supersedesContractId: id.optional(),
        reason,
      })
    )
    .mutation(({ ctx, input }) => saveFleetContract(ctx, input)),
  grantAccess: protectedProcedure
    .input(
      mutationBase.extend({
        userId: id.optional(),
        driverBindingId: id.optional(),
        role: z.enum(["owner", "driver"]),
        scope: z.enum(["service_period", "all_history"]),
        effectiveFrom: timestampInput,
        effectiveTo: timestampInput.optional(),
        validTo: timestampInput.optional(),
        reason,
      })
    )
    .mutation(({ ctx, input }) => grantFleetAccess(ctx, input)),
  revokeAccess: protectedProcedure
    .input(mutationBase.extend({ grantId: id, reason }))
    .mutation(({ ctx, input }) => revokeFleetAccess(ctx, input)),
  uploadDocument: protectedProcedure
    .input(
      mutationBase.extend({
        kind: documentKind,
        title: z.string().trim().min(1).max(160),
        applicable: z.boolean(),
        validFrom: businessDay.optional(),
        validTo: businessDay.optional(),
        originalName: z.string().min(1).max(200),
        mimeType: docMime,
        base64: z.string().min(1).max(11184812),
      })
    )
    .mutation(({ ctx, input }) => uploadFleetDocument(ctx, input)),
  verifyDocument: protectedProcedure
    .input(
      mutationBase.extend({
        documentId: id,
        result: z.enum(["verified", "rejected", "not_applicable"]),
        reason,
      })
    )
    .mutation(({ ctx, input }) => verifyFleetDocument(ctx, input)),
  previewDocument: protectedProcedure
    .input(z.object({ vehicleId: id, projectId: id, documentId: id }))
    .mutation(({ ctx, input }) => previewFleetDocument(ctx, input)),
  inspect: protectedProcedure
    .input(
      mutationBase.extend({
        occurredAt: timestampInput,
        driverPersonId: id.optional(),
        meterReading: mileage,
        items: z
          .array(
            z.object({
              key: z.enum(["brakes", "tires", "lights", "leaks", "sealing"]),
              result: z.enum(["pass", "fail", "unknown"]),
              note: z.string().trim().max(1000).optional(),
            })
          )
          .length(5),
        safetyFault: z.boolean(),
        notes: text,
      })
    )
    .mutation(({ ctx, input }) => inspectFleet(ctx, input)),
  transitionWorkOrder: protectedProcedure
    .input(
      mutationBase.extend({
        workOrderId: id,
        action: z.enum([
          "start",
          "submit_acceptance",
          "reject",
          "accept",
          "release",
        ]),
        reason,
        serviceProvider: z.string().trim().max(160).optional(),
        laborHours: z.number().finite().min(0).max(99999999).optional(),
        partsDescription: z.string().trim().max(1000).optional(),
        costBearer: z.enum(["company", "owner", "shared"]).optional(),
        maintenanceRecordId: id.optional(),
        purchaseOrderIds: z.array(id).max(100).optional(),
      })
    )
    .mutation(({ ctx, input }) => transitionFleetWorkOrder(ctx, input)),
  saveMaintenancePlan: protectedProcedure
    .input(
      mutationBase.extend({
        id: id.optional(),
        title: z.string().trim().min(1).max(160),
        dueOn: businessDay.nullable().optional(),
        dueMileage: mileage,
        lastMileage: mileage,
        source: text,
        completedAt: timestampInput.nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) => saveFleetMaintenancePlan(ctx, input)),
  saveSpecialRecord: protectedProcedure
    .input(
      mutationBase.extend({
        kind: z.enum(["earthwork", "monitoring"]),
        recordedAt: timestampInput,
        data: specialData,
        reason,
      })
    )
    .mutation(({ ctx, input }) => saveFleetSpecialRecord(ctx, input)),
  retire: protectedProcedure
    .input(mutationBase.extend({ reason }))
    .mutation(({ ctx, input }) => retireFleet(ctx, input)),
  remove: protectedProcedure
    .input(mutationBase.extend({ reason }))
    .mutation(({ ctx, input }) => retireFleet(ctx, input, true)),
});
