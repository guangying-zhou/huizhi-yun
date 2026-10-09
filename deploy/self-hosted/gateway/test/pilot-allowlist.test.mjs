import assert from 'node:assert/strict'
import test from 'node:test'
import gateway, { tenantBindingMatchesExpected } from '../../../cloudflare/tenant-gateway/src/index.js'
import {
  enterpriseHostAllowlistFor,
  enterprisePilot,
  resolveEnterprisePilotPath,
  parseEnterpriseHostAllowlist,
  validateEnterprisePilotBinding
} from '../../../test-env/enterprise-topology.mjs'

const binding = { fetch() {} }
const prodEntry = { host: 'new-site.selfhosted-fixture.test', tenantCode: 'T900001', environment: 'selfhosted', deploymentCode: 'T900001-sh-enterprise' }
const prodTenant = { tenantCode: 'T900001', environment: 'selfhosted', apps: { enterprise: { deploymentCode: 'T900001-sh-enterprise' } } }
const testTenant = { tenantCode: enterprisePilot.tenantCode, environment: 'test', apps: { enterprise: { deploymentCode: enterprisePilot.deploymentCode } } }

test('pinned test pilot behaviour is unchanged with or without an allowlist', () => {
  assert.equal(validateEnterprisePilotBinding(testTenant, binding), true)
  assert.equal(validateEnterprisePilotBinding(testTenant, binding, [prodEntry]), true)
  assert.equal(validateEnterprisePilotBinding(testTenant, null), false)
  assert.equal(validateEnterprisePilotBinding({ ...testTenant, environment: 'prod' }, binding), false)
})

test('a configured deployment is accepted only when tenant + environment + deployment all match an entry', () => {
  assert.equal(validateEnterprisePilotBinding(prodTenant, binding, [prodEntry]), true)
  assert.equal(validateEnterprisePilotBinding(prodTenant, binding), false)
  assert.equal(validateEnterprisePilotBinding(prodTenant, binding, []), false)
  assert.equal(validateEnterprisePilotBinding(prodTenant, null, [prodEntry]), false)
  for (const changed of [
    { ...prodTenant, tenantCode: 'T900002' },
    { ...prodTenant, environment: 'prod' },
    { ...prodTenant, apps: { enterprise: { deploymentCode: 'C-managed-cloud-enterprise' } } },
    { ...prodTenant, apps: {} }
  ]) assert.equal(validateEnterprisePilotBinding(changed, binding, [prodEntry]), false)
  // Environment names carry no special meaning: any configured code works, nothing else does.
  const other = { ...prodEntry, environment: 'prod-b' }
  assert.equal(validateEnterprisePilotBinding({ ...prodTenant, environment: 'prod-b' }, binding, [other]), true)
})

test('allowlist parsing is strict and fails closed', () => {
  assert.deepEqual(parseEnterpriseHostAllowlist(''), [])
  assert.deepEqual(parseEnterpriseHostAllowlist(undefined), [])
  assert.equal(parseEnterpriseHostAllowlist('{'), null)
  assert.equal(parseEnterpriseHostAllowlist('[]'), null)
  assert.equal(parseEnterpriseHostAllowlist(JSON.stringify([{ ...prodEntry, extra: 1 }])), null)
  assert.equal(parseEnterpriseHostAllowlist(JSON.stringify([{ ...prodEntry, host: 'HTTPS://x' }])), null)
  assert.equal(parseEnterpriseHostAllowlist(JSON.stringify([{ ...prodEntry, deploymentCode: '' }])), null)
  const raw = JSON.stringify([prodEntry])
  assert.deepEqual(enterpriseHostAllowlistFor(raw, 'NEW-SITE.selfhosted-fixture.test'), [prodEntry])
  assert.deepEqual(enterpriseHostAllowlistFor(raw, 'other.selfhosted-fixture.test'), [])
  assert.deepEqual(enterpriseHostAllowlistFor('not json', prodEntry.host), [])
})

function workerEnv(overrides = {}) {
  const calls = { enterprise: [], console: [] }
  const record = (name) => ({ async fetch(url, init) { calls[name].push({ url: String(url), headers: new Headers(init?.headers) }); return new Response(name) } })
  const registry = {
    domains: {
      [prodEntry.host]: { tenantCode: 'T900001', environment: 'selfhosted', deploymentCode: 'T900001-sh-console',
        apps: { console: { deploymentCode: 'T900001-sh-console' }, enterprise: { deploymentCode: 'T900001-sh-enterprise' } } },
      'unlisted.selfhosted-fixture.test': { tenantCode: 'T900001', environment: 'selfhosted', deploymentCode: 'T900001-sh-console',
        apps: { console: { deploymentCode: 'T900001-sh-console' }, enterprise: { deploymentCode: 'T900001-sh-enterprise' } } },
      'hzy-test.huizhi.yun': { tenantCode: 'T900001', environment: 'selfhosted', deploymentCode: 'T900001-sh-console',
        apps: { console: { deploymentCode: 'T900001-sh-console' }, enterprise: { deploymentCode: 'T900001-sh-enterprise' } } }
    }
  }
  return {
    calls,
    env: {
      HZY_ENTERPRISE_PILOT: 'true',
      HZY_ALLOWED_TENANTS: 'T900001',
      HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'fixture-only',
      HZY_TENANT_GATEWAY_REGISTRY_JSON: JSON.stringify(registry),
      HZY_ENTERPRISE_HOST_ALLOWLIST_JSON: JSON.stringify([prodEntry]),
      HZY_ENTERPRISE_SERVICE: record('enterprise'),
      HZY_CONSOLE_SERVICE: record('console'),
      HZY_CONSOLE_ORIGIN: 'http://127.0.0.1:3000',
      ...overrides
    }
  }
}

