import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./AdminPage.tsx", import.meta.url), "utf8");

describe("超级管理员系统设置和菜单结构", () => {
  it("在系统设置中提供加密 OSS 表单且不在输入值中回显密钥", () => {
    expect(source).toContain("阿里云 OSS 照片存储");
    expect(source).toContain("getAliyunOssPhotoStorageConfiguration");
    expect(source).toContain("saveAliyunOssPhotoStorageConfiguration");
    expect(source).toContain('type="password" value={aliyunOssPhotoStorageForm.accessKeyId}');
    expect(source).toContain('type="password" value={aliyunOssPhotoStorageForm.accessKeySecret}');
    expect(source).toContain('setAliyunOssPhotoStorageForm(current => ({ ...current, accessKeyId: "", accessKeySecret: "" }))');
  });

  it("将权限管理下移至平台治理并按运营类别分组", () => {
    expect(source).toContain('{ icon: UsersRound, label: "权限管理", path: "/admin/permission", section: "平台治理" }');
    expect(source).toContain('section: "经营业务"');
    expect(source).toContain('section: "资源与现场"');
    expect(source).toContain('section: "业财结算"');
    expect(source).toContain('section: "风险与通知"');
  });

  it("将低频配置清单放入可折叠设置组而不移除原有回滚入口", () => {
    expect(source).toContain("function SettingsDisclosure");
    expect(source).toContain("配置清单、版本与回滚");
    expect(source).toContain("配置版本与安全回滚");
  });
});
