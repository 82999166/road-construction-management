import { File as NodeFile } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EVIDENCE_WATERMARK_TEMPLATE } from "../../../shared/watermarkTemplate";
import {
  createEngineeringWatermarkedImage,
  drawEngineeringWatermark,
  planEngineeringWatermarkLayout,
  type EngineeringWatermarkLayout,
  type EngineeringWatermarkPosition,
  type EngineeringWatermarkTemplate,
} from "./engineeringWatermark";

const template: EngineeringWatermarkTemplate = {
  ...DEFAULT_EVIDENCE_WATERMARK_TEMPLATE,
};
const fields = [
  "拍摄时间：2026-11-23 08:09:35 北京时间",
  "施工负责人：张建国",
  "天气：多云 18℃",
  "地点：公路改扩建工程一号施工区",
  "经纬度：31.230416, 121.473701",
  "施工单位：悦信工程建设有限公司",
  "项目名称：道路改扩建工程一期",
  "防伪标识：YX-20261123-080935-A9BC2D8EF001",
];

/** Canvas-like advance widths, top-baseline glyph bearings, and state stack. */
function makeContext() {
  const state = {
    font: "10px sans-serif",
    textBaseline: "alphabetic" as CanvasTextBaseline,
    textAlign: "right" as CanvasTextAlign,
    fillStyle: "#123456",
    globalAlpha: 0.4,
    globalCompositeOperation: "multiply",
    shadowBlur: 4,
    shadowOffsetX: 2,
    shadowOffsetY: 3,
  };
  const snapshots: (typeof state)[] = [];
  const texts: {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    baseline: CanvasTextBaseline;
    align: CanvasTextAlign;
    args: unknown[];
  }[] = [];
  const rects: { x: number; y: number; width: number; height: number }[] = [];
  const ctx = {
    ...state,
    save: vi.fn(() => {
      snapshots.push(
        Object.fromEntries(
          Object.keys(state).map(key => [key, ctx[key as keyof typeof state]])
        ) as typeof state
      );
    }),
    restore: vi.fn(() => Object.assign(ctx, snapshots.pop())),
    measureText: vi.fn((text: string) => {
      const fontSize = Number(ctx.font.match(/([\d.]+)px/)?.[1] ?? 10);
      const width = Array.from(text).reduce(
        (total, character) =>
          total + fontSize * (/^[\x00-\x7f]$/.test(character) ? 0.58 : 1),
        0
      );
      return {
        width,
        actualBoundingBoxLeft: text ? fontSize * 0.025 : 0,
        actualBoundingBoxRight: width,
        actualBoundingBoxAscent:
          ctx.textBaseline === "top" ? -fontSize * 0.12 : fontSize * 0.8,
        actualBoundingBoxDescent:
          ctx.textBaseline === "top" ? fontSize * 1.08 : fontSize * 0.2,
      } as TextMetrics;
    }),
    fillText: vi.fn((...args: [string, number, number, number?]) => {
      const [text, x, y] = args;
      const metrics = ctx.measureText(text);
      texts.push({
        text,
        x: x - metrics.actualBoundingBoxLeft,
        y,
        width:
          metrics.actualBoundingBoxLeft +
          Math.max(metrics.width, metrics.actualBoundingBoxRight),
        height: metrics.actualBoundingBoxDescent,
        baseline: ctx.textBaseline,
        align: ctx.textAlign,
        args,
      });
    }),
    fillRect: vi.fn((x: number, y: number, width: number, height: number) =>
      rects.push({ x, y, width, height })
    ),
    drawImage: vi.fn(),
  };
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    raw: ctx,
    texts,
    rects,
    state,
  };
}

function assertBounds(
  layout: EngineeringWatermarkLayout,
  width: number,
  height: number
) {
  expect(layout.x).toBeGreaterThanOrEqual(layout.margin - 1e-7);
  expect(layout.y).toBeGreaterThanOrEqual(layout.margin - 1e-7);
  expect(layout.x + layout.width).toBeLessThanOrEqual(
    width - layout.margin + 1e-7
  );
  expect(layout.y + layout.height).toBeLessThanOrEqual(
    height - layout.margin + 1e-7
  );
  expect(layout.height).toBeLessThanOrEqual(height * 0.38);
  for (const text of layout.texts) {
    expect(text.bounds.x).toBeGreaterThanOrEqual(
      layout.x + layout.padding - 1e-7
    );
    expect(text.bounds.y).toBeGreaterThanOrEqual(
      layout.y + layout.padding - 1e-7
    );
    expect(text.bounds.x + text.bounds.width).toBeLessThanOrEqual(
      layout.x + layout.width - layout.padding + 1e-7
    );
    expect(text.bounds.y + text.bounds.height).toBeLessThanOrEqual(
      layout.y + layout.height - layout.padding + 1e-7
    );
    expect(text.fontSize).toBeGreaterThanOrEqual(12);
  }
}

