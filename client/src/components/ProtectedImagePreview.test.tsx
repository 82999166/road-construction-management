import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("受控上传照片站内预览", () => {
  const source = readFileSync(new URL("./ProtectedImagePreview.tsx", import.meta.url), "utf8");

  it("根据受控MIME或安全文件名识别图片，并以站内img预览", () => {
    expect(source).toContain('mimeType.startsWith("image/")');
    expect(source).toContain("IMAGE_FILE_NAME_PATTERN");
    expect(source).toContain('<img\n                src={file.url}');
    expect(source).toContain("站内原图预览，不触发下载");
    expect(source).toContain("站内预览图片：${fileName}");
  });

  it("仅对非图片保留浏览器原生打开，避免将PDF误作为空白图片展示", () => {
    expect(source).toContain("if (!image)");
    expect(source).toContain('target="_blank"');
    expect(source).toContain("PDF 等非图片文件维持浏览器原生受控打开");
  });
});
