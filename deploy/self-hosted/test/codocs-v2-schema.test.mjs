import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repo = join(fileURLToPath(new URL('.', import.meta.url)), '../../..')
const read = path => readFile(join(repo, path), 'utf8')
const created = text => [...text.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?`?([a-z_]+)`?/g)].map(match => match[1])

test('the install checklist names exactly the tables and column the migrations create', async () => {
  const snapshots = await read('codocs/docs/migrations/20260920_document_snapshots.sql')
  const collaboration = await read('codocs/docs/migrations/20260924_document_collaboration_sessions.sql')
  const tables = [...created(snapshots), ...created(collaboration)].sort()
  assert.equal(tables.length, 6)
  assert.match(snapshots, /ALTER TABLE document_versions ADD COLUMN object_key VARCHAR\(512\) NULL AFTER oss_version_id/)
  const runbook = await read('docs/Go-Live-Self-Hosted-Data-Migration-Runbook.md')
  const section = runbook.slice(runbook.indexOf('### 3a. Codocs v2 协作 schema 安装清单'), runbook.indexOf('## 4. Runtime 迁移要素'))
  assert.match(section, /待批准，未执行/)
  for (const table of tables) assert.ok(section.includes(`\`${table}\``), `${table} listed in the runbook`)
  for (const file of ['20260920_document_snapshots.sql', '20260924_document_collaboration_sessions.sql', 'codocs-v2-collaboration.verify.sql', 'codocs-v2-collaboration.rollback.sql']) assert.ok(section.includes(file), file)
  assert.match(section, /合计 \*\*6 张新表 \+ 1 个新列\*\*/)
  assert.match(section, /DDL 不可事务回滚/)
  assert.match(section, /mysqldump --single-transaction/)

  const verify = await read('deploy/self-hosted/schema/codocs-v2-collaboration.verify.sql')
  const rollback = await read('deploy/self-hosted/schema/codocs-v2-collaboration.rollback.sql')
  const quoted = text => new Set([...text.matchAll(/'(document_(?:snapshot|collaboration)_[a-z_]+)'/g)].map(match => match[1]))
  assert.deepEqual([...quoted(verify)].sort(), tables)
  assert.deepEqual([...rollback.matchAll(/DROP TABLE IF EXISTS ([a-z_]+)/g)].map(match => match[1]).sort(), tables)
  assert.match(rollback, /ALTER TABLE document_versions DROP COLUMN object_key/)
  // Children first: publications/participants/tickets/sessions before candidates/heads, then the column.
  const order = [...rollback.matchAll(/^(?:DROP TABLE IF EXISTS|ALTER TABLE) ([a-z_]+)/gm)].map(match => match[1])
  assert.deepEqual(order.at(-1), 'document_versions')
  assert.ok(order.indexOf('document_collaboration_sessions') < order.indexOf('document_snapshot_heads'))
  assert.ok(order.indexOf('document_collaboration_publications') < order.indexOf('document_collaboration_sessions'))
  // No part of the collaboration install is mutating outside these files: verify is read-only.
  assert.doesNotMatch(verify.split('\n').filter(line => !line.startsWith('--')).join('\n'), /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE)\b/i)
})

test('the schema reference file carries the same definitions the migrations install', async () => {
  const schema = (await read('codocs/docs/codocs_schema.sql')).replace(/\s+/g, ' ')
  for (const file of ['codocs/docs/migrations/20260920_document_snapshots.sql', 'codocs/docs/migrations/20260924_document_collaboration_sessions.sql']) {
    // Later migrations (20260929 department collaboration) extend these tables in
    // the reference file, so compare each definition line rather than the whole
    // statement: every column/key the migration installs must still be declared.
    for (const statement of (await read(file)).matchAll(/CREATE TABLE [\s\S]*?\) ENGINE=InnoDB;/g)) {
      const lines = statement[0].split('\n').slice(1, -1).map(line => line.trim().replace(/,$/, '')).filter(Boolean)
      for (const line of lines) assert.ok(schema.includes(line.replace(/\s+/g, ' ')), `${file}: ${line.slice(0, 60)}`)
    }
  }
  const department = await read('codocs/docs/migrations/20260929_department_collaboration.sql')
  for (const column of department.matchAll(/ADD COLUMN ([a-z_]+) /g)) assert.ok(schema.includes(`${column[1]} `), `department migration column ${column[1]}`)
  assert.match(schema, /`object_key` VARCHAR\(512\) NULL/)
})

test('Runtime reads these tables optionally, so schema status cannot prove the install (checklist is the only gate)', async () => {
  const adapter = await read('data-runtime/internal/apps/codocs/adapter.go')
  const required = adapter.slice(adapter.indexOf('var requiredTables'), adapter.indexOf('}', adapter.indexOf('var requiredTables')))
  assert.doesNotMatch(required, /document_snapshot|document_collaboration/)
  assert.match(await read('data-runtime/internal/apps/codocs/document_snapshot_guard.go'), /isMissingTable/)
})
