import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import RfidBridgeReadinessPanel from "./RfidBridgeReadinessPanel";
import {
  inspectRfidBridgeReadiness,
  RFID_FIRST_INSTALL_PACKAGE_URL,
  REQUIRED_RFID_BRIDGE_BUILD_ID,
  REQUIRED_RFID_BRIDGE_VERSION,
  REQUIRED_RFID_WRITER_VERSION,
} from "@/lib/rfidBridgeReadiness";
afterEach(() => vi.unstubAllGlobals());
describe("写卡版本诊断面板", () => {
  it("显示本机与要求版本及真实ZIP入口，窄屏字段可换行", () => {
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
      "安装包版本为 v16",
      "内部桥接版本为 v13",
      "不要用",
      "break-all",
    ])
      expect(html).toContain(label);
  });
  it("新版就绪不能宣称实体卡已写入", () => {
    const result = inspectRfidBridgeReadiness(
      {
        success: true,
        bridgeVersion: REQUIRED_RFID_BRIDGE_VERSION,
        bridgeBuildId: REQUIRED_RFID_BRIDGE_BUILD_ID,
        requiredWriterVersion: REQUIRED_RFID_WRITER_VERSION,
      },
      true
    );
    const html = renderToStaticMarkup(
      <RfidBridgeReadinessPanel
        result={result}
        checking={false}
        onCheck={() => {}}
      />
    );
    expect(html).toContain("不代表实体卡已完成写入或回读");
  });
  it("点击重检只调用只读回调，下载安装包不提交任务或擦卡", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    const check = vi.fn();
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
    const buttons = view!.root.findAllByType("button");
    await act(async () => {
      buttons[0].props.onClick();
      buttons[1].props.onClick();
    });
    expect(check).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      RFID_FIRST_INSTALL_PACKAGE_URL,
      "_blank",
      "noopener,noreferrer"
    );
    await act(async () => view!.unmount());
  });
  it("写入或检测期间禁用修复按钮，避免操作竞态", () => {
    const html = renderToStaticMarkup(
      <RfidBridgeReadinessPanel
        result={null}
        checking={true}
        disabled={true}
        onCheck={() => {}}
      />
    );
    expect((html.match(/disabled=""/g) || []).length).toBe(2);
  });
});
