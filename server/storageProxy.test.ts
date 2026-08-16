import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/env", () => ({
  ENV: { forgeApiUrl: "https://forge.example", forgeApiKey: "test-forge-key" },
}));

import { registerStorageProxy } from "./_core/storageProxy";

describe("存储代理影像读取", () => {
  afterEach(() => vi.restoreAllMocks());

  it("在应用域名回传已签名影像字节，不将移动浏览器重定向到对象存储域名", async () => {
    const get = vi.fn();
    registerStorageProxy({ get } as never);
    const handler = get.mock.calls[0]?.[1] as (request: { params: Record<string, string> }, response: { set: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn>; redirect: ReturnType<typeof vi.fn> }) => Promise<void>;
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://object.example/evidence.jpg" }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg", "content-length": "3" } }));
    const response = {
      set: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      redirect: vi.fn(),
    };

    await handler({ params: { "0": "evidence/project/photo.jpg" } }, response);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.set).toHaveBeenCalledWith("Content-Type", "image/jpeg");
    expect(response.set).toHaveBeenCalledWith("Content-Length", "3");
    expect(response.set).toHaveBeenCalledWith("Cache-Control", "private, max-age=300");
    expect(response.redirect).not.toHaveBeenCalled();
    expect(response.send).toHaveBeenCalledWith(Buffer.from([1, 2, 3]));
  });
});
