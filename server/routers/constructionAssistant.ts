import { and, desc, eq, gte, like, notInArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import {
  auditLogs,
  constructionAssistantDailyUsage,
  constructionInputMemory,
  users,
} from "../../drizzle/schema";
import {
  CONSTRUCTION_ASSISTANT_FIELDS,
  CONSTRUCTION_ASSISTANT_MODES,
} from "../../shared/constructionAssistant";
import { assertConstructionAccess } from "../services/constructionAssistantAccess";
import { protectedProcedure, router } from "../_core/trpc";
import { getSuperAdminAccess, assertProjectInCurrentScope } from "../access";
import { getPublishedExternalAiConfiguration } from "../services/externalAiApi";
import {
  assistText,
  assistantVoiceReadiness,
  builtinVoiceAvailable,
  auditAssistantEvent,
  businessDateChina,
  consumeDailyQuota,
  readAssistantConfiguration,
  requireAssistantDb,
  requireExternalAiConfiguration,
  saveAssistantConfiguration,
  transcribeAudio,
  validateText,
} from "../services/constructionAssistant";

const field = z.enum(CONSTRUCTION_ASSISTANT_FIELDS);
const project = z.object({ projectId: z.number().int().positive() });
const recentCutoff = () => new Date(Date.now() - 90 * 24 * 3600_000);
const escapeLike = (value: string) =>
  value.replace(/[\\%_]/g, char => `\\${char}`);

export const constructionAssistantRouter = router({
  status: protectedProcedure.input(project).query(async ({ ctx, input }) => {
    await assertConstructionAccess(ctx, "read");
    await assertProjectInCurrentScope(ctx, input.projectId);
    const c = await readAssistantConfiguration();
    const external = await getPublishedExternalAiConfiguration();
    const db = await requireAssistantDb();
    const rows = await db
      .select({
        channel: constructionAssistantDailyUsage.channel,
        attemptCount: constructionAssistantDailyUsage.attemptCount,
      })
      .from(constructionAssistantDailyUsage)
      .where(
        and(
          eq(constructionAssistantDailyUsage.userId, ctx.user!.id),
          eq(constructionAssistantDailyUsage.usageDate, businessDateChina())
        )
      );
    const aiReady = Boolean(
      c.aiEnabled &&
        external?.enabled &&
        external.baseUrl &&
        external.model &&
        external.apiKey
    );
    return {
      aiReady,
      cloudVoiceReady: assistantVoiceReadiness(c).cloudVoiceReady,
      aiDailyLimit: c.aiDailyLimit,
      aiUsed: Number(rows.find(row => row.channel === "ai")?.attemptCount ?? 0),
      voiceDailyLimit: c.voiceDailyLimit,
      voiceUsed: Number(
        rows.find(row => row.channel === "voice")?.attemptCount ?? 0
      ),
      message: `${aiReady ? "施工助手可用；AI建议需本人确认后应用" : "请超级管理员在系统设置配置AI接口"}${assistantVoiceReadiness(c).usesBuiltinVoice ? "；内置云转写已就绪，须同意后开始录音（每日限额）" : ""}`,
      historyEnabled: c.historyEnabled,
    };
  }),
  history: protectedProcedure
    .input(project.extend({ field, keyword: z.string().max(100).optional() }))
    .query(async ({ ctx, input }) => {
      await assertConstructionAccess(ctx, "read");
      await assertProjectInCurrentScope(ctx, input.projectId);
      const c = await readAssistantConfiguration();
      if (!c.historyEnabled) return { items: [] };
      const db = await requireAssistantDb();
      const rows = await db
        .select({
          id: constructionInputMemory.id,
          content: constructionInputMemory.content,
          usedAt: constructionInputMemory.usedAt,
        })
        .from(constructionInputMemory)
        .where(
          and(
            eq(constructionInputMemory.userId, ctx.user!.id),
            eq(constructionInputMemory.projectId, input.projectId),
            eq(constructionInputMemory.field, input.field),
            gte(constructionInputMemory.usedAt, recentCutoff()),
            ...(input.keyword
              ? [
                  like(
                    constructionInputMemory.content,
                    `%${escapeLike(input.keyword)}%`
                  ),
                ]
              : [])
          )
        )
        .orderBy(
          desc(constructionInputMemory.usedAt),
          desc(constructionInputMemory.id)
        )
        .limit(30);
      return { items: rows };
    }),
  remember: protectedProcedure
    .input(
      project.extend({
        entries: z.array(z.object({ field, content: z.string() })).max(5),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertConstructionAccess(ctx, "write");
      await assertProjectInCurrentScope(ctx, input.projectId);
      const seen = new Set<string>();
      // 全量预校验在事务/任何写入前完成；不允许同 field 重复，空白字段忽略。
      for (const entry of input.entries) {
        if (seen.has(entry.field))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "同一字段不能重复保存",
          });
        seen.add(entry.field);
        if (entry.content.trim()) validateText(entry.field, entry.content);
      }
      const entries = input.entries
        .filter(entry => entry.content.trim())
        .map(entry => ({ ...entry, content: entry.content.trim() }));
      const c = await readAssistantConfiguration();
      if (!c.historyEnabled || !entries.length) return { success: true };
      const db = await requireAssistantDb();
      await db.transaction(async tx => {
        // 锁本人用户行串行化同用户记忆写入（含首次写），不修改任何原日报或用户数据。
        const owner = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, ctx.user!.id))
          .for("update");
        if (!owner.length)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "当前用户状态不可用",
          });
        const now = new Date();
        for (const entry of entries) {
          await tx
            .insert(constructionInputMemory)
            .values({
              userId: ctx.user!.id,
              projectId: input.projectId,
              field: entry.field,
              content: entry.content,
              contentHash: createHash("sha256")
                .update(entry.content)
                .digest("hex"),
              usedAt: now,
            })
            .onDuplicateKeyUpdate({ set: { usedAt: now } });
          const latest = await tx
            .select({ id: constructionInputMemory.id })
            .from(constructionInputMemory)
            .where(
              and(
                eq(constructionInputMemory.userId, ctx.user!.id),
                eq(constructionInputMemory.projectId, input.projectId),
                eq(constructionInputMemory.field, entry.field),
                gte(constructionInputMemory.usedAt, recentCutoff())
              )
            )
            .orderBy(
              desc(constructionInputMemory.usedAt),
              desc(constructionInputMemory.id)
            )
            .limit(30)
            .for("update");
          await tx.delete(constructionInputMemory).where(
            and(
              eq(constructionInputMemory.userId, ctx.user!.id),
              eq(constructionInputMemory.projectId, input.projectId),
              eq(constructionInputMemory.field, entry.field),
              ...(latest.length
                ? [
                    notInArray(
                      constructionInputMemory.id,
                      latest.map(row => row.id)
                    ),
                  ]
                : [])
            )
          );
        }
        await tx.insert(auditLogs).values({
          userId: ctx.user!.id,
          module: "construction_assistant",
          action: "remember_input_success",
          targetType: "construction_input_memory",
          targetId: String(input.projectId),
          summary: `记忆保存成功; user=${ctx.user!.id}; project=${input.projectId}; entries=${entries.length}; length=${entries.reduce((n, entry) => n + entry.content.length, 0)}（不记录正文）`,
        });
      });
      return { success: true };
    }),
  forget: protectedProcedure
    .input(project.extend({ id: z.number().int().positive().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertConstructionAccess(ctx, "write");
      await assertProjectInCurrentScope(ctx, input.projectId);
      const db = await requireAssistantDb();
      await db.transaction(async tx => {
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, ctx.user!.id))
          .for("update");
        await tx
          .delete(constructionInputMemory)
          .where(
            and(
              eq(constructionInputMemory.userId, ctx.user!.id),
              eq(constructionInputMemory.projectId, input.projectId),
              ...(input.id ? [eq(constructionInputMemory.id, input.id)] : [])
            )
          );
        await tx.insert(auditLogs).values({
          userId: ctx.user!.id,
          module: "construction_assistant",
          action: "forget_input_success",
          targetType: "construction_input_memory",
          targetId: String(input.projectId),
          summary: `记忆删除请求成功; user=${ctx.user!.id}; project=${input.projectId}; requestedIds=${input.id ?? "all-own-project"}（不记录正文或他人记录是否存在）`,
        });
      });
      return { success: true };
    }),
  assist: protectedProcedure
    .input(
      project.extend({
        field,
        content: z.string(),
        mode: z.enum(CONSTRUCTION_ASSISTANT_MODES),
        instruction: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertConstructionAccess(ctx, "write");
      await assertProjectInCurrentScope(ctx, input.projectId);
      validateText(input.field, input.content);
      try {
        const c = await readAssistantConfiguration();
        if (!c.aiEnabled)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "请超级管理员在系统设置配置AI接口",
          });
        const configuration = await requireExternalAiConfiguration(); // 先完整检查已发布外部配置，再扣额。
        await consumeDailyQuota(ctx.user!.id, "ai", c.aiDailyLimit);
        const result = await assistText(
          input.field,
          input.content,
          input.mode,
          input.instruction,
          configuration
        );
        await auditAssistantEvent(
          ctx.user!.id,
          input.projectId,
          "assist",
          "success",
          input.content.length,
          result.text.length
        );
        return result;
      } catch (error) {
        await auditAssistantEvent(
          ctx.user!.id,
          input.projectId,
          "assist",
          "failure",
          input.content.length
        );
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message:
            "AI整理服务暂不可用，未生成替代内容；请核实原文（本次尝试已计入额度）",
        });
      }
    }),
  transcribe: protectedProcedure
    .input(
      project.extend({
        audioBase64: z.string(),
        mimeType: z.enum([
          "audio/webm",
          "audio/ogg",
          "audio/wav",
          "audio/mp4",
          "audio/mpeg",
        ]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertConstructionAccess(ctx, "write");
      await assertProjectInCurrentScope(ctx, input.projectId);
      try {
        const text = await transcribeAudio(
          ctx.user!.id,
          input.audioBase64,
          input.mimeType
        );
        await auditAssistantEvent(
          ctx.user!.id,
          input.projectId,
          "transcribe",
          "success",
          input.audioBase64.length,
          text.length
        );
        return { text };
      } catch (error) {
        await auditAssistantEvent(
          ctx.user!.id,
          input.projectId,
          "transcribe",
          "failure",
          input.audioBase64.length
        );
        throw error;
      }
    }),
  configuration: protectedProcedure.query(async ({ ctx }) => {
    const { canAccess } = await getSuperAdminAccess(ctx);
    if (!canAccess)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "仅超级管理员可查看施工助手配置",
      });
    return {
      ...(await readAssistantConfiguration()),
      builtinVoiceAvailable: builtinVoiceAvailable(),
    };
  }),
  saveConfiguration: protectedProcedure
    .input(
      z.object({
        aiEnabled: z.boolean(),
        aiDailyLimit: z.number().int().min(1).max(100),
        cloudVoiceEnabled: z.boolean(),
        voiceDailyLimit: z.number().int().min(1).max(100),
        speechEndpoint: z.string().max(500),
        speechModel: z.string().max(128),
        speechApiKey: z.string().max(500).optional(),
        historyEnabled: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { canAccess, user } = await getSuperAdminAccess(ctx);
      if (!canAccess)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "仅超级管理员可配置施工助手",
        });
      await saveAssistantConfiguration(user.id, input);
      return { success: true };
    }),
});
