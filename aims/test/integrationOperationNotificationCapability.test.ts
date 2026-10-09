import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('Aims reuses the existing fresh-view permission and Console-only detail capability', () => {
  const manifest = JSON.parse(readFileSync(new URL('../app.manifest.json', import.meta.url), 'utf8')) as {
    resources: Array<{ code: string, actions: string[] }>
  }
  const operations = manifest.resources.find(resource => resource.code === 'integration_operations')
  assert.ok(operations?.actions.includes('view'))
  const seed = readFileSync(new URL('../../console/docs/sql/Console-SQL-Seed-v1.38-console-runtime-people-notification-details.sql', import.meta.url), 'utf8')
  assert.match(seed, /aims:notification-details['`]?\s*,\s*['`]?authorize/)
  assert.doesNotMatch(seed, /recipient|generation|operation[_-]?id/i)
})
