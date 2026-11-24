import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";
const admin = readFileSync(new URL("../pages/AdminPage.tsx", import.meta.url), "utf8");
const mobile = readFileSync(new URL("../pages/MobileEvidencePage.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("AdminPage.tsx", admin, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const findJsx = (tag: string): ts.JsxOpeningLikeElement[] => {
  const nodes: ts.JsxOpeningLikeElement[] = [];
  const visit = (node: ts.Node) => { if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === tag) nodes.push(node); ts.forEachChild(node, visit); };
  visit(source); return nodes;
};
const attr = (node: ts.JsxOpeningLikeElement, name: string) => node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(source) === name)?.getText(source);

describe("Admin及Mobile父页面真实接线契约", () => {
  it("能力查询是页面顶层hook，而非render/tab或条件分支内部hook", () => {
    const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "AdminPage") as ts.FunctionDeclaration;
    const vars = fn.body!.statements.filter(ts.isVariableStatement).flatMap(statement => Array.from(statement.declarationList.declarations));
    for (const name of ["payrollCorrectionCapabilities", "financeCorrectionCapabilities"]) {
      const declaration = vars.find(node => node.name.getText(source) === name)!;
      expect(declaration).toBeDefined(); expect(declaration.initializer!.getText(source)).toContain("correctionCapabilities.useQuery");
    }
    expect(admin).toContain("enabled: canQuery && isLabor && Boolean(workspaceProjectId)");
    expect(admin).toContain('enabled: canQuery && activeSection === "finance" && Number(financeProjectId) > 0');
    expect(admin).toContain("!financeCorrectionCapabilities.isError && !financeCorrectionCapabilities.isFetching");
    expect(admin).toContain("!payrollCorrectionCapabilities.isPlaceholderData");
  });
  it("工资日结以真实roleCodes替换兼容默认路径并保留筛选/导出/付款", () => {
    const payroll = findJsx("PayrollStatementLedger")[0]; const daily = findJsx("DailyWageLedger")[0];
    expect(attr(payroll, "roleCodes")).toBe("roleCodes={payrollCorrectionRoleCodes}"); expect(attr(daily, "roleCodes")).toBe("roleCodes={payrollCorrectionRoleCodes}");
    for (const key of ["search", "rows", "onExport", "onOpenDetail", "onRegisterPayment"]) expect(attr(payroll, key)).toBeDefined();
    for (const key of ["onExportWorkbook", "onExportPaymentList", "onRefresh", "onRegisterPayment"]) expect(attr(daily, key)).toBeDefined();
    expect(admin).not.toMatch(/roleCodes=\{\["ALL"\]\}/);
  });
  it("总账独立来源纠错列及8列空态，使用实际财务项目不补造null归属", () => {
    const node = findJsx("FinanceRecordCorrectionActions")[0];
    expect(attr(node, "projectId")).toBe("projectId={Number(financeProjectId)}");
    expect(attr(node, "record")).toBe("record={{ ...record, projectId: record.projectId }}");
    expect(attr(node, "roleCodes")).toBe("roleCodes={financeCorrectionRoleCodes}");
    const table = admin.slice(admin.indexOf("financeLedgerPageRows.map(record"), admin.indexOf("当前页 {financeLedgerPageRows.length}"));
    expect(table).toContain('typeof record.id === "number"'); expect(table).toContain("Number.isSafeInteger(record.id)"); expect(table).toContain("record.projectId > 0"); expect(table).toContain("colSpan={8}");
    expect(admin).toContain("<TableHead>纠错 / 来源</TableHead>"); expect(attr(node, "onOpenSource")).toBeUndefined();
  });
  it("项目及组织没有删除按钮，真实预览组件挂载且硬删执行防守封死", () => {
    expect(admin).not.toContain("删除项目\n"); expect(admin).not.toContain("删除组织\n");
    expect(findJsx("IdentityDeletionImpactPreview")).toHaveLength(1);
    expect(admin).toContain('masterDataDeleteTarget.resource !== "project" && masterDataDeleteTarget.resource !== "organization" && !removeMasterData.isPending');
    expect(admin).toContain("关闭预览"); expect(admin).toContain("event.preventDefault()");
  });
  it("项目恢复显式确认+原因+状态CAS、冲突强刷并invalidate真实范围和角色授权列表", () => {
    expect(admin).toContain("expectedStatus: item.status"); expect(admin).toContain("expectedStatus: projectForm.expectedStatus");
    expect(admin).toContain("confirmRestore: restoring ? projectForm.confirmRestore : undefined"); expect(admin).toContain("reason: restoring ? projectForm.restoreReason?.trim() : undefined");
    expect(admin).toContain('error.data?.code === "CONFLICT"'); expect(admin).toContain("trpcUtils.admin.department.listScopes.invalidate()"); expect(admin).toContain("trpcUtils.admin.personnel.listAssignments.invalidate()");
    expect(admin).toContain("只恢复项目档案，不恢复旧直接角色授权或业务模块");
  });
  it("disabled模块只有独立确认重新启用，项目收回保留配置，组织状态真实", () => {
    expect(findJsx("ScopeReactivationDialog")).toHaveLength(1); expect(admin).toContain("onConfirm={input => saveDepartmentScope.mutateAsync(input)}");
    expect(admin).toContain('expectedStatus: existing?.status ?? "absent"'); expect(admin).toContain("expectedStatus: scope.status");
    expect(admin).toContain('result.operation === "disabled"'); expect(admin).toContain("getBusinessStatusLabel(scope.scopeStatus)");
    expect(admin).toContain("最后模块收回不会恢复历史兼容范围"); expect(admin).not.toContain("可重新启用创建");
  });
  it("移动取证不再从非空sourceId宣称随单审核，非法删除有说明和disabled", () => {
    expect(mobile).not.toContain("随单审核"); expect(mobile).not.toContain("将随关联业务单据一并提交");
    expect(mobile).toContain("evidenceAssociationLabel(item.sourceAssociationStatus)"); expect(mobile).toContain("<EvidenceAssociationSummary record={item} />");
    expect(mobile).toContain("disabled={!canRequestEvidenceDeletion(item)"); expect(mobile).toContain("!canDeleteCandidate ||"); expect(mobile).toContain("deleteCandidate && canDeleteCandidate && !removeEvidence.isPending");
    expect(mobile).toContain("event.preventDefault()"); expect(mobile).toContain("sm:max-w-3xl lg:max-w-3xl");
  });
  it("保留本轮统一单号输入现有接线与机械防重", () => {
    expect(admin).toContain('orderNo: importOptionalText(row["订单号（留空自动生成）"])');
    expect(admin).toContain("receiptNo: dieselRefuelForm.receiptNo.trim() || null");
    expect(admin).toContain("useGuardedMachineCost"); expect(admin).toContain("DieselRecordActions");
  });
});