function content(
  layout: EngineeringWatermarkLayout,
  role: "title" | "field" | "footer"
) {
  return layout.texts
    .filter(text => text.role === role)
    .map(text => text.text)
    .join("");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("engineering watermark layout and drawing", () => {
  const positions: EngineeringWatermarkPosition[] = [
    "bottom_left",
    "bottom_right",
    "top_left",
    "top_right",
  ];
  for (const [width, height] of [
    [1200, 1600],
    [1600, 900],
    [1000, 1000],
  ]) {
    for (const position of positions) {
      it(`keeps all pixels and padding inside ${width}×${height} at ${position}`, () => {
        const { ctx, raw, texts, rects, state } = makeContext();
        const layout = drawEngineeringWatermark(ctx, width, height, fields, {
          ...template,
          position,
        });
        assertBounds(layout, width, height);
        expect(content(layout, "field")).toBe(fields.join(""));
        expect(content(layout, "title")).toBe(template.title);
        expect(content(layout, "footer")).toBe(template.footerLabel);
        expect(layout.margin).toBe(Math.min(width, height) * 0.02);
        expect(
          position.endsWith("right") ? layout.x + layout.width : layout.x
        ).toBeCloseTo(
          position.endsWith("right") ? width - layout.margin : layout.margin
        );
        expect(
          position.startsWith("top") ? layout.y : layout.y + layout.height
        ).toBeCloseTo(
          position.startsWith("top") ? layout.margin : height - layout.margin
        );
        for (const text of texts) {
          expect(text.baseline).toBe("top");
          expect(text.align).toBe("left");
          expect(text.args).toHaveLength(3);
          expect(text.x).toBeGreaterThanOrEqual(
            layout.x + layout.padding - 1e-7
          );
          expect(text.x + text.width).toBeLessThanOrEqual(
            layout.x + layout.width - layout.padding + 1e-7
          );
          expect(text.y).toBeGreaterThanOrEqual(
            layout.y + layout.padding - 1e-7
          );
          expect(text.y + text.height).toBeLessThanOrEqual(
            layout.y + layout.height - layout.padding + 1e-7
          );
        }
        for (const rect of rects) {
          expect(rect.x).toBeGreaterThanOrEqual(0);
          expect(rect.y).toBeGreaterThanOrEqual(0);
          expect(rect.x + rect.width).toBeLessThanOrEqual(width);
          expect(rect.y + rect.height).toBeLessThanOrEqual(height);
        }
        for (const [key, value] of Object.entries(state))
          expect(raw[key as keyof typeof state]).toBe(value);
        expect(raw.save).toHaveBeenCalledTimes(2);
        expect(raw.restore).toHaveBeenCalledTimes(2);
      });
    }
  }

  it("defaults historical templates to compact bottom-left and a small card", () => {
    const { ctx } = makeContext();
    const layout = planEngineeringWatermarkLayout(
      ctx,
      1600,
      900,
      fields,
      template
    );
    const explicit = planEngineeringWatermarkLayout(ctx, 1600, 900, fields, {
      ...template,
      position: "bottom_left",
      size: "compact",
    } as EngineeringWatermarkTemplate);
    expect(layout).toEqual(explicit);
    expect(layout.fontSize).toBeCloseTo(900 / 56);
    expect(layout.height / 900).toBeGreaterThanOrEqual(0.22);
    expect(layout.height / 900).toBeLessThanOrEqual(0.3);
    expect(layout.width).toBeLessThanOrEqual(1600 * 0.55);
  });

  it("supports standard sizing without overflowing", () => {
    const { ctx } = makeContext();
    const layout = planEngineeringWatermarkLayout(ctx, 1200, 1600, fields, {
      ...template,
      size: "standard",
    } as EngineeringWatermarkTemplate);
    assertBounds(layout, 1200, 1600);
    expect(layout.fontSize).toBeCloseTo(1200 / 48);
    expect(layout.width).toBeLessThanOrEqual(1200 * 0.72);
  });

  it("wraps complete long Chinese fields, exact dates, anti-counterfeit ID, title and footer", () => {
    const { ctx } = makeContext();
    const longFields = [
      "地点：" + "山西省高速公路改扩建工程第二合同段道路施工现场".repeat(3),
      fields[0],
      "防伪标识：YX-20261123-080935-" + "0123456789ABCDEF".repeat(6),
      "现场记录：👷施工🚧验收📍定位，坐标未修改",
    ];
    const longTemplate = {
      ...template,
      title: "道路工程施工现场完整取证信息与安全巡查记录".repeat(2),
      footerLabel:
        "防伪水印 · 真实时间 · 元数据与原始定位完整留存供审计查验".repeat(2),
    };
    const layout = drawEngineeringWatermark(
      ctx,
      1400,
      2000,
      longFields,
      longTemplate
    );
    assertBounds(layout, 1400, 2000);
    expect(content(layout, "field")).toBe(longFields.join(""));
    expect(content(layout, "title")).toBe(longTemplate.title);
    expect(content(layout, "footer")).toBe(longTemplate.footerLabel);
    expect(
      layout.texts.filter(text => text.role === "title").length
    ).toBeGreaterThan(1);
    expect(
      layout.texts.filter(text => text.role === "footer").length
    ).toBeGreaterThan(1);
    for (const row of layout.texts)
      expect(row.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
  });

  it("does not slice the ninth or later fields; only deduplicates identical full lines", () => {
    const { ctx } = makeContext();
    const lines = [
      ...fields,
      "第九字段：检查通过",
      "第十字段：编号保留",
      fields[3],
      "地点：公路改扩建工程二号施工区",
      "",
      "   ",
    ];
    const layout = planEngineeringWatermarkLayout(
      ctx,
      1400,
      2000,
      lines,
      template
    );
    expect(content(layout, "field")).toBe(
      [...fields, lines[8], lines[9], lines[11]].join("")
    );
    expect(content(layout, "field")).toContain("第十字段");
    expect(content(layout, "field")).toContain("二号施工区");
  });

  it("preserves field spaces and explicit newlines without losing code points", () => {
    const { ctx } = makeContext();
    const lines = [
      "  地点：工区  ",
      "记录：第一行\n第二行👷",
      "时间：2026-11-23\r\n08:09:35",
    ];
    const layout = planEngineeringWatermarkLayout(
      ctx,
      1200,
      1600,
      lines,
      template
    );
    expect(content(layout, "field")).toBe(
      lines.join("").replace(/\r\n?/g, "\n").replace(/\n/g, "")
    );
  });

  it("uses finite small font reductions when content needs extra rows", () => {
    const { ctx } = makeContext();
    const lines = Array.from(
      { length: 15 },
      (_, i) => `现场检查字段${i + 1}：正常`
    );
    const layout = planEngineeringWatermarkLayout(
      ctx,
      1600,
      900,
      lines,
      template
    );
    assertBounds(layout, 1600, 900);
    expect(layout.fontSize).toBeLessThan(900 / 56);
    expect(layout.fontSize).toBeGreaterThanOrEqual(12);
    expect(content(layout, "field")).toBe(lines.join(""));
  });

  it("accepts readable small portraits and explicitly rejects tiny or excessive content", () => {
    const { ctx, raw } = makeContext();
    const small = planEngineeringWatermarkLayout(
      ctx,
      400,
      700,
      ["拍摄时间：2026-11-23", "防伪号：YX-123456"],
      template
    );
    assertBounds(small, 400, 700);
    for (const [width, height] of [
      [100, 100],
      [399, 700],
      [1200, 0],
      [Infinity, 900],
      [900.5, 1200],
    ]) {
      expect(() =>
        drawEngineeringWatermark(ctx, width, height, fields, template)
      ).toThrow(/高分辨率图片/);
    }
    expect(() =>
      drawEngineeringWatermark(ctx, 400, 400, fields, template)
    ).toThrow(/高分辨率图片/);
    expect(() =>
      drawEngineeringWatermark(
        ctx,
        1200,
        1600,
        ["超长字段".repeat(1200)],
        template
      )
    ).toThrow(/水印内容过长/);
    expect(() =>
      drawEngineeringWatermark(
        ctx,
        1200,
        1600,
        ["防伪号：" + "X".repeat(12001)],
        template
      )
    ).toThrow(/水印内容过长/);
    expect(() =>
      drawEngineeringWatermark(ctx, 1200, 1600, [], {
        ...template,
        title: "异常标题".repeat(1200),
      })
    ).toThrow(/水印内容过长/);
    expect(raw.fillText).not.toHaveBeenCalled();
    expect(raw.fillRect).not.toHaveBeenCalled();
    expect(raw.save.mock.calls.length).toBe(raw.restore.mock.calls.length);
  });

  it("restores context if measuring fails and validates invalid settings", () => {
    const { ctx, raw, state } = makeContext();
    raw.measureText.mockImplementationOnce(() => {
      throw new Error("measure failed");
    });
    expect(() =>
      drawEngineeringWatermark(ctx, 1200, 1600, fields, template)
    ).toThrow("measure failed");
    expect(raw.textBaseline).toBe(state.textBaseline);
    expect(raw.textAlign).toBe(state.textAlign);
    expect(raw.save.mock.calls.length).toBe(raw.restore.mock.calls.length);
    expect(() =>
      planEngineeringWatermarkLayout(ctx, 1200, 1600, fields, {
        ...template,
        position: "middle",
      } as unknown as EngineeringWatermarkTemplate)
    ).toThrow(/位置或尺寸/);
    expect(() =>
      planEngineeringWatermarkLayout(
        ctx,
        1200,
        1600,
        [null] as unknown as string[],
        template
      )
    ).toThrow(/配置无效/);
  });
});

function installBrowserMocks(
  options: {
    width?: number;
    height?: number;
    decodeFails?: boolean;
    nullContext?: boolean;
    nullBlob?: boolean;
    blobBytes?: number;
    encodingThrows?: boolean;
    sourceThrows?: boolean;
    drawThrows?: boolean;
    createUrlThrows?: boolean;
  } = {}
) {
  const { ctx, raw } = makeContext();
  if (options.drawThrows)
    raw.drawImage.mockImplementation(() => {
      throw new Error("draw failed");
    });
  const instances: MockImage[] = [];
  class MockImage {
    naturalWidth = options.width ?? 1200;
    naturalHeight = options.height ?? 1600;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      instances.push(this);
    }
    set src(_value: string) {
      expect(this.onload).toBeTypeOf("function");
      expect(this.onerror).toBeTypeOf("function");
      if (options.sourceThrows) throw new Error("source failed");
      queueMicrotask(() =>
        options.decodeFails ? this.onerror?.() : this.onload?.()
      );
    }
  }
  const blob = new Blob([new Uint8Array(options.blobBytes ?? 1024)], {
    type: "image/jpeg",
  });
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => (options.nullContext ? null : ctx)),
    toBlob: vi.fn((callback: BlobCallback, _type: string, _quality: number) => {
      if (options.encodingThrows) throw new Error("encode failed");
      queueMicrotask(() => callback(options.nullBlob ? null : blob));
    }),
  };
  const createObjectURL = vi.fn(() => {
    if (options.createUrlThrows) throw new Error("url failed");
    return "blob:engineering-source";
  });
  const revokeObjectURL = vi.fn();
  const createElement = vi.fn((tag: string) => {
    expect(tag).toBe("canvas");
    return canvas;
  });
  vi.stubGlobal("Image", MockImage);
  vi.stubGlobal("File", NodeFile);
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  vi.stubGlobal("document", { createElement });
  return {
    canvas,
    raw,
    instances,
    createObjectURL,
    revokeObjectURL,
    createElement,
  };
}

