import { describe, expect, it } from "vitest";
import {
  assertApprovalTransition,
  assertAttendanceWorkHours,
  assertCertificateFileSignature,
  assertMachineCostStatusTransition,
  assertPayrollStatusTransition,
  assertTransportTripStatusTransition,
  calculateMachineSettlement,
  calculatePayrollAmounts,
  calculateTheoreticalVolume,
  calculateTieredFreightAmount,
  canApprovePayroll,
  getAttendanceSourceLabel,
  getBusinessStatusLabel,
  getCardValidationStatusLabel,
  getSafeCardValidationReason,
  summarizePayrollStatements,
  ConstructionDomainError,
  PURCHASE_CATEGORY_CATALOG,
} from "../shared/domain";

describe("施工承包核心业务计算", () => {
  it("严格保留十二类日常采购分类", () => {
    expect(PURCHASE_CATEGORY_CATALOG).toHaveLength(12);
    expect(PURCHASE_CATEGORY_CATALOG.map(item => item.code)).toContain("FUEL");
    expect(PURCHASE_CATEGORY_CATALOG.map(item => item.code)).toContain("SPARE_PARTS");
  });

  it("用户可见状态统一映射为中文，未知内部码不直接回显", () => {
    expect(getBusinessStatusLabel("submitted")).toBe("已提交");
    expect(getBusinessStatusLabel("verified")).toBe("已核验");
    expect(getBusinessStatusLabel("settled")).toBe("已结算");
    expect(getBusinessStatusLabel("unexpected_internal_status")).toBe("状态待核对");
  });

  it("考勤来源统一映射为中文，未知内部码不直接回显", () => {
    expect(getAttendanceSourceLabel("manual")).toBe("手工登记");
    expect(getAttendanceSourceLabel("mobile")).toBe("移动端登记");
    expect(getAttendanceSourceLabel("device")).toBe("考勤设备");
    expect(getAttendanceSourceLabel("import")).toBe("导入记录");
    expect(getAttendanceSourceLabel("unexpected_internal_source")).toBe("来源待核对");
  });

  it("读卡校验状态和原因仅输出受控中文说明", () => {
    expect(getCardValidationStatusLabel("accepted")).toBe("校验通过");
    expect(getCardValidationStatusLabel("校验通过")).toBe("校验通过");
    expect(getCardValidationStatusLabel("unexpected_internal_status")).toBe("状态待核对");
    expect(getSafeCardValidationReason("卸土地点与配置不符")).toBe("卸土地点与配置不符");
    expect(getSafeCardValidationReason("site_mismatch_error")).toBe("请由管理员核对车辆卡、地点与时间。");
    expect(getSafeCardValidationReason("NFC 设备响应异常")).toBe("请由管理员核对车辆卡、地点与时间。");
  });

  it("按长宽高和装载系数计算渣土车理论方量", () => {
    expect(calculateTheoreticalVolume(6, 2.3, 1.2, 0.9)).toBe(14.904);
  });

  it("按一公里起步与每 500 米递增计算运费", () => {
    const result = calculateTieredFreightAmount({
      actualDistanceKm: 2.2,
      startDistanceKm: 1,
      basePricePerUnit: 10,
      stepMeters: 500,
      stepIncreasePerUnit: 1.5,
      settlementQuantity: 12,
    });
    expect(result).toEqual({ billableSteps: 3, unitPrice: 14.5, totalAmount: 174 });
  });

  it("运距未超过起步里程时不增加阶梯单价，且拒绝无效递增步长", () => {
    expect(calculateTieredFreightAmount({
      actualDistanceKm: 0.8,
      startDistanceKm: 1,
      basePricePerUnit: 10,
      stepMeters: 500,
      stepIncreasePerUnit: 1.5,
      settlementQuantity: 12,
    })).toEqual({ billableSteps: 0, unitPrice: 10, totalAmount: 120 });
    expect(() => calculateTieredFreightAmount({
      actualDistanceKm: 2,
      startDistanceKm: 1,
      basePricePerUnit: 10,
      stepMeters: 0,
      stepIncreasePerUnit: 1,
      settlementQuantity: 1,
    })).toThrow("递增里程单位必须大于 0 米");
  });

  it("汇总机械租赁、油料、加班、修理和进退场费用", () => {
    const result = calculateMachineSettlement({
      leaseAmount: 20000,
      dieselLiters: 1000,
      dieselUnitPrice: 7.2,
      overtimeHours: 12,
      overtimeHourlyRate: 180,
      repairAmount: 500,
      mobilizationAmount: 1500,
      deductionAmount: 300,
    });
    expect(result).toEqual({ fuelAmount: 7200, overtimeAmount: 2160, totalAmount: 31060 });
  });

  it("机械结算纳入其他经批准成本并拒绝负数金额", () => {
    expect(calculateMachineSettlement({
      leaseAmount: 100,
      dieselLiters: 0,
      dieselUnitPrice: 0,
      overtimeHours: 0,
      overtimeHourlyRate: 0,
      repairAmount: 0,
      mobilizationAmount: 0,
      deductionAmount: 0,
      otherAmount: 25.5,
    }).totalAmount).toBe(125.5);
    expect(() => calculateMachineSettlement({
      leaseAmount: -1,
      dieselLiters: 0,
      dieselUnitPrice: 0,
      overtimeHours: 0,
      overtimeHourlyRate: 0,
      repairAmount: 0,
      mobilizationAmount: 0,
      deductionAmount: 0,
    })).toThrow("机械结算参数必须为有效的非负数");
  });

  it("由服务端统一计算工资应发、扣款与实发金额", () => {
    expect(calculatePayrollAmounts({ payableAmount: 12345.678, deductionAmount: 345.671 })).toEqual({
      payableAmount: 12345.68,
      deductionAmount: 345.67,
      actualAmount: 12000.01,
    });
    expect(() => calculatePayrollAmounts({ payableAmount: 1000, deductionAmount: 1000.01 })).toThrow("扣款金额不得大于应发金额");
  });

  it("仅会计或系统级管理员可以审核工资条", () => {
    expect(canApprovePayroll(["LABOR_MANAGER", "FINANCE_MANAGER"])).toBe(false);
    expect(canApprovePayroll(["ACCOUNTANT"])).toBe(true);
    expect(canApprovePayroll(["ALL", "SUPER_ADMIN"])).toBe(true);
  });

  it("禁止单日正常工时与加班工时合计超过 24 小时", () => {
    expect(() => assertAttendanceWorkHours(8, 4)).not.toThrow();
    expect(() => assertAttendanceWorkHours(20, 5)).toThrow("合计不得超过 24 小时");
    expect(() => assertAttendanceWorkHours(-1, 0)).toThrow("必须为 0 至 24 之间");
  });

  it("按同一口径汇总工资条、待审核金额与审核数量", () => {
    expect(summarizePayrollStatements([
      { payableAmount: "1000", deductionAmount: "100", actualAmount: "900", status: "reviewing" },
      { payableAmount: 2000, deductionAmount: 200, actualAmount: 1800, status: "approved" },
      { payableAmount: "100.335", deductionAmount: "0", actualAmount: "100.335", status: "reviewing" },
    ])).toEqual({
      payableAmount: 3100.34,
      deductionAmount: 300,
      actualAmount: 2800.34,
      awaitingReviewCount: 2,
      awaitingReviewAmount: 1000.34,
      approvedCount: 1,
    });
  });

  it("拒绝声明格式与二进制文件头不一致的劳务证照文件", () => {
    expect(() => assertCertificateFileSignature(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg")).not.toThrow();
    expect(() => assertCertificateFileSignature(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), "application/pdf")).not.toThrow();
    expect(() => assertCertificateFileSignature(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), "image/png")).toThrow("内容与声明格式不一致");
  });

  it("仅允许工资草稿提交审核，并允许会计审核后通过或退回草稿", () => {
    expect(() => assertPayrollStatusTransition("draft", "reviewing")).not.toThrow();
    expect(() => assertPayrollStatusTransition("reviewing", "approved")).not.toThrow();
    expect(() => assertPayrollStatusTransition("reviewing", "draft")).not.toThrow();
    expect(() => assertPayrollStatusTransition("approved", "draft")).toThrow("工资条状态不允许");
    expect(() => assertPayrollStatusTransition("paid", "reviewing")).toThrow("工资条状态不允许");
  });

  it("以统一中文业务异常拒绝无效参数", () => {
    expect(() => calculateTheoreticalVolume(0, 2.3, 1.2)).toThrow(ConstructionDomainError);
    try {
      calculateTheoreticalVolume(0, 2.3, 1.2);
    } catch (error) {
      expect((error as ConstructionDomainError).code).toBe("INVALID_PARAMETER");
    }
  });

  it("禁止已结算单据回退至草稿，保证资金和业务台账可追溯", () => {
    expect(() => assertApprovalTransition("settled", "draft")).toThrow("单据状态不允许");
    expect(() => assertApprovalTransition("draft", "submitted")).not.toThrow();
  });

  it("机械成本仅可按录入、审核、结算顺序流转，已结算记录不可回退", () => {
    expect(() => assertMachineCostStatusTransition("draft", "approved")).not.toThrow();
    expect(() => assertMachineCostStatusTransition("approved", "settled")).not.toThrow();
    expect(() => assertMachineCostStatusTransition("draft", "settled")).toThrow("机械成本状态不允许");
    expect(() => assertMachineCostStatusTransition("settled", "void")).toThrow("机械成本状态不允许");
  });

  it("运输趟次仅允许提交、核验、结算的单向流转，已结算趟次不可重算", () => {
    expect(() => assertTransportTripStatusTransition("draft", "submitted")).not.toThrow();
    expect(() => assertTransportTripStatusTransition("submitted", "verified")).not.toThrow();
    expect(() => assertTransportTripStatusTransition("verified", "settled")).not.toThrow();
    expect(() => assertTransportTripStatusTransition("draft", "verified")).toThrow("运输趟次状态不允许");
    expect(() => assertTransportTripStatusTransition("settled", "void")).toThrow("运输趟次状态不允许");
  });
});
