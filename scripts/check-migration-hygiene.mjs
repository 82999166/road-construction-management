import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'drizzle');
const journalPath = join(migrationsDir, 'meta', '_journal.json');
const migrationFiles = readdirSync(migrationsDir)
  .filter(file => /^\d{4}_.+\.sql$/.test(file))
  .sort();

const prefixes = new Map();
for (const file of migrationFiles) {
  const prefix = file.slice(0, 4);
  prefixes.set(prefix, [...(prefixes.get(prefix) ?? []), file]);
}

const duplicatePrefixes = [...prefixes.entries()].filter(([, files]) => files.length > 1);
if (duplicatePrefixes.length > 0) {
  console.error('发现重复迁移编号：');
  for (const [prefix, files] of duplicatePrefixes) {
    console.error(`- ${prefix}: ${files.join(', ')}`);
  }
  process.exit(1);
}

const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
const missingJournalFiles = journal.entries
  .map(entry => `${entry.tag}.sql`)
  .filter(file => !existsSync(join(migrationsDir, file)));

if (missingJournalFiles.length > 0) {
  console.error(`迁移日志引用了缺失文件：${missingJournalFiles.join(', ')}`);
  process.exit(1);
}

console.log(`迁移卫生检查通过：${migrationFiles.length} 个迁移文件，${journal.entries.length} 条日志记录。`);
