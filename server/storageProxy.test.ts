import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "fs/promises";
import os from "os";
import path from "path";

vi.mock("./_core/env", () => ({
  ENV: { forgeApiUrl: "https://forge.example", forgeApiKey: "test-forge-key", selfHostStorageDir: "" },
}));

import { ENV } from "./_core/env";
import { registerStorageProxy } from "./_core/storageProxy";
import { storagePut } from "./storage";

type StorageRouteRequest = { params: Record<string, string | string[]> };
type StorageRouteResponse = {
  set: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  redirect?: ReturnType<typeof vi.fn>;
};

describe("存储代理影像读取", () => {
  afterEach(() => {
    ENV.selfHostStorageDir = "";
    vi.restoreAllMocks();
  });

  it("可直接挂载到Express 5实例而不会因旧通配符语法启动失败", () => {
    expect(() => registerStorageProxy(express())).not.toThrow();
  });

  it("使用Express 5命名通配符并将分段路径还原为对象键", async () => {
    const get = vi.fn();
    registerStorageProxy({ get } as never);
    const handler = get.mock.calls[0]?.[1] as (request: StorageRouteRequest, response: StorageRouteResponse) => Promise<void>;
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://object.example/evidence.jpg" }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg", "content-length": "3" } }));
    const response = {
      set: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      redirect: vi.fn(),
    };

    await handler({ params: { key: ["evidence", "project", "photo.jpg"] } }, response);

    expect(get).toHaveBeenCalledWith("/manus-storage/*key", expect.any(Function));
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
    const handler = get.mock.calls[0]?.[1] as (request: StorageRouteRequest, response: StorageRouteResponse) => Promise<void>;
    const response = {
      set: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    await handler({ params: { key: written.key.split("/") } }, response);

    expect(written.url).toBe(`/manus-storage/${written.key}`);
    expect(response.set).toHaveBeenCalledWith("Content-Type", "image/jpeg");
    expect(response.set).toHaveBeenCalledWith("Cache-Control", "private, max-age=300");
    expect(response.send).toHaveBeenCalledWith(Buffer.from([7, 8, 9]));
  }, 10_000);

  it("自建本地存储拒绝通过相对路径读取存储根目录外文件", async () => {
    ENV.selfHostStorageDir = await fs.mkdtemp(path.join(os.tmpdir(), "yx-self-host-storage-"));
    ENV.forgeApiUrl = "";
    ENV.forgeApiKey = "";
    const get = vi.fn();
    registerStorageProxy({ get } as never);
    const handler = get.mock.calls[0]?.[1] as (request: StorageRouteRequest, response: StorageRouteResponse) => Promise<void>;
    const response = {
      set: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    await handler({ params: { key: ["..", "outside.jpg"] } }, response);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.send).toHaveBeenCalledWith("Storage object unavailable");
  });

  it("自建部署遇到未迁移的历史对象时可回退到原受控存储读取", async () => {
    ENV.selfHostStorageDir = await fs.mkdtemp(path.join(os.tmpdir(), "yx-self-host-storage-"));
    ENV.forgeApiUrl = "https://forge.example";
    ENV.forgeApiKey = "test-forge-key";
    const get = vi.fn();
    registerStorageProxy({ get } as never);
    const handler = get.mock.calls[0]?.[1] as (request: StorageRouteRequest, response: StorageRouteResponse) => Promise<void>;
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://object.example/legacy.jpg" }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([4, 5, 6]), { status: 200, headers: { "content-type": "image/jpeg", "content-length": "3" } }));
    const response = {
      set: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      redirect: vi.fn(),
    };

    await handler({ params: { key: ["legacy", "photo.jpg"] } }, response);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.set).toHaveBeenCalledWith("Content-Type", "image/jpeg");
    expect(response.send).toHaveBeenCalledWith(Buffer.from([4, 5, 6]));
  });
});
