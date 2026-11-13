import { describe, expect, it } from "vitest";
import {
  constructionHistoryDate,
  constructionHistoryKeyword,
  constructionPreviewValue,
} from "./constructionSmartInput";
import { constructionAudioMime } from "./constructionSmartInputApi";

describe("施工智能输入安全工具", () => {
  it("历史联想取末个非空行，最多100字，不发送完整8000字正文", () => {
    expect(constructionHistoryKeyword("前工序\n 新工序 \n \n")).toBe("新工序");
    expect(constructionHistoryKeyword("施".repeat(8000))).toBe(
      "施".repeat(100)
    );
    expect(constructionHistoryKeyword(" \r\n")).toBe("");
  });
  it("追加、替换长度按原输入规则，超长不静默截断", () => {
    expect(constructionPreviewValue("甲", "乙", "append", 3)).toEqual({
      text: "甲\n乙",
    });
    expect(constructionPreviewValue("甲", "乙", "replace", 1)).toEqual({
      text: "乙",
    });
    expect(constructionPreviewValue("甲", "乙", "append", 2)).toEqual({
      text: "甲\n乙",
      error: expect.stringContaining("超过 2 字"),
    });
  });
  it("支持webm/ogg/mp4参数化MIME，对未知格式拒绝假转写", () => {
    expect(constructionAudioMime("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(constructionAudioMime("audio/ogg;codecs=opus")).toBe("audio/ogg");
    expect(constructionAudioMime("audio/mp4")).toBe("audio/mp4");
    expect(() => constructionAudioMime("video/mpeg")).toThrow(
      "当前录音格式不支持"
    );
  });
  it("异常日期不能伪造使用日期", () => {
    expect(constructionHistoryDate("invalid")).toBe("日期未知");
    expect(constructionHistoryDate(new Date("2026-11-10T00:00:00Z"))).toContain(
      "2026"
    );
  });
});
