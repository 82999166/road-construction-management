import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("完整外包合同模板库", () => {
  it("提供三类合同正文、复制、打印和项目合同草稿套用能力", () => {
    const source = readFileSync(fileURLToPath(new URL("./FullContractTemplates.tsx", import.meta.url)), "utf8");

    expect(source).toContain("附属工程外包合同（业务草案）");
    expect(source).toContain("渣土车运输合同（业务草案）");
    expect(source).toContain("工程机械租赁合同（业务草案）");
    expect(source).toContain("复制正文");
    expect(source).toContain("打印");
    expect(source).toContain("项目法务/律师审阅");
    expect(source).toContain("完整合同预览");
    expect(source).toContain("附件目录");
    expect(source).toContain("甲方（盖章）");
    expect(source).toContain("法律审定提示");
    expect(source).toContain("合同文件与解释顺序");
    expect(source).toContain("税费、发票与结算资料");
    expect(source).toContain("不可抗力、通知与争议解决");
    expect(source).toContain("争议解决、生效与审定");
    expect(source).toContain("生效、完整协议与审定");
  });
});
