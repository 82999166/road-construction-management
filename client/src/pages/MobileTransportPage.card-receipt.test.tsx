import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "client/src/pages/MobileTransportPage.tsx"), "utf8");

describe("移动运输刷卡现场回执", () => {
  it("在服务端确认后保留司机可见现场回执，并不承诺服务号持续外发", () => {
    expect(source).toContain("fieldCardReceipt");
    expect(source).toContain("请向司机展示现场回执");
    expect(source).toContain("今日第 ${ordinal} 车");
    expect(source).toContain("vehiclePlateNo");
    expect(source).toContain("getSafeCardValidationReason(result.reason)");
    expect(source).not.toContain("已向司机和主管发送服务号提醒");
  });
});
