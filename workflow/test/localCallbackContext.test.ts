import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { verifiedLocalWorkflowCallbackHeaders, verifiedSelfHostedCallbackHeaders } from '../server/utils/localCallbackContext.ts'

const valid = {
  appCode: 'aims',
  context: {
    tenant: 'C000001',
    deployment: 'C000001-test-workflow-local',
    environment: 'test',
    appCode: 'workflow',
    forwardedHost: 'hzy0.isme.dev'
  },
  canonicalRuntimeUrl: 'https://hzy-test-runtime.isme.dev',
  dialUrl: 'http://127.0.0.1:18084',
  forwardedHeaders: {
    'x-hzy-gateway': 'tenant-gateway',
    'x-hzy-gateway-token': 'test-fixture',
    'x-hzy-tenant': 'C000001',
    'x-hzy-app-code': 'aims',
    'x-hzy-deployment': 'C000001-test-aims',
    'x-forwarded-prefix': '/aims'
  }
}

test('local callback carries the exact Aims target and loopback Runtime dial', () => {
  assert.deepEqual(verifiedLocalWorkflowCallbackHeaders(valid), {
    ...valid.forwardedHeaders,
    'x-hzy-local-runtime-dial-url': valid.dialUrl
  })
})

test('local callback rejects untrusted gateway or mismatched target and dial', () => {
  for (const input of [
    { ...valid, context: null },
    { ...valid, context: { ...valid.context, deployment: 'other' } },
    { ...valid, appCode: 'codocs' },
    { ...valid, dialUrl: 'https://hzy-test-runtime.isme.dev' },
    { ...valid, forwardedHeaders: { ...valid.forwardedHeaders, 'x-hzy-deployment': 'other' } },
    { ...valid, forwardedHeaders: { ...valid.forwardedHeaders, 'x-hzy-gateway-token': '' } }
  ]) {
    assert.throws(() => verifiedLocalWorkflowCallbackHeaders(input), /local_callback_(gateway_context|target_binding)_invalid/)
  }
})

const selfHosted = {
  appCode: 'aims',
  context: { tenant: 'T1', deployment: 'T1-workflow', environment: 'prod', appCode: 'workflow', forwardedHost: 'site.example.test' },
  route: { deploymentCode: 'T1-aims', basePath: '/aims/' },
  forwardedHeaders: {
    'x-hzy-gateway': 'tenant-gateway',
    'x-hzy-gateway-token': 'gateway-fixture',
    'x-hzy-tenant': 'T1',
    'x-hzy-app-code': 'aims',
    'x-hzy-deployment': 'T1-aims',
    'x-forwarded-prefix': '/aims'
  }
}

test('self-hosted callback carries the verified Gateway context with the Aims target bound', () => {
  assert.deepEqual(verifiedSelfHostedCallbackHeaders(selfHosted), selfHosted.forwardedHeaders)
})

test('self-hosted callback rejects missing trust, source-bound or mismatched target context and any dial header', () => {
  for (const input of [
    { ...selfHosted, context: null },
    { ...selfHosted, context: { ...selfHosted.context, appCode: 'aims' } },
    { ...selfHosted, route: null },
    { ...selfHosted, forwardedHeaders: { ...selfHosted.forwardedHeaders, 'x-hzy-gateway-token': '' } },
    { ...selfHosted, forwardedHeaders: { ...selfHosted.forwardedHeaders, 'x-hzy-tenant': 'T2' } },
    { ...selfHosted, forwardedHeaders: { ...selfHosted.forwardedHeaders, 'x-hzy-app-code': 'workflow' } },
    { ...selfHosted, forwardedHeaders: { ...selfHosted.forwardedHeaders, 'x-hzy-deployment': 'T1-workflow' } },
    { ...selfHosted, forwardedHeaders: { ...selfHosted.forwardedHeaders, 'x-forwarded-prefix': '/workflow' } },
    { ...selfHosted, forwardedHeaders: { ...selfHosted.forwardedHeaders, 'x-hzy-local-runtime-dial-url': 'http://127.0.0.1:18084' } }
  ]) {
    assert.throws(() => verifiedSelfHostedCallbackHeaders(input), /self_hosted_callback_(gateway_context|target_binding)_invalid/)
  }
})

test('callback delivery selects hzy0, Cloudflare Gateway or self-hosted loopback explicitly', () => {
  const source = readFileSync(new URL('../server/utils/dataRuntime.ts', import.meta.url), 'utf8')
  assert.match(source, /const selfHosted = !localOnly && !tenantGatewayServiceBinding\(event\) && isSelfHostedServiceTopologyEnabled\(\)/)
  assert.match(source, /selfHosted \? \(selfHostedRoute\?\.baseUrl \|\| ''\) : resolveServiceAppBaseUrl\(event, target\.appCode\)/)
  assert.match(source, /selfHosted \? selfHostedServiceBinding\(target\.appCode\) : tenantGatewayServiceBinding\(event\)/)
  assert.match(source, /verifiedSelfHostedCallbackHeaders\(\{[\s\S]*forwardedHeaders: trustedServiceRequestHeaders\(event, appCode\)/)
  // hzy0 path unchanged.
  assert.match(source, /target\.appCode === 'enterprise' \? String\(process\.env\.HZY0_LOCAL_ENTERPRISE_URL \|\| ''\)/)
})

test('local mapped callback requires Enterprise target deployment and prefix together', () => {
  const mapped = { ...valid, appCode: 'enterprise', forwardedHeaders: { ...valid.forwardedHeaders, 'x-hzy-app-code': 'enterprise', 'x-hzy-deployment': 'C000001-test-enterprise', 'x-forwarded-prefix': '/enterprise' } }
  assert.deepEqual(verifiedLocalWorkflowCallbackHeaders(mapped), { ...mapped.forwardedHeaders, 'x-hzy-local-runtime-dial-url': valid.dialUrl })
  assert.throws(() => verifiedLocalWorkflowCallbackHeaders({ ...mapped, forwardedHeaders: valid.forwardedHeaders }), /target_binding_invalid/)
})
