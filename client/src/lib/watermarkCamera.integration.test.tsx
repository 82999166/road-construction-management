import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatWatermarkCoordinates } from "./watermarkCoordinates";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const construction = read("../pages/MobileConstructionPage.tsx");
const evidence = read("../pages/MobileEvidencePage.tsx");
const diesel = read("../pages/MobileDieselPage.tsx");
const workspace = read("../components/ConstructionWorkspace.tsx");
const preview = read("../components/EngineeringWatermarkPreview.tsx");

describe("水印相机完整链路", () => {
  it.each([null, undefined, { longitude: NaN, latitude: 28 }, { longitude: 115, latitude: Infinity }, { longitude: 181, latitude: 28 }, { longitude: 115, latitude: -91 }])("缺失或非法定位不伪造有效坐标：%j", value => {
    expect(formatWatermarkCoordinates(value)).toBe("经纬度：未取得");
  });
  it("真实采集经纬度按六位显示，保留合法零和南西半球，不改变原数据精度", () => {
    const value = { longitude: 115.12345678, latitude: 28.12345678 };
    expect(formatWatermarkCoordinates(value)).toBe("经纬度：115.123457, 28.123457");
    expect(value.longitude).toBe(115.12345678);
    expect(formatWatermarkCoordinates({ longitude: 0, latitude: 0 })).toBe("经纬度：0.000000, 0.000000");
    expect(formatWatermarkCoordinates({ longitude: -180, latitude: -90 })).toBe("经纬度：-180.000000, -90.000000");
  });
  it.each([construction, evidence, diesel])("三种采集均只调用共享生成器，没有旧厚卡片独立算法", source => {
    expect(source).toContain("return createEngineeringWatermarkedImage(file, watermarkLines, template");
    const wrapper = source.match(/function createWatermarked(?:Diesel)?Image\([^]*?\n\}/)?.[0];
    expect(wrapper).toBeDefined();
    expect(wrapper).not.toContain('document.createElement("canvas")');
    expect(source).not.toContain("watermarkLines.filter(Boolean).slice(0, 8)");
    expect(source).not.toMatch(/coordinates:\s*`详细地点/);
    expect(source).toContain("formatWatermarkCoordinates(");
    expect(source).toContain("capturedAt.toISOString()");
  });
  it("施工和主管审核的旧图缩略图均完整显示，按钮为竖向整块而非横向flex", () => {
    expect(workspace).toContain('className="block w-full min-w-0 rounded-lg border p-2"');
    expect(workspace).toContain("aspect-[4/3] w-full rounded bg-slate-100 object-contain");
    expect(construction).toContain("aspect-[4/3] w-full bg-slate-100 object-contain");
    expect(construction).toContain('className="block w-full min-w-0 overflow-hidden');
    expect(construction).not.toContain("object-cover");
    expect(workspace).not.toContain("object-cover");
  });
  it("现场预览全部选中字段，与最终图使用同一绘制器，时间与编号不伪称拍摄值", () => {
    expect(evidence).toContain("<EngineeringWatermarkPreview");
    expect(evidence).toContain("lines={watermarkTemplate.fields.map(field");
    expect(evidence).not.toContain("watermarkTemplate.fields.slice(0, 4)");
    expect(evidence).toContain('capturedAt: "记录时间：归档时记录"');
    expect(evidence).toContain('antiCounterfeit: "防伪编号：归档时生成"');
    expect(preview).toContain("drawEngineeringWatermark(context, canvas.width, canvas.height, data.lines, data.template)");
    expect(preview).toContain("if (disposed) return;");
    expect(preview).toContain("image.onload = null; image.onerror = null;");
  });
  it("保留相册和相机来源、8MB/12张及失败重试保护，不增加下载入口", () => {
    expect(construction).toMatch(/accept="image\/\*"\s+capture="environment"/);
    expect(construction).toContain("从手机相册选择");
    expect(construction).toContain("日报已保存，照片尚未归档");
    expect(evidence).toContain('capture={mode === "mobile" ? "environment" : undefined}');
    expect(evidence).toContain("8 * 1024 * 1024");
    expect(evidence).toContain("slice(0, 12)");
    expect(workspace).toContain("ProtectedImagePreview");
    expect(preview).not.toContain("toDataURL");
    expect(preview).not.toContain("toBlob");
  });
});
