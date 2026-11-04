import { describe, expect, it, vi } from "vitest";
import {
  collectUnloadLocation,
  resolvePhotoUnloadLocation,
} from "./transportUnloadLocation";
const failed = {
  getCurrentPosition: vi.fn((_: any, reject: any) =>
    reject({ code: 1, message: "private/native failure" })
  ),
};
describe("拍照卸土与定位设置一致", () => {
  it.each([true, false, undefined])(
    "模式%s定位成功保留真实坐标并请求高精度",
    async enabled => {
      const geo = {
        getCurrentPosition: vi.fn((resolve: any) =>
          resolve({ coords: { latitude: 30, longitude: 120 } })
        ),
      };
      await expect(resolvePhotoUnloadLocation(enabled, geo)).resolves.toEqual({
        latitude: 30,
        longitude: 120,
      });
      expect(geo.getCurrentPosition).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Function),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
      );
    }
  );
  it("NFC请求最新位置，定位失败不伪造坐标且交由服务端应用硬拦截规则", async () => {
    await expect(collectUnloadLocation(failed, 0)).resolves.toBeNull();
    expect(failed.getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
  it("明确关闭硬拦截后定位拒绝返回null，不伪造0经纬度", async () => {
    await expect(resolvePhotoUnloadLocation(false, failed)).resolves.toBeNull();
  });
  it("关闭且设备无定位能力允许待核验提交", async () => {
    await expect(
      resolvePhotoUnloadLocation(false, undefined)
    ).resolves.toBeNull();
  });
  it.each([true, undefined])(
    "开启/未知%s定位拒绝或设备缺失时不得提交",
    async enabled => {
      await expect(resolvePhotoUnloadLocation(enabled, failed)).rejects.toThrow(
        "不会确认卸土"
      );
      await expect(
        resolvePhotoUnloadLocation(enabled, undefined)
      ).rejects.toThrow("不会确认卸土");
    }
  );
  it("定位API同步异常仍按开关处理且不泄露原生错误", async () => {
    const geo = {
      getCurrentPosition: vi.fn(() => {
        throw new Error("sensitive");
      }),
    };
    await expect(resolvePhotoUnloadLocation(false, geo)).resolves.toBeNull();
    await expect(resolvePhotoUnloadLocation(true, geo)).rejects.toThrow(
      "定位硬拦截"
    );
  });
  it("非有效坐标不被当成真实位置", async () => {
    const geo = {
      getCurrentPosition: vi.fn((resolve: any) =>
        resolve({ coords: { latitude: NaN, longitude: 120 } })
      ),
    };
    await expect(resolvePhotoUnloadLocation(false, geo)).resolves.toBeNull();
    await expect(resolvePhotoUnloadLocation(true, geo)).rejects.toThrow();
  });
});
