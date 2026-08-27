import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("后台审计工作区组件", () => {
  it("独立承载审计链健康、敏感访问摘要与受控刷新入口", () => {
    const component = readFileSync(new URL("./AdminAuditWorkspace.tsx", import.meta.url), "utf8");
    const adminPage = readFileSync(new URL("../pages/AdminPage.tsx", import.meta.url), "utf8");
    expect(component).toContain("审计链状态");
    expect(component).toContain("敏感数据访问利用");
    expect(component).toContain("onRefresh");
    expect(component).toContain("不展示敏感原文");
    expect(component).toContain('import { formatChinaDateTime } from "@/lib/businessTime"');
    expect(component).toContain("return formatChinaDateTime(value)");
    expect(adminPage).toContain('lazy(() => import("@/components/AdminAuditWorkspace"))');
    expect(adminPage).toContain("<AdminAuditWorkspace");
  });
});
