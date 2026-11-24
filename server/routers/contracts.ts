import { lockBusinessEvidenceBindings } from "../services/evidenceBinding";
import {
  lockEvidenceProject,
  assertEvidenceConditionalWrite,
} from "../services/evidenceIntegrity";
import {
  newBusinessDocumentNumber,
  runBusinessDocumentCreation,
  afterBusinessDocumentCommit,
  businessDocumentCreationDatabase,
} from "../services/businessDocumentCreation";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import {
  auditLogs,
  evidenceRecords,
  outsourceContracts,
} from "../../drizzle/schema";
import { getBusinessStatusLabel } from "../../shared/domain";
import {
  assertDepartmentBusinessAccess,
  assertProjectInCurrentScope,
  getRoleOperationPermissionDecision,
  getSuperAdminAccess,
  requireAuthenticatedUser,
  type BusinessOperationAction,
} from "../access";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { notifyOfficialAccountBusinessEventSafely as notifyOfficialAccountBusinessEventSafelyImmediate } from "../services/businessNotifier";
import { appendIntegrityProtectedAudit } from "../services/auditIntegrity";
import { storageGetSignedUrl, storagePut } from "../storage";
import fs from "node:fs/promises";
import path from "node:path";
import { ENV } from "../_core/env";
import { encryptSecret, decryptSecret } from "../services/secretVault";
import { isAliyunOssPhotoStorageKey } from "../services/aliyunOssPhotoStorage";

const contractType = z.enum([
  "transport",
  "labor_subcontract",
  "machinery_lease",
  "material_supply",
  "other",
]);
const pricingMethod = z.enum([
  "lump_sum",
  "unit_price",
  "trip",
  "ton",
  "m3",
  "day",
  "month",
  "other",
]);
const contractStatus = z.enum([
  "draft",
  "active",
  "suspended",
  "expired",
  "closed",
  "void",
]);
const money = z.number().finite().min(0).max(999999999999.99);

async function assertContractAccess(
  ctx: Parameters<typeof requireAuthenticatedUser>[0],
  action: BusinessOperationAction = "read"
) {
  return assertDepartmentBusinessAccess(ctx, "CONTRACT", action);
}

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const attachmentSource = (id?: number) =>
  `contract_attachment_upload:${id ?? "pending"}`;
const attachmentScopeInput = z.object({
  projectId: z.number().int().positive(),
  id: z.number().int().positive().optional(),
});
const attachmentUploadInput = attachmentScopeInput.extend({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(["image/jpeg", "image/png"]),
  base64Data: z
    .string()
    .min(4)
    .max(Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 64),
});

function decodeContractAttachment(
  value: string,
  mimeType: "image/jpeg" | "image/png"
) {
  const raw = value.startsWith("data:")
    ? value.replace(new RegExp(`^data:${mimeType};base64,`), "")
    : value;
  if (raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw))
    throw new TRPCError({ code: "BAD_REQUEST", message: "合同照片编码无效" });
  const bytes = Buffer.from(raw, "base64");
  if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "合同照片单张不得超过 8MB",
    });
  const jpeg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  const png =
    bytes.length >= 8 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/jpeg" ? !jpeg : !png)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "合同照片必须为真实 JPG/PNG，文件内容与格式须一致",
    });
  return bytes;
}

/** 与 mounted contract.save 的原编辑守卫一致；锁等待后不能沿用原超级管理员/详细权限。 */
async function assertContractWriteAccess(
  ctx: Parameters<typeof requireAuthenticatedUser>[0],
  id?: number,
  uploading = false
) {
  requireAuthenticatedUser(ctx);
  await assertContractAccess(ctx, id ? "edit" : "create");
  if (uploading) {
    const originalUploadPermission = await getRoleOperationPermissionDecision(
      ctx,
      "CONTRACT",
      "submit"
    );
    if (
      originalUploadPermission.hasDetailedPermissions &&
      !originalUploadPermission.allowed
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "合同上传的原操作权限已撤回",
      });
  }
  if (id && !(await getSuperAdminAccess(ctx)).canAccess) {
    const permission = await getRoleOperationPermissionDecision(
      ctx,
      "CONTRACT",
      "edit"
    );
    if (!permission.hasDetailedPermissions || !permission.allowed)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "修改既有合同附件须具备原合同变更权限",
      });
  }
}

