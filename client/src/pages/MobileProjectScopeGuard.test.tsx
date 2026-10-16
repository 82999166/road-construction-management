import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const purchasingSource = readFileSync(new URL("./MobilePurchasingPage.tsx", import.meta.url), "utf8");
const dieselSource = readFileSync(new URL("./MobileDieselPage.tsx", import.meta.url), "utf8");
const financeRouterSource = readFileSync(new URL("../../../server/routers/finance.ts", import.meta.url), "utf8");
const dieselRouterSource = readFileSync(new URL("../../../server/routers/diesel.ts", import.meta.url), "utf8");

function getRouterProcedure(source: string, name: string) {
  const start = source.indexOf(`  ${name}:`);
  expect(start, `未找到 ${name} 路由`).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("\n  }),", start) + 5);
}

describe("移动采购与后勤项目范围守卫", () => {
  it("采购页面仅在已从服务端授权项目列表选定项目后读取业务台账", () => {
    expect(purchasingSource).toContain("trpc.purchasing.projectOptions.useQuery");
    expect(purchasingSource).toContain("const selectedProjectId = projectId ?? 0");
    expect(purchasingSource).toContain("enabled: isAuthenticated && Boolean(selectedProjectId)");
    expect(purchasingSource).toContain("项目授权加载失败");
    expect(purchasingSource).toContain("这不等同于没有项目权限");
    expect(purchasingSource).toContain("暂无授权项目");
    expect(purchasingSource).toContain("projects.refetch()");
  });

  it("柴油页面只使用服务端返回的已授权项目，并在无范围时不给资产查询入口", () => {
    expect(dieselSource).toContain("trpc.diesel.mobileOverview.useQuery(projectId ? { projectId } : undefined");
    expect(dieselSource).toContain("const selectedProjectId = projectId ?? 0");
    expect(dieselSource).toContain("Boolean(selectedProjectId)");
    expect(dieselSource).toContain("柴油台账暂不可用");
  });

  it("采购和柴油服务端接口均在读取或写入前复核项目范围", () => {
    for (const name of ["listAssetOptions", "listRequests", "listOrders", "listPurchaseEvidences", "uploadPurchaseDocument", "createSmallDirectOrder", "listSettlements", "listInventory"]) {
      expect(getRouterProcedure(financeRouterSource, name)).toContain("await assertProjectInCurrentScope(ctx, input.projectId)");
    }
    for (const name of ["printSummary", "mobileRefuelOptions", "mobileCreateRefuel"]) {
      expect(getRouterProcedure(dieselRouterSource, name)).toContain("await assertProjectInCurrentScope(ctx, input.projectId)");
    }
    expect(dieselRouterSource).toContain("if (selectedProjectId && !authorizedProjects.some(project => project.id === selectedProjectId)) throw new TRPCError");
  });
});
