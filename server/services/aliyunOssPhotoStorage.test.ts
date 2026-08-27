import { describe, expect, it } from "vitest";
import { isAliyunOssPhotoStorageKey, normalizeAliyunOssBucket, normalizeAliyunOssEndpoint, normalizeAliyunOssObjectPrefix, normalizeAliyunOssRegion } from "./aliyunOssPhotoStorage";

describe("阿里云 OSS 照片存储配置约束", () => {
  it("规范化公开 HTTPS OSS 配置和安全对象前缀", () => {
    expect(normalizeAliyunOssRegion(" OSS-CN-HANGZHOU ")).toBe("oss-cn-hangzhou");
    expect(normalizeAliyunOssEndpoint("https://oss-cn-hangzhou.aliyuncs.com/")).toBe("https://oss-cn-hangzhou.aliyuncs.com");
    expect(normalizeAliyunOssBucket("Project-Photo-Archive")).toBe("project-photo-archive");
    expect(normalizeAliyunOssObjectPrefix("/road/photos/")).toBe("road/photos");
  });

  it("拒绝内网 Endpoint、非法 Bucket 和目录穿越前缀", () => {
    expect(() => normalizeAliyunOssEndpoint("http://oss-cn-hangzhou.aliyuncs.com")).toThrow("公开 HTTPS");
    expect(() => normalizeAliyunOssEndpoint("https://127.0.0.1")).toThrow("公开 HTTPS");
    expect(() => normalizeAliyunOssBucket("Invalid_Bucket")).toThrow("Bucket");
    expect(() => normalizeAliyunOssObjectPrefix("photos/../private")).toThrow("对象前缀");
  });

  it("仅将显式 OSS 前缀的影像键定向至 OSS 私有预览", () => {
    expect(isAliyunOssPhotoStorageKey("aliyun-oss/photos/evidence/photo.jpg")).toBe(true);
    expect(isAliyunOssPhotoStorageKey("evidence/project/photo.jpg")).toBe(false);
  });
});
