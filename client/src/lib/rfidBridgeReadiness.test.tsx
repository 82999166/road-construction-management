import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  inspectRfidBridgeReadiness,
  readRfidBridgeReadiness,
  REQUIRED_RFID_BRIDGE_VERSION,
  REQUIRED_RFID_BRIDGE_BUILD_ID,
  REQUIRED_RFID_WRITER_VERSION,
} from "./rfidBridgeReadiness";
const healthy = {
  success: true,
  bridgeVersion: REQUIRED_RFID_BRIDGE_VERSION,
  bridgeBuildId: REQUIRED_RFID_BRIDGE_BUILD_ID,
  requiredWriterVersion: REQUIRED_RFID_WRITER_VERSION,
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("正式写卡桥接就绪：版本、连接和底层程序分别诊断", () => {
  it("正确版本才就绪，不将字符串成功或HTTP错误当成功", () => {
    expect(inspectRfidBridgeReadiness(healthy, true).status).toBe("ready");
    expect(
      inspectRfidBridgeReadiness({ ...healthy, success: "true" }, true).status
    ).toBe("unavailable");
    expect(inspectRfidBridgeReadiness(healthy, false).status).toBe(
      "unavailable"
    );
  });
  it("旧版本、旧构建和缺失标识一律阻断，不能仅凭读到卡号放行", () => {
    for (const body of [
      { ...healthy, bridgeVersion: "utrust-bridge-fingerprint-v10" },
      { ...healthy, bridgeBuildId: "old" },
      { ...healthy, bridgeBuildId: undefined },
      { success: true },
    ])
      expect(inspectRfidBridgeReadiness(body, true).status).toBe(
        "upgrade_required"
      );
  });
  it("底层程序声明异常独立于桥接版本错误", () => {
    expect(
      inspectRfidBridgeReadiness(
        { ...healthy, requiredWriterVersion: "unknown" },
        true
      ).status
    ).toBe("writer_mismatch");
    expect(
      inspectRfidBridgeReadiness(
        { ...healthy, requiredWriterVersion: undefined },
        true
      ).status
    ).toBe("writer_mismatch");
  });
  it("只返回安全版本字段，不透出令牌、UID、路径或任意服务消息", () => {
    const result = inspectRfidBridgeReadiness(
      {
        ...healthy,
        bridgeBuildId: "D:\\secret\\file",
        message: "password=123",
        bridgeToken: "secret",
        cardUid: "04SECRET",
        path: "D:\\manus",
      },
      true
    );
    expect(result.bridgeBuildId).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(
      /secret|password|04SECRET|manus/i
    );
    expect(Object.keys(result).sort()).toEqual(
      [
        "bridgeBuildId",
        "bridgeVersion",
        "reason",
        "status",
        "writerVersion",
      ].sort()
    );
  });
  it("最新版使用轻量/ready，不触发读卡器探测，也不发送写卡或授权", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(healthy));
    vi.stubGlobal("fetch", fetchMock);
    expect((await readRfidBridgeReadiness()).status).toBe("ready");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:47601/ready");
    expect(options.method).toBe("GET");
    expect(options.cache).toBe("no-store");
    expect(options.body).toBeUndefined();
  });
  it("旧接口bridge_path_not_found仅回退健康读取，旧版本仍不得写卡", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ success: false, message: "bridge_path_not_found" }, 404)
      )
      .mockResolvedValueOnce(response({ ...healthy, bridgeVersion: "old" }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await readRfidBridgeReadiness()).status).toBe("upgrade_required");
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      "http://127.0.0.1:47601/ready",
      "http://127.0.0.1:47601/health",
    ]);
    expect(
      fetchMock.mock.calls.every(
        call => call[1].method === "GET" && !call[1].body
      )
    ).toBe(true);
  });
  it("401/422不是旧版本，不偷偷回退，更不发写卡请求", async () => {
    for (const status of [401, 422]) {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(response({ success: false }, status));
      vi.stubGlobal("fetch", fetchMock);
      expect((await readRfidBridgeReadiness()).status).toBe("unavailable");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });
  it("非法JSON或无法连接只显示安全的连接诊断", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>server secret</html>", { status: 200 })
        )
    );
    expect((await readRfidBridgeReadiness()).status).toBe("unavailable");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("secret server trace"))
    );
    const r = await readRfidBridgeReadiness();
    expect(r.status).toBe("unavailable");
    expect(r.reason).not.toContain("secret");
  });
  it("八秒总时限与外部取消会结束只读检测", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            if (options.signal?.aborted) reject(new Error("abort"));
            else
              options.signal?.addEventListener(
                "abort",
                () => reject(new Error("abort")),
                { once: true }
              );
          })
      )
    );
    const pending = readRfidBridgeReadiness();
    await vi.advanceTimersByTimeAsync(8000);
    expect((await pending).status).toBe("unavailable");
    const c = new AbortController();
    const external = readRfidBridgeReadiness(c.signal);
    c.abort();
    expect((await external).status).toBe("unavailable");
  });
  it("契约与分发桥接真实源码一致，防止下一次升级前后端漂移", () => {
    const source = readFileSync(
      new URL(
        "../../../desktop-bridge/utrust_local_bridge.ps1",
        import.meta.url
      ),
      "utf8"
    );
    expect(source).toContain(
      `$bridgeVersion = "${REQUIRED_RFID_BRIDGE_VERSION}"`
    );
    expect(source).toContain(
      `$bridgeBuildId = "${REQUIRED_RFID_BRIDGE_BUILD_ID}"`
    );
    expect(source).toContain(
      `$requiredWriterVersion = "${REQUIRED_RFID_WRITER_VERSION}"`
    );
  });
});