async function lockActiveContractProject(
  tx: Parameters<typeof lockEvidenceProject>[0],
  projectId: number
) {
  const project = await lockEvidenceProject(tx, projectId);
  if (project.status !== "active")
    throw new TRPCError({
      code: "CONFLICT",
      message: "仅启用项目可维护合同及附件",
    });
}

function assertEditableContract(
  parent: typeof outsourceContracts.$inferSelect | undefined,
  projectId: number
) {
  if (!parent || parent.projectId !== projectId)
    throw new TRPCError({ code: "NOT_FOUND", message: "未找到当前项目合同" });
  if (!["draft", "suspended"].includes(parent.status))
    throw new TRPCError({
      code: "CONFLICT",
      message: "仅草稿或已暂停合同可修改内容",
    });
}

/** 新指针只授权本入口真实归档产物，不把旧 other、空来源或猜测 marker 当作上传契约。 */
function assertUploadedContractAttachment(
  row: typeof evidenceRecords.$inferSelect | undefined,
  projectId: number,
  actorId: number,
  id?: number
) {
  let metadata: any;
  try {
    metadata = JSON.parse(row?.watermarkJson ?? "null");
  } catch {
    /* 拒绝损坏或外部来源元数据。 */
  }
  if (
    !row ||
    row.status !== "active" ||
    row.projectId !== projectId ||
    row.sourceType !== "contract" ||
    row.sourceId !== attachmentSource(id) ||
    row.uploadedBy !== actorId ||
    !row.fileKey.startsWith(`contract-attachments/${projectId}/`) ||
    !/^[a-f0-9]{64}$/.test(row.contentSha256 ?? "") ||
    !row.contentBytes ||
    row.contentBytes > MAX_ATTACHMENT_BYTES ||
    !["image/jpeg", "image/png"].includes(row.mimeType ?? "") ||
    metadata?.captureMode !== "contract_attachment_upload" ||
    metadata?.version !== 1 ||
    metadata?.contractId !== (id ?? null) ||
    metadata?.boundContractId !== null
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "只能使用本人经合同专用入口归档的本项目、本合同附件，不能借用通用影像或其他私有附件",
    });
  }
}

/** 只读真实存储；公开代理只能获得密文。新附件绝不返回签名原件URL。 */
async function readContractAttachment(
  row: typeof evidenceRecords.$inferSelect
) {
  const encrypted = row.fileKey.startsWith("contract-attachments/");
  const limit = encrypted
    ? Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 * 2 + 512
    : MAX_ATTACHMENT_BYTES;
  let stored: Buffer;
  if (ENV.selfHostStorageDir && !isAliyunOssPhotoStorageKey(row.fileKey)) {
    const root = path.resolve(ENV.selfHostStorageDir),
      filePath = path.resolve(root, row.fileKey);
    if (!filePath.startsWith(root + path.sep))
      throw new TRPCError({ code: "BAD_REQUEST", message: "附件对象路径无效" });
    if ((await fs.stat(filePath)).size > limit)
      throw new TRPCError({ code: "BAD_REQUEST", message: "附件对象超限" });
    stored = await fs.readFile(filePath);
  } else {
    const signedUrl = await storageGetSignedUrl(row.fileKey);
    if (!/^https:\/\//.test(signedUrl))
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "附件存储读取地址无效",
      });
    const response = await fetch(signedUrl, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok || !response.body)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "合同附件存储读取失败",
      });
    if (Number(response.headers.get("content-length")) > limit) {
      await response.body.cancel();
      throw new TRPCError({ code: "BAD_REQUEST", message: "附件对象超限" });
    }
    const reader = response.body.getReader(),
      chunks: Buffer[] = [];
    let size = 0;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.length;
        if (size > limit)
          throw new TRPCError({ code: "BAD_REQUEST", message: "附件对象超限" });
        chunks.push(Buffer.from(result.value));
      }
    } finally {
      await reader.cancel();
    }
    stored = Buffer.concat(chunks, size);
  }
  const bytes = decodeContractAttachment(
    encrypted
      ? decryptSecret(stored.toString("utf8"))
      : stored.toString("base64"),
    row.mimeType as "image/jpeg" | "image/png"
  );
  if (
    (row.contentBytes && row.contentBytes !== bytes.length) ||
    (row.contentSha256 &&
      createHash("sha256").update(bytes).digest("hex") !== row.contentSha256)
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "合同附件完整性校验失败，请联系资料管理员",
    });
  return `data:${row.mimeType};base64,${bytes.toString("base64")}`;
}

const contractInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.number().int().positive(),
  contractType,
  counterpartyName: z.string().trim().min(2, "请填写合同相对方").max(200),
  counterpartyContact: z.string().trim().max(100).optional().nullable(),
  pricingMethod,
  unit: z.string().trim().max(32).optional().nullable(),
  unitPrice: money.optional().nullable(),
  contractAmount: money,
  startDate: z.string().date().optional().nullable(),
  endDate: z.string().date().optional().nullable(),
  attachmentEvidenceId: z.number().int().positive().optional().nullable(),
  contractSummary: z.string().trim().max(1000).optional().nullable(),
  remarks: z.string().trim().max(500).optional().nullable(),
});

export const contractRouter = router({
  capabilities: protectedProcedure.query(async ({ ctx }) => {
    await assertContractAccess(ctx, "read");
    const [create, edit, review, close] = await Promise.all([
      getRoleOperationPermissionDecision(ctx, "CONTRACT", "create"),
      getRoleOperationPermissionDecision(ctx, "CONTRACT", "edit"),
      getRoleOperationPermissionDecision(ctx, "CONTRACT", "review"),
      getRoleOperationPermissionDecision(ctx, "CONTRACT", "void"),
    ]);
    return {
      canMaintain: create.allowed || edit.allowed || review.allowed,
      canClose: close.allowed,
    };
  }),

  list: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        status: contractStatus.optional(),
        contractType: contractType.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertContractAccess(ctx, "read");
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db) return [];
      const predicates = [eq(outsourceContracts.projectId, input.projectId)];
      if (input.status)
        predicates.push(eq(outsourceContracts.status, input.status));
      if (input.contractType)
        predicates.push(
          eq(outsourceContracts.contractType, input.contractType)
        );
      return db
        .select()
        .from(outsourceContracts)
        .where(and(...predicates))
        .orderBy(desc(outsourceContracts.updatedAt));
    }),

  uploadAttachment: protectedProcedure
    .input(attachmentUploadInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      await assertContractWriteAccess(ctx, input.id, true);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const bytes = decodeContractAttachment(input.base64Data, input.mimeType);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      return db.transaction(async tx => {
        await lockActiveContractProject(tx, input.projectId);
        await assertContractWriteAccess(ctx, input.id, true);
        await assertProjectInCurrentScope(ctx, input.projectId);
        if (input.id) {
          const [parent] = await tx
            .select()
            .from(outsourceContracts)
            .where(eq(outsourceContracts.id, input.id))
            .limit(1)
            .for("update");
          assertEditableContract(parent, input.projectId);
        }
        const uploadedAt = new Date();
        const safeName = input.fileName
          .replace(/[^a-zA-Z0-9._-]/g, "_")
          .slice(-120);
        const stored = await storagePut(
          `contract-attachments/${input.projectId}/${user.id}-${randomUUID()}-${safeName}.encrypted`,
          encryptSecret(bytes.toString("base64")),
          "application/octet-stream"
        );
        // 对象上传期间角色也可能撤回；不能在事务提交前沿用授权快照。
        await assertContractWriteAccess(ctx, input.id, true);
        await assertProjectInCurrentScope(ctx, input.projectId);
        const [result] = await tx.insert(evidenceRecords).values({
          projectId: input.projectId,
          sourceType: "contract",
          sourceId: attachmentSource(input.id),
          fileKey: stored.key,
          fileName: input.fileName,
          mimeType: input.mimeType,
          contentSha256: createHash("sha256").update(bytes).digest("hex"),
          contentBytes: bytes.length,
          watermarkJson: JSON.stringify({
            captureMode: "contract_attachment_upload",
            attachmentKind: "contract_original",
            contractId: input.id ?? null,
            boundContractId: null,
            uploadedAt: uploadedAt.toISOString(),
            version: 1,
          }),
          capturedAt: uploadedAt,
          status: "active",
          uploadedBy: user.id,
        });
        const evidenceId = Number(
          (result as { insertId?: number })?.insertId ?? 0
        );
        if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "合同附件归档失败",
          });
        await appendIntegrityProtectedAudit(tx, {
          userId: user.id,
          module: "contract",
          action: "upload_contract_attachment",
          targetType: "evidence",
          targetId: String(evidenceId),
          summary: `归档合同附件：${input.fileName}`,
          afterJson: JSON.stringify({
            projectId: input.projectId,
            contractId: input.id ?? null,
            evidenceId,
            fileKey: stored.key,
            contentBytes: bytes.length,
            contentSha256: createHash("sha256").update(bytes).digest("hex"),
          }),
        });
        return {
          success: true,
          evidenceId,
          fileName: input.fileName,
          mimeType: input.mimeType,
        };
      });
    }),

  /** 不提供下载/OCR/删除；已绑定附件以锁后真实父合同授权，未分配产物仅本人可预览。 */
  previewAttachment: protectedProcedure
    .input(
      attachmentScopeInput.extend({ evidenceId: z.number().int().positive() })
    )
    .query(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      await assertContractAccess(ctx, "read");
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      return db.transaction(async tx => {
        await lockActiveContractProject(tx, input.projectId);
        const binding = await lockBusinessEvidenceBindings(tx, {
          projectId: input.projectId,
          bindings: [
            {
              field: "attachmentEvidenceId",
              id: input.evidenceId,
              allowedSourceTypes: ["other", "contract"],
            },
          ],
          parent: input.id
            ? { table: outsourceContracts, id: input.id }
            : undefined,
          actorId: user.id,
          module: "contract",
          targetType: "outsource_contract",
          targetId: String(input.id ?? "pending"),
        });
        await assertContractAccess(ctx, "read");
        await assertProjectInCurrentScope(ctx, input.projectId);
        const row = binding.rows.find(row => row.id === input.evidenceId)!;
        if (
          !input.id ||
          binding.parent?.attachmentEvidenceId !== input.evidenceId
        ) {
          await assertContractWriteAccess(ctx, input.id);
          if (input.id) assertEditableContract(binding.parent, input.projectId);
          assertUploadedContractAttachment(
            row,
            input.projectId,
            user.id,
            input.id
          );
        }
        if (!["image/jpeg", "image/png"].includes(row.mimeType ?? ""))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "该历史附件不是可站内查看的合同照片",
          });
        const url = await readContractAttachment(row);
        await assertContractAccess(ctx, "read");
        await assertProjectInCurrentScope(ctx, input.projectId);
        await appendIntegrityProtectedAudit(tx, {
          userId: user.id,
          module: "contract",
          action: "preview_contract_attachment",
          targetType: "evidence",
          targetId: String(row.id),
          summary: "站内受控查看合同影像",
          afterJson: JSON.stringify({
            projectId: input.projectId,
            contractId: input.id ?? null,
            evidenceId: row.id,
          }),
        });
        return {
          evidenceId: row.id,
          fileName: row.fileName,
          mimeType: row.mimeType,
          url,
        };
      });
    }),

  save: protectedProcedure
    .input(
      z.intersection(
        contractInput,
        z.object({
          documentRequestKey: z.string().trim().min(1).max(128).optional(),
        })
      )
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      await assertContractWriteAccess(ctx, input.id);
      await assertProjectInCurrentScope(ctx, input.projectId);
      if (input.startDate && input.endDate && input.endDate < input.startDate)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "合同结束日期不得早于开始日期",
        });
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });

      return runBusinessDocumentCreation(
        db,
        {
          actorId: user.id,
          scope: "contract:save",
          projectId: input.projectId,
          input,
          revalidate: async () => {
            await lockActiveContractProject(
              businessDocumentCreationDatabase()!,
              input.projectId
            );
            await assertContractWriteAccess(ctx, input.id);
            await assertProjectInCurrentScope(ctx, input.projectId);
          },
        },
        async db => {
          await lockActiveContractProject(db, input.projectId);
          const binding = await lockBusinessEvidenceBindings(db, {
            projectId: input.projectId,
            bindings: [
              {
                field: "attachmentEvidenceId",
                id: input.attachmentEvidenceId,
                allowedSourceTypes: ["other", "contract"],
              },
            ],
            parent: input.id
              ? { table: outsourceContracts, id: input.id }
              : undefined,
            actorId: user.id,
            module: "contract",
            targetType: "outsource_contract",
            targetId: String(input.id ?? "new"),
          });
          await assertContractWriteAccess(ctx, input.id);
          await assertProjectInCurrentScope(ctx, input.projectId);
          if (
            input.attachmentEvidenceId &&
            binding.parent?.attachmentEvidenceId !== input.attachmentEvidenceId
          ) {
            assertUploadedContractAttachment(
              binding.rows.find(row => row.id === input.attachmentEvidenceId),
              input.projectId,
              user.id,
              input.id
            );
          }
          const attachmentEvidenceId =
            input.attachmentEvidenceId === undefined
              ? (binding.parent?.attachmentEvidenceId ?? null)
              : input.attachmentEvidenceId;
          const values = {
            projectId: input.projectId,
            contractType: input.contractType,
            counterpartyName: input.counterpartyName,
            counterpartyContact: input.counterpartyContact?.trim() || null,
            pricingMethod: input.pricingMethod,
            unit: input.unit?.trim() || null,
            unitPrice:
              input.unitPrice === undefined || input.unitPrice === null
                ? null
                : String(input.unitPrice.toFixed(2)),
            contractAmount: String(input.contractAmount.toFixed(2)),
            startDate: input.startDate
              ? new Date(`${input.startDate}T00:00:00.000Z`)
              : null,
            endDate: input.endDate
              ? new Date(`${input.endDate}T00:00:00.000Z`)
              : null,
            attachmentEvidenceId,
            contractSummary: input.contractSummary?.trim() || null,
            remarks: input.remarks?.trim() || null,
          };
          let contractId = input.id;
          if (input.id) {
            const [existing] = await db
              .select()
              .from(outsourceContracts)
              .where(eq(outsourceContracts.id, input.id))
              .limit(1)
              .for("update");
            if (!existing || existing.projectId !== input.projectId)
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "未找到当前项目合同",
              });
            if (existing.status !== "draft" && existing.status !== "suspended")
              throw new TRPCError({
                code: "CONFLICT",
                message: "仅草稿或已暂停合同可修改内容",
              });
            assertEvidenceConditionalWrite(
              await db
                .update(outsourceContracts)
                .set(values)
                .where(
                  and(
                    eq(outsourceContracts.id, input.id),
                    eq(outsourceContracts.projectId, input.projectId),
                    eq(outsourceContracts.status, existing.status)
                  )
                )
            );
          } else {
            const contractNo = await newBusinessDocumentNumber(
              db,
              "CT",
              { kind: "user", userId: user.id },
              input.projectId,
              input
            );
            await db.insert(outsourceContracts).values({
              ...values,
              contractNo,
              status: "draft",
              createdBy: user.id,
            });
            const [created] = await db
              .select({ id: outsourceContracts.id })
              .from(outsourceContracts)
              .where(eq(outsourceContracts.contractNo, contractNo))
              .limit(1);
            contractId = created?.id;
          }
          if (!contractId)
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "合同保存后未找到记录",
            });
          if (
            input.attachmentEvidenceId &&
            binding.parent?.attachmentEvidenceId !== input.attachmentEvidenceId
          ) {
            // 专用新产物仅消费一次；旧不同ID不能重借，同事务记真实父ID，不复活旧证据。
            const row = binding.rows.find(
              row => row.id === input.attachmentEvidenceId
            )!;
            const metadata = JSON.parse(row.watermarkJson!);
            assertEvidenceConditionalWrite(
              await db
                .update(evidenceRecords)
                .set({
                  sourceId: attachmentSource(contractId),
                  watermarkJson: JSON.stringify({
                    ...metadata,
                    contractId,
                    boundContractId: contractId,
                  }),
                })
                .where(
                  and(
                    eq(evidenceRecords.id, row.id),
                    eq(evidenceRecords.projectId, input.projectId),
                    eq(evidenceRecords.status, "active"),
                    eq(evidenceRecords.sourceType, "contract"),
                    eq(evidenceRecords.sourceId, attachmentSource(input.id)),
                    eq(evidenceRecords.uploadedBy, user.id)
                  )
                )
            );
          }
          await binding.retain(String(contractId));
          await db.insert(auditLogs).values({
            userId: user.id,
            module: "contract",
            action: input.id
              ? "update_outsource_contract"
              : "create_outsource_contract",
            targetType: "outsource_contract",
            targetId: String(contractId),
            summary: `${input.id ? "维护" : "新建"}外包合同：${input.counterpartyName}，金额 ¥${input.contractAmount.toFixed(2)}`,
          });
          void notifyOfficialAccountBusinessEventSafely({
            userId: user.id,
            projectId: input.projectId,
            module: "contract",
            eventCode: input.id
              ? "outsource_contract_updated"
              : "outsource_contract_created",
            targetType: "outsource_contract",
            targetId: String(contractId),
            title: input.id ? "外包合同草案已更新" : "外包合同草案已建立",
            content:
              "一份外包合同已登记或更新，请进入系统查看受控合同台账与签署前审阅提示。",
            deepLink: "/admin/contracts",
          }).catch(() => undefined);
          return { success: true, contractId };
        }
      );
    }),

  transition: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        projectId: z.number().int().positive(),
        targetStatus: contractStatus,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireAuthenticatedUser(ctx);
      const transitionAction: BusinessOperationAction = [
        "closed",
        "void",
      ].includes(input.targetStatus)
        ? "void"
        : input.targetStatus === "active"
          ? "review"
          : "edit";
      await assertContractAccess(ctx, transitionAction);
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接暂不可用",
        });
      return runBusinessDocumentCreation(
        db,
        {
          actorId: user.id,
          scope: "contract:transition",
          projectId: input.projectId,
          input,
          revalidate: async () => {
            await assertContractAccess(ctx, transitionAction);
            await assertProjectInCurrentScope(ctx, input.projectId);
          },
        },
        async db => {
          await lockEvidenceProject(db, input.projectId);
          const [existing] = await db
            .select()
            .from(outsourceContracts)
            .where(eq(outsourceContracts.id, input.id))
            .limit(1)
            .for("update");
          if (!existing || existing.projectId !== input.projectId)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "未找到当前项目合同",
            });
          const targets: Record<string, string[]> = {
            draft: ["active", "void"],
            active: ["suspended", "expired", "closed"],
            suspended: ["active", "closed", "void"],
          };
          if (!targets[existing.status]?.includes(input.targetStatus))
            throw new TRPCError({
              code: "CONFLICT",
              message: "当前合同状态不允许该操作",
            });
          assertEvidenceConditionalWrite(
            await db
              .update(outsourceContracts)
              .set({ status: input.targetStatus })
              .where(
                and(
                  eq(outsourceContracts.id, input.id),
                  eq(outsourceContracts.status, existing.status)
                )
              )
          );
          await db.insert(auditLogs).values({
            userId: user.id,
            module: "contract",
            action: "transition_outsource_contract",
            targetType: "outsource_contract",
            targetId: String(input.id),
            summary: `外包合同状态变更为：${getBusinessStatusLabel(input.targetStatus)}`,
          });
          void notifyOfficialAccountBusinessEventSafely({
            userId: user.id,
            projectId: input.projectId,
            module: "contract",
            eventCode: `outsource_contract_${input.targetStatus}`,
            targetType: "outsource_contract",
            targetId: String(input.id),
            title: `外包合同状态已更新`,
            content:
              "一份外包合同的办理状态已更新，请进入系统查看受控合同台账。",
            deepLink: "/admin/contracts",
          }).catch(() => undefined);
          return { success: true };
        }
      );
    }),
});

const notifyOfficialAccountBusinessEventSafely = afterBusinessDocumentCommit(
  notifyOfficialAccountBusinessEventSafelyImmediate
);