function assertCleaned(mocks: ReturnType<typeof installBrowserMocks>) {
  expect(mocks.revokeObjectURL).toHaveBeenCalledTimes(1);
  expect(mocks.revokeObjectURL).toHaveBeenCalledWith("blob:engineering-source");
  for (const image of mocks.instances) {
    expect(image.onload).toBeNull();
    expect(image.onerror).toBeNull();
  }
}

describe("createEngineeringWatermarkedImage", () => {
  it("preserves natural dimensions and encodes only JPEG 0.9 with a watermark filename", async () => {
    const mocks = installBrowserMocks();
    const input = new File(["input"], "工程现场.webp", { type: "image/webp" });
    const output = await createEngineeringWatermarkedImage(
      input,
      fields,
      template
    );
    expect(output.name).toBe("工程现场-watermark.jpg");
    expect(output.type).toBe("image/jpeg");
    expect(output.size).toBe(1024);
    expect(mocks.canvas.width).toBe(1200);
    expect(mocks.canvas.height).toBe(1600);
    expect(mocks.raw.drawImage).toHaveBeenCalledTimes(1);
    expect(mocks.raw.drawImage).toHaveBeenCalledWith(mocks.instances[0], 0, 0);
    expect(mocks.canvas.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/jpeg",
      0.9
    );
    expect(input.name).toBe("工程现场.webp");
    expect(await input.text()).toBe("input");
    assertCleaned(mocks);
  });

  it.each([
    ["现场.JPG", undefined, "现场-watermark.jpg"],
    ["原图.heic", undefined, "原图-watermark.jpg"],
    ["", "construction-photo.png", "construction-photo-watermark.jpg"],
    ["", undefined, "site-photo-watermark.jpg"],
    [" ", "", "site-photo-watermark.jpg"],
  ])(
    "derives a safe JPEG name from %s and fallback %s",
    async (name, fallbackName, expected) => {
      const mocks = installBrowserMocks();
      const output = await createEngineeringWatermarkedImage(
        new File(["input"], name),
        fields,
        template,
        { fallbackName }
      );
      expect(output.name).toBe(expected);
      assertCleaned(mocks);
    }
  );

  it.each([
    [{ decodeFails: true }, /图片解码失败/],
    [{ nullContext: true }, /浏览器不支持水印绘制/],
    [{ nullBlob: true }, /图片编码失败/],
    [{ encodingThrows: true }, /图片编码失败/],
    [{ sourceThrows: true }, /source failed/],
    [{ drawThrows: true }, /draw failed/],
    [{ width: 100, height: 100 }, /高分辨率图片/],
  ])(
    "releases object URL and handlers on failure %j",
    async (options, message) => {
      const mocks = installBrowserMocks(options);
      await expect(
        createEngineeringWatermarkedImage(
          new File(["input"], "site.jpg"),
          fields,
          template
        )
      ).rejects.toThrow(message);
      assertCleaned(mocks);
    }
  );

  it("releases resources if layout fails from excessively long content", async () => {
    const mocks = installBrowserMocks();
    await expect(
      createEngineeringWatermarkedImage(
        new File(["input"], "site.jpg"),
        ["X".repeat(12001)],
        template
      )
    ).rejects.toThrow(/水印内容过长/);
    expect(mocks.canvas.toBlob).not.toHaveBeenCalled();
    assertCleaned(mocks);
  });

  it("rejects output over the default 8MB without resizing or reducing encoding quality", async () => {
    const mocks = installBrowserMocks({ blobBytes: 8 * 1024 * 1024 + 1 });
    await expect(
      createEngineeringWatermarkedImage(
        new File(["input"], "site.jpg"),
        fields,
        template
      )
    ).rejects.toThrow(/8\.00MB/);
    expect(mocks.canvas.toBlob).toHaveBeenCalledTimes(1);
    expect(mocks.canvas.width).toBe(1200);
    assertCleaned(mocks);
  });

  it("honors maxBytes and permits exactly the limit", async () => {
    const mocks = installBrowserMocks({ blobBytes: 2048 });
    const file = new File(["input"], "site.jpg");
    await expect(
      createEngineeringWatermarkedImage(file, fields, template, {
        maxBytes: 2048,
      })
    ).resolves.toHaveProperty("size", 2048);
    expect(mocks.revokeObjectURL).toHaveBeenCalledTimes(1);
    await expect(
      createEngineeringWatermarkedImage(file, fields, template, {
        maxBytes: 2047,
      })
    ).rejects.toThrow(/大小限制/);
    expect(mocks.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it.each([0, -1, NaN, Infinity])(
    "rejects invalid size limits %s before allocating object URLs",
    async maxBytes => {
      const mocks = installBrowserMocks();
      await expect(
        createEngineeringWatermarkedImage(
          new File(["input"], "site.jpg"),
          fields,
          template,
          { maxBytes }
        )
      ).rejects.toThrow(/大小限制无效/);
      expect(mocks.createObjectURL).not.toHaveBeenCalled();
    }
  );

  it("does not revoke an unallocated URL if creation fails", async () => {
    const mocks = installBrowserMocks({ createUrlThrows: true });
    await expect(
      createEngineeringWatermarkedImage(
        new File(["input"], "site.jpg"),
        fields,
        template
      )
    ).rejects.toThrow("url failed");
    expect(mocks.revokeObjectURL).not.toHaveBeenCalled();
  });
});
