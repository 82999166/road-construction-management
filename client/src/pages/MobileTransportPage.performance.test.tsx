import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("移动运输页首屏依赖", () => {
  it("仅在用户主动打开刷卡发票时加载 NFC 模块，并提供弱网加载与失败提示", () => {
    const source = readFileSync(new URL("./MobileTransportPage.tsx", import.meta.url), "utf8");

    expect(source).toContain('lazy(() => import("@/components/MobileNfcTransportInvoice")');
    expect(source).toContain("mobileNfcInvoiceOpen ? <NfcInvoiceLoadBoundary");
    expect(source).toContain("<Suspense fallback={<NfcInvoiceLoadingDialog");
    expect(source).toContain("刷卡发票页面加载失败");
    expect(source).toContain('lazy(() => import("@/components/TransportRouteSafetySettings")');
    expect(source).toContain("isSuperAdmin ? <section");
    expect(source).toContain("<TransportRouteSafetySettings projectId={selectedProjectId} compact />");
    expect(source).toContain("普通运输管理员不会显示此入口");
    expect(source).toContain("正在加载运输安全设置…");
  });

  it("将项目授权查询失败与确无授权项目区分展示，避免网络错误被误判为权限缺失", () => {
    const source = readFileSync(new URL("./MobileTransportPage.tsx", import.meta.url), "utf8");

    expect(source).toContain("projectOptions.isError ? <Card");
    expect(source).toContain("项目授权加载失败");
    expect(source).toContain("这不等同于没有项目权限");
    expect(source).toContain("!projectOptions.data?.length ? <Card");
    expect(source).toContain("重新获取授权项目");
  });
});
