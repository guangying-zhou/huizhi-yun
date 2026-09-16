import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('business-domain service read contract', () => {
  test('authenticates and tenant-binds the service caller before reading tenant data', () => {
    const route = source('server/api/v1/console/service/business-domains.get.ts')
    const auth = route.indexOf('requireConsoleServiceActor')
    const binding = route.indexOf('actor.tenantCode !== binding.tenantId')
    const read = route.lastIndexOf('getConsoleBusinessDomains')

    assert.match(route, /'console:business-domain:view'/)
    assert.match(route, /requireBoundTargetApp: true/)
    assert.ok(auth >= 0 && auth < binding)
    assert.ok(binding < read)
  })

  test('Aims receives only the exact read capability and no Console UI role', () => {
    const seed = readFileSync(
      new URL('../docs/sql/Console-SQL-Seed-v1.85-aims-business-domain-read-grant.sql', import.meta.url),
      'utf8'
    )

    assert.match(seed, /sc\.`app_code` = 'aims'/)
    assert.match(seed, /'console:business-domain',[\s\S]*?'view'/)
    assert.match(seed, /'\/api\/v1\/console\/service\/business-domains'/)
    assert.doesNotMatch(seed, /console:operator|org_profile["']?\s*,\s*["']?view/i)
  })

  test('service route bypasses generic user-audience auth and verifies its exact scope', () => {
    const middleware = source('../foundation/server/middleware/console-auth.ts')
    assert.match(middleware, /pathname === '\/api\/v1\/console\/service\/business-domains'/)
  })
})
