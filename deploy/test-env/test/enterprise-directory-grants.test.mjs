import test from 'node:test'
import assert from 'node:assert/strict'
import { inspect, repair, capabilities } from '../enterprise-directory-grants.mjs'

test('grant check rejects revoked, duplicate and mismatched identities or audiences', () => {
  const row = { id: 1, resource_code: 'console:business-domain', action: 'view', status: 'active', scope_json: { tenantCode: 'C000001', deploymentCode: 'C000001-test-enterprise', audience: 'console', semanticScope: 'console:business-domain:view' } }
  assert.equal(inspect([row])[1].state, 'active')
  assert.throws(() => inspect([{ ...row, status: 'revoked' }]), /REVOKED/)
  assert.throws(() => inspect([row, row]), /DUPLICATE/)
  for (const key of Object.keys(row.scope_json)) assert.throws(() => inspect([{ ...row, scope_json: { ...row.scope_json, [key]: 'wrong' } }]), /CONFLICT/)
})

test('repair adds only missing exact grants, is idempotent, and rolls back write failures', async () => {
  for (const fail of [false, true]) {
    let rows = [], saved, commits = 0
    const db = {
      beginTransaction: async () => { saved = structuredClone(rows) },
      commit: async () => { commits++ },
      rollback: async () => { rows = saved },
      query: async (sql, values) => {
        if (sql.includes('FROM service_clients')) return [[{ id: 10, app_code: 'enterprise', status: 'active', current_credential_id: 8 }]]
        if (sql.startsWith('SELECT')) return [structuredClone(rows)]
        if (fail && rows.length) throw Error('fixture failure')
        const id = rows.length + 1
        rows.push({ id, resource_code: values[1], action: values[2], scope_json: values[3], status: 'active' })
        return [{ insertId: id }]
      }
    }
    assert.equal((await repair(db)).grants.filter(g => g.state === 'missing').length, 2)
    assert.equal(rows.length, 0)
    if (fail) { await assert.rejects(repair(db, true)); assert.equal(rows.length, 0); assert.equal(commits, 0) }
    else {
      assert.deepEqual((await repair(db, true)).added.map(item => item.capability), capabilities)
      assert.equal((await repair(db, true)).added.length, 0)
      assert.equal(rows.length, 2)
    }
  }
})
