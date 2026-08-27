import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "client/src/pages/MobileEvidencePage.tsx"), "utf8");

describe("MobileEvidencePage 用户可见错误与时间投影", () => {
  it("不直接展示查询错误原文，并为三类查询提供中文重试入口", () => {
    expect(source).not.toContain("projectOptions.error.message");
    expect(source).not.toContain("captureConfig.error.message");
    expect(source).not.toContain("evidence.error.message");
    expect(source).toContain("重新获取授权项目");
    expect(source).toContain("重新获取采集配置");
    expect(source).toContain("重新加载影像台账");
    expect(source).toContain("!projectOptions.error && !projectOptions.data?.length");
  });

  it("归档时间和水印预览统一使用中国时区工具，上传仍传递 UTC 时间戳", () => {
    expect(source).toContain('import { formatChinaDateTime } from "@/lib/businessTime"');
    expect(source).toContain("formatChinaDateTime(date)");
    expect(source).toContain("formatChinaDateTime(new Date())");
    expect(source).toContain("capturedAt: capturedAt.toISOString()");
  });
});
