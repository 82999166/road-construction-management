import { describe, expect, it, vi } from "vitest";
import {
  isDashboardMenuActive,
  requestDashboardNavigation,
} from "./dashboardNavigation";

describe("统一PC后台侧栏导航", () => {
  it("后台首页不会抢占业务页标题或同时高亮", () => {
    expect(isDashboardMenuActive("/admin", "/admin")).toBe(true);
    expect(isDashboardMenuActive("/admin/construction", "/admin")).toBe(false);
    expect(
      isDashboardMenuActive(
        "/admin/construction?date=2026-11-04",
        "/admin/construction"
      )
    ).toBe(true);
    expect(
      isDashboardMenuActive("/admin/construction/42", "/admin/construction")
    ).toBe(true);
    expect(
      isDashboardMenuActive("/admin/contracts-old", "/admin/contracts")
    ).toBe(false);
  });
  it("拒绝放弃草稿时不会写入路由", () => {
    const navigate = vi.fn();
    const guard = vi.fn(() => false);
    expect(
      requestDashboardNavigation(
        "/admin/administrators",
        "/admin/finance",
        navigate,
        guard
      )
    ).toBe(false);
    expect(guard).toHaveBeenCalledWith("/admin/finance");
    expect(navigate).not.toHaveBeenCalled();
  });
  it("同页点击不询问，确认放弃或无草稿才导航", () => {
    const navigate = vi.fn();
    const guard = vi.fn(() => true);
    expect(
      requestDashboardNavigation("/admin", "/admin", navigate, guard)
    ).toBe(false);
    expect(guard).not.toHaveBeenCalled();
    expect(
      requestDashboardNavigation("/admin", "/admin/transport", navigate, guard)
    ).toBe(true);
    expect(navigate).toHaveBeenCalledWith("/admin/transport");
    expect(
      requestDashboardNavigation("/admin/transport", "/admin", navigate)
    ).toBe(true);
  });
});
