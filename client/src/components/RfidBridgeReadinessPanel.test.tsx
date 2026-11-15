import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import RfidBridgeReadinessPanel from "./RfidBridgeReadinessPanel";
import {
  inspectRfidBridgeReadiness,
  readRfidBridgeReadiness,
  RFID_FIRST_INSTALL_PACKAGE_VERSION,
  RFID_FIRST_INSTALL_PACKAGE_URL,
  REQUIRED_RFID_BRIDGE_BUILD_ID,
  REQUIRED_RFID_BRIDGE_VERSION,
  REQUIRED_RFID_WRITER_VERSION,
} from "@/lib/rfidBridgeReadiness";

const oldBridgeMetadata = {
  success: true,
  bridgeVersion: "utrust-bridge-installer-v14",
  bridgeBuildId: "utrust-rfid-installer-20261115-erase-v14",
  requiredWriterVersion: REQUIRED_RFID_WRITER_VERSION,
};
const response = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const expectNoOldInstallInstructions = (html: string) => {
  expect(html).not.toMatch(/安装包版本为\s*v17/);
  expect(html).not.toContain("utrust-first-install-v17");
  expect(html).not.toMatch(
    /内部桥接版本(?:应)?为\s*(?:v14|utrust-bridge-installer-v14)/
  );
};

afterEach(() => vi.unstubAllGlobals());

