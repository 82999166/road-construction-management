import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("移动端运输 NFC 入口收敛", () => {
  it("不再展示手机首次发卡，只保留已签发卡的直达发票确认", () => {
    const source = readFileSync(new URL("./MobileTransportPage.tsx", import.meta.url), "utf8");
    expect(source).not.toContain('import { MobileNfcCardIssuer }');
    expect(source).not.toContain("<MobileNfcCardIssuer");
    expect(source).toContain("NFC 运输发票确认");
    expect(source).toContain("确认开具发票");
    expect(source).toContain("拍照车牌发票");
  });
});
