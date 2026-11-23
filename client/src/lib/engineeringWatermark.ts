import type { EvidenceWatermarkTemplate } from "../../../shared/watermarkTemplate";

export type EngineeringWatermarkPosition =
  | "bottom_left"
  | "bottom_right"
  | "top_left"
  | "top_right";

/** Also accepts historical templates before these optional settings were added. */
export type EngineeringWatermarkTemplate = EvidenceWatermarkTemplate & {
  position?: EngineeringWatermarkPosition;
  size?: "compact" | "standard";
};

export type EngineeringWatermarkOptions = {
  maxBytes?: number;
  fallbackName?: string;
};

export type EngineeringWatermarkText = {
  text: string;
  role: "title" | "field" | "footer";
  font: string;
  fontSize: number;
  x: number;
  y: number;
  /** Conservative bounds include the advance width and any glyph overhang. */
  bounds: { x: number; y: number; width: number; height: number };
};

export type EngineeringWatermarkLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
  margin: number;
  padding: number;
  fontSize: number;
  position: EngineeringWatermarkPosition;
  texts: EngineeringWatermarkText[];
};

const FONT_FAMILY = '"Noto Sans SC", "Microsoft YaHei", sans-serif';
const MIN_FONT_SIZE = 12;
const MAX_HEIGHT_RATIO = 0.38;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const FIT_ERROR =
  "图片分辨率过低或水印内容过长，无法完整、清晰显示。请更换高分辨率图片或调整水印配置后重试";

type Measurement = {
  width: number;
  height: number;
  leftOverhang: number;
  topOverhang: number;
};

type LocalText = EngineeringWatermarkText & { rowHeight: number };

function measure(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontSize: number
): Measurement {
  const metrics = ctx.measureText(text);
  const finite = (value: number | undefined, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const leftOverhang = Math.max(0, finite(metrics.actualBoundingBoxLeft, 0));
  const topOverhang = Math.max(0, finite(metrics.actualBoundingBoxAscent, 0));
  const width =
    leftOverhang +
    Math.max(
      metrics.width,
      finite(metrics.actualBoundingBoxRight, metrics.width)
    );
  const height =
    topOverhang +
    Math.max(0, finite(metrics.actualBoundingBoxDescent, fontSize * 1.2));
  if (!Number.isFinite(width) || width < 0 || !Number.isFinite(height)) {
    throw new Error("浏览器无法测量水印文字，请更换浏览器后重试");
  }
  return { width, height, leftOverhang, topOverhang };
}

/** Code-point iteration never splits a UTF-16 surrogate pair or drops content. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontSize: number,
  maxWidth: number
): string[] | null {
  const rows: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    let row = "";
    for (const character of Array.from(paragraph)) {
      const next = row + character;
      if (measure(ctx, next, fontSize).width <= maxWidth) {
        row = next;
      } else {
        if (!row || measure(ctx, character, fontSize).width > maxWidth) {
          return null;
        }
        rows.push(row);
        row = character;
      }
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Plans every glyph before touching the photo. Coordinates use top/left text
 * alignment, include padding and real glyph bearings, and are inspectable in
 * both unit tests and a real browser canvas. No field count or text truncation.
 */
export function planEngineeringWatermarkLayout(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  lines: string[],
  template: EvidenceWatermarkTemplate
): EngineeringWatermarkLayout {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    Math.min(width, height) < 400
  ) {
    throw new Error(FIT_ERROR);
  }
  if (
    !Array.isArray(lines) ||
    lines.some(line => typeof line !== "string") ||
    typeof template?.title !== "string" ||
    typeof template?.footerLabel !== "string"
  ) {
    throw new Error("水印配置无效，请检查标题、页脚及取证字段");
  }
  const uniqueLines = Array.from(new Set(lines.filter(line => line.trim())));
  const allText = [template.title, ...uniqueLines, template.footerLabel];
  // Abnormal configuration must fail explicitly, not silently omit fields.
  if (
    uniqueLines.length > 128 ||
    allText.reduce((total, text) => total + Array.from(text).length, 0) > 12000
  ) {
    throw new Error(FIT_ERROR);
  }
  const settings = template as EngineeringWatermarkTemplate;
  const position = settings.position ?? "bottom_left";
  if (
    !["bottom_left", "bottom_right", "top_left", "top_right"].includes(
      position
    ) ||
    (settings.size !== undefined &&
      !["compact", "standard"].includes(settings.size))
  ) {
    throw new Error("水印位置或尺寸配置无效，请重新选择水印样式");
  }
  const shortSide = Math.min(width, height);
  const margin = shortSide * 0.02;
  const widthLimit = Math.min(
    width - margin * 2,
    width * (width > height ? 0.55 : 0.72)
  );
  const heightLimit = Math.min(height - margin * 2, height * MAX_HEIGHT_RATIO);
  const preferredFont = Math.max(
    MIN_FONT_SIZE,
    shortSide / (settings.size === "standard" ? 48 : 56)
  );
  // At most 17 small reductions, never to a tiny, misleadingly unreadable font.
  const minimumFont = Math.max(MIN_FONT_SIZE, preferredFont * 0.7);
  ctx.save();
  try {
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    for (let attempt = 0; attempt <= 16; attempt += 1) {
      const fontSize =
        preferredFont - ((preferredFont - minimumFont) * attempt) / 16;
      const padding = fontSize * 0.7;
      const contentWidth = widthLimit - padding * 2;
      const texts: LocalText[] = [];
      let cursorY = padding;
      let measuredWidth = 0;
      let fits = true;
      const addSection = (
        text: string,
        role: EngineeringWatermarkText["role"],
        sectionFont: number
      ) => {
        const font = `${role === "title" ? 700 : 500} ${sectionFont}px ${FONT_FAMILY}`;
        ctx.font = font;
        const rows = wrapText(ctx, text, sectionFont, contentWidth);
        if (!rows) {
          fits = false;
          return;
        }
        for (const row of rows) {
          const dimensions = measure(ctx, row, sectionFont);
          const rowHeight = Math.max(sectionFont * 1.38, dimensions.height);
          measuredWidth = Math.max(measuredWidth, dimensions.width);
          texts.push({
            text: row,
            role,
            font,
            fontSize: sectionFont,
            x: padding + dimensions.leftOverhang,
            y: cursorY + dimensions.topOverhang,
            bounds: {
              x: padding,
              y: cursorY,
              width: dimensions.width,
              height: rowHeight,
            },
            rowHeight,
          });
          cursorY += rowHeight;
        }
      };
      if (template.title) {
        addSection(template.title, "title", fontSize * 1.08);
        cursorY += fontSize * 0.42;
      }
      for (const line of uniqueLines) addSection(line, "field", fontSize);
      if (template.footerLabel) {
        cursorY += fontSize * 0.42;
        addSection(
          template.footerLabel,
          "footer",
          Math.max(MIN_FONT_SIZE, fontSize * 0.86)
        );
      }
      const boxWidth = measuredWidth + padding * 2;
      const boxHeight = cursorY + padding;
      if (!fits || boxWidth > widthLimit || boxHeight > heightLimit) continue;
      const x = position.endsWith("right") ? width - margin - boxWidth : margin;
      const y = position.startsWith("top")
        ? margin
        : height - margin - boxHeight;
      return {
        x,
        y,
        width: boxWidth,
        height: boxHeight,
        margin,
        padding,
        fontSize,
        position,
        texts: texts.map(({ rowHeight: _rowHeight, ...text }) => ({
          ...text,
          x: text.x + x,
          y: text.y + y,
          bounds: {
            ...text.bounds,
            x: text.bounds.x + x,
            y: text.bounds.y + y,
          },
        })),
      };
    }
    throw new Error(FIT_ERROR);
  } finally {
    ctx.restore();
  }
}

