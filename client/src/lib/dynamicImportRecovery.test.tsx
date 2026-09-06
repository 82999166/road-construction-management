import { describe, expect, it } from "vitest";
import { canRecoverDynamicImport, isDynamicImportLoadError } from "./dynamicImportRecovery";

describe("动态分包加载失败恢复", () => {
  it("识别主流浏览器的哈希分包加载错误，而不把普通业务错误当成刷新条件", () => {
    expect(isDynamicImportLoadError(new TypeError("Failed to fetch dynamically imported module: https://yx.maomaoyx.com/assets/Home-old.js"))).toBe(true);
    expect(isDynamicImportLoadError(new Error("Importing a module script failed."))).toBe(true);
    expect(isDynamicImportLoadError(new Error("Loading chunk 42 failed."))).toBe(true);
    expect(isDynamicImportLoadError(new Error("当前项目无访问权限"))).toBe(false);
  });

  it("仅允许 60 秒后再次执行恢复，避免网络异常时循环刷新", () => {
    expect(canRecoverDynamicImport(0, 1_000)).toBe(true);
    expect(canRecoverDynamicImport(1_000, 60_999)).toBe(false);
    expect(canRecoverDynamicImport(1_000, 61_000)).toBe(true);
  });
});