test('Worker routes the Enterprise Host on an allowlisted host and emits trusted Shell metadata there only', async () => {
  const { env, calls } = workerEnv()
  const response = await gateway.fetch(new Request(`https://${prodEntry.host}/enterprise/login`), env)
  assert.equal(await response.text(), 'enterprise')
  assert.equal(calls.enterprise.at(-1).headers.get('x-hzy-deployment'), 'T900001-sh-enterprise')

  await gateway.fetch(new Request(`https://${prodEntry.host}/api/application-shell-migration`, { headers: { 'x-hzy-enterprise-shell-pages': 'forged' } }), env)
  const metadata = JSON.parse(calls.console.at(-1).headers.get('x-hzy-enterprise-shell-pages'))
  assert.equal(metadata.deploymentCode, 'T900001-sh-enterprise')

  // Same tenant, host not allowlisted: no pilot routing, no metadata.
  const unlisted = await gateway.fetch(new Request('https://unlisted.selfhosted-fixture.test/enterprise/login'), env)
  assert.equal(await unlisted.text(), 'console')
  await gateway.fetch(new Request('https://unlisted.selfhosted-fixture.test/api/application-shell-migration'), env)
  assert.equal(calls.console.at(-1).headers.get('x-hzy-enterprise-shell-pages'), null)
})

test('Worker refuses allowlisted hosts whose registry deployment differs, and non-test tenants on the test host', async () => {
  const { env } = workerEnv({ HZY_ENTERPRISE_HOST_ALLOWLIST_JSON: JSON.stringify([{ ...prodEntry, deploymentCode: 'other-enterprise' }]) })
  assert.equal((await gateway.fetch(new Request(`https://${prodEntry.host}/enterprise/login`), env)).status, 503)
  const malformed = workerEnv({ HZY_ENTERPRISE_HOST_ALLOWLIST_JSON: '[{"host":1}]' })
  assert.equal(await (await gateway.fetch(new Request(`https://${prodEntry.host}/enterprise/login`), malformed.env)).text(), 'console')
  // The fixed test host still only accepts the pinned C000001/test pilot.
  const onTestHost = workerEnv()
  assert.equal((await gateway.fetch(new Request('https://hzy-test.huizhi.yun/enterprise/login'), onTestHost.env)).status, 503)
})

test('expected site binding is a no-op when unset and exact when configured', () => {
  const tenant = {
    tenantCode: 'T900001', environment: 'selfhosted', deploymentCode: 'T900001-sh-console',
    apps: { console: { deploymentCode: 'T900001-sh-console' }, workflow: { deploymentCode: 'T900001-sh-workflow' } },
    dataRuntime: { endpoint: 'https://runtime.selfhosted-fixture.test', runtimeCode: 'rt-1' }
  }
  const expected = {
    tenantCode: 'T900001', environment: 'selfhosted',
    apps: { console: 'T900001-sh-console', workflow: 'T900001-sh-workflow' },
    dataRuntime: { endpoint: 'https://runtime.selfhosted-fixture.test', runtimeCode: 'rt-1' }
  }
  const env = value => ({ HZY_TENANT_GATEWAY_EXPECTED_BINDINGS_JSON: JSON.stringify({ 'site.selfhosted-fixture.test': value }) })
  assert.equal(tenantBindingMatchesExpected(tenant, 'site.selfhosted-fixture.test', {}), true)
  assert.equal(tenantBindingMatchesExpected(tenant, 'site.selfhosted-fixture.test', env(expected)), true)
  assert.equal(tenantBindingMatchesExpected(tenant, 'other.selfhosted-fixture.test', env(expected)), false)
  assert.equal(tenantBindingMatchesExpected(tenant, 'site.selfhosted-fixture.test', { HZY_TENANT_GATEWAY_EXPECTED_BINDINGS_JSON: '{' }), false)
  for (const changed of [
    { ...expected, environment: 'prod' },
    { ...expected, apps: { ...expected.apps, workflow: 'managed-cloud-workflow' } },
    { ...expected, apps: { ...expected.apps, aims: 'T900001-sh-aims' } },
    { ...expected, dataRuntime: { endpoint: 'https://jp-runtime.example.test', runtimeCode: 'rt-1' } },
    { ...expected, dataRuntime: { ...expected.dataRuntime, runtimeCode: 'rt-2' } }
  ]) assert.equal(tenantBindingMatchesExpected(tenant, 'site.selfhosted-fixture.test', env(changed)), false)
})


test('self-hosted allowlist uses the same APF registered surface', async () => {
  const { env, calls } = workerEnv()
  for (const [method, path, kind] of [
    ['GET', '/finance/bank-accounts', 'page'],
    ['HEAD', '/finance/bank-accounts', 'page'],
    ['POST', '/finance/api/v1/bank-accounts', 'api'],
    ['PATCH', '/altoc/api/v1/customers/7', 'api'],
    ['POST', '/altoc/api/v1/quotes/7/transition', 'api']
  ]) {
    assert.equal(resolveEnterprisePilotPath(path, '', method).kind, kind)
    assert.equal((await gateway.fetch(new Request(`https://${prodEntry.host}${path}`, { method }), env)).status, 200)
    assert.equal(calls.enterprise.at(-1).headers.get('x-hzy-app-code'), 'enterprise')
    assert.equal(calls.enterprise.at(-1).headers.get('x-hzy-deployment'), prodEntry.deploymentCode)
  }
  const before = calls.enterprise.length
  for (const path of ['/finance/api/v1/unknown', '/altoc/api/v1/customers/7/unknown']) {
    assert.equal((await gateway.fetch(new Request(`https://${prodEntry.host}${path}`), env)).status, 503)
  }
  assert.equal(calls.enterprise.length, before)
})