/** Draws a restrained engineering information card; never squeezes text. */
export function drawEngineeringWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  lines: string[],
  template: EvidenceWatermarkTemplate
): EngineeringWatermarkLayout {
  ctx.save();
  try {
    const layout = planEngineeringWatermarkLayout(
      ctx,
      width,
      height,
      lines,
      template
    );
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = "rgba(15, 23, 34, 0.80)";
    ctx.fillRect(layout.x, layout.y, layout.width, layout.height);
    // A slim accent beside the title, not a heavy colored header/footer block.
    ctx.fillStyle = "#55d5d0";
    ctx.fillRect(
      layout.x + layout.padding * 0.36,
      layout.y + layout.padding,
      Math.max(1.5, layout.fontSize * 0.1),
      layout.fontSize * 1.12
    );
    for (const text of layout.texts) {
      ctx.font = text.font;
      ctx.fillStyle = text.role === "footer" ? "#d5e2e9" : "#ffffff";
      ctx.fillText(text.text, text.x, text.y);
    }
    return layout;
  } finally {
    ctx.restore();
  }
}

function watermarkFileName(file: File, fallbackName?: string): string {
  const stem = (name: string) =>
    (name.split(/[\\/]/).pop() ?? "").replace(/\.[^/.]+$/, "").trim();
  return `${stem(file.name) || stem(fallbackName ?? "site-photo") || "site-photo"}-watermark.jpg`;
}

/** Re-encodes at the exact natural dimensions; the original file is untouched. */
export async function createEngineeringWatermarkedImage(
  file: File,
  watermarkLines: string[],
  template: EvidenceWatermarkTemplate,
  options: EngineeringWatermarkOptions = {}
): Promise<File> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error("水印图片大小限制无效，请检查上传配置");
  }
  let objectUrl: string | undefined;
  let image: HTMLImageElement | undefined;
  try {
    objectUrl = URL.createObjectURL(file);
    image = new Image();
    const source = objectUrl;
    const loadedImage = image;
    await new Promise<void>((resolve, reject) => {
      loadedImage.onload = () => resolve();
      loadedImage.onerror = () =>
        reject(
          new Error("图片解码失败，请更换清晰的 JPG、PNG 或 WebP 图片后重试")
        );
      loadedImage.src = source;
    });
    const canvas = document.createElement("canvas");
    canvas.width = loadedImage.naturalWidth;
    canvas.height = loadedImage.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("当前浏览器不支持水印绘制，请更换浏览器后重试");
    ctx.drawImage(loadedImage, 0, 0);
    drawEngineeringWatermark(
      ctx,
      canvas.width,
      canvas.height,
      watermarkLines,
      template
    );
    const blob = await new Promise<Blob>((resolve, reject) => {
      try {
        canvas.toBlob(
          value => {
            if (value) resolve(value);
            else reject(new Error("水印图片编码失败，请更换图片后重试"));
          },
          "image/jpeg",
          0.9
        );
      } catch {
        reject(new Error("水印图片编码失败，请更换图片后重试"));
      }
    });
    if (blob.size > maxBytes) {
      throw new Error(
        `水印图片超过 ${(maxBytes / 1024 / 1024).toFixed(2)}MB 大小限制，请更换文件较小的高分辨率图片后重试`
      );
    }
    return new File([blob], watermarkFileName(file, options.fallbackName), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } finally {
    if (image) {
      image.onload = null;
      image.onerror = null;
    }
    if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
  }
}
