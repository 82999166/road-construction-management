import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const contractsSource = readFileSync(new URL("./routers/contracts.ts", import.meta.url), "utf8");
const subcontractSource = readFileSync(new URL("./routers/subcontract.ts", import.meta.url), "utf8");
const settlementPaymentSource = readFileSync(new URL("./routers/settlementPayments.ts", import.meta.url), "utf8");

describe("外包合同状态机", () => {
  it("只允许草稿启用或作废、启用后暂停/到期/关闭、暂停后恢复/关闭/作废", () => {
    expect(contractsSource).toContain('const contractStatus = z.enum(["draft", "active", "suspended", "expired", "closed", "void"])');
    expect(contractsSource).toContain('draft: ["active", "void"]');
    expect(contractsSource).toContain('active: ["suspended", "expired", "closed"]');
    expect(contractsSource).toContain('suspended: ["active", "closed", "void"]');
    expect(contractsSource).toContain('当前合同状态不允许该操作');
  });

  it("将启用复核与关闭/作废权限分开，并限制仅草稿或暂停合同可编辑", () => {
    expect(contractsSource).toContain('input.targetStatus === "active" ? "review" : "edit"');
    expect(contractsSource).toContain('["closed", "void"].includes(input.targetStatus) ? "void"');
    expect(contractsSource).toContain('if (existing.status !== "draft" && existing.status !== "suspended")');
    expect(contractsSource).toContain('仅草稿或已暂停合同可修改内容');
    expect(contractsSource).toContain('assertProjectInCurrentScope(ctx, input.projectId)');
  });

  it("使用状态条件更新、审计和通知记录合同变更", () => {
    expect(contractsSource).toContain('eq(outsourceContracts.status, existing.status)');
    expect(contractsSource).toContain('transition_outsource_contract');
    expect(contractsSource).toContain('outsource_contract_${input.targetStatus}');
  });
});

describe("分包包件与付款结算状态机", () => {
  it("禁止包件绕过结算单直接结算，并按分配、确认和作废职责校验", () => {
    expect(subcontractSource).toContain('draft: ["allocated", "void"]');
    expect(subcontractSource).toContain('allocated: ["confirmed", "void"]');
    expect(subcontractSource).toContain('confirmed: ["void"]');
    expect(subcontractSource).toContain('已确认分包包件必须通过应付结算单完成审核与付款，不能直接标记结算');
    expect(subcontractSource).toContain('canMaintainSubcontractDraft(roleCodes)');
    expect(subcontractSource).toContain('canConfirmSubcontract(roleCodes)');
    expect(subcontractSource).toContain('canSettleSubcontract(roleCodes)');
    expect(subcontractSource).toContain('eq(subcontractPackages.status, record.status)');
  });

  it("将价格倒挂、应付结算单审批与统一凭证付款职责分离写入服务端规则", () => {
    expect(subcontractSource).toContain('价格倒挂的分包包件缺少原因，不能确认');
    expect(subcontractSource).toContain('价格倒挂包件尚未完成双岗复核，不能建立付款结算单');
    expect(subcontractSource).toContain('提交人与会计审核人必须职责分离');
    expect(settlementPaymentSource).toContain('会计审核人与实际付款人必须职责分离');
    expect(settlementPaymentSource).toContain('付款日期已封存，须由财务负责人先授权反结账后再登记付款');
    expect(settlementPaymentSource).toContain('请上传并关联当前结算单的有效付款凭证');
  });

  it("要求分包先草稿、提交、审批，再通过统一分笔付款台账结清并同步包件与财务记录", () => {
    expect(subcontractSource).toContain('draft: ["submitted", "void"]');
    expect(subcontractSource).toContain('submitted: ["approved", "void"]');
    expect(subcontractSource).toContain('approved: ["void"]');
    expect(subcontractSource).not.toContain('sourceType: "subcontract_payment_settlement"');
    expect(settlementPaymentSource).toContain('input.settlementType === "subcontract"');
    expect(settlementPaymentSource).toContain('status: input.final ? "paid" : "partial"');
    expect(settlementPaymentSource).toContain('status: "settled", settledAt: now');
    expect(settlementPaymentSource).toContain('sourceType: "settlement_payment"');
  });
});
