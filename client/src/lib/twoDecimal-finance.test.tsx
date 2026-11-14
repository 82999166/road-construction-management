import { describe, expect, it } from "vitest";
import { formatAmount } from "@shared/numberFormat";
import {
  buildSettlementPaymentWorkbook,
  type SettlementPaymentMonthlyData,
} from "@/components/SettlementPaymentFinancialBoard.helpers";

describe("finance two-decimal presentation", () => {
  it("formats zero, rounded decimals, and grouped amounts as display strings", () => {
    expect(formatAmount(3)).toBe("3.00");
    expect(formatAmount(430.432)).toBe("430.43");
    expect(formatAmount(0)).toBe("0.00");
    expect(formatAmount(1234567.8)).toBe("1,234,567.80");
  });

  it("keeps monthly workbook amount cells fixed to two decimals", () => {
    const data = {
      meta: {
        period: "2026-11",
        sourceTypes: ["payroll"],
        direction: "all",
        status: "all",
        paymentMethod: "all",
        keyword: "",
        generatedAt: new Date("2026-11-14T00:00:00.000Z"),
      },
      summary: {
        activeExpenseAmount: 3,
        activeIncomeAmount: 430.432,
        reversedAmount: 0,
        matching: { matched: 1, missing: 0, inconsistent: 0 },
        byType: [
          {
            label: "工资发放",
            count: 1,
            activeExpenseAmount: 3,
            activeIncomeAmount: 430.432,
            reversedAmount: 0,
            matched: 1,
            missing: 0,
            inconsistent: 0,
          },
        ],
      },
      records: [
        {
          voucherNo: "V-1",
          settlementTypeLabel: "工资发放",
          settlementNo: "S-1",
          periodLabel: "2026-11",
          direction: "expense",
          status: "active",
          amount: 430.432,
          paymentDate: "2026-11-14",
          paymentMethodLabel: "现金",
          payeeName: "张三",
          operatorName: "李四",
          proof: null,
          reconciliationStatus: "matched",
        },
      ],
    } as unknown as SettlementPaymentMonthlyData;

    const workbook = buildSettlementPaymentWorkbook(data, "测试项目");
    expect(workbook.sheets[0].rows[0]?.slice(2, 5)).toEqual([
      3,
      430.432,
      0,
    ]);
    expect(workbook.sheets[1].rows[0]?.[6]).toBe(430.432);
    expect(workbook.sheets[0].twoDecimalColumns).toEqual([2, 3, 4]);
    expect(workbook.sheets[1].twoDecimalColumns).toEqual([6]);
  });
});
