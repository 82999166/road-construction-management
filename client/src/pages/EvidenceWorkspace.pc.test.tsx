import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, name: "取证管理员" },
    isAuthenticated: true,
    loading: false,
    authLoadingTimedOut: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/admin/evidence", vi.fn()] }));
const query = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
});
function mutation() {
  return {
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
  };
}
vi.mock("@/lib/trpc", () => ({
  trpc: {
    evidence: {
      projectOptions: { useQuery: () => query([{ id: 11, name: "授权项目" }]) },
      captureConfig: {
        useQuery: () =>
          query({
            camera: { enabled: true },
            location: { enabled: true, required: false },
          }),
      },
      list: {
        useQuery: () =>
          query([
            {
              id: 23,
              capturedAt: "2026-11-05T01:00:00.000Z",
              sourceType: "site_photo",
              sourceId: null,
              description: "受控现场取证摘要",
              canDelete: false,
            },
          ]),
      },
      upload: { useMutation: mutation },
      ocr: { useMutation: mutation },
      delete: { useMutation: mutation },
    },
    location: { reverseGeocode: { useMutation: mutation } },
  },
}));

import MobileEvidencePage, { EvidenceWorkspace } from "./MobileEvidencePage";

describe("取证PC工作区与手机入口隔离", () => {
  it("PC显示宽版双栏、真实归档和台账组件，不能出现手机返回或底栏", () => {
    const html = renderToStaticMarkup(<EvidenceWorkspace mode="pc" />);
    expect(html).toContain('data-pc-management-module="EVIDENCE"');
    expect(html).toContain("lg:grid-cols-2");
    expect(html).toContain("现场取证 · PC 业务工作区");
    expect(html).toContain("归属项目");
    expect(html).toContain("受控现场取证摘要");
    expect(html).toContain("最近取证");
    expect(html).toContain("归档");
    expect(html).not.toContain("max-w-xl");
    expect(html).not.toContain("返回移动工作台");
    expect(html).not.toContain("mobile-bottom-navigation");
    expect(html).not.toContain('capture="environment"');
  });

  it("手机独立入口保留拍照与移动导航，不受PC映射影响", () => {
    const html = renderToStaticMarkup(<MobileEvidencePage />);
    expect(html).toContain("返回移动工作台");
    expect(html).toContain("mobile-bottom-navigation");
    expect(html).toContain("max-w-xl");
    expect(html).toContain('capture="environment"');
    expect(html).not.toContain('data-pc-management-module="EVIDENCE"');
  });
});
