import test from 'node:test'
import assert from 'node:assert/strict'
import { businessTables, preservedTables, stageDatabase, validateInventory } from '../data-refresh-plan.mjs'

test('business scope never replaces test credentials, sessions, integrations or live operations', () => {
  for (const app of ['console', 'people']) {
    assert.equal(new Set([...businessTables[app], ...preservedTables[app]]).size, businessTables[app].length + preservedTables[app].length)
    for (const t of businessTables[app]) assert.doesNotMatch(t, /^(auth_|vault_|service_|integration_|integrations$|local_sessions$|connector_)/)
    assert.notEqual(stageDatabase(app), `hzy_${app}`)
    assert.doesNotThrow(() => validateInventory(app, [...businessTables[app], ...preservedTables[app]]))
    assert.throws(() => validateInventory(app, [...businessTables[app], 'new_unreviewed_table']))
    assert.throws(() => validateInventory(app, businessTables[app].slice(1)))
  }
  assert.throws(() => stageDatabase('platform'))
  assert.ok(businessTables.console.includes('directory_identities'))
  assert.ok(businessTables.people.includes('people_employee_private_facts'))
})
