import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("渣土车按趟结算", () => {
  const schema = readFileSync(
    new URL("../drizzle/schema.ts", import.meta.url),
    "utf8"
  );
  const adminRouter = readFileSync(
    new URL("./routers/admin.ts", import.meta.url),
    "utf8"
  );
  const operations = readFileSync(
    new URL("./routers/operations.ts", import.meta.url),
    "utf8"
  );

  it("在车辆资源性质中持久化按趟结算类型，同时保留自有和外租历史值", () => {
    expect(schema.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")).toContain(
      'mysqlEnum("ownership", ["owned", "leased", "trip_settlement"])'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      adminRouter.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      'z.enum(["owned", "leased", "trip_settlement"])'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });

  it("只允许外租车辆参与租赁规则估算，按趟结算车辆租金始终为零", () => {
    expect(
      operations.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      'vehicle.ownership === "leased" ? allLeaseRules.filter'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      operations.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      'vehicle.ownership === "leased" ? db.select().from(transportVehicleLeaseRules)'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
    expect(
      adminRouter.replace(/\s+/g, "").replace(/,([})\]])/g, "$1")
    ).toContain(
      'input.ownership === "trip_settlement" ? "，渣土车按趟结算且不计租金"'
        .replace(/\s+/g, "")
        .replace(/,([})\]])/g, "$1")
    );
  });
});
