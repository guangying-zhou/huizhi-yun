import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkedGatewayAssertion, gatewayAssertionLaneEnabled } from '../server/utils/gatewayAssertionForwarding'
import { GATEWAY_EXCHANGE_PATH } from '@hzy/foundation/shared/utils/gatewayAssertionContract'

test('Console compares signed request with trusted Gateway context, never body source authority', () => {
  const globals = globalThis as typeof globalThis & { useRuntimeConfig?: () => unknown }
  const previous = globals.useRuntimeConfig
  globals.useRuntimeConfig = () => ({ hzy: { cloudflareInternalToken: 'test-only-gateway-trust' } })
  const headers: Record<string, string> = { 'x-hzy-gateway': 'tenant-gateway', 'x-hzy-gateway-token': 'test-only-gateway-trust', 'x-hzy-tenant': 'T-TEST', 'x-hzy-environment': 'test', 'x-hzy-app-code': 'aims', 'x-hzy-deployment': 'test-aims', 'x-hzy-gateway-deployment': 'test-gateway', 'x-hzy-data-runtime-code': 'test-runtime' }
  const event = () => ({ node: { req: { headers } }, headers: new Headers(headers), context: {} }) as never
  const body = { clientId: 'aims.runtime', audience: 'data-runtime', scope: 'aims:b:view  aims:a:view', appCode: 'aims' }
  const claims = { tenant: 'T-TEST', environment: 'test', source_app: 'aims', source_deployment: 'test-aims', gateway_deployment: 'test-gateway', runtime_code: 'test-runtime', client_id: 'aims.runtime', oauth_audience: 'data-runtime', scope: 'aims:a:view aims:b:view', source_binding: 'trusted-gateway', method: 'POST', path: GATEWAY_EXCHANGE_PATH, aud: GATEWAY_EXCHANGE_PATH, iss: 'gateway:test-gateway', sub: 'gateway:test-gateway' }
  const assertion = (value: unknown) => [Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'hzy-gateway-service-assertion+jwt' })).toString('base64url'), Buffer.from(JSON.stringify(value)).toString('base64url'), 'signature-verified-by-Runtime'].join('.')
  try {
    assert.equal(checkedGatewayAssertion(event(), assertion(claims), body).scope, 'aims:a:view aims:b:view')
    for (const field of Object.keys(claims)) assert.throws(() => checkedGatewayAssertion(event(), assertion({ ...claims, [field]: 'other' }), body), /request_mismatch/)
    assert.throws(() => checkedGatewayAssertion(event(), assertion(claims), { ...body, appCode: 'other' }), /request_mismatch/)
    headers['x-hzy-gateway-token'] = 'forged'
    assert.throws(() => checkedGatewayAssertion(event(), assertion(claims), body), /context_invalid/)
  } finally {
    if (previous) globals.useRuntimeConfig = previous
    else delete globals.useRuntimeConfig
  }
})

test('Console and Foundation preserve the precise forwarding route and default-off entry', () => {
  const source = readFileSync(new URL('../server/routes/oauth/token.post.ts', import.meta.url), 'utf8')
  assert.match(source, /HZY_CONSOLE_GATEWAY_EXCHANGE_ENABLED === 'true'/)
  assert.match(source, /gatewayAssertionLaneEnabled/)
  assert.match(source, /checkedGatewayAssertion/)
  assert.match(source, /exchangeConsoleGatewayToken/)
  assert.equal(source.includes('gatewayExchangeAllowsLegacy'), false, 'Console never silently retries the old issuer')
})

test('Console Nitro includes the shared Gateway contract instead of relocating an external import', () => {
  const config = readFileSync(new URL('../nuxt.config.ts', import.meta.url), 'utf8')
  assert.match(config, /inline:\s*\['collab',\s*fileURLToPath\(new URL\('\.\.\/foundation\/shared\/contracts\/gatewayAssertion\.mjs', import\.meta\.url\)\)\]/)
  const contract = readFileSync(new URL('../../foundation/shared/contracts/gatewayAssertion.mjs', import.meta.url), 'utf8')
  assert.match(contract, /export function canonicalGatewayScope/)
})

test('Runtime legacy claims fixture comes from the unchanged Console claim builder', async () => {
  const { buildServiceAccessTokenClaims } = await import('../server/utils/serviceAccessTokenClaims')
  const fixture = JSON.parse(readFileSync(new URL('../../data-runtime/internal/apps/console/testdata/gateway-legacy-claims.json', import.meta.url), 'utf8'))
  assert.deepEqual(buildServiceAccessTokenClaims({ audience: 'data-runtime', scope: 'aims:product:view', expiresIn: 900, serviceClient: { clientId: 'aims.runtime', clientCode: 'aims.runtime', clientName: 'Aims', clientType: 'runtime', appCode: 'aims', credentialId: 20 } }, { issuer: 'https://example.test/console', tenantCode: 'C000001', deploymentCode: 'C000001-test-aims', policyVersion: 'v7', caps: 'hash-7' }), fixture)
})

test('Gateway lane cannot precede Console flag and disabled is not keyset fallback', () => {
  assert.equal(gatewayAssertionLaneEnabled('', '', false), false)
  assert.equal(gatewayAssertionLaneEnabled('proof', 'fixture-secret', false), false)
  assert.equal(gatewayAssertionLaneEnabled('proof', '', true), true)
  assert.throws(() => gatewayAssertionLaneEnabled('proof', '', false), (error: unknown) => {
    const failure = error as { statusCode: number, data: { code: string } }
    return failure.statusCode === 503 && failure.data.code === 'gateway_exchange_disabled'
  })
})
