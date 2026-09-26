import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { resolveApplicationShellMigrationTarget, createShellMigrationResolver } from '../app/utils/applicationShellMigration.ts'

const endpoint = readFileSync(new URL('../server/api/application-shell-migration.get.ts', import.meta.url), 'utf8')
const resolver = readFileSync(new URL('../app/utils/applicationShellMigration.ts', import.meta.url), 'utf8')
const gateway = readFileSync(new URL('../../deploy/cloudflare/tenant-gateway/src/index.js', import.meta.url), 'utf8')
const metadata = {
  version: 1, appCode: 'enterprise', deploymentCode: 'enterprise-r17', consoleDeploymentCode: 'console-r4',
  pages: { aims: ['/aims/projects', '/aims/projects/new', '/aims/projects/:id'] },
  entries: { aims: '/aims/projects' }
}

describe('controlled application Shell migration projection', () => {
  test('requires the authenticated Gateway binding and generated registration', () => {
    assert.match(endpoint, /resolveTrustedTenantGatewayContext\(event\)/)
    assert.match(endpoint, /context\.appCode !== 'console'/)
    assert.match(resolver, /metadata\.consoleDeploymentCode !== consoleDeployment/)
    assert.match(resolver, /registeredPath\(target\.pathname, pattern\)/)
    assert.match(resolver, /metadata\.version !== 1/)
  })

  test('preserves safe query/hash and rejects protocol endpoints without blocking create pages', () => {
    assert.match(resolver, /target\.searchParams\.delete\('hzy_embed'\)/)
    assert.match(resolver, /target\.searchParams\.delete\('standalone'\)/)
    assert.match(resolver, /target\.pathname\}\$\{target\.search\}\$\{target\.hash\}/)
    assert.match(resolver, /api\|oauth\|oidc/)
  })

  test('Gateway strips browser input and emits metadata only for the enterprise pilot', () => {
    assert.match(gateway, /'x-hzy-enterprise-shell-pages'/)
    assert.match(gateway, /env\.HZY_ENTERPRISE_PILOT !== 'true'/)
    assert.match(gateway, /validateEnterprisePilotBinding\(tenant, env\.HZY_ENTERPRISE_SERVICE\)/)
    assert.match(gateway, /enterpriseHostRoutes/)
  })

  test('resolves only registered pages with the bound Console deployment', () => {
    const result = (target: unknown, consoleDeployment = 'console-r4') => resolveApplicationShellMigrationTarget({
      metadata, consoleDeployment, appCode: 'aims', requested: target, origin: 'https://tenant.example'
    })
    assert.deepEqual(result('/aims/projects/new?tab=plan#members'), {
      target: '/aims/projects/new?tab=plan#members', release: 'enterprise-r17'
    })
    assert.deepEqual(result('https://tenant.example/aims/?tab=overview#top'), {
      target: '/aims/projects?tab=overview#top', release: 'enterprise-r17'
    })
    assert.deepEqual(result('/aims/projects/77'), { target: '/aims/projects/77', release: 'enterprise-r17' })
    assert.equal(result('/aims/projects/new', 'wrong-console'), null)
    assert.equal(result('https://attacker.example/aims/projects/new'), null)
    assert.equal(result('/aims/api/v1/projects'), null)
    assert.equal(result('/aims/projects/new/../../api/auth/me'), null)
    assert.equal(result('/aims/unknown'), null)
    assert.equal(result('/aims/projects/%2fapi'), null)
    assert.equal(result('/aims/projects/%5Capi'), null)
    assert.equal(result('/aims/projects/%00'), null)
    assert.equal(result('/aims/projects/%ZZ'), null)
  })

  test('concurrent checks coalesce; success and failures are not cached across navigation', async () => {
    const calls: Array<{ resolve: (value: any) => void, reject: (error: Error) => void }> = []
    const check = createShellMigrationResolver(() => new Promise((resolve, reject) => calls.push({ resolve, reject })))
    const first = check('aims', '/aims/')
    assert.equal(check('aims', '/aims/'), first)
    await Promise.resolve()
    calls[0]!.resolve({ migrated: true, target: '/aims/projects' })
    assert.equal(await first, '/aims/projects')
    const rollback = check('aims', '/aims/'); await Promise.resolve()
    calls[1]!.resolve({ migrated: false }); assert.equal(await rollback, '')
    const failed = check('aims', '/aims/'); await Promise.resolve()
    calls[2]!.reject(Error('unavailable')); await assert.rejects(failed, /unavailable/)
    const retry = check('aims', '/aims/'); await Promise.resolve()
    calls[3]!.resolve({ migrated: true, target: '//attacker.example' }); await assert.rejects(retry, /Invalid/)
    assert.equal(calls.length, 4)
  })
})
