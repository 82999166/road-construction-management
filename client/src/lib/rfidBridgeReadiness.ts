export const REQUIRED_RFID_BRIDGE_VERSION = "utrust-bridge-installer-v13";
export const REQUIRED_RFID_BRIDGE_BUILD_ID =
  "utrust-rfid-installer-20261101-progress-v13";
export const REQUIRED_RFID_WRITER_VERSION = "ntag216-atomic-v2";
export const RFID_FIRST_INSTALL_PACKAGE_URL =
  "/manus-storage/utrust-bridge-first-install-v16-20261101_17276df9.zip";

export type RfidBridgeReadiness = {
  status: "ready" | "upgrade_required" | "unavailable" | "writer_mismatch";
  bridgeVersion: string | null;
  bridgeBuildId: string | null;
  writerVersion: string | null;
  reason: string;
};
const safeIdentifier = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9._-]{1,96}$/.test(value)
    ? value
    : null;

export function inspectRfidBridgeReadiness(
  body: unknown,
  httpOk: boolean
): RfidBridgeReadiness {
  const value =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const metadata = {
    bridgeVersion: safeIdentifier(value.bridgeVersion),
    bridgeBuildId: safeIdentifier(value.bridgeBuildId),
    writerVersion: safeIdentifier(value.requiredWriterVersion),
  };
  if (!httpOk || value.success !== true)
    return {
      ...metadata,
      status: "unavailable",
      reason:
        "桥接未返回有效就绪状态，请检查程序是否启动及浏览器的本机设备访问权限。",
    };
  if (
    metadata.bridgeVersion !== REQUIRED_RFID_BRIDGE_VERSION ||
    metadata.bridgeBuildId !== REQUIRED_RFID_BRIDGE_BUILD_ID
  )
    return {
      ...metadata,
      status: "upgrade_required",
      reason:
        "本机运行的桥接版本与正式写卡要求不一致，已停止写卡。请安装最新版后重新检测，不要继续启动旧快捷方式。",
    };
  if (metadata.writerVersion !== REQUIRED_RFID_WRITER_VERSION)
    return {
      ...metadata,
      status: "writer_mismatch",
      reason:
        "桥接已连接，但底层写卡程序版本未通过校验。请完整安装最新版，不能只替换单个脚本。",
    };
  return {
    ...metadata,
    status: "ready",
    reason:
      "桥接版本与正式写卡要求一致。此检测不会写卡，也不代表实体卡已完成写入或回读。",
  };
}

/** 只读取本机元数据，不提交任务授权、卡号、载荷或业务请求。 */
export async function readRfidBridgeReadiness(
  signal?: AbortSignal
): Promise<RfidBridgeReadiness> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), 8_000);
  try {
    let response = await fetch("http://127.0.0.1:47601/ready", {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    // 旧桥接没有 /ready：仅用 /health 读取版本，绝不把端点缺失当作兼容。
    if (response.status === 404 || response.status === 405)
      response = await fetch("http://127.0.0.1:47601/health", {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
    return inspectRfidBridgeReadiness(
      await response.json().catch(() => null),
      response.ok
    );
  } catch {
    return {
      status: "unavailable",
      bridgeVersion: null,
      bridgeBuildId: null,
      writerVersion: null,
      reason: controller.signal.aborted
        ? "桥接检测超时或已取消。请确认 Windows 桥接程序运行后重新检测。"
        : "浏览器无法连接本机桥接。请启动 Windows 桥接并允许当前网站访问本机设备。",
    };
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", forwardAbort);
  }
}
