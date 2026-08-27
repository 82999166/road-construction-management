import { describe, expect, it } from "vitest";
import { buildFullContractTemplatePrintHtml } from "./FullContractTemplates";

describe("完整合同模板独立打印", () => {
  it("仅输出当前编辑正文并对 HTML 特殊字符转义", () => {
    const html = buildFullContractTemplatePrintHtml("合同正文\n<未经转义的标签>");

    expect(html).toContain("合同模板预览");
    expect(html).toContain("合同正文<br />&lt;未经转义的标签&gt;");
    expect(html).toContain("仅供合同草案核对，不写入合同台账");
  });
});
