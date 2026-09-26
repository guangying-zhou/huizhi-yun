import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { createRequire } from 'node:module'

const code = buildSync({
  entryPoints: [new URL('../server/utils/enterprisePolicyGate.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['h3', '#imports', '@hzy/foundation/*']
}).outputFiles[0].text

test('opt-in Host gate preserves disabled path, trusted tenant/deployment and session version', async () => {
  let enabled = false
  let gateway = { appCode: 'enterprise', tenant: 'tenant-a', deployment: 'host-test' }
  let calls = 0
  const require = createRequire(import.meta.url)
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)((name) => {
    if (name === '#imports') return { useRuntimeConfig: () => ({ verifiedPolicy: { enabled, issuer: 'https://platform.example', kid: 'key', publicKey: 'public-only', environment: 'test' } }) }
    if (name.endsWith('/tenantGatewayTrust')) return { resolveTrustedTenantGatewayContext: () => gateway }
    if (name.endsWith('/enterprisePolicyReader')) return { readEnterprisePolicySnapshot: async (_, key, context) => {
      calls++
      assert.equal(key.kid, 'key')
      assert.equal(context.deployment, 'host-test')
      assert.equal(context.tenant, 'tenant-a')
      return { body: { bundleVersion: 'v2' } }
    } }
    return require(name)
  }, module, module.exports)
  const gate = module.exports.requireCurrentEnterprisePolicy
  await gate({}, { tenant: 'tenant-a', policyVersion: 'v1' })
  assert.equal(calls, 0)
  enabled = true
  await assert.rejects(gate({}, { tenant: 'tenant-a', policyVersion: 'v1' }), { statusCode: 401, data: { code: 'enterprise_policy_version_changed' } })
  await gate({}, { tenant: 'tenant-a', policyVersion: 'v2' })
  gateway = { ...gateway, tenant: 'other' }
  await assert.rejects(gate({}, { tenant: 'tenant-a', policyVersion: 'v2' }), { statusCode: 503 })
  gateway = null
  await assert.rejects(gate({}, { tenant: 'tenant-a', policyVersion: 'v2' }), { statusCode: 503 })
  assert.equal(calls, 2)
})
