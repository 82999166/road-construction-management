import { afterEach, describe, expect, it } from "vitest";
import { clearMobileDraft, hasMobileDraftContent, readMobileDraft, saveMobileDraft } from "./mobileDraftStorage";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const originalWindow = globalThis.window;

afterEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
});

function installStorage() {
  const localStorage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } });
  return localStorage;
}

describe("移动端设备本机草稿", () => {
  it("仅保存允许的文字和数值字段，不落地敏感信息、附件、照片或定位", () => {
    const storage = installStorage();

    expect(saveMobileDraft("construction", {
      workArea: "K12+500 填筑作业面",
      quantity: "12.5",
      phone: "13800000000",
      bankAccount: "6222020000000000",
      identityNo: "430000000000000000",
      evidenceId: "77",
      receiptNo: "R-001",
      latitude: 28.1,
      photoFile: { name: "现场照片.jpg" },
      nested: { remarks: "已完成" },
    })).toBe(true);

    const raw = storage.getItem("yx-mobile-draft:v1:construction") ?? "";
    expect(raw).toContain("K12+500");
    expect(raw).toContain("12.5");
    expect(raw).not.toContain("13800000000");
    expect(raw).not.toContain("6222020000000000");
    expect(raw).not.toContain("430000000000000000");
    expect(raw).not.toContain("R-001");
    expect(raw).not.toContain("现场照片");
    expect(raw).not.toContain("28.1");

    expect(readMobileDraft<{ workArea: string; quantity: string }>("construction")?.value).toEqual({
      workArea: "K12+500 填筑作业面",
      quantity: "12.5",
      nested: { remarks: "已完成" },
    });
  });

  it("拒绝已过期草稿并在清理后不再恢复", () => {
    const storage = installStorage();
    storage.setItem("yx-mobile-draft:v1:expired", JSON.stringify({ version: 1, savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000, value: { remarks: "旧内容" } }));

    expect(readMobileDraft("expired")).toBeNull();
    expect(storage.getItem("yx-mobile-draft:v1:expired")).toBeNull();

    saveMobileDraft("active", { remarks: "可恢复内容" });
    expect(readMobileDraft("active")?.value).toEqual({ remarks: "可恢复内容" });
    clearMobileDraft("active");
    expect(readMobileDraft("active")).toBeNull();
  });

  it("能区分默认值和用户实际填写内容，避免无修改时误弹退出提示", () => {
    expect(hasMobileDraftContent({ reportDate: "2026-11-01", weather: "other", progressPercent: "0" }, ["reportDate", "weather", "progressPercent"])).toBe(false);
    expect(hasMobileDraftContent({ reportDate: "2026-11-01", workContent: "完成路基压实" }, ["reportDate"])).toBe(true);
    expect(hasMobileDraftContent({ phone: "13800000000" })).toBe(false);
  });
});
