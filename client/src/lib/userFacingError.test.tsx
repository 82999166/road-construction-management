import { describe, expect, it } from "vitest";
import { getUserFacingErrorMessage } from "./userFacingError";

describe("getUserFacingErrorMessage", () => {
  it("保留可操作的中文业务校验说明", () => {
    expect(
      getUserFacingErrorMessage(new Error("请先选择已授权项目"), "读取失败")
    ).toBe("请先选择已授权项目");
  });

  it("不向用户展示英文网络、内部编码或 SQL 诊断", () => {
    expect(
      getUserFacingErrorMessage(new Error("Failed to fetch"), "台账暂不可用")
    ).toBe("台账暂不可用");
    expect(
      getUserFacingErrorMessage(
        new Error("bridge_write_reader_connection_failed"),
        "写卡未完成"
      )
    ).toBe("写卡未完成");
    expect(
      getUserFacingErrorMessage(
        new Error("ER_ACCESS_DENIED_ERROR: access denied"),
        "服务暂不可用"
      )
    ).toBe("服务暂不可用");
  });
});
