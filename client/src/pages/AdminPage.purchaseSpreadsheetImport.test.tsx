import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "client/src/pages/AdminPage.tsx"), "utf8");

describe("采购仓储 Excel 导入界面", () => {
  it("提供系统模板下载与管理员确认导入入口", () => {
    expect(source).toContain("下载导入模板");
    expect(source).toContain("导入 Excel");
    expect(source).toContain("导入采购仓储 Excel 数据");
    expect(source).toContain("确认导入并写入台账");
  });

  it("模板和预检覆盖采购订单、库存流水以及北京时间填写说明", () => {
    expect(source).toContain("采购订单导入");
    expect(source).toContain("库存流水导入");
    expect(source).toContain("填写说明");
    expect(source).toContain("所有时间按北京时间处理");
    expect(source).toContain("采购类别（必填）");
    expect(source).toContain("收发类型（入库/领用出库/退库）");
  });

  it("浏览器预检要求 xlsx、阻断空文件与超量记录", () => {
    expect(source).toContain("请上传由模板保存的 .xlsx Excel 文件");
    expect(source).toContain("文件中没有可导入的数据行");
    expect(source).toContain("单次最多导入 500 条记录");
    expect(source).toContain("订单金额须等于数量×单价");
  });
});
