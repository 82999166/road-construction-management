import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { TrpcContext } from "./context";

vi.mock("../access", () => ({
  getSuperAdminAccess: vi.fn(),
}));

import { getSuperAdminAccess } from "../access";
import { protectedProcedure, router } from "./trpc";

const ordinaryUser = {
  id: 901,
  openId: "test-payroll-guard-user",
  email: null,
  name: "测试普通人员",
  loginMethod: "manus" as const,
  role: "user" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

function createContext(): TrpcContext {
  return { user: ordinaryUser, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

const testRouter = router({
  labor: router({
    payroll: router({
      submit: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(() => ({ operation: "submit" })),
      approve: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(() => ({ operation: "approve" })),
      pay: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(() => ({ operation: "pay" })),
      void: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(() => ({ operation: "void" })),
      save: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(() => ({ operation: "save" })),
    }),
    attendance: router({
      approve: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(() => ({ operation: "attendance_approve" })),
    }),
  }),
});

describe("工资条角色专属高影响操作守卫", () => {
  it("仅将已在劳务路由中复核角色、项目范围和状态机的工资操作交给其专属校验", async () => {
    vi.mocked(getSuperAdminAccess).mockResolvedValue({ user: ordinaryUser, canAccess: false });
    const caller = testRouter.createCaller(createContext());

    await expect(caller.labor.payroll.submit({ id: 1 })).resolves.toEqual({ operation: "submit" });
    await expect(caller.labor.payroll.approve({ id: 1 })).resolves.toEqual({ operation: "approve" });
    await expect(caller.labor.payroll.pay({ id: 1 })).resolves.toEqual({ operation: "pay" });
    await expect(caller.labor.payroll.void({ id: 1 })).resolves.toEqual({ operation: "void" });
  });

  it("继续拒绝未列入角色专属工资流程的既有记录修改和其他高影响动作", async () => {
    vi.mocked(getSuperAdminAccess).mockResolvedValue({ user: ordinaryUser, canAccess: false });
    const caller = testRouter.createCaller(createContext());

    await expect(caller.labor.payroll.save({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.labor.attendance.approve({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
