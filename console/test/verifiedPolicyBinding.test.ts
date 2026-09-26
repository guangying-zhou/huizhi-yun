import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../server/utils/verifiedPolicyRuntime.ts', import.meta.url), 'utf8')
const body = source.slice(source.indexOf('export function verifiedPolicyTrust'), source.indexOf('\nasync function dependencies'))
const js = ts.transpile(body.replace('export ', ''), { target: ts.ScriptTarget.ES2022 })
test('Console policy receipt uses owning deployment, never the inbound token caller deployment', () => {
  let gateway: { tenant: string, environment: string, appCode: string, deployment: string } | null = {
    tenant: 'tenant', environment: 'test', appCode: 'enterprise', deployment: 'enterprise-test'
  }
  let route: { deploymentCode: string } | null = { deploymentCode: 'console-test' }
  const trust = new Function('resolveTrustedTenantGatewayContext', 'resolveTrustedServiceAppRoute', 'policyMaxAgeMs', 'createError', `${js}; return verifiedPolicyTrust`)(
    () => gateway, () => route, () => 300000, (input: { message: string }) => Error(input.message))
  const config = { activationMode: 'managed-cloud-multitenant', baseUrl: 'https://platform.test', tenantCode: 'tenant', environment: 'test', deploymentCode: 'enterprise-test' }
  assert.equal(trust(config, {}).context.deployment, 'console-test')
  assert.equal(gateway.appCode, 'enterprise')
  assert.equal(gateway.deployment, 'enterprise-test')
  route = null
  assert.throws(() => trust(config, {}), /binding unavailable/)
  gateway = { ...gateway, appCode: 'console', deployment: 'console-test' }
  assert.equal(trust(config, {}).context.deployment, 'console-test')
  gateway.tenant = 'other'
  assert.throws(() => trust(config, {}), /binding unavailable/)
  gateway = null
  assert.throws(() => trust(config, {}), /binding unavailable/)
  assert.equal(trust({ ...config, activationMode: 'standalone', deploymentCode: 'own-console' }).context.deployment, 'own-console')
})

test('Enterprise reader installer supplies both audience mappings without reviving revoked grants', () => {
  const seed = readFileSync(new URL('../docs/sql/Console-SQL-Seed-enterprise-policy-reader.sql', import.meta.url), 'utf8')
  for (const audience of ['data-runtime', 'tenant-runtime']) {
    assert.ok(seed.includes(`'${audience}:console:policy-bundle','${audience}'`))
  }
  assert.match(seed, /'semanticScope','console:policy-bundle:read'/)
  assert.match(seed, /g.resource_code=expected.resource_code AND g.action='read'/)
  assert.doesNotMatch(seed, /ON DUPLICATE KEY UPDATE|'write'/)
})
