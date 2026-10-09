import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test from 'node:test'

const root = fileURLToPath(new URL('..', import.meta.url))

test('service-client materialization is owned by Tenant Runtime and Console has no grant SQL', () => {
  const consoleSource = readFileSync(new URL('server/utils/serviceClients.ts', `file://${root}/`), 'utf8')
  const runtimeSource = readFileSync(new URL('../../data-runtime/internal/apps/console/auth_service_tokens.go', import.meta.url), 'utf8')

  assert.doesNotMatch(consoleSource, /service_client_grants|INSERT INTO|ON DUPLICATE KEY UPDATE|server\/utils\/db/)
  assert.match(runtimeSource, /INSERT INTO service_client_grants/)
  assert.match(runtimeSource, /JSON_OBJECT\('source','tenant-runtime-bootstrap'\)/)
  assert.match(runtimeSource, /ON DUPLICATE KEY UPDATE scope_json=VALUES\(scope_json\),status='active'/)
})
