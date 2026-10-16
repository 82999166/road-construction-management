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
    expect(source).toContain("testAliyunOssPhotoStorageConnection");
    expect(source).toContain("测试 OSS 连接");
    expect(source).toContain("只读取保留探测对象元数据");
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

  it("将系统设置按业务参数、接口通知和配置治理分类切换", () => {
    expect(source).toContain('type SettingsCategory = "business" | "integrations" | "governance"');
    expect(source).toContain('value="business"');
    expect(source).toContain('value="integrations"');
    expect(source).toContain('value="governance"');
    expect(source).toContain("系统设置分类");
    expect(source).toContain('settingsCategory !== "governance"');
    expect(source).toContain('settingsCategory !== "business"');
  });

  it("将车辆维护与司机绑定的未知状态安全回退为中文", () => {
    expect(source).toContain("getBusinessStatusLabel(item.status)");
    expect(source).toContain("statusLabel[item.bindingStatus] ?? getBusinessStatusLabel(item.bindingStatus)");
    expect(source).not.toContain("statusLabel[item.bindingStatus] ?? item.bindingStatus");
  });

  it("将项目层级状态经共享中文工具展示", () => {
    expect(source).toContain('上级：{item.parentId ? projects.data?.find(project => project.id === item.parentId)?.name ?? `#${item.parentId}` : "顶级"} · {getBusinessStatusLabel(item.status)}');
  });
});
