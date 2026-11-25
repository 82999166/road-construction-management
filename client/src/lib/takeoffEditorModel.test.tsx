import { describe, expect, it, vi } from "vitest";
import { draftFromDetail, emptyMeasurementRow, emptyTakeoffDraft, ordinaryTakeoffDraft, restoreOrdinaryTakeoffDraft, takeoffCreateAttempt, takeoffSaveInput, validMeasurementRow, type TakeoffDetail } from "./takeoffEditorModel";
const draft = () => ({ ...emptyTakeoffDraft(), workItem: "路基填筑", workLocation: "K12+300", quantity: "12.5", unitPrice: "0" });
const input = () => takeoffSaveInput(draft(), 7, undefined, undefined, []);
describe("收方共享模型安全契约", () => {
  it("更新使用服务端强version原值，不使用updatedAt或列表版本", () => {
    const version = "sha256:" + "a".repeat(64);
    const value = takeoffSaveInput(draft(), 7, 12, version, [31, 32, 33]);
    expect(value.expectedVersion).toBe(version); expect(value).not.toHaveProperty("expectedUpdatedAt");
    expect(value.attachmentEvidenceIds).toEqual([31, 32, 33]);
    expect(() => takeoffSaveInput(draft(), 7, 12, undefined, [])).toThrow("版本缺失");
  });
  it("旧空字段不伪造且省略保留；显式清空发给后端", () => {
    const d = draft(); d.workDescription = null; d.measurementBasis = null; d.measurementRows = null;
    const old = takeoffSaveInput(d, 7, 12, "hash", []);
    expect(old).not.toHaveProperty("workDescription"); expect(old).not.toHaveProperty("measurementBasis"); expect(old).not.toHaveProperty("measurementRows");
    const cleared = takeoffSaveInput({ ...d, workDescription: "", measurementBasis: "", measurementRows: [] }, 7, 12, "hash", []);
    expect(cleared).toMatchObject({ workDescription: "", measurementBasis: "", measurementRows: [] });
  });
  it("辅助尺寸可空，零明细有效，自由计算式保持文本且不改结算量", () => {
    const row = { ...emptyMeasurementRow(), calculation: "2 * 3; alert('x')" };
    expect(validMeasurementRow(row)).toBe(true);
    const result = takeoffSaveInput({ ...draft(), measurementRows: [row] }, 7, undefined, undefined, []);
    expect(result.quantity).toBe(12.5); expect(result.measurementRows?.[0].calculation).toBe(row.calculation);
  });
  it.each([NaN, Infinity, -1])("拒绝非有限非负测量量 %s", value => {
    expect(validMeasurementRow({ ...emptyMeasurementRow(), quantity: value })).toBe(false);
    expect(validMeasurementRow({ ...emptyMeasurementRow(), width: value })).toBe(false);
  });
  it("所有新增照片ID完整保留，不创建旧照片删除请求", () => {
    const ids = Array.from({ length: 20 }, (_, i) => 100 + i);
    const value = takeoffSaveInput(draft(), 7, 12, "hash", ids);
    expect(value.attachmentEvidenceIds).toEqual(ids); expect(value.attachmentEvidenceIds).not.toBe(ids);
    expect(value).not.toHaveProperty("deleteEvidenceIds");
    expect(() => takeoffSaveInput(draft(), 7, 12, "hash", [...ids, 200])).toThrow("20");
    expect(() => takeoffSaveInput(draft(), 7, undefined, undefined, [0])).toThrow("ID");
  });
  it("保存本机只显式白名单，不透传ID/url/bytes或行额外字段", () => {
    const d = Object.assign(draft(), { measurementClaimId: "88", evidenceId: 91, url: "https://secret", base64Data: "secret" });
    d.measurementRows = [Object.assign(emptyMeasurementRow(), { location: "K9+001", evidenceId: 123, url: "secret" })];
    const safe = ordinaryTakeoffDraft(d); const raw = JSON.stringify(safe);
    expect(raw).not.toMatch(/88|evidenceId|url|base64|secret/); expect(safe.workPosition).toBe("K12+300");
    expect(restoreOrdinaryTakeoffDraft(safe)).toMatchObject({ workLocation: "K12+300", measurementRows: [{ location: "K9+001" }] });
    expect(restoreOrdinaryTakeoffDraft(safe)).not.toHaveProperty("measurementClaimId");
  });
  it("兼容旧普通草稿，恶意附件和关联不从旧草稿恢复", () => {
    expect(restoreOrdinaryTakeoffDraft({ workItem: "旧项目", workLocation: "旧位置", quantity: "3", unit: "m2", measurementClaimId: "999", attachmentEvidenceIds: [2], url: "bad", id: 9 })).toEqual({ workItem: "旧项目", workLocation: "旧位置", quantity: "3", unit: "m2" });
    expect(restoreOrdinaryTakeoffDraft({ unit: "bad", measurementRows: [{ quantity: -2 }], takeoffDate: "bad" })).toEqual({});
  });
  it("普通草稿中拒绝无效或过量测量行", () => {
    expect(restoreOrdinaryTakeoffDraft({ measurementRows: Array.from({ length: 101 }, emptyMeasurementRow) })).not.toHaveProperty("measurementRows");
    expect(() => takeoffSaveInput({ ...draft(), measurementRows: Array.from({ length: 101 }, emptyMeasurementRow) }, 7, undefined, undefined, [])).toThrow("测量明细");
  });
  it("新建失败重试稳定复用请求键，输入或新增照片改变才换键", () => {
    const create = vi.fn().mockReturnValueOnce("first").mockReturnValueOnce("second").mockReturnValueOnce("third");
    const first = takeoffCreateAttempt(input(), null, create)!;
    expect(takeoffCreateAttempt({ ...input(), documentRequestKey: "ignored" }, first, create)).toBe(first);
    const second = takeoffCreateAttempt({ ...input(), workDescription: "已改动" }, first, create)!;
    expect(second.key).toBe("second");
    expect(takeoffCreateAttempt({ ...input(), attachmentEvidenceIds: [2] }, second, create)?.key).toBe("third");
    expect(create).toHaveBeenCalledTimes(3);
    expect(takeoffCreateAttempt({ ...input(), id: 12, expectedVersion: "hash" }, first, create)).toBeNull();
  });
  it("详情恢复保持旧空值、关联和真实原数量", () => {
    const detail = { record: { measurementClaimId: 42, workItem: "原内容", workLocation: "原位置", unit: "m3", quantity: "9.125", unitPrice: "4.50", takeoffDate: "2026-11-25", workDescription: null, measurementBasis: null, measurementRows: null } };
    const restored = draftFromDetail(detail as TakeoffDetail);
    expect(restored).toMatchObject({ measurementClaimId: "42", quantity: "9.125", workDescription: null, measurementBasis: null, measurementRows: null });
  });
});
