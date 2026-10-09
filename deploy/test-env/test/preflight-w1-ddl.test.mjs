import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { inspectW1DdlPermissions, W1_DDL_REQUIREMENTS, W1_ALTER_TABLES } from '../preflight-w1-ddl.mjs'

const schemaPrivileges = ['SELECT', 'CREATE', 'DROP', 'REFERENCES', 'INDEX', 'CREATE VIEW', 'SHOW VIEW']
function connection({ schema = schemaPrivileges, tables = [], roles = 'NONE', account = 'hzy_apf_migration@127.0.0.1', fail = false } = {}) {
  const calls = []
  return { calls,
    async query(sql) {
      calls.push(sql)
      assert.match(sql, /^SELECT /)
      if (fail) throw new Error('driver-private-values')
      return [[{ account, roles }]]
    },
    async execute(sql, params) {
      calls.push(sql)
      assert.match(sql, /^SELECT /)
      assert.equal(params[0], "'hzy_apf_migration'@'127.0.0.1'")
      if (sql.includes('USER_PRIVILEGES')) return [[]]
      if (sql.includes('SCHEMA_PRIVILEGES')) return [schema.map(privilege => ({ privilege }))]
      return [tables]
    }
  }
}
test('current grants report exactly five missing ALTER privileges without any write', async () => {
  const db = connection()
  const result = await inspectW1DdlPermissions(db)
  assert.equal(result.ready, false)
  assert.deepEqual(result.missing, W1_ALTER_TABLES.map(table => ({ table, privilege: 'ALTER' })))
  assert.equal(db.calls.length, 4)
})
test('five exact table ALTER grants suffice; one missing table still blocks', async () => {
  const tables = W1_ALTER_TABLES.map(tableName => ({ tableName, privilege: 'ALTER' }))
  assert.equal((await inspectW1DdlPermissions(connection({ tables }))).ready, true)
  const result = await inspectW1DdlPermissions(connection({ tables: tables.slice(1) }))
  assert.deepEqual(result.missing, [{ table: W1_ALTER_TABLES[0], privilege: 'ALTER' }])
})
test('an adjacent-table ALTER does not satisfy the target table', async () => {
  const result = await inspectW1DdlPermissions(connection({ tables: [{ tableName: 'finance_bank_account_other', privilege: 'ALTER' }] }))
  assert.equal(result.missing.length, 5)
})
test('CREATE, DROP, INDEX, REFERENCES and baseline permissions also block when missing', async () => {
  for (const privilege of schemaPrivileges.filter(x => x !== 'CREATE VIEW')) {
    const result = await inspectW1DdlPermissions(connection({ schema: [...schemaPrivileges.filter(x => x !== privilege), 'ALTER'] }))
    assert.equal(result.ready, false, privilege)
    assert(result.missing.some(x => x.privilege === privilege), privilege)
  }
})
test('account mismatch, active roles and dependency errors fail closed', async () => {
  await assert.rejects(inspectW1DdlPermissions(connection({ account: 'root@localhost' })), /account_mismatch/)
  await assert.rejects(inspectW1DdlPermissions(connection({ roles: '`some-role`@`%`' })), /roles_unsupported/)
  await assert.rejects(inspectW1DdlPermissions(connection({ fail: true })))
})
test('new-table DDL checks cover the exact canonical W1 table set', async () => {
  const canonical = JSON.parse(await readFile(new URL('../../../data-runtime/internal/enterprise/domaininstall/w1_tables.json', import.meta.url), 'utf8'))
  const names = Object.values(canonical).flat().map(x => x.Physical).sort()
  assert.deepEqual(W1_DDL_REQUIREMENTS.filter(x => x.privilege === 'CREATE').map(x => x.table).sort(), names)
})

test('full migration gate collects identity failures even when DDL is unavailable', async () => {
  const { inspectMigrationReadiness } = await import('../preflight-w1-ddl.mjs')
  let called = 0
  const result = await inspectMigrationReadiness({ query: async () => { throw new Error('driver secret') } }, async () => {
    called++
    return { ready: false, checks: [{ name: 'target', ready: false, code: 'target_not_ready' }, { name: 'directory', ready: false, code: 'directory_not_ready' }] }
  })
  assert.equal(called, 1)
  assert.equal(result.ready, false)
  assert.equal(result.ddl.code, 'w1_ddl_not_ready')
  assert.equal(result.identities.checks.length, 2)
  assert.ok(!JSON.stringify(result).includes('driver secret'))
})
