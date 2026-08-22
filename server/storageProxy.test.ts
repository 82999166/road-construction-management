import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

vi.mock("./_core/env", () => ({
  ENV: { forgeApiUrl: "https://forge.example", forgeApiKey: "test-forge-key", selfHostStorageDir: "" },
}));

import { ENV } from "./_core/env";
import { registerStorageProxy } from "./_core/storageProxy";
import { storagePut } from "./storage";

describe("存储代理影像读取", () => {
  afterEach(() => {
    ENV.selfHostStorageDir = "";
    vi.restoreAllMocks();
  });

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

  it("自建部署可将影像写入本地受控存储并通过应用域名读取", async () => {
    const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "yx-self-host-storage-"));
    ENV.selfHostStorageDir = storageDir;
    const written = await storagePut("evidence/project/photo.jpg", Buffer.from([7, 8, 9]), "image/jpeg");

    const get = vi.fn();
    registerStorageProxy({ get } as never);
    const handler = get.mock.calls[0]?.[1] as (request: { params: Record<string, string> }, response: { set: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> }) => Promise<void>;
    const response = {
      set: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    await handler({ params: { "0": written.key } }, response);

    expect(written.url).toBe(`/manus-storage/${written.key}`);
    expect(response.set).toHaveBeenCalledWith("Content-Type", "image/jpeg");
    expect(response.set).toHaveBeenCalledWith("Cache-Control", "private, max-age=300");
    expect(response.send).toHaveBeenCalledWith(Buffer.from([7, 8, 9]));
  });

  it("自建本地存储拒绝通过相对路径读取存储根目录外文件", async () => {
    ENV.selfHostStorageDir = await fs.mkdtemp(path.join(os.tmpdir(), "yx-self-host-storage-"));
    ENV.forgeApiUrl = "";
    ENV.forgeApiKey = "";
    const get = vi.fn();
    registerStorageProxy({ get } as never);
    const handler = get.mock.calls[0]?.[1] as (request: { params: Record<string, string> }, response: { set: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> }) => Promise<void>;
    const response = {
      set: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    await handler({ params: { "0": "../outside.jpg" } }, response);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.send).toHaveBeenCalledWith("Storage object unavailable");
  });

  it("自建部署遇到未迁移的历史对象时可回退到原受控存储读取", async () => {
    ENV.selfHostStorageDir = await fs.mkdtemp(path.join(os.tmpdir(), "yx-self-host-storage-"));
    ENV.forgeApiUrl = "https://forge.example";
    ENV.forgeApiKey = "test-forge-key";
    const get = vi.fn();
    registerStorageProxy({ get } as never);
    const handler = get.mock.calls[0]?.[1] as (request: { params: Record<string, string> }, response: { set: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn>; redirect: ReturnType<typeof vi.fn> }) => Promise<void>;
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://object.example/legacy.jpg" }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([4, 5, 6]), { status: 200, headers: { "content-type": "image/jpeg", "content-length": "3" } }));
    const response = {
      set: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      redirect: vi.fn(),
    };

    await handler({ params: { "0": "legacy/photo.jpg" } }, response);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.set).toHaveBeenCalledWith("Content-Type", "image/jpeg");
    expect(response.send).toHaveBeenCalledWith(Buffer.from([4, 5, 6]));
  });
});
