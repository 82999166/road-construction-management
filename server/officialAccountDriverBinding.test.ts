import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import {
  buildWechatTextReplyXml,
  isDriverBindingKeyword,
  normalizeDriverPlateNo,
  parseWechatPlainTextMessage,
  verifyOfficialAccountEventSignature,
} from "./services/officialAccountDriverBinding";

describe("外部司机服务号绑定消息处理", () => {
  it("只把明确的绑定关键词识别为司机绑定入口", () => {
    expect(isDriverBindingKeyword("绑定")).toBe(true);
    expect(isDriverBindingKeyword(" 司机 绑定 ")).toBe(true);
    expect(isDriverBindingKeyword("车辆绑定")).toBe(true);
    expect(isDriverBindingKeyword("我要结算")).toBe(false);
    expect(isDriverBindingKeyword("绑定一下别的功能")).toBe(false);
  });

  it("按微信明文消息规则校验 Token、timestamp、nonce 签名", () => {
    const token = "RoadToken2026";
    const timestamp = "1787449999";
    const nonce = "abc123";
    const signature = createHash("sha1").update([token, timestamp, nonce].sort().join(""), "utf8").digest("hex");

    expect(verifyOfficialAccountEventSignature({ token, timestamp, nonce, signature })).toBe(true);
    expect(verifyOfficialAccountEventSignature({ token, timestamp, nonce, signature: signature.replace(/.$/, "0") })).toBe(false);
  });

  it("解析微信文本消息 XML 时不泄露 OpenID，只返回业务所需字段", () => {
    const parsed = parseWechatPlainTextMessage("<xml><ToUserName><![CDATA[gh_test]]></ToUserName><FromUserName><![CDATA[user_openid]]></FromUserName><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[绑定]]></Content></xml>");

    expect(parsed).toMatchObject({ toUserName: "gh_test", fromUserName: "user_openid", msgType: "text", content: "绑定" });
  });

  it("生成被动回复 XML 时会安全处理 CDATA 结束符", () => {
    const xml = buildWechatTextReplyXml({ toUserName: "driver", fromUserName: "service", content: "绑定链接 ]]> 测试" });

    expect(xml).toContain("<MsgType><![CDATA[text]]></MsgType>");
    expect(xml).toContain("]]]]><![CDATA[>");
  });

  it("车牌输入归一化会去掉空格和分隔符并转大写", () => {
    expect(normalizeDriverPlateNo(" 湘 a·12345 ")).toBe("湘A12345");
    expect(normalizeDriverPlateNo("川-b_98765")).toBe("川B98765");
  });
});
