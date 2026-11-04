import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = readFileSync(
  new URL("./routers/finance.ts", import.meta.url),
  "utf8"
);
describe("每日日结与统一付款项目互斥", () => {
  for (const procedure of ["closeDailyAccount", "reopenDailyAccount"]) {
    it(`${procedure}在事务中先锁项目，再读封账行并锁行，不以不存在封账行为可并发依据`, () => {
      const start = source.indexOf(`  ${procedure}: protectedProcedure`);
      const next = source.indexOf("\n  ", source.indexOf("    }),", start) + 1);
      const block = source
        .slice(start, next < 0 ? undefined : next)
        .replace(/\s+/g, "");
      expect(start).toBeGreaterThan(0);
      expect(block).toContain("returndb.transaction(asynctx=>{");
      const projectLock =
        'await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, input.projectId)).for("update")'.replace(
          /\s+/g,
          ""
        );
      expect(block).toContain(projectLock);
      expect(block.indexOf(projectLock)).toBeLessThan(
        block.indexOf(".from(dailyAccountingClosures)")
      );
      expect(block).toContain('.limit(1).for("update")');
      expect(block).toContain(
        "assertProjectInCurrentScope(ctx,input.projectId)"
      );
    });
  }
});
