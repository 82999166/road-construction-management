import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("外包合同管理入口与草案", () => {
  it("新建按钮会给出项目范围或权限反馈，并提供三类可编辑合同草案", () => {
    const source = readFileSync(fileURLToPath(new URL("./ContractManagementPanel.tsx", import.meta.url)), "utf8");

    expect(source).toContain("请先选择合同项目范围，再新建外包合同");
    expect(source).toContain("附属工程外包合同草案");
    expect(source).toContain("渣土车运输合同草案");
    expect(source).toContain("工程机械租赁合同草案");
    expect(source).toContain("签署前请由项目法务或律师");
    expect(source).toContain("FullContractTemplates");
    expect(source).toContain("onApply={applyFullTemplate}");
  });

  it("合同编辑日期与表格时间使用统一工具，未知状态不会回显英文", () => {
    const source = readFileSync(fileURLToPath(new URL("./ContractManagementPanel.tsx", import.meta.url)), "utf8");

    expect(source).toContain('import { formatChinaDate, toDeviceDateInput } from "@/lib/businessTime"');
    expect(source).toContain("startDate: row.startDate ? toDeviceDateInput(row.startDate) : \"\"");
    expect(source).toContain("formatChinaDate(row.startDate)");
    expect(source).toContain("{statusLabel[row.status]}</Badge>");
    expect(source).not.toContain("statusLabel[row.status] ?? row.status");
  });
});
