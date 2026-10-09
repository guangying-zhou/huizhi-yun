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

test('Self-hosted switch binds to the Console own deployment only when the catalog is absent or agrees', () => {
  const gateway = { tenant: 'tenant', environment: 'test', appCode: 'enterprise', deployment: 'enterprise-test' }
  let route: { deploymentCode: string } | null = null
  const trust = new Function('resolveTrustedTenantGatewayContext', 'resolveTrustedServiceAppRoute', 'policyMaxAgeMs', 'createError', `${js}; return verifiedPolicyTrust`)(
    () => gateway, () => route, () => 300000, (input: { message: string, data?: { code: string } }) => Error(input.data?.code || input.message))
  // config.deploymentCode follows the inbound caller in managed-cloud mode; the owner must come from the process env.
  const config = { activationMode: 'managed-cloud-multitenant', baseUrl: 'https://platform.test', tenantCode: 'tenant', environment: 'test', deploymentCode: 'enterprise-test' }
  const previous = process.env.HZY_CONSOLE_SELF_HOSTED_POLICY_BINDING
  const previousDeployment = process.env.HZY_PLATFORM_DEPLOYMENT_CODE
  process.env.HZY_PLATFORM_DEPLOYMENT_CODE = 'C000001-console'
  try {
    delete process.env.HZY_CONSOLE_SELF_HOSTED_POLICY_BINDING
    assert.throws(() => trust(config, {}), /verified_console_route_missing/)
    process.env.HZY_CONSOLE_SELF_HOSTED_POLICY_BINDING = 'true'
    assert.equal(trust(config, {}).context.deployment, 'C000001-console')
    route = { deploymentCode: 'C000001-console' }
    assert.equal(trust(config, {}).context.deployment, 'C000001-console')
    route = { deploymentCode: 'other-console' }
    assert.throws(() => trust(config, {}), /verified_console_route_conflict/)
    route = null
    process.env.HZY_PLATFORM_DEPLOYMENT_CODE = ''
    assert.throws(() => trust(config, {}), /verified_console_route_missing/)
  } finally {
    if (previous === undefined) delete process.env.HZY_CONSOLE_SELF_HOSTED_POLICY_BINDING
    else process.env.HZY_CONSOLE_SELF_HOSTED_POLICY_BINDING = previous
    if (previousDeployment === undefined) delete process.env.HZY_PLATFORM_DEPLOYMENT_CODE
    else process.env.HZY_PLATFORM_DEPLOYMENT_CODE = previousDeployment
  }
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
