const MOBILE_DRAFT_PREFIX = "yx-mobile-draft:v1:";
const MOBILE_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 设备级未提交草稿只用于避免现场误关页面，绝不替代服务端业务草稿。
 * 账户、证件、银行卡、支付、附件、照片、定位等敏感或大体积信息在写入前会被直接丢弃。
 */
const SENSITIVE_KEY = /(password|passcode|token|secret|openid|identity|idcard|bank|account|phone|mobile|contact|payment|receipt|invoice|evidence|photo|image|file|base64|location|longitude|latitude|coordinate)/i;

type SafeValue = string | number | boolean | null | SafeValue[] | { [key: string]: SafeValue };

type StoredMobileDraft = {
  version: 1;
  savedAt: number;
  value: SafeValue;
};

function safeKey(key: string) {
  return `${MOBILE_DRAFT_PREFIX}${key}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeValue(value: unknown, key = ""): SafeValue | undefined {
  if (SENSITIVE_KEY.test(key)) return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const items = value.map(item => sanitizeValue(item)).filter((item): item is SafeValue => item !== undefined);
    return items;
  }
  if (!isPlainObject(value)) return undefined;

  const output: Record<string, SafeValue> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const safe = sanitizeValue(childValue, childKey);
    if (safe !== undefined) output[childKey] = safe;
  }
  return output;
}

/** 写入经过敏感字段过滤的设备本机草稿；服务端永不接收此内容。 */
export function saveMobileDraft(key: string, value: unknown): boolean {
  if (typeof window === "undefined" || !key) return false;
  try {
    const safe = sanitizeValue(value);
    if (!safe || Array.isArray(safe) || typeof safe !== "object") return false;
    const payload: StoredMobileDraft = { version: 1, savedAt: Date.now(), value: safe };
    window.localStorage.setItem(safeKey(key), JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/** 读取未过期的设备本机草稿；格式异常和已过期内容会立即清理。 */
export function readMobileDraft<T extends Record<string, unknown>>(key: string): { value: Partial<T>; savedAt: number } | null {
  if (typeof window === "undefined" || !key) return null;
  try {
    const storageKey = safeKey(key);
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredMobileDraft>;
    if (parsed.version !== 1 || !Number.isFinite(parsed.savedAt) || Date.now() - Number(parsed.savedAt) > MOBILE_DRAFT_MAX_AGE_MS || !isPlainObject(parsed.value)) {
      window.localStorage.removeItem(storageKey);
      return null;
    }
    return { value: parsed.value as Partial<T>, savedAt: Number(parsed.savedAt) };
  } catch {
    return null;
  }
}

export function clearMobileDraft(key: string) {
  if (typeof window === "undefined" || !key) return;
  try {
    window.localStorage.removeItem(safeKey(key));
  } catch {
    // 隐私优先：本机存储不可用时不影响正常业务保存。
  }
}

/** 用于页面提示和测试，判断草稿中是否存在用户真正填写过的可安全字段。 */
export function hasMobileDraftContent(value: Record<string, unknown>, ignoredKeys: readonly string[] = []) {
  return Object.entries(value).some(([key, item]) => {
    if (ignoredKeys.includes(key) || SENSITIVE_KEY.test(key)) return false;
    if (typeof item === "string") return item.trim().length > 0;
    if (typeof item === "number") return Number.isFinite(item) && item !== 0;
    if (typeof item === "boolean") return item;
    return Array.isArray(item) ? item.length > 0 : Boolean(item && typeof item === "object" && Object.keys(item).length);
  });
}
