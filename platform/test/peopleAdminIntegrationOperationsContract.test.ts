import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const manifest = JSON.parse(readFileSync('../people/app.manifest.json', 'utf8')) as {
  recommendedRoles: Array<{ code: string, suggestedPermissions: string[] }>
}
const seed = readFileSync('../platform/docs/sql/HZY-Platform-SQL-Seed-v2.17-people-admin-integration-operations.sql', 'utf8')

test('people:admin includes integration-operation diagnostics and controlled replay', () => {
  const role = manifest.recommendedRoles.find(item => item.code === 'people:admin')
  assert.ok(role)
  assert.ok(role.suggestedPermissions.includes('people:integration_operations:view'))
  assert.ok(role.suggestedPermissions.includes('people:integration_operations:replay'))
  assert.match(seed, /role_code` = 'people:admin'/)
  assert.match(seed, /resource_code` = 'integration_operations'/)
  assert.match(seed, /IN \('view', 'replay'\)/)
})
