import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const seed = readFileSync('../console/docs/sql/Console-SQL-Seed-v1.64-people-operation-runtime-grants.sql', 'utf8')
const middleware = readFileSync('../people/server/middleware/tenant-runtime.ts', 'utf8')
const integrationAdmin = readFileSync('../people/server/utils/integrationOperationAdmin.ts', 'utf8')

test('People runtime grants cover offboarding and integration-operation BFF scopes', () => {
  assert.match(middleware, /people:offboarding_tasks:\$\{action\}/)
  assert.match(integrationAdmin, /people:integration_operations:\$\{action\}/)
  for (const audience of ['data-runtime', 'tenant-runtime']) {
    for (const action of ['view', 'admin', 'confirm', 'cancel']) {
      assert.match(seed, new RegExp(`${audience}:people:offboarding_tasks'(?: AS [^,]+)?\\s*,\\s*'${action}'`))
    }
    for (const action of ['view', 'replay']) {
      assert.match(seed, new RegExp(`${audience}:people:integration_operations'\\s*,\\s*'${action}'`))
    }
  }
})
