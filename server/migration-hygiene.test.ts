import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('迁移治理', () => {
  it('迁移编号唯一且Drizzle日志指向存在的文件', () => {
    const output = execFileSync('node', ['scripts/check-migration-hygiene.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(output).toContain('迁移卫生检查通过');
  });
});
