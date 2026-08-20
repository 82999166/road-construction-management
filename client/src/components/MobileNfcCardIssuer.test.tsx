import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "client/src/components/MobileNfcCardIssuer.tsx"), "utf8");

describe("手机 NFC 发卡", () => {
  it("全新卡应直接选择未发卡车辆，并由服务端创建首次写卡任务而不依赖 Windows 写卡器", () => {
    expect(source).toContain("prepareMobileNfcInitialIssue");
    expect(source).toContain("selectedVehicle.id");
    expect(source).toContain("!activeCardVehicleIds.has(vehicle.id)");
    expect(source).toContain("全新空白 NTAG216 不需要预先绑定");
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

  it("待发卡车辆应自动选中；无可发车辆或查询失败时必须显示可操作原因", () => {
    expect(source).toContain("eligibleVehicles[0].id");
    expect(source).toContain("当前没有可首次发卡的车辆");
    expect(source).toContain("无法读取车辆台账");
    expect(source).toContain("正在读取待发卡车辆");
  });
});