describe("写卡版本诊断面板", () => {
  it("显示本机与要求版本及现行v18安装说明，窄屏字段可换行", () => {
    const result = inspectRfidBridgeReadiness(
      { success: true, bridgeVersion: "old", bridgeBuildId: "old-build" },
      true
    );
    const html = renderToStaticMarkup(
      <RfidBridgeReadinessPanel
        result={result}
        checking={false}
        onCheck={() => {}}
      />
    );
    for (const label of [
      "old-build",
      REQUIRED_RFID_BRIDGE_VERSION,
      REQUIRED_RFID_BRIDGE_BUILD_ID,
      "Install-Yuexin-RFID-Bridge.cmd",
      `安装包版本为 ${RFID_FIRST_INSTALL_PACKAGE_VERSION}`,
      `内部桥接版本应为 ${REQUIRED_RFID_BRIDGE_VERSION}`,
      "安装结果截图",
      "不要继续启动旧快捷方式",
      "不要绕过版本检查写卡",
      "不要用",
      "break-all",
    ])
      expect(html).toContain(label);
    expectNoOldInstallInstructions(html);
  });

  it("真实v14返回仍需升级，分别显示本机v14、系统v15和安装包v18", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(oldBridgeMetadata));
    vi.stubGlobal("fetch", fetchMock);
    const result = await readRfidBridgeReadiness();
    expect(result.status).toBe("upgrade_required");
    expect(result.bridgeVersion).toBe("utrust-bridge-installer-v14");
    expect(result.bridgeBuildId).toBe(
      "utrust-rfid-installer-20261115-erase-v14"
    );
    const html = renderToStaticMarkup(
      <RfidBridgeReadinessPanel
        result={result}
        checking={false}
        onCheck={() => {}}
      />
    );
    expect(html).toContain("已停止写卡");
    expect(html).toMatch(/系统要求<\/dt><dd[^>]*>utrust-bridge-installer-v15/);
    expect(html).toMatch(/本机返回<\/dt><dd[^>]*>utrust-bridge-installer-v14/);
    expect(html).toContain("安装包版本为 utrust-first-install-v18");
    expect(html).toContain("内部桥接版本应为 utrust-bridge-installer-v15");
    expect(html).toContain("请提供安装结果截图核查");
    expect(html).toContain("不要继续启动旧快捷方式");
    expect(html).not.toContain("border-emerald-200");
    expectNoOldInstallInstructions(html);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:47601/ready",
      expect.objectContaining({ method: "GET", cache: "no-store" })
    );
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });

  it("新版v15就绪不能宣称实体卡已写入，也不显示旧安装说明", () => {
    const result = inspectRfidBridgeReadiness(
      {
        success: true,
        bridgeVersion: REQUIRED_RFID_BRIDGE_VERSION,
        bridgeBuildId: REQUIRED_RFID_BRIDGE_BUILD_ID,
        requiredWriterVersion: REQUIRED_RFID_WRITER_VERSION,
      },
      true
    );
    expect(REQUIRED_RFID_BRIDGE_VERSION).toBe("utrust-bridge-installer-v15");
    expect(result.status).toBe("ready");
    const html = renderToStaticMarkup(
      <RfidBridgeReadinessPanel
        result={result}
        checking={false}
        onCheck={() => {}}
      />
    );
    expect(html).toContain("此检测不会写卡");
    expect(html).toContain("不代表实体卡已完成写入或回读");
    expect(html).not.toMatch(/实体卡(?:已写入成功|写入成功)|写卡成功/);
    expect(html).not.toContain("安装包版本为");
    expectNoOldInstallInstructions(html);
  });

  it("点击下载仅打开现行v18URL，重检仅GET读取，不提交任务或擦卡", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    const fetchMock = vi.fn().mockResolvedValue(response(oldBridgeMetadata));
    vi.stubGlobal("fetch", fetchMock);
    const check = vi.fn(async () => {
      expect((await readRfidBridgeReadiness()).status).toBe("upgrade_required");
    });
    let view: TestRenderer.ReactTestRenderer;
    await act(async () => {
      view = TestRenderer.create(
        <RfidBridgeReadinessPanel
          result={null}
          checking={false}
          onCheck={check}
        />
      );
    });
    try {
      const buttons = view!.root.findAllByType("button");
      await act(async () => {
        buttons[1].props.onClick();
      });
      expect(check).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(open).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith(
        RFID_FIRST_INSTALL_PACKAGE_URL,
        "_blank",
        "noopener,noreferrer"
      );
      expect(open.mock.calls[0][0]).toMatch(
        /^\/manus-storage\/utrust-bridge-first-install-v18-20261115(?:_[a-f0-9]+)?\.zip$/
      );
      await act(async () => {
        await buttons[0].props.onClick();
      });
      expect(check).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("http://127.0.0.1:47601/ready");
      expect(options.method).toBe("GET");
      expect(options.cache).toBe("no-store");
      expect(options.body).toBeUndefined();
      expect(options.headers).toBeUndefined();
    } finally {
      await act(async () => view!.unmount());
    }
  });

  it.each([
    { checking: true, disabled: false },
    { checking: false, disabled: true },
    { checking: true, disabled: true },
  ])(
    "写入或检测期间禁用两个修复按钮，避免竞态：%j",
    ({ checking, disabled }) => {
      const html = renderToStaticMarkup(
        <RfidBridgeReadinessPanel
          result={null}
          checking={checking}
          disabled={disabled}
          onCheck={() => {}}
        />
      );
      expect((html.match(/disabled=""/g) || []).length).toBe(2);
      if (checking) expect(html).toContain("正在只读检测本机桥接版本");
    }
  );

  it("取消只读检测显示不可用而非卡成功，不追加写入或擦卡请求", async () => {
    const fetchMock = vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(new Error("abort")),
            { once: true }
          );
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const pending = readRfidBridgeReadiness(controller.signal);
    controller.abort();
    const result = await pending;
    expect(result.status).toBe("unavailable");
    const html = renderToStaticMarkup(
      <RfidBridgeReadinessPanel
        result={result}
        checking={false}
        onCheck={() => {}}
      />
    );
    expect(html).toContain("桥接检测超时或已取消");
    expect(html).not.toContain("border-emerald-200");
    expect(html).not.toContain("写卡成功");
    expectNoOldInstallInstructions(html);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:47601/ready");
    expect(options.method).toBe("GET");
    expect(options.body).toBeUndefined();
    expect(options.signal?.aborted).toBe(true);
  });

  it("安装包与桥接常量和真实打包器源码一致，下载URL指向v18", () => {
    const source = readFileSync(
      new URL(
        "../../../scripts/package-utrust-first-install.mjs",
        import.meta.url
      ),
      "utf8"
    );
    const packageVersion = source.match(
      /^const packageVersion = ["']([^"']+)["'];$/m
    )?.[1];
    const bridgeVersion = source.match(
      /^const bridgeVersion = ["']([^"']+)["'];$/m
    )?.[1];
    const outputFileName = source.match(
      /^const outputFile = join\(outputRoot, ["']([^"']+)["']\);$/m
    )?.[1];
    expect(RFID_FIRST_INSTALL_PACKAGE_VERSION).toBe("utrust-first-install-v18");
    expect(packageVersion).toBe(RFID_FIRST_INSTALL_PACKAGE_VERSION);
    expect(bridgeVersion).toBe(REQUIRED_RFID_BRIDGE_VERSION);
    expect(outputFileName).toBe("utrust-bridge-first-install-v18-20261115.zip");
    const downloadedFileName = RFID_FIRST_INSTALL_PACKAGE_URL.split("/").pop();
    expect(downloadedFileName?.replace(/_[a-f0-9]+(?=\.zip$)/, "")).toBe(
      outputFileName
    );
    expect(RFID_FIRST_INSTALL_PACKAGE_URL).toMatch(
      /^\/manus-storage\/utrust-bridge-first-install-v18-20261115(?:_[a-f0-9]+)?\.zip$/
    );
    expect(RFID_FIRST_INSTALL_PACKAGE_URL).not.toMatch(/-v(?:14|17)-/);
  });
});
