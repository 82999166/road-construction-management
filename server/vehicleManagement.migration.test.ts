import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
const source = readFileSync(
  new URL("../scripts/apply-vehicle-management-migration.mjs", import.meta.url),
  "utf8"
);
const definitions = source.slice(
  source.indexOf("const allowedTables"),
  source.indexOf("try {")
);
const helpers = runInNewContext(
  definitions + ";({cleanType,cleanDefault,assertColumns,assertIndex});"
) as {
  cleanType(value: unknown): string;
  cleanDefault(value: unknown): string | null;
  assertColumns(actual: unknown[], expected: unknown[]): void;
  assertIndex(
    actual: unknown[],
    name: string,
    fields: string[],
    unique: boolean
  ): void;
};
describe("0094车辆迁移：等价元数据不误报、结构漂移不放行", () => {
  it("MySQL now()与开发库CURRENT_TIMESTAMP仅为等价表达", () => {
    for (const value of [
      "(now())",
      "now()",
      "CURRENT_TIMESTAMP",
      "current_timestamp()",
    ])
      expect(helpers.cleanDefault(value)).toBe("current_timestamp");
    expect(helpers.cleanDefault("2020-01-01")).not.toBe("current_timestamp");
    expect(helpers.cleanDefault(null)).toBeNull();
  });
  it("自增元数据使用显式extraValue别名，缺失自增依然拒绝", () => {
    const expected = [
      {
        name: "id",
        type: "int",
        nullable: "NO",
        defaultValue: null,
        autoIncrement: true,
      },
    ];
    expect(() =>
      helpers.assertColumns(
        [
          {
            name: "id",
            type: "int(11)",
            nullable: "NO",
            defaultValue: null,
            extraValue: "auto_increment",
          },
        ],
        expected
      )
    ).not.toThrow();
    expect(() =>
      helpers.assertColumns(
        [
          {
            name: "id",
            type: "int",
            nullable: "NO",
            defaultValue: null,
            extraValue: "",
          },
        ],
        expected
      )
    ).toThrow("EXISTING_SHAPE_MISMATCH");
    expect(source).toContain("extra AS extraValue");
  });
  it("时间默认值、空值属性和类型都仍严格核验", () => {
    const expected = [
      {
        name: "createdAt",
        type: "timestamp",
        nullable: "NO",
        defaultValue: "(now())",
        autoIncrement: false,
      },
    ];
    const actual = {
      name: "createdAt",
      type: "timestamp",
      nullable: "NO",
      defaultValue: "now()",
      extraValue: "DEFAULT_GENERATED",
    };
    expect(() => helpers.assertColumns([actual], expected)).not.toThrow();
    expect(() =>
      helpers.assertColumns([{ ...actual, type: "datetime" }], expected)
    ).toThrow("EXISTING_SHAPE_MISMATCH");
    expect(() =>
      helpers.assertColumns([{ ...actual, nullable: "YES" }], expected)
    ).toThrow("EXISTING_SHAPE_MISMATCH");
    expect(() =>
      helpers.assertColumns([{ ...actual, defaultValue: null }], expected)
    ).toThrow("EXISTING_SHAPE_MISMATCH");
  });
  it("唯一键及复合索引顺序漂移依然拒绝", () => {
    const rows = [
      { name: "test_unique", columnName: "vehicleId", nonUnique: 0 },
      { name: "test_unique", columnName: "version", nonUnique: 0 },
    ];
    expect(() =>
      helpers.assertIndex(rows, "test_unique", ["vehicleId", "version"], true)
    ).not.toThrow();
    expect(() =>
      helpers.assertIndex(rows, "test_unique", ["version", "vehicleId"], true)
    ).toThrow("EXISTING_SHAPE_MISMATCH");
    expect(() =>
      helpers.assertIndex(rows, "test_unique", ["vehicleId", "version"], false)
    ).toThrow("EXISTING_SHAPE_MISMATCH");
  });
});
