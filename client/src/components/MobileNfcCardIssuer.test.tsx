import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "client/src/components/MobileNfcCardIssuer.tsx"), "utf8");

describe("手机 NFC 发卡", () => {
  it("只对已绑定车辆生成服务端受控写卡任务，并明确不关联 Windows 写卡器", () => {
    expect(source).toContain("prepareRfidCardWrite");
    expect(source).toContain("writerDeviceId: null");
    expect(source).toContain("selectedCard.id");
  });

  it("必须写入受控深链和签名车辆载荷，并在成功后确认服务端写卡审计", () => {
    expect(source).toContain("task.nfcEntryUrl");
    expect(source).toContain("JSON.stringify(task.payload)");
    expect(source).toContain("confirmRfidCardWrite");
    expect(source).toContain("success: true");
  });

  it("不支持 Web NFC 的浏览器不得伪造发卡成功，应展示 Android Chrome 兼容提示", () => {
    expect(source).toContain("NDEFWriter");
    expect(source).toContain("Android Chrome");
    expect(source).toContain("拍车牌发票");
  });

  it("已启用车辆卡应自动选中；无卡或查询失败时必须显示可操作原因", () => {
    expect(source).toContain("eligibleCards[0].id");
    expect(source).toContain("当前项目没有已启用的车辆卡");
    expect(source).toContain("无法读取车辆卡");
    expect(source).toContain("正在读取已绑定车辆卡");
  });
});
