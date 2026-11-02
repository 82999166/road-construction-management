import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readSource = (path: Parameters<typeof readFileSync>[0]) =>
  readFileSync(path, "utf8")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/,\s*}/g, " }");

const source = readSource(new URL("./AdminPage.tsx", import.meta.url));

describe("劳务工资新建实名制施工队工人入口", () => {
  it("打开当前劳务页内的新建施工队工人窗口，不再错误跳转员工档案或权限页", () => {
    const entryAction =
      source.match(/<LaborEntryActionCard onAdd=\{\(\) => \{[^}]+\}\} \/>/)?.[0] ??
      "";

    expect(entryAction).toContain("setLaborWorkerCreateDialogOpen(true)");
    expect(entryAction).toContain("setLaborWorkerCreateForm(EMPTY_LABOR_WORKER_CREATE_FORM)");
    expect(entryAction).not.toContain("setEmployeeProfileDialogOpen(true)");
    expect(entryAction).not.toContain('setLocation("/admin/permission")');
    expect(entryAction).not.toContain('setLocation("/admin/permissions")');
    expect(source).toContain("<LaborWorkerRoster");
    expect(source).toContain("onCreateWorker={() => {");
  });

  it("调用 labor.saveWorker 建立真实施工队工人，固定分类和默认实名/在场状态", () => {
    expect(source).toContain("trpc.labor.saveWorker.useMutation");
    expect(source).toContain('workerCategory: "labor_team"');
    expect(source).toContain('identityVerificationStatus: "pending"');
    expect(source).toContain('attendanceStatus: "active"');
    expect(source).toContain("projectId: workspaceProjectId");
    expect(source).toContain("realName: laborWorkerCreateForm.realName.trim()");
    expect(source).toContain("identityNo: laborWorkerCreateForm.identityNo.trim()");
    expect(source).toContain("不创建系统账号或员工档案");
  });

  it("成功后关闭并清空受控敏感输入，同时刷新提交项目的劳务人员查询", () => {
    const mutation = source.slice(
      source.indexOf("const saveLaborWorker"),
      source.indexOf("const uploadEmployeeInsurancePolicy")
    );

    expect(mutation).toContain("closeLaborWorkerCreateDialog()");
    expect(source).toContain("const closeLaborWorkerCreateDialog = () => {");
    expect(source).toContain("setLaborWorkerCreateForm(EMPTY_LABOR_WORKER_CREATE_FORM)");
    expect(mutation).toContain("trpcUtils.labor.listWorkers.invalidate");
    expect(mutation).toContain("projectId: variables.projectId");
    expect(mutation).not.toContain("localStorage");
    expect(mutation).not.toContain("saveMobileDraft");
  });

  it("在员工档案关联窗口没有候选工人时说明只能关联已有档案，并安全返回劳务工作台", () => {
    expect(source).toContain("暂无可关联的施工队工人");
    expect(source).toContain("只能关联已有真实劳务档案，不能在此创建工人");
    expect(source).toContain("前往劳务工资工作台新建实名制施工队工人");
    expect(source).toContain('setLocation("/admin/labor")');
  });

  it("员工档案的施工队关联候选仅显示类别为施工队人员的实名档案", () => {
    expect(source).toContain("const constructionWorkerOptions = useMemo(");
    expect(source).toContain('worker.workerCategory === "labor_team"');
    expect(source).toContain("constructionWorkerOptions.length ?");
    expect(source).toContain("constructionWorkerOptions.map(worker =>");
  });
});
