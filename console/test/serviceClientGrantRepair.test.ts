import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('AIMS Codocs runtime grant repair', () => {
  test('server endpoint requires service-client admin and invokes only the fixed runtime repair', () => {
    const content = source('server/api/v1/console/service-clients/repairs/aims-codocs-runtime-read.post.ts')

    assert.match(content, /requirePermission\(event, 'service_clients', 'admin'/)
    assert.match(content, /requireIdempotencyKey\(event\)/)
    assert.match(content, /requireConsoleRequestUid\(event\)/)
    assert.match(content, /'\/v1\/console\/admin\/service-grant-repairs\/aims-codocs-runtime-read'/)
    assert.match(content, /scope: 'console:service-client:grant'/)
    assert.doesNotMatch(content, /readBody|resourceCode|clientCode|semanticScope/)
  })

  test('service-client page hides mutation behind service_clients admin permission', () => {
    const content = source('app/pages/service-clients.vue')

    assert.match(content, /hasPermission\('service_clients', 'admin'\)/)
    assert.match(content, /:disabled="!canAdminServiceClients"/)
    assert.match(content, /\/api\/v1\/console\/service-clients\/repairs\/aims-codocs-runtime-read/)
    assert.match(content, /'Idempotency-Key': crypto\.randomUUID\(\)/)
  })
})
