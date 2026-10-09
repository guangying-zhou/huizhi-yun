// Isolated (/tmp disposable MySQL) rehearsal of the Codocs v2 snapshot + collaboration
// schema install: prerequisite check -> apply both migrations -> verify -> guarded
// rollback -> non-transactional partial failure. Never connects to a real database.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../../scripts/test/support/temporary-mysql-harness.mjs'

const repo = resolve(import.meta.dirname, '../../..')
const mysql = createRequire(resolve(repo, 'console/package.json'))('mysql2/promise')
const read = path => readFileSync(resolve(repo, path), 'utf8')
const statements = (text) => {
  const parts = text.split(/^-- name: ([a-z0-9-]+)\s*$/m)
  const out = {}
  for (let i = 1; i < parts.length; i += 2) out[parts[i]] = parts[i + 1].split('\n').filter(line => !line.startsWith('--')).join('\n').trim()
  return out
}
const verify = statements(read('deploy/self-hosted/schema/codocs-v2-collaboration.verify.sql'))
const rollback = statements(read('deploy/self-hosted/schema/codocs-v2-collaboration.rollback.sql'))
const snapshots = read('codocs/docs/migrations/20260920_document_snapshots.sql')
const collaboration = read('codocs/docs/migrations/20260924_document_collaboration_sessions.sql')
const TABLES = ['document_collaboration_participants', 'document_collaboration_publications', 'document_collaboration_sessions',
  'document_collaboration_tickets', 'document_snapshot_candidates', 'document_snapshot_heads']

// Production pre-state of document_versions: the current definition without object_key.
const schema = read('codocs/docs/codocs_schema.sql')
const versionsDdl = /CREATE TABLE `document_versions` \([\s\S]*?\) ENGINE=InnoDB[^;]*;/.exec(schema)[0]
const preState = versionsDdl.split('\n').filter(line => !line.includes('`object_key`')).join('\n')
assert.ok(versionsDdl.includes('`object_key`') && !preState.includes('object_key'))

const plan = await buildTemporaryMySqlPlan({ rootDir: repo })
await withTemporaryMySql(plan, async (context) => {
  const db = await mysql.createConnection({ ...context.connection('console'), multipleStatements: true })
  const rows = async name => (await db.query(verify[name]))[0]
  const names = async name => (await rows(name)).map(row => row.name)
  const showVersions = async () => (await db.query('SHOW CREATE TABLE document_versions'))[0][0]['Create Table']
  try {
    await db.query('CREATE TABLE `documents` (`id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY) ENGINE=InnoDB')
    await db.query(preState)
    await db.query('INSERT INTO documents VALUES (1)')
    await db.query("INSERT INTO document_versions (document_id, version_num, oss_version_id, editor_uid) VALUES (1, 1, 'v1', 'u1')")
    const original = await showVersions()

    // Prerequisites: v1 baseline present, v2 column absent, no v2 tables.
    assert.deepEqual(await names('prerequisite-columns'), ['content_sha256', 'oss_version_id'])
    assert.deepEqual(await rows('tables'), [])

    // Install (two files, in order). Existing history rows stay valid with object_key NULL.
    await db.query(snapshots)
    await db.query(collaboration)
    assert.deepEqual(await names('tables'), TABLES)
    assert.deepEqual((await rows('object-key-column')).map(row => [row.type, row.nullable]), [['varchar(512)', 'YES']])
    for (const row of await rows('primary-keys')) assert.match(row.key_columns, /^tenant_code,deployment_code,/, row.name)
    assert.deepEqual(await names('check-constraints'), ['collaboration_session_epoch', 'snapshot_candidate_generation',
      'snapshot_candidate_publication', 'snapshot_head_generation', 'snapshot_head_publication'])
    assert.deepEqual(await rows('charset-collation'), [])
    const [[legacy]] = await db.query('SELECT object_key FROM document_versions WHERE document_id = 1')
    assert.equal(legacy.object_key, null)
    // The installed shape matches codocs_schema.sql: each migration statement appears there verbatim.
    const normalise = text => text.replace(/\s+/g, ' ')
    for (const statement of [...snapshots.matchAll(/CREATE TABLE [\s\S]*?\) ENGINE=InnoDB;/g), ...collaboration.matchAll(/CREATE TABLE [\s\S]*?\) ENGINE=InnoDB;/g)]) {
      assert.ok(normalise(schema).includes(normalise(statement[0])), statement[0].slice(0, 60))
    }

    // Re-running the install is refused by MySQL (no silent overwrite).
    await assert.rejects(db.query(snapshots), /already exists/)

    // Rollback precondition: a v2 head blocks it; the operator rule is "all four counts are 0".
    const precondition = async () => Object.values((await rows('rollback-precondition'))[0]).map(Number)
    assert.deepEqual(await precondition(), [0, 0, 0, 0])
    await db.query("INSERT INTO document_snapshot_heads VALUES ('C000001','C000001-codocs','11111111-1111-1111-1111-111111111111',1,0,REPEAT('a',64),JSON_OBJECT('markdown',JSON_OBJECT('key','k','version','v')))")
    assert.deepEqual(await precondition(), [1, 0, 0, 0])
    await db.query('DELETE FROM document_snapshot_heads')
    await db.query("UPDATE document_versions SET object_key = 'x' WHERE document_id = 1")
    assert.deepEqual(await precondition(), [0, 0, 0, 1])
    await db.query('UPDATE document_versions SET object_key = NULL WHERE document_id = 1')
    assert.deepEqual(await precondition(), [0, 0, 0, 0])

    // Rollback restores the exact pre-state (table set and document_versions definition and data).
    for (const [name, statement] of Object.entries(rollback)) { assert.ok(statement, name); await db.query(statement) }
    assert.deepEqual(await rows('tables'), [])
    assert.deepEqual(await rows('object-key-column'), [])
    assert.equal(await showVersions(), original)
    assert.equal((await db.query('SELECT COUNT(*) AS n FROM document_versions'))[0][0].n, 1)
    // Rollback is repeatable on an already clean schema except the column drop (fails, changes nothing).
    for (const name of Object.keys(rollback).filter(name => name !== 'drop-object-key')) await db.query(rollback[name])
    await assert.rejects(db.query(rollback['drop-object-key']), /check that column/)

    // DDL is not transactional: a mid-file failure leaves the earlier tables in place.
    await db.query('CREATE TABLE document_collaboration_tickets (x INT)')
    await assert.rejects(db.query(collaboration), /already exists/)
    assert.deepEqual(await names('tables'), ['document_collaboration_sessions', 'document_collaboration_tickets'], 'sessions was created before the failure')
    await db.query('DROP TABLE document_collaboration_tickets')
    await db.query('DROP TABLE document_collaboration_sessions')
    assert.deepEqual(await rows('tables'), [])
    console.log(JSON.stringify({ fixture: '/tmp disposable MySQL', prerequisites: 'PASS', install: 'PASS', verify: 'PASS', schemaSqlParity: 'PASS', rollbackPrecondition: 'PASS', rollback: 'PASS', partialFailure: 'PASS' }))
  } finally { await db.end() }
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
