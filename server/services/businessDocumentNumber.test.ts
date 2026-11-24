import { describe, expect, it } from "vitest";
import { BUSINESS_DOCUMENT_MODULES, BUSINESS_DOCUMENT_NUMBER_CONTRACT, isBusinessDocumentNumber } from "../../shared/businessDocumentNumber";
import { businessDocumentActorKey, businessDocumentBeijingSecond, createDrizzleBusinessDocumentNumberAdapter } from "./businessDocumentNumber";

describe("业务单号契约", () => {
  it("版块代码均为两个大写字母且无冲突", () => {
    const codes = Object.values(BUSINESS_DOCUMENT_MODULES);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every(code => /^[A-Z]{2}$/.test(code))).toBe(true);
  });
  it("真实操作人至少4位，较大编号不截断，系统身份明确SYS", () => {
    expect(businessDocumentActorKey({ kind: "user", userId: 23 })).toBe("0023");
    expect(businessDocumentActorKey({ kind: "user", userId: 123456 })).toBe("123456");
    expect(businessDocumentActorKey({ kind: "user", userId: 1234567890123456n })).toBe("1234567890123456");
    expect(businessDocumentActorKey({ kind: "system" })).toBe("SYS");
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "0", "001", "SYS", "", " 1", "1.0", "12345678901234567"])("拒绝不可信操作人编号 %s", userId => {
    expect(() => businessDocumentActorKey({ kind: "user", userId })).toThrow();
  });
  it("北京时间秒独立于进程时区，午夜不是24时，不使用业务日期", () => {
    expect(businessDocumentBeijingSecond(new Date("2026-11-24T09:05:09.999Z"))).toBe("20261124170509");
    expect(businessDocumentBeijingSecond(new Date("2026-11-24T16:00:00Z"))).toBe("20261125000000");
    expect(businessDocumentBeijingSecond(new Date("2026-12-31T16:00:00Z"))).toBe("20270101000000");
    expect(() => businessDocumentBeijingSecond(new Date(NaN))).toThrow();
  });
  it("紧凑样例符合格式并明确预览不耗号", () => {
    expect(isBusinessDocumentNumber(BUSINESS_DOCUMENT_NUMBER_CONTRACT.userExample)).toBe(true);
    expect(isBusinessDocumentNumber(BUSINESS_DOCUMENT_NUMBER_CONTRACT.systemExample)).toBe(true);
    expect(isBusinessDocumentNumber("PO2026112417050900230000")).toBe(false);
    expect(isBusinessDocumentNumber("PO2026112417050900239999")).toBe(true);
    expect(isBusinessDocumentNumber("DS-MC-23")).toBe(false);
    expect(BUSINESS_DOCUMENT_NUMBER_CONTRACT.preview).toContain("保存成功");
  });
  it("拒绝根数据库/自动提交adapter，必须真实事务", () => {
    expect(() => createDrizzleBusinessDocumentNumberAdapter({} as never)).toThrow("共用数据库事务");
  });
});
