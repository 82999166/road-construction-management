import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

const VERSION_PREFIX = "v1";

/**
 * 从服务端 JWT 密钥派生出 AES-256-GCM 对称密钥。
 * 原始密钥永远不会返回给前端，也不会写入数据库。
 */
function getEncryptionKey(): Buffer {
  const material = process.env.JWT_SECRET;
  if (!material) {
    throw new Error("系统未配置加密根密钥，不能保存敏感配置");
  }
  return createHash("sha256").update(material, "utf8").digest();
}

/** 使用带认证标签的 AES-256-GCM 加密敏感配置。 */
export function encryptSecret(plainText: string): string {
  if (!plainText.trim()) throw new Error("敏感配置内容不能为空");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [VERSION_PREFIX, iv.toString("base64url"), authTag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

/** 仅供服务端调用的敏感配置解密函数；不得被 tRPC 接口直接返回。 */
export function decryptSecret(cipherText: string): string {
  const [version, ivBase64, tagBase64, payloadBase64] = cipherText.split(".");
  if (version !== VERSION_PREFIX || !ivBase64 || !tagBase64 || !payloadBase64) {
    throw new Error("敏感配置密文格式无效");
  }
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivBase64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagBase64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(payloadBase64, "base64url")), decipher.final()]).toString("utf8");
}

/** 仅用于系统密钥、令牌等凭据的预览；业务人员资料不调用此函数。 */
export function maskSecret(plainText: string): string {
  if (plainText.length <= 4) return "****";
  return `${"*".repeat(Math.min(12, plainText.length - 4))}${plainText.slice(-4)}`;
}

/**
 * 返回已通过服务端权限校验的业务资料完整值。
 * 手机号、证件号、银行卡号仍在数据库中加密保存；业务路由完成权限和
 * 项目范围校验后，使用此函数生成管理、打印和导出投影。
 */
export function revealBusinessSecret(cipherText: string | null | undefined): string | null {
  if (!cipherText) return null;
  try {
    return decryptSecret(cipherText);
  } catch {
    // 历史脏数据或测试夹具不能阻断整条业务详情；不回显密文。
    return null;
  }
}

/**
 * 仅用于服务端敏感值的等值比对。使用从根密钥派生的 HMAC，避免手机号等低熵值被
 * 普通哈希或明文索引反查；原文仍只保存在 AES-GCM 密文中。
 */
export function fingerprintSecret(plainText: string): string {
  const normalized = plainText.trim();
  if (!normalized) throw new Error("敏感配置内容不能为空");
  return createHmac("sha256", getEncryptionKey())
    .update(normalized, "utf8")
    .digest("hex");
}
