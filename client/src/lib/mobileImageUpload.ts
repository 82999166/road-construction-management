const MAX_SOURCE_IMAGE_BYTES = 25 * 1024 * 1024;

/**
 * 手机相机和相册照片的可接受类型。选择器使用 image/*，本工具会统一解码并转为 JPEG，
 * 因而兼容 iPhone HEIC（WebKit 可解码时）、Android WebP/JPEG 和普通 PNG。
 */
const IMAGE_FILE_NAME_PATTERN = /\.(jpe?g|png|webp|heic|heif|gif|bmp|avif)$/i;

export function isMobileImageFile(file: File) {
  return file.type.startsWith("image/") || IMAGE_FILE_NAME_PATTERN.test(file.name);
}

function decodeImageFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("该照片无法在当前浏览器解码。请在手机相册中选择“最兼容”格式后重试。"));
    };
    image.src = objectUrl;
  });
}

/**
 * 统一压缩相机或相册图片，避免超大原图转 Base64 后触发 tRPC 请求大小限制。
 * 不保留 EXIF 定位等原始隐私元数据；需要定位的业务由页面显式采集并水印/归档。
 */
export async function normalizeMobileImage(
  file: File,
  options: { maxEdge?: number; quality?: number; maxSourceBytes?: number } = {},
) {
  const maxEdge = options.maxEdge ?? 1920;
  const quality = options.quality ?? 0.84;
  const maxSourceBytes = options.maxSourceBytes ?? MAX_SOURCE_IMAGE_BYTES;
  if (!isMobileImageFile(file)) throw new Error("请选择手机拍摄或相册中的图片文件");
  if (!file.size) throw new Error("所选照片为空，请重新拍摄或从相册选择");
  if (file.size > maxSourceBytes) throw new Error(`原始照片超过 ${Math.round(maxSourceBytes / 1024 / 1024)}MB，请先在相册中裁剪后重试`);

  const image = await decodeImageFile(file);
  const longestEdge = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height);
  if (!longestEdge) throw new Error("照片尺寸无效，请重新选择");
  const scale = Math.min(1, maxEdge / longestEdge);
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持图片压缩，请更新微信或系统浏览器后重试");
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("照片压缩失败，请重新选择");
  const baseName = file.name.replace(/\.[^.]+$/, "") || "mobile-photo";
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: file.lastModified || Date.now() });
}
