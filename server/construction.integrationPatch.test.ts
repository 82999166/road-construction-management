import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
const source = readFileSync(
  new URL("../client/src/pages/AdminPage.tsx", import.meta.url),
  "utf8"
);
const compact = source.replace(/\s+/g, "");
const tree = ts.createSourceFile(
  "AdminPage.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
function mounted(name: string, sourceTree = tree) {
  const elements: ts.JsxSelfClosingElement[] = [];
  const walk = (node: ts.Node) => {
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(sourceTree) === name
    )
      elements.push(node);
    ts.forEachChild(node, walk);
  };
  walk(sourceTree);
  return elements;
}
describe("施工新版后台实际集成契约", () => {
  it("唯一施工工作区对接授权项目和原状态转换接口，其他模块保留", () => {
    const nodes = mounted("ConstructionWorkspace");
    expect(nodes).toHaveLength(1);
    const node = nodes[0].getText(tree).replace(/\s+/g, "");
    for (const property of [
      "projectId={workspaceProjectId}",
      "active={canQuery&&isConstruction&&hasBusinessWorkspaceProject}",
      "onCreate={() => openConstructionEditor()}".replace(/\s+/g, ""),
      "onEdit={openConstructionEditor}",
      "transitionConstructionReport.mutate({",
    ])
      expect(node).toContain(property);
    for (const name of [
      "PurchasingWorkspace",
      "MachineryWorkspace",
      "VehicleManagementWorkspace",
    ])
      expect(mounted(name)).toHaveLength(1);
    const vehicleNode = mounted("VehicleManagementWorkspace")[0]
      .getText(tree)
      .replace(/\s+/g, "");
    expect(vehicleNode).toContain("projects={projects.data??[]}");
    expect(vehicleNode).toContain(
      "onDirtyChange={onVehicleManagementDirtyChange}"
    );
    const detailTree = ts.createSourceFile(
      "VehicleManagementDetail.tsx",
      readFileSync(
        new URL(
          "../client/src/components/VehicleManagementDetail.tsx",
          import.meta.url
        ),
        "utf8"
      ),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    const detailSettlements = mounted(
      "TransportVehicleSettlementManager",
      detailTree
    );
    expect(detailSettlements).toHaveLength(1);
    const detailSettlement = detailSettlements[0]
      .getText(detailTree)
      .replace(/\s+/g, "");
    expect(detailSettlement).toContain("projectId={d.vehicle.projectId}");
    expect(detailSettlement).toContain("vehicles={[d.vehicle]}");
    expect(detailSettlement).toContain("onDirtyChange={setPaymentDirty}");
    // 运输页仍有独立录入，必须保留父级项目/离开保护；不能以车辆页回调替代。
    expect(
      mounted("TransportVehicleSettlementManager").filter(element =>
        element
          .getText(tree)
          .includes("onDirtyChange={onTransportSettlementDirtyChange}")
      )
    ).toHaveLength(1);
    expect(node).toContain("projectId:workspaceProjectId");
    expect(node).toContain("nextStatus,");
  });
  it("原录入字段全部保留，不把新版台账变成仅可查看", () => {
    for (const field of [
      "reportDate",
      "workArea",
      "weather",
      "workContent",
      "safetyNotes",
      "issueNotes",
      "progressPercent",
    ])
      expect(compact).toContain("constructionReportEditor." + field);
    expect(compact).toContain("saveConstructionReport.mutate({");
    expect(compact).toContain(
      "constructionReportEditor?.projectId===workspaceProjectId"
    );
  });
  it("退出确认、原项目提交防误写和刷新新台账完整接入", () => {
    expect(compact).toContain("constructionEditorDirty&&!window.confirm");
    expect(compact).toContain(
      "trpcUtils.construction.listReports.invalidate()"
    );
    expect(compact).toContain("trpcUtils.construction.summary.invalidate()");
    expect(compact).not.toContain("constconstructionDailyReports=");
    expect(compact).not.toContain("constprintConstructionReports=");
  });
});
