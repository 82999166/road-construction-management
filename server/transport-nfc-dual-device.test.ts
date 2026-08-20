import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "server/routers/operations.ts"), "utf8");

describe("运输 NFC 双设备闭环路由", () => {
  it("要求现场读卡设备先绑定项目与装卸地点，再允许双刷卡闭环", () => {
    expect(source).toContain("transportReaderDevices");
    expect(source).toContain("saveReaderDevice");
    expect(source).toContain("当前读卡设备未登记、未启用或不属于该项目");
  });

  it("装土首次刷卡创建唯一在途票据，卸土第二次刷同卡才闭环", () => {
    expect(source).toContain("nfcTransitKey");
    expect(source).toContain("nfc_load_create_transit_trip");
    expect(source).toContain("当前没有可在本卸土点闭环的在途票据");
    expect(source).toContain("nfc_unload_close_transit_trip");
  });

  it("手机 NFC 深链只解析签名令牌并委托相同双设备校验，不接收原始 UID", () => {
    expect(source).toContain("verifyTransportNfcDeepLinkToken");
    expect(source).toContain("scanNfcLink");
    expect(source).toContain("recordTransportNfcReaderScan(ctx");
  });
});
