import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { configuredGatewayIssuer } from '../server/utils/configuredGatewayIssuer.ts'

const fixture = { configuredIssuer: 'https://aidcp.wiztek.cn/console', forwardedHost: 'aidcp.wiztek.cn' }

test('self-hosted layout keeps the Console base path when the configured host is the verified gateway host', () => {
  assert.equal(configuredGatewayIssuer(fixture), 'https://aidcp.wiztek.cn/console')
  assert.equal(configuredGatewayIssuer({ ...fixture, configuredIssuer: 'https://aidcp.wiztek.cn/console/' }), 'https://aidcp.wiztek.cn/console')
  assert.equal(configuredGatewayIssuer({ ...fixture, configuredIssuer: 'HTTPS://AIDCP.WIZTEK.CN/console', forwardedHost: 'Aidcp.Wiztek.cn' }), 'https://aidcp.wiztek.cn/console')
})

test('a different host, missing value, non-https or malformed value never applies', () => {
  for (const override of [
    { configuredIssuer: 'https://other.example.test/console' },
    { configuredIssuer: 'https://aidcp.wiztek.cn.evil.test/console' },
    { configuredIssuer: 'https://aidcp.wiztek.cn:8443/console' },
    { configuredIssuer: '' },
    { forwardedHost: '' },
    { configuredIssuer: 'http://aidcp.wiztek.cn/console' },
    { configuredIssuer: 'not a url' },
    { configuredIssuer: 'https://user:pw@aidcp.wiztek.cn/console' },
    { configuredIssuer: 'https://aidcp.wiztek.cn/console?x=1' },
    { configuredIssuer: 'https://aidcp.wiztek.cn/console#frag' },
    { configuredIssuer: 'https://aidcp.wiztek.cn' },
    { configuredIssuer: 'https://aidcp.wiztek.cn/' },
    { configuredIssuer: 'https://aidcp.wiztek.cn/console/../admin' }
  ]) assert.equal(configuredGatewayIssuer({ ...fixture, ...override }), '', JSON.stringify(override))
})

test('getOidcIssuer order: local test gateway first, then the configured host-matched issuer, then the bare tenant host', () => {
  const source = readFileSync(new URL('../server/utils/oidc.ts', import.meta.url), 'utf8')
  const block = source.split('export function getOidcIssuer(event: H3Event) {')[1]?.split('function getCloudflareEnv(event: H3Event)')[0] || ''
  const local = block.indexOf('if (localIssuer) return localIssuer')
  const configured = block.indexOf('if (configuredIssuer) return configuredIssuer')
  const tenant = block.indexOf('const tenantIssuer = normalizePublicUrl(`https://${trustedGateway.forwardedHost}`)')
  assert.ok(local > 0 && local < configured && configured < tenant, 'issuer derivation order changed')
  assert.match(block, /configuredGatewayIssuer\(\{[\s\S]*forwardedHost: trustedGateway\.forwardedHost/)
})
