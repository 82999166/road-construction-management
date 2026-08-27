import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "client/src/pages/MobileMessagesPage.tsx"), "utf8");

describe("移动消息详情交互", () => {
  it("先展示消息详情，再由明确按钮进入关联业务", () => {
    expect(source).toContain("setSelectedMessage(message)");
    expect(source).toContain("查看详情");
    expect(source).toContain("打开关联业务");
    expect(source).not.toContain("if (message.deepLink) navigate(message.deepLink)");
  });
});
