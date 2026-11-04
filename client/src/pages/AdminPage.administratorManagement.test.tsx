import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getManagementModulePath } from "../lib/managementPortal";
import { getScopedPcAdminSection } from "../lib/scopedManagementWorkspace";

const source = readFileSync(
  new URL("./AdminPage.tsx", import.meta.url),
  "utf8"
);
const rootRouter = readFileSync(
  new URL("../../../server/routers.ts", import.meta.url),
  "utf8"
);

describe("PC超级后台管理员集中入口", () => {
  it("独立平台治理菜单与懒加载工作区保持原权限管理兼容", () => {
    expect(source).toContain('label: "管理员管理"');
    expect(source).toContain('path: "/admin/administrators"');
    expect(source).toContain('import("@/components/AdministratorManagement")');
    expect(source).toContain(
      'activeSection === "administrators" && !scopedSection'
    );
    expect(source).toContain('label: "权限管理"');
    expect(source).toContain('path: "/admin/permission"');
  });
  it("自身密码仅对受控本地账号显示，稳定草稿回传复用导航保护", () => {
    expect(source).toContain(
      'canChangeOwnPassword={user?.loginMethod === "local_manager"}'
    );
    expect(source).toContain(
      'recordWorkspaceDirty("administrator-management", dirty)'
    );
    expect(source).toContain(
      "onDirtyChange={onAdministratorManagementDirtyChange}"
    );
    expect(source).toContain(
      'window.addEventListener("beforeunload", beforeUnload)'
    );
  });
  it("普通管理业务映射不包含管理员账号治理路径", () => {
    expect(getManagementModulePath("ADMINISTRATORS")).toBeNull();
    expect(getScopedPcAdminSection("ADMINISTRATORS")).toBeNull();
    expect(getScopedPcAdminSection("administrators")).toBeNull();
    expect(rootRouter).toContain(
      "administratorManagement: administratorManagementRouter"
    );
  });
});
