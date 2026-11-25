import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_TAKEOFF_PHOTO_BYTES, readTakeoffPhoto, TAKEOFF_DIALOG_LAYOUT, takeoffCoordinates } from "./TakeoffPhotos";
function file(bytes: number[], type: string, size = bytes.length): File {
  return { type, size, name: "site.png", slice: () => ({ arrayBuffer: async () => new Uint8Array(bytes).buffer }) } as File;
}
beforeEach(() => {
  vi.stubGlobal("FileReader", class { result: string | null = null; onload?: () => void; onerror?: () => void; readAsDataURL() { this.result = "data:image/png;base64,validated-file-bytes"; this.onload?.(); } });
});
afterEach(() => vi.unstubAllGlobals());
describe("收方图片真实文件与局部布局", () => {
  it("真实JPEG魔数允许上传，返回正确mime与原bytes编码", async () => {
    expect(await readTakeoffPhoto(file([255, 216, 255, 224], "image/jpeg"))).toEqual({ mimeType: "image/jpeg", base64Data: "validated-file-bytes" });
  });
  it("真实PNG完整八字节签名允许上传", async () => {
    expect(await readTakeoffPhoto(file([137, 80, 78, 71, 13, 10, 26, 10], "image/png"))).toEqual({ mimeType: "image/png", base64Data: "validated-file-bytes" });
  });
  it.each([
    [[60, 104, 116, 109, 108], "image/png"], [[255, 216, 255], "image/png"],
    [[137, 80, 78, 71, 13, 10, 26, 10], "image/jpeg"], [[137, 80, 78, 71], "image/png"],
  ])("假后缀或不匹配签名拒绝：%s/%s", async (bytes, type) => {
    await expect(readTakeoffPhoto(file(bytes as number[], type as string))).rejects.toThrow("内容");
  });
  it("不接受GIF/SVG/HEIC或空文件", async () => {
    for (const type of ["image/gif", "image/svg+xml", "image/heic", ""]) await expect(readTakeoffPhoto(file([255, 216, 255], type))).rejects.toThrow("JPEG / PNG");
    await expect(readTakeoffPhoto(file([], "image/png"))).rejects.toThrow("非空");
  });
  it("8MB边界允许，超过8MB拒绝且无需读bytes", async () => {
    await expect(readTakeoffPhoto(file([255, 216, 255], "image/jpeg", MAX_TAKEOFF_PHOTO_BYTES))).resolves.toHaveProperty("mimeType", "image/jpeg");
    await expect(readTakeoffPhoto(file([255, 216, 255], "image/jpeg", MAX_TAKEOFF_PHOTO_BYTES + 1))).rejects.toThrow("8MB");
  });
  it("FileReader失败明确拒绝", async () => {
    vi.stubGlobal("FileReader", class { onerror?: () => void; readAsDataURL() { this.onerror?.(); } });
    await expect(readTakeoffPhoto(file([255, 216, 255], "image/jpeg"))).rejects.toThrow("读取失败");
  });
  it("不要求定位时不伪造坐标；要求时取新鲜真定位", async () => {
    expect(await takeoffCoordinates(false)).toBeUndefined();
    const getCurrentPosition = vi.fn((success: (position: unknown) => void, _error: unknown, _options: unknown) => success({ coords: { longitude: 112.3, latitude: 28.2 } }));
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
    expect(await takeoffCoordinates(true)).toEqual({ longitude: 112.3, latitude: 28.2 });
    expect(getCurrentPosition.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
  it("要求定位而无设备、拒绝或非有限值时拒绝", async () => {
    vi.stubGlobal("navigator", {}); await expect(takeoffCoordinates(true)).rejects.toThrow("不支持");
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: (_success: unknown, reject: () => void) => reject() } }); await expect(takeoffCoordinates(true)).rejects.toThrow("真实定位");
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: (success: (p: unknown) => void) => success({ coords: { longitude: Infinity, latitude: NaN } }) } }); await expect(takeoffCoordinates(true)).rejects.toThrow("有效真实定位");
  });
  it("本轮弹窗固定高度、PC大窗口、内滚动不使用底部滑入", () => {
    expect(TAKEOFF_DIALOG_LAYOUT).toContain("h-[min(90dvh,900px)]"); expect(TAKEOFF_DIALOG_LAYOUT).toContain("flex-col");
    expect(TAKEOFF_DIALOG_LAYOUT).toContain("overflow-hidden"); expect(TAKEOFF_DIALOG_LAYOUT).toContain("sm:max-w-5xl");
    expect(TAKEOFF_DIALOG_LAYOUT).toContain("data-[state=open]:animate-none"); expect(TAKEOFF_DIALOG_LAYOUT).toContain("data-[state=closed]:animate-none");
    expect(TAKEOFF_DIALOG_LAYOUT).not.toMatch(/slide|bottom/);
  });
});
